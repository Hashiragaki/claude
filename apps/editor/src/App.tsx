import { ProgressCircle } from '@adobe/react-spectrum';
import { StatusBar } from './layout/StatusBar';
import { ToolRail } from './layout/ToolRail';
import { TopBar } from './layout/TopBar';
import { Workspace } from './layout/Workspace';
import { Home } from './panels/Home';
import { useApp } from './state/app';

export function App() {
  const ready = useApp((s) => s.ready);
  const project = useApp((s) => s.project);
  if (!ready) {
    return (
      <div className="fg-empty" style={{ height: '100vh' }}>
        <div className="fg-appicon" style={{ width: 48, height: 48, lineHeight: '42px', fontSize: 20 }}>
          Fg
        </div>
        <ProgressCircle aria-label="Chargement" isIndeterminate size="S" />
      </div>
    );
  }
  return (
    <div className="fg-shell">
      <TopBar />
      <ToolRail />
      <main className="fg-main">{project ? <Workspace key={project.id} /> : <Home />}</main>
      <StatusBar />
    </div>
  );
}
