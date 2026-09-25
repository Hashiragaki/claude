import type { InputManager } from '@forge/core';
import { toColor, type UiTheme } from '@forge/render2d';
import { Container, Graphics, Text } from 'pixi.js';
import type { HistoryEntry } from '../types';
import { TextButton, createBackdrop } from './widgets';

export interface HistoryScreenOptions {
  width: number;
  height: number;
  theme: UiTheme;
  title: string;
  backLabel: string;
  entries: HistoryEntry[];
  onClose(): void;
}

const MAX_ENTRIES = 80;

/** Historique des répliques (backlog), défilable à la molette ou au clavier. */
export class HistoryScreen extends Container {
  private readonly content = new Container();
  private readonly top: number;
  private scroll = 0;
  private maxScroll = 0;

  constructor(o: HistoryScreenOptions) {
    super();
    const { width, height, theme } = o;
    const margin = Math.round(width * 0.06);
    const title = new Text({
      text: o.title,
      style: {
        fontFamily: theme.fontFamily,
        fontSize: Math.round(theme.fontSize * 1.3),
        fontWeight: 'bold',
        fill: theme.textColor,
      },
    });
    title.position.set(margin, Math.round(margin * 0.4));
    const back = new TextButton(o.backLabel, theme, theme.fontSize, o.onClose);
    back.position.set(width - margin - back.width, Math.round(margin * 0.45));
    this.top = title.y + title.height + theme.padding;
    const viewHeight = height - this.top - margin * 0.5;
    const mask = new Graphics().rect(margin, this.top, width - margin * 2, viewHeight).fill(0xffffff);
    this.content.mask = mask;
    this.content.x = margin;

    const textWidth = width - margin * 2;
    let y = 0;
    for (const entry of o.entries.slice(-MAX_ENTRIES)) {
      if (entry.speaker) {
        const name = new Text({
          text: entry.speaker.name,
          style: {
            fontFamily: theme.fontFamily,
            fontSize: theme.fontSize,
            fontWeight: 'bold',
            fill: toColor(entry.speaker.color ?? undefined, theme.nameColor),
          },
        });
        name.y = y;
        this.content.addChild(name);
        y += name.height;
      }
      const body = new Text({
        text: entry.choice ? `➜ ${entry.text}` : entry.text,
        style: {
          fontFamily: theme.fontFamily,
          fontSize: theme.fontSize,
          lineHeight: theme.lineHeight,
          fill: entry.choice ? theme.accentColor : theme.textColor,
          wordWrap: true,
          wordWrapWidth: textWidth,
          breakWords: true,
        },
      });
      body.y = y;
      this.content.addChild(body);
      y += body.height + theme.padding;
    }
    this.maxScroll = Math.max(0, y - viewHeight);
    this.scroll = this.maxScroll;
    this.applyScroll();
    this.addChild(createBackdrop(width, height, 0.9), title, back, this.content, mask);
  }

  /** Renvoie vrai quand l'écran doit être fermé. */
  handleInput(input: InputManager): boolean {
    if (input.justPressed('cancel') || input.justPressed('history') || input.justPressed('confirm')) {
      input.consume('confirm');
      return true;
    }
    let delta = input.pointer.wheel * 0.6;
    if (input.justPressed('up')) delta -= 60;
    if (input.justPressed('down')) delta += 60;
    if (delta !== 0) {
      this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + delta));
      this.applyScroll();
    }
    return false;
  }

  private applyScroll(): void {
    this.content.y = this.top - this.scroll;
  }
}
