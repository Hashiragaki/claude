export type Dictionary = Record<string, string>;

/** Textes du moteur communs à tous les modes. */
export const ENGINE_STRINGS: Record<string, Dictionary> = {
  fr: {
    'menu.newGame': 'Nouvelle partie',
    'menu.continue': 'Continuer',
    'menu.load': 'Charger',
    'menu.save': 'Sauvegarder',
    'menu.settings': 'Options',
    'menu.quit': 'Quitter',
    'menu.back': 'Retour',
    'menu.items': 'Objets',
    'menu.status': 'Statut',
    'menu.history': 'Historique',
    'save.empty': 'Emplacement vide',
    'save.saved': 'Partie sauvegardée.',
    'save.loaded': 'Partie chargée.',
    'game.end': 'Fin',
    'game.over': 'Game over',
    'vn.auto': 'Auto',
    'vn.skip': 'Passer',
    'vn.rollback': 'Retour',
    'rpg.gold': 'Or',
    'rpg.obtained': '{item} obtenu !',
    'battle.attack': 'Attaquer',
    'battle.skill': 'Compétence',
    'battle.item': 'Objet',
    'battle.guard': 'Défendre',
    'battle.escape': 'Fuir',
    'battle.appears': '{name} apparaît !',
    'battle.attacks': '{name} attaque !',
    'battle.damage': '{target} subit {value} dégâts.',
    'battle.heal': '{target} récupère {value} PV.',
    'battle.defeated': '{name} est vaincu !',
    'battle.victory': 'Victoire !',
    'battle.defeat': 'Défaite…',
    'battle.escaped': 'Vous prenez la fuite !',
    'battle.escapeFailed': 'Impossible de fuir !',
    'battle.exp': "{value} points d'expérience gagnés.",
    'battle.levelUp': '{name} passe au niveau {level} !',
    'battle.guarding': '{name} se met en garde.',
    'battle.notEnoughMp': 'Pas assez de PM !',
  },
  en: {
    'menu.newGame': 'New game',
    'menu.continue': 'Continue',
    'menu.load': 'Load',
    'menu.save': 'Save',
    'menu.settings': 'Settings',
    'menu.quit': 'Quit',
    'menu.back': 'Back',
    'menu.items': 'Items',
    'menu.status': 'Status',
    'menu.history': 'History',
    'save.empty': 'Empty slot',
    'save.saved': 'Game saved.',
    'save.loaded': 'Game loaded.',
    'game.end': 'The End',
    'game.over': 'Game over',
    'vn.auto': 'Auto',
    'vn.skip': 'Skip',
    'vn.rollback': 'Back',
    'rpg.gold': 'Gold',
    'rpg.obtained': 'Obtained {item}!',
    'battle.attack': 'Attack',
    'battle.skill': 'Skill',
    'battle.item': 'Item',
    'battle.guard': 'Guard',
    'battle.escape': 'Escape',
    'battle.appears': '{name} appears!',
    'battle.attacks': '{name} attacks!',
    'battle.damage': '{target} takes {value} damage.',
    'battle.heal': '{target} recovers {value} HP.',
    'battle.defeated': '{name} is defeated!',
    'battle.victory': 'Victory!',
    'battle.defeat': 'Defeat…',
    'battle.escaped': 'You ran away!',
    'battle.escapeFailed': 'Could not escape!',
    'battle.exp': 'Gained {value} experience.',
    'battle.levelUp': '{name} reached level {level}!',
    'battle.guarding': '{name} is guarding.',
    'battle.notEnoughMp': 'Not enough MP!',
  },
};

/** Traductions avec repli sur une langue par défaut, et paramètres `{nom}`. */
export class I18n {
  private readonly dictionaries = new Map<string, Dictionary>();

  constructor(
    public locale = 'fr',
    public fallbackLocale = 'fr',
    dictionaries: Record<string, Dictionary> = ENGINE_STRINGS,
  ) {
    for (const [loc, dict] of Object.entries(dictionaries)) this.extend(loc, dict);
  }

  extend(locale: string, dict: Dictionary): void {
    this.dictionaries.set(locale, { ...this.dictionaries.get(locale), ...dict });
  }

  has(key: string, locale = this.locale): boolean {
    return this.dictionaries.get(locale)?.[key] !== undefined;
  }

  t(key: string, params: Record<string, string | number> = {}): string {
    const template =
      this.dictionaries.get(this.locale)?.[key] ?? this.dictionaries.get(this.fallbackLocale)?.[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (m, name: string) => (params[name] !== undefined ? String(params[name]) : m));
  }
}
