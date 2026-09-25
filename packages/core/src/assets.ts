import type { AssetKind, AssetMeta, ProjectFiles } from './project';

/**
 * Index des assets d'un projet : recherche par id, alias ou tags, et résolution d'URL.
 * Le chargement effectif (textures, buffers audio, glTF) est fait par les moteurs de rendu.
 */
export class AssetRegistry {
  private readonly byId = new Map<string, AssetMeta>();
  private readonly byAlias = new Map<string, AssetMeta>();

  constructor(
    assets: readonly AssetMeta[],
    private readonly files: ProjectFiles,
  ) {
    for (const asset of assets) this.add(asset);
  }

  add(asset: AssetMeta): void {
    this.byId.set(asset.id, asset);
    if (asset.alias) this.byAlias.set(normalizeAlias(asset.alias), asset);
  }

  get(id: string): AssetMeta | undefined {
    return this.byId.get(id);
  }

  /** Recherche par alias exact (insensible à la casse et aux espaces multiples). */
  getByAlias(alias: string): AssetMeta | undefined {
    return this.byAlias.get(normalizeAlias(alias));
  }

  /**
   * Résout une référence de script : id, alias, ou chemin de fichier.
   * Pour un alias à plusieurs mots (« alice joyeuse »), essaie aussi les préfixes (« alice »),
   * comme les attributs d'image de Ren'Py.
   */
  resolve(ref: string, kind?: AssetKind): AssetMeta | undefined {
    const matchKind = (a: AssetMeta | undefined) => (a && (!kind || a.kind === kind) ? a : undefined);
    const direct = matchKind(this.byId.get(ref)) ?? matchKind(this.getByAlias(ref));
    if (direct) return direct;
    const byFile = [...this.byId.values()].find((a) => a.file === ref && (!kind || a.kind === kind));
    if (byFile) return byFile;
    const words = normalizeAlias(ref).split(' ');
    for (let n = words.length - 1; n >= 1; n--) {
      const found = matchKind(this.getByAlias(words.slice(0, n).join(' ')));
      if (found) return found;
    }
    return undefined;
  }

  list(kind?: AssetKind): AssetMeta[] {
    const all = [...this.byId.values()];
    return kind ? all.filter((a) => a.kind === kind) : all;
  }

  withTag(tag: string): AssetMeta[] {
    return [...this.byId.values()].filter((a) => a.tags.includes(tag));
  }

  /** URL du fichier principal d'un asset. */
  url(asset: AssetMeta | string): string {
    const meta = typeof asset === 'string' ? this.byId.get(asset) : asset;
    if (!meta) throw new Error(`Asset inconnu : ${String(asset)}`);
    return this.files.url(meta.file);
  }

  /** URL d'un fichier annexe (`atlas`, `tiles`…). */
  extraUrl(asset: AssetMeta, key: string): string | undefined {
    const path = asset.extra[key];
    return path ? this.files.url(path) : undefined;
  }

  get projectFiles(): ProjectFiles {
    return this.files;
  }
}

export function normalizeAlias(alias: string): string {
  return alias.trim().toLowerCase().replace(/\s+/g, ' ');
}
