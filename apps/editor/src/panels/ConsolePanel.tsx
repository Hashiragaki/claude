import { ActionButton, Item, Picker } from '@adobe/react-spectrum';
import CheckmarkCircle from '@spectrum-icons/workflow/CheckmarkCircle';
import Delete from '@spectrum-icons/workflow/Delete';
import { useEffect, useRef, useState } from 'react';
import { store, toastError, useApp, validateProject } from '../state/app';

/** Journal de l'éditeur, du jeu et des générations, avec les diagnostics du projet. */
export function ConsolePanel() {
  const logs = useApp((s) => s.logs);
  const diagnostics = useApp((s) => s.diagnostics);
  const [filter, setFilter] = useState<'all' | 'warn' | 'error'>('all');
  const endRef = useRef<HTMLDivElement>(null);
  const visible = logs.filter((l) =>
    filter === 'all' ? l.level !== 'debug' : filter === 'warn' ? l.level === 'warn' || l.level === 'error' : l.level === 'error',
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [visible.length]);

  return (
    <div className="fg-panel">
      <div className="fg-toolbar">
        <Picker
          aria-label="Filtre"
          isQuiet
          width="size-2000"
          selectedKey={filter}
          onSelectionChange={(k) => setFilter(k as typeof filter)}
        >
          <Item key="all">Tous les messages</Item>
          <Item key="warn">Avertissements</Item>
          <Item key="error">Erreurs</Item>
        </Picker>
        <ActionButton isQuiet onPress={() => void validateProject().catch(toastError)}>
          <CheckmarkCircle />
          Vérifier le projet
        </ActionButton>
        <div className="fg-spacer" />
        <ActionButton isQuiet aria-label="Effacer" onPress={() => store.set({ logs: [] })}>
          <Delete />
        </ActionButton>
      </div>
      <div className="fg-scroll">
        {diagnostics.length > 0 && (
          <div style={{ borderBottom: '1px solid var(--fg-border)', padding: '4px 0' }}>
            {diagnostics.map((d, i) => (
              <div key={i} className={`fg-log ${d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warn' : ''}`}>
                <time>{d.severity === 'error' ? 'ERREUR' : d.severity === 'warning' ? 'ATTENTION' : 'INFO'}</time>
                {d.file}
                {d.line ? `:${d.line}` : ''} — {d.message}
              </div>
            ))}
          </div>
        )}
        {visible.map((l) => (
          <div key={l.id} className={`fg-log ${l.level}`}>
            <time>{new Date(l.at).toLocaleTimeString('fr-FR')}</time>[{l.source}] {l.message}
          </div>
        ))}
        {visible.length === 0 && diagnostics.length === 0 && <div className="fg-empty">Aucun message.</div>}
        <div ref={endRef} />
      </div>
    </div>
  );
}
