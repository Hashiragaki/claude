import { z } from 'zod';

export const TaskStatusSchema = z.enum(['todo', 'in_progress', 'blocked', 'done', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const PrioritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type Priority = z.infer<typeof PrioritySchema>;

/** Date calendaire `AAAA-MM-JJ`. */
export const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');

export const TaskLinkSchema = z.object({
  kind: z.enum(['asset', 'script', 'map', 'file', 'url']),
  ref: z.string(),
  label: z.string().optional(),
});
export type TaskLink = z.infer<typeof TaskLinkSchema>;

export const LogEntrySchema = z.object({
  at: z.string(),
  by: z.enum(['user', 'ai', 'system']),
  text: z.string(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

export const RecurrenceSchema = z.object({
  every: z.number().int().positive(),
  unit: z.enum(['day', 'week', 'month']),
});
export type Recurrence = z.infer<typeof RecurrenceSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().default(''),
  status: TaskStatusSchema.default('todo'),
  priority: PrioritySchema.default('medium'),
  milestoneId: z.string().optional(),
  startDate: DateSchema.optional(),
  dueDate: DateSchema.optional(),
  estimateHours: z.number().nonnegative().optional(),
  dependsOn: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  /** Qui réalise la tâche : l'utilisateur ou l'IA (génération d'assets, écriture…). */
  assignee: z.enum(['user', 'ai']).default('user'),
  links: z.array(TaskLinkSchema).default([]),
  log: z.array(LogEntrySchema).default([]),
  recurrence: RecurrenceSchema.optional(),
  order: z.number().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

export const MilestoneSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().default(''),
  dueDate: DateSchema.optional(),
  status: z.enum(['planned', 'active', 'done']).default('planned'),
  order: z.number().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Milestone = z.infer<typeof MilestoneSchema>;

/** Note de mémoire long terme du projet (décisions, style, univers…). */
export const MemoryNoteSchema = z.object({
  id: z.string(),
  at: z.string(),
  text: z.string().min(1),
  tags: z.array(z.string()).default([]),
});
export type MemoryNote = z.infer<typeof MemoryNoteSchema>;

export const PLANNER_FORMAT = 'forge-planner@1';

export const PlannerDataSchema = z.object({
  format: z.literal(PLANNER_FORMAT).default(PLANNER_FORMAT),
  milestones: z.array(MilestoneSchema).default([]),
  tasks: z.array(TaskSchema).default([]),
  memory: z.array(MemoryNoteSchema).default([]),
  updatedAt: z.string().default(() => new Date().toISOString()),
});
export type PlannerData = z.infer<typeof PlannerDataSchema>;

export const PRIORITY_WEIGHT: Record<Priority, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'À faire',
  in_progress: 'En cours',
  blocked: 'Bloqué',
  done: 'Terminé',
  cancelled: 'Annulé',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Basse',
  medium: 'Moyenne',
  high: 'Haute',
  critical: 'Critique',
};
