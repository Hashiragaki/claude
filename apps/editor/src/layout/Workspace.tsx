import {
  DockviewReact,
  themeDark,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from 'dockview-react';
import { useEffect, useRef, type FunctionComponent } from 'react';
import { DocumentPanel } from '../editors/DocumentPanel';
import { AssetsPanel } from '../panels/AssetsPanel';
import { ChatPanel } from '../panels/ChatPanel';
import { ConsolePanel } from '../panels/ConsolePanel';
import { FilesPanel } from '../panels/FilesPanel';
import { GamePanel } from '../panels/GamePanel';
import { InspectorPanel } from '../panels/InspectorPanel';
import { PlannerPanel } from '../panels/PlannerPanel';
import { PropertiesPanel } from '../panels/PropertiesPanel';
import { translate } from '../i18n';
import {
  closeDocument,
  documentRequests,
  panelRequests,
  resetLayoutRequests,
  store,
  type OpenDocument,
} from '../state/app';

/** Thème dockview sombre, accordé aux couleurs de l'éditeur (voir `.fg-dock-theme`). */
const forgeTheme = { ...themeDark, name: 'forge', className: `${themeDark.className} fg-dock-theme` };

const components: Record<string, FunctionComponent<IDockviewPanelProps>> = {
  game: () => <GamePanel />,
  assets: () => <AssetsPanel />,
  properties: () => <PropertiesPanel />,
  chat: () => <ChatPanel />,
  planner: () => <PlannerPanel />,
  console: () => <ConsolePanel />,
  inspector: () => <InspectorPanel />,
  files: () => <FilesPanel />,
  document: (props) => <DocumentPanel docId={(props.params as { docId: string }).docId} />,
};

type PanelId = 'game' | 'assets' | 'properties' | 'chat' | 'planner' | 'console' | 'inspector' | 'files';

const TITLE_KEYS: Record<PanelId, Parameters<typeof translate>[1]> = {
  game: 'panel.game',
  assets: 'panel.assets',
  properties: 'panel.properties',
  chat: 'panel.chat',
  planner: 'panel.planner',
  console: 'panel.console',
  inspector: 'panel.inspector',
  files: 'panel.files',
};

function title(id: PanelId): string {
  return translate(store.get().locale, TITLE_KEYS[id]);
}

/** Position par défaut de chaque panneau (utilisée aussi pour le rouvrir après fermeture). */
function addDefault(api: DockviewApi, id: PanelId): void {
  const has = (panel: string) => Boolean(api.getPanel(panel));
  const base = { id, component: id, title: title(id) };
  switch (id) {
    case 'game':
      api.addPanel(base);
      break;
    case 'planner':
      api.addPanel(has('game') ? { ...base, position: { referencePanel: 'game', direction: 'within' } } : base);
      break;
    case 'chat':
      api.addPanel(
        has('game')
          ? { ...base, position: { referencePanel: 'game', direction: 'right' }, initialWidth: 390 }
          : { ...base, position: { direction: 'right' } },
      );
      break;
    case 'properties':
      api.addPanel(
        has('chat')
          ? { ...base, position: { referencePanel: 'chat', direction: 'below' } }
          : { ...base, position: { direction: 'right' } },
      );
      break;
    case 'assets':
      api.addPanel(
        has('game')
          ? { ...base, position: { referencePanel: 'game', direction: 'below' }, initialHeight: 270 }
          : { ...base, position: { direction: 'below' } },
      );
      break;
    default:
      api.addPanel(
        has('assets')
          ? { ...base, position: { referencePanel: 'assets', direction: 'within' } }
          : { ...base, position: { direction: 'below' } },
      );
  }
}

function buildDefaultLayout(api: DockviewApi): void {
  api.clear();
  for (const id of ['game', 'planner', 'chat', 'properties', 'assets', 'files', 'console', 'inspector'] as PanelId[]) {
    addDefault(api, id);
  }
  api.getPanel('game')?.api.setActive();
  api.getPanel('assets')?.api.setActive();
  api.getPanel('chat')?.api.setActive();
}

function openDocumentPanel(api: DockviewApi, doc: OpenDocument): void {
  const existing = api.getPanel(doc.id);
  if (existing) {
    existing.api.setActive();
    return;
  }
  const anchor = api.getPanel('game') ?? api.getPanel('planner');
  api.addPanel({
    id: doc.id,
    component: 'document',
    title: doc.title,
    params: { docId: doc.id },
    ...(anchor ? { position: { referencePanel: anchor.id, direction: 'within' as const } } : {}),
  });
}

/** Espace de travail à panneaux dockables (onglets, groupes, glisser-déposer). */
export function Workspace() {
  const apiRef = useRef<DockviewApi | null>(null);

  useEffect(() => {
    const offPanel = panelRequests.on((id) => {
      const api = apiRef.current;
      if (!api) return;
      const panel = api.getPanel(id);
      if (panel) panel.api.setActive();
      else if (id in TITLE_KEYS) {
        addDefault(api, id as PanelId);
        api.getPanel(id)?.api.setActive();
      }
    });
    const offDoc = documentRequests.on((doc) => apiRef.current && openDocumentPanel(apiRef.current, doc));
    const offReset = resetLayoutRequests.on(() => {
      const api = apiRef.current;
      if (!api) return;
      buildDefaultLayout(api);
      for (const doc of store.get().documents) openDocumentPanel(api, doc);
    });
    return () => {
      offPanel();
      offDoc();
      offReset();
    };
  }, []);

  const onReady = (event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    buildDefaultLayout(event.api);
    event.api.onDidRemovePanel((panel) => {
      if (panel.id.startsWith('doc:')) closeDocument(panel.id);
    });
  };

  return (
    <DockviewReact
      className="fg-dock"
      theme={forgeTheme}
      components={components}
      onReady={onReady}
      disableFloatingGroups={false}
    />
  );
}
