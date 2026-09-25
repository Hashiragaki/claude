import { describeTask, formatReview } from './digest';
import type { Priority } from './model';
import type { Planner } from './planner';

/** Action que l'hôte (serveur) doit réaliser suite à une commande hors-ligne. */
export type OfflineAction = { type: 'generate'; generator: string; prompt: string };

export interface OfflineReply {
  text: string;
  actions: OfflineAction[];
}

export const OFFLINE_HELP = `**Mode hors-ligne** — aucune clé \`ANTHROPIC_API_KEY\` n'est configurée, l'assistant IA est désactivé. Commandes disponibles :
- \`/tache Titre [!haute|!critique|!basse] [@AAAA-MM-JJ] [~3h] [#tag]\` — créer une tâche
- \`/taches\` — lister les tâches ouvertes
- \`/fait <id ou titre>\` — marquer une tâche comme terminée
- \`/encours <id ou titre>\` — passer une tâche en cours
- \`/jalon Titre [@AAAA-MM-JJ]\` — créer un jalon
- \`/revue\` — revue de l'avancement
- \`/note Texte\` — ajouter une note à la mémoire du projet
- \`/generer <générateur> <description>\` — générer un asset en mode procédural (ex. \`/generer sfx pièce\`, \`/generer image.svg portrait\`, \`/generer music calme\`)
- \`/aide\` — cette aide`;

const PRIORITIES: Record<string, Priority> = {
  basse: 'low',
  low: 'low',
  moyenne: 'medium',
  medium: 'medium',
  haute: 'high',
  high: 'high',
  critique: 'critical',
  critical: 'critical',
};

/** Extrait `!priorité`, `@date`, `~heures` et `#tags` d'un texte de commande. */
export function parseTaskShorthand(text: string) {
  let priority: Priority | undefined;
  let dueDate: string | undefined;
  let estimateHours: number | undefined;
  const tags: string[] = [];
  const words: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const lower = word.toLowerCase();
    if (lower.startsWith('!') && PRIORITIES[lower.slice(1)]) priority = PRIORITIES[lower.slice(1)];
    else if (/^@\d{4}-\d{2}-\d{2}$/.test(word)) dueDate = word.slice(1);
    else if (/^~\d+(\.\d+)?h?$/i.test(word)) estimateHours = parseFloat(word.slice(1));
    else if (/^#[\p{L}\d_-]+$/u.test(word)) tags.push(word.slice(1));
    else words.push(word);
  }
  return { title: words.join(' '), priority, dueDate, estimateHours, tags };
}

/**
 * Interprète un message de chat sans IA : commandes `/…` sur le planning.
 * Un message qui n'est pas une commande renvoie l'aide du mode hors-ligne.
 */
export function handleOfflineCommand(planner: Planner, message: string): OfflineReply {
  const trimmed = message.trim();
  const match = /^\/(\S+)\s*([\s\S]*)$/.exec(trimmed);
  if (!match) return { text: OFFLINE_HELP, actions: [] };
  const command = (match[1] ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const arg = (match[2] ?? '').trim();
  const reply = (text: string, actions: OfflineAction[] = []): OfflineReply => ({ text, actions });
  try {
    switch (command) {
      case 'aide':
      case 'help':
        return reply(OFFLINE_HELP);
      case 'tache':
      case 'task': {
        const parsed = parseTaskShorthand(arg);
        if (!parsed.title) return reply('Précise un titre : `/tache Écrire le chapitre 1 !haute @2026-10-01`');
        const task = planner.createTask({ ...parsed }, 'user');
        return reply(`✅ Tâche créée : ${describeTask(task, planner)}`);
      }
      case 'taches':
      case 'tasks': {
        const open = planner.listTasks({ status: ['in_progress', 'todo', 'blocked'] });
        if (!open.length) return reply('Aucune tâche ouverte. Crée-en une avec `/tache …`.');
        return reply(
          `**Tâches ouvertes (${open.length})**\n${open.map((t) => `- ${describeTask(t, planner)}`).join('\n')}`,
        );
      }
      case 'fait':
      case 'done':
      case 'encours': {
        const task = planner.findTask(arg);
        if (!task) return reply(`Tâche introuvable : « ${arg} »`);
        const status = command === 'encours' ? 'in_progress' : 'done';
        const updated = planner.setStatus(task.id, status, 'user');
        return reply(`${status === 'done' ? '🎉 Terminée' : '▶️ En cours'} : ${describeTask(updated, planner)}`);
      }
      case 'jalon':
      case 'milestone': {
        const parsed = parseTaskShorthand(arg);
        if (!parsed.title) return reply('Précise un titre : `/jalon Prototype jouable @2026-11-01`');
        const m = planner.createMilestone({ title: parsed.title, dueDate: parsed.dueDate });
        return reply(`🏁 Jalon créé : [${m.id}] ${m.title}${m.dueDate ? ` (échéance ${m.dueDate})` : ''}`);
      }
      case 'revue':
      case 'review':
        return reply(formatReview(planner.review(), planner));
      case 'note':
      case 'memo': {
        const note = planner.remember(arg);
        return reply(`📝 Noté dans la mémoire du projet [${note.id}].`);
      }
      case 'generer':
      case 'generate': {
        const [generator, ...rest] = arg.split(/\s+/);
        if (!generator) return reply('Usage : `/generer <générateur> <description>`');
        return reply(`⏳ Génération procédurale lancée (${generator})…`, [
          { type: 'generate', generator, prompt: rest.join(' ') },
        ]);
      }
      default:
        return reply(`Commande inconnue : /${match[1]}\n\n${OFFLINE_HELP}`);
    }
  } catch (error) {
    return reply(`⚠️ ${error instanceof Error ? error.message : String(error)}`);
  }
}
