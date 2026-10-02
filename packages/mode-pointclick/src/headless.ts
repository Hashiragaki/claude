import type { GameRuntime, RuntimeContext } from '@forge/core';
import { loadPointClickProject } from './loader';
import { PointClickStateSchema } from './schema';
import { PointClickSession } from './session';

/**
 * Runtime sans affichage (contexte sans `mount` : tests, serveur). Fait avancer la session ; la
 * touche « confirm » passe les bulles de texte. Les clics sont à envoyer directement à la session
 * (non exposée) : ce runtime sert surtout à charger, valider et sérialiser un jeu.
 */
export class HeadlessPointClickRuntime implements GameRuntime {
  private session: PointClickSession | null = null;
  private ended = false;

  constructor(private readonly ctx: RuntimeContext) {}

  async start(): Promise<void> {
    const data = await loadPointClickProject(this.ctx.bundle);
    this.session = new PointClickSession(data, { log: (level, message) => this.ctx.log(level, message) });
    this.session.start();
    this.ended = false;
    this.ctx.log('info', 'Point & click lancé sans affichage.');
  }

  update(dt: number): void {
    const session = this.session;
    if (!session) return;
    if (this.ctx.input.justPressed('confirm') && session.view().phase === 'message') session.advance();
    session.update(dt);
    session.drainEvents();
    this.ctx.events.emit('state-changed', { reason: 'step' });
    if (!this.ended && session.view().phase === 'ended') {
      this.ended = true;
      this.ctx.events.emit('game-end', { reason: 'end' });
    }
  }

  destroy(): void {
    this.session = null;
  }

  serialize(): unknown {
    return this.session?.serialize() ?? null;
  }

  deserialize(state: unknown): void {
    if (!this.session) throw new Error('Partie point & click non démarrée (appeler start() d’abord).');
    this.session.restore(PointClickStateSchema.parse(state));
    this.ended = false;
  }

  getDebugState(): Record<string, unknown> {
    return this.session?.debugState() ?? {};
  }
}
