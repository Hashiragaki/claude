import { ActionButton, Text } from '@adobe/react-spectrum';
import SaveFloppy from '@spectrum-icons/workflow/SaveFloppy';
import { CodeEditor, type CodeDiagnostic } from '../components/CodeEditor';
import { useProjectFile } from './useProjectFile';

function jsonLint(source: string): CodeDiagnostic[] {
  try {
    JSON.parse(source);
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const pos = /position (\d+)/.exec(message);
    const line = pos ? source.slice(0, Number(pos[1])).split('\n').length : 1;
    return [{ line, severity: 'error', message: `JSON invalide : ${message}` }];
  }
}

/** Éditeur texte/JSON générique pour les fichiers du projet. */
export function JsonEditor({ path }: { path: string }) {
  const file = useProjectFile(path);
  const isJson = path.endsWith('.json');
  if (file.error) return <div className="fg-empty">{file.error}</div>;
  if (file.content === null) return <div className="fg-empty">Chargement…</div>;
  return (
    <div className="fg-panel">
      <div className="fg-toolbar">
        <span className="fg-mono" style={{ color: 'var(--fg-text-2)' }}>
          {path}
          {file.dirty ? ' •' : ''}
        </span>
        <div className="fg-spacer" />
        <ActionButton
          onPress={() => {
            if (isJson && jsonLint(file.content ?? '').length) return;
            void file.save();
          }}
          isDisabled={!file.dirty}
        >
          <SaveFloppy />
          <Text>Enregistrer (Ctrl+S)</Text>
        </ActionButton>
      </div>
      <CodeEditor
        value={file.content}
        language={isJson ? 'json' : 'text'}
        onChange={file.setContent}
        onSave={() => {
          if (isJson && jsonLint(file.content ?? '').length) return;
          void file.save();
        }}
        lint={isJson ? jsonLint : undefined}
      />
    </div>
  );
}
