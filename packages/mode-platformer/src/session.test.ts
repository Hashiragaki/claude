import { describe, expect, it } from 'vitest';
import { PlatformerStateSchema, type PlatformerLevel } from './schema';
import { PlatformerSession } from './session';
import { input, levelFromAscii, makeSystem, NO_INPUT } from './test-helpers';
import type { SessionPhase } from './types';

const DT = 1 / 60;

function run(session: PlatformerSession, n: number, cmd = NO_INPUT): void {
  for (let i = 0; i < n; i++) session.step(DT, cmd);
}

/** Avance jusqu'à ce que la phase demandée soit atteinte (ou `maxFrames` atteint). */
function runUntilPhase(session: PlatformerSession, phase: SessionPhase, maxFrames = 300, cmd = NO_INPUT): void {
  for (let i = 0; i < maxFrames && session.phase !== phase; i++) session.step(DT, cmd);
}

/** Deux petits niveaux enchaînés (`a` puis `b`) partageant le même gabarit de sol. */
function twoLevels(): Map<string, PlatformerLevel> {
  const a = levelFromAscii(['....', '....', '....', '####'], {
    id: 'a',
    entities: [{ id: 'goal1', type: 'goal', x: 2, y: 2 }],
  });
  const b = levelFromAscii(['....', '....', '....', '####'], { id: 'b' });
  return new Map([
    ['a', a],
    ['b', b],
  ]);
}

function makeLoader(levels: Map<string, PlatformerLevel>) {
  return (id: string): PlatformerLevel => {
    const level = levels.get(id);
    if (!level) throw new Error(`Niveau introuvable : ${id}`);
    return level;
  };
}

describe('PlatformerSession — vies et mort', () => {
  it('meurt, réapparaît, perd une vie puis passe en game-over sans vie restante', () => {
    // Aucun sol : le joueur tombe et meurt immédiatement (fall).
    const level = levelFromAscii(['....', '....', '....', '....'], { id: 'a' });
    const levels = new Map([['a', level]]);
    const system = makeSystem({ levels: ['a'], lives: 2 });
    const session = new PlatformerSession(system, makeLoader(levels));

    runUntilPhase(session, 'dying'); // tombe et meurt
    expect(session.phase).toBe('dying');
    expect(session.hud().lives).toBe(2); // pas encore décomptée

    runUntilPhase(session, 'playing'); // 1s (DYING_DURATION) puis réapparition
    expect(session.hud().lives).toBe(1);
    expect(session.world.dead).toBe(false);

    runUntilPhase(session, 'dying'); // meurt à nouveau (plus de sol après réapparition)
    runUntilPhase(session, 'game-over');
    expect(session.hud().lives).toBe(0);
  });
});

describe('PlatformerSession — niveaux', () => {
  it('atteint l’arrivée, passe au niveau suivant puis game-won en fin de liste', () => {
    const levels = twoLevels();
    const system = makeSystem({ levels: ['a', 'b'] });
    const session = new PlatformerSession(system, makeLoader(levels));

    run(session, 60, input({ right: true }));
    expect(session.phase).toBe('level-complete');
    expect(session.hud().score).toBeGreaterThanOrEqual(500);

    run(session, 91); // 1.5s (LEVEL_COMPLETE_DURATION)
    expect(session.phase).toBe('playing');
    expect(session.hud().level).toBe('b');
  });

  it('termine la partie (game-won) quand le dernier niveau est atteint', () => {
    const level = levelFromAscii(['....', '....', '....', '####'], {
      id: 'only',
      entities: [{ id: 'goal1', type: 'goal', x: 2, y: 2 }],
    });
    const levels = new Map([['only', level]]);
    const system = makeSystem({ levels: ['only'] });
    const session = new PlatformerSession(system, makeLoader(levels));

    run(session, 60, input({ right: true }));
    expect(session.phase).toBe('level-complete');
    run(session, 91);
    expect(session.phase).toBe('game-won');
  });

  it('startLevel() change de niveau explicitement et repart à `playing`', () => {
    const levels = twoLevels();
    const system = makeSystem({ levels: ['a', 'b'] });
    const session = new PlatformerSession(system, makeLoader(levels));
    session.startLevel('b');
    expect(session.phase).toBe('playing');
    expect(session.hud().level).toBe('b');
  });
});

describe('PlatformerSession — score et pièces', () => {
  it('marque des points pour les pièces et accorde une vie bonus', () => {
    const level = levelFromAscii(['.....', '.....', '.....', '#####'], {
      id: 'a',
      playerStart: { x: 0, y: 2 },
      entities: [
        { id: 'c1', type: 'coin', x: 1, y: 2 },
        { id: 'c2', type: 'coin', x: 3, y: 2 },
      ],
    });
    const levels = new Map([['a', level]]);
    const system = makeSystem({ levels: ['a'], lives: 1, coinsPerLife: 2, physics: { runSpeed: 200, acceleration: 100000 } });
    const session = new PlatformerSession(system, makeLoader(levels));

    run(session, 90, input({ right: true }));
    expect(session.hud().coins).toBe(2);
    expect(session.hud().score).toBe(20);
    expect(session.hud().lives).toBe(2); // vie bonus au bout de 2 pièces (coinsPerLife)
  });
});

describe('PlatformerSession — état (round-trip)', () => {
  it('state() est valide selon PlatformerStateSchema et permet de reprendre la partie', () => {
    const levels = twoLevels();
    const system = makeSystem({ levels: ['a', 'b'] });
    const session = new PlatformerSession(system, makeLoader(levels));
    run(session, 30, input({ right: true }));

    const state = session.state();
    expect(() => PlatformerStateSchema.parse(state)).not.toThrow();
    expect(state.level).toBe('a');

    const resumed = new PlatformerSession(system, makeLoader(levels), state);
    expect(resumed.hud().level).toBe('a');
    expect(resumed.hud().lives).toBe(state.lives);
    expect(resumed.hud().score).toBe(state.score);
    expect(resumed.hud().coins).toBe(state.coins);
  });

  it('reprend au point de contrôle enregistré', () => {
    const level = levelFromAscii(['.....', '.....', '.....', '#####'], {
      id: 'a',
      playerStart: { x: 0, y: 2 },
      entities: [{ id: 'cp1', type: 'checkpoint', x: 3, y: 2 }],
    });
    const levels = new Map([['a', level]]);
    const system = makeSystem({ levels: ['a'], physics: { runSpeed: 200, acceleration: 100000 } });
    const session = new PlatformerSession(system, makeLoader(levels));
    run(session, 60, input({ right: true }));
    const state = session.state();
    expect(state.checkpoint).toBe('cp1');

    const resumed = new PlatformerSession(system, makeLoader(levels), state);
    expect(resumed.world.activeCheckpoint()).toBe('cp1');
    // Le joueur réapparaît près du checkpoint, pas au départ du niveau (x=0).
    expect(resumed.world.player().x).toBeGreaterThan(20);
  });
});
