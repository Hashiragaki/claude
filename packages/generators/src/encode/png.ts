import { unzlibSync, zlibSync } from 'fflate';

/** Encodeur/décodeur PNG minimal (RVB(A) 8 bits, sans entrelacement) pour le pixel-art et les tuiles. */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let crcTable: Uint32Array | undefined;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

/** CRC-32 (polynôme PNG/zlib) d'une portion d'octets. */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = (table[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function writeU32(out: Uint8Array, offset: number, value: number): void {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  writeU32(out, 0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  writeU32(out, 8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/**
 * Encode une image RVBA (4 octets par pixel, lignes de haut en bas) en PNG.
 * Chaque ligne est filtrée avec « Sub » ou « Up » selon ce qui compresse le mieux.
 */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Dimensions PNG invalides : ${width}×${height}`);
  }
  const stride = width * 4;
  if (rgba.length !== stride * height) {
    throw new Error(`Taille des pixels incohérente : ${rgba.length} octets pour ${width}×${height}`);
  }
  const raw = new Uint8Array((stride + 1) * height);
  const sub = new Uint8Array(stride);
  const up = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    let costSub = 0;
    let costUp = 0;
    for (let i = 0; i < stride; i++) {
      const v = rgba[row + i] as number;
      const left = i >= 4 ? (rgba[row + i - 4] as number) : 0;
      const above = y > 0 ? (rgba[row - stride + i] as number) : 0;
      const s = (v - left) & 0xff;
      const u = (v - above) & 0xff;
      sub[i] = s;
      up[i] = u;
      costSub += s < 128 ? s : 256 - s;
      costUp += u < 128 ? u : 256 - u;
    }
    const target = y * (stride + 1);
    if (costUp < costSub) {
      raw[target] = 2;
      raw.set(up, target + 1);
    } else {
      raw[target] = 1;
      raw.set(sub, target + 1);
    }
  }
  const ihdr = new Uint8Array(13);
  writeU32(ihdr, 0, width);
  writeU32(ihdr, 4, height);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RVBA
  const parts = [
    Uint8Array.from(PNG_SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Lit la largeur et la hauteur d'un PNG (en-tête IHDR), ou `undefined` si ce n'est pas un PNG. */
export function readPngSize(png: Uint8Array): { width: number; height: number } | undefined {
  if (png.length < 24 || PNG_SIGNATURE.some((b, i) => png[i] !== b)) return undefined;
  const u32 = (o: number) =>
    (((png[o] as number) << 24) |
      ((png[o + 1] as number) << 16) |
      ((png[o + 2] as number) << 8) |
      (png[o + 3] as number)) >>>
    0;
  return { width: u32(16), height: u32(20) };
}

export interface DecodedPng {
  width: number;
  height: number;
  /** Pixels RVBA, 4 octets par pixel, lignes de haut en bas. */
  rgba: Uint8Array;
}

/**
 * Décode un PNG 8 bits par canal, type couleur RVBA (6) ou RVB (2), non entrelacé.
 * Gère les cinq filtres de ligne standards (None, Sub, Up, Average, Paeth).
 */
export function decodePng(png: Uint8Array): DecodedPng {
  if (png.length < 8 || PNG_SIGNATURE.some((b, i) => png[i] !== b)) throw new Error('Signature PNG absente');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      bitDepth = data[8] as number;
      colorType = data[9] as number;
      interlace = data[12] as number;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Seuls les PNG RVB(A) 8 bits sont gérés (profondeur ${bitDepth}, type couleur ${colorType}).`);
  }
  if (interlace !== 0) throw new Error('Les PNG entrelacés ne sont pas gérés.');
  const channels = colorType === 6 ? 4 : 3;
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of idat) {
    joined.set(c, p);
    p += c.length;
  }
  const raw = unzlibSync(joined);
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x] as number;
      const a = x >= channels ? (out[y * stride + x - channels] as number) : 0;
      const b = y > 0 ? (out[(y - 1) * stride + x] as number) : 0;
      const c = x >= channels && y > 0 ? (out[(y - 1) * stride + x - channels] as number) : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) {
        throw new Error(`Filtre de ligne PNG inconnu : ${filter}.`);
      }
      out[y * stride + x] = (v + pred) & 0xff;
    }
  }
  if (channels === 4) return { width, height, rgba: out };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < out.length; i += 3, j += 4) {
    rgba[j] = out[i] as number;
    rgba[j + 1] = out[i + 1] as number;
    rgba[j + 2] = out[i + 2] as number;
    rgba[j + 3] = 255;
  }
  return { width, height, rgba };
}

/** Agrandit un PNG au plus proche voisin (préserve les bords nets du pixel-art). */
export function upscalePngNearest(png: Uint8Array, factor: number): Uint8Array {
  if (!Number.isInteger(factor) || factor < 1) throw new Error(`Facteur d'agrandissement invalide : ${factor}`);
  const { width, height, rgba } = decodePng(png);
  const outWidth = width * factor;
  const outHeight = height * factor;
  const out = new Uint8Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y++) {
    const sy = Math.floor(y / factor);
    for (let x = 0; x < outWidth; x++) {
      const sx = Math.floor(x / factor);
      const si = (sy * width + sx) * 4;
      const di = (y * outWidth + x) * 4;
      out[di] = rgba[si] as number;
      out[di + 1] = rgba[si + 1] as number;
      out[di + 2] = rgba[si + 2] as number;
      out[di + 3] = rgba[si + 3] as number;
    }
  }
  return encodePng(outWidth, outHeight, out);
}
