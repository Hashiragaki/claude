import {
  ActionButton,
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Divider,
  Heading,
  Item,
  Menu,
  MenuTrigger,
  Text,
} from '@adobe/react-spectrum';
import { COMMAND_TYPES, CommandSchema, type Command } from '@forge/mode-rpg';
import Add from '@spectrum-icons/workflow/Add';
import ChevronDown from '@spectrum-icons/workflow/ChevronDown';
import ChevronUp from '@spectrum-icons/workflow/ChevronUp';
import Delete from '@spectrum-icons/workflow/Delete';
import Edit from '@spectrum-icons/workflow/Edit';
import { useState, type ReactNode } from 'react';
import { CodeEditor } from '../../components/CodeEditor';
import { COMMAND_TEMPLATES, childLists, describeCommand, editList, type ListPath } from './mapOps';

/** Sélection : une commande (liste + index) ou un point d'insertion en fin de liste. */
interface Selection {
  list: ListPath;
  index: number;
}

const samePath = (a: ListPath, b: ListPath) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Liste de commandes d'une page d'événement, avec sous-listes (choix, conditions, combats). */
export function CommandList(props: { commands: Command[]; onChange(commands: Command[]): void }) {
  const [selection, setSelection] = useState<Selection>({ list: [], index: props.commands.length });
  const [editing, setEditing] = useState<{ selection: Selection; text: string; error?: string } | null>(null);

  const rows: ReactNode[] = [];
  const render = (list: Command[], path: ListPath, depth: number) => {
    list.forEach((command, index) => {
      const selected = samePath(selection.list, path) && selection.index === index;
      rows.push(
        <div
          key={`${path.join('.')}:${index}`}
          className={`fg-cmd ${selected ? 'selected' : ''}`}
          style={{ paddingLeft: 6 + depth * 16 }}
          role="button"
          tabIndex={0}
          onClick={() => setSelection({ list: path, index })}
          onDoubleClick={() => openEditor({ list: path, index }, command)}
        >
          ◆ {describeCommand(command)}
        </div>,
      );
      for (const child of childLists(command)) {
        rows.push(
          <div
            key={`${path.join('.')}:${index}:${child.key.join('.')}:h`}
            className="fg-cmd"
            style={{ paddingLeft: 6 + (depth + 1) * 16, color: 'var(--fg-text-3)' }}
          >
            ▸ {child.label}
          </div>,
        );
        render(child.list, [...path, index, ...child.key], depth + 2);
      }
    });
    const endSelected = samePath(selection.list, path) && selection.index === list.length;
    rows.push(
      <div
        key={`${path.join('.')}:end`}
        className={`fg-cmd ${endSelected ? 'selected' : ''}`}
        style={{ paddingLeft: 6 + depth * 16, color: 'var(--fg-text-3)' }}
        role="button"
        tabIndex={0}
        onClick={() => setSelection({ list: path, index: list.length })}
      >
        ◆
      </div>,
    );
  };
  render(props.commands, [], 0);

  const selectedCommand = (): Command | undefined => {
    let list: unknown = props.commands;
    for (const key of selection.list) list = (list as Record<string | number, unknown>)[key];
    return Array.isArray(list) ? (list[selection.index] as Command | undefined) : undefined;
  };

  const insert = (command: Command) => {
    const at = selection;
    props.onChange(editList(props.commands, at.list, (list) => list.splice(at.index, 0, structuredClone(command))));
    setSelection({ list: at.list, index: at.index + 1 });
  };

  const remove = () => {
    if (!selectedCommand()) return;
    props.onChange(editList(props.commands, selection.list, (list) => list.splice(selection.index, 1)));
  };

  const move = (delta: number) => {
    const target = selection.index + delta;
    if (!selectedCommand()) return;
    let length = 0;
    const next = editList(props.commands, selection.list, (list) => {
      length = list.length;
      if (target < 0 || target >= list.length) return;
      const [item] = list.splice(selection.index, 1);
      list.splice(target, 0, item as Command);
    });
    if (target < 0 || target >= length) return;
    props.onChange(next);
    setSelection({ list: selection.list, index: target });
  };

  const openEditor = (sel: Selection, command: Command) => {
    setSelection(sel);
    setEditing({ selection: sel, text: JSON.stringify(command, null, 2) });
  };

  const commitEdit = () => {
    if (!editing) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(editing.text);
    } catch (error) {
      setEditing({ ...editing, error: `JSON invalide : ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    const result = CommandSchema.safeParse(parsed);
    if (!result.success) {
      setEditing({
        ...editing,
        error: result.error.issues.map((i) => `${i.path.join('.') || 'commande'} : ${i.message}`).join('\n'),
      });
      return;
    }
    const { list, index } = editing.selection;
    props.onChange(editList(props.commands, list, (l) => l.splice(index, 1, result.data)));
    setEditing(null);
  };

  const current = selectedCommand();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <MenuTrigger>
          <ActionButton isQuiet>
            <Add />
            <Text>Ajouter</Text>
          </ActionButton>
          <Menu onAction={(key) => insert(COMMAND_TEMPLATES[key as Command['type']].command)}>
            {COMMAND_TYPES.map((type) => (
              <Item key={type}>{COMMAND_TEMPLATES[type].label}</Item>
            ))}
          </Menu>
        </MenuTrigger>
        <ActionButton
          isQuiet
          aria-label="Modifier"
          isDisabled={!current}
          onPress={() => current && openEditor(selection, current)}
        >
          <Edit />
        </ActionButton>
        <ActionButton isQuiet aria-label="Monter" isDisabled={!current} onPress={() => move(-1)}>
          <ChevronUp />
        </ActionButton>
        <ActionButton isQuiet aria-label="Descendre" isDisabled={!current} onPress={() => move(1)}>
          <ChevronDown />
        </ActionButton>
        <ActionButton isQuiet aria-label="Supprimer" isDisabled={!current} onPress={remove}>
          <Delete />
        </ActionButton>
      </div>
      <div
        style={{ background: 'var(--fg-bg-0)', borderRadius: 4, padding: '4px 0', maxHeight: 360, overflow: 'auto' }}
      >
        {rows}
      </div>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--fg-text-3)' }}>
        Double-cliquez sur une commande pour la modifier. « Ajouter » insère avant la ligne sélectionnée (◆ vide = fin
        de liste).
      </p>
      <DialogContainer onDismiss={() => setEditing(null)}>
        {editing && (
          <Dialog size="L">
            <Heading>Modifier la commande</Heading>
            <Divider />
            <Content>
              <div
                style={{ height: 320, display: 'flex', flexDirection: 'column', border: '1px solid var(--fg-border)' }}
              >
                <CodeEditor
                  value={editing.text}
                  language="json"
                  onChange={(text) => setEditing({ ...editing, text, error: undefined })}
                  onSave={commitEdit}
                />
              </div>
              {editing.error && (
                <pre style={{ color: 'var(--fg-err)', fontSize: 12, whiteSpace: 'pre-wrap' }}>{editing.error}</pre>
              )}
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={() => setEditing(null)}>
                Annuler
              </Button>
              <Button variant="accent" onPress={commitEdit}>
                Appliquer
              </Button>
            </ButtonGroup>
          </Dialog>
        )}
      </DialogContainer>
    </div>
  );
}
