import { useApp } from './state/app';

const fr = {
  'app.name': 'Forge',
  'panel.game': 'Jeu',
  'panel.assets': 'Assets',
  'panel.properties': 'Propriétés',
  'panel.chat': 'Assistant IA',
  'panel.planner': 'Planning',
  'panel.console': 'Console',
  'panel.inspector': 'Inspecteur',
  'panel.files': 'Fichiers',
  'menu.file': 'Fichier',
  'menu.newProject': 'Nouveau projet…',
  'menu.openProject': 'Ouvrir un projet',
  'menu.export': 'Exporter pour le web (.zip)',
  'menu.closeProject': 'Fermer le projet',
  'menu.window': 'Fenêtre',
  'menu.resetLayout': 'Réinitialiser la disposition',
  'menu.help': 'Aide',
  'menu.about': 'À propos de Forge',
  'menu.language': 'Langue : English',
  'action.play': 'Jouer',
  'action.stop': 'Arrêter',
  'action.restart': 'Relancer',
  'action.generate': 'Générer',
  'action.import': 'Importer',
  'action.save': 'Enregistrer',
  'action.cancel': 'Annuler',
  'action.delete': 'Supprimer',
  'action.create': 'Créer',
  'action.send': 'Envoyer',
  'ai.on': 'IA connectée',
  'ai.off': 'IA hors-ligne',
  'home.title': 'Accueil',
  'home.recent': 'Projets récents',
  'home.new': 'Nouveau projet',
  'home.empty': 'Aucun projet pour l\'instant. Créez-en un à partir d\'un modèle.',
  'home.templates': 'Démarrer à partir d\'un modèle',
} as const;

type Key = keyof typeof fr;

const en: Record<Key, string> = {
  'app.name': 'Forge',
  'panel.game': 'Game',
  'panel.assets': 'Assets',
  'panel.properties': 'Properties',
  'panel.chat': 'AI assistant',
  'panel.planner': 'Planning',
  'panel.console': 'Console',
  'panel.inspector': 'Inspector',
  'panel.files': 'Files',
  'menu.file': 'File',
  'menu.newProject': 'New project…',
  'menu.openProject': 'Open a project',
  'menu.export': 'Export for the web (.zip)',
  'menu.closeProject': 'Close project',
  'menu.window': 'Window',
  'menu.resetLayout': 'Reset layout',
  'menu.help': 'Help',
  'menu.about': 'About Forge',
  'menu.language': 'Langue : Français',
  'action.play': 'Play',
  'action.stop': 'Stop',
  'action.restart': 'Restart',
  'action.generate': 'Generate',
  'action.import': 'Import',
  'action.save': 'Save',
  'action.cancel': 'Cancel',
  'action.delete': 'Delete',
  'action.create': 'Create',
  'action.send': 'Send',
  'ai.on': 'AI connected',
  'ai.off': 'AI offline',
  'home.title': 'Home',
  'home.recent': 'Recent projects',
  'home.new': 'New project',
  'home.empty': 'No project yet. Create one from a template.',
  'home.templates': 'Start from a template',
};

const dictionaries = { fr, en };

export function translate(locale: 'fr' | 'en', key: Key): string {
  return dictionaries[locale][key] ?? fr[key];
}

/** Hook de traduction de l'interface (français par défaut, anglais disponible). */
export function useT(): (key: Key) => string {
  const locale = useApp((s) => s.locale);
  return (key) => translate(locale, key);
}
