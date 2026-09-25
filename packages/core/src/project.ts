import { z } from 'zod';

export const PROJECT_FORMAT = 'forge-project@1';

/** Types d'assets affichés dans la galerie. Les scripts, cartes et données sont des fichiers de projet. */
export const AssetKindSchema = z.enum([
  'image', // image fixe (décor, portrait, illustration, icône, battler) — PNG (+ source SVG/pixel)
  'spritesheet', // animation 2D (PNG + atlas JSON compatible PixiJS)
  'charset', // personnage marchant RPG : 3 colonnes × 4 directions (bas, gauche, droite, haut)
  'tileset', // tuiles PNG + métadonnées JSON (passabilité, noms)
  'sfx', // effet sonore WAV
  'music', // musique WAV (+ partition JSON)
  'model', // modèle 3D GLB (animations incluses)
]);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const AssetOriginSchema = z.enum(['ai', 'procedural', 'import', 'template']);
export type AssetOrigin = z.infer<typeof AssetOriginSchema>;

export const AssetMetaSchema = z.object({
  id: z.string(),
  kind: AssetKindSchema,
  /** Nom lisible. */
  name: z.string(),
  /** Nom utilisable dans les scripts (ex. « bg parc », « alice joyeuse »), unique dans le projet. */
  alias: z.string().optional(),
  /** Fichier principal relatif à la racine du projet (PNG, WAV, GLB…). */
  file: z.string(),
  /** Source éditable (SVG, grille pixel JSON, partition JSON, DSL 3D JSON…). */
  source: z.string().optional(),
  /** Fichiers annexes (ex. `atlas` d'une spritesheet, `tiles` d'un tileset). */
  extra: z.record(z.string(), z.string()).default({}),
  mime: z.string(),
  tags: z.array(z.string()).default([]),
  origin: AssetOriginSchema,
  generator: z.string().optional(),
  prompt: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  seed: z.number().optional(),
  /** Version précédente (historique des variantes / retouches). */
  parentId: z.string().optional(),
  version: z.number().int().default(1),
  /** Informations techniques : largeur, hauteur, durée, taille de frame… */
  info: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  createdAt: z.string(),
});
export type AssetMeta = z.infer<typeof AssetMetaSchema>;

export const ProjectManifestSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  /** Identifiant du mode de jeu (`vn`, `rpg`, `sandbox3d`…). */
  mode: z.string(),
  version: z.string().default('0.1.0'),
  locale: z.string().default('fr'),
  locales: z.array(z.string()).default(['fr', 'en']),
  resolution: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .default({ width: 1280, height: 720 }),
  /** Rendu net (pas de lissage) pour le pixel-art. */
  pixelArt: z.boolean().default(false),
  /** Fichier d'entrée propre au mode (script VN, système RPG, scène 3D…). */
  entry: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  assets: z.array(AssetMetaSchema).default([]),
});
export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;
export type ProjectManifestInput = z.input<typeof ProjectManifestSchema>;

export function parseManifest(data: unknown): ProjectManifest {
  return ProjectManifestSchema.parse(data);
}

/** Diagnostic (erreur de script, carte invalide…) affiché dans l'éditeur. */
export interface Diagnostic {
  file: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

// ---------------------------------------------------------------------------
// Accès aux fichiers du projet
// ---------------------------------------------------------------------------

/** Accès en lecture aux fichiers d'un projet, quel que soit le support (HTTP, mémoire, disque). */
export interface ProjectFiles {
  readText(path: string): Promise<string>;
  readJson<T = unknown>(path: string): Promise<T>;
  readBinary(path: string): Promise<Uint8Array>;
  /** URL utilisable par le navigateur (textures, audio, modèles). */
  url(path: string): string;
  exists(path: string): Promise<boolean>;
}

/** Normalise un chemin relatif de projet et refuse les remontées (`..`). */
export function normalizeProjectPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') throw new Error(`Chemin interdit : ${path}`);
    parts.push(part);
  }
  if (parts.length === 0) throw new Error('Chemin vide');
  return parts.join('/');
}

/** Fichiers servis en HTTP (éditeur, jeu exporté). */
export class HttpProjectFiles implements ProjectFiles {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  url(path: string): string {
    const base = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
    return base + normalizeProjectPath(path).split('/').map(encodeURIComponent).join('/');
  }

  private async get(path: string): Promise<Response> {
    const res = await this.fetchImpl(this.url(path), { cache: 'no-store' });
    if (!res.ok) throw new Error(`Lecture impossible de ${path} (HTTP ${res.status})`);
    return res;
  }

  async readText(path: string): Promise<string> {
    return (await this.get(path)).text();
  }

  async readJson<T>(path: string): Promise<T> {
    return (await this.get(path)).json() as Promise<T>;
  }

  async readBinary(path: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.get(path)).arrayBuffer());
  }

  async exists(path: string): Promise<boolean> {
    const res = await this.fetchImpl(this.url(path), { method: 'HEAD', cache: 'no-store' });
    return res.ok;
  }
}

/** Fichiers en mémoire (tests, jeux embarqués). */
export class MemoryProjectFiles implements ProjectFiles {
  private readonly files = new Map<string, string | Uint8Array>();
  private readonly objectUrls = new Map<string, string>();

  constructor(files: Record<string, string | Uint8Array | object> = {}) {
    for (const [path, content] of Object.entries(files)) this.write(path, content);
  }

  write(path: string, content: string | Uint8Array | object): void {
    const value =
      typeof content === 'string' || content instanceof Uint8Array ? content : JSON.stringify(content, null, 2);
    this.files.set(normalizeProjectPath(path), value);
  }

  list(): string[] {
    return [...this.files.keys()].sort();
  }

  private getRaw(path: string): string | Uint8Array {
    const value = this.files.get(normalizeProjectPath(path));
    if (value === undefined) throw new Error(`Fichier introuvable : ${path}`);
    return value;
  }

  async readText(path: string): Promise<string> {
    const raw = this.getRaw(path);
    return typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
  }

  async readJson<T>(path: string): Promise<T> {
    return JSON.parse(await this.readText(path)) as T;
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const raw = this.getRaw(path);
    return typeof raw === 'string' ? new TextEncoder().encode(raw) : raw;
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(normalizeProjectPath(path));
  }

  url(path: string): string {
    const key = normalizeProjectPath(path);
    const cached = this.objectUrls.get(key);
    if (cached) return cached;
    const raw = this.files.get(key);
    if (
      raw !== undefined &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function' &&
      typeof Blob !== 'undefined'
    ) {
      const blob = new Blob([typeof raw === 'string' ? raw : new Uint8Array(raw)], { type: guessMime(key) });
      const url = URL.createObjectURL(blob);
      this.objectUrls.set(key, url);
      return url;
    }
    return `memory:${key}`;
  }
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  json: 'application/json',
  vn: 'text/plain',
  txt: 'text/plain',
  md: 'text/markdown',
  html: 'text/html',
  js: 'text/javascript',
  css: 'text/css',
};

export function guessMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/** Projet chargé : manifeste validé + accès aux fichiers. */
export interface ProjectBundle {
  manifest: ProjectManifest;
  files: ProjectFiles;
}

export async function loadProjectBundle(files: ProjectFiles): Promise<ProjectBundle> {
  const manifest = parseManifest(await files.readJson('project.json'));
  return { manifest, files };
}
