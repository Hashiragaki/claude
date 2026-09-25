/**
 * Création d'entrées de base de données RPG (héros, objets, compétences, ennemis, troupes).
 *
 * Extrait de DatabaseEditor.tsx en fonctions pures pour pouvoir vérifier, sans DOM, que les
 * valeurs par défaut satisfont RpgDatabaseSchema (packages/mode-rpg/src/schema.ts) : un héros a
 * besoin d'un charset (`min(1)`), un ennemi d'une image de combat (`min(1)`) et une troupe d'au
 * moins un membre (`min(1)`).
 */

export type Category = 'actors' | 'items' | 'skills' | 'enemies' | 'troops';

export type Entry = { id: string; name: string } & Record<string, unknown>;

/** Ressources déjà disponibles dans le projet, utilisées comme valeurs par défaut valides. */
export interface NewEntryContext {
  /** Alias du premier asset de type `charset` disponible (requis pour un héros). */
  firstCharsetAlias?: string;
  /** Alias du premier asset de type `image` disponible (requis pour un ennemi). */
  firstBattlerAlias?: string;
  /** Identifiant du premier ennemi existant (requis pour peupler une troupe). */
  firstEnemyId?: string;
}

/**
 * Indique si une nouvelle entrée de `category` peut être créée avec des valeurs conformes au
 * schéma compte tenu des ressources actuellement disponibles (`ctx`). Un héros ne peut pas être
 * créé tant qu'aucun charset n'est importé, un ennemi tant qu'aucune image de combat n'existe, et
 * une troupe tant qu'aucun ennemi n'a été défini.
 */
export function canAddEntry(category: Category, ctx: NewEntryContext): boolean {
  switch (category) {
    case 'actors':
      return Boolean(ctx.firstCharsetAlias);
    case 'enemies':
      return Boolean(ctx.firstBattlerAlias);
    case 'troops':
      return Boolean(ctx.firstEnemyId);
    case 'items':
    case 'skills':
      return true;
  }
}

/** Crée une nouvelle entrée de `category` avec des valeurs par défaut conformes à RpgDatabaseSchema. */
export function newEntry(category: Category, id: string, ctx: NewEntryContext = {}): Entry {
  switch (category) {
    case 'actors':
      return {
        id,
        name: 'Nouveau héros',
        charset: ctx.firstCharsetAlias ?? '',
        level: 1,
        maxHp: 40,
        maxMp: 10,
        atk: 10,
        def: 8,
        mag: 8,
        agi: 8,
        skills: [],
      };
    case 'items':
      return {
        id,
        name: 'Nouvel objet',
        description: '',
        price: 10,
        consumable: true,
        key: false,
        effect: { type: 'heal', value: 30 },
      };
    case 'skills':
      return {
        id,
        name: 'Nouvelle compétence',
        description: '',
        mpCost: 3,
        power: 12,
        type: 'damage',
        target: 'enemy',
      };
    case 'enemies':
      return {
        id,
        name: 'Nouvel ennemi',
        battler: ctx.firstBattlerAlias ?? '',
        maxHp: 20,
        maxMp: 0,
        atk: 8,
        def: 4,
        mag: 4,
        agi: 6,
        exp: 5,
        gold: 5,
        drops: [],
        skills: [],
      };
    case 'troops':
      return { id, name: 'Nouvelle troupe', members: ctx.firstEnemyId ? [ctx.firstEnemyId] : [] };
  }
}
