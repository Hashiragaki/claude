import type { GameRuntime, RuntimeContext } from '@forge/core';
import { autoBattle } from './battle';
import { RpgSession } from './session';
import { NO_INPUT, type WorldInput, type WorldRequest } from './world';

/**
 * Runtime sans affichage (contexte sans `mount` : tests, serveur). Les messages avancent avec
 * `confirm`, les choix se naviguent avec haut/bas, les combats sont joués automatiquement.
 */
export class HeadlessRpgRuntime implements GameRuntime {
  readonly session: RpgSession;
  private choiceIndex = 0;
  private ended = false;

  constructor(private readonly ctx: RuntimeContext) {
    this.session = new RpgSession(ctx);
  }

  async start(): Promise<void> {
    await this.session.load();
    this.session.newGame();
    this.ctx.log('info', 'RPG lancé sans affichage.');
  }

  update(dt: number): void {
    const world = this.session.world;
    if (!world || this.ended) return;
    const request = world.request;
    if (request) {
      this.handle(request);
      world.update(dt, NO_INPUT);
      return;
    }
    const { input } = this.ctx;
    const worldInput: WorldInput = {
      direction: input.direction(),
      action: input.justPressed('confirm'),
      dash: input.isDown('dash'),
    };
    world.update(dt, worldInput);
  }

  private handle(request: WorldRequest): void {
    const { input } = this.ctx;
    const world = this.session.world;
    if (!world) return;
    switch (request.kind) {
      case 'message':
        if (input.justPressed('confirm')) {
          input.consume('confirm');
          world.resume();
        }
        break;
      case 'choice': {
        const n = request.options.length;
        if (input.justPressed('up')) this.choiceIndex = (this.choiceIndex + n - 1) % n;
        if (input.justPressed('down')) this.choiceIndex = (this.choiceIndex + 1) % n;
        if (input.justPressed('confirm')) {
          input.consume('confirm');
          const index = this.choiceIndex;
          this.choiceIndex = 0;
          world.resume(index);
        } else if (request.cancelIndex !== null && input.justPressed('cancel')) {
          this.choiceIndex = 0;
          world.resume(-1);
        }
        break;
      }
      case 'teleport':
        world.resume();
        break;
      case 'battle':
        try {
          const { result } = autoBattle(this.session.createBattle(request));
          this.session.finishBattle(request, result);
        } catch (error) {
          this.ctx.log('error', error instanceof Error ? error.message : String(error));
          this.session.finishBattle(request, 'escape');
        }
        break;
      case 'gameOver':
        this.ended = true;
        this.ctx.events.emit('game-end', { reason: 'gameover' });
        break;
      case 'returnToTitle':
        this.session.newGame();
        break;
    }
  }

  destroy(): void {
    this.session.dispose();
  }

  serialize(): unknown {
    return this.session.serialize();
  }

  deserialize(state: unknown): void {
    this.ended = false;
    this.session.deserialize(state);
  }

  getDebugState(): Record<string, unknown> {
    return this.session.getDebugState();
  }

  setDebugValue(path: string, value: unknown): void {
    this.session.setDebugValue(path, value);
  }
}
