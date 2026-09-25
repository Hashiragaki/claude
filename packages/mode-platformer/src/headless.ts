import type { GameRuntime, RuntimeContext } from '@forge/core';
import { loadPlatformerProject } from './loader';
import { PlatformerStateSchema, type PlatformerLevel, type PlatformerSystem } from './schema';
import { PlatformerSession } from './session';
import type { PlatformerInput } from './types';

/**
 * Runtime sans affichage (contexte sans `mount` : tests, serveur). Lit les entrées directionnelles
 * et « confirm »/« haut » pour le saut (comme le clavier par défaut : Entrée/Espace/E ou flèche
 * haut) ; « bas » permet de traverser une plateforme `oneway` en sautant en même temps.
 */
export class HeadlessPlatformerRuntime implements GameRuntime {
  private system: PlatformerSystem | null = null;
  private levels = new Map<string, PlatformerLevel>();
  private session: PlatformerSession | null = null;

  constructor(private readonly ctx: RuntimeContext) {}

  private makeLoadLevel(): (id: string) => PlatformerLevel {
    return (id: string): PlatformerLevel => {
      const level = this.levels.get(id);
      if (!level) throw new Error(`Niveau inconnu : « ${id} ».`);
      return level;
    };
  }

  async start(): Promise<void> {
    const { system, levels } = await loadPlatformerProject(this.ctx.bundle);
    this.system = system;
    this.levels = levels;
    this.session = new PlatformerSession(system, this.makeLoadLevel());

    const startLevel = this.ctx.options.startLevel;
    if (startLevel && startLevel !== this.session.hud().level) {
      if (this.levels.has(startLevel)) this.session.startLevel(startLevel);
      else this.ctx.log('warn', `Niveau de départ demandé introuvable : « ${startLevel} ».`);
    }
    this.ctx.log('info', 'Plateformer lancé sans affichage.');
  }

  update(dt: number): void {
    const session = this.session;
    if (!session) return;
    if (session.phase === 'game-over' || session.phase === 'game-won') {
      this.ctx.events.emit('game-end', { reason: session.phase === 'game-over' ? 'gameover' : 'end' });
      return;
    }
    const { input } = this.ctx;
    const worldInput: PlatformerInput = {
      left: input.isDown('left'),
      right: input.isDown('right'),
      jumpHeld: input.isDown('confirm') || input.isDown('up'),
      jumpPressed: input.justPressed('confirm') || input.justPressed('up'),
      down: input.isDown('down'),
    };
    session.step(dt, worldInput);
    this.ctx.events.emit('state-changed', { reason: 'step' });
  }

  destroy(): void {
    this.session = null;
  }

  serialize(): unknown {
    return this.session?.state() ?? null;
  }

  deserialize(state: unknown): void {
    if (!this.system) throw new Error('Partie plateformer non démarrée (appeler start() d’abord).');
    const parsed = PlatformerStateSchema.parse(state);
    this.session = new PlatformerSession(this.system, this.makeLoadLevel(), parsed);
  }

  getDebugState(): Record<string, unknown> {
    const session = this.session;
    if (!session) return {};
    return {
      phase: session.phase,
      hud: session.hud(),
      player: session.world.player(),
      entities: session.world.entities(),
    };
  }
}
