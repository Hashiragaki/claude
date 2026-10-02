import type { HotspotKind } from '../schema';

function svgCursor(body: string, fallback: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
    `<g fill="white" stroke="black" stroke-width="2" stroke-linejoin="round">${body}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, ${fallback}`;
}

const EXIT_CURSOR = svgCursor('<path d="M4 12h14V5l11 11-11 11v-7H4z"/>', 'e-resize');
const CHARACTER_CURSOR = svgCursor('<path d="M4 5h24v16H15l-6 6v-6H4z"/>', 'help');

/** Curseur CSS selon le type de zone survolée : main (objet), flèche (sortie), bulle (personnage). */
export function cursorFor(kind: HotspotKind): string {
  switch (kind) {
    case 'exit':
      return EXIT_CURSOR;
    case 'character':
      return CHARACTER_CURSOR;
    default:
      return 'pointer';
  }
}
