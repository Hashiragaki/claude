const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Identifiant court aléatoire, préfixé (ex. `img_k3j9x2ab`). */
export function shortId(prefix = '', length = 8): string {
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto?.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let id = '';
  for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
  return prefix ? `${prefix}_${id}` : id;
}

/** Transforme un texte en identifiant de fichier (`Épée de feu !` → `epee-de-feu`). */
export function slugify(text: string, maxLength = 40): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'asset';
}

export function nowIso(): string {
  return new Date().toISOString();
}
