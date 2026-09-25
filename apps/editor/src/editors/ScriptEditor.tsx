import { ActionButton, Item, Menu, MenuTrigger, Text, Tooltip, TooltipTrigger } from '@adobe/react-spectrum';
import type { StreamParser } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { VN_KEYWORDS, VN_POSITIONS, VN_TRANSITIONS, compileSource, listCharacters, listLabels } from '@forge/mode-vn';
import Add from '@spectrum-icons/workflow/Add';
import Play from '@spectrum-icons/workflow/Play';
import SaveFloppy from '@spectrum-icons/workflow/SaveFloppy';
import { useMemo, useRef, useState } from 'react';
import { CodeEditor, type CodeDiagnostic } from '../components/CodeEditor';
import { play, useApp } from '../state/app';
import { useProjectFile } from './useProjectFile';

const KEYWORDS = new Set<string>(VN_KEYWORDS);
const ATOMS = new Set<string>([...VN_TRANSITIONS, ...VN_POSITIONS, 'True', 'False', 'None']);

/** Coloration syntaxique du langage de script VN (inspiré de Ren'Py). */
const vnLanguage: StreamParser<{ afterLabel: boolean }> = {
  name: 'forge-vn',
  startState: () => ({ afterLabel: false }),
  token(stream, state) {
    if (stream.sol()) state.afterLabel = false;
    if (stream.eatSpace()) return null;
    if (stream.peek() === '#') {
      stream.skipToEnd();
      return 'comment';
    }
    const quote = stream.peek();
    if (quote === '"' || quote === "'") {
      stream.next();
      let escaped = false;
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === quote && !escaped) break;
        escaped = !escaped && ch === '\\';
      }
      return 'string';
    }
    if (stream.match(/^\$/)) return 'meta';
    if (stream.match(/^-?\d+(\.\d+)?/)) return 'number';
    if (stream.match(/^[\p{L}_][\p{L}\p{N}_.]*/u)) {
      const word = stream.current();
      if (state.afterLabel) {
        state.afterLabel = false;
        return 'labelName';
      }
      if (word === 'label' || word === 'jump' || word === 'call') {
        state.afterLabel = true;
        return 'keyword';
      }
      if (KEYWORDS.has(word)) return 'keyword';
      if (ATOMS.has(word)) return 'atom';
      return 'variableName';
    }
    stream.next();
    return 'operator';
  },
};

const SNIPPETS: Record<string, { label: string; text: string }> = {
  character: { label: 'Personnage', text: 'define e = Character("Nom", color="#c8ffc8")\n' },
  say: { label: 'Dialogue', text: 'e "Bonjour !"\n' },
  scene: { label: 'Changer de décor', text: 'scene bg alias with fade\n' },
  show: { label: 'Afficher un personnage', text: 'show alias happy at left with dissolve\n' },
  menu: {
    label: 'Menu de choix',
    text: 'menu:\n    "Premier choix":\n        jump suite\n    "Second choix" if score > 0:\n        pass\n',
  },
  if: { label: 'Condition', text: 'if score >= 2:\n    e "Bravo !"\nelse:\n    e "Dommage."\n' },
  var: { label: 'Variable', text: '$ score += 1\n' },
  music: { label: 'Musique', text: 'play music "alias" fadein 1.0\n' },
  label: { label: 'Nouveau label', text: 'label nouvelle_scene:\n    "…"\n    return\n' },
};

/** Éditeur de script VN avec diagnostics en direct, navigation par labels et lecture depuis un label. */
export function ScriptEditor({ path }: { path: string }) {
  const file = useProjectFile(path, { autosaveMs: 1500 });
  const project = useApp((s) => s.project);
  const viewRef = useRef<EditorView | null>(null);
  const [cursorLine, setCursorLine] = useState(1);
  const source = file.content ?? '';
  const labels = useMemo(() => listLabels(source), [source]);
  const characters = useMemo(() => listCharacters(source), [source]);

  const lint = (text: string): CodeDiagnostic[] =>
    compileSource(text, path)
      .diagnostics.filter((d) => !d.file || d.file === path)
      .map((d) => ({ line: d.line ?? 1, column: d.column, severity: d.severity, message: d.message }));

  const insert = (text: string) => {
    const view = viewRef.current;
    if (!view) return;
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const indent = /^\s*/.exec(line.text)?.[0] ?? '';
    const block = text
      .split('\n')
      .map((l, i) => (i === 0 || !l ? l : indent + l))
      .join('\n');
    const at = line.text.trim() ? line.to : line.from;
    const prefix = line.text.trim() ? `\n${indent}` : indent;
    view.dispatch({ changes: { from: at, insert: prefix + block.replace(/\n$/, '') }, scrollIntoView: true });
    view.focus();
  };

  const goToLine = (n: number) => {
    const view = viewRef.current;
    if (!view) return;
    const line = view.state.doc.line(Math.min(n, view.state.doc.lines));
    view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
    view.focus();
  };

  const currentLabel = [...labels].reverse().find((l) => l.line <= cursorLine);
  const playFrom = (label?: string) => {
    void file.save().then(() => play(label ? { startLabel: label, skipTitle: true } : {}));
  };

  const imageAssets = (project?.assets ?? []).filter((a) => a.kind === 'image' && a.alias);
  const audioAssets = (project?.assets ?? []).filter((a) => (a.kind === 'music' || a.kind === 'sfx') && a.alias);

  if (file.error) return <div className="fg-empty">{file.error}</div>;
  if (file.content === null) return <div className="fg-empty">Chargement…</div>;

  return (
    <div className="fg-panel">
      <div className="fg-toolbar">
        <span className="fg-mono" style={{ color: 'var(--fg-text-2)' }}>
          {path}
          {file.dirty ? ' •' : ''}
        </span>
        <TooltipTrigger>
          <ActionButton isQuiet onPress={() => void file.save()} isDisabled={!file.dirty} aria-label="Enregistrer">
            <SaveFloppy />
          </ActionButton>
          <Tooltip>Enregistrer (Ctrl+S) — enregistrement automatique après 1,5 s</Tooltip>
        </TooltipTrigger>
        <MenuTrigger>
          <ActionButton isQuiet>
            <Add />
            <Text>Insérer</Text>
          </ActionButton>
          <Menu onAction={(key) => insert(SNIPPETS[String(key)]?.text ?? '')}>
            {Object.entries(SNIPPETS).map(([key, s]) => (
              <Item key={key}>{s.label}</Item>
            ))}
          </Menu>
        </MenuTrigger>
        <div className="fg-spacer" />
        <ActionButton onPress={() => playFrom()}>
          <Play />
          <Text>Jouer</Text>
        </ActionButton>
        <ActionButton onPress={() => playFrom(currentLabel?.name)} isDisabled={!currentLabel}>
          <Play />
          <Text>Depuis « {currentLabel?.name ?? '…'} »</Text>
        </ActionButton>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <CodeEditor
            value={file.content}
            language={vnLanguage as StreamParser<unknown>}
            onChange={file.setContent}
            onSave={() => void file.save()}
            lint={lint}
            onView={(view) => {
              viewRef.current = view;
              if (view) {
                view.dom.addEventListener('keyup', () =>
                  setCursorLine(view.state.doc.lineAt(view.state.selection.main.head).number),
                );
                view.dom.addEventListener('mouseup', () =>
                  setCursorLine(view.state.doc.lineAt(view.state.selection.main.head).number),
                );
              }
            }}
          />
        </div>
        <aside
          style={{ width: 220, borderLeft: '1px solid var(--fg-bg-0)', overflow: 'auto', background: 'var(--fg-bg-1)' }}
        >
          <div className="fg-section-title">Labels</div>
          {labels.map((l) => (
            <div
              key={`${l.name}:${l.line}`}
              className="fg-cmd"
              style={{ display: 'flex', alignItems: 'center' }}
              role="button"
              tabIndex={0}
              onClick={() => goToLine(l.line)}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</span>
              <span
                role="button"
                title={`Jouer depuis ${l.name}`}
                style={{ color: 'var(--fg-accent-2)', padding: '0 4px' }}
                onClick={(e) => {
                  e.stopPropagation();
                  playFrom(l.name);
                }}
              >
                ▶
              </span>
            </div>
          ))}
          {characters.length > 0 && <div className="fg-section-title">Personnages</div>}
          {characters.map((c) => (
            <div
              key={c.id}
              className="fg-cmd"
              role="button"
              tabIndex={0}
              onClick={() => insert(`${c.id} "…"`)}
              title="Insérer une réplique"
            >
              {c.id} — {c.name ?? '?'}
            </div>
          ))}
          {imageAssets.length > 0 && <div className="fg-section-title">Images (alias)</div>}
          {imageAssets.map((a) => {
            const isBg = a.tags.includes('bg') || a.alias!.startsWith('bg');
            return (
              <div
                key={a.id}
                className="fg-cmd"
                role="button"
                tabIndex={0}
                title={isBg ? 'Insérer « scene »' : 'Insérer « show »'}
                onClick={() => insert(isBg ? `scene ${a.alias} with fade` : `show ${a.alias} with dissolve`)}
              >
                {isBg ? '🖼' : '🧍'} {a.alias}
              </div>
            );
          })}
          {audioAssets.length > 0 && <div className="fg-section-title">Audio (alias)</div>}
          {audioAssets.map((a) => (
            <div
              key={a.id}
              className="fg-cmd"
              role="button"
              tabIndex={0}
              onClick={() =>
                insert(a.kind === 'music' ? `play music "${a.alias}" fadein 1.0` : `play sound "${a.alias}"`)
              }
            >
              {a.kind === 'music' ? '🎵' : '🔊'} {a.alias}
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
