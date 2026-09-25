import { RpgDatabaseSchema } from '@forge/mode-rpg';
import { describe, expect, it } from 'vitest';
import { canAddEntry, newEntry, type NewEntryContext } from './databaseEntries';

const fullCtx: NewEntryContext = {
  firstCharsetAlias: 'hero_charset',
  firstBattlerAlias: 'goblin',
  firstEnemyId: 'ennemi1',
};

describe('newEntry', () => {
  it('produit un héros valide selon RpgDatabaseSchema quand un charset existe', () => {
    const db = RpgDatabaseSchema.parse({ actors: [newEntry('actors', 'hero1', fullCtx)] });
    expect(db.actors[0].charset).toBe('hero_charset');
  });

  it('produit un ennemi valide selon RpgDatabaseSchema quand une image de combat existe', () => {
    const db = RpgDatabaseSchema.parse({ enemies: [newEntry('enemies', 'ennemi1', fullCtx)] });
    expect(db.enemies[0].battler).toBe('goblin');
  });

  it('produit une troupe avec un membre par défaut, valide selon RpgDatabaseSchema', () => {
    const db = RpgDatabaseSchema.parse({ troops: [newEntry('troops', 'troupe1', fullCtx)] });
    expect(db.troops[0].members).toEqual(['ennemi1']);
  });

  it('produit des objets et compétences valides sans contexte', () => {
    const db = RpgDatabaseSchema.parse({
      items: [newEntry('items', 'objet1')],
      skills: [newEntry('skills', 'comp1')],
    });
    expect(db.items).toHaveLength(1);
    expect(db.skills).toHaveLength(1);
  });

  it('sans ressource disponible, un héros/ennemi/troupe créé serait invalide (charset/battler/membre vides)', () => {
    expect(() => RpgDatabaseSchema.parse({ actors: [newEntry('actors', 'hero1')] })).toThrow();
    expect(() => RpgDatabaseSchema.parse({ enemies: [newEntry('enemies', 'ennemi1')] })).toThrow();
    expect(() => RpgDatabaseSchema.parse({ troops: [newEntry('troops', 'troupe1')] })).toThrow();
  });
});

describe('canAddEntry', () => {
  it("interdit l'ajout d'un héros, ennemi ou troupe tant que la ressource requise manque", () => {
    expect(canAddEntry('actors', {})).toBe(false);
    expect(canAddEntry('enemies', {})).toBe(false);
    expect(canAddEntry('troops', {})).toBe(false);
  });

  it('autorise l’ajout une fois la ressource requise disponible', () => {
    expect(canAddEntry('actors', fullCtx)).toBe(true);
    expect(canAddEntry('enemies', fullCtx)).toBe(true);
    expect(canAddEntry('troops', fullCtx)).toBe(true);
  });

  it('autorise toujours les objets et compétences', () => {
    expect(canAddEntry('items', {})).toBe(true);
    expect(canAddEntry('skills', {})).toBe(true);
  });
});
