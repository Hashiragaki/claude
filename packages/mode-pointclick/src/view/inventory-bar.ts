import type { UiTheme } from '@forge/render2d';
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { InventoryItemView } from '../types';
import { placeholderColor } from './scene-view';
import type { TextureLoader } from './textures';

interface Slot {
  id: string;
  x: number;
  y: number;
  size: number;
}

/**
 * Barre d'inventaire en bas de l'écran : une pastille centrée contenant les icônes des objets.
 * Le test de clic est fait par le runtime (`hit`) : clic = sélectionner, clic droit = regarder.
 */
export class InventoryBar extends Container {
  /** Hauteur occupée en bas de l'écran (0 si l'inventaire est vide). */
  occupiedHeight = 0;
  private slots: Slot[] = [];
  private signature = '';
  private readonly slotSize: number;
  private readonly margin: number;

  constructor(
    private readonly viewWidth: number,
    private readonly viewHeight: number,
    private readonly loader: TextureLoader,
    private readonly theme: UiTheme,
  ) {
    super();
    this.slotSize = Math.max(44, Math.min(84, Math.round(viewHeight * 0.1)));
    this.margin = Math.round(this.slotSize * 0.2);
  }

  sync(items: InventoryItemView[], selected: string | undefined): void {
    const signature = `${items.map((i) => `${i.id}:${i.icon}`).join('|')}#${selected ?? ''}`;
    if (signature === this.signature) return;
    this.signature = signature;
    for (const child of this.removeChildren()) child.destroy({ children: true });
    this.slots = [];
    if (items.length === 0) {
      this.occupiedHeight = 0;
      return;
    }
    const pad = Math.round(this.slotSize * 0.18);
    const gap = Math.round(this.slotSize * 0.14);
    const available = this.viewWidth - this.margin * 2 - pad * 2;
    const size = Math.min(this.slotSize, Math.floor((available - gap * (items.length - 1)) / items.length));
    const panelW = items.length * size + (items.length - 1) * gap + pad * 2;
    const panelH = size + pad * 2;
    const panelX = Math.round((this.viewWidth - panelW) / 2);
    const panelY = this.viewHeight - this.margin - panelH;
    this.occupiedHeight = panelH + this.margin;

    const t = this.theme;
    const panel = new Graphics()
      .roundRect(panelX, panelY, panelW, panelH, t.radius + 2)
      .fill({ color: t.panelColor, alpha: 0.82 })
      .roundRect(panelX, panelY, panelW, panelH, t.radius + 2)
      .stroke({ width: t.borderWidth, color: t.borderColor, alpha: 0.5 });
    this.addChild(panel);

    items.forEach((item, i) => {
      const x = panelX + pad + i * (size + gap);
      const y = panelY + pad;
      this.slots.push({ id: item.id, x, y, size });
      const isSelected = item.id === selected;
      const cell = new Graphics()
        .roundRect(x, y, size, size, t.radius)
        .fill({ color: isSelected ? t.selectionColor : 0xffffff, alpha: isSelected ? 0.95 : 0.08 })
        .roundRect(x, y, size, size, t.radius)
        .stroke({
          width: isSelected ? t.borderWidth + 1 : 1,
          color: isSelected ? t.accentColor : 0xffffff,
          alpha: isSelected ? 1 : 0.2,
        });
      this.addChild(cell);
      const inner = size - 8;
      const icon = new Container();
      icon.position.set(x + size / 2, y + size / 2);
      this.addChild(icon);
      void this.loader.load(item.icon, 'image').then((texture) => {
        if (icon.destroyed) return;
        if (texture) {
          const sprite = new Sprite(texture);
          sprite.anchor.set(0.5);
          sprite.scale.set(Math.min(inner / texture.width, inner / texture.height));
          icon.addChild(sprite);
        } else {
          const letter = new Text({
            text: item.name.slice(0, 1).toUpperCase(),
            style: { fontFamily: t.fontFamily, fontSize: Math.round(size * 0.5), fontWeight: 'bold', fill: 0xffffff },
          });
          letter.anchor.set(0.5);
          icon.addChild(
            new Graphics().roundRect(-inner / 2, -inner / 2, inner, inner, t.radius).fill({
              color: placeholderColor(item.id),
              alpha: 0.7,
            }),
            letter,
          );
        }
      });
    });
  }

  /** Identifiant de l'objet sous le point (coordonnées d'écran), sinon `null`. */
  hit(x: number, y: number): string | null {
    for (const s of this.slots) {
      if (x >= s.x && x <= s.x + s.size && y >= s.y && y <= s.y + s.size) return s.id;
    }
    return null;
  }

  /** Vrai si le point est sur la pastille (même entre deux cases). */
  covers(x: number, y: number): boolean {
    if (this.slots.length === 0) return false;
    const first = this.slots[0] as Slot;
    const last = this.slots[this.slots.length - 1] as Slot;
    const pad = Math.round(this.slotSize * 0.18);
    return x >= first.x - pad && x <= last.x + last.size + pad && y >= first.y - pad && y <= first.y + first.size + pad;
  }
}
