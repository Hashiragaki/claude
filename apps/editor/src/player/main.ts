import { Engine, HttpProjectFiles, LocalSaveStorage, ModeRegistry, loadProjectBundle } from '@forge/core';
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
}

function showError(message: string): void {
  const box = document.getElementById('error');
  if (!box) return;
  box.textContent = `Erreur : ${message}`;
  box.style.display = 'block';
}

main().catch((error: unknown) => showError(error instanceof Error ? error.message : String(error)));
