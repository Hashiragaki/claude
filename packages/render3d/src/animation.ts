import {
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
} from 'three';

export interface PlayAnimationOptions {
  /** Joue en boucle (par défaut) ou une seule fois, en gardant la dernière pose. */
  loop?: boolean;
  /** Durée du fondu enchaîné avec l'animation précédente (0,25 s par défaut). */
  fadeSeconds?: number;
  /** Vitesse de lecture (1 = normale). */
  timeScale?: number;
  /** Place directement l'animation à sa fin (ex. coffre déjà ouvert au chargement d'une partie). */
  atEnd?: boolean;
  /** Animation (en boucle) reprise automatiquement à la fin d'une animation jouée une fois. */
  then?: string;
}

/**
 * Enveloppe d'`AnimationMixer` : lecture par nom avec fondus enchaînés, enchaînement automatique
 * après une animation non bouclée.
 */
export class AnimationController {
  readonly mixer: AnimationMixer;
  private readonly clips = new Map<string, AnimationClip>();
  private currentAction: AnimationAction | null = null;
  private currentName: string | null = null;
  private pendingThen: { action: AnimationAction; name: string; fade: number } | null = null;

  constructor(
    readonly root: Object3D,
    clips: readonly AnimationClip[],
  ) {
    this.mixer = new AnimationMixer(root);
    for (const clip of clips) this.clips.set(clip.name, clip);
    this.mixer.addEventListener('finished', (event) => {
      const pending = this.pendingThen;
      if (!pending || event.action !== pending.action) return;
      this.pendingThen = null;
      this.play(pending.name, { loop: true, fadeSeconds: pending.fade });
    });
  }

  /** Noms des animations disponibles. */
  get names(): string[] {
    return [...this.clips.keys()];
  }

  /** Animation en cours (ou `null`). */
  get current(): string | null {
    return this.currentName;
  }

  has(name: string): boolean {
    return this.clips.has(name);
  }

  /**
   * Joue l'animation `name`. Retourne `false` si elle n'existe pas (rien ne change alors).
   * Rejouer l'animation bouclée en cours ne la redémarre pas (seule la vitesse est mise à jour).
   */
  play(name: string, options: PlayAnimationOptions = {}): boolean {
    const clip = this.clips.get(name);
    if (!clip) return false;
    const loop = options.loop ?? true;
    const fade = Math.max(0, options.fadeSeconds ?? 0.25);
    const timeScale = options.timeScale ?? 1;
    const action = this.mixer.clipAction(clip);

    if (action === this.currentAction && loop && action.loop === LoopRepeat && action.isRunning()) {
      action.setEffectiveTimeScale(timeScale);
      return true;
    }

    const previous = this.currentAction;
    action.reset();
    action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.setEffectiveTimeScale(timeScale);
    action.setEffectiveWeight(1);
    if (options.atEnd) action.time = clip.duration;
    action.play();

    if (previous && previous !== action) {
      if (fade > 0 && !options.atEnd) previous.crossFadeTo(action, fade, false);
      else previous.stop();
    }

    this.currentAction = action;
    this.currentName = name;
    this.pendingThen =
      !loop && options.then && options.then !== name && this.clips.has(options.then)
        ? { action, name: options.then, fade }
        : null;
    if (options.atEnd) this.mixer.update(0);
    return true;
  }

  /** Modifie la vitesse de l'animation en cours. */
  setTimeScale(timeScale: number): void {
    this.currentAction?.setEffectiveTimeScale(timeScale);
  }

  /** Arrête l'animation (retour à la pose de repos, avec fondu optionnel). */
  stop(fadeSeconds = 0): void {
    const action = this.currentAction;
    this.currentAction = null;
    this.currentName = null;
    this.pendingThen = null;
    if (!action) return;
    if (fadeSeconds > 0) action.fadeOut(fadeSeconds);
    else this.mixer.stopAllAction();
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const clip of this.clips.values()) this.mixer.uncacheClip(clip);
    this.mixer.uncacheRoot(this.root);
    this.pendingThen = null;
  }
}
