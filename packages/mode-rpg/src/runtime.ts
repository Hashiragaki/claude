import type { AssetKind, GameRuntime, RuntimeContext } from '@forge/core';
import {
  ChoiceMenu,
  Fader,
  MessageBox,
  Tweens,
  createStage,
  tryLoadTexture,
  type ChoiceItem,
  type Stage,
} from '@forge/render2d';
import { CanvasTextMetrics, Container, type Texture } from 'pixi.js';
import type { BattleResult } from './battle';
import type { SystemSfx } from './schema';
import { RpgSession, type BattleRequest, type StartOverrides } from './session';
import { BattleScene } from './views/battleScene';
import type { ChooseOptions, SceneContext, SlotView } from './views/context';
import { MapView } from './views/mapView';
import { MenuScene } from './views/menuScene';
import { GameOverScreen, TitleScreen } from './views/screens';
import { Cancelled, Flow, RPG_THEME, choiceMenuHeight, textStyle } from './views/ui';
import { NO_INPUT, type WorldInput, type WorldRequest } from './world';

const SAVE_SLOTS = ['1', '2', '3'];
const MESSAGE_HEIGHT = 136;

type Mode = 'loading' | 'title' | 'map' | 'menu' | 'battle' | 'gameover';

/**
 * Runtime PixiJS du mode RPG : écran titre, carte (tuiles, personnages, caméra), fenêtres de
 * dialogue et de choix, menu principal, combats, game over, transitions et audio.
 * Les séquences (dialogues, combats, menus) sont des coroutines pilotées par `update(dt)`.
 */
export class RpgRuntime implements GameRuntime {
  private readonly session: RpgSession;
  private readonly flow = new Flow();
  private readonly tweens = new Tweens();
  private readonly width: number;
  private readonly height: number;
  private stage: Stage | null = null;
  private scenes!: SceneContext;
  private readonly mapLayer = new Container();
  private readonly sceneLayer = new Container();
  private readonly uiLayer = new Container();
  private mapView: MapView | null = null;
  private messageBox!: MessageBox;
  private choiceMenu!: ChoiceMenu;
  private fader!: Fader;
  private scene: Container | null = null;
  private battleScene: BattleScene | null = null;
  private mode: Mode = 'loading';
  private handling = false;
  private rebuilding = false;
  private epoch = 0;
  private destroyed = false;
  private readonly warned = new Set<string>();

  constructor(private readonly ctx: RuntimeContext) {
    this.session = new RpgSession(ctx);
    this.width = ctx.bundle.manifest.resolution.width || 960;
    this.height = ctx.bundle.manifest.resolution.height || 540;
  }

  private t(key: string, params?: Record<string, string | number>): string {
    return this.ctx.i18n.t(key, params);
  }

  // -------------------------------------------------------------------------
  // Cycle de vie
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    if (!this.ctx.mount) throw new Error('Le runtime RPG nécessite un élément d\'affichage');
    const { width: w, height: h } = this;
    this.stage = await createStage(this.ctx.mount, { width: w, height: h, pixelArt: true, background: 0x000000 });
    this.scenes = this.createSceneContext();
    this.mapView = new MapView(this.scenes);
    this.mapLayer.addChild(this.mapView);
    this.messageBox = new MessageBox({
      x: 20,
      y: h - MESSAGE_HEIGHT - 14,
      width: w - 40,
      height: MESSAGE_HEIGHT,
      theme: RPG_THEME,
      charsPerSecond: 50,
    });
    this.choiceMenu = new ChoiceMenu(w, h, RPG_THEME);
    this.fader = new Fader(w, h);
    void this.fader.fadeTo(1, 0);
    this.uiLayer.addChild(this.messageBox, this.choiceMenu);
    this.stage.root.addChild(this.mapLayer, this.sceneLayer, this.uiLayer, this.fader);

    await this.session.load();
    const { options } = this.ctx;
    if (options.skipTitle || options.startMap) this.spawn(() => this.startNewGame(options));
    else this.spawn(() => this.showTitle());
  }

  update(dt: number): void {
    if (!this.stage || this.destroyed) return;
    this.flow.update(dt);
    this.tweens.update(dt);
    this.fader.update(dt);
    this.messageBox.update(dt);
    this.battleScene?.update(dt);
    if (this.mode === 'map') this.updateMap(dt);
  }

  destroy(): void {
    this.destroyed = true;
    this.epoch++;
    this.flow.cancelAll();
    this.session.stopMusic();
    this.session.dispose();
    this.stage?.destroy();
    this.stage = null;
  }

  serialize(): unknown {
    return this.session.serialize();
  }

  async deserialize(state: unknown): Promise<void> {
    if (!this.stage) {
      this.session.deserialize(state);
      return;
    }
    this.resetUi();
    this.session.deserialize(state);
    void this.fader.fadeTo(1, 0);
    const epoch = this.epoch;
    try {
      await this.enterMap();
    } catch (error) {
      if (!(error instanceof Cancelled) || epoch === this.epoch) throw error;
    }
  }

  getDebugState(): Record<string, unknown> {
    return this.session.getDebugState();
  }

  setDebugValue(path: string, value: unknown): void {
    this.session.setDebugValue(path, value);
  }

  // -------------------------------------------------------------------------
  // Outils de séquence
  // -------------------------------------------------------------------------

  /** Lance une séquence asynchrone ; les erreurs sont journalisées, les interruptions ignorées. */
  private spawn(task: () => Promise<void>): void {
    task().catch((error: unknown) => {
      if (error instanceof Cancelled || this.destroyed) return;
      const err = error instanceof Error ? error : new Error(String(error));
      this.ctx.log('error', err.message);
      this.ctx.events.emit('error', { error: err });
    });
  }

  private guard(epoch: number): void {
    if (epoch !== this.epoch || this.destroyed) throw new Cancelled();
  }

  private async fade(alpha: number, seconds: number): Promise<void> {
    const epoch = this.epoch;
    await this.fader.fadeTo(alpha, seconds);
    this.guard(epoch);
  }

  /** Interrompt toutes les séquences et remet l'interface à zéro. */
  private resetUi(): void {
    this.epoch++;
    this.flow.cancelAll();
    this.handling = false;
    this.rebuilding = false;
    this.messageBox.hide();
    this.choiceMenu.close();
    this.setScene(null);
    this.mapLayer.visible = true;
    this.mode = 'loading';
  }

  private setScene(scene: Container | null): void {
    if (this.scene) this.scene.destroy({ children: true });
    this.scene = scene;
    this.battleScene = scene instanceof BattleScene ? scene : null;
    if (scene) this.sceneLayer.addChild(scene);
  }

  private confirmPressed(): boolean {
    const { input } = this.ctx;
    if (input.justPressed('confirm')) {
      input.consume('confirm');
      return true;
    }
    if (input.pointer.justPressed) {
      input.consumePointer();
      return true;
    }
    return false;
  }

  private cancelPressed(): boolean {
    const { input } = this.ctx;
    if (!input.justPressed('cancel')) return false;
    input.consume('cancel');
    return true;
  }

  private sfx(key: SystemSfx): void {
    this.session.playSystemSfx(key);
  }

  private async choose(menu: ChoiceMenu, items: ChoiceItem[], options: ChooseOptions = {}): Promise<number> {
    const { keepOpen, onSelect, ...open } = options;
    menu.open(items, open);
    const state = { result: null as number | null, last: menu.selectedIndex };
    onSelect?.(state.last);
    await this.flow.until(() => {
      state.result = menu.handleInput(this.ctx.input);
      if (menu.selectedIndex !== state.last) {
        state.last = menu.selectedIndex;
        this.sfx('cursor');
        onSelect?.(state.last);
      }
      return state.result !== null;
    });
    if (!keepOpen) menu.close();
    const result = state.result ?? -1;
    this.sfx(result < 0 ? 'cancel' : 'confirm');
    return result;
  }

  private waitConfirm(options: { cancel?: boolean } = {}): Promise<void> {
    return this.flow.until(() => this.confirmPressed() || (options.cancel === true && this.cancelPressed()));
  }

  private pause(seconds: number): Promise<void> {
    const end = this.flow.now + seconds;
    return this.flow.until(() => this.confirmPressed() || this.flow.now >= end);
  }

  private async texture(ref: string | undefined, kind: AssetKind, pixelArt: boolean): Promise<Texture | null> {
    const url = this.session.assetUrl(ref, kind);
    if (!url) return null;
    const texture = await tryLoadTexture(url, { pixelArt });
    if (!texture && !this.warned.has(url)) {
      this.warned.add(url);
      this.ctx.log('warn', `Image illisible : « ${ref} » (remplacée par une forme simple).`);
    }
    return texture;
  }

  private createSceneContext(): SceneContext {
    const stage = this.stage as Stage;
    return {
      session: this.session,
      input: this.ctx.input,
      i18n: this.ctx.i18n,
      flow: this.flow,
      tweens: this.tweens,
      renderer: stage.app.renderer,
      width: this.width,
      height: this.height,
      theme: RPG_THEME,
      debug: this.ctx.options.debug === true,
      choose: (menu, items, options) => this.choose(menu, items, options),
      waitConfirm: (options) => this.waitConfirm(options),
      pause: (seconds) => this.pause(seconds),
      sfx: (key) => this.sfx(key),
      texture: (ref, kind, pixelArt) => this.texture(ref, kind, pixelArt),
      saveSlots: () => this.saveSlots(),
      save: (slot) => this.save(slot),
      load: (slot) => this.loadFromMenu(slot),
    };
  }

  // -------------------------------------------------------------------------
  // Carte
  // -------------------------------------------------------------------------

  private updateMap(dt: number): void {
    const world = this.session.world;
    const view = this.mapView;
    if (!world || !view) return;
    const request = world.request;
    if (request && !this.handling) {
      this.handling = true;
      const epoch = this.epoch;
      this.spawn(async () => {
        try {
          await this.handleRequest(request);
        } finally {
          if (epoch === this.epoch) this.handling = false;
        }
      });
    }
    let input: WorldInput = NO_INPUT;
    if (!this.handling && !world.request) {
      const keys = this.ctx.input;
      const menuKey = keys.justPressed('menu') || keys.justPressed('cancel');
      if (menuKey && !world.busy && !world.player.moving && world.state.flags.menu) {
        keys.consume('menu');
        keys.consume('cancel');
        this.spawn(() => this.openMenu());
        return;
      }
      input = { direction: keys.direction(), action: keys.justPressed('confirm'), dash: keys.isDown('dash') };
    }
    world.update(dt, input);
    if (view.shows(world)) view.sync(world);
    else if (!this.rebuilding && !this.handling) this.spawn(() => this.rebuildMap());
  }

  private async rebuildMap(): Promise<void> {
    const world = this.session.world;
    if (!world || !this.mapView) return;
    const epoch = this.epoch;
    this.rebuilding = true;
    try {
      await this.mapView.build(world);
    } finally {
      this.rebuilding = false;
    }
    this.guard(epoch);
  }

  private async enterMap(): Promise<void> {
    this.messageBox.hide();
    this.mapLayer.visible = true;
    await this.rebuildMap();
    this.mode = 'map';
    await this.fade(0, 0.4);
  }

  private async startNewGame(overrides: StartOverrides): Promise<void> {
    this.session.newGame(overrides);
    await this.enterMap();
  }

  private async handleRequest(request: WorldRequest): Promise<void> {
    switch (request.kind) {
      case 'message':
        return this.showMessage(request);
      case 'choice':
        return this.showChoice(request);
      case 'teleport':
        return this.teleport();
      case 'battle':
        return this.battle(request);
      case 'gameOver':
        return this.gameOver();
      case 'returnToTitle':
        await this.fade(1, 0.5);
        return this.showTitle();
    }
  }

  /** Masque la fenêtre de message sauf si la demande suivante l'utilise encore. */
  private hideMessageUnlessContinued(): void {
    const next = this.session.world?.request;
    if (next?.kind !== 'message' && next?.kind !== 'choice') this.messageBox.hide();
  }

  private async showMessage(request: { speaker?: string; text: string }): Promise<void> {
    this.messageBox.show(request.text, request.speaker ? { name: request.speaker } : null);
    await this.flow.until(() => {
      if (!this.confirmPressed()) return false;
      if (!this.messageBox.typing) return true;
      this.messageBox.skipTyping();
      return false;
    });
    this.session.world?.resume();
    this.hideMessageUnlessContinued();
  }

  private async showChoice(request: Extract<WorldRequest, { kind: 'choice' }>): Promise<void> {
    const style = textStyle(RPG_THEME);
    const widest = Math.max(...request.options.map((o) => CanvasTextMetrics.measureText(o, style).width), 120);
    const menuW = Math.min(this.width * 0.6, widest + RPG_THEME.padding * 3);
    const menuH = choiceMenuHeight(RPG_THEME, request.options.length);
    const y = this.messageBox.visible ? Math.max(12, this.messageBox.y - menuH - 12) : (this.height - menuH) / 2;
    const index = await this.choose(
      this.choiceMenu,
      request.options.map((label) => ({ label })),
      { x: this.width - 20 - menuW / 2, y, width: menuW, cancelable: request.cancelIndex !== null },
    );
    this.session.world?.resume(index);
    this.hideMessageUnlessContinued();
  }

  private async teleport(): Promise<void> {
    await this.fade(1, 0.25);
    this.session.world?.resume();
    await this.rebuildMap();
    await this.fade(0, 0.25);
  }

  private async battle(request: BattleRequest): Promise<void> {
    const { session } = this;
    const epoch = this.epoch;
    this.mode = 'battle';
    this.messageBox.hide();
    session.playMusic(session.project.system.battleMusic);
    await this.fade(1, 0.35);
    let result: BattleResult = 'escape';
    try {
      const scene = new BattleScene(this.scenes, session.createBattle(request));
      this.setScene(scene);
      this.mapLayer.visible = false;
      await scene.build();
      this.guard(epoch);
      await this.fade(0, 0.35);
      result = await scene.run();
      await this.fade(1, 0.4);
    } catch (error) {
      if (error instanceof Cancelled) throw error;
      this.ctx.log('error', `Combat interrompu : ${error instanceof Error ? error.message : String(error)}`);
    }
    this.setScene(null);
    this.mapLayer.visible = true;
    this.mode = 'map';
    const gameOver = result === 'lose' && !request.canLose;
    session.finishBattle(request, result);
    if (gameOver) return;
    session.playMapMusic();
    const world = session.world;
    if (world && this.mapView?.shows(world)) this.mapView.sync(world);
    await this.fade(0, 0.4);
  }

  private async gameOver(): Promise<void> {
    this.mode = 'gameover';
    this.messageBox.hide();
    this.ctx.events.emit('game-end', { reason: 'gameover' });
    this.session.stopMusic();
    await this.fade(1, 0.5);
    this.setScene(new GameOverScreen(this.scenes));
    this.mapLayer.visible = false;
    await this.fade(0, 0.8);
    await this.waitConfirm();
    await this.fade(1, 0.6);
    this.setScene(null);
    await this.showTitle();
  }

  // -------------------------------------------------------------------------
  // Titre et menu
  // -------------------------------------------------------------------------

  private async showTitle(): Promise<void> {
    const epoch = this.epoch;
    this.mode = 'title';
    this.messageBox.hide();
    this.choiceMenu.close();
    this.mapLayer.visible = false;
    this.mapView?.clear();
    this.session.dispose();
    const system = this.session.project.system;
    const screen = new TitleScreen(this.scenes, system.title);
    this.setScene(screen);
    if (system.titleMusic) this.session.playMusic(system.titleMusic);
    else this.session.stopMusic();
    await this.fade(0, 0.5);
    for (;;) {
      const slots = await this.saveSlots();
      this.guard(epoch);
      const hasSave = slots.some((s) => s.exists);
      const choice = await this.choose(
        screen.menu,
        [{ label: this.t('menu.newGame') }, { label: this.t('menu.continue'), enabled: hasSave }],
        { x: this.width / 2, y: this.height * 0.6, width: 320, initialIndex: hasSave ? 1 : 0 },
      );
      if (choice === 0) {
        await this.fade(1, 0.5);
        this.setScene(null);
        return this.startNewGame({});
      }
      if (choice !== 1) continue;
      const pick = await this.choose(
        screen.menu,
        slots.map((s) => ({ label: s.label, enabled: s.exists })),
        { x: this.width / 2, y: this.height * 0.55, width: Math.min(this.width - 80, 680), cancelable: true },
      );
      const slot = slots[pick];
      if (!slot) continue;
      await this.fade(1, 0.4);
      if (await this.loadSlot(slot.slot)) {
        this.guard(epoch);
        this.setScene(null);
        this.mode = 'map';
        await this.fade(0, 0.4);
        return;
      }
      await this.fade(0, 0.3);
    }
  }

  private async openMenu(): Promise<void> {
    this.mode = 'menu';
    this.sfx('confirm');
    const scene = new MenuScene(this.scenes);
    this.setScene(scene);
    const result = await scene.run();
    this.setScene(null);
    if (result === 'title') {
      await this.fade(1, 0.5);
      await this.showTitle();
      return;
    }
    this.mode = 'map';
    if (result === 'loaded') await this.fade(0, 0.4);
  }

  // -------------------------------------------------------------------------
  // Sauvegardes
  // -------------------------------------------------------------------------

  private async saveSlots(): Promise<SlotView[]> {
    let infos: Awaited<ReturnType<RuntimeContext['saves']['list']>> = [];
    try {
      infos = await this.ctx.saves.list();
    } catch (error) {
      this.ctx.log('warn', `Sauvegardes illisibles : ${error instanceof Error ? error.message : String(error)}`);
    }
    return SAVE_SLOTS.map((slot, i) => {
      const info = infos.find((s) => s.slot === slot);
      const name = this.t('rpg.slot', { n: i + 1 });
      if (!info) return { slot, exists: false, label: `${name} — ${this.t('save.empty')}` };
      const date = new Date(info.savedAt);
      const format = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' } as const;
      const when = Number.isNaN(date.getTime()) ? '' : ` (${date.toLocaleString(this.ctx.i18n.locale, format)})`;
      return { slot, exists: true, label: `${name} — ${info.label}${when}` };
    });
  }

  private async save(slot: string): Promise<boolean> {
    const state = this.session.serialize();
    if (!state || !state.flags.save) return false;
    const leader = state.party[0];
    const mapName = this.session.world?.map.name || state.map;
    const label = leader ? `${mapName} — ${leader.name} ${this.t('rpg.level')} ${leader.level}` : mapName;
    try {
      await this.ctx.saves.save(slot, state, label, Math.floor(state.playTime));
    } catch (error) {
      this.ctx.log('warn', `Sauvegarde impossible : ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    this.ctx.log('info', this.t('save.saved'));
    return true;
  }

  /** Charge un emplacement et reconstruit la carte (écran déjà au noir). */
  private async loadSlot(slot: string): Promise<boolean> {
    const epoch = this.epoch;
    try {
      const data = await this.ctx.saves.load(slot);
      this.guard(epoch);
      if (!data) return false;
      this.session.deserialize(data.state);
    } catch (error) {
      if (error instanceof Cancelled) throw error;
      this.ctx.log('warn', `${this.t('rpg.loadFailed')} ${error instanceof Error ? error.message : ''}`);
      return false;
    }
    this.messageBox.hide();
    this.mapLayer.visible = true;
    await this.rebuildMap();
    this.ctx.log('info', this.t('save.loaded'));
    return true;
  }

  private async loadFromMenu(slot: string): Promise<boolean> {
    await this.fade(1, 0.3);
    const ok = await this.loadSlot(slot);
    if (!ok) await this.fade(0, 0.2);
    return ok;
  }
}
