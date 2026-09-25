export interface SaveData {
  format: 'forge-save@1';
  projectId: string;
  mode: string;
  slot: string;
  label: string;
  savedAt: string;
  /** Temps de jeu en secondes. */
  playTime: number;
  state: unknown;
}

export type SaveSlotInfo = Omit<SaveData, 'state'>;

/** Support de stockage des sauvegardes (localStorage, mémoire, serveur…). */
export interface SaveStorage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

export class MemorySaveStorage implements SaveStorage {
  readonly data = new Map<string, string>();
  async read(key: string) {
    return this.data.get(key) ?? null;
  }
  async write(key: string, value: string) {
    this.data.set(key, value);
  }
  async delete(key: string) {
    this.data.delete(key);
  }
  async keys(prefix: string) {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
  }
}

export class LocalSaveStorage implements SaveStorage {
  async read(key: string) {
    return globalThis.localStorage?.getItem(key) ?? null;
  }
  async write(key: string, value: string) {
    globalThis.localStorage?.setItem(key, value);
  }
  async delete(key: string) {
    globalThis.localStorage?.removeItem(key);
  }
  async keys(prefix: string) {
    const ls = globalThis.localStorage;
    if (!ls) return [];
    const out: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k?.startsWith(prefix)) out.push(k);
    }
    return out;
  }
}

/** Sauvegardes d'un projet, rangées par emplacement (`1`, `2`, `auto`, `quick`…). */
export class SaveManager {
  constructor(
    private readonly storage: SaveStorage,
    private readonly projectId: string,
    private readonly mode: string,
  ) {}

  private key(slot: string): string {
    return `forge:${this.projectId}:save:${slot}`;
  }

  async save(slot: string, state: unknown, label = '', playTime = 0): Promise<SaveSlotInfo> {
    const data: SaveData = {
      format: 'forge-save@1',
      projectId: this.projectId,
      mode: this.mode,
      slot,
      label,
      savedAt: new Date().toISOString(),
      playTime,
      state,
    };
    await this.storage.write(this.key(slot), JSON.stringify(data));
    const { state: _state, ...info } = data;
    return info;
  }

  async load(slot: string): Promise<SaveData | null> {
    const raw = await this.storage.read(this.key(slot));
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (data.format !== 'forge-save@1' || data.projectId !== this.projectId) return null;
    return data;
  }

  async list(): Promise<SaveSlotInfo[]> {
    const prefix = `forge:${this.projectId}:save:`;
    const out: SaveSlotInfo[] = [];
    for (const key of await this.storage.keys(prefix)) {
      const data = await this.load(key.slice(prefix.length));
      if (data) {
        const { state: _state, ...info } = data;
        out.push(info);
      }
    }
    return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async remove(slot: string): Promise<void> {
    await this.storage.delete(this.key(slot));
  }
}
