import {
  ActionButton,
  DialogContainer,
  FileTrigger,
  Item,
  Picker,
  ProgressCircle,
  SearchField,
  Text,
  Tooltip,
  TooltipTrigger,
} from '@adobe/react-spectrum';
import type { AssetMeta } from '@forge/core';
import Close from '@spectrum-icons/workflow/Close';
import Import from '@spectrum-icons/workflow/Import';
import MagicWand from '@spectrum-icons/workflow/MagicWand';
import { useState } from 'react';
import { api } from '../api';
import { AssetThumb, KIND_LABELS } from '../components/AssetThumb';
import { requireProjectId, selectAsset, showPanel, toastError, toastOk, useApp } from '../state/app';
import { GenerateDialog } from './GenerateDialog';

const IMPORT_KINDS: Record<string, AssetMeta['kind']> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  svg: 'image',
  wav: 'sfx',
  mp3: 'music',
  ogg: 'music',
  glb: 'model',
  gltf: 'model',
};

async function importFiles(files: FileList | null): Promise<void> {
  if (!files) return;
  const id = requireProjectId();
  for (const file of Array.from(files)) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const kind = IMPORT_KINDS[ext];
    if (!kind) {
      toastError(new Error(`Format non pris en charge : ${file.name}`));
      continue;
    }
    const buffer = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
    await api.importAsset(id, {
      name: file.name.replace(/\.[^.]+$/, ''),
      kind,
      filename: file.name,
      dataBase64: btoa(binary),
    });
    toastOk(`${file.name} importé.`);
  }
}

/** Galerie des assets du projet, générations en cours et import. */
export function AssetsPanel() {
  const project = useApp((s) => s.project);
  const jobs = useApp((s) => s.jobs);
  const selected = useApp((s) => s.selectedAssetId);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<string>('all');
  const [generating, setGenerating] = useState(false);
  const [onlyLatest, setOnlyLatest] = useState(true);
  if (!project) return null;

  const superseded = new Set(project.assets.map((a) => a.parentId).filter(Boolean));
  const q = query.toLowerCase();
  const assets = project.assets
    .filter((a) => kind === 'all' || a.kind === kind)
    .filter((a) => !onlyLatest || !superseded.has(a.id))
    .filter((a) => !q || `${a.name} ${a.alias ?? ''} ${a.tags.join(' ')} ${a.prompt ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running');

  return (
    <div className="fg-panel">
      <div className="fg-toolbar">
        <ActionButton onPress={() => setGenerating(true)}>
          <MagicWand />
          <Text>Générer</Text>
        </ActionButton>
        <FileTrigger
          allowsMultiple
          acceptedFileTypes={['.png', '.jpg', '.jpeg', '.webp', '.svg', '.wav', '.mp3', '.ogg', '.glb']}
          onSelect={(files) => void importFiles(files).catch(toastError)}
        >
          <ActionButton>
            <Import />
            <Text>Importer</Text>
          </ActionButton>
        </FileTrigger>
        <SearchField aria-label="Rechercher" isQuiet value={query} onChange={setQuery} width="size-2400" />
        <Picker aria-label="Type" isQuiet selectedKey={kind} onSelectionChange={(k) => setKind(String(k))} width="size-2000">
          {[
            <Item key="all">Tous les types</Item>,
            ...Object.entries(KIND_LABELS).map(([k, label]) => <Item key={k}>{label}</Item>),
          ]}
        </Picker>
        <Picker
          aria-label="Versions"
          isQuiet
          selectedKey={onlyLatest ? 'latest' : 'all'}
          onSelectionChange={(k) => setOnlyLatest(k === 'latest')}
          width="size-2400"
        >
          <Item key="latest">Dernières versions</Item>
          <Item key="all">Toutes les versions</Item>
        </Picker>
        <div className="fg-spacer" />
        <span style={{ fontSize: 12, color: 'var(--fg-text-3)' }}>{assets.length} assets</span>
      </div>
      <div className="fg-scroll">
        {active.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px 0' }}>
            {active.map((job) => (
              <div key={job.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--fg-text-2)' }}>
                <ProgressCircle aria-label="En cours" isIndeterminate size="S" />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <strong>{job.label}</strong> — {job.progress}
                </span>
                <TooltipTrigger>
                  <ActionButton isQuiet aria-label="Annuler" onPress={() => void api.cancelJob(job.id).catch(toastError)}>
                    <Close size="S" />
                  </ActionButton>
                  <Tooltip>Annuler</Tooltip>
                </TooltipTrigger>
              </div>
            ))}
          </div>
        )}
        {assets.length === 0 && active.length === 0 ? (
          <div className="fg-empty">
            Aucun asset. Cliquez sur « Générer » pour créer images, personnages, tilesets, sons, musiques ou modèles 3D.
          </div>
        ) : (
          <div className="fg-asset-grid" role="listbox" aria-label="Assets">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="fg-asset-card"
                role="option"
                aria-selected={asset.id === selected}
                tabIndex={0}
                onClick={() => selectAsset(asset.id)}
                onDoubleClick={() => {
                  selectAsset(asset.id);
                  showPanel('properties');
                }}
                onKeyDown={(e) => e.key === 'Enter' && selectAsset(asset.id)}
                title={asset.prompt ?? asset.name}
              >
                <AssetThumb asset={asset} />
                <div className="fg-asset-label">
                  {asset.name}
                  <small>
                    {asset.alias ? `« ${asset.alias} »` : KIND_LABELS[asset.kind]}
                    {asset.version > 1 ? ` · v${asset.version}` : ''}
                    {asset.origin === 'ai' ? ' · IA' : ''}
                  </small>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <DialogContainer onDismiss={() => setGenerating(false)}>
        {generating && <GenerateDialog onClose={() => setGenerating(false)} />}
      </DialogContainer>
    </div>
  );
}
