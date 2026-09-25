/** Apparence des fenêtres de jeu (dialogues, menus). */
export interface UiTheme {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  textColor: number;
  mutedTextColor: number;
  nameColor: number;
  panelColor: number;
  panelAlpha: number;
  borderColor: number;
  borderWidth: number;
  accentColor: number;
  selectionColor: number;
  radius: number;
  padding: number;
}

export const DEFAULT_THEME: UiTheme = {
  fontFamily: 'Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
  fontSize: 26,
  lineHeight: 36,
  textColor: 0xf2f2f2,
  mutedTextColor: 0x8a8a8a,
  nameColor: 0xffffff,
  panelColor: 0x121417,
  panelAlpha: 0.86,
  borderColor: 0x4b9cf5,
  borderWidth: 2,
  accentColor: 0x4b9cf5,
  selectionColor: 0x2c5f99,
  radius: 12,
  padding: 22,
};

/** Variante pour les jeux en pixel-art (rendu à basse résolution). */
export const PIXEL_THEME: UiTheme = {
  ...DEFAULT_THEME,
  fontFamily: '"Courier New", monospace',
  fontSize: 14,
  lineHeight: 18,
  radius: 3,
  padding: 8,
  borderWidth: 1,
};

/** Convertit `#rrggbb` (ou un nombre) en couleur numérique. */
export function toColor(value: string | number | undefined, fallback: number): number {
  if (typeof value === 'number') return value;
  if (!value) return fallback;
  const hex = value.trim().replace('#', '');
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return parseInt(
      hex
        .split('')
        .map((c) => c + c)
        .join(''),
      16,
    );
  }
  if (/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) return parseInt(hex.slice(0, 6), 16);
  return fallback;
}
