import { ActionButton, Button, Text, Tooltip, TooltipTrigger } from '@adobe/react-spectrum';
import FullScreen from '@spectrum-icons/workflow/FullScreen';
import Pause from '@spectrum-icons/workflow/Pause';
import Play from '@spectrum-icons/workflow/Play';
import Refresh from '@spectrum-icons/workflow/Refresh';
import SaveFloppy from '@spectrum-icons/workflow/SaveFloppy';
import Stop from '@spectrum-icons/workflow/Stop';
import VolumeMute from '@spectrum-icons/workflow/VolumeMute';
import VolumeThree from '@spectrum-icons/workflow/VolumeThree';
import { Engine, HttpProjectFiles, LocalSaveStorage, loadProjectBundle } from '@forge/core';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { modes } from '../modes';
import { log, play, stopPlay, toastError, useApp, validateProject } from '../state/app';
import { bumpDebugRevision, playSession, usePlaySession } from '../state/playSession';

/** Lecture du jeu dans l'éditeur (« Play-in-editor »). */
export function GamePanel() {
  const project = useApp((s) => s.project);
  const request = useApp((s) => s.play);
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'running' | 'error'>('idle');
  const [muted, setMuted] = useState(false);
  const paused = usePlaySession((s) => s.paused);

  useEffect(() => {
    const mount = mountRef.current;
    if (!request || !project || !mount) {
      setStatus('idle');
      return;
    }
    let engine: Engine | null = null;
    let cancelled = false;
    setStatus('loading');
    (async () => {
      const diagnostics = await validateProject().catch(() => []);
      const errors = diagnostics.filter((d) => d.severity === 'error');
      if (errors.length) log('warn', 'jeu', `${errors.length} erreur(s) détectée(s) : le jeu peut mal se comporter.`);
      const bundle = await loadProjectBundle(new HttpProjectFiles(api.fileUrl(project.id, '')));
      if (cancelled) return;
      mount.innerHTML = '';
      engine = new Engine({
        bundle,
        modes,
        mount,
        saveStorage: new LocalSaveStorage(),
        run: {
          startLabel: request.startLabel,
          startMap: request.startMap,
          startX: request.startX,
          startY: request.startY,
          skipTitle: request.skipTitle,
          debug: true,
        },
      });
      engine.events.on('log', ({ level, message }) => log(level, 'jeu', message));
      engine.events.on('state-changed', () => bumpDebugRevision());
      engine.events.on('error', ({ error }) => {
        setStatus('error');
        log('error', 'jeu', `Erreur d'exécution : ${error.message}`);
      });
      engine.events.on('game-end', ({ reason }) => log('info', 'jeu', `Fin de partie (${reason}).`));
      engine.audio.setMuted(muted);
      playSession.set({ engine, paused: false });
      await engine.start();
      if (!cancelled) {
        setStatus('running');
        mount.focus({ preventScroll: true });
      }
    })().catch((error: unknown) => {
      if (cancelled) return;
      setStatus('error');
      toastError(error);
    });
    return () => {
      cancelled = true;
      engine?.destroy();
      playSession.set({ engine: null, paused: false });
      mount.innerHTML = '';
    };
    // La session est relancée à chaque nouvelle demande de lecture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.session, project?.id]);

  const engine = () => playSession.get().engine;

  const togglePause = () => {
    const e = engine();
    if (!e) return;
    if (e.paused) e.resume();
    else e.pause();
    playSession.set({ paused: e.paused });
  };

  const toggleMute = () => {
    setMuted((m) => {
      engine()?.audio.setMuted(!m);
      return !m;
    });
  };

  const quickSave = async () => {
    try {
      await engine()?.save('quick', 'Sauvegarde rapide (éditeur)');
      log('info', 'jeu', 'Sauvegarde rapide effectuée.');
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <div className="fg-panel">
      <div className="fg-toolbar">
        {request ? (
          <>
            <Button variant="negative" style="fill" onPress={stopPlay}>
              <Stop />
              <Text>Arrêter</Text>
            </Button>
            <TooltipTrigger>
              <ActionButton onPress={() => play({ ...request })} aria-label="Relancer">
                <Refresh />
              </ActionButton>
              <Tooltip>Relancer depuis le début</Tooltip>
            </TooltipTrigger>
            <TooltipTrigger>
              <ActionButton
                onPress={togglePause}
                aria-label={paused ? 'Reprendre' : 'Pause'}
                isDisabled={status !== 'running'}
              >
                {paused ? <Play /> : <Pause />}
              </ActionButton>
              <Tooltip>{paused ? 'Reprendre' : 'Pause'}</Tooltip>
            </TooltipTrigger>
            <TooltipTrigger>
              <ActionButton
                onPress={() => void quickSave()}
                aria-label="Sauvegarde rapide"
                isDisabled={status !== 'running'}
              >
                <SaveFloppy />
              </ActionButton>
              <Tooltip>Sauvegarde rapide</Tooltip>
            </TooltipTrigger>
          </>
        ) : (
          <Button variant="accent" onPress={() => play()} isDisabled={!project}>
            <Play />
            <Text>Jouer</Text>
          </Button>
        )}
        <TooltipTrigger>
          <ActionButton onPress={toggleMute} aria-label={muted ? 'Activer le son' : 'Couper le son'}>
            {muted ? <VolumeMute /> : <VolumeThree />}
          </ActionButton>
          <Tooltip>{muted ? 'Activer le son' : 'Couper le son'}</Tooltip>
        </TooltipTrigger>
        <TooltipTrigger>
          <ActionButton onPress={() => void mountRef.current?.requestFullscreen()} aria-label="Plein écran">
            <FullScreen />
          </ActionButton>
          <Tooltip>Plein écran</Tooltip>
        </TooltipTrigger>
        <div className="fg-spacer" />
        <span style={{ fontSize: 12, color: 'var(--fg-text-3)' }}>
          {status === 'loading' && 'Chargement…'}
          {status === 'running' &&
            (paused ? 'En pause' : 'En cours — cliquez dans le jeu pour le contrôler au clavier')}
          {status === 'error' && 'Erreur (voir la console)'}
        </span>
      </div>
      <div className="fg-game-view">
        <div className="fg-game-mount" ref={mountRef} />
        {!request && (
          <div className="fg-game-overlay">
            <div style={{ fontSize: 15, color: 'var(--fg-text)' }}>{project?.name}</div>
            <Button variant="accent" onPress={() => play()}>
              <Play />
              <Text>Lancer le jeu</Text>
            </Button>
            <div style={{ fontSize: 12 }}>Flèches / ZQSD : se déplacer · Entrée / Espace : valider · Échap : menu</div>
          </div>
        )}
      </div>
    </div>
  );
}
