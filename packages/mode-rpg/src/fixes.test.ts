import { describe, expect, it } from 'vitest';
import { frames, grassMap, makeWorld } from './test-helpers';

describe('RpgWorld — corrections ciblées', () => {
  it("poursuit le script d'un événement parallèle après sa propre téléportation", () => {
    // Carte « a » : un événement en déclencheur parallèle qui se téléporte puis positionne
    // un interrupteur. Avant correction, `RpgWorld.resume()` téléportait (ce qui arrêtait et
    // vidait tous les interpréteurs parallèles, y compris celui qui est le demandeur) AVANT de
    // reprendre l'interpréteur propriétaire de la demande : les commandes après `teleport`
    // étaient donc silencieusement perdues.
    const a = grassMap('a')
      .event({
        id: 'porte_para',
        x: 0,
        y: 0,
        pages: [
          {
            trigger: 'parallel',
            priority: 'below',
            commands: [
              { type: 'teleport', map: 'b', x: 3, y: 3 },
              { type: 'setSwitch', name: 'after_teleport' },
            ],
          },
        ],
      })
      .build();
    const b = grassMap('b').build();
    const world = makeWorld([a, b]);

    frames(world, 1);
    expect(world.request).toEqual({ kind: 'teleport', map: 'b', x: 3, y: 3 });
    world.resume();

    expect(world.map.id).toBe('b');
    expect(world.state.switches.after_teleport).toBe(true);
  });

  it('va au bout du script parallèle même avec une attente après la téléportation', () => {
    const a = grassMap('a')
      .event({
        id: 'porte_para',
        x: 0,
        y: 0,
        pages: [
          {
            trigger: 'parallel',
            priority: 'below',
            commands: [
              { type: 'teleport', map: 'b', x: 3, y: 3 },
              { type: 'wait', seconds: 0.2 },
              { type: 'setSwitch', name: 'after_wait' },
            ],
          },
        ],
      })
      .build();
    const world = makeWorld([a, grassMap('b').build()]);

    frames(world, 1);
    world.resume();
    expect(world.map.id).toBe('b');
    expect(world.state.switches.after_wait).toBeUndefined();
    frames(world, 30);
    expect(world.state.switches.after_wait).toBe(true);
  });
});
