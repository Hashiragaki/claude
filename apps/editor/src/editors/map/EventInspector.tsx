import {
  ActionButton,
  Flex,
  Item,
  NumberField,
  Picker,
  TabList,
  TabPanels,
  Tabs,
  Text,
  TextField,
} from '@adobe/react-spectrum';
import type { EventPage, RpgEvent } from '@forge/mode-rpg';
import Add from '@spectrum-icons/workflow/Add';
import Delete from '@spectrum-icons/workflow/Delete';
import { useState } from 'react';
import { useApp } from '../../state/app';
import { CommandList } from './CommandList';

const TRIGGERS: Record<EventPage['trigger'], string> = {
  action: 'Touche action',
  touch: 'Contact du joueur',
  autorun: 'Automatique (bloquant)',
  parallel: 'Processus parallèle',
};

const PRIORITIES: Record<EventPage['priority'], string> = {
  below: 'Sous le joueur (traversable)',
  same: 'Même niveau (bloque)',
  above: 'Au-dessus du joueur',
};

const MOVEMENTS: Record<EventPage['movement'], string> = {
  fixed: 'Fixe',
  random: 'Aléatoire',
  approach: 'S\'approche du joueur',
};

export function newPage(): EventPage {
  return { trigger: 'action', priority: 'same', movement: 'fixed', commands: [] };
}

/** Propriétés d'un événement : nom, pages (conditions, apparence, déclencheur) et commandes. */
export function EventInspector(props: { event: RpgEvent; onChange(event: RpgEvent): void; onDelete(): void }) {
  const { event } = props;
  const project = useApp((s) => s.project);
  const [pageIndex, setPageIndex] = useState(0);
  const charsets = (project?.assets ?? []).filter((a) => a.kind === 'charset' && a.alias);
  const page = event.pages[Math.min(pageIndex, event.pages.length - 1)] as EventPage;
  const setPage = (patch: Partial<EventPage>) =>
    props.onChange({ ...event, pages: event.pages.map((p, i) => (i === pageIndex ? { ...p, ...patch } : p)) });
  const conditions = page.conditions ?? {};
  const setCondition = (key: keyof NonNullable<EventPage['conditions']>, value: unknown) => {
    const next: Record<string, unknown> = { ...conditions };
    if (value === undefined || value === '') delete next[key];
    else next[key] = value;
    setPage({ conditions: Object.keys(next).length ? (next as EventPage['conditions']) : undefined });
  };
  const graphic = page.graphic;
  const graphicKind = graphic === null || graphic === undefined ? 'none' : 'charset' in graphic ? 'charset' : 'tile';

  return (
    <Flex direction="column" gap="size-100">
      <Flex gap="size-100" alignItems="end">
        <TextField label="Nom" value={event.name} onChange={(name) => props.onChange({ ...event, name })} flex />
        <ActionButton aria-label="Supprimer l'événement" onPress={props.onDelete}>
          <Delete />
        </ActionButton>
      </Flex>
      <span style={{ fontSize: 11, color: 'var(--fg-text-3)' }}>
        {event.id} · case ({event.x}, {event.y}) · la page active est la dernière dont les conditions sont remplies
      </span>
      <Flex alignItems="center" gap="size-50">
        <Tabs aria-label="Pages" selectedKey={String(pageIndex)} onSelectionChange={(k) => setPageIndex(Number(k))} density="compact" isQuiet>
          <TabList>
            {event.pages.map((_, i) => (
              <Item key={String(i)}>{`Page ${i + 1}`}</Item>
            ))}
          </TabList>
          <TabPanels UNSAFE_style={{ display: 'none' }}>
            {event.pages.map((_, i) => (
              <Item key={String(i)}>{''}</Item>
            ))}
          </TabPanels>
        </Tabs>
        <ActionButton
          isQuiet
          aria-label="Ajouter une page"
          onPress={() => {
            props.onChange({ ...event, pages: [...event.pages, { ...structuredClone(page), commands: [] }] });
            setPageIndex(event.pages.length);
          }}
        >
          <Add />
        </ActionButton>
        {event.pages.length > 1 && (
          <ActionButton
            isQuiet
            aria-label="Supprimer la page"
            onPress={() => {
              props.onChange({ ...event, pages: event.pages.filter((_, i) => i !== pageIndex) });
              setPageIndex(Math.max(0, pageIndex - 1));
            }}
          >
            <Delete />
          </ActionButton>
        )}
      </Flex>

      <div className="fg-section-title" style={{ margin: '4px 0 0' }}>
        Conditions
      </div>
      <Flex gap="size-100" wrap>
        <TextField label="Interrupteur ON" value={conditions.switch ?? ''} onChange={(v) => setCondition('switch', v)} width="size-2000" />
        <Picker
          label="Interrupteur local"
          selectedKey={conditions.selfSwitch ?? 'none'}
          onSelectionChange={(k) => setCondition('selfSwitch', k === 'none' ? undefined : k)}
          width="size-1600"
        >
          <Item key="none">—</Item>
          <Item key="A">A</Item>
          <Item key="B">B</Item>
          <Item key="C">C</Item>
          <Item key="D">D</Item>
        </Picker>
        <TextField label="Objet possédé" value={conditions.item ?? ''} onChange={(v) => setCondition('item', v)} width="size-2000" />
      </Flex>

      <div className="fg-section-title" style={{ margin: '4px 0 0' }}>
        Apparence et comportement
      </div>
      <Flex gap="size-100" wrap>
        <Picker
          label="Apparence"
          selectedKey={graphicKind === 'charset' ? (graphic as { charset: string }).charset : graphicKind}
          onSelectionChange={(k) => {
            const key = String(k);
            if (key === 'none') setPage({ graphic: null });
            else if (key === 'tile') setPage({ graphic: { tile: 23 } });
            else setPage({ graphic: { charset: key, direction: 'down' } });
          }}
          width="size-2400"
        >
          {[
            <Item key="none">Invisible</Item>,
            <Item key="tile">Tuile du tileset</Item>,
            ...charsets.map((c) => <Item key={c.alias!}>{`🧍 ${c.alias}`}</Item>),
          ]}
        </Picker>
        {graphic && 'charset' in graphic && (
          <Picker
            label="Direction"
            selectedKey={graphic.direction ?? 'down'}
            onSelectionChange={(k) => setPage({ graphic: { ...graphic, direction: k as 'down' | 'left' | 'right' | 'up' } })}
            width="size-1600"
          >
            <Item key="down">Bas</Item>
            <Item key="left">Gauche</Item>
            <Item key="right">Droite</Item>
            <Item key="up">Haut</Item>
          </Picker>
        )}
        {graphic && 'tile' in graphic && (
          <NumberField label="Index de tuile" value={graphic.tile} minValue={0} onChange={(tile) => setPage({ graphic: { tile } })} width="size-1600" />
        )}
      </Flex>
      <Flex gap="size-100" wrap>
        <Picker label="Déclencheur" selectedKey={page.trigger} onSelectionChange={(k) => setPage({ trigger: k as EventPage['trigger'] })} width="size-2400">
          {Object.entries(TRIGGERS).map(([k, v]) => (
            <Item key={k}>{v}</Item>
          ))}
        </Picker>
        <Picker label="Priorité" selectedKey={page.priority} onSelectionChange={(k) => setPage({ priority: k as EventPage['priority'] })} width="size-2400">
          {Object.entries(PRIORITIES).map(([k, v]) => (
            <Item key={k}>{v}</Item>
          ))}
        </Picker>
        <Picker label="Déplacement" selectedKey={page.movement} onSelectionChange={(k) => setPage({ movement: k as EventPage['movement'] })} width="size-2000">
          {Object.entries(MOVEMENTS).map(([k, v]) => (
            <Item key={k}>{v}</Item>
          ))}
        </Picker>
      </Flex>

      <div className="fg-section-title" style={{ margin: '4px 0 0' }}>
        <Text>Commandes</Text>
      </div>
      <CommandList key={`${event.id}:${pageIndex}`} commands={page.commands} onChange={(commands) => setPage({ commands })} />
    </Flex>
  );
}
