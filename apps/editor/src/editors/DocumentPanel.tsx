import { useApp } from '../state/app';
import { DatabaseEditor } from './DatabaseEditor';
import { JsonEditor } from './JsonEditor';
import { MapEditor } from './MapEditor';
import { SceneEditor } from './SceneEditor';
import { ScriptEditor } from './ScriptEditor';

/** Onglet de document : choisit l'éditeur adapté au type de fichier. */
export function DocumentPanel({ docId }: { docId: string }) {
  const doc = useApp((s) => s.documents.find((d) => d.id === docId));
  if (!doc) return <div className="fg-empty">Document fermé.</div>;
  switch (doc.kind) {
    case 'script':
      return <ScriptEditor path={doc.path} />;
    case 'map':
      return <MapEditor initialPath={doc.path} />;
    case 'database':
      return <DatabaseEditor path={doc.path} />;
    case 'scene':
      return <SceneEditor path={doc.path} />;
    default:
      return <JsonEditor path={doc.path} />;
  }
}
