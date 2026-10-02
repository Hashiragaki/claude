import type { AssetKind, GameRuntime, InputManager, RuntimeContext, SaveSlotInfo } from '@forge/core';
import { DEFAULT_THEME, Fader, createStage, type ChoiceItem, type Stage, type UiTheme } from '@forge/render2d';
import { Container } from 'pixi.js';
import { loadPointClickProject } from './loader';
import { PointClickStateSchema, type PointClickState, type PointClickSfx, type Verb } from './schema';
import { PointClickSession } from './session';
import type { PointClickData, SessionEvent, SessionView } from './types';
import { DialogView, HoverLabel, Toast } from './view/dialog-view';
import { InventoryBar } from './view/inventory-bar';
import { SceneView } from './view/scene-view';
import { EndScreen, MenuScreen } from './view/screens';
import { TextureLoader } from './view/textures';
import { cursorFor } from './view/cursors';

const SAVE_SLOTS = ['1', '2', '3', '4', '5', '6'];
/** Durée d'appui (secondes) à partir de laquelle un toucher devient « regarder ». */
const LONG_PRESS = 0.5;
/** Déplacement toléré (pixels de jeu) pendant un appui long. */
const LONG_PRESS_SLOP = 14;
/** Durée du fondu d'entrée dans une scène (secondes). */
const FADE_IN = 0.4;

type Screen = 'loading' | 'title' | 'game';

/** Écran superposé (titre, pause, sauvegardes, fin) : seul celui du dessus reçoit les entrées. */
interface Overlay {
  view: Container;
  update(dt: number, input: InputManager, clicked: boolean): void;
}

interface PointerEventData {
  x: number;
  y: number;
  button: number;
  touch: boolean;
}

interface PressState {
  x: number;
  y: number;
  time: number;
  touch: boolean;
  fired: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Thème de l'interface adapté à la résolution du projet (référence : 720 px de haut). */
function themeFor(height: number): UiTheme {
  const k = Math.max(0.55, Math.min(1.5, height / 720));
  return {
    ...DEFAULT_THEME,
    fontSize: Math.round(DEFAULT_THEME.fontSize * k),
    lineHeight: Math.round(DEFAULT_THEME.lineHeight * k),
    padding: Math.round(DEFAULT_THEME.padding * k),
    radius: Math.round(DEFAULT_THEME.radius * k),
  };
}

/**
 * Runtime PixiJS du mode point & click : écran titre, scène illustrée (fond, zones, personnage), barre
 * d'inventaire, bulles et choix de dialogue, menu pause et sauvegardes. Aucune règle de jeu ici :
 * le runtime transmet les clics (en pixels de scène) à `PointClickSession` et affiche ses instantanés.
 */
export class PointClickRuntime implements GameRuntime {
  private readonly width: number;
  private readonly height: number;
  private readonly theme: UiTheme;
  private stage: Stage | null = null;
  private data: PointClickData | null = null;
  private session: PointClickSession | null = null;
  private loader!: TextureLoader;

  private sceneView!: SceneView;
  private fader!: Fader;
  private inventory!: InventoryBar;
  private dialog!: DialogView;
  private hoverLabel!: HoverLabel;
  private toast!: Toast;
  private screens: Container | null = null;

  private screen: Screen = 'loading';
  private overlays: Overlay[] = [];
  /** Vues retirées, détruites à la frame suivante (jamais pendant un événement Pixi). */
  private trash: Container[] = [];
  private shownMessage: string | null = null;
  private shownChoice: string | null = null;
  private endShown = false;
  private lastPhase = '';
  private lastCursor = '';
  private currentMusic = '';
  private playTime = 0;
  private destroyed = false;

  private queue: PointerEventData[] = [];
  private pointer: { x: number; y: number; inside: boolean; touch: boolean } = {
    x: 0,
    y: 0,
    inside: false,
    touch: false,
  };
  private press: PressState | null = null;
  private detachDom: (() => void) | null = null;

  constructor(private readonly ctx: RuntimeContext) {
    this.width = ctx.bundle.manifest.resolution.width || 1280;
    this.height = ctx.bundle.manifest.resolution.height || 720;
    this.theme = themeFor(this.height);
  }

  // -------------------------------------------------------------------------
  // Cycle de vie
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    const { ctx } = this;
    if (!ctx.mount) throw new Error('Le runtime point & click nécessite un élément d’affichage');
    const data = await loadPointClickProject(ctx.bundle);
    const stage = await createStage(ctx.mount, { width: this.width, height: this.height, background: 0x000000 });
    if (this.destroyed) {
      stage.destroy();
      return;
    }
    this.stage = stage;
    this.data = data;
    this.loader = new TextureLoader(ctx.assets, (level, message) => ctx.log(level, message));

    this.sceneView = new SceneView(this.width, this.height, this.loader, this.theme);
    this.sceneView.setCharset(data.system.playerCharset);
    this.fader = new Fader(this.width, this.height);
    this.inventory = new InventoryBar(this.width, this.height, this.loader, this.theme);
    this.dialog = new DialogView(this.width, this.height, this.theme);
    this.hoverLabel = new HoverLabel(this.width, this.height, this.theme);
    this.toast = new Toast(this.width, this.theme);
    this.screens = new Container();
    stage.root.addChild(
      this.sceneView,
      this.fader,
      this.inventory,
      this.dialog,
      this.hoverLabel,
      this.screens,
      this.toast,
    );
    this.sceneView.visible = false;
    this.inventory.visible = false;
    this.attachDom(stage.app.canvas);

    if (ctx.options.skipTitle) await this.newGame();
    else await this.showTitle();
  }

  update(dt: number): void {
    if (this.destroyed || !this.stage) return;
    for (const view of this.trash.splice(0)) if (!view.destroyed) view.destroy({ children: true });
    this.fader.update(dt);
    this.toast.update(dt);
    const { input } = this.ctx;
    const clicks = this.queue.splice(0);
    const top = this.overlays[this.overlays.length - 1];
    if (top) {
      const clicked = clicks.some((c) => c.button === 0);
      this.press = null;
      top.update(dt, input, clicked);
      this.setCursor('');
      this.hoverLabel.hide();
      return;
    }
    if (this.screen !== 'game' || !this.session) return;
    this.playTime += dt;
    this.updatePress(dt);
    for (const click of clicks) this.handleClick(click);
    this.handleKeys(input);
    if (!this.session) return;
    this.session.update(dt);
    this.syncGame(dt);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.detachDom?.();
    this.detachDom = null;
    this.overlays = [];
    this.queue = [];
    for (const view of this.trash.splice(0)) if (!view.destroyed) view.destroy({ children: true });
    this.ctx.audio.stopAll();
    this.session = null;
    this.stage?.destroy();
    this.stage = null;
  }

  serialize(): unknown {
    return this.session?.serialize() ?? null;
  }

  async deserialize(state: unknown): Promise<void> {
    if (!this.data) throw new Error('Partie point & click non démarrée (appeler start() d’abord).');
    const parsed = PointClickStateSchema.parse(state);
    await this.beginSession(parsed);
  }

  getDebugState(): Record<string, unknown> {
    return this.session?.debugState() ?? {};
  }

  // -------------------------------------------------------------------------
  // Entrées DOM (clic gauche = interagir, clic droit = regarder, toucher long = regarder)
  // -------------------------------------------------------------------------

  private attachDom(canvas: HTMLCanvasElement): void {
    canvas.style.touchAction = 'none';
    canvas.style.userSelect = 'none';
    const toGame = (ev: PointerEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width ? this.width / rect.width : 1;
      const sy = rect.height ? this.height / rect.height : 1;
      return { x: (ev.clientX - rect.left) * sx, y: (ev.clientY - rect.top) * sy };
    };
    const onDown = (ev: PointerEvent) => {
      const { x, y } = toGame(ev);
      const touch = ev.pointerType === 'touch' || ev.pointerType === 'pen';
      this.pointer = { x, y, inside: true, touch };
      if (touch) {
        // Toucher : l'action part au relâchement, sauf appui long (= regarder).
        if (ev.button === 0) this.press = { x, y, time: 0, touch, fired: false };
      } else {
        this.queue.push({ x, y, button: ev.button, touch });
      }
    };
    const onUp = (ev: PointerEvent) => {
      const { x, y } = toGame(ev);
      const press = this.press;
      this.press = null;
      if (!press || !press.touch || press.fired) return;
      if (Math.hypot(x - press.x, y - press.y) <= LONG_PRESS_SLOP * 2)
        this.queue.push({ x, y, button: 0, touch: true });
    };
    const onMove = (ev: PointerEvent) => {
      const { x, y } = toGame(ev);
      this.pointer = { x, y, inside: true, touch: ev.pointerType === 'touch' || ev.pointerType === 'pen' };
    };
    const onLeave = () => {
      this.pointer.inside = false;
    };
    const onContext = (ev: Event) => ev.preventDefault();
    const onCancel = () => {
      this.press = null;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('contextmenu', onContext);
    this.detachDom = () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('contextmenu', onContext);
    };
  }

  /** Appui long tactile : déclenche « regarder » sans attendre le relâchement. */
  private updatePress(dt: number): void {
    const press = this.press;
    if (!press || press.fired) return;
    press.time += dt;
    if (Math.hypot(this.pointer.x - press.x, this.pointer.y - press.y) > LONG_PRESS_SLOP) {
      // Le doigt a bougé : ce n'est plus un appui long (le relâchement ne déclenchera rien non plus).
      press.fired = true;
      return;
    }
    if (press.time >= LONG_PRESS) {
      press.fired = true;
      this.handleClick({ x: press.x, y: press.y, button: 2, touch: true });
    }
  }

  private handleClick(click: PointerEventData): void {
    const session = this.session;
    if (!session) return;
    const verb: Verb = click.button === 2 ? 'look' : 'interact';
    if (click.button !== 0 && click.button !== 2) return;
    const view = session.view();
    switch (view.phase) {
      case 'message':
        this.advanceMessage();
        return;
      case 'explore':
      case 'walking':
        break;
      default:
        return;
    }
    if (this.inventory.covers(click.x, click.y)) {
      const id = this.inventory.hit(click.x, click.y);
      if (!id) return;
      if (verb === 'look') session.lookItem(id);
      else if (view.selectedItem && view.selectedItem !== id) session.useItemOnItem(id);
      else session.selectItem(id);
      return;
    }
    const point = this.sceneView.toScene(click.x, click.y);
    if (!point) return;
    if (verb === 'look' && view.selectedItem && !session.hover(point).hotspot) {
      // Clic droit dans le vide avec un objet en main : on le repose.
      session.selectItem(null);
      return;
    }
    session.click(point, verb);
  }

  private handleKeys(input: InputManager): void {
    const session = this.session;
    if (!session) return;
    const phase = session.view().phase;
    if (phase === 'message' && input.justPressed('confirm')) {
      input.consume('confirm');
      this.advanceMessage();
    }
    if (input.justPressed('cancel') || input.justPressed('menu')) {
      input.consume('cancel');
      input.consume('menu');
      void this.openPause();
    }
  }

  /** Premier appui : affiche tout le texte ; second appui : passe à la suite. */
  private advanceMessage(): void {
    if (this.dialog.typing) {
      this.dialog.skipTyping();
      return;
    }
    this.shownMessage = null;
    this.session?.advance();
  }

  // -------------------------------------------------------------------------
  // Partie en cours
  // -------------------------------------------------------------------------

  private makeSession(state?: PointClickState): PointClickSession {
    const data = this.data as PointClickData;
    const log = (level: 'info' | 'warn' | 'error', message: string) => this.ctx.log(level, message);
    return new PointClickSession(data, state ? { state, log } : { log });
  }

  private async newGame(): Promise<void> {
    this.ctx.audio.stopBgm(300);
    this.currentMusic = '';
    this.playTime = 0;
    await this.beginSession();
  }

  /** Démarre une session (nouvelle partie ou état restauré) et passe en jeu. */
  private async beginSession(state?: PointClickState): Promise<void> {
    this.clearOverlays();
    this.session = this.makeSession(state);
    this.session.start();
    this.screen = 'game';
    this.shownMessage = null;
    this.shownChoice = null;
    this.endShown = false;
    this.lastPhase = '';
    this.press = null;
    this.queue = [];
    this.dialog.hideMessage();
    this.dialog.closeChoices();
    this.sceneView.visible = true;
    this.inventory.visible = true;
    this.fader.alpha = 1;
    this.syncGame(0);
    await this.sceneView.ready();
    if (this.destroyed) return;
    void this.fader.fadeTo(0, FADE_IN);
  }

  private syncGame(dt: number): void {
    const session = this.session;
    if (!session) return;
    const events = session.drainEvents();
    const view = session.view();
    for (const event of events) this.handleEvent(event);

    this.sceneView.sync(view, dt);
    this.inventory.sync(view.inventory, view.selectedItem);
    this.syncDialog(view, dt);
    this.syncHover(view);
    if (view.phase === 'ended' && !this.endShown) this.finish(view);
    if (events.length > 0 || view.phase !== this.lastPhase) {
      this.lastPhase = view.phase;
      this.ctx.events.emit('state-changed', { reason: 'step' });
    }
  }

  private handleEvent(event: SessionEvent): void {
    switch (event.type) {
      case 'scene-changed':
        // Fondu depuis le noir : le changement est déjà fait, on masque le temps de charger le fond.
        this.fader.alpha = 1;
        void this.sceneView.ready().then(() => {
          if (!this.destroyed) void this.fader.fadeTo(0, FADE_IN);
        });
        if (event.previous !== undefined) this.sfx('door');
        return;
      case 'sound':
        this.playSound(event.asset);
        return;
      case 'music':
        this.setMusic(event.asset);
        return;
      case 'item-gained':
        this.sfx('pickup');
        return;
      case 'combined':
        this.sfx('combine');
        return;
      case 'fail':
        this.sfx('fail');
        return;
      case 'item-lost':
      case 'ended':
        return;
    }
  }

  private syncDialog(view: SessionView, dt: number): void {
    const reserved = this.inventory.occupiedHeight;
    if (view.phase === 'message' && view.message) {
      const key = `${view.message.speaker ?? ''}|${view.message.text}`;
      if (this.shownMessage !== key) {
        this.shownMessage = key;
        this.dialog.showMessage(view.message, reserved);
      }
    } else if (this.shownMessage !== null) {
      this.shownMessage = null;
      this.dialog.hideMessage();
    }

    if (view.phase === 'choice' && view.choice) {
      const key = `${view.choice.prompt ?? ''}|${view.choice.options.map((o) => `${o.index}:${o.text}`).join('|')}`;
      if (this.shownChoice !== key) {
        this.shownChoice = key;
        this.dialog.openChoices(view.choice, reserved);
      }
      const picked = this.dialog.pollChoice(this.ctx.input);
      if (picked !== null) {
        this.shownChoice = null;
        this.session?.choose(picked);
      }
    } else if (this.shownChoice !== null) {
      this.shownChoice = null;
      this.dialog.closeChoices();
    }
    this.dialog.update(dt);
  }

  /** Libellé près du curseur et forme du curseur CSS selon ce qui est survolé. */
  private syncHover(view: SessionView): void {
    const session = this.session;
    const free = view.phase === 'explore' || view.phase === 'walking';
    if (!session || !free || !this.pointer.inside || this.pointer.touch) {
      this.hoverLabel.hide();
      this.setCursor(view.phase === 'message' ? 'pointer' : '');
      return;
    }
    const { x, y } = this.pointer;
    const selected = view.inventory.find((i) => i.id === view.selectedItem);
    if (this.inventory.covers(x, y)) {
      const id = this.inventory.hit(x, y);
      const item = view.inventory.find((i) => i.id === id);
      if (!item) {
        this.hoverLabel.hide();
        this.setCursor('');
        return;
      }
      const label = selected && selected.id !== item.id ? `Utiliser ${selected.name} avec ${item.name}` : item.name;
      this.hoverLabel.show(label, x, y);
      this.setCursor('pointer');
      return;
    }
    const point = this.sceneView.toScene(x, y);
    if (!point) {
      this.hoverLabel.hide();
      this.setCursor('');
      return;
    }
    const info = session.hover(point);
    this.hoverLabel.show(info.label, x, y);
    this.setCursor(info.hotspot ? cursorFor(info.hotspot.kind) : selected ? 'crosshair' : '');
  }

  private setCursor(cursor: string): void {
    if (cursor === this.lastCursor) return;
    this.lastCursor = cursor;
    const canvas = this.stage?.app.canvas;
    if (canvas) canvas.style.cursor = cursor;
  }

  private finish(view: SessionView): void {
    this.endShown = true;
    this.ctx.events.emit('game-end', { reason: 'end' });
    this.dialog.hideMessage();
    this.dialog.closeChoices();
    const text = view.endText || this.ctx.i18n.t('game.end');
    const screen = new EndScreen(
      this.width,
      this.height,
      this.theme,
      text,
      'Cliquer ou appuyer sur Entrée pour revenir au titre',
    );
    this.pushOverlay({
      view: screen,
      update: (dt, input, clicked) => {
        if (!screen.update(dt, input, clicked)) return;
        this.ctx.audio.stopBgm(800);
        this.currentMusic = '';
        void this.showTitle();
      },
    });
  }

  // -------------------------------------------------------------------------
  // Écrans : titre, pause, sauvegardes
  // -------------------------------------------------------------------------

  private async showTitle(): Promise<void> {
    const data = this.data;
    if (!data) return;
    this.screen = 'title';
    this.session = null;
    this.clearOverlays();
    this.dialog.hideMessage();
    this.dialog.closeChoices();
    this.shownMessage = null;
    this.shownChoice = null;
    this.sceneView.visible = false;
    this.inventory.visible = false;
    this.fader.alpha = 0;
    const { system } = data;
    const bgRef = system.titleBackground ?? data.scenes.get(system.startScene)?.background;
    const [saves, background] = await Promise.all([this.listSaves(), this.loader.load(bgRef, 'image')]);
    if (this.destroyed || this.screen !== 'title' || this.overlays.length > 0) return;
    this.setMusic(system.titleMusic);

    const { i18n } = this.ctx;
    const entries: { label: string; action: () => void }[] = [
      { label: i18n.t('menu.newGame'), action: () => void this.newGame() },
    ];
    const latest = saves[0];
    if (latest) entries.push({ label: i18n.t('menu.continue'), action: () => void this.loadFrom(latest.slot) });
    if (saves.length > 0) entries.push({ label: i18n.t('menu.load'), action: () => void this.openSaves('load') });
    const screen = new MenuScreen({
      width: this.width,
      height: this.height,
      theme: this.theme,
      title: system.title,
      items: entries.map((e) => ({ label: e.label })),
      background,
      large: true,
    });
    this.pushOverlay({
      view: screen,
      update: () => {
        const index = screen.handleInput(this.ctx.input);
        if (index !== null && index >= 0) entries[index]?.action();
      },
    });
  }

  private async openPause(): Promise<void> {
    if (this.overlays.length > 0 || this.screen !== 'game') return;
    const { i18n } = this.ctx;
    const entries: { label: string; action: () => void }[] = [
      { label: 'Reprendre', action: () => undefined },
      { label: i18n.t('menu.save'), action: () => void this.openSaves('save') },
      { label: i18n.t('menu.load'), action: () => void this.openSaves('load') },
      { label: 'Retour au titre', action: () => void this.showTitle() },
    ];
    const screen = new MenuScreen({
      width: this.width,
      height: this.height,
      theme: this.theme,
      title: 'Pause',
      items: entries.map((e) => ({ label: e.label })),
      cancelable: true,
    });
    const overlay: Overlay = {
      view: screen,
      update: () => {
        const index = screen.handleInput(this.ctx.input);
        if (index === null) return;
        if (index <= 0) this.removeOverlay(overlay);
        else entries[index]?.action();
      },
    };
    this.pushOverlay(overlay);
  }

  private listSaves(): Promise<SaveSlotInfo[]> {
    return this.ctx.saves.list().catch(() => []);
  }

  private formatDate(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(this.ctx.i18n.locale);
  }

  private async openSaves(mode: 'save' | 'load'): Promise<void> {
    const infos = await this.listSaves();
    if (this.destroyed) return;
    const { i18n } = this.ctx;
    const bySlot = new Map(infos.map((info) => [info.slot, info]));
    const items: ChoiceItem[] = SAVE_SLOTS.map((slot, n) => {
      const info = bySlot.get(slot);
      const name = `Emplacement ${n + 1}`;
      if (!info) return { label: `${name} — ${i18n.t('save.empty')}`, enabled: mode === 'save' };
      const label = info.label ? `${info.label} — ` : '';
      return { label: `${name} — ${label}${this.formatDate(info.savedAt)}` };
    });
    items.push({ label: i18n.t('menu.back') });
    const screen = new MenuScreen({
      width: this.width,
      height: this.height,
      theme: this.theme,
      title: i18n.t(mode === 'save' ? 'menu.save' : 'menu.load'),
      items,
      cancelable: true,
    });
    const overlay: Overlay = {
      view: screen,
      update: () => {
        const index = screen.handleInput(this.ctx.input);
        if (index === null) return;
        const slot = SAVE_SLOTS[index];
        if (index < 0 || !slot) this.removeOverlay(overlay);
        else if (mode === 'save') void this.saveTo(slot, overlay);
        else void this.loadFrom(slot);
      },
    };
    this.pushOverlay(overlay);
  }

  private async saveTo(slot: string, overlay: Overlay): Promise<void> {
    const session = this.session;
    if (!session) return;
    try {
      const label = session.view().scene.name || session.view().scene.id;
      await this.ctx.saves.save(slot, session.serialize(), label, this.playTime);
      this.toast.show(this.ctx.i18n.t('save.saved'));
      this.removeOverlay(overlay);
    } catch (error) {
      this.ctx.log('error', `Sauvegarde : ${errorMessage(error)}`);
      this.toast.show('Sauvegarde impossible.');
    }
  }

  private async loadFrom(slot: string): Promise<void> {
    const data = await this.ctx.saves.load(slot).catch(() => null);
    if (this.destroyed) return;
    const parsed = data ? PointClickStateSchema.safeParse(data.state) : null;
    if (!data || !parsed?.success) {
      this.toast.show('Chargement impossible.');
      return;
    }
    this.ctx.audio.stopBgm(300);
    this.currentMusic = '';
    this.playTime = data.playTime;
    await this.beginSession(parsed.data);
    this.toast.show(this.ctx.i18n.t('save.loaded'));
  }

  private pushOverlay(overlay: Overlay): void {
    this.screens?.addChild(overlay.view);
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

  // -------------------------------------------------------------------------
  // Audio
  // -------------------------------------------------------------------------

  private audioUrl(ref: string, kind: AssetKind): string | null {
    const { assets } = this.ctx;
    const meta = assets.resolve(ref, kind) ?? assets.resolve(ref);
    if (meta) return assets.url(meta);
    this.loader.warnOnce(`audio:${ref}`, `Son introuvable : « ${ref} » (aucun asset audio avec cet alias).`);
    return null;
  }

  private setMusic(ref: string | undefined): void {
    const next = ref ?? '';
    if (next === this.currentMusic) return;
    this.currentMusic = next;
    if (!ref) {
      this.ctx.audio.stopBgm(500);
      return;
    }
    const url = this.audioUrl(ref, 'music');
    if (url) this.ctx.audio.playBgm(url, { loop: true }).catch(() => undefined);
  }

  private playSound(ref: string): void {
    const url = this.audioUrl(ref, 'sfx');
    if (url) this.ctx.audio.playSfx(url).catch(() => undefined);
  }

  private sfx(key: keyof PointClickSfx): void {
    const ref = this.data?.system.sfx[key];
    if (ref) this.playSound(ref);
  }
}
