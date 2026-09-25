import { Box3, GridHelper, Mesh, PlaneGeometry, ShadowMaterial, Sphere, Vector3, type Object3D } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AnimationController } from './animation';
import { createDefaultLighting, createSky } from './environment';
import { disposeObject3d, enableShadows, loadGltf } from './gltf';
import { DEG2RAD, framingDistance, orbitOffset } from './math';
import { createView3d } from './view';

export interface ModelInfo {
  /** Noms des animations du modèle. */
  animations: string[];
  /** Dimensions de la boîte englobante (mètres). */
  size: { x: number; y: number; z: number };
}

export interface ModelViewer {
  /** Charge un modèle GLB (remplace le précédent) et cadre la caméra dessus. */
  load(url: string): Promise<ModelInfo>;
  /** Joue une animation en boucle, ou revient à la pose de repos avec `null`. */
  playAnimation(name: string | null): void;
  setAutoRotate(enabled: boolean): void;
  /** Capture PNG de la vue courante (data URL). */
  screenshot(): string;
  destroy(): void;
}

export interface ModelViewerOptions {
  /** Couleurs du fond en dégradé. */
  background?: { top: string; bottom: string };
  autoRotate?: boolean;
}

/** Visionneuse de modèles pour l'éditeur : orbite, cadrage automatique, sol, grille et éclairage. */
export function createModelViewer(mount: HTMLElement, options: ModelViewerOptions = {}): ModelViewer {
  const view = createView3d(mount, { fov: 40, near: 0.01, far: 1000 });
  const { scene, camera, renderer } = view;
  const sky = createSky(scene, options.background ?? { top: '#3d4552', bottom: '#1c2027' });
  const lighting = createDefaultLighting(scene, { timeOfDay: 'day', extent: 4, shadowMapSize: 1024 });

  const shadowCatcher = new Mesh(new PlaneGeometry(1, 1), new ShadowMaterial({ opacity: 0.35 }));
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);
  let grid: GridHelper | null = null;

  const controls = new OrbitControls(camera, view.canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = options.autoRotate ?? false;
  controls.autoRotateSpeed = 1.5;
  controls.maxPolarAngle = Math.PI * 0.495;

  let model: Object3D | null = null;
  let animation: AnimationController | null = null;
  let loadToken = 0;
  let destroyed = false;
  let lastTime = performance.now();
  let frame = 0;

  const setGrid = (radius: number) => {
    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      (grid.material as { dispose(): void }).dispose();
    }
    const step = radius > 4 ? 1 : radius > 1 ? 0.25 : 0.1;
    const size = Math.max(2, Math.ceil((radius * 4) / step) * step);
    grid = new GridHelper(size, Math.round(size / step), 0x5d6776, 0x3a414c);
    grid.position.y = 0.001;
    scene.add(grid);
    shadowCatcher.scale.set(size, size, 1);
  };
  setGrid(1);

  const frameObject = (object: Object3D) => {
    const box = new Box3().setFromObject(object);
    const sphere = box.getBoundingSphere(new Sphere());
    const radius = Math.max(sphere.radius, 0.05);
    const distance = framingDistance(radius, camera.fov, camera.aspect || 1, 1.2);
    const offset = orbitOffset(35 * DEG2RAD, 18 * DEG2RAD, distance);
    controls.target.copy(sphere.center);
    camera.position.set(sphere.center.x + offset.x, sphere.center.y + offset.y, sphere.center.z + offset.z);
    camera.near = Math.max(0.005, distance / 100);
    camera.far = Math.max(100, distance * 50);
    camera.updateProjectionMatrix();
    controls.minDistance = radius * 0.3;
    controls.maxDistance = distance * 6;
    controls.update();
    lighting.setExtent(radius * 1.8);
    lighting.focus(sphere.center);
    setGrid(radius);
    return box.getSize(new Vector3());
  };

  const clearModel = () => {
    animation?.dispose();
    animation = null;
    if (model) {
      scene.remove(model);
      disposeObject3d(model);
      model = null;
    }
  };

  const loop = () => {
    if (destroyed) return;
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    animation?.update(dt);
    controls.update(dt);
    view.render();
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);

  return {
    async load(url) {
      const token = ++loadToken;
      // Pas de cache : un asset régénéré peut garder la même URL.
      const gltf = await loadGltf(url, { cache: false });
      if (destroyed || token !== loadToken) {
        disposeObject3d(gltf.scene);
        return { animations: gltf.animations.map((a) => a.name), size: { x: 0, y: 0, z: 0 } };
      }
      clearModel();
      // Chargement non mis en cache : la scène du glTF peut être affichée telle quelle.
      model = gltf.scene;
      enableShadows(model);
      scene.add(model);
      animation = new AnimationController(model, gltf.animations);
      const size = frameObject(model);
      return { animations: animation.names, size: { x: size.x, y: size.y, z: size.z } };
    },
    playAnimation(name) {
      if (!animation) return;
      if (name === null) animation.stop(0.2);
      else animation.play(name, { loop: true, fadeSeconds: 0.2 });
    },
    setAutoRotate(enabled) {
      controls.autoRotate = enabled;
    },
    screenshot() {
      view.render();
      return renderer.domElement.toDataURL('image/png');
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(frame);
      controls.dispose();
      clearModel();
      if (grid) {
        grid.geometry.dispose();
        (grid.material as { dispose(): void }).dispose();
      }
      shadowCatcher.geometry.dispose();
      shadowCatcher.material.dispose();
      sky.dispose();
      lighting.dispose();
      view.destroy();
    },
  };
}
