import type { LevelLayerName, PlatformerEntity, PlatformerEntityType, PlatformerLevel } from '@forge/mode-platformer';
import { fillRect, floodFill } from '../map/mapOps';

export type LevelLayerKey = LevelLayerName; // 'terrain' | 'decor'

/** Tableau de couche normalisé à `width * height` (couches vides/éparses remplies de -1). */
export function layerArray(level: PlatformerLevel, layer: LevelLayerKey): number[] {
  const size = level.width * level.height;
  const source = level.layers[layer];
  if (source.length === size) return [...source];
  return Array.from({ length: size }, (_, i) => source[i] ?? -1);
}

export function setLayer(level: PlatformerLevel, layer: LevelLayerKey, values: number[]): PlatformerLevel {
  return { ...level, layers: { ...level.layers, [layer]: values } };
}

// ---------------------------------------------------------------------------
// Édition de tuiles
// ---------------------------------------------------------------------------

export function paintCell(
  level: PlatformerLevel,
  layer: LevelLayerKey,
  cell: { x: number; y: number },
  value: number,
): PlatformerLevel {
  const values = layerArray(level, layer);
  values[cell.y * level.width + cell.x] = value;
  return setLayer(level, layer, values);
}

export function eraseCell(
  level: PlatformerLevel,
  layer: LevelLayerKey,
  cell: { x: number; y: number },
): PlatformerLevel {
  return paintCell(level, layer, cell, -1);
}

export function fillRectLayer(
  level: PlatformerLevel,
  layer: LevelLayerKey,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  value: number,
): PlatformerLevel {
  return setLayer(level, layer, fillRect(layerArray(level, layer), level.width, x0, y0, x1, y1, value));
}

export function floodFillLayer(
  level: PlatformerLevel,
  layer: LevelLayerKey,
  x: number,
  y: number,
  value: number,
): PlatformerLevel {
  return setLayer(level, layer, floodFill(layerArray(level, layer), level.width, level.height, x, y, value));
}

// ---------------------------------------------------------------------------
// Dimensionnement
// ---------------------------------------------------------------------------

export function emptyLevel(id: string, name: string, width: number, height: number, tileset: string): PlatformerLevel {
  return {
    id,
    name,
    width,
    height,
    tileset,
    backgroundColor: '#79c5f2',
    layers: {
      terrain: Array.from({ length: width * height }, () => -1),
      decor: Array.from({ length: width * height }, () => -1),
    },
    playerStart: { x: 1, y: Math.max(0, height - 2) },
    entities: [],
  };
}

/** Redimensionne un niveau en conservant le contenu en haut à gauche. */
export function resizeLevel(level: PlatformerLevel, width: number, height: number): PlatformerLevel {
  const resize = (values: number[]) =>
    Array.from({ length: width * height }, (_, i) => {
      const x = i % width;
      const y = Math.floor(i / width);
      return x < level.width && y < level.height ? (values[y * level.width + x] ?? -1) : -1;
    });
  const clampX = (x: number) => Math.min(Math.max(0, x), Math.max(0, width - 1));
  const clampY = (y: number) => Math.min(Math.max(0, y), Math.max(0, height - 1));
  return {
    ...level,
    width,
    height,
    layers: {
      terrain: resize(layerArray(level, 'terrain')),
      decor: resize(layerArray(level, 'decor')),
    },
    playerStart: { x: clampX(level.playerStart.x), y: clampY(level.playerStart.y) },
    entities: level.entities
      .filter((e) => e.x < width && e.y < height)
      .map((e) => ({ ...e, x: clampX(e.x), y: clampY(e.y) })),
  };
}

// ---------------------------------------------------------------------------
// Entités
// ---------------------------------------------------------------------------

/** Identifiant unique (parmi toutes les entités du niveau) pour une nouvelle entité d'un type. */
export function nextEntityId(entities: PlatformerEntity[], type: PlatformerEntityType): string {
  let n = entities.length + 1;
  while (entities.some((e) => e.id === `${type}${n}`)) n++;
  return `${type}${n}`;
}

/** Entité par défaut d'un type donné (miroir des `.default()` du schéma). */
export function defaultEntity(
  type: PlatformerEntityType,
  id: string,
  cell: { x: number; y: number },
): PlatformerEntity {
  const base = { id, x: cell.x, y: cell.y };
  switch (type) {
    case 'coin':
      return { ...base, type: 'coin' };
    case 'enemy':
      return { ...base, type: 'enemy', kind: 'walker', speed: 30, facing: 'left' };
    case 'spring':
      return { ...base, type: 'spring', power: 380 };
    case 'checkpoint':
      return { ...base, type: 'checkpoint' };
    case 'goal':
      return { ...base, type: 'goal' };
    case 'sign':
      return { ...base, type: 'sign', text: '…' };
  }
}

export function addEntity(
  level: PlatformerLevel,
  type: PlatformerEntityType,
  cell: { x: number; y: number },
): PlatformerLevel {
  const id = nextEntityId(level.entities, type);
  return { ...level, entities: [...level.entities, defaultEntity(type, id, cell)] };
}

export function moveEntity(level: PlatformerLevel, id: string, cell: { x: number; y: number }): PlatformerLevel {
  return { ...level, entities: level.entities.map((e) => (e.id === id ? { ...e, x: cell.x, y: cell.y } : e)) };
}

export function updateEntity(level: PlatformerLevel, entity: PlatformerEntity): PlatformerLevel {
  return { ...level, entities: level.entities.map((e) => (e.id === entity.id ? entity : e)) };
}

export function deleteEntity(level: PlatformerLevel, id: string): PlatformerLevel {
  return { ...level, entities: level.entities.filter((e) => e.id !== id) };
}

export function setPlayerStart(level: PlatformerLevel, cell: { x: number; y: number }): PlatformerLevel {
  return { ...level, playerStart: { x: cell.x, y: cell.y } };
}
