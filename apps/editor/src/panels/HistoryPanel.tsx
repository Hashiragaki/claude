import { ActionButton, AlertDialog, Button, DialogContainer } from '@adobe/react-spectrum';
import Gears from '@spectrum-icons/workflow/Gears';
import Magic from '@spectrum-icons/workflow/Beaker';
import Refresh from '@spectrum-icons/workflow/Refresh';
import Revert from '@spectrum-icons/workflow/Revert';
import SaveFloppy from '@spectrum-icons/workflow/SaveFloppy';
import User from '@spectrum-icons/workflow/User';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type HistoryEntry, type HistoryFile, type HistorySource } from '../api';
import { requireProjectId, toastError, toastOk, useApp } from '../state/app';

const SOURCES: Record<HistorySource, { label: string; icon: ReactNode; color: string }> = {
  user: { label: 'Vous', icon: <User size="S" />, color: '#4b8bf5' },
  ai: { label: 'Assistant IA', icon: <Magic size="S" />, color: '#a35ee0' },
  autopilot: { label: 'Pilote automatique', icon: <Gears size="S" />, color: '#e08a2e' },
  restore: { label: 'Avant restauration', icon: <Revert size="S" />, color: '#8a8f98' },
  manual: { label: 'Point de sauvegarde', icon: <SaveFloppy size="S" />, color: '#2fa36b' },
};

const CHANGE_LABELS = {
  modified: 'modifié depuis',
  removed: 'supprimé depuis',
  added: 'créé depuis',
} as const;

/** Heure relative en français (« il y a 5 min »). */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return "à l'instant";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}

export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };

/**
 * Diff ligne à ligne simple (plus longue sous-séquence commune). Les textes très volumineux sont
 * réduits à leurs lignes différentes entre préfixe et suffixe communs.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head = a.slice(0, start).map((text): DiffLine => ({ kind: 'same', text }));
  const tail = a.slice(endA).map((text): DiffLine => ({ kind: 'same', text }));
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  let middle: DiffLine[];
  if (x.length * y.length > 4_000_000) {
    middle = [
      ...x.map((text): DiffLine => ({ kind: 'del', text })),
      ...y.map((text): DiffLine => ({ kind: 'add', text })),
    ];
  } else {
    const table: number[][] = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
    for (let i = x.length - 1; i >= 0; i--) {
      for (let j = y.length - 1; j >= 0; j--) {
        table[i]![j] = x[i] === y[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
      }
    }
    middle = [];
    let i = 0;
    let j = 0;
    while (i < x.length && j < y.length) {
      if (x[i] === y[j]) {
        middle.push({ kind: 'same', text: x[i]! });
        i++;
        j++;
      } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
        middle.push({ kind: 'del', text: x[i++]! });
      } else {
        middle.push({ kind: 'add', text: y[j++]! });
      }
    }
    while (i < x.length) middle.push({ kind: 'del', text: x[i++]! });
    while (j < y.length) middle.push({ kind: 'add', text: y[j++]! });
  }
  return [...head, ...middle, ...tail];
}

/**
 * Panneau « Historique » : points de restauration du projet (modifications de l'éditeur, de l'IA et du
 * pilote automatique), comparaison fichier par fichier et restauration.
 */
export function HistoryPanel() {
  const project = useApp((s) => s.project);
  const revision = useApp((s) => s.fileRevision);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [file, setFile] = useState<HistoryFile | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!project) return;
    api.history(project.id).then(setEntries, toastError);
  }, [project]);

  useEffect(refresh, [refresh, revision]);

  const selected = entries.find((e) => e.id === selectedId) ?? null;

  useEffect(() => {
    setFile(null);
    if (!project || !selected || !filePath) return;
    let cancelled = false;
    api.historyFile(project.id, selected.id, filePath).then((f) => {
      if (!cancelled) setFile(f);
    }, toastError);
    return () => {
      cancelled = true;
    };
  }, [project, selected?.id, filePath]);

  const diff = useMemo(() => (file ? diffLines(file.snapshot ?? '', file.current ?? '') : []), [file]);

  if (!project) return null;

  const createSnapshot = async () => {
    setBusy(true);
    try {
      await api.createSnapshot(requireProjectId(), 'Point de sauvegarde manuel');
      toastOk('Point de sauvegarde créé.');
      refresh();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await api.restoreSnapshot(requireProjectId(), selected.id);
      toastOk(`État restauré (${result.restored.length + result.deleted.length} fichier(s) modifié(s)).`);
      setFilePath(null);
      refresh();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fg-panel">
      <div className="fg-toolbar">
        <Button variant="secondary" onPress={() => void createSnapshot()} isDisabled={busy}>
          <SaveFloppy />
          Créer un point de sauvegarde
        </Button>
        <div className="fg-spacer" />
        <ActionButton isQuiet aria-label="Rafraîchir" onPress={refresh}>
          <Refresh />
        </ActionButton>
      </div>
      <div className="fg-scroll" style={{ display: 'flex', minHeight: 0 }}>
        <div
          style={{ width: '42%', minWidth: 220, overflowY: 'auto', borderRight: '1px solid var(--fg-border, #3a3a3a)' }}
        >
          {entries.length === 0 && (
            <div className="fg-empty">
              Aucun point de restauration. Il en est créé un avant chaque lot de modifications.
            </div>
          )}
          {entries.map((entry) => {
            const source = SOURCES[entry.source];
            return (
              <div
                key={entry.id}
                role="option"
                aria-selected={entry.id === selectedId}
                tabIndex={0}
                onClick={() => {
                  setSelectedId(entry.id);
                  setFilePath(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setSelectedId(entry.id);
                }}
                style={{
                  padding: '8px 10px',
                  cursor: 'pointer',
                  background: entry.id === selectedId ? 'rgba(75,139,245,0.18)' : undefined,
                  borderBottom: '1px solid rgba(128,128,128,0.2)',
                }}
              >
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      gap: 4,
                      alignItems: 'center',
                      padding: '1px 6px',
                      borderRadius: 8,
                      background: source.color,
                      color: '#fff',
                    }}
                  >
                    {source.icon}
                    {source.label}
                  </span>
                  <span style={{ color: 'var(--fg-text-2)' }} title={new Date(entry.at).toLocaleString('fr-FR')}>
                    {relativeTime(entry.at)}
                  </span>
                </div>
                <div style={{ fontSize: 13, marginTop: 4 }}>{entry.label}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-text-2)' }}>
                  {entry.fileCount === 0
                    ? 'identique à l’état actuel'
                    : `${entry.fileCount} fichier${entry.fileCount > 1 ? 's' : ''} diffèrent`}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: 10 }}>
          {!selected && <div className="fg-empty">Sélectionnez un point de restauration.</div>}
          {selected && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ fontSize: 13, flex: 1 }}>{selected.label}</strong>
                <Button
                  variant="negative"
                  onPress={() => setConfirm(true)}
                  isDisabled={busy || selected.fileCount === 0}
                >
                  <Revert />
                  Restaurer cet état
                </Button>
              </div>
              {selected.files.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--fg-text-2)' }}>Aucune différence avec l'état actuel.</div>
              )}
              {selected.files.map((f) => (
                <div
                  key={f.path}
                  role="button"
                  tabIndex={0}
                  onClick={() => setFilePath(f.path)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setFilePath(f.path);
                  }}
                  className="fg-mono"
                  style={{
                    cursor: 'pointer',
                    padding: '2px 4px',
                    fontSize: 12,
                    background: f.path === filePath ? 'rgba(75,139,245,0.18)' : undefined,
                  }}
                >
                  {f.path} <span style={{ color: 'var(--fg-text-2)' }}>({CHANGE_LABELS[f.change]})</span>
                </div>
              ))}
              {filePath && (
                <pre
                  className="fg-mono"
                  style={{ marginTop: 10, fontSize: 12, overflow: 'auto', maxHeight: 360, lineHeight: 1.4 }}
                >
                  {!file && 'Chargement…'}
                  {file &&
                    diff.map((line, i) => (
                      <div
                        key={i}
                        style={{
                          whiteSpace: 'pre-wrap',
                          background:
                            line.kind === 'add'
                              ? 'rgba(47,163,107,0.25)'
                              : line.kind === 'del'
                                ? 'rgba(220,70,70,0.25)'
                                : undefined,
                        }}
                      >
                        {line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  '}
                        {line.text}
                      </div>
                    ))}
                </pre>
              )}
              {filePath && file && (
                <div style={{ fontSize: 11, color: 'var(--fg-text-2)', marginTop: 4 }}>
                  Rouge : dans le point de restauration seulement. Vert : dans l'état actuel seulement.
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <DialogContainer onDismiss={() => setConfirm(false)}>
        {confirm && selected && (
          <AlertDialog
            title="Restaurer cet état ?"
            variant="destructive"
            primaryActionLabel="Restaurer"
            cancelLabel="Annuler"
            onPrimaryAction={() => void restore()}
          >
            Les fichiers texte du projet reviendront à leur état de « {selected.label} ». Un point « Avant restauration
            » est créé d'abord : vous pourrez annuler.
          </AlertDialog>
        )}
      </DialogContainer>
    </div>
  );
}
