import { Rng } from '@forge/core';
import { matchKeyword } from '../../shared/keywords';
import {
  EYE_COLORS,
  HAIR_COLORS,
  OUTFIT_COLORS,
  SKIN_TONES,
  eyeColorFromText,
  hairColorFromText,
  outfitColorFromText,
} from '../../shared/palettes';

export const HAIR_STYLES = ['short', 'long', 'bob', 'ponytail', 'spiky', 'twintails'] as const;
export type PortraitHairStyle = (typeof HAIR_STYLES)[number];

export const EXPRESSIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'embarrassed'] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export type OutfitKind = 'school' | 'casual' | 'fantasy' | 'formal';
export type HeadAccessory = 'none' | 'clip' | 'ribbon' | 'headband';

/** Apparence stable d'un personnage (identique pour toutes ses expressions). */
export interface PortraitIdentity {
  skin: string;
  hair: string;
  eyes: string;
  outfit: string;
  accent: string;
  hairStyle: PortraitHairStyle;
  outfitKind: OutfitKind;
  accessory: HeadAccessory;
}

export interface PortraitInput {
  prompt?: string;
  character?: string;
  hairColor?: string;
  eyeColor?: string;
  skinTone?: string;
  outfitColor?: string;
  hairStyle?: PortraitHairStyle;
  palette?: string[];
}

const OUTFIT_WORDS: Record<OutfitKind, readonly string[]> = {
  school: ['ecole', 'ecolier', 'ecoliere', 'lycee', 'lyceen', 'lyceenne', 'etudiant', 'etudiante', 'eleve', 'school', 'student', 'uniforme', 'uniform'],
  fantasy: ['mage', 'chevalier', 'elfe', 'elf', 'fantasy', 'fantastique', 'aventurier', 'aventuriere', 'sorcier', 'sorciere', 'princesse', 'prince', 'guerrier', 'guerriere', 'pretresse', 'witch', 'wizard', 'knight'],
  formal: ['costume', 'cravate', 'detective', 'avocat', 'avocate', 'patron', 'patronne', 'businessman', 'suit', 'formal', 'majordome', 'butler', 'professeur', 'teacher', 'docteur', 'doctor'],
  casual: ['sweat', 'hoodie', 'decontracte', 'casual', 'capuche', 'streetwear'],
};

const HAIR_WORDS: Record<PortraitHairStyle, readonly string[]> = {
  twintails: ['couettes', 'twintails', 'twin tails', 'deux queues'],
  ponytail: ['queue de cheval', 'ponytail'],
  bob: ['carre', 'bob'],
  spiky: ['herisse', 'herisses', 'spiky', 'pointus'],
  long: ['cheveux longs', 'long hair', 'longs cheveux'],
  short: ['cheveux courts', 'short hair'],
};

const EXPRESSION_WORDS: Record<Expression, readonly string[]> = {
  happy: ['joyeux', 'joyeuse', 'heureux', 'heureuse', 'souriant', 'souriante', 'sourire', 'rire', 'content', 'contente', 'happy', 'smile', 'smiling'],
  sad: ['triste', 'pleure', 'pleurs', 'larmes', 'sad', 'crying', 'melancolique'],
  angry: ['colere', 'fache', 'fachee', 'furieux', 'furieuse', 'enerve', 'enervee', 'angry', 'mad'],
  surprised: ['surpris', 'surprise', 'etonne', 'etonnee', 'choque', 'choquee', 'surprised', 'shocked'],
  embarrassed: ['gene', 'genee', 'embarrasse', 'embarrassee', 'timide', 'rougit', 'rougissant', 'rougissante', 'embarrassed', 'shy', 'blush'],
  neutral: ['neutre', 'neutral', 'calme', 'calm'],
};

export function expressionFromText(text: string): Expression | undefined {
  return matchKeyword(text, EXPRESSION_WORDS);
}

const ACCENTS = ['#e0506a', '#f0b83a', '#4a8ae0', '#e87a3a', '#8a5ad0', '#3ab08a'] as const;

/**
 * Résout l'identité visuelle : paramètres explicites > description > graine.
 * Si `character` est renseigné, la graine en dérive : toutes les expressions d'un même
 * personnage partagent alors exactement la même apparence.
 */
export function resolveIdentity(input: PortraitInput, rng: Rng): PortraitIdentity {
  const seedRng = input.character?.trim() ? new Rng(`portrait:${input.character.trim().toLowerCase()}`) : rng;
  const text = `${input.character ?? ''} ${input.prompt ?? ''}`;
  // Tirages toujours dans le même ordre pour rester stables.
  const picks = {
    skin: seedRng.pick(SKIN_TONES.slice(0, 5)),
    hair: seedRng.pick(HAIR_COLORS),
    eyes: seedRng.pick(EYE_COLORS),
    outfit: seedRng.pick(OUTFIT_COLORS),
    accent: seedRng.pick(ACCENTS),
    hairStyle: seedRng.pick(HAIR_STYLES),
    outfitKind: seedRng.pick(['school', 'casual', 'school', 'formal', 'fantasy'] as const),
    accessory: seedRng.pick(['none', 'clip', 'ribbon', 'headband', 'none'] as const),
  };
  const palette = input.palette ?? [];
  return {
    skin: input.skinTone ?? picks.skin,
    hair: input.hairColor ?? palette[0] ?? hairColorFromText(text) ?? picks.hair,
    eyes: input.eyeColor ?? palette[2] ?? eyeColorFromText(text) ?? picks.eyes,
    outfit: input.outfitColor ?? palette[1] ?? outfitColorFromText(text) ?? picks.outfit,
    accent: palette[3] ?? picks.accent,
    hairStyle: input.hairStyle ?? matchKeyword(text, HAIR_WORDS) ?? picks.hairStyle,
    outfitKind: matchKeyword(text, OUTFIT_WORDS) ?? picks.outfitKind,
    accessory: picks.accessory,
  };
}
