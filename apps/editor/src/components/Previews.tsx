import { Item, Picker } from '@adobe/react-spectrum';
import type { AssetMeta } from '@forge/core';
import { useEffect, useRef, useState } from 'react';
import { assetUrl } from '../state/app';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image introuvable : ${url}`));
    img.src = url;
  });
}

/** Aperçu animé d'un charset RPG : les 4 directions marchent en boucle. */
export function CharsetPreview({ asset }: { asset: AssetMeta }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    const fw = Number(asset.info.frameWidth ?? 16);
    const fh = Number(asset.info.frameHeight ?? 24);
    const scale = 4;
    void loadImage(assetUrl(asset)).then((img) => {
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = fw * scale * 4 + 3 * 16;
      canvas.height = fh * scale;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.imageSmoothingEnabled = false;
      const cycle = [0, 1, 2, 1];
      const draw = (t: number) => {
        const frame = cycle[Math.floor(t / 180) % 4] ?? 1;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let dir = 0; dir < 4; dir++) {
          ctx.drawImage(img, frame * fw, dir * fh, fw, fh, dir * (fw * scale + 16), 0, fw * scale, fh * scale);
        }
        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [asset]);
  return <canvas ref={canvasRef} className="fg-pixelated" />;
}

interface Atlas {
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
  animations?: Record<string, string[]>;
}

/** Aperçu d'une planche d'animation 2D (lecture de l'atlas). */
export function SpritesheetPreview({ asset }: { asset: AssetMeta }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [animation, setAnimation] = useState<string>('');
  const atlasPath = asset.extra.atlas;

  useEffect(() => {
    if (!atlasPath) return;
    let cancelled = false;
    void fetch(assetUrl(asset, atlasPath))
      .then((r) => r.json() as Promise<Atlas>)
      .then((a) => {
        if (cancelled) return;
        setAtlas(a);
        setAnimation(Object.keys(a.animations ?? {})[0] ?? '');
      });
    return () => {
      cancelled = true;
    };
  }, [asset, atlasPath]);

  useEffect(() => {
    if (!atlas) return;
    let raf = 0;
    let cancelled = false;
    const names = atlas.animations?.[animation] ?? Object.keys(atlas.frames);
    const fps = Number(asset.info.fps ?? 10);
    void loadImage(assetUrl(asset)).then((img) => {
      const canvas = canvasRef.current;
      if (!canvas || cancelled || names.length === 0) return;
      const first = atlas.frames[names[0] as string]?.frame;
      if (!first) return;
      const scale = Math.max(1, Math.floor(220 / Math.max(first.w, first.h)));
      canvas.width = first.w * scale;
      canvas.height = first.h * scale;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.imageSmoothingEnabled = !asset.info.pixelArt;
      const draw = (t: number) => {
        const f = atlas.frames[names[Math.floor((t / 1000) * fps) % names.length] as string]?.frame;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (f) ctx.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w * scale, f.h * scale);
        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [atlas, animation, asset]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <canvas ref={canvasRef} />
      {atlas?.animations && Object.keys(atlas.animations).length > 1 && (
        <Picker aria-label="Animation" isQuiet selectedKey={animation} onSelectionChange={(k) => setAnimation(String(k))}>
          {Object.keys(atlas.animations).map((name) => (
            <Item key={name}>{name}</Item>
          ))}
        </Picker>
      )}
    </div>
  );
}

interface TilesJson {
  tileSize: number;
  columns: number;
  tiles: { index: number; name: string; passable: boolean }[];
}

/** Aperçu d'un tileset avec le nom et la passabilité de chaque tuile au survol. */
export function TilesetPreview({ asset }: { asset: AssetMeta }) {
  const [tiles, setTiles] = useState<TilesJson | null>(null);
  const [hover, setHover] = useState<string>('');
  useEffect(() => {
    if (!asset.extra.tiles) return;
    let cancelled = false;
    void fetch(assetUrl(asset, asset.extra.tiles))
      .then((r) => r.json() as Promise<TilesJson>)
      .then((t) => {
        if (!cancelled) setTiles(t);
      });
    return () => {
      cancelled = true;
    };
  }, [asset]);
  const size = tiles?.tileSize ?? 16;
  const columns = tiles?.columns ?? 8;
  const scale = 3;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <img
        src={assetUrl(asset)}
        alt={asset.name}
        className="fg-pixelated"
        style={{ width: size * columns * scale, maxWidth: '100%' }}
        onMouseMove={(e) => {
          const rect = (e.target as HTMLImageElement).getBoundingClientRect();
          const cell = (rect.width / columns) | 0;
          const col = Math.floor((e.clientX - rect.left) / cell);
          const row = Math.floor((e.clientY - rect.top) / cell);
          const tile = tiles?.tiles.find((t) => t.index === row * columns + col);
          setHover(tile ? `#${tile.index} ${tile.name} — ${tile.passable ? 'praticable' : 'bloquant'}` : '');
        }}
        onMouseLeave={() => setHover('')}
      />
      <span style={{ fontSize: 12, color: 'var(--fg-text-2)', minHeight: 16 }}>{hover}</span>
    </div>
  );
}

/** Aperçu 3D interactif (orbite, animations) d'un modèle GLB. */
export function ModelPreview({ asset }: { asset: AssetMeta }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<{ playAnimation(name: string | null): void; destroy(): void } | null>(null);
  const [animations, setAnimations] = useState<string[]>([]);
  const [current, setCurrent] = useState<string>('');
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;
    void import('@forge/render3d').then(async ({ createModelViewer }) => {
      if (disposed) return;
      const viewer = createModelViewer(mount);
      viewerRef.current = viewer;
      const { animations: names } = await viewer.load(assetUrl(asset));
      if (disposed) return;
      setAnimations(names);
      const first = names[0] ?? '';
      setCurrent(first);
      if (first) viewer.playAnimation(first);
    });
    return () => {
      disposed = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [asset]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      <div ref={mountRef} style={{ width: '100%', height: 280, borderRadius: 4, overflow: 'hidden', background: '#20242c' }} />
      {animations.length > 0 && (
        <Picker
          aria-label="Animation"
          isQuiet
          selectedKey={current || 'none'}
          onSelectionChange={(k) => {
            const name = k === 'none' ? '' : String(k);
            setCurrent(name);
            viewerRef.current?.playAnimation(name || null);
          }}
        >
          {[<Item key="none">Aucune animation</Item>, ...animations.map((n) => <Item key={n}>{n}</Item>)]}
        </Picker>
      )}
    </div>
  );
}

/** Aperçu adapté au type d'asset. */
export function AssetPreview({ asset }: { asset: AssetMeta }) {
  switch (asset.kind) {
    case 'charset':
      return (
        <div className="fg-preview fg-checker">
          <CharsetPreview asset={asset} />
        </div>
      );
    case 'spritesheet':
      return (
        <div className="fg-preview fg-checker">
          <SpritesheetPreview asset={asset} />
        </div>
      );
    case 'tileset':
      return (
        <div className="fg-preview fg-checker">
          <TilesetPreview asset={asset} />
        </div>
      );
    case 'model':
      return (
        <div className="fg-preview" style={{ minHeight: 0 }}>
          <ModelPreview asset={asset} />
        </div>
      );
    case 'sfx':
    case 'music':
      return (
        <div className="fg-preview" style={{ minHeight: 70, background: 'var(--fg-bg-3)' }}>
          <audio controls src={assetUrl(asset)} style={{ width: '94%' }} loop={asset.kind === 'music'} />
        </div>
      );
    default: {
      const pixel = Boolean(asset.info.pixelArt);
      return (
        <div className="fg-preview fg-checker">
          <img
            src={assetUrl(asset)}
            alt={asset.name}
            className={pixel ? 'fg-pixelated' : undefined}
            style={pixel ? { width: '70%', objectFit: 'contain' } : undefined}
          />
        </div>
      );
    }
  }
}
