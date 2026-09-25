import type { AssetMeta } from '@forge/core';
import Box from '@spectrum-icons/workflow/Box';
import Audio from '@spectrum-icons/workflow/Audio';
import { assetUrl } from '../state/app';

export const KIND_LABELS: Record<AssetMeta['kind'], string> = {
  image: 'Image',
  spritesheet: 'Animation 2D',
  charset: 'Personnage RPG',
  tileset: 'Tileset',
  sfx: 'Effet sonore',
  music: 'Musique',
  model: 'Modèle 3D',
};

/** Vignette d'un asset (image réelle pour les visuels, icône pour l'audio et la 3D). */
export function AssetThumb(props: { asset: AssetMeta }) {
  const { asset } = props;
  const pixel = Boolean(asset.info.pixelArt) || asset.kind === 'charset' || asset.kind === 'tileset';
  if (asset.kind === 'image' || asset.kind === 'charset' || asset.kind === 'tileset' || asset.kind === 'spritesheet') {
    return (
      <div className="fg-asset-thumb fg-checker">
        <img
          src={assetUrl(asset)}
          alt={asset.name}
          loading="lazy"
          className={pixel ? 'fg-pixelated' : undefined}
          style={pixel ? { width: '90%', height: '90%', objectFit: 'contain' } : undefined}
        />
      </div>
    );
  }
  const icon = asset.kind === 'model' ? <Box size="L" /> : <Audio size="L" />;
  return (
    <div className="fg-asset-thumb" style={{ background: asset.kind === 'model' ? '#2a2233' : '#1f2a33' }}>
      <div className="fg-kind-icon">
        {icon}
        {KIND_LABELS[asset.kind]}
        {typeof asset.info.duration === 'number' ? ` · ${asset.info.duration} s` : ''}
      </div>
    </div>
  );
}
