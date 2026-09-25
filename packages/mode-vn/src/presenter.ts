import type { InputManager } from '@forge/core';
import type { MenuStep, SayStep, SceneState, VNEffect } from './types';

export type AudioEffect = Extract<VNEffect, { type: 'play' | 'stop' }>;
export type VisualEffect = Extract<VNEffect, { type: 'scene' | 'show' | 'hide' }>;

export interface PresentOptions {
  /** Transitions instantanées (retour arrière, chargement, mode « passer »). */
  instant: boolean;
  /** Appelé au bon moment de la séquence pour chaque effet audio. */
  onAudio(effect: AudioEffect): void;
}

/** Ce que le déroulement du jeu attend de l'affichage (PixiJS ou sans affichage). */
export interface VNPresenter {
  /** Applique les effets dans l'ordre ; la promesse se résout à la fin des transitions. */
  applyEffects(effects: VNEffect[], options: PresentOptions): Promise<void>;
  /** Reconstruit la scène sans transition (chargement, retour arrière). */
  rebuild(scene: SceneState, windowShown: boolean): Promise<void>;
  showSay(step: SayStep): void;
  showMenu(step: MenuStep): void;
  /** Index du choix validé dans le menu ouvert, sinon `null`. */
  pollMenu(input: InputManager): number | null;
  hideMenu(): void;
  showError(message: string): void;
  /** Vide la scène et les textes (retour à l'écran titre). */
  reset(): void;
  readonly typing: boolean;
  completeTyping(): void;
  /** Termine immédiatement les transitions en cours. */
  hurry(): void;
  update(dt: number): void;
}

/** Affichage vide (tests, serveur) : seuls l'audio et la navigation dans les menus sont gérés. */
export class HeadlessPresenter implements VNPresenter {
  private choices: { enabled: boolean }[] = [];
  private index = 0;

  async applyEffects(effects: VNEffect[], options: PresentOptions): Promise<void> {
    for (const effect of effects) {
      if (effect.type === 'play' || effect.type === 'stop') options.onAudio(effect);
    }
  }

  async rebuild(): Promise<void> {}

  showSay(): void {}

  showMenu(step: MenuStep): void {
    this.choices = step.choices;
    this.index = Math.max(0, step.choices.findIndex((c) => c.enabled));
  }

  pollMenu(input: InputManager): number | null {
    const n = this.choices.length;
    if (n === 0) return null;
    const move = (delta: number) => {
      for (let k = 0; k < n; k++) {
        this.index = (this.index + delta + n) % n;
        if (this.choices[this.index]?.enabled) break;
      }
    };
    if (input.justPressed('up')) move(-1);
    if (input.justPressed('down')) move(1);
    if (input.justPressed('confirm') && this.choices[this.index]?.enabled) {
      input.consume('confirm');
      return this.index;
    }
    return null;
  }

  hideMenu(): void {
    this.choices = [];
  }

  showError(): void {}

  reset(): void {
    this.choices = [];
  }

  get typing(): boolean {
    return false;
  }

  completeTyping(): void {}

  hurry(): void {}

  update(): void {}
}
