import {
  AssetRegistry,
  parseExpression,
  parseStatement,
  type AssetKind,
  type Diagnostic,
  type ProjectBundle,
  type TilesetInfo,
} from '@forge/core';
import { DATABASE_PATH, RpgLoadError, SYSTEM_PATH, loadRpgProject, mapPath, type RpgProjectData } from './loader';
import { DEFAULT_TILESET_INFO, inBounds, isCellPassable, roleTable } from './passability';
import {
  LAYER_NAMES,
  type Command,
  type Condition,
  type RpgDatabase,
  type RpgEvent,
  type RpgMap,
  type RpgSystem,
} from './schema';
import { forEachCommand } from './walk';

/** Contexte de validation : données du projet et, si fourni, registre d'assets. */
export interface ValidationContext {
  system?: RpgSystem;
  database: RpgDatabase;
  maps: ReadonlyMap<string, RpgMap>;
  tilesets?: ReadonlyMap<string, TilesetInfo>;
  /** Sans registre, les références d'assets ne sont pas vérifiées. */
  assets?: AssetRegistry;
}

class Report {
  readonly items: Diagnostic[] = [];
  constructor(private readonly file: string) {}
  error(message: string): void {
    this.items.push({ file: this.file, severity: 'error', message });
  }
  warn(message: string): void {
    this.items.push({ file: this.file, severity: 'warning', message });
  }
}

const KIND_LABEL: Record<AssetKind, string> = {
  image: 'image',
  spritesheet: 'planche de sprites',
  charset: 'charset',
  tileset: 'tileset',
  sfx: 'effet sonore',
  music: 'musique',
  model: 'modèle 3D',
};

function checkAsset(
  report: Report,
  ctx: Pick<ValidationContext, 'assets'>,
  ref: string | undefined,
  kind: AssetKind,
  where: string,
): void {
  if (!ref || !ctx.assets || ctx.assets.resolve(ref, kind)) return;
  report.warn(`${where} : ${KIND_LABEL[kind]} « ${ref} » introuvable dans les assets.`);
}

/** Expressions `[expr]` d'un texte interpolé (`[[` = crochet littéral). */
export function interpolationExpressions(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '[') continue;
    if (text[i + 1] === '[') {
      i++;
      continue;
    }
    let depth = 0;
    let quote: string | null = null;
    let end = -1;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '[') depth++;
      else if (c === ']' && --depth === 0) {
        end = j;
        break;
      }
    }
    if (end < 0) break;
    out.push(text.slice(i + 1, end));
    i = end;
  }
  return out;
}

function syntaxError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function checkText(report: Report, text: string, where: string): void {
  for (const expr of interpolationExpressions(text)) {
    try {
      parseExpression(expr);
    } catch (error) {
      report.error(`${where} : interpolation « [${expr}] » invalide — ${syntaxError(error)}`);
    }
  }
}

interface CommandEnv {
  report: Report;
  ctx: ValidationContext;
  map?: RpgMap;
  event?: RpgEvent;
  where: string;
}

function checkCondition(env: CommandEnv, cond: Condition): void {
  const { report, ctx, where } = env;
  if ('item' in cond && !ctx.database.items.some((i) => i.id === cond.item)) {
    report.error(`${where} : condition sur l'objet inconnu « ${cond.item} ».`);
  }
  if ('selfSwitch' in cond && !env.event) report.error(`${where} : interrupteur local utilisé hors d'un événement.`);
  if ('script' in cond) {
    try {
      parseExpression(cond.script);
    } catch (error) {
      report.error(`${where} : condition « ${cond.script} » invalide — ${syntaxError(error)}`);
    }
  }
}

function checkCommand(env: CommandEnv, command: Command): void {
  const { report, ctx, map, event, where } = env;
  switch (command.type) {
    case 'text':
      checkText(report, command.text, where);
      if (command.speaker) checkText(report, command.speaker, where);
      break;
    case 'choice':
      for (const option of command.options) checkText(report, option.label, where);
      if (command.cancel !== undefined && command.cancel >= command.options.length) {
        const count = command.options.length;
        report.error(`${where} : option d'annulation ${command.cancel} hors limites (${count} options).`);
      }
      break;
    case 'if':
      checkCondition(env, command.condition);
      break;
    case 'setSelfSwitch':
      if (command.event !== undefined && map && !map.events.some((e) => e.id === command.event)) {
        report.warn(`${where} : événement « ${command.event} » introuvable sur la carte.`);
      } else if (command.event === undefined && !event) {
        report.error(`${where} : interrupteur local utilisé hors d'un événement.`);
      }
      break;
    case 'setVariable':
      if (command.op === 'random' && command.max === undefined) {
        report.warn(`${where} : « random » sans valeur « max ».`);
      }
      if ((command.op === 'div' || command.op === 'mod') && command.value === 0) {
        report.warn(`${where} : division par zéro (sans effet).`);
      }
      break;
    case 'giveItem':
      if (!ctx.database.items.some((i) => i.id === command.item)) {
        report.error(`${where} : objet inconnu « ${command.item} ».`);
      }
      break;
    case 'teleport': {
      const target = ctx.maps.get(command.map);
      if (!target) {
        report.error(`${where} : carte de destination introuvable « ${command.map} ».`);
      } else if (!inBounds(target, command.x, command.y)) {
        report.error(`${where} : destination (${command.x}, ${command.y}) hors de la carte « ${command.map} ».`);
      } else {
        const roles = roleTable(ctx.tilesets?.get(target.tileset) ?? DEFAULT_TILESET_INFO);
        if (!isCellPassable(target, roles, command.x, command.y)) {
          report.warn(`${where} : destination (${command.x}, ${command.y}) infranchissable sur « ${command.map} ».`);
        }
      }
      break;
    }
    case 'battle':
      if (!ctx.database.troops.some((t) => t.id === command.troop)) {
        report.error(`${where} : groupe d'ennemis inconnu « ${command.troop} ».`);
      }
      break;
    case 'playSfx':
      checkAsset(report, ctx, command.ref, 'sfx', where);
      break;
    case 'playMusic':
      checkAsset(report, ctx, command.ref, 'music', where);
      break;
    case 'moveRoute': {
      const { target } = command;
      if (target === 'this' && !event) report.error(`${where} : trajet « this » hors d'un événement.`);
      else if (target !== 'player' && target !== 'this' && map && !map.events.some((e) => e.id === target)) {
        report.error(`${where} : cible de trajet inconnue « ${target} ».`);
      }
      break;
    }
    case 'erase':
      if (!event) report.warn(`${where} : « erase » hors d'un événement (sans effet).`);
      break;
    case 'script':
      try {
        parseStatement(command.code);
      } catch (error) {
        report.error(`${where} : script « ${command.code} » invalide — ${syntaxError(error)}`);
      }
      break;
    default:
      break;
  }
}

/** Vérifie une liste de commandes (récursivement). */
export function validateCommands(
  commands: readonly Command[],
  ctx: ValidationContext,
  options: { file: string; where: string; map?: RpgMap; event?: RpgEvent },
): Diagnostic[] {
  const report = new Report(options.file);
  const env: CommandEnv = { report, ctx, map: options.map, event: options.event, where: options.where };
  forEachCommand(commands, (c) => checkCommand(env, c));
  return report.items;
}

/** Vérifie une carte : couches, tuiles, collisions, rencontres, événements et commandes. */
export function validateMap(map: RpgMap, ctx: ValidationContext, file = mapPath(map.id)): Diagnostic[] {
  const report = new Report(file);
  const size = map.width * map.height;
  const info = ctx.tilesets?.get(map.tileset) ?? DEFAULT_TILESET_INFO;
  const roles = roleTable(info);

  for (const layer of LAYER_NAMES) {
    const data = map.layers[layer];
    const optional = layer !== 'ground';
    if (data.length !== size && !(optional && data.length === 0)) {
      report.error(`Couche « ${layer} » : ${data.length} tuiles au lieu de ${size} (${map.width}×${map.height}).`);
      continue;
    }
    const bad = data.findIndex((t) => t !== -1 && !roles.has(t));
    if (bad >= 0) {
      const count = data.filter((t) => t !== -1 && !roles.has(t)).length;
      report.warn(
        `Couche « ${layer} » : ${count} tuile(s) d'index inconnu (première en ${bad % map.width}, ` +
          `${Math.floor(bad / map.width)} : ${data[bad]}).`,
      );
    }
  }
  if (map.collision && map.collision.length !== size && map.collision.length !== 0) {
    report.error(`Collisions : ${map.collision.length} valeurs au lieu de ${size}.`);
  }
  checkAsset(report, ctx, map.tileset, 'tileset', 'Tileset');
  checkAsset(report, ctx, map.music, 'music', 'Musique');

  if (map.encounters) {
    if (map.encounters.troops.length === 0) report.warn('Rencontres : aucun groupe d\'ennemis.');
    for (const troop of map.encounters.troops) {
      if (!ctx.database.troops.some((t) => t.id === troop)) report.error(`Rencontres : groupe inconnu « ${troop} ».`);
    }
    const role = map.encounters.onlyOnRole;
    if (role && !info.tiles.some((t) => t.id === role)) {
      report.warn(`Rencontres : rôle de tuile inconnu « ${role} ».`);
    }
  }

  const ids = new Set<string>();
  for (const event of map.events) {
    const label = `Événement « ${event.id} »`;
    if (ids.has(event.id)) report.error(`${label} : identifiant en double.`);
    ids.add(event.id);
    if (!inBounds(map, event.x, event.y)) {
      report.error(`${label} : position (${event.x}, ${event.y}) hors de la carte.`);
    }
    event.pages.forEach((page, index) => {
      const where = `${label}, page ${index + 1}`;
      const graphic = page.graphic;
      if (graphic && 'charset' in graphic) checkAsset(report, ctx, graphic.charset, 'charset', where);
      if (graphic && 'tile' in graphic && !roles.has(graphic.tile)) {
        report.warn(`${where} : tuile ${graphic.tile} inconnue.`);
      }
      if (page.conditions?.item && !ctx.database.items.some((i) => i.id === page.conditions?.item)) {
        report.error(`${where} : condition sur l'objet inconnu « ${page.conditions.item} ».`);
      }
      report.items.push(...validateCommands(page.commands, ctx, { file, where, map, event }));
    });
  }
  return report.items;
}

function checkDuplicates(report: Report, list: { id: string }[], label: string): void {
  const seen = new Set<string>();
  for (const { id } of list) {
    if (seen.has(id)) report.error(`${label} : identifiant en double « ${id} ».`);
    seen.add(id);
  }
}

/** Vérifie les références internes de la base de données (compétences, objets, ennemis). */
export function validateDatabase(
  db: RpgDatabase,
  ctx: Pick<ValidationContext, 'assets'> = {},
  file = DATABASE_PATH,
): Diagnostic[] {
  const report = new Report(file);
  checkDuplicates(report, db.actors, 'Acteurs');
  checkDuplicates(report, db.items, 'Objets');
  checkDuplicates(report, db.skills, 'Compétences');
  checkDuplicates(report, db.enemies, 'Ennemis');
  checkDuplicates(report, db.troops, 'Groupes');
  const skill = (id: string) => db.skills.some((s) => s.id === id);
  for (const a of db.actors) {
    const where = `Acteur « ${a.id} »`;
    for (const s of a.skills) if (!skill(s)) report.error(`${where} : compétence inconnue « ${s} ».`);
    checkAsset(report, ctx, a.charset, 'charset', where);
    checkAsset(report, ctx, a.battler, 'image', where);
  }
  for (const i of db.items) {
    if (i.effect.type !== 'none' && i.effect.value <= 0) report.warn(`Objet « ${i.id} » : effet sans valeur.`);
  }
  for (const s of db.skills) checkAsset(report, ctx, s.sfx, 'sfx', `Compétence « ${s.id} »`);
  for (const e of db.enemies) {
    const where = `Ennemi « ${e.id} »`;
    for (const s of e.skills) if (!skill(s)) report.error(`${where} : compétence inconnue « ${s} ».`);
    for (const d of e.drops) {
      if (!db.items.some((i) => i.id === d.item)) report.error(`${where} : butin inconnu « ${d.item} ».`);
    }
    checkAsset(report, ctx, e.battler, 'image', where);
  }
  for (const t of db.troops) {
    for (const m of t.members) {
      if (!db.enemies.some((e) => e.id === m)) report.error(`Groupe « ${t.id} » : ennemi inconnu « ${m} ».`);
    }
  }
  return report.items;
}

/** Vérifie le système : carte et position de départ, équipe, sons et musiques. */
export function validateSystem(system: RpgSystem, ctx: ValidationContext, file = SYSTEM_PATH): Diagnostic[] {
  const report = new Report(file);
  const map = ctx.maps.get(system.startMap);
  if (!map) {
    report.error(`Carte de départ introuvable « ${system.startMap} » (${mapPath(system.startMap)}).`);
  } else if (!inBounds(map, system.startX, system.startY)) {
    report.error(`Position de départ (${system.startX}, ${system.startY}) hors de la carte « ${map.id} ».`);
  } else {
    const roles = roleTable(ctx.tilesets?.get(map.tileset) ?? DEFAULT_TILESET_INFO);
    if (!isCellPassable(map, roles, system.startX, system.startY)) {
      report.error(`Position de départ (${system.startX}, ${system.startY}) infranchissable sur « ${map.id} ».`);
    }
  }
  if (system.party.length === 0) report.error('L\'équipe de départ est vide.');
  for (const id of system.party) {
    if (!ctx.database.actors.some((a) => a.id === id)) report.error(`Équipe : acteur inconnu « ${id} ».`);
  }
  for (const key of ['titleMusic', 'mapMusic', 'battleMusic', 'victoryMusic'] as const) {
    checkAsset(report, ctx, system[key], 'music', key);
  }
  for (const [key, ref] of Object.entries(system.sfx)) checkAsset(report, ctx, ref, 'sfx', `sfx.${key}`);
  checkAsset(report, ctx, system.battleback, 'image', 'battleback');
  return report.items;
}

/** Valide toutes les données chargées d'un projet. */
export function validateRpgData(data: RpgProjectData, assets?: AssetRegistry): Diagnostic[] {
  const ctx: ValidationContext = { ...data, assets };
  const out = [...validateSystem(data.system, ctx), ...validateDatabase(data.database, ctx)];
  for (const map of data.maps.values()) out.push(...validateMap(map, ctx));
  return out;
}

/** Validation complète d'un projet RPG (utilisée par `rpgMode.validate`). */
export async function validateProject(bundle: ProjectBundle): Promise<Diagnostic[]> {
  const assets = new AssetRegistry(bundle.manifest.assets, bundle.files);
  try {
    const data = await loadRpgProject(bundle.files, { entry: bundle.manifest.entry, assets });
    return [...data.problems, ...validateRpgData(data, assets)];
  } catch (error) {
    if (error instanceof RpgLoadError) return error.diagnostics;
    return [{ file: bundle.manifest.entry, severity: 'error', message: syntaxError(error) }];
  }
}
