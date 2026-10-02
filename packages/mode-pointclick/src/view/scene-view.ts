import { hashString } from '@forge/core';
import { sliceGrid, type UiTheme } from '@forge/render2d';
import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { Point } from '../schema';
import type { HotspotView, PlayerView, SessionView } from '../types';
import type { TextureLoader } from './textures';

/** Ligne du charset Forge selon la direction (bas, gauche, droite, haut). */
const FACING_ROW = { down: 0, left: 1, right: 2, up: 3 } as const;
/** Cycle de marche : colonnes du charset (pas A, immobile, pas B, immobile). */
const WALK_CYCLE = [0, 1, 2, 1] as const;
const WALK_FPS = 8;

const PLACEHOLDER_COLORS = [0x5b7db1, 0x9c6ade, 0xd9776b, 0x4f9d8f, 0xc49a3a, 0x7a8c4f, 0xb05c8a, 0x5a9bd4];
export const placeholderColor = (key: string): number =>
  PLACEHOLDER_COLORS[hashString(key) % PLACEHOLDER_COLORS.length] as number;

/** Personnage jouable : sprite du charset (ou silhouette de remplacement) posé sur ses pieds. */
class PlayerSprite extends Container {
  private rows: Texture[][] | null = null;
  private readonly shadow = new Graphics().ellipse(0, 0, 8, 2.6).fill({ color: 0x000000, alpha: 0.3 });
  private readonly sprite = new Sprite();
  private readonly fallback = new Graphics();
  private time = 0;

  constructor() {
    super();
    this.sprite.anchor.set(0.5, 1);
    this.fallback
      .roundRect(-6, -17, 12, 17, 3)
      .fill(0x4b9cf5)
      .stroke({ width: 1, color: 0x10243f })
      .circle(0, -19, 6)
      .fill(0xf2d2b0)
      .stroke({ width: 1, color: 0x10243f });
    this.addChild(this.shadow, this.fallback, this.sprite);
    this.sprite.visible = false;
  }

  setRows(rows: Texture[][] | null): void {
    this.rows = rows;
    this.sprite.visible = rows !== null;
    this.fallback.visible = rows === null;
  }

  sync(view: PlayerView, dt: number): void {
    this.position.set(view.x, view.y);
    this.scale.set(view.scale);
    this.time = view.walking ? this.time + dt : 0;
    const rows = this.rows;
    if (!rows) {
      // Silhouette de remplacement : petit rebond pendant la marche.
      this.fallback.y = view.walking ? -Math.abs(Math.sin(this.time * 12)) * 1.5 : 0;
      return;
    }
    const row = rows[FACING_ROW[view.facing]] ?? rows[0];
    const col = view.walking ? (WALK_CYCLE[Math.floor(this.time * WALK_FPS) % WALK_CYCLE.length] as number) : 1;
    const texture = row?.[col] ?? row?.[1];
    if (texture) this.sprite.texture = texture;
  }
}

/**
 * Vue de la scène : fond mis à l'échelle (letterbox) dans la résolution du jeu, sprites des zones
 * et personnage triés par y. Les coordonnées de la session sont en pixels de l'image de fond.
 */
export class SceneView extends Container {
  private readonly world = new Container();
  private background: Container | null = null;
  private holders: Container[] = [];
  private readonly player = new PlayerSprite();
  private sceneId = '';
  private sceneW = 1;
  private sceneH = 1;
  private hotspotSignature = '';
  private pending: Promise<unknown>[] = [];
  private token = 0;
  private charsetRef: string | undefined;

  constructor(
    private readonly viewWidth: number,
    private readonly viewHeight: number,
    private readonly loader: TextureLoader,
    private readonly theme: UiTheme,
  ) {
    super();
    this.world.sortableChildren = true;
    this.player.visible = false;
    this.world.addChild(this.player);
    this.addChild(this.world);
  }

  /** Charge le charset du personnage (3 colonnes × 4 lignes) ; sans lui, une silhouette est dessinée. */
  setCharset(ref: string | undefined): void {
    if (ref === this.charsetRef) return;
    this.charsetRef = ref;
    this.player.setRows(null);
    if (!ref) return;
    const promise = this.loader.load(ref, 'charset').then((texture) => {
      if (this.destroyed || this.charsetRef !== ref || !texture) return;
      const rows = sliceGrid(texture, texture.width / 3, texture.height / 4);
      if (rows.length >= 4 && (rows[0]?.length ?? 0) >= 3) this.player.setRows(rows);
      else this.loader.warnOnce(`charset:${ref}`, `Charset inattendu : « ${ref} » (3 colonnes × 4 lignes attendues).`);
    });
    this.pending.push(promise);
  }

  /** Résolue quand le fond et les sprites en cours de chargement sont prêts. */
  async ready(): Promise<void> {
    while (this.pending.length > 0) {
      const batch = this.pending;
      this.pending = [];
      await Promise.allSettled(batch);
    }
  }

  /** Convertit des coordonnées d'écran (résolution du jeu) en pixels de scène ; `null` hors de l'image. */
  toScene(x: number, y: number): Point | null {
    const s = this.world.scale.x || 1;
    const px = (x - this.world.x) / s;
    const py = (y - this.world.y) / s;
    if (px < 0 || py < 0 || px > this.sceneW || py > this.sceneH) return null;
    return { x: px, y: py };
  }

  sync(view: SessionView, dt: number): void {
    const { scene } = view;
    if (scene.id !== this.sceneId || scene.width !== this.sceneW || scene.height !== this.sceneH) {
      this.sceneId = scene.id;
      this.sceneW = scene.width;
      this.sceneH = scene.height;
      this.layout();
      this.loadBackground(scene.id, scene.name, scene.background, scene.width, scene.height);
      this.hotspotSignature = '';
    }
    this.syncHotspots(view.hotspots);
    if (view.player) {
      this.player.visible = true;
      this.player.sync(view.player, dt);
      this.player.zIndex = view.player.y;
    } else {
      this.player.visible = false;
    }
  }

  private layout(): void {
    const scale = Math.min(this.viewWidth / this.sceneW, this.viewHeight / this.sceneH);
    this.world.scale.set(scale);
    this.world.position.set((this.viewWidth - this.sceneW * scale) / 2, (this.viewHeight - this.sceneH * scale) / 2);
  }

  private loadBackground(id: string, name: string, ref: string, w: number, h: number): void {
    const token = ++this.token;
    const promise = this.loader.load(ref, 'image').then((texture) => {
      if (this.destroyed || token !== this.token) return;
      const holder = new Container();
      holder.zIndex = -1e9;
      if (texture) {
        const sprite = new Sprite(texture);
        sprite.width = w;
        sprite.height = h;
        holder.addChild(sprite);
      } else {
        const backdrop = new Graphics()
          .rect(0, 0, w, h)
          .fill(0x0b0e14)
          .rect(0, 0, w, h)
          .fill({
            color: placeholderColor(id),
            alpha: 0.35,
          });
        const label = new Text({
          text: `${name || id}\n(fond manquant)`,
          style: { fontFamily: this.theme.fontFamily, fontSize: Math.round(h / 14), fill: 0xffffff, align: 'center' },
        });
        label.anchor.set(0.5);
        label.position.set(w / 2, h / 2);
        label.alpha = 0.6;
        holder.addChild(backdrop, label);
      }
      this.background?.destroy({ children: true });
      this.background = holder;
      this.world.addChild(holder);
    });
    this.pending.push(promise);
  }

  private syncHotspots(hotspots: HotspotView[]): void {
    const signature = hotspots
      .map((h) => {
        const r = h.spriteAt ?? h.bounds;
        return h.sprite ? `${h.id}:${h.sprite}:${r.x},${r.y},${r.w},${r.h}` : '';
      })
      .join('|');
    if (signature === this.hotspotSignature) return;
    this.hotspotSignature = signature;
    for (const holder of this.holders) holder.destroy({ children: true });
    this.holders = [];
    const token = this.token;
    for (const hotspot of hotspots) {
      if (!hotspot.sprite) continue;
      const r = hotspot.spriteAt ?? hotspot.bounds;
      const holder = new Container();
      holder.position.set(r.x, r.y);
      // Tri par y des pieds : un objet est devant le personnage si son bas est plus bas à l'écran.
      holder.zIndex = r.y + r.h;
      this.world.addChild(holder);
      this.holders.push(holder);
      const promise = this.loader.load(hotspot.sprite, 'image').then((texture) => {
        if (this.destroyed || holder.destroyed || token !== this.token) return;
        if (texture) {
          const sprite = new Sprite(texture);
          sprite.width = r.w;
          sprite.height = r.h;
          holder.addChild(sprite);
        } else {
          holder.addChild(
            new Graphics()
              .roundRect(0, 0, r.w, r.h, Math.min(r.w, r.h) * 0.12)
              .fill({ color: placeholderColor(hotspot.id), alpha: 0.6 })
              .stroke({ width: 2, color: 0xffffff, alpha: 0.5 }),
          );
        }
      });
      this.pending.push(promise);
    }
  }

  override destroy(): void {
    this.token++;
    super.destroy({ children: true });
  }
}
