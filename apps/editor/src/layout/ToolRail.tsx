import { ActionButton, Tooltip, TooltipTrigger } from '@adobe/react-spectrum';
import Chat from '@spectrum-icons/workflow/Chat';
import Code from '@spectrum-icons/workflow/Code';
import Data from '@spectrum-icons/workflow/Data';
import FileCode from '@spectrum-icons/workflow/FileCode';
import Folder from '@spectrum-icons/workflow/Folder';
import GraphGantt from '@spectrum-icons/workflow/GraphGantt';
import Home from '@spectrum-icons/workflow/Home';
import Images from '@spectrum-icons/workflow/Images';
import MapView from '@spectrum-icons/workflow/MapView';
import Orbit from '@spectrum-icons/workflow/Orbit';
import Play from '@spectrum-icons/workflow/Play';
import Properties from '@spectrum-icons/workflow/Properties';
import Variable from '@spectrum-icons/workflow/Variable';
import type { JSX } from 'react';
import { closeProject, openDocument, showPanel, useApp } from '../state/app';

interface RailItem {
  key: string;
  label: string;
  icon: JSX.Element;
  onPress(): void;
}

export function ToolRail() {
  const project = useApp((s) => s.project);
  if (!project) {
    return <nav className="fg-rail" aria-label="Outils" />;
  }
  const modeItems: RailItem[] = [];
  if (project.mode === 'vn') {
    modeItems.push({
      key: 'script',
      label: `Script (${project.entry})`,
      icon: <FileCode />,
      onPress: () =>
        openDocument({ kind: 'script', path: project.entry, title: project.entry.split('/').pop() ?? 'Script' }),
    });
  }
  if (project.mode === 'rpg') {
    modeItems.push(
      {
        key: 'map',
        label: 'Éditeur de cartes',
        icon: <MapView />,
        onPress: () => openDocument({ kind: 'map', path: 'maps/', title: 'Cartes' }),
      },
      {
        key: 'database',
        label: 'Base de données',
        icon: <Data />,
        onPress: () => openDocument({ kind: 'database', path: 'data/database.json', title: 'Base de données' }),
      },
    );
  }
  if (project.mode === 'sandbox3d') {
    modeItems.push({
      key: 'scene',
      label: 'Éditeur de scène 3D',
      icon: <Orbit />,
      onPress: () => openDocument({ kind: 'scene', path: project.entry, title: 'Scène 3D' }),
    });
  }
  const common: RailItem[] = [
    { key: 'game', label: 'Jeu', icon: <Play />, onPress: () => showPanel('game') },
    ...modeItems,
    { key: 'planner', label: 'Planning', icon: <GraphGantt />, onPress: () => showPanel('planner') },
  ];
  const panels: RailItem[] = [
    { key: 'assets', label: 'Assets', icon: <Images />, onPress: () => showPanel('assets') },
    { key: 'properties', label: 'Propriétés', icon: <Properties />, onPress: () => showPanel('properties') },
    { key: 'chat', label: 'Assistant IA', icon: <Chat />, onPress: () => showPanel('chat') },
    { key: 'files', label: 'Fichiers', icon: <Folder />, onPress: () => showPanel('files') },
    { key: 'inspector', label: 'Inspecteur de variables', icon: <Variable />, onPress: () => showPanel('inspector') },
    { key: 'console', label: 'Console', icon: <Code />, onPress: () => showPanel('console') },
  ];
  const render = (item: RailItem) => (
    <TooltipTrigger key={item.key} placement="end" delay={300}>
      <ActionButton isQuiet aria-label={item.label} onPress={item.onPress}>
        {item.icon}
      </ActionButton>
      <Tooltip>{item.label}</Tooltip>
    </TooltipTrigger>
  );
  return (
    <nav className="fg-rail" aria-label="Outils">
      {common.map(render)}
      <hr />
      {panels.map(render)}
      <div style={{ flex: 1 }} />
      {render({ key: 'home', label: 'Accueil (fermer le projet)', icon: <Home />, onPress: closeProject })}
    </nav>
  );
}
