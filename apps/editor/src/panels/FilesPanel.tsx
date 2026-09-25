import { ActionButton, SearchField } from '@adobe/react-spectrum';
import Refresh from '@spectrum-icons/workflow/Refresh';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { openDocument, selectAsset, showPanel, toastError, useApp } from '../state/app';

/** Arborescence des fichiers du projet ; ouvre les scripts, cartes et données dans l'éditeur adapté. */
export function FilesPanel() {
  const project = useApp((s) => s.project);
  const revision = useApp((s) => s.fileRevision);
  const [files, setFiles] = useState<{ path: string; size: number }[]>([]);
  const [query, setQuery] = useState('');

  const refresh = useCallback(() => {
    if (!project) return;
    api.tree(project.id).then(setFiles, toastError);
  }, [project]);

  useEffect(refresh, [refresh, revision, project?.assets.length]);

  if (!project) return null;

  const open = (path: string) => {
    const name = path.split('/').pop() ?? path;
    const asset = project.assets.find((a) => a.file === path || a.source === path);
    if (asset) {
      selectAsset(asset.id);
      showPanel('properties');
      return;
    }
    if (path.endsWith('.vn')) openDocument({ kind: 'script', path, title: name });
    else if (project.mode === 'rpg' && path.startsWith('maps/') && path.endsWith('.json'))
      openDocument({ kind: 'map', path, title: `Carte ${name.replace('.json', '')}` });
    else if (project.mode === 'rpg' && path === 'data/database.json')
      openDocument({ kind: 'database', path, title: 'Base de données' });
    else if (project.mode === 'sandbox3d' && path === project.entry) openDocument({ kind: 'scene', path, title: 'Scène 3D' });
    else if (/\.(json|txt|md|vn)$/.test(path)) openDocument({ kind: 'json', path, title: name });
    else window.open(api.fileUrl(project.id, path), '_blank');
  };

  const q = query.toLowerCase();
  const visible = files.filter((f) => !q || f.path.toLowerCase().includes(q));
  const groups = new Map<string, typeof files>();
  for (const f of visible) {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.';
    groups.set(dir, [...(groups.get(dir) ?? []), f]);
  }

  return (
    <div className="fg-panel">
      <div className="fg-toolbar">
        <SearchField aria-label="Rechercher un fichier" isQuiet value={query} onChange={setQuery} width="100%" />
        <ActionButton isQuiet aria-label="Rafraîchir" onPress={refresh}>
          <Refresh />
        </ActionButton>
      </div>
      <div className="fg-scroll" style={{ padding: '4px 0 12px' }}>
        {[...groups].map(([dir, list]) => (
          <details key={dir} open={!dir.startsWith('assets') || Boolean(q)}>
            <summary className="fg-mono" style={{ padding: '3px 10px', cursor: 'pointer', color: 'var(--fg-text-2)' }}>
              📁 {dir === '.' ? '(racine)' : dir}
            </summary>
            {list.map((f) => (
              <div
                key={f.path}
                className="fg-cmd"
                style={{ paddingLeft: 28 }}
                role="button"
                tabIndex={0}
                onDoubleClick={() => open(f.path)}
                onKeyDown={(e) => e.key === 'Enter' && open(f.path)}
                title="Double-cliquer pour ouvrir"
              >
                {f.path.split('/').pop()} <span style={{ color: 'var(--fg-text-3)' }}>({formatSize(f.size)})</span>
              </div>
            ))}
          </details>
        ))}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}
