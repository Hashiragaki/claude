import {
  Button,
  ButtonGroup,
  Content,
  Dialog,
  Divider,
  Flex,
  Heading,
  Item,
  NumberField,
  Picker,
  TagGroup,
  TextArea,
  TextField,
  View,
} from '@adobe/react-spectrum';
import type { Priority, Task, TaskInput, TaskStatus } from '@forge/planner';
import { useState } from 'react';
import { api } from '../api';
import { requireProjectId, toastError, useApp } from '../state/app';

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

/** Création / édition d'une tâche du planning. */
export function TaskDialog(props: { task?: Task; defaultStatus?: TaskStatus; onClose(): void }) {
  const planner = useApp((s) => s.planner);
  const { task } = props;
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? props.defaultStatus ?? 'todo');
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'medium');
  const [milestoneId, setMilestoneId] = useState<string>(task?.milestoneId ?? '');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [estimate, setEstimate] = useState<number>(task?.estimateHours ?? NaN);
  const [assignee, setAssignee] = useState<'user' | 'ai'>(task?.assignee ?? 'user');
  const [dependsOn, setDependsOn] = useState<string[]>(task?.dependsOn ?? []);
  const [tags, setTags] = useState((task?.tags ?? []).join(', '));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const others = (planner?.data.tasks ?? []).filter((t) => t.id !== task?.id && t.status !== 'cancelled');

  const submit = async () => {
    if (!title.trim()) return;
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      toastError(new Error('Échéance attendue au format AAAA-MM-JJ.'));
      return;
    }
    setBusy(true);
    const input: TaskInput = {
      title: title.trim(),
      description,
      status,
      priority,
      milestoneId: milestoneId || null,
      dueDate: dueDate || null,
      estimateHours: Number.isNaN(estimate) ? null : estimate,
      assignee,
      dependsOn,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };
    try {
      const id = requireProjectId();
      if (task) await api.updateTask(id, task.id, { ...input, ...(note.trim() ? { note: note.trim() } : {}) });
      else await api.createTask(id, input);
      props.onClose();
    } catch (error) {
      toastError(error);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!task) return;
    try {
      await api.deleteTask(requireProjectId(), task.id);
      props.onClose();
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <Dialog size="L">
      <Heading>{task ? 'Modifier la tâche' : 'Nouvelle tâche'}</Heading>
      <Divider />
      <Content>
        <Flex gap="size-300" wrap>
          <Flex direction="column" gap="size-100" flex="1 1 300px">
            <TextField label="Titre" value={title} onChange={setTitle} isRequired autoFocus width="100%" />
            <TextArea label="Description / critère de fin" value={description} onChange={setDescription} width="100%" />
            <Flex gap="size-100">
              <Picker label="Statut" selectedKey={status} onSelectionChange={(k) => setStatus(k as TaskStatus)} flex>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <Item key={k}>{v}</Item>
                ))}
              </Picker>
              <Picker
                label="Priorité"
                selectedKey={priority}
                onSelectionChange={(k) => setPriority(k as Priority)}
                flex
              >
                {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                  <Item key={k}>{v}</Item>
                ))}
              </Picker>
            </Flex>
            <Flex gap="size-100">
              <TextField label="Échéance" value={dueDate} onChange={setDueDate} placeholder="AAAA-MM-JJ" flex />
              <NumberField
                label="Estimation (h)"
                value={estimate}
                onChange={setEstimate}
                minValue={0}
                step={0.5}
                flex
              />
            </Flex>
            <Flex gap="size-100">
              <Picker
                label="Jalon"
                selectedKey={milestoneId || 'none'}
                onSelectionChange={(k) => setMilestoneId(k === 'none' ? '' : String(k))}
                flex
              >
                {[
                  <Item key="none">Aucun</Item>,
                  ...(planner?.data.milestones ?? []).map((m) => <Item key={m.id}>{m.title}</Item>),
                ]}
              </Picker>
              <Picker
                label="Réalisée par"
                selectedKey={assignee}
                onSelectionChange={(k) => setAssignee(k as 'user' | 'ai')}
                flex
              >
                <Item key="user">Moi</Item>
                <Item key="ai">L'assistant IA</Item>
              </Picker>
            </Flex>
            <TextField label="Tags (séparés par des virgules)" value={tags} onChange={setTags} width="100%" />
          </Flex>
          <Flex direction="column" gap="size-100" flex="1 1 240px">
            <Picker
              label="Ajouter une dépendance (tâche préalable)"
              selectedKey={null}
              onSelectionChange={(k) => k && !dependsOn.includes(String(k)) && setDependsOn([...dependsOn, String(k)])}
              width="100%"
            >
              {others
                .filter((t) => !dependsOn.includes(t.id))
                .map((t) => (
                  <Item key={t.id}>{t.title}</Item>
                ))}
            </Picker>
            <TagGroup
              aria-label="Dépendances"
              items={dependsOn.map((id) => ({ id, name: others.find((t) => t.id === id)?.title ?? id }))}
              onRemove={(keys) => setDependsOn(dependsOn.filter((d) => !keys.has(d)))}
              renderEmptyState={() => (
                <span style={{ fontSize: 12, color: 'var(--fg-text-3)' }}>Aucune dépendance</span>
              )}
            >
              {(item) => <Item key={item.id}>{item.name}</Item>}
            </TagGroup>
            {task && (
              <>
                <TextField label="Ajouter une note au journal" value={note} onChange={setNote} width="100%" />
                <View maxHeight="size-2400" overflow="auto" UNSAFE_style={{ fontSize: 12, color: 'var(--fg-text-2)' }}>
                  {[...task.log].reverse().map((entry, i) => (
                    <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid var(--fg-border)' }}>
                      <span style={{ color: 'var(--fg-text-3)' }}>
                        {new Date(entry.at).toLocaleString('fr-FR')} ·{' '}
                        {entry.by === 'ai' ? 'IA' : entry.by === 'user' ? 'vous' : 'système'}
                      </span>
                      <br />
                      {entry.text}
                    </div>
                  ))}
                </View>
              </>
            )}
          </Flex>
        </Flex>
      </Content>
      <ButtonGroup>
        {task && (
          <Button variant="negative" style="outline" onPress={() => void remove()}>
            Supprimer
          </Button>
        )}
        <Button variant="secondary" onPress={props.onClose}>
          Annuler
        </Button>
        <Button variant="accent" onPress={() => void submit()} isPending={busy} isDisabled={!title.trim()}>
          {task ? 'Enregistrer' : 'Créer'}
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}
