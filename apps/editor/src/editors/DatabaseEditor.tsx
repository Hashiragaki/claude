import {
  ActionButton,
  Button,
  Flex,
  Item,
  NumberField,
  Picker,
  Switch,
  TabList,
  TabPanels,
  Tabs,
  TagGroup,
  Text,
  TextArea,
  TextField,
} from '@adobe/react-spectrum';
import type { AssetMeta } from '@forge/core';
import {
  ITEM_EFFECTS,
  RpgDatabaseSchema,
  RpgSystemSchema,
  SKILL_TARGETS,
  type RpgDatabase,
  type RpgSystem,
} from '@forge/mode-rpg';
import Add from '@spectrum-icons/workflow/Add';
import Delete from '@spectrum-icons/workflow/Delete';
import SaveFloppy from '@spectrum-icons/workflow/SaveFloppy';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { log, toastError, useApp, validateProject } from '../state/app';
import { canAddEntry, newEntry, type Category, type Entry } from './databaseEntries';

const CATEGORY_LABELS: Record<Category, string> = {
  actors: 'Héros',
  items: 'Objets',
  skills: 'Compétences',
  enemies: 'Ennemis',
  troops: 'Troupes',
};

const EFFECT_LABELS: Record<string, string> = {
  heal: 'Soigne (PV)',
  mp: 'Restaure (PM)',
  revive: 'Ressuscite',
  damage: 'Inflige des dégâts',
  none: 'Aucun',
};
const TARGET_LABELS: Record<string, string> = {
  enemy: 'Un ennemi',
  allEnemies: 'Tous les ennemis',
  ally: 'Un allié',
  allAllies: 'Tous les alliés',
  self: 'Soi-même',
};

/** Base de données du RPG : héros, objets, compétences, ennemis, troupes, et réglages système. */
export function DatabaseEditor({ path }: { path: string }) {
  const project = useApp((s) => s.project);
  const revision = useApp((s) => s.fileRevision[path] ?? 0);
  const [db, setDb] = useState<RpgDatabase | null>(null);
  const [system, setSystem] = useState<RpgSystem | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [category, setCategory] = useState<Category | 'system'>('actors');
  const [selected, setSelected] = useState<string | null>(null);
  const projectId = project?.id ?? '';
  const systemPath = project?.entry ?? 'data/system.json';
  const systemRevision = useApp((s) => s.fileRevision[systemPath] ?? 0);

  useEffect(() => {
    if (!projectId) return;
    void Promise.all([api.readJson<unknown>(projectId, path), api.readJson<unknown>(projectId, systemPath)]).then(
      ([rawDb, rawSystem]) => {
        const dbResult = RpgDatabaseSchema.safeParse(rawDb);
        if (!dbResult.success) {
          const detail = dbResult.error.issues[0]?.message ?? 'erreur inconnue';
          setLoadError(`Base de données invalide (${path}) : ${detail}.`);
          return;
        }
        const systemResult = RpgSystemSchema.safeParse(rawSystem);
        if (!systemResult.success) {
          const detail = systemResult.error.issues[0]?.message ?? 'erreur inconnue';
          setLoadError(`Système invalide (${systemPath}) : ${detail}.`);
          return;
        }
        setLoadError(null);
        setDb(dbResult.data);
        setSystem(systemResult.data);
        setDirty(false);
      },
      toastError,
    );
  }, [projectId, path, systemPath, revision, systemRevision]);

  if (loadError) return <div className="fg-empty">{loadError}</div>;
  if (!db || !system || !project) return <div className="fg-empty">Chargement…</div>;

  const assetsOf = (kind: AssetMeta['kind']) => project.assets.filter((a) => a.kind === kind && a.alias);
  const save = async () => {
    try {
      await api.writeJson(projectId, path, db);
      await api.writeJson(projectId, systemPath, system);
      setDirty(false);
      log('info', 'éditeur', 'Base de données enregistrée.');
      void validateProject();
    } catch (error) {
      toastError(error);
    }
  };

  const list = category === 'system' ? [] : (db[category] as unknown as Entry[]);
  const entry = list.find((e) => e.id === selected) ?? list[0];
  const updateEntry = (patch: Record<string, unknown>) => {
    if (category === 'system' || !entry) return;
    setDb({ ...db, [category]: list.map((e) => (e.id === entry.id ? { ...e, ...patch } : e)) } as RpgDatabase);
    setDirty(true);
  };
  const newEntryCtx = {
    firstCharsetAlias: assetsOf('charset')[0]?.alias,
    firstBattlerAlias: assetsOf('image')[0]?.alias,
    firstEnemyId: db.enemies[0]?.id,
  };
  const canAdd = category !== 'system' && canAddEntry(category, newEntryCtx);
  const addEntry = () => {
    if (category === 'system' || !canAddEntry(category, newEntryCtx)) return;
    const prefix = { actors: 'hero', items: 'objet', skills: 'comp', enemies: 'ennemi', troops: 'troupe' }[category];
    let n = list.length + 1;
    while (list.some((e) => e.id === `${prefix}${n}`)) n++;
    const created = newEntry(category, `${prefix}${n}`, newEntryCtx);
    setDb({ ...db, [category]: [...list, created] } as RpgDatabase);
    setSelected(created.id);
    setDirty(true);
  };
  const removeEntry = () => {
    if (category === 'system' || !entry) return;
    setDb({ ...db, [category]: list.filter((e) => e.id !== entry.id) } as RpgDatabase);
    setSelected(null);
    setDirty(true);
  };

  const num = (label: string, key: string, min = 0) => (
    <NumberField
      key={key}
      label={label}
      value={Number(entry?.[key] ?? 0)}
      minValue={min}
      onChange={(v) => !Number.isNaN(v) && updateEntry({ [key]: v })}
      width="size-1600"
    />
  );
  const assetPicker = (label: string, key: string, kind: AssetMeta['kind'], optional = false) => (
    <Picker
      key={key}
      label={label}
      selectedKey={(entry?.[key] as string | undefined) || (optional ? 'none' : null)}
      onSelectionChange={(k) => updateEntry({ [key]: k === 'none' ? undefined : String(k) })}
      width="size-3000"
    >
      {[
        ...(optional ? [<Item key="none">Aucune</Item>] : []),
        ...assetsOf(kind).map((a) => <Item key={a.alias!}>{a.alias!}</Item>),
      ]}
    </Picker>
  );
  const idList = (label: string, key: string, options: { id: string; name: string }[]) => {
    const values = (entry?.[key] as string[] | undefined) ?? [];
    return (
      <Flex key={key} direction="column" gap="size-50">
        <Picker
          label={label}
          selectedKey={null}
          onSelectionChange={(k) => k && updateEntry({ [key]: [...values, String(k)] })}
          width="size-3000"
        >
          {options.map((o) => (
            <Item key={o.id}>{`${o.name} (${o.id})`}</Item>
          ))}
        </Picker>
        <TagGroup
          aria-label={label}
          items={values.map((v, i) => ({ key: `${v}:${i}`, id: v, name: options.find((o) => o.id === v)?.name ?? v }))}
          onRemove={(keys) => updateEntry({ [key]: values.filter((v, i) => !keys.has(`${v}:${i}`)) })}
          renderEmptyState={() => <span style={{ fontSize: 12, color: 'var(--fg-text-3)' }}>Aucun</span>}
        >
          {(item) => <Item key={item.key}>{item.name}</Item>}
        </TagGroup>
      </Flex>
    );
  };

  let form: ReactNode = null;
  if (entry && category !== 'system') {
    const common = [
      <Flex key="id" gap="size-100">
        <TextField label="Identifiant" value={entry.id} isReadOnly width="size-2000" />
        <TextField label="Nom" value={entry.name} onChange={(name) => updateEntry({ name })} width="size-3000" />
      </Flex>,
    ];
    switch (category) {
      case 'actors':
        form = [
          ...common,
          <Flex key="assets" gap="size-100" wrap>
            {assetPicker('Charset (carte)', 'charset', 'charset')}
            {assetPicker('Image de combat', 'battler', 'image', true)}
          </Flex>,
          <Flex key="stats" gap="size-100" wrap>
            {num('Niveau', 'level', 1)}
            {num('PV max', 'maxHp', 1)}
            {num('PM max', 'maxMp')}
            {num('Attaque', 'atk')}
            {num('Défense', 'def')}
            {num('Magie', 'mag')}
            {num('Agilité', 'agi')}
          </Flex>,
          idList('Compétences', 'skills', db.skills),
        ];
        break;
      case 'items': {
        const effect = (entry.effect as { type: string; value: number } | undefined) ?? { type: 'none', value: 0 };
        form = [
          ...common,
          <TextArea
            key="desc"
            label="Description"
            value={String(entry.description ?? '')}
            onChange={(description) => updateEntry({ description })}
            width="100%"
          />,
          <Flex key="effect" gap="size-100" wrap alignItems="end">
            <Picker
              label="Effet"
              selectedKey={effect.type}
              onSelectionChange={(k) => updateEntry({ effect: { ...effect, type: String(k) } })}
              width="size-2400"
            >
              {ITEM_EFFECTS.map((e) => (
                <Item key={e}>{EFFECT_LABELS[e] ?? e}</Item>
              ))}
            </Picker>
            <NumberField
              label="Valeur"
              value={effect.value}
              onChange={(value) => updateEntry({ effect: { ...effect, value } })}
              width="size-1600"
            />
            {num('Prix', 'price')}
          </Flex>,
          <Flex key="flags" gap="size-200">
            <Switch isSelected={Boolean(entry.consumable)} onChange={(consumable) => updateEntry({ consumable })}>
              Consommable
            </Switch>
            <Switch isSelected={Boolean(entry.key)} onChange={(key) => updateEntry({ key })}>
              Objet clé
            </Switch>
          </Flex>,
        ];
        break;
      }
      case 'skills':
        form = [
          ...common,
          <TextArea
            key="desc"
            label="Description"
            value={String(entry.description ?? '')}
            onChange={(description) => updateEntry({ description })}
            width="100%"
          />,
          <Flex key="kind" gap="size-100" wrap>
            <Picker
              label="Type"
              selectedKey={String(entry.type ?? 'damage')}
              onSelectionChange={(k) => updateEntry({ type: String(k) })}
              width="size-2000"
            >
              <Item key="damage">Dégâts</Item>
              <Item key="heal">Soin</Item>
            </Picker>
            <Picker
              label="Cible"
              selectedKey={String(entry.target ?? 'enemy')}
              onSelectionChange={(k) => updateEntry({ target: String(k) })}
              width="size-2400"
            >
              {SKILL_TARGETS.map((t) => (
                <Item key={t}>{TARGET_LABELS[t] ?? t}</Item>
              ))}
            </Picker>
            {num('Coût en PM', 'mpCost')}
            {num('Puissance', 'power')}
          </Flex>,
          assetPicker('Son', 'sfx', 'sfx', true),
        ];
        break;
      case 'enemies': {
        const drops = (entry.drops as { item: string; chance: number }[] | undefined) ?? [];
        form = [
          ...common,
          assetPicker('Image de combat', 'battler', 'image'),
          <Flex key="stats" gap="size-100" wrap>
            {num('PV max', 'maxHp', 1)}
            {num('PM max', 'maxMp')}
            {num('Attaque', 'atk')}
            {num('Défense', 'def')}
            {num('Magie', 'mag')}
            {num('Agilité', 'agi')}
            {num('Expérience', 'exp')}
            {num('Or', 'gold')}
          </Flex>,
          idList('Compétences', 'skills', db.skills),
          <div key="drops">
            <div className="fg-section-title" style={{ margin: '8px 0 4px' }}>
              Butin
            </div>
            {drops.map((d, i) => (
              <Flex key={i} gap="size-100" alignItems="end">
                <Picker
                  aria-label="Objet"
                  selectedKey={d.item}
                  onSelectionChange={(k) =>
                    updateEntry({ drops: drops.map((x, j) => (j === i ? { ...x, item: String(k) } : x)) })
                  }
                  width="size-3000"
                >
                  {db.items.map((it) => (
                    <Item key={it.id}>{it.name}</Item>
                  ))}
                </Picker>
                <NumberField
                  aria-label="Probabilité"
                  value={d.chance}
                  minValue={0}
                  maxValue={1}
                  step={0.05}
                  formatOptions={{ style: 'percent' }}
                  onChange={(chance) => updateEntry({ drops: drops.map((x, j) => (j === i ? { ...x, chance } : x)) })}
                  width="size-1600"
                />
                <ActionButton
                  aria-label="Retirer"
                  onPress={() => updateEntry({ drops: drops.filter((_, j) => j !== i) })}
                >
                  <Delete />
                </ActionButton>
              </Flex>
            ))}
            <ActionButton
              isQuiet
              onPress={() => db.items[0] && updateEntry({ drops: [...drops, { item: db.items[0].id, chance: 0.25 }] })}
              isDisabled={db.items.length === 0}
            >
              <Add />
              <Text>Ajouter un butin</Text>
            </ActionButton>
          </div>,
        ];
        break;
      }
      case 'troops':
        form = [...common, idList('Membres', 'members', db.enemies)];
        break;
    }
  }

  const setSys = (patch: Partial<RpgSystem>) => {
    setSystem({ ...system, ...patch });
    setDirty(true);
  };
  const musicOptions = [
    <Item key="none">Aucune</Item>,
    ...assetsOf('music').map((a) => <Item key={a.alias!}>{a.alias!}</Item>),
  ];

  return (
    <div className="fg-panel">
      <div className="fg-toolbar">
        <Tabs
          aria-label="Catégories"
          selectedKey={category}
          onSelectionChange={(k) => {
            setCategory(k as Category | 'system');
            setSelected(null);
          }}
          isQuiet
          density="compact"
        >
          <TabList>
            {[
              ...(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => <Item key={c}>{CATEGORY_LABELS[c]}</Item>),
              <Item key="system">Système</Item>,
            ]}
          </TabList>
          <TabPanels UNSAFE_style={{ display: 'none' }}>
            {[...(Object.keys(CATEGORY_LABELS) as string[]), 'system'].map((c) => (
              <Item key={c}>{''}</Item>
            ))}
          </TabPanels>
        </Tabs>
        <div className="fg-spacer" />
        <Button variant="accent" onPress={() => void save()} isDisabled={!dirty}>
          <SaveFloppy />
          <Text>Enregistrer{dirty ? ' •' : ''}</Text>
        </Button>
      </div>
      {category === 'system' ? (
        <div className="fg-scroll" style={{ padding: 14 }}>
          <Flex direction="column" gap="size-100" maxWidth="size-6000">
            <TextField label="Titre du jeu" value={system.title} onChange={(title) => setSys({ title })} />
            <Flex gap="size-100" wrap>
              <TextField
                label="Carte de départ"
                value={system.startMap}
                onChange={(startMap) => setSys({ startMap })}
                width="size-2000"
              />
              <NumberField
                label="X"
                value={system.startX}
                minValue={0}
                onChange={(startX) => setSys({ startX })}
                width="size-1200"
              />
              <NumberField
                label="Y"
                value={system.startY}
                minValue={0}
                onChange={(startY) => setSys({ startY })}
                width="size-1200"
              />
              <NumberField
                label="Or de départ"
                value={system.startGold}
                minValue={0}
                onChange={(startGold) => setSys({ startGold })}
                width="size-1600"
              />
              <NumberField
                label="Zoom"
                value={system.zoom}
                minValue={1}
                maxValue={6}
                step={1}
                onChange={(zoom) => setSys({ zoom })}
                width="size-1200"
              />
            </Flex>
            <Picker
              label="Ajouter un héros à l'équipe"
              selectedKey={null}
              onSelectionChange={(k) => k && setSys({ party: [...system.party, String(k)] })}
            >
              {db.actors.map((a) => (
                <Item key={a.id}>{a.name}</Item>
              ))}
            </Picker>
            <TagGroup
              aria-label="Équipe"
              items={system.party.map((id, i) => ({
                key: `${id}:${i}`,
                name: db.actors.find((a) => a.id === id)?.name ?? id,
              }))}
              onRemove={(keys) => setSys({ party: system.party.filter((id, i) => !keys.has(`${id}:${i}`)) })}
            >
              {(item) => <Item key={item.key}>{item.name}</Item>}
            </TagGroup>
            <Flex gap="size-100" wrap>
              {(['titleMusic', 'mapMusic', 'battleMusic', 'victoryMusic'] as const).map((key) => (
                <Picker
                  key={key}
                  label={
                    {
                      titleMusic: 'Musique du titre',
                      mapMusic: 'Musique des cartes',
                      battleMusic: 'Musique de combat',
                      victoryMusic: 'Victoire',
                    }[key]
                  }
                  selectedKey={system[key] ?? 'none'}
                  onSelectionChange={(k) => setSys({ [key]: k === 'none' ? undefined : String(k) })}
                  width="size-2400"
                >
                  {musicOptions}
                </Picker>
              ))}
            </Flex>
            <Picker
              label="Fond des combats"
              selectedKey={system.battleback ?? 'none'}
              onSelectionChange={(k) => setSys({ battleback: k === 'none' ? undefined : String(k) })}
            >
              {[
                <Item key="none">Dégradé par défaut</Item>,
                ...assetsOf('image').map((a) => <Item key={a.alias!}>{a.alias!}</Item>),
              ]}
            </Picker>
          </Flex>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div
            style={{
              width: 240,
              borderRight: '1px solid var(--fg-bg-0)',
              overflow: 'auto',
              background: 'var(--fg-bg-1)',
            }}
          >
            <Flex margin="size-100" gap="size-100">
              <ActionButton onPress={addEntry} isDisabled={!canAdd}>
                <Add />
                <Text>Ajouter</Text>
              </ActionButton>
              <ActionButton onPress={removeEntry} isDisabled={!entry} aria-label="Supprimer">
                <Delete />
              </ActionButton>
            </Flex>
            {list.map((e) => (
              <div
                key={e.id}
                className={`fg-cmd ${entry?.id === e.id ? 'selected' : ''}`}
                style={{ fontFamily: 'inherit' }}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(e.id)}
              >
                {e.name} <span style={{ color: 'var(--fg-text-3)' }}>({e.id})</span>
              </div>
            ))}
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
            {entry ? (
              <Flex direction="column" gap="size-150">
                {form}
              </Flex>
            ) : (
              <div className="fg-empty">Aucun élément. Cliquez sur « Ajouter ».</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
