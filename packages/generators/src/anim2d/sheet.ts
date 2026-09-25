import { num } from '../shared/svg';
import type { Anim2dSpec, AnimKey } from './schema';

/** Pose d'une pièce à une frame donnée. */
export interface Pose {
  translate: [number, number];
  rotate: number;
  scale: [number, number];
  opacity: number;
}

const REST: Pose = { translate: [0, 0], rotate: 0, scale: [1, 1], opacity: 1 };

type Prop = 'translate' | 'rotate' | 'scale' | 'opacity';

function lerpValue<T extends number | number[]>(a: T, b: T, t: number): T {
  if (typeof a === 'number') return (a + ((b as number) - a) * t) as T;
  return (a as number[]).map((v, i) => v + (((b as number[])[i] ?? v) - v) * t) as T;
}

/**
 * Interpole chaque propriété indépendamment entre les clés qui la définissent (linéaire),
 * en tenant la première valeur avant la première clé et la dernière après la dernière clé.
 */
export function poseAt(keys: readonly AnimKey[], frame: number): Pose {
  const sorted = [...keys].sort((a, b) => a.frame - b.frame);
  const value = <P extends Prop>(prop: P): Pose[P] => {
    const defined = sorted.filter((k) => k[prop] !== undefined);
    if (defined.length === 0) return REST[prop];
    const first = defined[0] as AnimKey;
    const last = defined[defined.length - 1] as AnimKey;
    if (frame <= first.frame) return first[prop] as Pose[P];
    if (frame >= last.frame) return last[prop] as Pose[P];
    for (let i = 0; i < defined.length - 1; i++) {
      const a = defined[i] as AnimKey;
      const b = defined[i + 1] as AnimKey;
      if (frame >= a.frame && frame <= b.frame) {
        const t = b.frame === a.frame ? 1 : (frame - a.frame) / (b.frame - a.frame);
        return lerpValue(a[prop] as Pose[P], b[prop] as Pose[P], t);
      }
    }
    return last[prop] as Pose[P];
  };
  return { translate: value('translate'), rotate: value('rotate'), scale: value('scale'), opacity: value('opacity') };
}

/** Transformation SVG d'une pose autour du pivot. */
export function poseTransform(pose: Pose, pivot: readonly number[]): string | undefined {
  const [tx, ty] = pose.translate;
  const [px = 0, py = 0] = pivot;
  const [sx, sy] = pose.scale;
  const parts: string[] = [];
  if (tx !== 0 || ty !== 0) parts.push(`translate(${num(tx, 2)} ${num(ty, 2)})`);
  const pivoted = pose.rotate !== 0 || sx !== 1 || sy !== 1;
  if (pivoted) {
    parts.push(`translate(${num(px, 2)} ${num(py, 2)})`);
    if (pose.rotate !== 0) parts.push(`rotate(${num(pose.rotate, 2)})`);
    if (sx !== 1 || sy !== 1) parts.push(`scale(${num(sx, 3)} ${num(sy, 3)})`);
    parts.push(`translate(${num(-px, 2)} ${num(-py, 2)})`);
  }
  return parts.length ? parts.join(' ') : undefined;
}

/** Préfixe les identifiants internes d'un fragment pour éviter les collisions entre pièces. */
export function namespaceIds(fragment: string, prefix: string): string {
  const ids = [...fragment.matchAll(/\sid\s*=\s*"([^"]+)"/g)].map((m) => m[1] as string);
  let out = fragment;
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out
      .replace(new RegExp(`(\\sid\\s*=\\s*")${esc}"`, 'g'), `$1${prefix}${id}"`)
      .replace(new RegExp(`url\\(\\s*#${esc}\\s*\\)`, 'g'), `url(#${prefix}${id})`)
      .replace(new RegExp(`(href\\s*=\\s*")#${esc}"`, 'g'), `$1#${prefix}${id}"`);
  }
  return out;
}

export interface SheetLayout {
  columns: number;
  rows: number;
  width: number;
  height: number;
}

export function sheetLayout(spec: Anim2dSpec): SheetLayout {
  const columns = Math.max(...spec.animations.map((a) => a.frames));
  const rows = spec.animations.length;
  return { columns, rows, width: columns * spec.width, height: rows * spec.height };
}

/** Planche SVG : une ligne par animation, une colonne par frame, chaque cellule découpée. */
export function buildSheetSvg(spec: Anim2dSpec): string {
  const { width, height } = sheetLayout(spec);
  const defs: string[] = [`<clipPath id="cell"><rect width="${spec.width}" height="${spec.height}"/></clipPath>`];
  for (const part of spec.parts) defs.push(`<g id="part-${part.id}">${namespaceIds(part.svg, `${part.id}-`)}</g>`);
  const cells: string[] = [];
  spec.animations.forEach((anim, row) => {
    const byPart = new Map<string, AnimKey[]>();
    for (const k of anim.keys) byPart.set(k.part, [...(byPart.get(k.part) ?? []), k]);
    for (let f = 0; f < anim.frames; f++) {
      const uses: string[] = [];
      for (const part of spec.parts) {
        const pose = poseAt(byPart.get(part.id) ?? [], f);
        if (pose.opacity <= 0.001) continue;
        const transform = poseTransform(pose, part.pivot);
        uses.push(
          `<use href="#part-${part.id}"${transform ? ` transform="${transform}"` : ''}` +
            `${pose.opacity < 1 ? ` opacity="${num(pose.opacity, 3)}"` : ''}/>`,
        );
      }
      cells.push(`<g transform="translate(${f * spec.width} ${row * spec.height})" clip-path="url(#cell)">${uses.join('')}</g>`);
    }
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs>${defs.join('')}</defs>${cells.join('')}</svg>`
  );
}

/** Atlas au format « spritesheet » de PixiJS (`meta.image` est réécrit par le serveur). */
export function buildAtlas(spec: Anim2dSpec) {
  const { width, height } = sheetLayout(spec);
  const frames: Record<string, unknown> = {};
  const animations: Record<string, string[]> = {};
  spec.animations.forEach((anim, row) => {
    const names: string[] = [];
    for (let f = 0; f < anim.frames; f++) {
      const name = `${anim.name}_${f}`;
      names.push(name);
      frames[name] = {
        frame: { x: f * spec.width, y: row * spec.height, w: spec.width, h: spec.height },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: spec.width, h: spec.height },
        sourceSize: { w: spec.width, h: spec.height },
      };
    }
    animations[anim.name] = names;
  });
  return {
    frames,
    animations,
    meta: { image: 'sheet.png', format: 'RGBA8888', size: { w: width, h: height }, scale: 1 },
  };
}
