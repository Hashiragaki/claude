import { defineTool, type AgentTool } from '@forge/ai';
import { z } from 'zod';
import { describeTask, formatReview } from './digest';
import { DateSchema, PrioritySchema, RecurrenceSchema, TaskStatusSchema } from './model';
import type { Planner } from './planner';

const TaskFields = {
  description: z.string().optional().describe('Détails, critères de fin'),
  priority: PrioritySchema.optional(),
  milestoneId: z.string().optional().describe('Identifiant du jalon (m_…)'),
  startDate: DateSchema.optional().describe('Ne pas commencer avant (AAAA-MM-JJ)'),
  dueDate: DateSchema.optional().describe('Échéance (AAAA-MM-JJ)'),
  estimateHours: z.number().min(0).max(1000).optional().describe('Estimation en heures'),
  dependsOn: z.array(z.string()).optional().describe('Identifiants des tâches préalables (t_…)'),
  tags: z.array(z.string()).optional(),
  assignee: z.enum(['user', 'ai']).optional().describe('`ai` si tu peux réaliser la tâche toi-même avec tes outils'),
  recurrence: RecurrenceSchema.optional().describe('Tâche récurrente (ex. revue hebdomadaire)'),
};

/** Outils de planification exposés à l'agent Claude. */
export function createPlannerTools(planner: Planner): AgentTool[] {
  return [
    defineTool({
      name: 'list_tasks',
      description: 'Liste les tâches du projet, avec filtres optionnels (statut, jalon, tag, recherche).',
      schema: z.object({
        status: z.array(TaskStatusSchema).optional(),
        milestoneId: z.string().optional(),
        tag: z.string().optional(),
        search: z.string().optional(),
      }),
      run: (f) =>
        planner
          .listTasks({ status: f.status, milestoneId: f.milestoneId, tag: f.tag, search: f.search })
          .map((t) => describeTask(t, planner))
          .join('\n') || 'Aucune tâche.',
    }),
    defineTool({
      name: 'get_task',
      description: 'Détail complet d\'une tâche (description, journal, liens).',
      schema: z.object({ id: z.string() }),
      run: ({ id }) => planner.requireTask(id),
    }),
    defineTool({
      name: 'create_task',
      description: 'Crée une tâche. Utilise des titres courts à l\'impératif (« Dessiner la carte du village »).',
      schema: z.object({ title: z.string().min(1), ...TaskFields }),
      run: (input) => {
        const task = planner.createTask(input, 'ai');
        return `Tâche créée : ${describeTask(task, planner)}`;
      },
    }),
    defineTool({
      name: 'update_task',
      description:
        'Modifie une tâche (statut, priorité, échéance, dépendances…). `note` ajoute une entrée au journal de la tâche.',
      schema: z.object({
        id: z.string(),
        title: z.string().min(1).optional(),
        status: TaskStatusSchema.optional(),
        note: z.string().optional(),
        ...TaskFields,
      }),
      run: ({ id, note, ...patch }) => {
        const task = planner.updateTask(id, patch, 'ai', note);
        return `Tâche mise à jour : ${describeTask(task, planner)}`;
      },
    }),
    defineTool({
      name: 'delete_task',
      description: 'Supprime définitivement une tâche. Préfère le statut `cancelled` si l\'historique compte.',
      schema: z.object({ id: z.string() }),
      run: ({ id }) => {
        planner.deleteTask(id);
        return `Tâche ${id} supprimée.`;
      },
    }),
    defineTool({
      name: 'create_milestone',
      description: 'Crée un jalon (étape majeure du projet : prototype, démo, alpha…).',
      schema: z.object({ title: z.string().min(1), description: z.string().optional(), dueDate: DateSchema.optional() }),
      run: (input) => {
        const m = planner.createMilestone(input);
        return `Jalon créé : [${m.id}] ${m.title}`;
      },
    }),
    defineTool({
      name: 'update_milestone',
      description: 'Modifie un jalon (titre, description, échéance, statut planned/active/done).',
      schema: z.object({
        id: z.string(),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        dueDate: DateSchema.optional(),
        status: z.enum(['planned', 'active', 'done']).optional(),
      }),
      run: ({ id, ...patch }) => {
        const m = planner.updateMilestone(id, patch);
        return `Jalon mis à jour : [${m.id}] ${m.title} (${m.status})`;
      },
    }),
    defineTool({
      name: 'plan_project',
      description:
        'Crée d\'un coup un plan complet : plusieurs jalons, chacun avec ses tâches. Les dépendances sont données ' +
        'par titre de tâche (`dependsOnTitles`). À utiliser pour « planifie mon jeu », « découpe ce jalon »…',
      schema: z.object({
        milestones: z
          .array(
            z.object({
              title: z.string().min(1),
              description: z.string().optional(),
              dueDate: DateSchema.optional(),
              tasks: z
                .array(
                  z.object({
                    title: z.string().min(1),
                    description: z.string().optional(),
                    priority: PrioritySchema.optional(),
                    dueDate: DateSchema.optional(),
                    estimateHours: z.number().min(0).max(1000).optional(),
                    tags: z.array(z.string()).optional(),
                    assignee: z.enum(['user', 'ai']).optional(),
                    dependsOnTitles: z.array(z.string()).optional(),
                  }),
                )
                .max(40),
            }),
          )
          .min(1)
          .max(12),
      }),
      run: (plan) => {
        const result = planner.applyPlan(plan, 'ai');
        return `Plan créé : ${result.milestones.length} jalons, ${result.tasks.length} tâches.\n${result.tasks
          .map((t) => `- ${describeTask(t, planner)}`)
          .join('\n')}`;
      },
    }),
    defineTool({
      name: 'review_progress',
      description: 'Revue de l\'avancement : terminé récemment, en cours, retards, échéances proches, prochaines actions.',
      schema: z.object({}),
      run: () => formatReview(planner.review(), planner),
    }),
    defineTool({
      name: 'remember',
      description:
        'Enregistre une information durable dans la mémoire du projet (décision de design, style graphique, ' +
        'personnages, préférences de l\'utilisateur). Elle te sera rappelée dans les conversations futures.',
      schema: z.object({ text: z.string().min(1).max(2000), tags: z.array(z.string()).optional() }),
      run: ({ text, tags }) => {
        const note = planner.remember(text, tags);
        return `Noté en mémoire [${note.id}].`;
      },
    }),
    defineTool({
      name: 'forget',
      description: 'Supprime une note obsolète de la mémoire du projet.',
      schema: z.object({ id: z.string() }),
      run: ({ id }) => {
        planner.forget(id);
        return `Note ${id} supprimée.`;
      },
    }),
  ];
}
