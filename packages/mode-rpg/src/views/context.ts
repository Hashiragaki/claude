import type { AssetKind, I18n, InputManager } from '@forge/core';
import type { ChoiceItem, ChoiceMenu, ChoiceMenuOpenOptions, Tweens, UiTheme } from '@forge/render2d';
import type { Renderer, Texture } from 'pixi.js';
import type { SystemSfx } from '../schema';
import type { RpgSession } from '../session';
import type { Flow } from './ui';

export interface ChooseOptions extends ChoiceMenuOpenOptions {
  /** Laisse le menu affiché après le choix (menus imbriqués). */
  keepOpen?: boolean;
  /** Appelé à chaque frame avec l'index surligné (curseur de cible…). */
  onSelect?: (index: number) => void;
}

export interface SlotView {
  slot: string;
  label: string;
  exists: boolean;
}

/** Services du runtime utilisés par les scènes (titre, menu, combat). */
export interface SceneContext {
  readonly session: RpgSession;
  readonly input: InputManager;
  readonly i18n: I18n;
  readonly flow: Flow;
  readonly tweens: Tweens;
  readonly renderer: Renderer;
  readonly width: number;
  readonly height: number;
  readonly theme: UiTheme;
  /** Mode débogage de l'éditeur (affiche les collisions). */
  readonly debug: boolean;
  /** Ouvre un menu et attend un choix (-1 = annulation). */
  choose(menu: ChoiceMenu, items: ChoiceItem[], options?: ChooseOptions): Promise<number>;
  /** Attend une validation (ou une annulation si `cancel`). */
  waitConfirm(options?: { cancel?: boolean }): Promise<void>;
  /** Attend `seconds`, ou moins si le joueur valide. */
  pause(seconds: number): Promise<void>;
  sfx(key: SystemSfx): void;
  /** Texture d'un asset (ou `null` avec un avertissement unique). */
  texture(ref: string | undefined, kind: AssetKind, pixelArt: boolean): Promise<Texture | null>;
  saveSlots(): Promise<SlotView[]>;
  save(slot: string): Promise<boolean>;
  load(slot: string): Promise<boolean>;
}
