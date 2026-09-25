import { I18n, type Dictionary } from '@forge/core';

/** Fonction de traduction (clé + paramètres `{nom}`). */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Textes propres au mode RPG (complètent `ENGINE_STRINGS` : `battle.*`, `menu.*`, `rpg.*`). */
export const RPG_STRINGS: Record<string, Dictionary> = {
  fr: {
    'battle.useSkill': '{name} lance {skill} !',
    'battle.useItem': '{name} utilise {item} !',
    'battle.gold': '{value} pièces d\'or obtenues.',
    'battle.revived': '{target} revient à la vie !',
    'battle.mpRecovered': '{target} récupère {value} PM.',
    'battle.noEffect': 'Mais rien ne se passe…',
    'battle.cannotEscape': 'Impossible de fuir ce combat !',
    'battle.chooseTarget': 'Choisissez une cible.',
    'battle.commandFor': 'Que doit faire {name} ?',
    'rpg.hp': 'PV',
    'rpg.mp': 'PM',
    'rpg.level': 'Niv.',
    'rpg.exp': 'EXP',
    'rpg.nextLevel': 'Niveau suivant',
    'rpg.atk': 'Attaque',
    'rpg.def': 'Défense',
    'rpg.mag': 'Magie',
    'rpg.agi': 'Agilité',
    'rpg.skills': 'Compétences',
    'rpg.noItems': 'Aucun objet.',
    'rpg.noSkills': 'Aucune compétence.',
    'rpg.useOn': 'Utiliser sur qui ?',
    'rpg.noEffect': 'Cela n\'aurait aucun effet.',
    'rpg.cannotUse': 'Cet objet ne peut pas être utilisé ici.',
    'rpg.keyItem': 'Objet clé',
    'rpg.slot': 'Emplacement {n}',
    'rpg.saveDisabled': 'Impossible de sauvegarder pour le moment.',
    'rpg.titleScreen': 'Titre',
    'rpg.confirmTitle': 'Revenir à l\'écran titre ?',
    'rpg.yes': 'Oui',
    'rpg.no': 'Non',
    'rpg.gameOverHint': 'Appuyez sur Entrée pour revenir à l\'écran titre.',
    'rpg.loading': 'Chargement…',
    'rpg.ko': 'K.O.',
    'rpg.recovered': '{target} récupère {value} PV.',
    'rpg.mpRecovered': '{target} récupère {value} PM.',
    'rpg.revived': '{target} revient à la vie !',
    'rpg.loadFailed': 'Impossible de charger cette sauvegarde.',
  },
  en: {
    'battle.useSkill': '{name} casts {skill}!',
    'battle.useItem': '{name} uses {item}!',
    'battle.gold': 'Found {value} gold.',
    'battle.revived': '{target} is revived!',
    'battle.mpRecovered': '{target} recovers {value} MP.',
    'battle.noEffect': 'But nothing happened…',
    'battle.cannotEscape': 'You cannot escape this battle!',
    'battle.chooseTarget': 'Choose a target.',
    'battle.commandFor': 'What will {name} do?',
    'rpg.hp': 'HP',
    'rpg.mp': 'MP',
    'rpg.level': 'Lv.',
    'rpg.exp': 'EXP',
    'rpg.nextLevel': 'Next level',
    'rpg.atk': 'Attack',
    'rpg.def': 'Defense',
    'rpg.mag': 'Magic',
    'rpg.agi': 'Agility',
    'rpg.skills': 'Skills',
    'rpg.noItems': 'No items.',
    'rpg.noSkills': 'No skills.',
    'rpg.useOn': 'Use on whom?',
    'rpg.noEffect': 'It would have no effect.',
    'rpg.cannotUse': 'This item cannot be used here.',
    'rpg.keyItem': 'Key item',
    'rpg.slot': 'Slot {n}',
    'rpg.saveDisabled': 'You cannot save right now.',
    'rpg.titleScreen': 'Title',
    'rpg.confirmTitle': 'Return to the title screen?',
    'rpg.yes': 'Yes',
    'rpg.no': 'No',
    'rpg.gameOverHint': 'Press Enter to return to the title screen.',
    'rpg.loading': 'Loading…',
    'rpg.ko': 'KO',
    'rpg.recovered': '{target} recovers {value} HP.',
    'rpg.mpRecovered': '{target} recovers {value} MP.',
    'rpg.revived': '{target} is revived!',
    'rpg.loadFailed': 'This save could not be loaded.',
  },
};

/** Ajoute les textes RPG sans écraser les traductions déjà présentes (projet, moteur). */
export function extendI18n(i18n: I18n): void {
  for (const [locale, dict] of Object.entries(RPG_STRINGS)) {
    const missing = Object.fromEntries(Object.entries(dict).filter(([key]) => !i18n.has(key, locale)));
    i18n.extend(locale, missing);
  }
}

/** Traduction française par défaut (tests, logique sans contexte). */
export function defaultTranslate(locale = 'fr'): Translate {
  const i18n = new I18n(locale, 'fr');
  extendI18n(i18n);
  return (key, params) => i18n.t(key, params);
}
