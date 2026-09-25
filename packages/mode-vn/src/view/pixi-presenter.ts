import type { InputManager } from '@forge/core';
import { toColor, type ChoiceMenu, type MessageBox, type UiTheme } from '@forge/render2d';
import type { PresentOptions, VisualEffect, VNPresenter } from '../presenter';
import type { MenuStep, SayStep, SceneState, Speaker, VNEffect } from '../types';
import type { SceneView } from './scene-view';
import type { CenteredText } from './widgets';

/** Transitions pendant lesquelles la boîte de dialogue reste affichée. */
const TEXT_KEEPING_TRANSITIONS = new Set(['none', 'vpunch', 'hpunch']);

export interface PixiPresenterParts {
  theme: UiTheme;
  scene: SceneView;
  messageBox: MessageBox;
  centered: CenteredText;
  menu: ChoiceMenu;
}

/** Affichage PixiJS du déroulement : scène, boîte de dialogue, narration centrée et choix. */
export class PixiPresenter implements VNPresenter {
  private windowShown = true;
  /** Incrémenté par chaque séquence ou reconstruction : une séquence obsolète s'arrête. */
  private sequence = 0;

  constructor(private readonly p: PixiPresenterParts) {}

  async applyEffects(effects: VNEffect[], options: PresentOptions): Promise<void> {
    const { scene } = this.p;
    const seq = ++this.sequence;
    scene.beginSequence();
    // Comme la fenêtre « auto » de Ren'Py : le texte disparaît pendant les transitions.
    const animated = effects.some((e) => {
      const visual = e.type === 'with' || e.type === 'scene' || e.type === 'show' || e.type === 'hide';
      const transition = visual ? e.transition : null;
      return !!transition && !TEXT_KEEPING_TRANSITIONS.has(transition);
    });
    if (animated && !options.instant) this.hideText();
    let pending: VisualEffect[] = [];
    for (const effect of effects) {
      switch (effect.type) {
        case 'play':
        case 'stop':
          options.onAudio(effect);
          break;
        case 'window':
          this.setWindow(effect.shown);
          break;
        case 'with':
          await scene.transition(pending, effect.transition, options.instant);
          if (seq !== this.sequence) return;
          pending = [];
          break;
        default:
          pending.push(effect);
          // `show x with t` applique t à tous les changements en attente (sémantique Ren'Py).
          if (effect.transition && effect.transition !== 'none') {
            await scene.transition(pending, effect.transition, options.instant);
            if (seq !== this.sequence) return;
            pending = [];
          }
      }
    }
    await scene.transition(pending, null, true);
  }

  async rebuild(scene: SceneState, windowShown: boolean): Promise<void> {
    this.sequence++;
    this.p.menu.close();
    this.hideText();
    this.windowShown = windowShown;
    await this.p.scene.rebuild(scene);
  }

  showSay(step: SayStep): void {
    const { messageBox, centered } = this.p;
    if (step.centered) {
      messageBox.hide();
      centered.show(step.text);
      return;
    }
    centered.hide();
    messageBox.show(step.text, this.speaker(step.speaker));
  }

  showMenu(step: MenuStep): void {
    const { messageBox, centered, menu } = this.p;
    centered.hide();
    if (step.caption) {
      messageBox.show(step.caption.text, this.speaker(step.caption.speaker));
      messageBox.skipTyping();
    } else if (!this.windowShown) {
      messageBox.hide();
    }
    menu.open(step.choices.map((c) => ({ label: c.text, enabled: c.enabled })));
  }

  pollMenu(input: InputManager): number | null {
    const index = this.p.menu.handleInput(input);
    return index !== null && index >= 0 ? index : null;
  }

  hideMenu(): void {
    this.p.menu.close();
  }

  showError(message: string): void {
    this.p.centered.hide();
    this.p.messageBox.show(message, { name: '⚠', color: 0xff6b6b });
    this.p.messageBox.skipTyping();
  }

  reset(): void {
    this.sequence++;
    this.p.menu.close();
    this.hideText();
    this.windowShown = true;
    this.p.scene.clear();
  }

  get typing(): boolean {
    return this.p.messageBox.visible && this.p.messageBox.typing;
  }

  completeTyping(): void {
    this.p.messageBox.skipTyping();
  }

  hurry(): void {
    this.p.scene.hurry();
  }

  update(dt: number): void {
    this.p.messageBox.update(dt);
    this.p.scene.update(dt);
  }

  private hideText(): void {
    this.p.messageBox.hide();
    this.p.centered.hide();
  }

  private setWindow(shown: boolean): void {
    this.windowShown = shown;
    if (!shown) this.p.messageBox.hide();
    else if (!this.p.messageBox.visible) this.p.messageBox.show('', null);
  }

  private speaker(speaker: Speaker): { name: string; color: number } | null {
    if (!speaker) return null;
    return { name: speaker.name, color: toColor(speaker.color ?? undefined, this.p.theme.nameColor) };
  }
}
