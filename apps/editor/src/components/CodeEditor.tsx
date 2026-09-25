import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
  type StreamParser,
} from '@codemirror/language';
import { linter, lintGutter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';

/** Coloration syntaxique sombre, proche des éditeurs de code des suites créatives. */
const forgeHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#c586c0', fontWeight: '600' },
  { tag: tags.controlKeyword, color: '#c586c0', fontWeight: '600' },
  { tag: tags.string, color: '#ce9178' },
  { tag: tags.comment, color: '#6a9955', fontStyle: 'italic' },
  { tag: tags.number, color: '#b5cea8' },
  { tag: tags.bool, color: '#569cd6' },
  { tag: tags.null, color: '#569cd6' },
  { tag: tags.labelName, color: '#4fc1ff', fontWeight: '600' },
  { tag: tags.variableName, color: '#9cdcfe' },
  { tag: tags.propertyName, color: '#9cdcfe' },
  { tag: tags.operator, color: '#d4d4d4' },
  { tag: tags.meta, color: '#dcdcaa' },
  { tag: tags.typeName, color: '#4ec9b0' },
  { tag: tags.atom, color: '#dcdcaa' },
]);

const darkTheme = EditorView.theme(
  {
    '&': { backgroundColor: '#1e1e1e', color: '#d4d4d4' },
    '.cm-content': { fontFamily: 'var(--fg-mono)', caretColor: '#fff' },
    '.cm-gutters': { backgroundColor: '#1b1b1b', color: '#6e6e6e', border: 'none' },
    '.cm-activeLine': { backgroundColor: '#2a2d2e80' },
    '.cm-activeLineGutter': { backgroundColor: '#2a2d2e', color: '#c6c6c6' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#264f78 !important' },
    '.cm-tooltip': { backgroundColor: '#252526', border: '1px solid #454545', color: '#ccc' },
    '.cm-diagnostic-error': { borderLeft: '3px solid #e34850' },
    '.cm-diagnostic-warning': { borderLeft: '3px solid #e68619' },
  },
  { dark: true },
);

export type CodeLanguage = 'json' | 'text' | StreamParser<unknown>;

export interface CodeDiagnostic {
  line: number;
  column?: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface CodeEditorProps {
  value: string;
  language: CodeLanguage;
  onChange(value: string): void;
  onSave?(): void;
  lint?(source: string): CodeDiagnostic[];
  /** Reçoit la vue CodeMirror (pour positionner le curseur, lire la ligne…). */
  onView?(view: EditorView | null): void;
  readOnly?: boolean;
}

/** Éditeur de code CodeMirror 6 (numéros de ligne, historique, repli, diagnostics en direct). */
export function CodeEditor(props: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const language: Extension[] =
      props.language === 'json' ? [json()] : props.language === 'text' ? [] : [StreamLanguage.define(props.language)];
    const lintExtension: Extension[] = props.lint
      ? [
          lintGutter(),
          linter(
            (view) => {
              const doc = view.state.doc;
              return (propsRef.current.lint?.(doc.toString()) ?? []).map((d): CmDiagnostic => {
                const line = doc.line(Math.min(Math.max(1, d.line), doc.lines));
                const from = Math.min(line.from + Math.max(0, (d.column ?? 1) - 1), line.to);
                return { from, to: Math.max(from, line.to), severity: d.severity, message: d.message };
              });
            },
            { delay: 350 },
          ),
        ]
      : [];
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          syntaxHighlighting(forgeHighlight),
          darkTheme,
          EditorState.tabSize.of(4),
          EditorView.lineWrapping,
          EditorState.readOnly.of(Boolean(props.readOnly)),
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                propsRef.current.onSave?.();
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          ...language,
          ...lintExtension,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) propsRef.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    props.onView?.(view);
    return () => {
      props.onView?.(null);
      view.destroy();
      viewRef.current = null;
    };
    // L'éditeur est créé une fois ; la valeur externe est synchronisée ci-dessous.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== props.value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.value } });
    }
  }, [props.value]);

  return <div className="fg-code" ref={hostRef} />;
}
