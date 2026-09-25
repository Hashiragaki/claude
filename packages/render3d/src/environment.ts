import {
  BackSide,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Object3D,
  type Scene,
} from 'three';
import { DEG2RAD, parseHexColor } from './math';

export type TimeOfDay = 'day' | 'sunset' | 'night';

// ---------------------------------------------------------------------------
// Ciel
// ---------------------------------------------------------------------------

export interface SkyOptions {
  /** Couleur au zénith. */
  top: string | number;
  /** Couleur à l'horizon (et sous l'horizon). */
  bottom: string | number;
  /** Rayon du dôme (doit rester inférieur au `far` de la caméra). */
  radius?: number;
  /** Courbure du dégradé (plus grand = horizon plus large). */
  exponent?: number;
}

export interface Sky {
  mesh: Mesh;
  setColors(top: string | number, bottom: string | number): void;
  dispose(): void;
}

const SKY_VERTEX = /* glsl */ `
varying vec3 vWorldPosition;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 topColor;
uniform vec3 bottomColor;
uniform float exponent;
varying vec3 vWorldPosition;
void main() {
  float h = normalize(vWorldPosition - cameraPosition).y;
  float t = pow(max(h, 0.0), exponent);
  gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
  #include <colorspace_fragment>
}`;

/**
 * Ajoute un dôme de ciel en dégradé vertical (non affecté par le brouillard ni le tone mapping,
 * pour garder les couleurs choisies). Le fond de la scène prend la couleur de l'horizon.
 */
export function createSky(scene: Scene, options: SkyOptions): Sky {
  const uniforms = {
    topColor: { value: new Color(parseHexColor(options.top, 0x6fb7ff)) },
    bottomColor: { value: new Color(parseHexColor(options.bottom, 0xe8f4ff)) },
    exponent: { value: options.exponent ?? 0.6 },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new Mesh(new SphereGeometry(options.radius ?? 450, 32, 16), material);
  mesh.name = 'ciel';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  // Le dôme suit la caméra pour ne jamais être atteint.
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    mesh.position.copy(camera.position);
    mesh.updateMatrixWorld();
  };
  scene.add(mesh);
  scene.background = uniforms.bottomColor.value.clone();

  return {
    mesh,
    setColors(top, bottom) {
      uniforms.topColor.value.set(parseHexColor(top, 0x6fb7ff));
      uniforms.bottomColor.value.set(parseHexColor(bottom, 0xe8f4ff));
      scene.background = uniforms.bottomColor.value.clone();
    },
    dispose() {
      scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
      if (scene.background instanceof Color) scene.background = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Éclairage
// ---------------------------------------------------------------------------

export interface LightingPreset {
  skyColor: number;
  groundColor: number;
  hemisphereIntensity: number;
  sunColor: number;
  sunIntensity: number;
  /** Hauteur du soleil au-dessus de l'horizon (degrés). */
  sunElevation: number;
  /** Direction du soleil autour de Y (degrés). */
  sunAzimuth: number;
  /** Exposition conseillée pour le tone mapping. */
  exposure: number;
}

/** Ambiances lumineuses prédéfinies (intensités physiques de Three.js). */
export const LIGHTING_PRESETS: Record<TimeOfDay, LightingPreset> = {
  day: {
    skyColor: 0xd8ecff,
    groundColor: 0x6b5a45,
    hemisphereIntensity: 1.35,
    sunColor: 0xfff3dc,
    sunIntensity: 2.6,
    sunElevation: 55,
    sunAzimuth: 35,
    exposure: 1,
  },
  sunset: {
    skyColor: 0xffd2b0,
    groundColor: 0x4a3440,
    hemisphereIntensity: 1.0,
    sunColor: 0xffa860,
    sunIntensity: 2.4,
    sunElevation: 14,
    sunAzimuth: 250,
    exposure: 1.05,
  },
  night: {
    skyColor: 0x5a6ea8,
    groundColor: 0x141824,
    hemisphereIntensity: 0.55,
    sunColor: 0xa9bcff,
    sunIntensity: 0.9,
    sunElevation: 40,
    sunAzimuth: 120,
    exposure: 1.15,
  },
};

export interface LightingOptions {
  timeOfDay?: TimeOfDay;
  /** Demi-étendue (mètres) de la zone couverte par les ombres du soleil. */
  extent?: number;
  /** Taille de la texture d'ombre (2048 par défaut). */
  shadowMapSize?: number;
  /** Adoucissement des ombres (rayon PCF). */
  shadowSoftness?: number;
}

export interface Lighting {
  hemisphere: HemisphereLight;
  sun: DirectionalLight;
  preset: LightingPreset;
  /** Recentre la zone d'ombre (ex. sur le joueur) en conservant la direction du soleil. */
  focus(center: { x: number; y: number; z: number }): void;
  /** Ajuste la zone couverte par les ombres. */
  setExtent(extent: number): void;
  dispose(): void;
}

/** Lumière hémisphérique + soleil directionnel avec ombres, selon le moment de la journée. */
export function createDefaultLighting(scene: Scene, options: LightingOptions = {}): Lighting {
  const preset = LIGHTING_PRESETS[options.timeOfDay ?? 'day'];
  const hemisphere = new HemisphereLight(preset.skyColor, preset.groundColor, preset.hemisphereIntensity);
  hemisphere.name = 'lumière ambiante';
  const sun = new DirectionalLight(preset.sunColor, preset.sunIntensity);
  sun.name = 'soleil';
  sun.castShadow = true;
  sun.shadow.mapSize.set(options.shadowMapSize ?? 2048, options.shadowMapSize ?? 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = options.shadowSoftness ?? 3;

  const elevation = preset.sunElevation * DEG2RAD;
  const azimuth = preset.sunAzimuth * DEG2RAD;
  const direction = new Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  );
  let extent = options.extent ?? 20;
  const center = new Vector3();

  const place = () => {
    const distance = extent * 2 + 10;
    sun.position.copy(center).addScaledVector(direction, distance);
    sun.target.position.copy(center);
    sun.target.updateMatrixWorld();
    const cam = sun.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 0.5;
    cam.far = distance * 2;
    cam.updateProjectionMatrix();
  };
  place();

  scene.add(hemisphere, sun, sun.target);
  return {
    hemisphere,
    sun,
    preset,
    focus(point) {
      center.set(point.x, point.y, point.z);
      place();
    },
    setExtent(value) {
      extent = Math.max(1, value);
      place();
    },
    dispose() {
      scene.remove(hemisphere, sun, sun.target);
      sun.shadow.map?.dispose();
      sun.dispose();
      hemisphere.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Brouillard et sol
// ---------------------------------------------------------------------------

export interface FogOptions {
  color: string | number;
  near: number;
  far: number;
}

/** Applique (ou retire, sans options) un brouillard linéaire. */
export function applyFog(scene: Scene, options?: FogOptions | null): Fog | null {
  scene.fog = options ? new Fog(parseHexColor(options.color, 0xffffff), options.near, options.far) : null;
  return scene.fog as Fog | null;
}

export interface GroundOptions {
  /** Côté du carré de sol (mètres). */
  size: number;
  color: string | number;
  /** Variation de teinte aléatoire (0 = uni, 0.06 par défaut) pour un rendu moins plat. */
  variation?: number;
  seed?: number;
}

/** Plan de sol horizontal centré sur l'origine, recevant les ombres. */
export function createGround(scene: Scene | Object3D, options: GroundOptions): Mesh {
  const segments = Math.max(1, Math.min(64, Math.round(options.size / 1.5)));
  const geometry = new PlaneGeometry(options.size, options.size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const variation = options.variation ?? 0.06;
  const base = new Color(parseHexColor(options.color, 0x6aa84f));
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  let state = (options.seed ?? 1337) >>> 0;
  const color = new Color();
  for (let i = 0; i < count; i++) {
    // Petit générateur congruentiel : déterministe et suffisant pour une texture de sol.
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const jitter = (state / 0xffffffff - 0.5) * 2 * variation;
    color.copy(base).offsetHSL(0, 0, jitter);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0 });
  const ground = new Mesh(geometry, material);
  ground.name = 'sol';
  ground.receiveShadow = true;
  scene.add(ground);
  return ground;
}
