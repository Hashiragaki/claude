import type { Fader, Tweens, UiTheme } from '@forge/render2d';
import { Container, Graphics, Sprite } from 'pixi.js';
import { builtinImageColor, positionX } from '../constants';
import type { VisualEffect } from '../presenter';
import type { SceneState, ShownImage } from '../types';
import type { ImageLoader } from './images';
import { createPlaceholder, fadeTo } from './widgets';

const DISSOLVE = 0.5;
const MOVE = 0.6;
const FADE = 0.4;
const SHAKE = 0.4;

type Prepared =
  | { type: 'scene'; view: Container | null }
  | { type: 'show'; image: ShownImage; view: Container }
  | { type: 'hide'; tag: string };

type CommitMode = 'none' | 'dissolve' | 'moveinleft' | 'moveinright';

export interface SceneViewOptions {
  width: number;
  height: number;
  theme: UiTheme;
  tweens: Tweens;
  fader: Fader;
  images: ImageLoader;
}

/** Décor et personnages, avec les transitions du langage (`fade`, `dissolve`, `moveinleft`…). */
export class SceneView extends Container {
  private readonly bgLayer = new Container();
  private readonly charLayer = new Container();
  private background: Container | null = null;
  private readonly shown = new Map<string, { image: ShownImage; view: Container }>();
  /** Incrémenté à chaque remise à zéro : les transitions en cours deviennent obsolètes. */
  private generation = 0;
  private hurried = false;
  private shake: { axis: 'x' | 'y'; time: number; resolve: () => void } | null = null;

  constructor(private readonly o: SceneViewOptions) {
    super();
    this.addChild(this.bgLayer, this.charLayer);
  }

  /** Début d'une nouvelle séquence d'effets (annule l'accélération précédente). */
  beginSequence(): void {
    this.hurried = false;
  }

  /** Applique un groupe de changements avec une transition (attend la fin de l'animation). */
  async transition(effects: VisualEffect[], transition: string | null, instant: boolean): Promise<void> {
    const kind = instant || this.hurried ? 'none' : (transition ?? 'none');
    if (effects.length === 0) {
      if (kind === 'vpunch' || kind === 'hpunch') await this.startShake(kind === 'vpunch' ? 'y' : 'x');
      else if (kind === 'fade') await this.fadeThrough(() => undefined);
      return;
    }
    const gen = this.generation;
    const prepared = await Promise.all(effects.map((e) => this.prepare(e)));
    if (gen !== this.generation || this.destroyed) return this.discard(prepared);
    if (kind === 'fade') {
      await this.fadeThrough(() => {
        if (gen === this.generation) void this.commit(prepared, 'none');
        else this.discard(prepared);
      });
      return;
    }
    const mode: CommitMode = kind === 'dissolve' || kind === 'moveinleft' || kind === 'moveinright' ? kind : 'none';
    await this.commit(prepared, mode);
    if (kind === 'vpunch' || kind === 'hpunch') await this.startShake(kind === 'vpunch' ? 'y' : 'x');
  }

  /** Reconstruit la scène d'un coup (chargement, retour arrière). */
  async rebuild(scene: SceneState): Promise<void> {
    this.clear();
    const gen = this.generation;
    const background = scene.background === null ? null : await this.buildBackground(scene.background);
    const characters = await Promise.all(
      scene.images.map(async (image) => ({ image, view: await this.buildCharacter(image) })),
    );
    if (gen !== this.generation || this.destroyed) {
      if (background) this.dispose(background);
      for (const c of characters) this.dispose(c.view);
      return;
    }
    if (background) {
      this.background = background;
      this.bgLayer.addChild(background);
    }
    for (const c of characters) {
      c.view.x = positionX(c.image.position) * this.o.width;
      this.charLayer.addChild(c.view);
      this.shown.set(c.image.tag, c);
    }
  }

  /** Vide la scène et interrompt les transitions en cours. */
  clear(): void {
    this.generation++;
    this.o.tweens.finishAll();
    void fadeTo(this.o.fader, 0, 0);
    this.stopShake();
    for (const child of [...this.bgLayer.children, ...this.charLayer.children]) this.dispose(child as Container);
    this.background = null;
    this.shown.clear();
  }

  /** Termine immédiatement les animations en cours et celles de la séquence. */
  hurry(): void {
    this.hurried = true;
    this.o.tweens.finishAll();
    this.o.fader.update(1000);
    this.stopShake();
  }

  update(dt: number): void {
    const s = this.shake;
    if (!s) return;
    s.time += dt;
    if (s.time >= SHAKE) {
      this.stopShake();
      return;
    }
    const offset = Math.sin(s.time * 60) * 14 * (1 - s.time / SHAKE);
    if (s.axis === 'x') this.x = offset;
    else this.y = offset;
  }

  // -------------------------------------------------------------------------

  private d(seconds: number): number {
    return this.hurried ? 0 : seconds;
  }

  private async fadeThrough(middle: () => void): Promise<void> {
    await fadeTo(this.o.fader, 1, this.d(FADE));
    middle();
    await fadeTo(this.o.fader, 0, this.d(FADE));
  }

  private async prepare(effect: VisualEffect): Promise<Prepared> {
    if (effect.type === 'hide') return { type: 'hide', tag: effect.tag };
    if (effect.type === 'scene') {
      return { type: 'scene', view: effect.background === null ? null : await this.buildBackground(effect.background) };
    }
    return { type: 'show', image: effect.image, view: await this.buildCharacter(effect.image) };
  }

  private discard(prepared: Prepared[]): void {
    for (const p of prepared) if (p.type !== 'hide' && p.view) this.dispose(p.view);
  }

  private commit(prepared: Prepared[], mode: CommitMode): Promise<void> {
    const { tweens, width } = this.o;
    const dissolve = mode === 'dissolve';
    const anims: Promise<unknown>[] = [];
    const appear = (view: Container) => {
      if (!dissolve) return;
      view.alpha = 0;
      anims.push(tweens.to(view, { alpha: 1 }, DISSOLVE));
    };
    const vanish = (view: Container) => {
      if (!dissolve) return this.dispose(view);
      anims.push(tweens.to(view, { alpha: 0 }, DISSOLVE).then(() => this.dispose(view)));
    };
    for (const p of prepared) {
      if (p.type === 'scene') {
        for (const s of this.shown.values()) vanish(s.view);
        this.shown.clear();
        const old = this.background;
        this.background = p.view;
        if (p.view) {
          this.bgLayer.addChild(p.view);
          appear(p.view);
        }
        // Le nouveau décor apparaît par-dessus l'ancien, retiré ensuite.
        if (old && dissolve && p.view) anims.push(tweens.wait(DISSOLVE).then(() => this.dispose(old)));
        else if (old) vanish(old);
      } else if (p.type === 'hide') {
        const s = this.shown.get(p.tag);
        if (s) {
          this.shown.delete(p.tag);
          vanish(s.view);
        }
      } else {
        const x = positionX(p.image.position) * width;
        const current = this.shown.get(p.image.tag);
        if (current && current.image.ref === p.image.ref) {
          // Même image : simple déplacement éventuel.
          this.dispose(p.view);
          current.image = p.image;
          if (mode !== 'none' && current.view.x !== x) anims.push(tweens.to(current.view, { x }, MOVE));
          else current.view.x = x;
          continue;
        }
        p.view.x = x;
        if (current) {
          this.charLayer.addChildAt(p.view, this.charLayer.getChildIndex(current.view) + 1);
          vanish(current.view);
        } else {
          this.charLayer.addChild(p.view);
        }
        this.shown.set(p.image.tag, { image: p.image, view: p.view });
        if (!current && (mode === 'moveinleft' || mode === 'moveinright')) {
          p.view.x = mode === 'moveinleft' ? -p.view.width / 2 : width + p.view.width / 2;
          anims.push(tweens.to(p.view, { x }, MOVE, { easing: 'easeOutCubic' }));
        } else {
          appear(p.view);
        }
      }
    }
    return Promise.all(anims).then(() => undefined);
  }

  private async buildBackground(ref: string): Promise<Container> {
    const { width, height, theme } = this.o;
    const texture = await this.o.images.load(ref);
    const builtin = builtinImageColor(ref);
    if (!texture && builtin !== null) {
      const solid = new Container();
      solid.addChild(new Graphics().rect(0, 0, width, height).fill(builtin));
      return solid;
    }
    if (!texture) return createPlaceholder(ref, width, height, theme, 0);
    const box = new Container();
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.position.set(width / 2, height / 2);
    sprite.scale.set(Math.max(width / texture.width, height / texture.height));
    box.addChild(sprite);
    return box;
  }

  /** Personnage ancré en bas au centre, au plus 95 % de la hauteur de l'écran. */
  private async buildCharacter(image: ShownImage): Promise<Container> {
    const { width, height, theme } = this.o;
    const texture = await this.o.images.load(image.ref);
    const box = new Container();
    box.y = height;
    if (texture) {
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5, 1);
      sprite.scale.set(Math.min(1, (height * 0.95) / texture.height));
      box.addChild(sprite);
    } else {
      const w = Math.round(width * 0.24);
      const h = Math.round(height * 0.78);
      const placeholder = createPlaceholder([image.tag, ...image.attrs].join(' '), w, h, theme);
      placeholder.position.set(-w / 2, -h);
      box.addChild(placeholder);
    }
    return box;
  }

  private dispose(view: Container): void {
    this.o.tweens.cancel(view);
    if (!view.destroyed) view.destroy({ children: true });
  }

  private startShake(axis: 'x' | 'y'): Promise<void> {
    this.stopShake();
    if (this.hurried) return Promise.resolve();
    return new Promise((resolve) => {
      this.shake = { axis, time: 0, resolve };
    });
  }

  private stopShake(): void {
    const s = this.shake;
    this.shake = null;
    this.position.set(0, 0);
    s?.resolve();
  }
}
