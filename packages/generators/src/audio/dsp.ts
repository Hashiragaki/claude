/** Utilitaires de traitement du signal partagés par les générateurs audio. */

/** Pic absolu sur un ou plusieurs canaux. */
export function peakOf(channels: Float32Array | Float32Array[]): number {
  const list = channels instanceof Float32Array ? [channels] : channels;
  let peak = 0;
  for (const ch of list) {
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i]);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/** Met à l'échelle pour que le pic vaille `target` (sans effet sur un signal muet). */
export function normalizePeak(channels: Float32Array | Float32Array[], target = 0.9): void {
  const list = channels instanceof Float32Array ? [channels] : channels;
  const peak = peakOf(list);
  if (peak < 1e-9) return;
  const gain = target / peak;
  for (const ch of list) for (let i = 0; i < ch.length; i++) ch[i] *= gain;
}

/**
 * Longueur utile une fois le silence final retiré : dernier échantillon dont l'amplitude dépasse
 * `threshold` × pic (−60 dB par défaut), plus une petite marge.
 */
export function trailingSilenceEnd(
  channels: Float32Array | Float32Array[],
  sampleRate: number,
  threshold = 0.001,
): number {
  const list = channels instanceof Float32Array ? [channels] : channels;
  const limit = peakOf(list) * threshold;
  let end = 0;
  for (const ch of list) {
    for (let i = ch.length - 1; i >= end; i--) {
      if (Math.abs(ch[i]) > limit) {
        end = i + 1;
        break;
      }
    }
  }
  const margin = Math.round(sampleRate * 0.01);
  return Math.min(list[0].length, Math.max(1, end + margin));
}

/** Fondu de sortie linéaire sur les `length` derniers échantillons. */
export function fadeOut(channel: Float32Array, length: number): void {
  const n = Math.min(length, channel.length);
  for (let i = 0; i < n; i++) channel[channel.length - 1 - i] *= i / n;
}

/** Fondu d'entrée linéaire sur les `length` premiers échantillons. */
export function fadeIn(channel: Float32Array, length: number): void {
  const n = Math.min(length, channel.length);
  for (let i = 0; i < n; i++) channel[i] *= i / n;
}

/**
 * Saturation douce (tanh) : normalise d'abord le pic à 1, puis arrondit les crêtes pour que le pic
 * final vaille `ceiling`. Les passages calmes gagnent un peu de présence sans écrêtage dur.
 */
export function softClip(channels: Float32Array[], ceiling = 0.9, drive = 1.4): void {
  normalizePeak(channels, 1);
  const norm = ceiling / Math.tanh(drive);
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] = Math.tanh(ch[i] * drive) * norm;
}

/** Arrondi à deux décimales (durées affichées). */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
