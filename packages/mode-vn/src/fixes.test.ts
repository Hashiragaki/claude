import { describe, expect, it } from 'vitest';
import type { Container } from 'pixi.js';
import type { RuntimeContext } from '@forge/core';
import { VNRuntime } from './runtime';

/** Vue Pixi minimale suffisante pour vérifier qu'elle est bien détruite. */
function fakeView(): Container {
  const view = {
    destroyed: false,
    destroy(_opts?: unknown) {
      view.destroyed = true;
    },
  };
  return view as unknown as Container;
}

/** Contexte minimal permettant de construire un VNRuntime sans monter Pixi (mount: null). */
function fakeContext(): RuntimeContext {
  return {
    audio: { stopAll: () => {} } as unknown as RuntimeContext['audio'],
    mount: null,
  } as unknown as RuntimeContext;
}

describe('VNRuntime.destroy', () => {
  it('détruit les vues encore en attente dans la corbeille au lieu de les abandonner', () => {
    const runtime = new VNRuntime(fakeContext());
    const trashed = fakeView();
    // Simule removeOverlay() qui a détaché la vue et l'a mise en corbeille juste avant destroy(),
    // sans qu'update() n'ait eu l'occasion de vider la corbeille entretemps.
    (runtime as unknown as { trash: Container[] }).trash.push(trashed);

    runtime.destroy();

    expect(trashed.destroyed).toBe(true);
  });
});

describe('menu sans choix disponible', () => {
  it("est ignoré (avec un avertissement) au lieu de bloquer le jeu", async () => {
    const { compileSource } = await import('./compiler');
    const { VNInterpreter } = await import('./interpreter');
    const { program } = compileSource(
      [
        'default points = 0',
        'label start:',
        '    menu:',
        '        "Café" if points > 5:',
        '            "Café choisi."',
        '    "Après le menu."',
      ].join('\n'),
    );
    const warnings: string[] = [];
    const interp = new VNInterpreter(program, { log: (level, message) => level === 'warn' && warnings.push(message) });
    const step = interp.start();
    expect(step.kind).toBe('say');
    expect(step.kind === 'say' && step.text).toBe('Après le menu.');
    expect(warnings.join()).toMatch(/aucun choix disponible/);
  });
});
