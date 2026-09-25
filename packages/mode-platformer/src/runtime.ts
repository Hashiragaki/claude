import { TILE_SIZE, type AssetKind, type GameRuntime, type RuntimeContext, type TilesetInfo } from '@forge/core';
import { createStage, tryLoadTexture, type Stage } from '@forge/render2d';
import { Container, type Texture } from 'pixi.js';
import { PlatformerSession } from './session';
import { PlatformerStateSchema, type PlatformerLevel, type PlatformerSfx, type PlatformerSystem } from './schema';
import type { PlayerView, PlatformerInput, WorldEvent } from './types';
import { followCamera, initialCamera, type CameraState } from './view/camera';
import type { PlatformViewContext } from './view/context';
import { EntityLayer, PlayerSprite } from './view/entities';
import { Hud, SignBubble } from './view/hud';
import { BackgroundView, LevelView } from './view/levelView';
import { loadPlatformerProject } from './view/loader';
import { EndScreen, LevelCompleteBanner, PauseOverlay, TitleScreen } from './view/screens';
import { DEFAULT_PLATFORM_TILESET_INFO, loadCharsetFrames, type CharsetFrames } from './view/textures';

type Mode = 'loading' | 'title' | 'playing' | 'paused' | 'gameover' | 'victory';

/**
 * Runtime PixiJS du mode plateformer : écran titre, niveau (tuiles, joueur, ennemis, entités),
 * caméra, HUD, pause et écrans de fin. Aucune logique de jeu ici : `update(dt)` appelle
 * `session.step(dt, input)` puis lit `world.player()` / `world.entities()` / `session.hud()` pour
 * synchroniser l'affichage (même répartition des responsabilités que `mode-rpg/src/runtime.ts`).
 */
export class PlatformerRuntime implements GameRuntime {
  private readonly width: number;
  private readonly height: number;
  private stage: Stage | null = null;
  private viewCtx!: PlatformViewContext;

  private system: PlatformerSystem | null = null;
  private levels = new Map<string, PlatformerLevel>();
  private tilesets = new Map<string, TilesetInfo>();
  private session: PlatformerSession | null = null;

  private background!: BackgroundView;
  private readonly worldLayer = new Container();
  private levelView!: LevelView;
  private entityLayer!: EntityLayer;
  private readonly playerSprite = new PlayerSprite();

  private readonly uiLayer = new Container();
  private hud!: Hud;
  private signBubble!: SignBubble;

  private readonly screenLayer = new Container();
  private screen: Container | null = null;
  private animatedScreen: TitleScreen | EndScreen | null = null;

  private mode: Mode = 'loading';
  private camera: CameraState = { centerX: 0, centerY: 0 };
  private currentLevelId = '';
  private rebuilding = false;
  private time = 0;
  private destroyed = false;
  private readonly warned = new Set<string>();

  constructor(private readonly ctx: RuntimeContext) {
    this.width = ctx.bundle.manifest.resolution.width || 960;
    this.height = ctx.bundle.manifest.resolution.height || 540;
  }

  // -------------------------------------------------------------------------
  // Cycle de vie
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    if (!this.ctx.mount) throw new Error('Le runtime plateformer nécessite un élément d’affichage');
    this.stage = await createStage(this.ctx.mount, {
      width: this.width,
      height: this.height,
      pixelArt: true,
      background: 0x000000,
    });
    this.viewCtx = this.createViewContext();

    this.background = new BackgroundView(this.width, this.height);
    this.levelView = new LevelView(this.viewCtx);
    this.entityLayer = new EntityLayer(this.viewCtx);
    this.hud = new Hud();
    this.signBubble = new SignBubble();

    this.worldLayer.addChild(this.levelView, this.entityLayer, this.playerSprite);
    this.uiLayer.addChild(this.hud, this.signBubble);
    this.stage.root.addChild(this.background, this.worldLayer, this.uiLayer, this.screenLayer);

    const { system, levels, tilesets, problems } = await loadPlatformerProject(this.ctx.bundle.files, {
      assets: this.ctx.assets,
      extraLevels: this.ctx.options.startLevel ? [this.ctx.options.startLevel] : [],
    });
    for (const p of problems) this.ctx.log(p.severity === 'error' ? 'error' : 'warn', `${p.file} : ${p.message}`);
    this.system = system;
    this.levels = levels;
    this.tilesets = tilesets;

    this.playerSprite.setCharset(await this.charset(system.playerCharset));

    this.session = new PlatformerSession(system, this.makeLoadLevel());
    const startLevel = this.ctx.options.startLevel;
    if (startLevel && startLevel !== this.session.hud().level) {
      if (this.levels.has(startLevel)) this.session.startLevel(startLevel);
      else this.ctx.log('warn', `Niveau de départ demandé introuvable : « ${startLevel} ».`);
    }

    await this.enterLevel(this.session.hud().level);
    this.hud.visible = false;
    if (this.ctx.options.skipTitle) this.startPlaying();
    else this.showTitle();
  }

  update(dt: number): void {
    if (this.destroyed || !this.stage) return;
    this.time += dt;
    switch (this.mode) {
      case 'loading':
        return;
      case 'title':
        this.updateTitle(dt);
        return;
      case 'paused':
        this.updatePaused();
        return;
      case 'gameover':
      case 'victory':
        this.updateEnd(dt);
        return;
      case 'playing':
        this.updatePlaying(dt);
        return;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.ctx.audio.stopBgm();
    this.session = null;
    this.stage?.destroy();
    this.stage = null;
  }

  serialize(): unknown {
    return this.session?.state() ?? null;
  }

  async deserialize(state: unknown): Promise<void> {
    if (!this.system) throw new Error('Partie plateformer non démarrée (appeler start() d’abord).');
    const parsed = PlatformerStateSchema.parse(state);
    this.session = new PlatformerSession(this.system, this.makeLoadLevel(), parsed);
    if (!this.stage) return;
    await this.enterLevel(parsed.level);
    this.startPlaying();
  }

  getDebugState(): Record<string, unknown> {
    const session = this.session;
    if (!session) return {};
    const hud = session.hud();
    const player = session.world.player();
    return {
      level: hud.level,
      phase: session.phase,
      position: { x: player.x, y: player.y },
      lives: hud.lives,
      coins: hud.coins,
    };
  }

  // -------------------------------------------------------------------------
  // Chargement des niveaux et des textures
  // -------------------------------------------------------------------------

  private makeLoadLevel(): (id: string) => PlatformerLevel {
    return (id: string): PlatformerLevel => {
      const level = this.levels.get(id);
      if (!level) throw new Error(`Niveau inconnu : « ${id} ».`);
      return level;
    };
  }

  private createViewContext(): PlatformViewContext {
    const stage = this.stage as Stage;
    return {
      renderer: stage.app.renderer,
      assets: this.ctx.assets,
      width: this.width,
      height: this.height,
      debug: this.ctx.options.debug === true,
      texture: (ref, kind) => this.texture(ref, kind),
    };
  }

  private async texture(ref: string | undefined, kind: AssetKind): Promise<Texture | null> {
    if (!ref) return null;
    const meta = this.ctx.assets.resolve(ref, kind);
    if (!meta) {
      if (!this.warned.has(ref)) {
        this.warned.add(ref);
        this.ctx.log('warn', `Asset introuvable : « ${ref} ».`);
      }
      return null;
    }
    const url = this.ctx.assets.url(meta);
    const texture = await tryLoadTexture(url, { pixelArt: true });
    if (!texture && !this.warned.has(url)) {
      this.warned.add(url);
      this.ctx.log('warn', `Image illisible : « ${ref} » (remplacée par une forme simple).`);
    }
    return texture;
  }

  private charset(ref: string): Promise<CharsetFrames | null> {
    return loadCharsetFrames(this.viewCtx, ref);
  }

  /** Reconstruit les vues (tileset, entités, fond) pour le niveau `id` et recentre la caméra. */
  private async enterLevel(id: string): Promise<void> {
    const level = this.levels.get(id);
    if (!level) throw new Error(`Niveau inconnu : « ${id} ».`);
    const tileset = this.tilesets.get(level.tileset) ?? DEFAULT_PLATFORM_TILESET_INFO;
    await Promise.all([
      this.levelView.build(level, tileset),
      this.entityLayer.build(level.entities),
      this.syncBackground(level),
    ]);
    this.currentLevelId = id;
    const session = this.session;
    if (session) this.camera = initialCamera(this.playerCenter(session.world.player()));
    this.playLevelMusic(level);
  }

  private async syncBackground(level: PlatformerLevel): Promise<void> {
    const zoom = this.system?.zoom ?? 1;
    if (level.background) {
      const texture = await this.texture(level.background, 'image');
      if (texture) {
        this.background.setImage(texture, zoom);
        return;
      }
    }
    this.background.setColor(level.backgroundColor);
  }

  private playLevelMusic(level: PlatformerLevel): void {
    const ref = level.music ?? this.system?.levelMusic;
    if (!ref) {
      this.ctx.audio.stopBgm();
      return;
    }
    const meta = this.ctx.assets.resolve(ref, 'music');
    if (!meta) return;
    void this.ctx.audio.playBgm(this.ctx.assets.url(meta));
  }

  // -------------------------------------------------------------------------
  // Son
  // -------------------------------------------------------------------------

  private sfx(key: keyof PlatformerSfx): void {
    const ref = this.system?.sfx[key];
    if (!ref) return;
    const meta = this.ctx.assets.resolve(ref, 'sfx');
    if (!meta) return;
    void this.ctx.audio.playSfx(this.ctx.assets.url(meta));
  }

  private playEventSfx(event: WorldEvent): void {
    switch (event.type) {
      case 'jump':
        return this.sfx('jump');
      case 'coin':
        return this.sfx('coin');
      case 'stomp':
        return this.sfx('stomp');
      case 'spring':
        return this.sfx('spring');
      case 'checkpoint':
        return this.sfx('checkpoint');
      case 'goal':
        return this.sfx('goal');
      case 'death':
        return this.sfx('hurt');
      default:
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Entrées
  // -------------------------------------------------------------------------

  private confirmPressed(): boolean {
    const { input } = this.ctx;
    if (input.justPressed('confirm')) {
      input.consume('confirm');
      return true;
    }
    return false;
  }

  private pausePressed(): boolean {
    const { input } = this.ctx;
    const pressed = input.justPressed('cancel') || input.justPressed('menu');
    if (pressed) {
      input.consume('cancel');
      input.consume('menu');
    }
    return pressed;
  }

  private readWorldInput(): PlatformerInput {
    const { input } = this.ctx;
    return {
      left: input.isDown('left'),
      right: input.isDown('right'),
      jumpHeld: input.isDown('confirm') || input.isDown('up'),
      jumpPressed: input.justPressed('confirm') || input.justPressed('up'),
      down: input.isDown('down'),
    };
  }

  // -------------------------------------------------------------------------
  // Écrans (titre, pause, fin de niveau, fin de partie)
  // -------------------------------------------------------------------------

  private setScreen(screen: Container | null): void {
    if (this.screen) {
      this.screenLayer.removeChild(this.screen);
      this.screen.destroy({ children: true });
    }
    this.screen = screen;
    this.animatedScreen = screen instanceof TitleScreen || screen instanceof EndScreen ? screen : null;
    if (screen) this.screenLayer.addChild(screen);
  }

  private showTitle(): void {
    this.mode = 'title';
    this.hud.visible = false;
    this.signBubble.visible = false;
    const system = this.system as PlatformerSystem;
    this.setScreen(new TitleScreen(this.width, this.height, system.title));
    if (system.titleMusic) {
      const meta = this.ctx.assets.resolve(system.titleMusic, 'music');
      if (meta) void this.ctx.audio.playBgm(this.ctx.assets.url(meta));
    } else {
      this.ctx.audio.stopBgm();
    }
  }

  private startPlaying(): void {
    this.mode = 'playing';
    this.hud.visible = true;
    this.setScreen(null);
    const level = this.levels.get(this.currentLevelId);
    if (level) this.playLevelMusic(level);
  }

  private updateTitle(dt: number): void {
    this.animatedScreen?.update(dt);
    if (this.confirmPressed()) this.startPlaying();
  }

  private enterPaused(): void {
    this.mode = 'paused';
    this.setScreen(new PauseOverlay(this.width, this.height));
  }

  private updatePaused(): void {
    if (this.pausePressed()) {
      this.mode = 'playing';
      this.setScreen(null);
    }
  }

  private showLevelBanner(): void {
    const level = this.levels.get(this.currentLevelId);
    this.setScreen(new LevelCompleteBanner(this.width, this.height, level?.name ?? ''));
  }

  private clearLevelBanner(): void {
    if (this.screen instanceof LevelCompleteBanner) this.setScreen(null);
  }

  private enterGameOver(): void {
    this.mode = 'gameover';
    this.sfx('gameOver');
    this.ctx.events.emit('game-end', { reason: 'gameover' });
    this.ctx.audio.stopBgm();
    this.setScreen(new EndScreen(this.width, this.height, { title: 'Game Over', color: 0xd6403a }));
  }

  private enterVictory(): void {
    this.mode = 'victory';
    this.ctx.events.emit('game-end', { reason: 'end' });
    this.ctx.audio.stopBgm();
    this.setScreen(
      new EndScreen(this.width, this.height, {
        title: 'Victoire !',
        color: 0xffd35a,
        hint: 'Entrée pour recommencer',
      }),
    );
  }

  private updateEnd(dt: number): void {
    this.animatedScreen?.update(dt);
    if (!this.confirmPressed()) return;
    this.mode = 'loading';
    this.restart().catch((error: unknown) => {
      if (this.destroyed) return;
      const err = error instanceof Error ? error : new Error(String(error));
      this.ctx.log('error', err.message);
      this.ctx.events.emit('error', { error: err });
    });
  }

  private async restart(): Promise<void> {
    const system = this.system;
    if (!system) return;
    this.session = new PlatformerSession(system, this.makeLoadLevel());
    const startLevel = this.ctx.options.startLevel;
    if (startLevel && this.levels.has(startLevel) && startLevel !== this.session.hud().level) {
      this.session.startLevel(startLevel);
    }
    await this.enterLevel(this.session.hud().level);
    if (this.destroyed) return;
    this.startPlaying();
  }

  // -------------------------------------------------------------------------
  // Partie en cours
  // -------------------------------------------------------------------------

  private spawnRebuild(id: string): void {
    if (this.rebuilding) return;
    this.rebuilding = true;
    this.enterLevel(id)
      .catch((error: unknown) => {
        if (this.destroyed) return;
        const err = error instanceof Error ? error : new Error(String(error));
        this.ctx.log('error', err.message);
        this.ctx.events.emit('error', { error: err });
      })
      .finally(() => {
        this.rebuilding = false;
      });
  }

  private updatePlaying(dt: number): void {
    const session = this.session;
    if (!session) return;
    if (this.pausePressed()) {
      this.enterPaused();
      return;
    }

    const previousPhase = session.phase;
    const events = session.step(dt, this.readWorldInput());
    for (const event of events) this.playEventSfx(event);
    this.ctx.events.emit('state-changed', { reason: 'step' });

    const newLevelId = session.hud().level;
    if (newLevelId !== this.currentLevelId) this.spawnRebuild(newLevelId);

    if (previousPhase !== 'game-over' && session.phase === 'game-over') return this.enterGameOver();
    if (previousPhase !== 'game-won' && session.phase === 'game-won') return this.enterVictory();
    if (previousPhase !== 'level-complete' && session.phase === 'level-complete') this.showLevelBanner();
    if (previousPhase === 'level-complete' && session.phase === 'playing') this.clearLevelBanner();

    if (!this.rebuilding) this.syncViews(dt);
  }

  private playerCenter(player: PlayerView): { x: number; y: number } {
    return { x: player.x + player.w / 2, y: player.y + player.h / 2 };
  }

  /** Lit `world.player()` / `world.entities()` / `session.hud()` et met à jour tout l'affichage. */
  private syncViews(dt: number): void {
    const session = this.session;
    if (!session) return;
    const world = session.world;
    const player = world.player();
    const zoom = this.system?.zoom ?? 1;
    const viewPx = { width: this.width / zoom, height: this.height / zoom };
    const levelPx = { width: world.level.width * TILE_SIZE, height: world.level.height * TILE_SIZE };
    const cam = followCamera(this.camera, this.playerCenter(player), viewPx, levelPx);
    this.camera = { centerX: cam.centerX, centerY: cam.centerY };

    this.worldLayer.scale.set(zoom);
    this.worldLayer.position.set(-cam.left * zoom, -cam.top * zoom);
    this.background.scroll(cam.left, cam.top, zoom);

    this.levelView.sync(world.grid, cam.left, cam.top, viewPx.width, viewPx.height);
    this.entityLayer.sync(world.entities(), dt, this.time);
    this.playerSprite.sync(player, dt, this.time);
    this.hud.sync(session.hud());

    const sign = world.currentSign();
    if (sign) {
      const anchorX = (sign.x * TILE_SIZE + TILE_SIZE / 2 - cam.left) * zoom;
      const anchorY = (sign.y * TILE_SIZE - cam.top) * zoom;
      this.signBubble.show(sign.text, anchorX, anchorY, this.width);
    } else {
      this.signBubble.hide();
    }
  }
}
