import {
  ActionButton,
  AlertDialog,
  Button,
  DialogContainer,
  Flex,
  Item,
  NumberField,
  Picker,
  Switch,
  Text,
  TextArea,
  TextField,
} from '@adobe/react-spectrum';
import type { AssetMeta, ProjectManifest } from '@forge/core';
import Copy from '@spectrum-icons/workflow/Copy';
import Delete from '@spectrum-icons/workflow/Delete';
import MagicWand from '@spectrum-icons/workflow/MagicWand';
import Refresh from '@spectrum-icons/workflow/Refresh';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { KIND_LABELS } from '../components/AssetThumb';
import { AssetPreview } from '../components/Previews';
import { generateAsset, requireProjectId, selectAsset, toastError, toastOk, updateProject, useApp } from '../state/app';

/** Propriétés de l'asset sélectionné, ou du projet si rien n'est sélectionné. */
export function PropertiesPanel() {
  const project = useApp((s) => s.project);
  const selectedId = useApp((s) => s.selectedAssetId);
  if (!project) return null;
  const asset = project.assets.find((a) => a.id === selectedId);
  return (
    <div className="fg-panel">
      <div className="fg-scroll">{asset ? <AssetProperties key={asset.id} asset={asset} project={project} /> : <ProjectProperties project={project} />}</div>
    </div>
  );
}

function ORIGIN(origin: AssetMeta['origin']): string {
  return { ai: 'IA (Claude)', procedural: 'Procédural', import: 'Importé', template: 'Modèle de projet' }[origin];
}

function AssetProperties({ asset, project }: { asset: AssetMeta; project: ProjectManifest }) {
  const aiEnabled = useApp((s) => s.health?.ai.enabled ?? false);
  const [name, setName] = useState(asset.name);
  const [alias, setAlias] = useState(asset.alias ?? '');
  const [tags, setTags] = useState(asset.tags.join(', '));
  const [instruction, setInstruction] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(asset.name);
    setAlias(asset.alias ?? '');
    setTags(asset.tags.join(', '));
  }, [asset]);

  const save = async (patch: Parameters<typeof api.updateAsset>[2]) => {
    try {
      await api.updateAsset(requireProjectId(), asset.id, patch);
    } catch (error) {
      toastError(error);
    }
  };

  // Historique : ancêtres (parentId) et descendants.
  const byId = new Map(project.assets.map((a) => [a.id, a]));
  const chain: AssetMeta[] = [];
  let cursor: AssetMeta | undefined = asset;
  while (cursor?.parentId && byId.has(cursor.parentId)) {
    cursor = byId.get(cursor.parentId);
    if (cursor) chain.push(cursor);
  }
  const children = project.assets.filter((a) => a.parentId === asset.id);

  const variant = () =>
    void generateAsset({
      generator: asset.generator ?? '',
      params: asset.params ?? {},
      parentId: asset.id,
      mode: asset.origin === 'ai' && aiEnabled ? 'ai' : 'procedural',
    }).catch(toastError);

  const retouch = () => {
    if (!instruction.trim()) return;
    void generateAsset({ generator: asset.generator ?? '', parentId: asset.id, instruction: instruction.trim(), mode: 'ai' })
      .then(() => setInstruction(''))
      .catch(toastError);
  };

  return (
    <>
      <AssetPreview asset={asset} />
      <Flex direction="column" gap="size-100" marginX="size-150">
        <TextField label="Nom" value={name} onChange={setName} onBlur={() => name !== asset.name && void save({ name })} width="100%" />
        <Flex gap="size-100" alignItems="end">
          <TextField
            label="Alias (utilisé dans les scripts et cartes)"
            value={alias}
            onChange={setAlias}
            onBlur={() => alias !== (asset.alias ?? '') && void save({ alias: alias.trim() || null })}
            width="100%"
          />
          <ActionButton
            aria-label="Copier l'alias"
            isDisabled={!asset.alias}
            onPress={() => {
              void navigator.clipboard.writeText(asset.alias ?? '');
              toastOk('Alias copié.');
            }}
          >
            <Copy />
          </ActionButton>
        </Flex>
        <TextField
          label="Tags (séparés par des virgules)"
          value={tags}
          onChange={setTags}
          onBlur={() =>
            void save({
              tags: tags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            })
          }
          width="100%"
        />
        <Flex gap="size-100" wrap marginTop="size-100">
          {asset.generator && (
            <Button variant="secondary" onPress={variant}>
              <Refresh />
              <Text>Nouvelle variante</Text>
            </Button>
          )}
          <Button variant="negative" style="outline" onPress={() => setConfirmDelete(true)}>
            <Delete />
            <Text>Supprimer</Text>
          </Button>
        </Flex>
        {asset.generator && asset.extra.spec && (
          <>
            <TextArea
              label="Retoucher avec l'IA"
              value={instruction}
              onChange={setInstruction}
              placeholder={aiEnabled ? 'ex. « rends le ciel plus orageux », « ajoute un chapeau »' : 'Nécessite une clé API Claude'}
              isDisabled={!aiEnabled}
              width="100%"
            />
            <div>
              <Button variant="accent" onPress={retouch} isDisabled={!aiEnabled || !instruction.trim()}>
                <MagicWand />
                <Text>Retoucher</Text>
              </Button>
            </div>
          </>
        )}
      </Flex>

      <div className="fg-section-title">Informations</div>
      <dl className="fg-kv">
        <dt>Type</dt>
        <dd>{KIND_LABELS[asset.kind]}</dd>
        <dt>Origine</dt>
        <dd>{ORIGIN(asset.origin)}</dd>
        {asset.generator && (
          <>
            <dt>Générateur</dt>
            <dd className="fg-mono">{asset.generator}</dd>
          </>
        )}
        <dt>Version</dt>
        <dd>v{asset.version}</dd>
        <dt>Fichier</dt>
        <dd className="fg-mono">
          <a href={api.fileUrl(project.id, asset.file)} target="_blank" rel="noreferrer" style={{ color: 'var(--fg-accent-2)' }}>
            {asset.file}
          </a>
        </dd>
        {Object.entries(asset.info).map(([k, v]) => (
          <FragmentKV key={k} k={k} v={String(v)} />
        ))}
        {asset.seed !== undefined && <FragmentKV k="Graine" v={String(asset.seed)} />}
        <dt>Créé le</dt>
        <dd>{new Date(asset.createdAt).toLocaleString('fr-FR')}</dd>
        {asset.prompt && (
          <>
            <dt>Description</dt>
            <dd>{asset.prompt}</dd>
          </>
        )}
      </dl>

      {(chain.length > 0 || children.length > 0) && (
        <>
          <div className="fg-section-title">Historique des versions</div>
          <div style={{ padding: '0 12px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[...children, asset, ...chain].map((v) => (
              <div
                key={v.id}
                className="fg-cmd"
                role="button"
                tabIndex={0}
                onClick={() => selectAsset(v.id)}
                style={{ fontFamily: 'inherit', color: v.id === asset.id ? 'var(--fg-text)' : 'var(--fg-text-2)' }}
              >
                v{v.version} — {v.name} {v.id === asset.id ? '(sélectionnée)' : ''} · {ORIGIN(v.origin)}
              </div>
            ))}
          </div>
        </>
      )}
      <DialogContainer onDismiss={() => setConfirmDelete(false)}>
        {confirmDelete && (
          <AlertDialog
            title="Supprimer cet asset ?"
            variant="destructive"
            primaryActionLabel="Supprimer"
            cancelLabel="Annuler"
            onPrimaryAction={() =>
              void api
                .deleteAsset(requireProjectId(), asset.id)
                .then(() => selectAsset(null))
                .catch(toastError)
            }
          >
            « {asset.name} » et ses fichiers seront supprimés. Les scripts qui utilisent l'alias « {asset.alias ?? '—'} »
            ne le trouveront plus.
          </AlertDialog>
        )}
      </DialogContainer>
    </>
  );
}

function FragmentKV({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

function ProjectProperties({ project }: { project: ProjectManifest }) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  useEffect(() => {
    setName(project.name);
    setDescription(project.description);
  }, [project.name, project.description]);
  const apply = (patch: Parameters<typeof updateProject>[0]) => void updateProject(patch).catch(toastError);
  return (
    <Flex direction="column" gap="size-100" margin="size-150">
      <div className="fg-section-title" style={{ margin: '0 0 4px' }}>
        Projet
      </div>
      <TextField label="Nom" value={name} onChange={setName} onBlur={() => name.trim() && name !== project.name && apply({ name })} width="100%" />
      <TextArea
        label="Description"
        value={description}
        onChange={setDescription}
        onBlur={() => description !== project.description && apply({ description })}
        width="100%"
      />
      <Flex gap="size-100">
        <NumberField
          label="Largeur"
          value={project.resolution.width}
          minValue={64}
          maxValue={4096}
          onChange={(w) => !Number.isNaN(w) && apply({ resolution: { ...project.resolution, width: w } })}
          flex
        />
        <NumberField
          label="Hauteur"
          value={project.resolution.height}
          minValue={64}
          maxValue={4096}
          onChange={(h) => !Number.isNaN(h) && apply({ resolution: { ...project.resolution, height: h } })}
          flex
        />
      </Flex>
      <Switch isSelected={project.pixelArt} onChange={(v) => apply({ pixelArt: v })}>
        Rendu pixel-art (sans lissage)
      </Switch>
      <Picker label="Langue du jeu" selectedKey={project.locale} onSelectionChange={(k) => apply({ locale: String(k) })} width="100%">
        <Item key="fr">Français</Item>
        <Item key="en">English</Item>
      </Picker>
      <dl className="fg-kv" style={{ padding: 0, marginTop: 8 }}>
        <dt>Mode</dt>
        <dd>{project.mode}</dd>
        <dt>Entrée</dt>
        <dd className="fg-mono">{project.entry}</dd>
        <dt>Identifiant</dt>
        <dd className="fg-mono">{project.id}</dd>
        <dt>Créé le</dt>
        <dd>{new Date(project.createdAt).toLocaleString('fr-FR')}</dd>
      </dl>
      <p style={{ fontSize: 12, color: 'var(--fg-text-3)' }}>Sélectionnez un asset pour voir ses propriétés.</p>
    </Flex>
  );
}
