import {
  Engine,
  HttpProjectFiles,
  LocalSaveStorage,
  ModeRegistry,
  createTouchControls,
  isCoarsePointer,
  loadProjectBundle,
  touchLayoutForMode,
} from '@forge/core';
import { platformerMode } from '@forge/mode-platformer';
import { rpgMode } from '@forge/mode-rpg';
import { sandbox3dMode } from '@forge/mode-sandbox3d';
import { vnMode } from '@forge/mode-vn';

/**
 * Lecteur autonome (jeu exporté) : charge le projet depuis `./project/` et le lance en plein écran.
 */
async function main(): Promise<void> {
  const mount = document.getElementById('game') as HTMLElement;
  const files = new HttpProjectFiles(new URL('./project/', window.location.href).toString());
  const bundle = await loadProjectBundle(files);
  document.title = bundle.manifest.name;
  const engine = new Engine({
    bundle,
    modes: new ModeRegistry([vnMode, rpgMode, sandbox3dMode, platformerMode]),
    mount,
    saveStorage: new LocalSaveStorage(),
    locale: navigator.language.startsWith('fr') ? 'fr' : bundle.manifest.locale,
    keyboard: 'window',
  });
  engine.events.on('error', ({ error }) => showError(error.message));
  await engine.start();
  // Manettes virtuelles (appareils tactiles) : la disposition dépend du mode (croix pour rpg/platformer/sandbox3d,
  // ☰ seul pour vn).
  createTouchControls(engine.input, document.body, touchLayoutForMode(bundle.manifest.mode));
  setupFullscreenOnTouch();
  registerOfflineCache();
}

/** Plein écran (et paysage si possible) au premier toucher, sur appareil tactile. */
function setupFullscreenOnTouch(): void {
  const root = document.documentElement;
  if (!isCoarsePointer() || !root.requestFullscreen) return;
  const enter = () => {
    if (document.fullscreenElement) return;
    root
      .requestFullscreen({ navigationUI: 'hide' })
      .then(() => (screen.orientation as { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
      .catch(() => undefined);
  };
  document.addEventListener('pointerup', enter, { once: true });
}

/** Service worker du jeu exporté (généré par l'export) : jeu jouable hors-ligne. Ignoré en développement. */
function registerOfflineCache(): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}

function showError(message: string): void {
  const box = document.getElementById('error');
  if (!box) return;
  box.textContent = `Erreur : ${message}`;
  box.style.display = 'block';
}

main().catch((error: unknown) => showError(error instanceof Error ? error.message : String(error)));
