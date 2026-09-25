import { Assets, Rectangle, Texture } from 'pixi.js';

const cache = new Map<string, Promise<Texture>>();

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);

function parserHint(url: string): { parser?: 'texture' | 'svg' } {
  const path = url.split(/[?#]/)[0] ?? '';
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  if (ext === 'svg') return { parser: 'svg' };
  if (ext && IMAGE_EXTENSIONS.has(ext)) return {};
  return { parser: 'texture' };
}

/**
 * Charge une texture depuis une URL (PNG, SVG…). Le filtrage « nearest » est appliqué pour le
 * pixel-art. Les textures sont mises en cache par URL.
 */
export function loadTexture(url: string, options: { pixelArt?: boolean } = {}): Promise<Texture> {
  const key = `${options.pixelArt ? 'px' : 'sm'}|${url}`;
  let promise = cache.get(key);
  if (!promise) {
    promise = Assets.load<Texture>({
      src: url,
      data: { scaleMode: options.pixelArt ? 'nearest' : 'linear' },
      // URL sans extension reconnue (blob:, données en mémoire) : on indique le parser explicitement.
      ...parserHint(url),
    }).then((texture) => {
      if (options.pixelArt) texture.source.scaleMode = 'nearest';
      return texture;
    });
    cache.set(key, promise);
    promise.catch(() => cache.delete(key));
  }
  return promise;
}

/** Charge une texture et renvoie `null` (avec un avertissement) si elle est introuvable. */
export async function tryLoadTexture(url: string, options: { pixelArt?: boolean } = {}): Promise<Texture | null> {
  try {
    return await loadTexture(url, options);
  } catch (error) {
    console.warn(`[forge] texture introuvable : ${url}`, error);
    return null;
  }
}

/**
 * Découpe une texture en grille de frames : `result[ligne][colonne]`.
 * Sert aux charsets, tilesets et planches de sprites.
 */
export function sliceGrid(texture: Texture, frameWidth: number, frameHeight: number): Texture[][] {
  const rows: Texture[][] = [];
  const cols = Math.floor(texture.width / frameWidth);
  const count = Math.floor(texture.height / frameHeight);
  for (let r = 0; r < count; r++) {
    const row: Texture[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(
        new Texture({
          source: texture.source,
          frame: new Rectangle(
            texture.frame.x + c * frameWidth,
            texture.frame.y + r * frameHeight,
            frameWidth,
            frameHeight,
          ),
        }),
      );
    }
    rows.push(row);
  }
  return rows;
}

/** Vide le cache (changement de projet). */
export function clearTextureCache(): void {
  cache.clear();
}
