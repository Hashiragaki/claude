import type { Material, Mesh, Object3D, Texture } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

export type { GLTF };

export interface LoadGltfOptions {
  /** Réutilise un chargement déjà fait pour la même URL (activé par défaut). */
  cache?: boolean;
}

const cache = new Map<string, Promise<GLTF>>();
let loader: GLTFLoader | null = null;

/** Charge un modèle glTF/GLB. Les chargements sont mis en cache par URL. */
export function loadGltf(url: string, options: LoadGltfOptions = {}): Promise<GLTF> {
  const useCache = options.cache ?? true;
  if (useCache) {
    const cached = cache.get(url);
    if (cached) return cached;
  }
  loader ??= new GLTFLoader();
  const promise = loader.loadAsync(url);
  if (useCache) {
    cache.set(url, promise);
    // Un échec ne doit pas rester en cache : on pourra réessayer (fichier régénéré…).
    promise.catch(() => {
      if (cache.get(url) === promise) cache.delete(url);
    });
  }
  return promise;
}

/** Retire un modèle du cache et libère ses ressources GPU (géométries, matériaux, textures). */
export async function evictGltf(url: string): Promise<void> {
  const promise = cache.get(url);
  if (!promise) return;
  cache.delete(url);
  try {
    disposeObject3d((await promise).scene);
  } catch {
    // chargement échoué : rien à libérer
  }
}

/** Vide tout le cache (sans libérer : des instances peuvent encore être affichées). */
export function clearGltfCache(): void {
  cache.clear();
}

/**
 * Crée une copie indépendante de la scène d'un glTF, utilisable plusieurs fois (squelettes
 * dupliqués via `SkeletonUtils.clone`). Les maillages projettent et reçoivent les ombres.
 * Géométries et matériaux restent partagés avec l'original.
 */
export function instantiate(gltf: GLTF | Object3D): Object3D {
  const source = (gltf as Object3D).isObject3D ? (gltf as Object3D) : (gltf as GLTF).scene;
  const copy = cloneSkinned(source);
  enableShadows(copy);
  return copy;
}

export function enableShadows(root: Object3D, cast = true, receive = true): void {
  root.traverse((child) => {
    if ((child as Mesh).isMesh) {
      child.castShadow = cast;
      child.receiveShadow = receive;
    }
  });
}

/**
 * Libère géométries, matériaux et textures d'une hiérarchie (uniquement pour des ressources non
 * partagées avec d'autres instances).
 */
export function disposeObject3d(root: Object3D): void {
  const materials = new Set<Material>();
  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh && !(child as { geometry?: unknown }).geometry) return;
    mesh.geometry?.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) for (const m of mat) materials.add(m);
    else if (mat) materials.add(mat);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value && typeof value === 'object' && (value as Texture).isTexture) (value as Texture).dispose();
    }
    material.dispose();
  }
}
