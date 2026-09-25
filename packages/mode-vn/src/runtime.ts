import type { GameRuntime, InputManager, RuntimeContext, SaveSlotInfo, Value } from '@forge/core';
import type { ChoiceItem } from '@forge/render2d';
import type { Container, Texture } from 'pixi.js';
import { VNInterpreter, VNRuntimeError, isCharacter } from './interpreter';
import { loadProgram } from './loader';
import { HeadlessPresenter, type AudioEffect, type VNPresenter } from './presenter';
import { looksLikePath, resolveAudioAsset } from './refs';
import { extendVNStrings, formatSaveDate } from './strings';
import { excerpt } from './text';
import type { AudioChannelName, VNStep } from './types';
import { EndScreen } from './view/end-screen';
import { HistoryScreen } from './view/history-screen';
import { MenuScreen } from './view/menu-screen';
import type { QuickAction } from './view/quick-menu';
import { VNShell } from './view/shell';

const SAVE_SLOTS = ['1', '2', '3', '4', '5', '6'];
/** Délai entre deux répliques en mode « passer » (secondes). */
const SKIP_DELAY = 0.06;

/** Écran superposé (titre, sauvegardes, historique, fin) : seul celui du dessus reçoit les entrées. */
interface Overlay {
  view: Container;
  update(dt: number, input: InputManager): void;
}

type Screen = 'loading' | 'title' | 'game' | 'end';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Exécution d'un visual novel : écrans, déroulement du script, sauvegardes, audio et contrôles. */
export class VNRuntime implements GameRuntime {
  private shell: VNShell | null = null;
  private presenter: VNPresenter = new HeadlessPresenter();
  private interp: VNInterpreter | null = null;
  private screen: Screen = 'loading';
  private overlays: Overlay[] = [];
  /** Vues retirées, détruites à la frame suivante (jamais pendant un événement Pixi). */
  private trash: Container[] = [];
  private step: VNStep | null = null;
  /** Transition en cours : un clic accélère au lieu d'avancer. */
  private busy = false;
  private auto = false;
  private skipToggle = false;
  /** Minuterie des modes auto / passer et des pauses. */
  private timer = 0;
  private clickPending = false;
  private playTime = 0;
  private destroyed = false;
  private varsSignature = '';
  private readonly warned = new Set<string>();

  constructor(private readonly ctx: RuntimeContext) {}

  async start(): Promise<void> {
    const { ctx } = this;
    extendVNStrings(ctx.i18n);
    const { program, diagnostics } = await loadProgram(ctx.bundle.files, ctx.bundle.manifest.entry);
    for (const d of diagnostics) {
      const level = d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warn' : 'info';
      ctx.log(level, `${d.file}${d.line ? `:${d.line}` : ''} — ${d.message}`);
    }
    this.interp = new VNInterpreter(program, {
      random: () => ctx.rng.next(),
      log: (level, message) => ctx.log(level, message),
    });
    if (ctx.mount) {
      const t = (key: string) => ctx.i18n.t(key);
      const shell = await VNShell.create(ctx, ctx.mount, {
        onAdvanceClick: () => {
          this.clickPending = true;
        },
        onQuickAction: (action) => this.quickAction(action),
        labels: {
          rollback: t('vn.rollback'),
          history: t('menu.history'),
          auto: t('vn.auto'),
          skip: t('vn.skip'),
          save: t('menu.save'),
          load: t('menu.load'),
        },
      });
      if (this.destroyed) {
        shell.destroy();
        return;
      }
      this.shell = shell;
      this.presenter = shell.presenter;
    }
    const { startLabel, skipTitle } = ctx.options;
    if (startLabel || skipTitle || !this.shell) this.newGame(startLabel);
    else await this.showTitle();
  }

  update(dt: number): void {
    if (this.destroyed) return;
    for (const view of this.trash.splice(0)) if (!view.destroyed) view.destroy({ children: true });
    this.shell?.update(dt);
    const input = this.ctx.input;
    const top = this.overlays[this.overlays.length - 1];
    if (top) top.update(dt, input);
    else if (this.screen === 'game') {
      this.playTime += dt;
      this.updateGame(dt, input);
    }
    this.clickPending = false;
    this.shell?.quickMenu.setState({ auto: this.auto, skip: this.skipping });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.overlays = [];
    this.trash = [];
    this.ctx.audio.stopAll();
    this.shell?.destroy();
    this.shell = null;
  }

  serialize(): unknown {
    return this.interp?.isStarted ? this.interp.serialize() : null;
  }

  async deserialize(state: unknown): Promise<void> {
    await this.restoreState(state);
  }

  getDebugState(): Record<string, unknown> {
    const interp = this.interp;
    if (!interp) return {};
    const variables = Object.fromEntries(Object.entries(interp.getVariables()).filter(([, v]) => !isCharacter(v)));
    return { label: interp.currentLabel, line: interp.currentLine, file: interp.currentFile, variables };
  }

  setDebugValue(path: string, value: unknown): void {
    const match = /^variables\.(.+)$/.exec(path);
    if (!match || !this.interp) return;
    try {
      this.interp.setVariable(match[1] as string, JSON.parse(JSON.stringify(value ?? null)) as Value);
    } catch (error) {
      this.ctx.log('error', errorMessage(error));
      return;
    }
    this.notifyVariables('debug');
  }

  // -------------------------------------------------------------------------
  // Déroulement
  // -------------------------------------------------------------------------

  private get skipping(): boolean {
    return this.skipToggle || this.ctx.input.isDown('skip');
  }

  private updateGame(dt: number, input: InputManager): void {
    const step = this.step;
    if (!this.interp || !step) return;
    if (input.justPressed('history')) return this.openHistory();
    if (input.justPressed('menu') || input.justPressed('cancel')) return void this.openSaves('save');
    if (input.justPressed('auto')) this.toggleAuto();
    if (input.pointer.wheel < 0) return this.rollback();
    const advance = input.justPressed('confirm') || this.clickPending;
    if (this.busy) {
      if (advance || this.skipping) this.presenter.hurry();
      return;
    }
    this.timer += dt;
    switch (step.kind) {
      case 'say':
        if (this.skipping) {
          this.presenter.completeTyping();
          if (this.timer >= SKIP_DELAY) this.next();
        } else if (this.presenter.typing) {
          // Premier appui : affiche tout le texte ; le délai auto part de la fin de l'écriture.
          this.timer = 0;
          if (advance) this.presenter.completeTyping();
        } else if (advance || (this.auto && this.timer >= 1.2 + step.text.length * 0.035)) {
          this.next();
        }
        break;
      case 'pause':
        if (advance || this.skipping || (step.seconds !== null && this.timer >= step.seconds)) this.next();
        break;
      case 'menu': {
        const choice = this.presenter.pollMenu(input);
        if (choice !== null) this.choose(choice);
        break;
      }
      case 'end':
        break;
    }
  }

  private newGame(label?: string): void {
    const interp = this.interp;
    if (!interp) return;
    let start = label ?? 'start';
    if (!interp.hasLabel(start)) {
      if (label) this.ctx.log('error', `Label « ${label} » introuvable : démarrage au label « start ».`);
      start = 'start';
    }
    this.clearOverlays();
    this.enterGame();
    this.playTime = 0;
    this.presenter.reset();
    this.ctx.audio.stopBgm(300);
    this.run(() => interp.start(start));
  }

  private enterGame(): void {
    this.screen = 'game';
    this.auto = false;
    this.skipToggle = false;
    this.shell?.setQuickMenuVisible(true);
  }

  private next(): void {
    const interp = this.interp;
    if (!interp) return;
    if (!interp.isStarted) {
      // La partie n'a pas pu démarrer (erreur affichée) : retour au titre.
      void this.showTitle();
      return;
    }
    this.ctx.audio.stopVoice();
    this.run(() => interp.advance());
  }

  private choose(index: number): void {
    const interp = this.interp;
    if (interp) this.run(() => interp.choose(index));
  }

  private rollback(): void {
    const interp = this.interp;
    if (!interp || this.busy || !interp.canRollback) return;
    this.skipToggle = false;
    this.run(() => interp.rollback(), true);
  }

  private toggleAuto(): void {
    this.auto = !this.auto;
    this.timer = 0;
  }

  /** Exécute une action de l'interpréteur et affiche l'étape obtenue (ou l'erreur). */
  private run(action: () => VNStep | null, restored = false): void {
    let step: VNStep | null;
    try {
      step = action();
    } catch (error) {
      this.showError(error);
      return;
    }
    if (step) void this.present(step, restored);
  }

  private async present(step: VNStep, restored: boolean): Promise<void> {
    const interp = this.interp;
    if (!interp) return;
    this.step = step;
    this.busy = true;
    this.timer = 0;
    this.presenter.hideMenu();
    try {
      if (restored) {
        await this.presenter.rebuild(interp.scene, interp.state.windowShown);
        this.syncMusic();
      }
      await this.presenter.applyEffects(step.effects, {
        instant: restored || this.skipping,
        onAudio: (effect) => this.playAudio(effect),
      });
    } catch (error) {
      this.ctx.log('error', `Affichage : ${errorMessage(error)}`);
    }
    if (this.destroyed || this.step !== step) return;
    this.busy = false;
    switch (step.kind) {
      case 'say':
        this.presenter.showSay(step);
        if (this.skipping) this.presenter.completeTyping();
        break;
      case 'menu':
        // Comme Ren'Py, le mode « passer » s'arrête aux choix.
        this.skipToggle = false;
        this.presenter.showMenu(step);
        break;
      case 'pause':
        break;
      case 'end':
        this.finish();
        break;
    }
    this.notifyVariables(restored ? 'restore' : 'step');
  }

  private showError(error: unknown): void {
    const message = errorMessage(error);
    this.ctx.log('error', message);
    this.busy = false;
    // Une réplique factice : avancer reprend après l'instruction fautive.
    this.step = { kind: 'say', speaker: null, text: message, centered: false, effects: [] };
    this.presenter.showError(`${this.ctx.i18n.t('vn.error')} : ${message}`);
  }

  private finish(): void {
    this.screen = 'end';
    this.auto = false;
    this.skipToggle = false;
    this.ctx.events.emit('game-end', { reason: 'end' });
    const shell = this.shell;
    if (!shell) return;
    shell.setQuickMenuVisible(false);
    const screen = new EndScreen(shell.width, shell.height, shell.theme, this.ctx.i18n.t('game.end'));
    this.pushOverlay({
      view: screen,
      update: (dt, input) => {
        if (!screen.update(dt, input)) return;
        this.ctx.audio.stopBgm(1000);
        void this.showTitle();
      },
    });
  }

  private notifyVariables(reason: string): void {
    const signature = JSON.stringify(this.interp?.getVariables() ?? {});
    if (reason === 'step' && signature === this.varsSignature) return;
    this.varsSignature = signature;
    this.ctx.events.emit('state-changed', { reason: reason === 'step' ? 'variables' : reason });
  }

  // -------------------------------------------------------------------------
  // Écrans
  // -------------------------------------------------------------------------

  private async showTitle(): Promise<void> {
    const shell = this.shell;
    if (!shell) return;
    this.screen = 'title';
    this.step = null;
    this.busy = false;
    this.clearOverlays();
    this.presenter.reset();
    shell.setQuickMenuVisible(false);
    const [saves, background] = await Promise.all([this.listSaves(), this.titleBackground()]);
    if (this.destroyed || this.screen !== 'title' || this.overlays.length > 0) return;
    const { i18n } = this.ctx;
    const entries: { label: string; action: () => void }[] = [
      { label: i18n.t('menu.newGame'), action: () => this.newGame() },
    ];
    const latest = saves[0];
    if (latest) entries.push({ label: i18n.t('menu.continue'), action: () => void this.loadFrom(latest.slot) });
    entries.push({ label: i18n.t('menu.load'), action: () => void this.openSaves('load') });
    const screen = new MenuScreen({
      width: shell.width,
      height: shell.height,
      theme: shell.theme,
      title: this.ctx.bundle.manifest.name,
      items: entries.map((e) => ({ label: e.label })),
      background,
      large: true,
    });
    this.pushOverlay({
      view: screen,
      update: (_dt, input) => {
        const index = screen.handleInput(input);
        if (index !== null && index >= 0) entries[index]?.action();
      },
    });
  }

  /** Fond de l'écran titre : asset d'alias `title`, sinon la première image étiquetée `bg`. */
  private async titleBackground(): Promise<Texture | null> {
    const { assets } = this.ctx;
    const meta = [assets.getByAlias('title'), ...assets.withTag('bg')].find((a) => a?.kind === 'image');
    return meta && this.shell ? this.shell.images.load(meta.id) : null;
  }

  private listSaves(): Promise<SaveSlotInfo[]> {
    return this.ctx.saves.list().catch(() => []);
  }

  private async openSaves(mode: 'save' | 'load'): Promise<void> {
    const shell = this.shell;
    if (!shell) return;
    const infos = await this.listSaves();
    if (this.destroyed) return;
    const { i18n } = this.ctx;
    const bySlot = new Map(infos.map((info) => [info.slot, info]));
    const items: ChoiceItem[] = SAVE_SLOTS.map((slot, n) => {
      const info = bySlot.get(slot);
      const name = i18n.t('vn.slot', { n: n + 1 });
      if (!info) return { label: `${name} — ${i18n.t('save.empty')}`, enabled: mode === 'save' };
      const label = info.label ? `${info.label} — ` : '';
      return { label: `${name} — ${label}${formatSaveDate(info.savedAt, i18n.locale)}` };
    });
    items.push({ label: i18n.t('menu.back') });
    const screen = new MenuScreen({
      width: shell.width,
      height: shell.height,
      theme: shell.theme,
      title: i18n.t(mode === 'save' ? 'menu.save' : 'menu.load'),
      items,
      cancelable: true,
    });
    const overlay: Overlay = {
      view: screen,
      update: (_dt, input) => {
        const index = screen.handleInput(input);
        if (index === null) return;
        const slot = SAVE_SLOTS[index];
        if (index < 0 || !slot) this.removeOverlay(overlay);
        else if (mode === 'save') void this.saveTo(slot, overlay);
        else void this.loadFrom(slot);
      },
    };
    this.pushOverlay(overlay);
  }

  private openHistory(): void {
    const shell = this.shell;
    const interp = this.interp;
    if (!shell || !interp) return;
    const { i18n } = this.ctx;
    const overlay: Overlay = {
      view: new HistoryScreen({
        width: shell.width,
        height: shell.height,
        theme: shell.theme,
        title: i18n.t('menu.history'),
        backLabel: i18n.t('menu.back'),
        entries: interp.history,
        onClose: () => this.removeOverlay(overlay),
      }),
      update: (_dt, input) => {
        if ((overlay.view as HistoryScreen).handleInput(input)) this.removeOverlay(overlay);
      },
    };
    this.pushOverlay(overlay);
  }

  private quickAction(action: QuickAction): void {
    if (this.screen !== 'game' || this.overlays.length > 0) return;
    switch (action) {
      case 'rollback':
        return this.rollback();
      case 'history':
        return this.openHistory();
      case 'auto':
        return this.toggleAuto();
      case 'skip':
        this.skipToggle = !this.skipToggle;
        return;
      case 'save':
      case 'load':
        void this.openSaves(action);
    }
  }

  private pushOverlay(overlay: Overlay): void {
    this.shell?.screens.addChild(overlay.view);
    this.overlays.push(overlay);
  }

  private removeOverlay(overlay: Overlay): void {
    const index = this.overlays.indexOf(overlay);
    if (index < 0) return;
    this.overlays.splice(index, 1);
    overlay.view.removeFromParent();
    this.trash.push(overlay.view);
  }

  private clearOverlays(): void {
    for (const overlay of [...this.overlays]) this.removeOverlay(overlay);
  }

  private toast(message: string): void {
    this.shell?.toast.show(message);
  }

  // -------------------------------------------------------------------------
  // Sauvegardes
  // -------------------------------------------------------------------------

  /** Libellé d'une sauvegarde : extrait de la réplique en cours, sinon le label. */
  private saveLabel(): string {
    const interp = this.interp;
    if (!interp) return '';
    const step = interp.currentStep;
    let text = '';
    if (step?.kind === 'say') text = step.speaker ? `${step.speaker.name} : ${step.text}` : step.text;
    else if (step?.kind === 'menu') text = step.caption?.text ?? '';
    return excerpt(text, 40) || (interp.currentLabel ?? '');
  }

  private async saveTo(slot: string, overlay: Overlay): Promise<void> {
    try {
      await this.ctx.saves.save(slot, this.serialize(), this.saveLabel(), this.playTime);
      this.toast(this.ctx.i18n.t('save.saved'));
      this.removeOverlay(overlay);
    } catch (error) {
      this.ctx.log('error', `Sauvegarde : ${errorMessage(error)}`);
      this.toast(this.ctx.i18n.t('vn.saveFailed'));
    }
  }

  private async loadFrom(slot: string): Promise<void> {
    const data = await this.ctx.saves.load(slot).catch(() => null);
    if (this.destroyed) return;
    if (data && (await this.restoreState(data.state))) {
      this.playTime = data.playTime;
      this.toast(this.ctx.i18n.t('save.loaded'));
    } else {
      this.toast(this.ctx.i18n.t('vn.loadFailed'));
    }
  }

  private async restoreState(state: unknown): Promise<boolean> {
    const interp = this.interp;
    if (!interp || state === null || state === undefined) return false;
    const hash = typeof state === 'object' ? (state as { scriptHash?: unknown }).scriptHash : undefined;
    let step: VNStep;
    try {
      step = interp.restore(state);
    } catch (error) {
      if (!(error instanceof VNRuntimeError)) {
        this.ctx.log('error', errorMessage(error));
        return false;
      }
      this.clearOverlays();
      this.enterGame();
      await this.presenter.rebuild(interp.scene, interp.state.windowShown);
      this.showError(error);
      return true;
    }
    if (hash !== interp.program.hash) {
      this.ctx.log('warn', 'Le script a changé depuis cette sauvegarde : la position a été recalée au mieux.');
    }
    this.clearOverlays();
    this.enterGame();
    await this.present(step, true);
    return true;
  }

  // -------------------------------------------------------------------------
  // Audio
  // -------------------------------------------------------------------------

  private playAudio(effect: AudioEffect): void {
    const { audio } = this.ctx;
    if (effect.type === 'stop') {
      if (effect.channel === 'music') audio.stopBgm(Math.round((effect.fadeout ?? 0.5) * 1000));
      else if (effect.channel === 'voice') audio.stopVoice();
      else audio.stopSfx();
      return;
    }
    // En mode « passer », seuls les changements de musique sont conservés.
    if (this.skipping && effect.channel !== 'music') return;
    const url = this.audioUrl(effect.ref, effect.channel);
    if (!url) return;
    const fadeMs = effect.fadein === null ? undefined : Math.round(effect.fadein * 1000);
    const playing =
      effect.channel === 'music'
        ? audio.playBgm(url, { fadeMs, loop: effect.loop })
        : effect.channel === 'voice'
          ? audio.playVoice(url)
          : audio.playSfx(url, { loop: effect.loop });
    playing.catch((error: unknown) =>
      this.warnOnce(`audio:${effect.ref}`, `Lecture audio impossible : « ${effect.ref} » (${errorMessage(error)})`),
    );
  }

  /** URL d'un son : asset du bon type, puis tout type, puis chemin de fichier du projet. */
  private audioUrl(ref: string, channel: AudioChannelName): string | null {
    const meta = resolveAudioAsset(this.ctx.assets, ref, channel);
    if (meta) return this.ctx.assets.url(meta);
    if (!looksLikePath(ref)) {
      this.warnOnce(`audio:${ref}`, `Son introuvable : « ${ref} » (aucun asset audio avec cet alias).`);
    }
    try {
      return this.ctx.bundle.files.url(ref);
    } catch {
      return null;
    }
  }

  /** Remet la musique en accord avec l'état (après chargement ou retour arrière). */
  private syncMusic(): void {
    const music = this.interp?.state.audio.music;
    if (!music) {
      this.ctx.audio.stopBgm(300);
      return;
    }
    const url = this.audioUrl(music, 'music');
    if (url) this.ctx.audio.playBgm(url, { loop: true }).catch(() => undefined);
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.ctx.log('warn', message);
  }
}
