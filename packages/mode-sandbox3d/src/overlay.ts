/** Interface DOM du mode 3D : écran de départ, invite d'interaction et boîte de dialogue. */

const STYLE = `
.fs3d-ui {
  position: absolute; inset: 0; pointer-events: none; user-select: none; z-index: 2;
  font-family: Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #f2f2f2;
}
.fs3d-title {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 18px; pointer-events: auto; cursor: pointer; text-align: center;
  background: radial-gradient(ellipse at center, rgba(12, 16, 22, 0.25), rgba(12, 16, 22, 0.78));
  backdrop-filter: blur(2px); transition: opacity 0.45s ease;
}
.fs3d-title.fs3d-hidden { opacity: 0; pointer-events: none; }
.fs3d-title h1 {
  margin: 0; font-size: clamp(26px, 5vw, 58px); font-weight: 700; letter-spacing: 0.02em;
  text-shadow: 0 4px 24px rgba(0, 0, 0, 0.55);
}
.fs3d-start {
  padding: 10px 26px; border-radius: 999px; border: 1px solid rgba(255, 255, 255, 0.55);
  background: rgba(255, 255, 255, 0.08); font-size: clamp(14px, 1.8vw, 19px);
  animation: fs3d-pulse 1.8s ease-in-out infinite;
}
.fs3d-help { font-size: clamp(11px, 1.3vw, 14px); color: rgba(242, 242, 242, 0.7); }
.fs3d-prompt {
  position: absolute; left: 50%; bottom: 9%; transform: translate(-50%, 6px); opacity: 0;
  padding: 8px 16px; border-radius: 999px; font-size: clamp(12px, 1.6vw, 16px);
  background: rgba(18, 20, 23, 0.78); border: 1px solid rgba(75, 156, 245, 0.75);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35); transition: opacity 0.18s ease, transform 0.18s ease;
}
.fs3d-prompt kbd {
  display: inline-block; margin-left: 4px; padding: 1px 7px; border-radius: 5px; font: inherit;
  font-weight: 600; background: #4b9cf5; color: #0d1117;
}
.fs3d-dialog {
  position: absolute; left: 50%; bottom: 5%; width: min(760px, 90%); box-sizing: border-box;
  transform: translate(-50%, 14px); opacity: 0; padding: 20px 26px 30px; border-radius: 14px;
  background: linear-gradient(180deg, rgba(26, 30, 37, 0.94), rgba(14, 16, 20, 0.94));
  border: 2px solid #4b9cf5; box-shadow: 0 14px 44px rgba(0, 0, 0, 0.45);
  font-size: clamp(14px, 2vw, 20px); line-height: 1.55; white-space: pre-line;
  transition: opacity 0.2s ease, transform 0.2s ease; cursor: pointer;
}
.fs3d-dialog .fs3d-hint {
  position: absolute; right: 16px; bottom: 8px; font-size: 0.7em; color: rgba(242, 242, 242, 0.6);
  animation: fs3d-blink 1.2s steps(2, start) infinite;
}
.fs3d-visible { opacity: 1; transform: translate(-50%, 0); }
.fs3d-dialog.fs3d-visible { pointer-events: auto; }
@keyframes fs3d-pulse { 0%, 100% { opacity: 0.65; } 50% { opacity: 1; } }
@keyframes fs3d-blink { to { visibility: hidden; } }
`;

const HELP_TEXT = 'ZQSD / flèches : se déplacer · Maj : courir · Entrée : interagir · Souris : caméra';

export interface SandboxOverlayOptions {
  /** Clic sur la boîte de dialogue (la ferme, comme « confirmer »). */
  onDialogClick?: () => void;
}

export class SandboxOverlay {
  readonly root: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly dialog: HTMLDivElement;
  private readonly dialogText: HTMLDivElement;
  private title: HTMLDivElement | null = null;
  private promptVisible = false;

  constructor(container: HTMLElement, options: SandboxOverlayOptions = {}) {
    this.root = el('div', 'fs3d-ui');
    const style = document.createElement('style');
    style.textContent = STYLE;
    this.root.appendChild(style);

    this.prompt = el('div', 'fs3d-prompt');
    this.prompt.append('Appuyer sur ', el('kbd', '', 'Entrée'));
    this.root.appendChild(this.prompt);

    this.dialog = el('div', 'fs3d-dialog');
    this.dialogText = el('div', 'fs3d-text');
    this.dialog.append(this.dialogText, el('div', 'fs3d-hint', 'Entrée ▸'));
    this.dialog.addEventListener('click', () => options.onDialogClick?.());
    this.root.appendChild(this.dialog);

    container.appendChild(this.root);
  }

  /** Affiche l'écran « Cliquer pour commencer » ; `onStart` est appelé au clic. */
  showTitle(name: string, onStart: () => void): void {
    this.hideTitle(true);
    const title = el('div', 'fs3d-title');
    title.append(
      el('h1', '', name),
      el('div', 'fs3d-start', 'Cliquer pour commencer'),
      el('div', 'fs3d-help', HELP_TEXT),
    );
    title.addEventListener('click', (e) => {
      e.stopPropagation();
      onStart();
    });
    this.root.appendChild(title);
    this.title = title;
  }

  get titleVisible(): boolean {
    return this.title !== null;
  }

  hideTitle(immediate = false): void {
    const title = this.title;
    if (!title) return;
    this.title = null;
    if (immediate) {
      title.remove();
      return;
    }
    title.classList.add('fs3d-hidden');
    setTimeout(() => title.remove(), 500);
  }

  setPrompt(visible: boolean): void {
    if (visible === this.promptVisible) return;
    this.promptVisible = visible;
    this.prompt.classList.toggle('fs3d-visible', visible);
  }

  showDialog(text: string): void {
    this.dialogText.textContent = text;
    this.dialog.classList.add('fs3d-visible');
  }

  hideDialog(): void {
    this.dialog.classList.remove('fs3d-visible');
  }

  get dialogVisible(): boolean {
    return this.dialog.classList.contains('fs3d-visible');
  }

  destroy(): void {
    this.title = null;
    this.root.remove();
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
