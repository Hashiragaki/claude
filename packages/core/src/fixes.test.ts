import { afterEach, describe, expect, it } from 'vitest';
import { AudioManager } from './audio';
import { Engine } from './engine';
import { ObjectScope, execute } from './expr';
import { InputManager } from './input';
import { ModeRegistry, type GameModeDefinition, type GameRuntime } from './mode';
import { MemoryProjectFiles, PROJECT_FORMAT, loadProjectBundle } from './project';
import { MemorySaveStorage } from './save';

// ---------------------------------------------------------------------------
// Faux objets DOM/WebAudio minimaux (environnement de test Node, sans DOM réel).
// ---------------------------------------------------------------------------

/** Élément DOM minimal, adossé à l'`EventTarget` global de Node. */
class FakeElement extends EventTarget {
  private readonly attrs = new Set<string>();
  tabIndex = -1;
  focusCalls = 0;
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  setAttribute(name: string): void {
    this.attrs.add(name);
  }
  focus(): void {
    this.focusCalls++;
  }
  /** Suffisant pour nos tests : pas d'imbrication réelle d'éléments enfants. */
  contains(other: EventTarget | null): boolean {
    return other === this;
  }
}

class FakeAudioParam {
  value = 0;
  setValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

class FakeGainNode {
  gain = new FakeAudioParam();
  connect(): this {
    return this;
  }
}

class FakeSourceNode {
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  connect(): this {
    return this;
  }
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

class FakeAudioContext {
  currentTime = 0;
  state: 'running' | 'suspended' | 'closed' = 'running';
  destination = {};
  createGain(): FakeGainNode {
    return new FakeGainNode();
  }
  createBufferSource(): FakeSourceNode {
    return new FakeSourceNode();
  }
  decodeAudioData(): Promise<unknown> {
    return Promise.resolve({});
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
}

function withFakeAudioContext<T>(run: () => T): T {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  try {
    return run();
  } finally {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
  }
}

async function makeCounterBundle() {
  const files = new MemoryProjectFiles({
    'project.json': {
      format: PROJECT_FORMAT,
      id: 'p1',
      name: 'Test',
      mode: 'counter',
      entry: 'data.json',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    'data.json': { start: 0 },
  });
  return loadProjectBundle(files);
}

// ---------------------------------------------------------------------------
// engine.ts — Engine.start() après un destroy() concurrent
// ---------------------------------------------------------------------------

describe('Engine.start()/destroy() concurrents', () => {
  it('détruit le runtime créé après un destroy() survenu pendant createRuntime()', async () => {
    const bundle = await makeCounterBundle();
    let resolveCreate!: (rt: GameRuntime) => void;
    const createPromise = new Promise<GameRuntime>((resolve) => {
      resolveCreate = resolve;
    });
    let destroyCalls = 0;
    let runtimeStarted = false;
    const mode: GameModeDefinition = {
      id: 'counter',
      name: 'Compteur',
      description: 'test',
      templates: [],
      createRuntime: () => createPromise,
    };
    const engine = new Engine({
      bundle,
      modes: new ModeRegistry([mode]),
      autoLoop: false,
      saveStorage: new MemorySaveStorage(),
    });

    const startPromise = engine.start();
    // Cleanup (Relancer/Arrêter) déclenché pendant que start() attend encore createRuntime().
    engine.destroy();
    resolveCreate({
      async start() {
        runtimeStarted = true;
      },
      update() {},
      destroy() {
        destroyCalls++;
      },
      serialize: () => ({}),
      deserialize: () => {},
    });
    await startPromise;

    expect(destroyCalls).toBe(1);
    expect(runtimeStarted).toBe(false);
    expect(engine.runtime).toBeNull();
    expect(engine.loop.running).toBe(false);
  });

  it('ne démarre pas la boucle si destroy() survient pendant runtime.start()', async () => {
    const bundle = await makeCounterBundle();
    let resolveRuntimeStart!: () => void;
    let resolveStartCalled!: () => void;
    const startCalled = new Promise<void>((r) => (resolveStartCalled = r));
    let destroyCalls = 0;
    const mode: GameModeDefinition = {
      id: 'counter',
      name: 'Compteur',
      description: 'test',
      templates: [],
      createRuntime: () => ({
        start: () => {
          // Signale précisément le moment où le moteur est entré dans `runtime.start()`,
          // pour détruire à cet instant sans dépendre du nombre de ticks de microtâches.
          resolveStartCalled();
          return new Promise<void>((resolve) => (resolveRuntimeStart = resolve));
        },
        update() {},
        destroy() {
          destroyCalls++;
        },
        serialize: () => ({}),
        deserialize: () => {},
      }),
    };
    const engine = new Engine({
      bundle,
      modes: new ModeRegistry([mode]),
      autoLoop: true,
      saveStorage: new MemorySaveStorage(),
    });

    const startPromise = engine.start();
    await startCalled;
    engine.destroy();
    resolveRuntimeStart();
    await startPromise;

    expect(destroyCalls).toBe(1);
    expect(engine.loop.running).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// engine.ts — écouteurs de déverrouillage audio / focus jamais détachés
// ---------------------------------------------------------------------------

describe('Engine.destroy() détache les écouteurs posés par start()', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("un pointerdown sur le mount après destroy() ne réarme plus l'unlock audio ni le focus", async () => {
    const bundle = await makeCounterBundle();
    const mode: GameModeDefinition = {
      id: 'counter',
      name: 'Compteur',
      description: 'test',
      templates: [],
      createRuntime: () => ({
        async start() {},
        update() {},
        destroy() {},
        serialize: () => ({}),
        deserialize: () => {},
      }),
    };
    const mount = new FakeElement();
    (globalThis as unknown as { window: unknown }).window = {};

    const engine = new Engine({
      bundle,
      modes: new ModeRegistry([mode]),
      autoLoop: false,
      saveStorage: new MemorySaveStorage(),
      mount: mount as unknown as HTMLElement,
    });
    await engine.start();
    engine.destroy();

    let unlockCalls = 0;
    (engine.audio as unknown as { unlock: () => Promise<void> }).unlock = () => {
      unlockCalls++;
      return Promise.resolve();
    };

    // Sur l'ancien code, ceci réarmait audio.unlock() (AudioManager disposé) et refocalisait
    // un mount réutilisé par une session de jeu suivante.
    mount.dispatchEvent(new Event('pointerdown'));

    expect(unlockCalls).toBe(0);
    expect(mount.focusCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// audio.ts — AudioManager inerte après dispose()
// ---------------------------------------------------------------------------

describe('AudioManager après dispose()', () => {
  it('unlock()/context() ne recréent plus de AudioContext après dispose()', async () => {
    let created = 0;
    class CountingAudioContext extends FakeAudioContext {
      constructor() {
        super();
        created++;
      }
    }
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = CountingAudioContext;
    try {
      const audio = new AudioManager();
      await audio.unlock();
      expect(created).toBe(1);
      await audio.dispose();
      await audio.unlock();
      expect(created).toBe(1);
    } finally {
      delete (globalThis as { AudioContext?: unknown }).AudioContext;
    }
  });
});

// ---------------------------------------------------------------------------
// audio.ts — race playBgm/stopBgm/playVoice pendant un chargement
// ---------------------------------------------------------------------------

function stubLoad(audio: AudioManager) {
  const pending = new Map<string, { resolve: (b: unknown) => void }>();
  (audio as unknown as { load: (url: string) => Promise<unknown> }).load = (url: string) =>
    new Promise((resolve) => pending.set(url, { resolve }));
  return pending;
}

describe('AudioManager — race pendant le chargement', () => {
  it('un chargement de BGM périmé ne remplace pas la piste démarrée après lui', async () => {
    await withFakeAudioContext(async () => {
      const audio = new AudioManager();
      const pending = stubLoad(audio);

      const playA = audio.playBgm('a.mp3');
      const playB = audio.playBgm('b.mp3');

      pending.get('b.mp3')!.resolve({});
      await playB;
      expect(audio.currentBgm).toBe('b.mp3');

      pending.get('a.mp3')!.resolve({});
      await playA;

      // Le chargement tardif de « a » ne doit pas avoir écrasé « b ».
      expect(audio.currentBgm).toBe('b.mp3');
    });
  });

  it('un stopBgm reçu pendant le chargement empêche la piste de démarrer', async () => {
    await withFakeAudioContext(async () => {
      const audio = new AudioManager();
      const pending = stubLoad(audio);

      const playTitle = audio.playBgm('title.mp3');
      // Le joueur quitte l'écran titre avant la fin du chargement (ex. « Nouvelle partie »).
      audio.stopBgm(0);
      pending.get('title.mp3')!.resolve({});
      await playTitle;

      expect(audio.currentBgm).toBeNull();
    });
  });

  it('un chargement de voix périmé ne remplace pas la voix démarrée après lui', async () => {
    await withFakeAudioContext(async () => {
      const audio = new AudioManager();
      const pending = stubLoad(audio);

      const playA = audio.playVoice('line-a.mp3');
      const playB = audio.playVoice('line-b.mp3');

      const bufferB = { id: 'b' };
      pending.get('line-b.mp3')!.resolve(bufferB);
      await playB;

      pending.get('line-a.mp3')!.resolve({ id: 'a' });
      await playA;

      const voice = (audio as unknown as { voice: { buffer: unknown } | null }).voice;
      expect(voice?.buffer).toBe(bufferB);
    });
  });
});

// ---------------------------------------------------------------------------
// input.ts — focusout depuis un enfant focusable / autorepeat après reprise
// ---------------------------------------------------------------------------

describe('InputManager.attach() — focusout et autorepeat', () => {
  it('un focusout vers un enfant du mount ne relâche pas les touches maintenues', () => {
    const mount = new FakeElement();
    const canvas = new FakeElement();
    // Simule l'appartenance du canvas au mount pour `contains`.
    (mount as unknown as { contains: (o: EventTarget) => boolean }).contains = (o) => o === mount || o === canvas;

    const input = new InputManager();
    input.attach(mount as unknown as HTMLElement, mount as unknown as HTMLElement);

    const keydown = new Event('keydown') as unknown as { code: string; repeat: boolean; preventDefault(): void };
    Object.assign(keydown, { code: 'KeyW', repeat: false, preventDefault() {} });
    mount.dispatchEvent(keydown as unknown as Event);
    input.update();
    expect(input.isDown('up')).toBe(true);

    // Le clic donne le focus au canvas interne au mount (comme engine.ts le fait) : focusout
    // bulle depuis le canvas jusqu'au mount, avec relatedTarget = canvas.
    const focusout = new Event('focusout') as unknown as { relatedTarget: EventTarget };
    Object.assign(focusout, { relatedTarget: canvas });
    mount.dispatchEvent(focusout as unknown as Event);

    input.update();
    expect(input.isDown('up')).toBe(true);
  });

  it('un focusout hors du mount relâche bien les touches maintenues', () => {
    const mount = new FakeElement();
    const elsewhere = new FakeElement();
    const input = new InputManager();
    input.attach(mount as unknown as HTMLElement, mount as unknown as HTMLElement);

    const keydown = new Event('keydown') as unknown as { code: string; repeat: boolean; preventDefault(): void };
    Object.assign(keydown, { code: 'KeyW', repeat: false, preventDefault() {} });
    mount.dispatchEvent(keydown as unknown as Event);
    input.update();
    expect(input.isDown('up')).toBe(true);

    const focusout = new Event('focusout') as unknown as { relatedTarget: EventTarget | null };
    Object.assign(focusout, { relatedTarget: elsewhere });
    mount.dispatchEvent(focusout as unknown as Event);

    input.update();
    expect(input.isDown('up')).toBe(false);
  });

  it("l'autorepeat restaure une touche effacée par un focusout intervenu entre deux keydown", () => {
    const mount = new FakeElement();
    const input = new InputManager();
    input.attach(mount as unknown as HTMLElement, mount as unknown as HTMLElement);

    const press = (repeat: boolean) => {
      const ev = new Event('keydown') as unknown as { code: string; repeat: boolean; preventDefault(): void };
      Object.assign(ev, { code: 'KeyW', repeat, preventDefault() {} });
      mount.dispatchEvent(ev as unknown as Event);
    };

    press(false);
    input.update();
    expect(input.isDown('up')).toBe(true);

    // downKeys se retrouve vidé (ex. focusout non filtré ailleurs, ou tout autre blur réel).
    const focusout = new Event('focusout') as unknown as { relatedTarget: EventTarget | null };
    Object.assign(focusout, { relatedTarget: null });
    mount.dispatchEvent(focusout as unknown as Event);
    input.update();
    expect(input.isDown('up')).toBe(false);

    // La touche est toujours physiquement maintenue : le navigateur envoie des keydown en
    // autorepeat (repeat=true), qui doivent réarmer downKeys même sans redéclencher l'action.
    press(true);
    input.update();
    expect(input.isDown('up')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// expr.ts — double évaluation de la cible d'une affectation composée
// ---------------------------------------------------------------------------

describe('execute() — affectation composée sur une cible à effet de bord', () => {
  it("n'évalue l'index qu'une seule fois (lit et écrit la même clé)", () => {
    const s = new ObjectScope({ stats: { str: 5, dex: 10 } });
    let calls = 0;
    // Reproduit `stats[choice(["str", "dex"])] += 1` de façon déterministe : deux évaluations
    // renverraient deux clés différentes, comme le ferait un `choice()` aléatoire.
    const pickKey = () => {
      calls++;
      return calls === 1 ? 'str' : 'dex';
    };
    execute('stats[pickKey()] += 1', s, { functions: { pickKey } });

    expect(calls).toBe(1);
    expect(s.vars).toEqual({ stats: { str: 6, dex: 10 } });
  });

  it("n'évalue l'objet qu'une seule fois pour une propriété (target().hp += 1)", () => {
    const player = { hp: 10 };
    const enemy = { hp: 20 };
    let calls = 0;
    const target = () => {
      calls++;
      return calls === 1 ? player : enemy;
    };
    const s = new ObjectScope();
    execute('target().hp += 1', s, { functions: { target } });

    expect(calls).toBe(1);
    expect(player.hp).toBe(11);
    expect(enemy.hp).toBe(20);
  });
});
