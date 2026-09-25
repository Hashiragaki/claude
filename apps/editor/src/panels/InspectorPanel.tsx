import { ActionButton, TextField } from '@adobe/react-spectrum';
import Refresh from '@spectrum-icons/workflow/Refresh';
import { useEffect, useState } from 'react';
import { usePlaySession } from '../state/playSession';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Inspecteur de variables du jeu en cours : lecture en direct, édition des valeurs simples. */
export function InspectorPanel() {
  const engine = usePlaySession((s) => s.engine);
  const revision = usePlaySession((s) => s.revision);
  const [state, setState] = useState<Record<string, unknown>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!engine) {
      setState({});
      return;
    }
    setState(engine.debugState());
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [engine, revision]);

  useEffect(() => {
    if (engine) setState(engine.debugState());
  }, [tick, engine]);

  if (!engine) {
    return (
      <div className="fg-panel">
        <div className="fg-empty">Lancez le jeu pour inspecter et modifier ses variables en direct.</div>
      </div>
    );
  }

  return (
    <div className="fg-panel">
      <div className="fg-toolbar">
        <span style={{ fontSize: 12, color: 'var(--fg-text-2)' }}>État du jeu (mis à jour en direct)</span>
        <div className="fg-spacer" />
        <ActionButton isQuiet aria-label="Rafraîchir" onPress={() => setState(engine.debugState())}>
          <Refresh />
        </ActionButton>
      </div>
      <div className="fg-scroll" style={{ padding: '6px 10px' }}>
        <Tree value={state as Json} path="" onEdit={(path, value) => engine.setDebugValue(path, value)} />
      </div>
    </div>
  );
}

function Tree(props: { value: Json; path: string; onEdit(path: string, value: unknown): void }) {
  const { value, path } = props;
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
    if (entries.length === 0)
      return (
        <span className="fg-mono" style={{ color: 'var(--fg-text-3)' }}>
          {Array.isArray(value) ? '[]' : '{}'}
        </span>
      );
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {entries.map(([key, child]) => {
          const childPath = path ? `${path}.${key}` : key;
          const isObject = child !== null && typeof child === 'object';
          return isObject ? (
            <details key={key} open={!path || Object.keys(child as object).length < 12}>
              <summary className="fg-mono" style={{ cursor: 'pointer', color: 'var(--fg-text-2)' }}>
                {key}
              </summary>
              <div style={{ paddingLeft: 14 }}>
                <Tree value={child} path={childPath} onEdit={props.onEdit} />
              </div>
            </details>
          ) : (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="fg-mono" style={{ color: 'var(--fg-text-3)', minWidth: 90 }}>
                {key}
              </span>
              <Leaf value={child} onCommit={(v) => props.onEdit(childPath, v)} />
            </div>
          );
        })}
      </div>
    );
  }
  return <Leaf value={value} onCommit={(v) => props.onEdit(path, v)} />;
}

function Leaf(props: { value: Json; onCommit(value: unknown): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = JSON.stringify(props.value);
  const commit = () => {
    if (draft === null) return;
    let parsed: unknown = draft;
    try {
      parsed = JSON.parse(draft);
    } catch {
      // chaîne brute
    }
    props.onCommit(parsed);
    setDraft(null);
  };
  return (
    <TextField
      aria-label="valeur"
      isQuiet
      width="100%"
      value={draft ?? display}
      onChange={setDraft}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        else e.continuePropagation();
      }}
      UNSAFE_className="fg-mono"
    />
  );
}
