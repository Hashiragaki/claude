import type { UiTheme } from '@forge/render2d';
import { Container } from 'pixi.js';
import { TextButton } from './widgets';

export type QuickAction = 'rollback' | 'history' | 'auto' | 'skip' | 'save' | 'load';

export const QUICK_ACTIONS: QuickAction[] = ['rollback', 'history', 'auto', 'skip', 'save', 'load'];

/** Menu rapide en bas de l'écran (Retour, Historique, Auto, Passer, Sauver, Charger). */
export class QuickMenu extends Container {
  private readonly buttons = new Map<QuickAction, TextButton>();

  constructor(
    width: number,
    y: number,
    theme: UiTheme,
    labels: Record<QuickAction, string>,
    onAction: (action: QuickAction) => void,
  ) {
    super();
    const fontSize = Math.max(12, Math.round(theme.fontSize * 0.62));
    const gap = Math.round(fontSize * 1.8);
    let x = 0;
    for (const action of QUICK_ACTIONS) {
      const button = new TextButton(labels[action], theme, fontSize, () => onAction(action));
      button.x = x;
      x += button.width + gap;
      this.buttons.set(action, button);
      this.addChild(button);
    }
    this.position.set(Math.round((width - (x - gap)) / 2), y);
  }

  setState(state: { auto: boolean; skip: boolean }): void {
    this.buttons.get('auto')?.setActive(state.auto);
    this.buttons.get('skip')?.setActive(state.skip);
  }
}
