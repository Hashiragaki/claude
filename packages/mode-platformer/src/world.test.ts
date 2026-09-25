import { TILE_SIZE } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { input, levelFromAscii, makeSystem, NO_INPUT } from './test-helpers';
import type { WorldEvent } from './types';
import { PlatformerWorld } from './world';

const DT = 1 / 60;

/** Avance `n` pas, renvoie tous les événements produits (dans l'ordre). */
function run(world: PlatformerWorld, n: number, cmd = NO_INPUT, dt = DT): WorldEvent[] {
  const events: WorldEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...world.step(dt, cmd));
  return events;
}

function eventsOfType(events: WorldEvent[], type: WorldEvent['type']): WorldEvent[] {
  return events.filter((e) => e.type === type);
}

describe('PlatformerWorld — joueur', () => {
  it('saute et retombe (coyote time après avoir quitté un rebord)', () => {
    const level = levelFromAscii(
      ['............', '............', '............', '............', '###.........', '............'],
      { playerStart: { x: 1, y: 3 } },
    );
    const system = makeSystem({
      physics: {
        runSpeed: 300,
        acceleration: 100000,
        airControl: 1,
        jumpSpeed: 200,
        coyoteTime: 0.1,
        jumpBuffer: 0.05,
        jumpCutFactor: 1,
      },
    });
    const world = new PlatformerWorld(level, system);
    run(world, 2); // stabilise onGround
    expect(world.player().onGround).toBe(true);

    // Court le joueur vers le bord du plateau (colonnes 0-2 solides) jusqu'à quitter le sol.
    let leftGroundAt = -1;
    for (let i = 0; i < 30 && leftGroundAt < 0; i++) {
      run(world, 1, input({ right: true }));
      if (!world.player().onGround) leftGroundAt = i;
    }
    expect(leftGroundAt).toBeGreaterThanOrEqual(0);

    // Saut immédiat après avoir quitté le rebord : le coyote time doit encore l'autoriser.
    const events = run(world, 1, input({ right: true, jumpPressed: true, jumpHeld: true }));
    expect(eventsOfType(events, 'jump')).toHaveLength(1);
    expect(world.player().vy).toBeLessThan(0);
  });

  it('refuse le saut une fois le coyote time expiré', () => {
    const level = levelFromAscii(
      ['............', '............', '............', '............', '###.........', '............'],
      { playerStart: { x: 1, y: 3 } },
    );
    const system = makeSystem({
      physics: {
        runSpeed: 300,
        acceleration: 100000,
        airControl: 1,
        jumpSpeed: 200,
        coyoteTime: 0.05,
        jumpBuffer: 0.05,
        jumpCutFactor: 1,
      },
    });
    const world = new PlatformerWorld(level, system);
    run(world, 2);
    expect(world.player().onGround).toBe(true);
    for (let i = 0; i < 30 && world.player().onGround; i++) run(world, 1, input({ right: true }));
    expect(world.player().onGround).toBe(false);

    // Laisse le coyote time expirer largement avant de sauter.
    run(world, 20, input({ right: true }));
    const events = run(world, 1, input({ right: true, jumpPressed: true, jumpHeld: true }));
    expect(eventsOfType(events, 'jump')).toHaveLength(0);
    expect(world.player().vy).toBeGreaterThan(0);
  });

  it('mémorise un appui sur saut juste avant l’atterrissage (jump buffer)', () => {
    // Niveau où le joueur démarre en l'air (départ par défaut, au-dessus du sol) et tombe.
    const level = levelFromAscii(['....', '....', '....', '####']);
    const system = makeSystem({
      physics: { jumpBuffer: 0.5, coyoteTime: 0.1, jumpSpeed: 220, jumpCutFactor: 1, gravity: 640 },
    });
    const world = new PlatformerWorld(level, system);
    // Un appui bref sur saut, très tôt pendant la chute (encore en l'air).
    const early = run(world, 1, input({ jumpPressed: true }));
    expect(eventsOfType(early, 'jump')).toHaveLength(0);
    expect(world.player().onGround).toBe(false);

    // Le joueur continue de tomber sans autre appui ; le saut mémorisé doit se déclencher à l'atterrissage.
    let jumped = false;
    for (let i = 0; i < 40 && !jumped; i++) {
      const stepEvents = world.step(DT, NO_INPUT);
      if (eventsOfType(stepEvents, 'jump').length > 0) {
        jumped = true;
        expect(world.player().vy).toBeLessThan(0);
      }
    }
    expect(jumped).toBe(true);
  });

  it('saut court : relâcher le saut tôt réduit la vitesse ascendante', () => {
    const level = levelFromAscii(
      ['............', '............', '............', '............', '###.........', '............'],
      { playerStart: { x: 1, y: 3 } },
    );
    const system = makeSystem({
      physics: { jumpSpeed: 200, gravity: 600, jumpCutFactor: 0.5, coyoteTime: 0.1, jumpBuffer: 0.12 },
    });
    const world = new PlatformerWorld(level, system);
    run(world, 2); // stabilise onGround
    expect(world.player().onGround).toBe(true);
    run(world, 1, input({ jumpPressed: true, jumpHeld: true }));
    const vyHeld = world.player().vy;
    expect(vyHeld).toBeLessThan(0);
    // Relâche le saut immédiatement : la vitesse montante doit être fortement réduite.
    run(world, 1, input({ jumpHeld: false }));
    const vyCut = world.player().vy;
    expect(vyCut).toBeGreaterThan(vyHeld * 0.7); // beaucoup moins négatif que sans relâchement
  });
});

describe('PlatformerWorld — pièces et arrivée', () => {
  it('ramasse une pièce une seule fois', () => {
    // Le joueur part de la case 0 et court vers la droite : il traverse la pièce en case 2.
    const level = levelFromAscii(['......', '......', 'P.....', '######'], {
      entities: [{ id: 'c1', type: 'coin', x: 2, y: 2 }],
    });
    const world = new PlatformerWorld(level, makeSystem());
    const events = run(world, 60, input({ right: true }));
    expect(eventsOfType(events, 'coin')).toHaveLength(1);
    expect(world.collectedIds()).toEqual(['c1']);
    expect(world.entities().find((e) => e.id === 'c1')?.active).toBe(false);
    // Repasser dessus ne la ramasse pas une seconde fois.
    const back = run(world, 60, input({ left: true }));
    expect(eventsOfType(back, 'coin')).toHaveLength(0);
  });

  it('reprend une pièce déjà ramassée via `collected`', () => {
    const level = levelFromAscii(['....', '....', '....', '####'], {
      entities: [{ id: 'c1', type: 'coin', x: 0, y: 2 }],
    });
    const system = makeSystem();
    const world = new PlatformerWorld(level, system, { collected: ['c1'] });
    expect(world.collectedIds()).toEqual(['c1']);
    expect(world.entities().find((e) => e.id === 'c1')?.active).toBe(false);
  });

  it('atteint l’arrivée (goal) et termine le niveau', () => {
    const level = levelFromAscii(['....', '....', '....', '####'], {
      playerStart: { x: 0, y: 2 },
      entities: [{ id: 'goal1', type: 'goal', x: 2, y: 2 }],
    });
    const system = makeSystem({ physics: { runSpeed: 200, acceleration: 100000 } });
    const world = new PlatformerWorld(level, system);
    const events = run(world, 40, input({ right: true }));
    expect(eventsOfType(events, 'goal')).toHaveLength(1);
    expect(world.finished).toBe(true);
  });
});

describe('PlatformerWorld — dangers et mort', () => {
  it('meurt en tombant hors du niveau (fall)', () => {
    const level = levelFromAscii(['....', '....', '....', '....']); // aucun sol : le joueur tombe
    const system = makeSystem();
    const world = new PlatformerWorld(level, system);
    const events = run(world, 120);
    const causes = eventsOfType(events, 'death').map((e) => (e as Extract<WorldEvent, { type: 'death' }>).cause);
    expect(causes).toContain('fall');
    expect(world.dead).toBe(true);
  });

  it('meurt au contact d’une tuile hazard', () => {
    const level = levelFromAscii(['....', '....', '.^..', '####']);
    const system = makeSystem();
    const world = new PlatformerWorld(level, system);
    const events = run(world, 30, input({ right: true }));
    const deaths = eventsOfType(events, 'death') as Extract<WorldEvent, { type: 'death' }>[];
    expect(deaths.some((d) => d.cause === 'hazard')).toBe(true);
    expect(world.dead).toBe(true);
  });

  it('meurt quand le temps est écoulé', () => {
    const level = levelFromAscii(['....', '....', '....', '####'], { timeLimit: 1 });
    const system = makeSystem();
    const world = new PlatformerWorld(level, system);
    expect(world.timeLeft()).toBe(1);
    const events = run(world, 70); // 70/60 s > 1 s
    const deaths = eventsOfType(events, 'death') as Extract<WorldEvent, { type: 'death' }>[];
    expect(deaths.some((d) => d.cause === 'time')).toBe(true);
    expect(world.dead).toBe(true);
  });
});

describe('PlatformerWorld — checkpoint et réapparition', () => {
  it('active un point de contrôle puis y fait réapparaître le joueur après une mort', () => {
    const level = levelFromAscii(['.....', '.....', '.....', '#####'], {
      playerStart: { x: 0, y: 2 },
      entities: [
        { id: 'cp1', type: 'checkpoint', x: 3, y: 2 },
        { id: 'c1', type: 'coin', x: 1, y: 2 },
      ],
    });
    const system = makeSystem({ physics: { runSpeed: 200, acceleration: 100000 } });
    const world = new PlatformerWorld(level, system);

    const events = run(world, 60, input({ right: true }));
    expect(eventsOfType(events, 'checkpoint')).toHaveLength(1);
    expect(world.activeCheckpoint()).toBe('cp1');
    expect(world.collectedIds()).toContain('c1');

    // Simule une mort (chute) puis réapparition.
    world.respawn();
    expect(world.dead).toBe(false);
    // Le joueur réapparaît près du checkpoint (pas à la position de départ).
    expect(world.player().x).toBeGreaterThan(1 * TILE_SIZE);
    // Les pièces déjà ramassées restent acquises.
    expect(world.collectedIds()).toContain('c1');
    // Toujours invincible juste après la réapparition.
    expect(world.player().invincible).toBe(true);
  });
});

describe('PlatformerWorld — ressort', () => {
  it('rebondit sur un ressort en atterrissant dessus', () => {
    const level = levelFromAscii(['....', '....', '....', '####'], {
      playerStart: { x: 1, y: 0 },
      entities: [{ id: 's1', type: 'spring', x: 1, y: 2 }],
    });
    const system = makeSystem();
    const world = new PlatformerWorld(level, system);
    const events = run(world, 60);
    const springs = eventsOfType(events, 'spring');
    expect(springs.length).toBeGreaterThanOrEqual(1);
    expect(world.player().vy).toBeLessThan(0);
  });
});

describe('PlatformerWorld — ennemis', () => {
  it('stomp : sauter sur un ennemi l’élimine et fait rebondir le joueur', () => {
    // Le joueur démarre directement au-dessus de l'ennemi et tombe dessus (pas d'approche latérale).
    const level = levelFromAscii(['......', '......', '......', '......', '######'], {
      playerStart: { x: 2, y: 0 },
      entities: [{ id: 'e1', type: 'enemy', kind: 'walker', x: 2, y: 3, speed: 1 }],
    });
    const system = makeSystem({ physics: { jumpSpeed: 220 } });
    const world = new PlatformerWorld(level, system);
    const events = run(world, 60, NO_INPUT);
    const stomps = eventsOfType(events, 'stomp');
    expect(stomps).toHaveLength(1);
    expect(world.entities().find((e) => e.id === 'e1')?.active).toBe(false);
    expect(world.dead).toBe(false);
  });

  it('mort au contact latéral d’un ennemi (pas un stomp)', () => {
    const level = levelFromAscii(['......', '......', '......', '######'], {
      playerStart: { x: 0, y: 1 },
      entities: [{ id: 'e1', type: 'enemy', kind: 'walker', x: 3, y: 1, speed: 1 }],
    });
    const system = makeSystem({ physics: { runSpeed: 300, acceleration: 100000 } });
    const world = new PlatformerWorld(level, system);
    const events = run(world, 60, input({ right: true }));
    const deaths = eventsOfType(events, 'death') as Extract<WorldEvent, { type: 'death' }>[];
    expect(deaths.some((d) => d.cause === 'enemy')).toBe(true);
    expect(world.dead).toBe(true);
  });

  it('patrouille (walker) : demi-tour contre un mur', () => {
    const level = levelFromAscii(['........', '........', '........', '......#.', '########'], {
      playerStart: { x: 0, y: 0 }, // hors du chemin de l'ennemi
      entities: [{ id: 'e1', type: 'enemy', kind: 'walker', x: 1, y: 3, speed: 40, facing: 'right' }],
    });
    const system = makeSystem();
    const world = new PlatformerWorld(level, system);
    run(world, 110);
    const e = world.entities().find((en) => en.id === 'e1');
    expect(e?.facing).toBe('left');
  });

  it('patrouille (walker) : demi-tour au bord du vide', () => {
    const level = levelFromAscii(['........', '........', '........', '..######'], {
      playerStart: { x: 7, y: 2 }, // sur le sol, hors du chemin de l'ennemi
      entities: [{ id: 'e1', type: 'enemy', kind: 'walker', x: 4, y: 2, speed: 40, facing: 'left' }],
    });
    const system = makeSystem();
    const world = new PlatformerWorld(level, system);
    run(world, 110);
    const e = world.entities().find((en) => en.id === 'e1');
    expect(e?.facing).toBe('right');
  });
});
