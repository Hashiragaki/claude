import type { AssetKind, AssetMeta, AssetRegistry } from '@forge/core';
import type { AudioChannelName } from './types';

/** Une référence ressemble-t-elle à un chemin de fichier du projet ? */
export function looksLikePath(ref: string): boolean {
  return /[\\/]/.test(ref) || /\.[a-z0-9]{2,5}$/i.test(ref.trim());
}

/** Asset image d'une référence (alias avec repli sur les préfixes, id ou chemin). */
export function resolveImageAsset(assets: AssetRegistry, ref: string): AssetMeta | undefined {
  return assets.resolve(ref, 'image');
}

/** Asset audio : type attendu pour le canal, puis l'autre type audio, puis n'importe quel type. */
export function resolveAudioAsset(
  assets: AssetRegistry,
  ref: string,
  channel: AudioChannelName,
): AssetMeta | undefined {
  const kinds: AssetKind[] = channel === 'music' ? ['music', 'sfx'] : ['sfx', 'music'];
  for (const kind of kinds) {
    const found = assets.resolve(ref, kind);
    if (found) return found;
  }
  return assets.resolve(ref);
}
