import { MemoryProjectFiles, PROJECT_FORMAT, Rng, type AssetMeta, type ProjectTemplate } from '@forge/core';
import { MapBuilder } from './mapBuilder';
import {
  RpgDatabaseSchema,
  RpgSystemSchema,
  type Direction,
  type RpgDatabaseInput,
  type RpgMap,
  type RpgSystemInput,
} from './schema';
import type { GameState } from './state';
import { GENERATOR_KINDS } from './templates/assets';
import { NO_INPUT, RpgWorld, type WorldInput } from './world';

/** Outils partagés par les tests (non exportés par le paquet). */

export const DT = 1 / 60;

export const TEST_DATABASE: RpgDatabaseInput = {
  actors: [
    {
      id: 'hero',
      name: 'Héros',
      charset: 'chara hero',
      maxHp: 50,
      maxMp: 20,
      atk: 12,
      def: 8,
      mag: 10,
      agi: 10,
      skills: ['feu', 'soin'],
    },
  ],
  items: [
    { id: 'potion', name: 'Potion', effect: { type: 'heal', value: 30 } },
    { id: 'plume', name: 'Plume', effect: { type: 'revive', value: 10 } },
    { id: 'bombe', name: 'Bombe', effect: { type: 'damage', value: 25 } },
    { id: 'cle', name: 'Clé', key: true, consumable: false },
  ],
  skills: [
    { id: 'feu', name: 'Feu', mpCost: 4, power: 10, type: 'damage', target: 'enemy' },
    { id: 'soin', name: 'Soin', mpCost: 3, power: 10, type: 'heal', target: 'ally' },
  ],
  enemies: [
    { id: 'slime', name: 'Slime', battler: 'battler slime', maxHp: 20, atk: 8, def: 4, agi: 4, exp: 10, gold: 7 },
  ],
  troops: [{ id: 'slimes', name: 'Slimes', members: ['slime', 'slime'] }],
};

/** Carte d'herbe vide (bordure non bloquante), taille par défaut 10×8. */
export function grassMap(id = 'test', width = 10, height = 8): MapBuilder {
  return new MapBuilder(id, { width, height, tileset: 'tiles test' });
}

export function makeWorld(
  maps: RpgMap[],
  options: { system?: Partial<RpgSystemInput>; database?: RpgDatabaseInput; seed?: number; state?: GameState } = {},
): RpgWorld {
  const system = RpgSystemSchema.parse({
    startMap: maps[0]?.id ?? 'test',
    startX: 1,
    startY: 1,
    party: ['hero'],
    ...options.system,
  });
  return new RpgWorld({
    system,
    database: RpgDatabaseSchema.parse(options.database ?? TEST_DATABASE),
    maps: new Map(maps.map((m) => [m.id, m])),
    rng: new Rng(options.seed ?? 1),
    state: options.state,
  });
}

export function frames(world: RpgWorld, count: number, input: WorldInput = NO_INPUT): void {
  for (let i = 0; i < count; i++) world.update(DT, input);
}

/** Un pas (ou un demi-tour si bloqué) dans une direction, attendu jusqu'à l'arrêt. */
export function stepPlayer(world: RpgWorld, dir: Direction): void {
  world.update(DT, { direction: dir, action: false, dash: false });
  for (let i = 0; i < 240 && world.player.moving; i++) world.update(DT, NO_INPUT);
}

/** Suit un chemin ; s'arrête si une demande (message, téléportation…) apparaît. */
export function walkPath(world: RpgWorld, path: Direction[]): void {
  for (const dir of path) {
    if (world.request || world.busy) return;
    stepPlayer(world, dir);
  }
}

/** Marche jusqu'à une case (ou à côté avec `adjacent`) en recalculant le chemin à chaque pas. */
export function walkTo(world: RpgWorld, x: number, y: number, adjacent = false): void {
  for (let guard = 0; guard < 400; guard++) {
    const done = adjacent
      ? Math.abs(world.player.x - x) + Math.abs(world.player.y - y) === 1
      : world.player.x === x && world.player.y === y;
    if (done || world.request || world.busy) return;
    const path = world.findPath(x, y, { adjacent });
    if (!path) throw new Error(`Aucun chemin vers (${x}, ${y}) depuis (${world.player.x}, ${world.player.y})`);
    if (path.length === 0) return;
    stepPlayer(world, path[0] as Direction);
  }
  throw new Error(`Impossible d'atteindre (${x}, ${y})`);
}

/** Se tourne vers une case voisine (bloquée) et appuie sur le bouton d'action. */
export function interact(world: RpgWorld, x: number, y: number): void {
  const dx = x - world.player.x;
  const dy = y - world.player.y;
  const dir: Direction = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
  world.player.direction = dir;
  world.update(DT, { direction: null, action: true, dash: false });
}

/** Rejoint un événement (qui peut se déplacer) et lui parle. */
export function talkTo(world: RpgWorld, id: string): void {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ev = world.event(id);
    if (!ev) throw new Error(`Événement introuvable : ${id}`);
    walkTo(world, ev.x, ev.y, true);
    if (world.request || world.busy) return;
    if (Math.abs(world.player.x - ev.x) + Math.abs(world.player.y - ev.y) === 1) {
      interact(world, ev.x, ev.y);
      if (world.request || world.busy) return;
    }
  }
  throw new Error(`Impossible de parler à ${id}`);
}

/** Acquitte les messages et choix en attente (`choices` = index à choisir, dans l'ordre). */
export function answer(world: RpgWorld, choices: number[] = []): string[] {
  const texts: string[] = [];
  for (let guard = 0; guard < 200; guard++) {
    const req = world.request;
    if (req?.kind === 'message') {
      texts.push(req.text);
      world.resume();
    } else if (req?.kind === 'choice') {
      world.resume(choices.shift() ?? 0);
    } else if (req?.kind === 'teleport') {
      world.resume();
    } else if (world.busy) {
      world.update(DT, NO_INPUT);
    } else {
      return texts;
    }
  }
  throw new Error('Trop de demandes en attente');
}

/** Métadonnées d'assets fictives correspondant aux demandes d'un modèle de projet. */
export function templateAssets(template: ProjectTemplate): AssetMeta[] {
  return template.assets.map((a, i) => ({
    id: `asset_${i}`,
    kind: GENERATOR_KINDS[a.generator] ?? 'image',
    name: a.name,
    alias: a.alias,
    file: `assets/${i}.bin`,
    extra: {},
    mime: 'application/octet-stream',
    tags: a.tags ?? [],
    origin: 'template',
    version: 1,
    info: {},
    createdAt: '2026-01-01T00:00:00.000Z',
  }));
}

/** Fichiers d'un modèle en mémoire, avec un manifeste complet. */
export function templateFiles(template: ProjectTemplate, id = 'projet'): MemoryProjectFiles {
  const files = new MemoryProjectFiles();
  for (const f of template.files) files.write(f.path, f.content);
  files.write('project.json', {
    format: PROJECT_FORMAT,
    id,
    name: template.name,
    mode: 'rpg',
    entry: template.manifest.entry,
    resolution: template.manifest.resolution,
    pixelArt: template.manifest.pixelArt,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assets: templateAssets(template),
  });
  return files;
}
