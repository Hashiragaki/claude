import { num } from '../shared/svg';

/**
 * Nettoie un SVG venant de l'IA (ou d'un import) avant de le stocker et de l'afficher :
 * - supprime `<script>`, `<foreignObject>`, `<iframe>`, `<object>`, `<embed>`, les animations,
 *   les DOCTYPE / entités, les commentaires et les instructions de traitement ;
 * - retire les attributs `on*`, les `href` externes ou `javascript:` (seuls `#id` et les images
 *   `data:image/…` sont conservés), les `<image>` non `data:` et les `url(…)` externes ;
 * - supprime les `<style>` contenant `@import` ou une URL distante ;
 * - impose `xmlns`, `width`, `height` et `viewBox` sur la racine.
 */
export function sanitizeSvg(input: string, size: { width?: number; height?: number } = {}): string {
  let svg = input.replace(/^﻿/, '');
  svg = svg.replace(/<!--[\s\S]*?-->/g, '');
  svg = svg.replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/gi, '');
  svg = svg.replace(/<!ENTITY[\s\S]*?>/gi, '');
  svg = svg.replace(/<\?[\s\S]*?\?>/g, '');

  const start = svg.search(/<svg[\s>]/i);
  const end = svg.toLowerCase().lastIndexOf('</svg>');
  if (start < 0) throw new Error('SVG invalide : élément racine <svg> introuvable.');
  svg = end > start ? svg.slice(start, end + 6) : `${svg.slice(start)}</svg>`;

  // Éléments dangereux (avec contenu) puis leurs formes auto-fermantes ou orphelines.
  const blocked = [
    'script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas',
    'handler', 'listener',
  ];
  for (const tag of blocked) {
    svg = svg.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
    svg = svg.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '');
  }
  for (const tag of ['set', 'animate', 'animateMotion', 'animateTransform', 'animateColor']) {
    svg = svg.replace(new RegExp(`<${tag}\\b[^>]*\\/>`, 'gi'), '');
    svg = svg.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
    svg = svg.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '');
  }

  // Feuilles de style : supprimées si elles importent ou chargent des ressources externes.
  svg = svg.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (whole, css: string) =>
    /@import|url\(\s*['"]?\s*(?!#)|expression\s*\(|javascript:/i.test(css) ? '' : whole,
  );

  // Images : seules les images intégrées en data:image/… sont gardées.
  svg = svg.replace(/<image\b[^>]*?(\/>|>[\s\S]*?<\/image\s*>|>)/gi, (whole) => {
    const href = /\s(?:xlink:)?href\s*=\s*(["'])([\s\S]*?)\1/i.exec(whole)?.[2]?.trim() ?? '';
    return /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(href) ? whole : '';
  });

  svg = svg.replace(/<([a-zA-Z][\w:.-]*)(\s[^<>]*?)?(\/?)>/g,
    (_m, tag: string, attrs: string | undefined, selfClose: string) => {
      return `<${tag}${cleanAttributes(tag, attrs ?? '')}${selfClose}>`;
    }
  );

  return enforceRoot(svg, size);
}

const ATTR_RE = /([^\s=/>]+)(\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;

function cleanAttributes(tag: string, attrs: string): string {
  let out = '';
  const isImage = tag.toLowerCase() === 'image';
  for (const m of attrs.matchAll(ATTR_RE)) {
    const name = m[1] as string;
    const raw = m[3];
    const lower = name.toLowerCase();
    if (lower.startsWith('on')) continue;
    let value = raw === undefined ? undefined : raw.replace(/^["']|["']$/g, '');
    if (value !== undefined) {
      const decoded = decodeEntities(value).replace(/[\s\u0000-\u001f]+/g, '').toLowerCase();
      if (/(javascript|vbscript|data:text|livescript):/.test(decoded)) continue;
      if (lower === 'href' || lower === 'xlink:href') {
        const ok = value.trim().startsWith('#') || (isImage && /^data:image\//i.test(value.trim()));
        if (!ok) continue;
      }
      if (/url\(/i.test(value)) value = value.replace(/url\(\s*(['"]?)\s*(?!#)[^)]*\)/gi, 'none');
      if (lower === 'style' && /expression\s*\(|@import/i.test(value)) continue;
      out += ` ${name}="${value.replace(/"/g, '&quot;')}"`;
    } else if (!lower.startsWith('on')) {
      out += ` ${name}`;
    }
  }
  return out;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&colon;/gi, ':')
    .replace(/&tab;|&newline;/gi, '');
}

function readAttr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs);
  return m?.[1];
}

function positive(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 && !/%$/.test(value.trim()) ? n : undefined;
}

/** Réécrit la balise racine avec xmlns, width, height et viewBox cohérents. */
function enforceRoot(svg: string, size: { width?: number; height?: number }): string {
  const m = /^<svg\b([^>]*?)(\/?)>/i.exec(svg);
  if (!m) throw new Error('SVG invalide : balise racine illisible.');
  let attrs = m[1] ?? '';
  const vb = readAttr(attrs, 'viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const validVb = vb && vb.length === 4 && vb.every(Number.isFinite) && (vb[2] as number) > 0 && (vb[3] as number) > 0;
  const width = size.width ?? positive(readAttr(attrs, 'width')) ?? (validVb ? (vb[2] as number) : 512);
  const height = size.height ?? positive(readAttr(attrs, 'height')) ?? (validVb ? (vb[3] as number) : 512);
  const viewBox = validVb ? (vb as number[]).map((v) => num(v, 3)).join(' ') : `0 0 ${num(width)} ${num(height)}`;
  attrs = attrs.replace(/\s(xmlns|width|height|viewBox)\s*=\s*"[^"]*"/gi, '');
  const needsXlink = /xlink:/.test(svg) && !/\sxmlns:xlink\s*=/.test(attrs);
  const root =
    `<svg xmlns="http://www.w3.org/2000/svg"${needsXlink ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : ''}` +
    ` width="${num(width)}" height="${num(height)}" viewBox="${viewBox}"${attrs}>`;
  const rest = svg.slice(m[0].length);
  return m[2] ? `${root}</svg>` : root + rest;
}
