import type { GeneratedFile } from '../types';

export function pngFile(role: string, data: Uint8Array): GeneratedFile {
  return { role, ext: 'png', mime: 'image/png', data };
}

export function svgFile(role: string, svg: string): GeneratedFile {
  return { role, ext: 'svg', mime: 'image/svg+xml', data: svg };
}

export function jsonFile(role: string, value: unknown): GeneratedFile {
  return { role, ext: 'json', mime: 'application/json', data: `${JSON.stringify(value, null, 2)}\n` };
}
