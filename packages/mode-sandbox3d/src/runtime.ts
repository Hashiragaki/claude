import type { GameRuntime, RuntimeContext } from '@forge/core';
import {
  AnimationController,
  ThirdPersonCamera,
  applyFog,
  createDefaultLighting,
  createGround,
  createSky,
  createView3d,
  disposeObject3d,
  evictGltf,
  instantiate,
  loadGltf,
  type GLTF,
  type Lighting,
  type Sky,
  type View3d,
} from '@forge/render3d';
import { BoxGeometry, CapsuleGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { colliderRadius, type InteractionEvent } from './interaction';
import { SandboxOverlay } from './overlay';
import { parseScene, type SceneData, type SceneObject } from './schema';
import { SandboxWorld } from './world';

const DEG2RAD = Math.PI / 180;
/** Au-delà de cette demi-étendue, la zone d'ombre suit le joueur au lieu de couvrir tout le sol. */
const MAX_SHADOW_EXTENT = 30;

interface ObjectView {
  object: SceneObject;
  root: Object3D;
  animation: AnimationController | null;
}

/** Exécution d'une scène « bac à sable 3D » (rendu Three.js + logique pure `SandboxWorld`). */
export class Sandbox3DRuntime implements GameRuntime {
  private data: SceneData | null = null;
  private world: SandboxWorld | null = null;
  private view: View3d | null = null;
  private sky: Sky | null = null;
  private lighting: Lighting | null = null;
  private followShadows = false;
  private camera: ThirdPersonCamera | null = null;
  private ui: SandboxOverlay | null = null;
  private playerRoot: Group | null = null;
  private playerAnimation: AnimationController | null = null;
  private readonly objectViews = new Map<string, ObjectView>();
  private readonly controllers: AnimationController[] = [];
  /** Objets créés ici (sol, capsule, blocs de remplacement) : libérés à la destruction. */
  private readonly owned: Object3D[] = [];
  private readonly loadedUrls = new Set<string>();
  private readonly warned = new Set<string>();
  private headlessYaw = 0;
  private playing = false;
  private destroyed = false;
  private bobTime = 0;

  constructor(private readonly ctx: RuntimeContext) {}

  async start(): Promise<void> {
    const { bundle } = this.ctx;
    const raw = await bundle.files.readJson<unknown>(bundle.manifest.entry);
    const data = parseScene(raw);
    this.data = data;
    this.world = new SandboxWorld(data);
    this.headlessYaw = this.world.cameraYawBehindPlayer();

    if (this.ctx.mount) await this.buildView(this.ctx.mount, data);
    if (this.destroyed) return;
    this.syncPlayer(0, false, 0);
    this.camera?.snap();

    if (this.ui && !this.ctx.options.skipTitle) this.ui.showTitle(data.name, () => this.begin());
    else this.begin();
  }

  /** Lance la partie (après l'écran titre). */
  private begin(): void {
    if (this.playing || this.destroyed) return;
    this.playing = true;
    this.ui?.hideTitle();
    this.view?.canvas.focus({ preventScroll: true });
    void this.ctx.audio.unlock().catch(() => undefined);
    this.startMusic();
  }

  private startMusic(): void {
    const ref = this.data?.music;
    if (!ref) return;
    const meta = this.ctx.assets.resolve(ref, 'music');
    if (!meta) {
      this.ctx.log('warn', `Musique « ${ref} » introuvable.`);
      return;
    }
    this.ctx.audio.playBgm(this.ctx.assets.url(meta)).catch((error: unknown) => {
      this.ctx.log('warn', `Lecture de la musique « ${ref} » impossible : ${errorMessage(error)}`);
    });
  }

  // -------------------------------------------------------------------------
  // Construction de la scène 3D
  // -------------------------------------------------------------------------

  private async buildView(mount: HTMLElement, data: SceneData): Promise<void> {
    const { width, height } = this.ctx.bundle.manifest.resolution;
    const view = createView3d(mount, { fov: 55, near: 0.1, far: 1000, aspect: width / height });
    this.view = view;
    const { scene } = view;

    this.sky = createSky(scene, data.sky);
    const half = data.ground.size / 2;
    this.followShadows = half + 2 > MAX_SHADOW_EXTENT;
    this.lighting = createDefaultLighting(scene, {
      timeOfDay: data.timeOfDay,
      extent: Math.min(half + 2, MAX_SHADOW_EXTENT),
    });
    view.renderer.toneMappingExposure = this.lighting.preset.exposure;
    applyFog(scene, data.fog ?? null);
    this.owned.push(createGround(scene, { size: data.ground.size, color: data.ground.color }));

    // Chargement des modèles (une fois par référence, en parallèle).
    const refs = new Set(data.objects.map((o) => o.model));
    if (data.player.model) refs.add(data.player.model);
    const models = new Map<string, GLTF | null>();
    await Promise.all([...refs].map(async (ref) => models.set(ref, await this.loadModel(ref))));
    if (this.destroyed) return;

    for (const obj of data.objects) this.addObject(scene, obj, models.get(obj.model) ?? null);
    this.buildPlayer(scene, data, data.player.model ? (models.get(data.player.model) ?? null) : null);

    const camera = new ThirdPersonCamera(view.camera, this.playerRoot, {
      distance: data.camera?.distance ?? 6,
      height: data.camera?.height ?? 2.5,
      lookHeight: 1.2 * (data.player.scale ?? 1),
      yaw: this.world?.cameraYawBehindPlayer() ?? 0,
      domElement: view.canvas,
    });
    this.camera = camera;
    this.ui = new SandboxOverlay(view.container, { onDialogClick: () => this.closeDialog() });
  }

  private async loadModel(ref: string): Promise<GLTF | null> {
    const meta = this.ctx.assets.resolve(ref, 'model');
    if (!meta) {
      this.ctx.log('warn', `Modèle « ${ref} » introuvable : remplacé par un bloc.`);
      return null;
    }
    const url = this.ctx.assets.url(meta);
    try {
      const gltf = await loadGltf(url);
      this.loadedUrls.add(url);
      if (this.destroyed) void evictGltf(url);
      return gltf;
    } catch (error) {
      const reason = errorMessage(error);
      this.ctx.log('warn', `Chargement du modèle « ${ref} » impossible (${reason}) : remplacé par un bloc.`);
      return null;
    }
  }

  private addObject(scene: Object3D, obj: SceneObject, gltf: GLTF | null): void {
    const root = gltf ? instantiate(gltf) : this.placeholder(obj);
    root.name = obj.id;
    root.position.set(obj.position[0], obj.position[1], obj.position[2]);
    if (obj.rotation) {
      const [rx, ry, rz] = obj.rotation;
      root.rotation.set(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD);
    }
    if (typeof obj.scale === 'number') root.scale.setScalar(obj.scale);
    else if (obj.scale) root.scale.set(obj.scale[0], obj.scale[1], obj.scale[2]);
    scene.add(root);

    let animation: AnimationController | null = null;
    if (gltf && gltf.animations.length > 0) {
      animation = new AnimationController(root, gltf.animations);
      this.controllers.push(animation);
    }
    if (obj.animation) this.playOn(obj.id, animation, obj.animation, { fadeSeconds: 0 });
    this.objectViews.set(obj.id, { object: obj, root, animation });
  }

  /** Bloc rose signalant un modèle manquant (ne fait jamais planter la scène). */
  private placeholder(obj: SceneObject): Object3D {
    const size = Math.max(0.4, Math.min(colliderRadius(obj) * 2 || 0.8, 3));
    const mesh = new Mesh(
      new BoxGeometry(size, 1, size),
      new MeshStandardMaterial({ color: 0xff5fa2, roughness: 0.6, emissive: 0x33101f }),
    );
    mesh.position.y = 0.5;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const group = new Group();
    group.add(mesh);
    this.owned.push(group);
    return group;
  }

  private buildPlayer(scene: Object3D, data: SceneData, gltf: GLTF | null): void {
    const root = new Group();
    root.name = 'joueur';
    const body = gltf ? instantiate(gltf) : this.capsule();
    body.scale.setScalar(data.player.scale ?? 1);
    root.add(body);
    scene.add(root);
    this.playerRoot = root;
    if (gltf && gltf.animations.length > 0) {
      this.playerAnimation = new AnimationController(body, gltf.animations);
      this.controllers.push(this.playerAnimation);
    }
  }

  /** Personnage de remplacement : capsule avec une visière indiquant la direction. */
  private capsule(): Object3D {
    const group = new Group();
    const body = new Mesh(
      new CapsuleGeometry(0.3, 0.9, 6, 16),
      new MeshStandardMaterial({ color: 0xf2b84b, roughness: 0.55 }),
    );
    body.position.y = 0.75;
    const visor = new Mesh(
      new BoxGeometry(0.34, 0.12, 0.12),
      new MeshStandardMaterial({ color: 0x1d2a3a, roughness: 0.3 }),
    );
    visor.position.set(0, 1.25, 0.26);
    for (const mesh of [body, visor]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.owned.push(group);
    return group;
  }

  // -------------------------------------------------------------------------
  // Boucle
  // -------------------------------------------------------------------------

  update(dt: number): void {
    const world = this.world;
    if (!world || this.destroyed) return;
    for (const controller of this.controllers) controller.update(dt);

    const input = this.ctx.input;
    if (!this.playing) {
      // Entrée lance aussi la partie depuis l'écran titre.
      if (input.justPressed('confirm')) {
        input.consume('confirm');
        this.begin();
      }
      this.camera?.update(dt);
      return;
    }

    const axis = (pos: 'right' | 'up', neg: 'left' | 'down') =>
      (input.isDown(pos) ? 1 : 0) - (input.isDown(neg) ? 1 : 0);
    let confirm = input.justPressed('confirm');
    if (confirm) input.consume('confirm');
    // « Annuler » ferme aussi la boîte de dialogue.
    if (!confirm && world.interactions.active && input.justPressed('cancel')) {
      input.consume('cancel');
      confirm = true;
    }
    const yaw = this.camera ? this.camera.yaw : this.headlessYaw;
    const result = world.step(
      { moveX: axis('right', 'left'), moveY: axis('up', 'down'), run: input.isDown('dash'), confirm },
      yaw,
      dt,
    );
    if (result.event) this.handleInteraction(result.event);
    this.syncPlayer(dt, result.moving, result.speed);
    this.camera?.update(dt);
    this.ui?.setPrompt(world.nearby !== null && world.interactions.active === null);
  }

  render(): void {
    this.view?.render();
  }

  private syncPlayer(dt: number, moving: boolean, speed: number): void {
    const world = this.world;
    const root = this.playerRoot;
    if (!world || !root) return;
    const { x, z, rotation } = world.player;
    root.position.set(x, 0, z);
    root.rotation.y = rotation;
    if (this.lighting && this.followShadows) {
      // Recentrage par paliers de 4 m pour éviter le scintillement des ombres.
      this.lighting.focus({ x: Math.round(x / 4) * 4, y: 0, z: Math.round(z / 4) * 4 });
    }

    const anim = this.playerAnimation;
    const player = this.data?.player;
    if (anim && player) {
      const walk = player.walk ?? (anim.has('walk') ? 'walk' : undefined);
      const idle = player.idle ?? (anim.has('idle') ? 'idle' : undefined);
      if (moving && walk) {
        const timeScale = Math.max(0.5, Math.min(2.2, speed / player.speed));
        this.playOn('joueur', anim, walk, { fadeSeconds: 0.2, timeScale });
      } else if (idle) {
        this.playOn('joueur', anim, idle, { fadeSeconds: 0.25 });
      } else if (anim.current) {
        anim.stop(0.25);
      }
    } else if (!anim && root.children[0]) {
      // Capsule : léger balancement pendant la marche.
      this.bobTime = moving ? this.bobTime + dt * speed * 3 : 0;
      root.children[0].position.y = moving ? Math.abs(Math.sin(this.bobTime)) * 0.06 : 0;
    }
  }

  private handleInteraction(event: InteractionEvent): void {
    if (event.type === 'close') {
      this.ui?.hideDialog();
    } else {
      this.ui?.showDialog(event.text);
      const view = this.objectViews.get(event.objectId);
      if (view && event.animation) {
        // Animation jouée une fois, puis retour à l'animation de base (sinon pose finale gardée).
        this.playOn(event.objectId, view.animation, event.animation, {
          loop: false,
          fadeSeconds: 0.2,
          ...(view.object.animation ? { then: view.object.animation } : {}),
        });
      }
    }
    this.ctx.events.emit('state-changed', { reason: `interaction:${event.type}` });
  }

  private closeDialog(): void {
    const event = this.world?.closeInteraction();
    if (event) this.handleInteraction(event);
  }

  /** Joue une animation ; prévient (une seule fois) si elle n'existe pas. */
  private playOn(
    owner: string,
    controller: AnimationController | null,
    name: string,
    options: Parameters<AnimationController['play']>[1],
  ): void {
    if (controller?.play(name, options)) return;
    if (!this.view) return;
    const key = `${owner}:${name}`;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    const available = controller?.names.join(', ') || 'aucune';
    this.ctx.log('warn', `Animation « ${name} » introuvable pour « ${owner} » (disponibles : ${available}).`);
  }

  // -------------------------------------------------------------------------
  // Sauvegarde, débogage, destruction
  // -------------------------------------------------------------------------

  serialize(): unknown {
    return this.world?.serialize() ?? null;
  }

  deserialize(state: unknown): void {
    const world = this.world;
    if (!world) return;
    if (!world.restore(state)) {
      this.ctx.log('warn', 'Sauvegarde incompatible avec cette scène : ignorée.');
      return;
    }
    this.ui?.hideDialog();
    // Remet chaque objet dans l'état correspondant à la sauvegarde (ex. coffre déjà ouvert).
    for (const [id, view] of this.objectViews) {
      const { object, animation } = view;
      if (!animation) continue;
      const done = world.interactions.hasTriggered(id) && object.interact?.once && object.interact.animation;
      if (done && object.interact?.animation) {
        animation.play(object.interact.animation, { loop: false, atEnd: true, fadeSeconds: 0 });
      } else if (object.animation) {
        animation.play(object.animation, { fadeSeconds: 0 });
      } else {
        animation.stop();
      }
    }
    this.syncPlayer(0, false, 0);
    this.camera?.setYaw(world.cameraYawBehindPlayer(), true);
    this.camera?.snap();
  }

  getDebugState(): Record<string, unknown> {
    return this.world?.debugState() ?? {};
  }

  setDebugValue(path: string, value: unknown): void {
    const world = this.world;
    if (!world || typeof value !== 'number' || !Number.isFinite(value)) return;
    if (path === 'player.x') world.teleport(value, world.player.z);
    else if (path === 'player.z') world.teleport(world.player.x, value);
    else return;
    this.syncPlayer(0, false, 0);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ctx.audio.stopBgm(300);
    this.ui?.destroy();
    this.ui = null;
    this.camera?.detach();
    this.camera = null;
    for (const controller of this.controllers) controller.dispose();
    this.controllers.length = 0;
    for (const object of this.owned) disposeObject3d(object);
    this.owned.length = 0;
    this.sky?.dispose();
    this.lighting?.dispose();
    this.view?.destroy();
    this.view = null;
    for (const url of this.loadedUrls) void evictGltf(url);
    this.loadedUrls.clear();
    this.objectViews.clear();
    this.playerRoot = null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
