export type AudioChannel = 'master' | 'bgm' | 'sfx' | 'voice';

export interface PlayOptions {
  volume?: number;
  loop?: boolean;
  /** Fondu d'entrée / de sortie en millisecondes. */
  fadeMs?: number;
}

/**
 * Lecture audio via WebAudio : une piste de musique (BGM) avec fondus, des effets (SFX) et une voix.
 * Sans AudioContext (Node, tests), toutes les méthodes sont sans effet.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private readonly gains = new Map<AudioChannel, GainNode>();
  private readonly volumes: Record<AudioChannel, number> = { master: 1, bgm: 0.7, sfx: 0.9, voice: 1 };
  private readonly buffers = new Map<string, Promise<AudioBuffer>>();
  private bgm: { url: string; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private voice: AudioBufferSourceNode | null = null;
  private readonly sounds = new Set<AudioBufferSourceNode>();
  private muted = false;
  private disposed = false;
  /** Jeton de génération : incrémenté par playBgm/stopBgm pour ignorer un chargement périmé. */
  private bgmToken = 0;
  /** Jeton de génération équivalent pour playVoice/stopVoice. */
  private voiceToken = 0;

  constructor(private readonly fetchImpl: typeof fetch = (...args) => fetch(...args)) {}

  get available(): boolean {
    return typeof AudioContext !== 'undefined';
  }

  get currentBgm(): string | null {
    return this.bgm?.url ?? null;
  }

  private context(): AudioContext | null {
    // Le manager a été disposé (ex. Engine.destroy()) : ne jamais recréer de contexte, sinon
    // un déverrouillage audio tardif (écouteur non détaché) ferait fuir un AudioContext orphelin.
    if (this.disposed) return null;
    if (this.ctx) return this.ctx;
    if (!this.available) return null;
    this.ctx = new AudioContext();
    const master = this.ctx.createGain();
    master.connect(this.ctx.destination);
    this.gains.set('master', master);
    for (const ch of ['bgm', 'sfx', 'voice'] as const) {
      const g = this.ctx.createGain();
      g.connect(master);
      this.gains.set(ch, g);
    }
    this.applyVolumes();
    return this.ctx;
  }

  /** À appeler depuis un geste utilisateur : les navigateurs bloquent l'audio avant. */
  async unlock(): Promise<void> {
    const ctx = this.context();
    if (ctx && ctx.state === 'suspended') await ctx.resume();
  }

  setVolume(channel: AudioChannel, value: number): void {
    this.volumes[channel] = Math.max(0, Math.min(1, value));
    this.applyVolumes();
  }

  getVolume(channel: AudioChannel): number {
    return this.volumes[channel];
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    for (const [ch, gain] of this.gains) {
      const v = ch === 'master' ? (this.muted ? 0 : this.volumes.master) : this.volumes[ch];
      gain.gain.setValueAtTime(v, this.ctx.currentTime);
    }
  }

  private load(url: string): Promise<AudioBuffer> {
    const ctx = this.context();
    if (!ctx) return Promise.reject(new Error('Audio indisponible'));
    let promise = this.buffers.get(url);
    if (!promise) {
      promise = this.fetchImpl(url)
        .then((r) => {
          if (!r.ok) throw new Error(`Audio introuvable : ${url}`);
          return r.arrayBuffer();
        })
        .then((data) => ctx.decodeAudioData(data));
      this.buffers.set(url, promise);
      promise.catch(() => this.buffers.delete(url));
    }
    return promise;
  }

  /** Précharge une liste d'URL audio. */
  async preload(urls: string[]): Promise<void> {
    if (!this.available) return;
    await Promise.allSettled(urls.map((u) => this.load(u)));
  }

  async playBgm(url: string, options: PlayOptions = {}): Promise<void> {
    const ctx = this.context();
    if (!ctx) return;
    if (this.bgm?.url === url) return;
    const fade = (options.fadeMs ?? 600) / 1000;
    this.stopBgm(options.fadeMs ?? 600);
    // Capturé après stopBgm() (qui incrémente déjà le jeton) : si un autre playBgm/stopBgm
    // survient pendant l'attente ci-dessous, le jeton courant aura changé et ce chargement,
    // devenu périmé, ne doit pas démarrer ni écraser la piste plus récente.
    const token = this.bgmToken;
    const buffer = await this.load(url);
    if (token !== this.bgmToken) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = options.loop ?? true;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(options.volume ?? 1, ctx.currentTime + fade);
    source.connect(gain).connect(this.gains.get('bgm') as GainNode);
    source.start();
    this.bgm = { url, source, gain };
  }

  stopBgm(fadeMs = 600): void {
    this.bgmToken++;
    const ctx = this.ctx;
    const current = this.bgm;
    if (!ctx || !current) return;
    this.bgm = null;
    const end = ctx.currentTime + fadeMs / 1000;
    current.gain.gain.cancelScheduledValues(ctx.currentTime);
    current.gain.gain.setValueAtTime(current.gain.gain.value, ctx.currentTime);
    current.gain.gain.linearRampToValueAtTime(0, end);
    current.source.stop(end + 0.05);
  }

  /** Joue un effet sonore (éventuellement en boucle, jusqu'à `stopSfx`). */
  async playSfx(url: string, options: PlayOptions = {}): Promise<void> {
    const ctx = this.context();
    if (!ctx) return;
    const buffer = await this.load(url);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = options.loop ?? false;
    const gain = ctx.createGain();
    gain.gain.value = options.volume ?? 1;
    source.connect(gain).connect(this.gains.get('sfx') as GainNode);
    this.sounds.add(source);
    source.onended = () => this.sounds.delete(source);
    source.start();
  }

  /** Arrête tous les effets sonores en cours (notamment ceux en boucle). */
  stopSfx(): void {
    for (const source of this.sounds) {
      try {
        source.stop();
      } catch {
        // déjà arrêté
      }
    }
    this.sounds.clear();
  }

  async playVoice(url: string, options: PlayOptions = {}): Promise<void> {
    const ctx = this.context();
    if (!ctx) return;
    this.stopVoice();
    const token = this.voiceToken;
    const buffer = await this.load(url);
    if (token !== this.voiceToken) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = options.volume ?? 1;
    source.connect(gain).connect(this.gains.get('voice') as GainNode);
    source.start();
    this.voice = source;
  }

  stopVoice(): void {
    this.voiceToken++;
    try {
      this.voice?.stop();
    } catch {
      // déjà arrêtée
    }
    this.voice = null;
  }

  stopAll(): void {
    this.stopBgm(0);
    this.stopVoice();
    this.stopSfx();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.stopAll();
    this.buffers.clear();
    if (this.ctx) await this.ctx.close().catch(() => undefined);
    this.ctx = null;
    this.gains.clear();
  }
}
