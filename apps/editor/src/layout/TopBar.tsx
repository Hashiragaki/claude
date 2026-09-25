import {
  ActionButton,
  AlertDialog,
  Button,
  DialogContainer,
  Item,
  Menu,
  MenuTrigger,
  Section,
  StatusLight,
  Text,
  Tooltip,
  TooltipTrigger,
} from '@adobe/react-spectrum';
import Play from '@spectrum-icons/workflow/Play';
import Stop from '@spectrum-icons/workflow/Stop';
import { useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import { NewProjectDialog } from '../panels/Home';
import { closeProject, play, resetLayoutRequests, setLocale, stopPlay, useApp } from '../state/app';

const MODE_LABELS: Record<string, string> = {
  vn: 'Visual Novel',
  rpg: 'RPG',
  sandbox3d: '3D',
  platformer: 'Plateformer',
};

export function TopBar() {
  const t = useT();
  const project = useApp((s) => s.project);
  const health = useApp((s) => s.health);
  const playing = useApp((s) => s.play !== null);
  const locale = useApp((s) => s.locale);
  const diagnostics = useApp((s) => s.diagnostics);
  const [dialog, setDialog] = useState<null | 'new' | 'about'>(null);
  const errors = diagnostics.filter((d) => d.severity === 'error').length;

  const onFileAction = (key: React.Key) => {
    switch (key) {
      case 'new':
        setDialog('new');
        break;
      case 'close':
        closeProject();
        break;
      case 'export':
        if (project) window.open(api.exportUrl(project.id), '_blank');
        break;
    }
  };

  const onWindowAction = (key: React.Key) => {
    if (key === 'reset') resetLayoutRequests.emit();
    if (key === 'lang') setLocale(locale === 'fr' ? 'en' : 'fr');
    if (key === 'about') setDialog('about');
  };

  return (
    <header className="fg-topbar">
      <div className="fg-appicon" title="Forge">
        Fg
      </div>
      <MenuTrigger>
        <ActionButton isQuiet>{t('menu.file')}</ActionButton>
        <Menu onAction={onFileAction} disabledKeys={project ? [] : ['close', 'export']}>
          <Section>
            <Item key="new">{t('menu.newProject')}</Item>
          </Section>
          <Section>
            <Item key="export">{t('menu.export')}</Item>
            <Item key="close">{t('menu.closeProject')}</Item>
          </Section>
        </Menu>
      </MenuTrigger>
      <MenuTrigger>
        <ActionButton isQuiet>{t('menu.window')}</ActionButton>
        <Menu onAction={onWindowAction} disabledKeys={project ? [] : ['reset']}>
          <Item key="reset">{t('menu.resetLayout')}</Item>
          <Item key="lang">{t('menu.language')}</Item>
          <Item key="about">{t('menu.about')}</Item>
        </Menu>
      </MenuTrigger>
      <div className="fg-title">
        {project ? (
          <>
            <strong>{project.name}</strong> — {MODE_LABELS[project.mode] ?? project.mode}
            {project.pixelArt ? ' · pixel-art' : ''} · {project.resolution.width}×{project.resolution.height}
          </>
        ) : (
          t('home.title')
        )}
      </div>
      <div className="fg-spacer" />
      {project && errors > 0 && (
        <StatusLight variant="negative">
          {errors} erreur{errors > 1 ? 's' : ''}
        </StatusLight>
      )}
      <TooltipTrigger>
        <ActionButton isQuiet aria-label="État de l'IA">
          <StatusLight variant={health?.ai.enabled ? 'positive' : 'neutral'}>
            {health?.ai.enabled ? t('ai.on') : t('ai.off')}
          </StatusLight>
        </ActionButton>
        <Tooltip>
          {health?.ai.enabled
            ? `Modèle : ${health.ai.model}`
            : "Définissez ANTHROPIC_API_KEY avant de lancer le serveur pour activer l'assistant et la génération par IA. Le mode procédural reste disponible."}
        </Tooltip>
      </TooltipTrigger>
      {project &&
        (playing ? (
          <Button variant="negative" onPress={stopPlay}>
            <Stop />
            <Text>{t('action.stop')}</Text>
          </Button>
        ) : (
          <Button variant="accent" onPress={() => play()}>
            <Play />
            <Text>{t('action.play')}</Text>
          </Button>
        ))}
      <DialogContainer onDismiss={() => setDialog(null)}>
        {dialog === 'new' && <NewProjectDialog onClose={() => setDialog(null)} />}
        {dialog === 'about' && (
          <AlertDialog title="À propos de Forge" variant="information" primaryActionLabel="Fermer">
            Forge 0.1 — moteur de jeu web : génération d'assets par IA (Claude) ou procédurale, modes Visual Novel, RPG
            et 3D, et planification long terme avec un assistant. Serveur : {health?.dataDir ?? '?'}.
          </AlertDialog>
        )}
      </DialogContainer>
    </header>
  );
}
