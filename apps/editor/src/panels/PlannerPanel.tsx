import {
  ActionButton,
  Button,
  DialogContainer,
  Flex,
  Item,
  NumberField,
  Picker,
  Switch,
  TabList,
  TabPanels,
  Tabs,
  Text,
  TextField,
} from '@adobe/react-spectrum';
import type { Milestone, Schedule, Task, TaskStatus } from '@forge/planner';
import Add from '@spectrum-icons/workflow/Add';
import Delete from '@spectrum-icons/workflow/Delete';
import LockClosed from '@spectrum-icons/workflow/LockClosed';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { requireProjectId, toastError, useApp } from '../state/app';
import { PRIORITY_LABELS, STATUS_LABELS, TaskDialog } from './TaskDialog';

const COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'done'];

/** Planning long terme : Kanban, calendrier (Gantt), jalons et mémoire du projet. */
export function PlannerPanel() {
  const planner = useApp((s) => s.planner);
  if (!planner) return null;
  const review = planner.review;
  return (
    <div className="fg-panel">
      <div className="fg-toolbar" style={{ gap: 18 }}>
        <strong style={{ fontSize: 13 }}>Avancement : {review.stats.percent} %</strong>
        <div className="fg-progress" style={{ width: 160 }}>
          <div style={{ width: `${review.stats.percent}%` }} />
        </div>
        <span style={{ fontSize: 12, color: 'var(--fg-text-2)' }}>
          {review.stats.byStatus.done}/{review.stats.total - review.stats.byStatus.cancelled} tâches ·{' '}
          {review.stats.doneHours}/{review.stats.estimateHours} h
        </span>
        {review.overdue.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--fg-err)' }}>{review.overdue.length} en retard</span>
        )}
        <span style={{ fontSize: 12, color: 'var(--fg-text-2)' }}>
          Prochaine action : <strong style={{ color: 'var(--fg-text)' }}>{review.next[0]?.title ?? '—'}</strong>
        </span>
      </div>
      <Tabs aria-label="Vues du planning" height="100%" UNSAFE_style={{ minHeight: 0, flex: 1 }}>
        <TabList marginX="size-150">
          <Item key="kanban">Tableau</Item>
          <Item key="gantt">Calendrier</Item>
          <Item key="milestones">Jalons</Item>
          <Item key="memory">Mémoire du projet</Item>
        </TabList>
        <TabPanels UNSAFE_style={{ minHeight: 0, overflow: 'auto', border: 'none' }}>
          <Item key="kanban">
            <Kanban />
          </Item>
          <Item key="gantt">
            <Gantt />
          </Item>
          <Item key="milestones">
            <Milestones />
          </Item>
          <Item key="memory">
            <Memory />
          </Item>
        </TabPanels>
      </Tabs>
    </div>
  );
}

function Kanban() {
  const planner = useApp((s) => s.planner);
  const [milestone, setMilestone] = useState<string>('all');
  const [editing, setEditing] = useState<{ task?: Task; status?: TaskStatus } | null>(null);
  const [dropColumn, setDropColumn] = useState<TaskStatus | null>(null);
  if (!planner) return null;
  const { tasks, milestones } = planner.data;
  const today = new Date().toISOString().slice(0, 10);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const waiting = (t: Task) =>
    t.status === 'todo' && t.dependsOn.some((d) => byId.get(d) && !['done', 'cancelled'].includes(byId.get(d)!.status));
  const visible = tasks.filter((t) => milestone === 'all' || (t.milestoneId ?? 'none') === milestone);

  const onDrop = (status: TaskStatus, e: React.DragEvent) => {
    e.preventDefault();
    setDropColumn(null);
    const id = e.dataTransfer.getData('text/forge-task');
    if (!id) return;
    const index = visible.filter((t) => t.status === status).length;
    void api.moveTask(requireProjectId(), id, status, index).catch(toastError);
  };

  return (
    <div>
      <Flex gap="size-100" alignItems="center" marginX="size-150" marginTop="size-100">
        <Button variant="accent" onPress={() => setEditing({})}>
          <Add />
          <Text>Nouvelle tâche</Text>
        </Button>
        <Picker aria-label="Jalon" isQuiet selectedKey={milestone} onSelectionChange={(k) => setMilestone(String(k))} width="size-3600">
          {[
            <Item key="all">Tous les jalons</Item>,
            <Item key="none">Sans jalon</Item>,
            ...milestones.map((m) => <Item key={m.id}>{m.title}</Item>),
          ]}
        </Picker>
      </Flex>
      <div className="fg-kanban">
        {COLUMNS.map((status) => {
          const column = visible.filter((t) => t.status === status).sort((a, b) => a.order - b.order);
          return (
            <div
              key={status}
              className={`fg-column ${dropColumn === status ? 'drop' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDropColumn(status);
              }}
              onDragLeave={() => setDropColumn(null)}
              onDrop={(e) => onDrop(status, e)}
            >
              <div className="fg-column-title">
                <span>{STATUS_LABELS[status]}</span>
                <span>{column.length}</span>
              </div>
              {column.map((task) => {
                const late = task.dueDate && task.dueDate < today && task.status !== 'done';
                const m = milestones.find((x) => x.id === task.milestoneId);
                return (
                  <div
                    key={task.id}
                    className={`fg-card fg-prio-${task.priority}`}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/forge-task', task.id)}
                    onClick={() => setEditing({ task })}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setEditing({ task })}
                  >
                    <div className="fg-card-title">
                      {waiting(task) && <LockClosed size="XS" UNSAFE_style={{ marginRight: 4, verticalAlign: '-2px' }} />}
                      {task.title}
                    </div>
                    <div className="fg-card-meta">
                      <span>{PRIORITY_LABELS[task.priority]}</span>
                      {task.estimateHours != null && <span>{task.estimateHours} h</span>}
                      {task.dueDate && <span className={late ? 'late' : ''}>📅 {task.dueDate}</span>}
                      {task.assignee === 'ai' && <span>🤖 IA</span>}
                      {m && <span>🏁 {m.title}</span>}
                      {task.recurrence && <span>🔁</span>}
                    </div>
                  </div>
                );
              })}
              <ActionButton isQuiet onPress={() => setEditing({ status })}>
                <Add />
                <Text>Ajouter</Text>
              </ActionButton>
            </div>
          );
        })}
      </div>
      <DialogContainer onDismiss={() => setEditing(null)}>
        {editing && <TaskDialog task={editing.task} defaultStatus={editing.status} onClose={() => setEditing(null)} />}
      </DialogContainer>
    </div>
  );
}

const DAY = 86_400_000;

function Gantt() {
  const planner = useApp((s) => s.planner);
  const [hours, setHours] = useState(4);
  const [skipWeekends, setSkipWeekends] = useState(false);
  const [schedule, setSchedule] = useState<Schedule | null>(null);

  useEffect(() => {
    api.schedule(requireProjectId(), hours, skipWeekends).then(setSchedule, toastError);
  }, [planner, hours, skipWeekends]);

  if (!schedule || !planner) return null;
  if (schedule.items.length === 0) return <div className="fg-empty">Aucune tâche à planifier.</div>;
  const start = Date.parse(schedule.start);
  const end = Date.parse(schedule.end);
  const days = Math.max(7, Math.round((end - start) / DAY) + 2);
  const dayW = Math.max(14, Math.min(40, 900 / days));
  const labelW = 240;
  const rowH = 24;
  const width = labelW + days * dayW + 20;
  const height = 34 + schedule.items.length * rowH + 10;
  const x = (date: string) => labelW + ((Date.parse(date) - start) / DAY) * dayW;
  const todayX = x(new Date().toISOString().slice(0, 10));
  const color: Record<TaskStatus, string> = {
    todo: '#378ef0',
    in_progress: '#e68619',
    blocked: '#a05ad6',
    done: '#2d9d78',
    cancelled: '#555',
  };

  return (
    <div>
      <Flex gap="size-200" alignItems="end" marginX="size-150" marginY="size-100">
        <NumberField label="Heures de travail par jour" value={hours} onChange={(v) => v > 0 && setHours(v)} minValue={0.5} maxValue={16} step={0.5} width="size-2400" />
        <Switch isSelected={skipWeekends} onChange={setSkipWeekends}>
          Exclure les week-ends
        </Switch>
        <span style={{ fontSize: 12, color: 'var(--fg-text-2)' }}>Fin estimée : {schedule.end}</span>
      </Flex>
      <div style={{ overflow: 'auto', padding: '0 10px 16px' }}>
        <svg className="fg-gantt" width={width} height={height}>
          {Array.from({ length: days }, (_, i) => {
            const d = new Date(start + i * DAY);
            const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
            return (
              <g key={i}>
                <rect x={labelW + i * dayW} y={24} width={dayW} height={height - 24} fill={weekend ? '#1f1f1f' : 'transparent'} />
                {(i % Math.ceil(28 / dayW) === 0 || dayW > 26) && (
                  <text x={labelW + i * dayW + 2} y={16}>
                    {d.getUTCDate()}/{d.getUTCMonth() + 1}
                  </text>
                )}
              </g>
            );
          })}
          {planner.data.milestones
            .filter((m) => m.dueDate)
            .map((m) => (
              <g key={m.id}>
                <line x1={x(m.dueDate!)} x2={x(m.dueDate!)} y1={24} y2={height} stroke="#ff7a3d" strokeDasharray="4 3" />
                <text x={x(m.dueDate!) + 3} y={height - 4} style={{ fill: '#ff7a3d' }}>
                  🏁 {m.title}
                </text>
              </g>
            ))}
          <line x1={todayX} x2={todayX} y1={20} y2={height} stroke="#e34850" />
          {schedule.items.map((item, i) => {
            const y = 30 + i * rowH;
            const bx = x(item.start);
            const bw = Math.max(dayW - 2, x(item.end) - bx + dayW - 2);
            return (
              <g key={item.id}>
                <text x={4} y={y + 14}>
                  {item.assignee === 'ai' ? '🤖 ' : ''}
                  {item.title.length > 34 ? `${item.title.slice(0, 33)}…` : item.title}
                </text>
                <rect
                  x={bx}
                  y={y + 3}
                  width={bw}
                  height={rowH - 8}
                  rx={3}
                  fill={color[item.status]}
                  opacity={item.status === 'done' ? 0.55 : 0.9}
                  stroke={item.late ? '#e34850' : 'none'}
                  strokeWidth={2}
                >
                  <title>
                    {item.title} — {item.start} → {item.end}
                    {item.dueDate ? ` (échéance ${item.dueDate})` : ''}
                    {item.late ? ' — EN RETARD' : ''}
                  </title>
                </rect>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function Milestones() {
  const planner = useApp((s) => s.planner);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  if (!planner) return null;
  const create = () => {
    if (!title.trim()) return;
    void api
      .createMilestone(requireProjectId(), { title: title.trim(), ...(due ? { dueDate: due } : {}) })
      .then(() => {
        setTitle('');
        setDue('');
      })
      .catch(toastError);
  };
  const progress = (m: Milestone) => planner.review.milestones.find((p) => p.milestone.id === m.id);
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Flex gap="size-100" alignItems="end">
        <TextField label="Nouveau jalon" value={title} onChange={setTitle} width="size-4600" />
        <TextField label="Échéance" value={due} onChange={setDue} placeholder="AAAA-MM-JJ" width="size-1600" />
        <Button variant="accent" onPress={create} isDisabled={!title.trim()}>
          Créer
        </Button>
      </Flex>
      {planner.data.milestones.length === 0 && <div className="fg-empty">Aucun jalon. Demandez à l'assistant de planifier le projet !</div>}
      {planner.data.milestones.map((m) => {
        const p = progress(m);
        return (
          <div key={m.id} style={{ background: 'var(--fg-bg-3)', borderRadius: 6, padding: '10px 12px' }}>
            <Flex alignItems="center" gap="size-150">
              <strong style={{ fontSize: 14, flex: 1 }}>🏁 {m.title}</strong>
              <Picker
                aria-label="Statut du jalon"
                isQuiet
                selectedKey={m.status}
                onSelectionChange={(k) => void api.updateMilestone(requireProjectId(), m.id, { status: k as Milestone['status'] }).catch(toastError)}
                width="size-1600"
              >
                <Item key="planned">Prévu</Item>
                <Item key="active">Actif</Item>
                <Item key="done">Atteint</Item>
              </Picker>
              <ActionButton isQuiet aria-label="Supprimer le jalon" onPress={() => void api.deleteMilestone(requireProjectId(), m.id).catch(toastError)}>
                <Delete />
              </ActionButton>
            </Flex>
            {m.description && <p style={{ margin: '4px 0', fontSize: 12, color: 'var(--fg-text-2)' }}>{m.description}</p>}
            <Flex alignItems="center" gap="size-150" marginTop="size-50">
              <div className="fg-progress" style={{ flex: 1 }}>
                <div style={{ width: `${Math.round((p?.ratio ?? 0) * 100)}%` }} />
              </div>
              <span style={{ fontSize: 12, color: 'var(--fg-text-2)', whiteSpace: 'nowrap' }}>
                {p?.done ?? 0}/{p?.total ?? 0} tâches · {p?.remainingHours ?? 0} h restantes{m.dueDate ? ` · échéance ${m.dueDate}` : ''}
              </span>
            </Flex>
          </div>
        );
      })}
    </div>
  );
}

function Memory() {
  const planner = useApp((s) => s.planner);
  const [text, setText] = useState('');
  if (!planner) return null;
  const add = () => {
    if (!text.trim()) return;
    void api
      .remember(requireProjectId(), text.trim())
      .then(() => setText(''))
      .catch(toastError);
  };
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-text-2)' }}>
        La mémoire du projet réunit les décisions durables (univers, personnages, style, contraintes). L'assistant la relit à
        chaque conversation et l'enrichit lui-même.
      </p>
      <Flex gap="size-100" alignItems="end">
        <TextField label="Nouvelle note" value={text} onChange={setText} width="100%" />
        <Button variant="accent" onPress={add} isDisabled={!text.trim()}>
          Ajouter
        </Button>
      </Flex>
      {[...planner.data.memory].reverse().map((note) => (
        <div key={note.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: 'var(--fg-bg-3)', borderRadius: 6, padding: '8px 10px' }}>
          <div style={{ flex: 1, fontSize: 13 }}>
            {note.text}
            <div style={{ fontSize: 11, color: 'var(--fg-text-3)', marginTop: 3 }}>
              {new Date(note.at).toLocaleDateString('fr-FR')} {note.tags.map((t) => `#${t}`).join(' ')}
            </div>
          </div>
          <ActionButton isQuiet aria-label="Oublier" onPress={() => void api.forget(requireProjectId(), note.id).catch(toastError)}>
            <Delete />
          </ActionButton>
        </div>
      ))}
    </div>
  );
}
