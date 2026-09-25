/**
 * Encodeur WAV (RIFF / PCM 16 bits little-endian), 1 ou 2 canaux.
 * Pur TypeScript : fonctionne dans Node comme dans le navigateur.
 */

const HEADER_SIZE = 44;

/**
 * Encode des échantillons flottants ([-1, 1], écrêtés au-delà) en fichier WAV PCM 16 bits.
 * `channels` : un tableau (mono) ou une liste de 1 à 2 canaux de même longueur.
 */
export function encodeWav(channels: Float32Array[] | Float32Array, sampleRate: number): Uint8Array {
  const list = channels instanceof Float32Array ? [channels] : channels;
  if (list.length < 1 || list.length > 2) {
    throw new Error(`encodeWav : 1 ou 2 canaux attendus, reçu ${list.length}`);
  }
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new Error(`encodeWav : fréquence d'échantillonnage invalide (${sampleRate})`);
  }
  const frames = list[0].length;
  if (list.some((c) => c.length !== frames)) {
    throw new Error('encodeWav : tous les canaux doivent avoir la même longueur');
  }

  const numChannels = list.length;
  const blockAlign = numChannels * 2;
  const dataSize = frames * blockAlign;
  const bytes = new Uint8Array(HEADER_SIZE + dataSize);
  const view = new DataView(bytes.buffer);

  writeAscii(bytes, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(bytes, 8, 'WAVE');
  writeAscii(bytes, 12, 'fmt ');
  view.setUint32(16, 16, true); // taille du bloc fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // octets par seconde
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits par échantillon
  writeAscii(bytes, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = HEADER_SIZE;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      view.setInt16(offset, toInt16(list[c][i]), true);
      offset += 2;
    }
  }
  return bytes;
}

/** Convertit un flottant en entier 16 bits signé (écrêtage, NaN → 0). */
function toInt16(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const v = value < -1 ? -1 : value > 1 ? 1 : value;
  return v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
}

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
}

/** Relit un WAV PCM 16 bits produit par `encodeWav` (échantillons flottants par canal). */
export function decodeWav(bytes: Uint8Array): { sampleRate: number; channels: Float32Array[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.byteLength < HEADER_SIZE || ascii(0) !== 'RIFF' || ascii(8) !== 'WAVE') {
    throw new Error('decodeWav : en-tête RIFF/WAVE absent');
  }
  if (view.getUint16(20, true) !== 1 || view.getUint16(34, true) !== 16) {
    throw new Error('decodeWav : seul le PCM 16 bits est pris en charge');
  }
  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const dataSize = view.getUint32(40, true);
  const frames = dataSize / (2 * numChannels);
  const channels = Array.from({ length: numChannels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      channels[c][i] = view.getInt16(HEADER_SIZE + (i * numChannels + c) * 2, true) / 0x8000;
    }
  }
  return { sampleRate, channels };
}
