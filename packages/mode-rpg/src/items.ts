import type { ItemDef, RpgDatabase } from './schema';
import { addItem, itemCount, type GameState } from './state';

/** Cible d'un effet de soin : PV / PM courants et maximums. */
export interface Vitals {
  hp: number;
  mp: number;
  maxHp: number;
  maxMp: number;
}

export type ItemEffectResult = { kind: 'heal' | 'mp' | 'revive'; value: number };

/** Utilisable depuis le menu (soins, PM, résurrection). */
export function isUsableInMenu(item: ItemDef): boolean {
  return !item.key && (item.effect.type === 'heal' || item.effect.type === 'mp' || item.effect.type === 'revive');
}

/** Utilisable en combat (tout effet sauf `none`). */
export function isUsableInBattle(item: ItemDef): boolean {
  return !item.key && item.effect.type !== 'none';
}

/** L'objet vise un ennemi (dégâts) plutôt qu'un allié. */
export function targetsEnemy(item: ItemDef): boolean {
  return item.effect.type === 'damage';
}

/**
 * Applique l'effet d'un objet à un allié. Renvoie `null` si l'objet n'aurait aucun effet
 * (soin sur un personnage K.O. ou déjà en pleine forme, résurrection d'un vivant…).
 */
export function applyItemToVitals(item: ItemDef, target: Vitals): ItemEffectResult | null {
  const value = Math.max(0, Math.round(item.effect.value));
  switch (item.effect.type) {
    case 'heal': {
      if (target.hp <= 0 || target.hp >= target.maxHp) return null;
      const gained = Math.min(value, target.maxHp - target.hp);
      target.hp += gained;
      return { kind: 'heal', value: gained };
    }
    case 'mp': {
      if (target.hp <= 0 || target.mp >= target.maxMp) return null;
      const gained = Math.min(value, target.maxMp - target.mp);
      target.mp += gained;
      return { kind: 'mp', value: gained };
    }
    case 'revive': {
      if (target.hp > 0) return null;
      target.hp = Math.max(1, Math.min(target.maxHp, value));
      return { kind: 'revive', value: target.hp };
    }
    default:
      return null;
  }
}

export type ItemUseResult =
  | { ok: true; effect: ItemEffectResult }
  | { ok: false; reason: 'unknown' | 'none' | 'notUsable' | 'noEffect' };

/** Utilise un objet de l'inventaire sur un membre de l'équipe (menu). Consomme l'objet si besoin. */
export function useItemOnActor(
  state: GameState,
  database: RpgDatabase,
  itemId: string,
  partyIndex: number,
): ItemUseResult {
  const item = database.items.find((i) => i.id === itemId);
  const actor = state.party[partyIndex];
  if (!item || !actor) return { ok: false, reason: 'unknown' };
  if (itemCount(state, itemId) <= 0) return { ok: false, reason: 'none' };
  if (!isUsableInMenu(item)) return { ok: false, reason: 'notUsable' };
  const effect = applyItemToVitals(item, actor);
  if (!effect) return { ok: false, reason: 'noEffect' };
  if (item.consumable) addItem(state, itemId, -1);
  return { ok: true, effect };
}

/** Inventaire trié dans l'ordre de la base de données (objets inconnus à la fin). */
export function inventory(state: GameState, database: RpgDatabase): { item: ItemDef; count: number }[] {
  const known = database.items
    .filter((i) => itemCount(state, i.id) > 0)
    .map((item) => ({ item, count: itemCount(state, item.id) }));
  const unknown = Object.keys(state.items)
    .filter((id) => !database.items.some((i) => i.id === id) && itemCount(state, id) > 0)
    .map((id) => ({ item: unknownItem(id), count: itemCount(state, id) }));
  return [...known, ...unknown];
}

function unknownItem(id: string): ItemDef {
  return { id, name: id, description: '', price: 0, consumable: false, key: true, effect: { type: 'none', value: 0 } };
}
