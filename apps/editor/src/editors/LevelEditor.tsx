import {
  ActionButton,
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Divider,
  Flex,
  Heading,
  Item,
  NumberField,
  Picker,
  Text,
  TextField,
  ToggleButton,
  Tooltip,
  TooltipTrigger,
} from '@adobe/react-spectrum';
import { PLATFORM_TILE_ROLES, PLATFORM_TILESET_COLUMNS, TILE_SIZE, type AssetMeta, type TileRole } from '@forge/core';
import {
  levelPath,
  PlatformerLevelSchema,
  PlatformerSystemSchema,
  type PlatformerEntity,
  type PlatformerEntityType,
  type PlatformerLevel,
  type PlatformerSystem,
} from '@forge/mode-platformer';
import Add from '@spectrum-icons/workflow/Add';
import ArrowUp from '@spectrum-icons/workflow/ArrowUp';
import Bug from '@spectrum-icons/workflow/Bug';
import Brush from '@spectrum-icons/workflow/Brush';
import ColorFill from '@spectrum-icons/workflow/ColorFill';
import Crosshairs from '@spectrum-icons/workflow/Crosshairs';
import Erase from '@spectrum-icons/workflow/Erase';
import Flag from '@spectrum-icons/workflow/Flag';
import Money from '@spectrum-icons/workflow/Money';
import Note from '@spectrum-icons/workflow/Note';
import PinOn from '@spectrum-icons/workflow/PinOn';
import Play from '@spectrum-icons/workflow/Play';
import Properties from '@spectrum-icons/workflow/Properties';
import Rectangle from '@spectrum-icons/workflow/Rectangle';
import Redo from '@spectrum-icons/workflow/Redo';
import SaveFloppy from '@spectrum-icons/workflow/SaveFloppy';
import Target from '@spectrum-icons/workflow/Target';
import Undo from '@spectrum-icons/workflow/Undo';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { api } from '../api';
import { assetUrl, log, play, toastError, useApp, validateProject } from '../state/app';
import { EntityInspector } from './level/EntityInspector';
import {
  addEntity,
  deleteEntity,
  emptyLevel,
  eraseCell,
  fillRectLayer,
  floodFillLayer,
  layerArray,
  moveEntity,
  paintCell,
  resizeLevel,
  setPlayerStart,
  updateEntity,
  type LevelLayerKey,
} from './level/levelOps';

type PaintTool = 'pencil' | 'rect' | 'fill' | 'eraser' | 'picker';
type EntityTool = `entity:${PlatformerEntityType}`;
type Tool = PaintTool | EntityTool | 'start';

const TILE_PX = TILE_SIZE;
const LAYER_LABELS: Record<LevelLayerKey, string> = { terrain: 'Terrain', decor: 'Décor (visuel)' };
const COLLISION_LABELS: Record<NonNullable<TileRole['collision']>, string> = {
  solid: 'solide',
  oneway: 'traversable par-dessous',
  hazard: 'dangereux',
  none: 'décor',
};
const COLLISION_TINTS: Record<NonNullable<TileRole['collision']>, string> = {
  solid: 'rgba(227,72,80,0.4)',
  oneway: 'rgba(92,160,242,0.4)',
  hazard: 'rgba(230,134,25,0.45)',
  none: '',
};

const ENTITY_TOOLS: { type: PlatformerEntityType; label: string; icon: JSX.Element; glyph: string; color: string }[] = [
  { type: 'coin', label: 'Pièce', icon: <Money />, glyph: '', color: '#ffd24a' },
  { type: 'enemy', label: 'Ennemi', icon: <Bug />, glyph: 'E', color: '#e34850' },
  { type: 'spring', label: 'Ressort', icon: <ArrowUp />, glyph: '', color: '#e68619' },
  { type: 'checkpoint', label: 'Point de contrôle', icon: <PinOn />, glyph: 'C', color: '#2d9d78' },
  { type: 'goal', label: 'Arrivée', icon: <Target />, glyph: 'G', color: '#5ca0f2' },
  { type: 'sign', label: 'Panneau', icon: <Note />, glyph: '?', color: '#9a9a9a' },
];

function useImage(url: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) {
      setImg(null);
      return;
    }
    const image = new Image();
    image.onload = () => setImg(image);
    image.onerror = () => setImg(null);
    image.src = url;
  }, [url]);
  return img;
}

function findAsset(assets: AssetMeta[], ref: string | undefined): AssetMeta | undefined {
  if (!ref) return undefined;
  const lower = ref.trim().toLowerCase();
  return assets.find((a) => a.alias?.toLowerCase() === lower || a.id === ref || a.file === ref);
}

/** Éditeur de niveaux du plateformer : terrain, décor, entités et point de départ du joueur. */
export function LevelEditor({ initialPath }: { initialPath?: string }) {
  const project = useApp((s) => s.project);
  const revisions = useApp((s) => s.fileRevision);
  const [levels, setLevels] = useState<string[]>([]);
  const [path, setPath] = useState<string | null>(initialPath?.endsWith('.json') ? initialPath : null);
  const [level, setLevel] = useState<PlatformerLevel | null>(null);
  const [system, setSystem] = useState<PlatformerSystem | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState<Tool>('pencil');
  const [layer, setLayerKey] = useState<LevelLayerKey>('terrain');
  const [tile, setTile] = useState<number>(0);
  const [zoom, setZoom] = useState(2);
  const [showCollisions, setShowCollisions] = useState(true);
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [paletteHover, setPaletteHover] = useState<{ index: number; clientX: number; clientY: number } | null>(null);
  const [dialog, setDialog] = useState<null | 'new' | 'props'>(null);
  const [tiles, setTiles] = useState<TileRole[]>([...PLATFORM_TILE_ROLES]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paletteRef = useRef<HTMLCanvasElement>(null);
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const drag = useRef<{ start: { x: number; y: number }; moving?: string } | null>(null);
  const [rectPreview, setRectPreview] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const projectId = project?.id ?? '';
  const assets = project?.assets ?? [];

  // Liste des niveaux et système général.
  useEffect(() => {
    if (!projectId) return;
    void api.tree(projectId).then((files) => {
      const list = files.map((f) => f.path).filter((p) => p.startsWith('levels/') && p.endsWith('.json'));
      setLevels(list);
      void api.readJson<unknown>(projectId, 'data/platformer.json').then(
        (raw) => {
          const parsed = PlatformerSystemSchema.safeParse(raw);
          if (!parsed.success) return;
          setSystem(parsed.data);
          const startPath = `levels/${parsed.data.startLevel ?? parsed.data.levels[0]}.json`;
          setPath((current) => current ?? (list.includes(startPath) ? startPath : (list[0] ?? null)));
        },
        () => setPath((current) => current ?? list[0] ?? null),
      );
    }, toastError);
  }, [projectId, revisions['data/platformer.json']]);

  // Chargement du niveau.
  useEffect(() => {
    if (!projectId || !path) return;
    let cancelled = false;
    void api.readJson<unknown>(projectId, path).then((raw) => {
      if (cancelled) return;
      const parsed = PlatformerLevelSchema.safeParse(raw);
      if (!parsed.success) {
        toastError(new Error(`Niveau invalide (${path}) : ${parsed.error.issues[0]?.message ?? ''}`));
        return;
      }
      setLevel(parsed.data);
      setDirty(false);
      setSelectedEntity(null);
      undoStack.current = [];
      redoStack.current = [];
    }, toastError);
    return () => {
      cancelled = true;
    };
  }, [projectId, path]);

  const tilesetAsset = findAsset(assets, level?.tileset);
  const tilesetImg = useImage(tilesetAsset ? assetUrl(tilesetAsset) : null);
  const columns = tilesetImg ? Math.max(1, Math.floor(tilesetImg.width / TILE_PX)) : PLATFORM_TILESET_COLUMNS;

  useEffect(() => {
    if (!tilesetAsset?.extra.tiles) {
      setTiles([...PLATFORM_TILE_ROLES]);
      return;
    }
    void fetch(assetUrl(tilesetAsset, tilesetAsset.extra.tiles))
      .then((r) => r.json() as Promise<{ tiles: TileRole[] }>)
      .then((info) => setTiles(info.tiles?.length ? info.tiles : [...PLATFORM_TILE_ROLES]))
      .catch(() => setTiles([...PLATFORM_TILE_ROLES]));
  }, [tilesetAsset]);

  const roleByIndex = useMemo(() => new Map(tiles.map((t) => [t.index, t])), [tiles]);

  const commit = useCallback((next: PlatformerLevel, snapshot = true) => {
    setLevel((prev) => {
      if (snapshot && prev) {
        undoStack.current.push(JSON.stringify(prev));
        if (undoStack.current.length > 100) undoStack.current.shift();
        redoStack.current = [];
      }
      return next;
    });
    setDirty(true);
  }, []);

  const undo = () => {
    const prev = undoStack.current.pop();
    if (!prev || !level) return;
    redoStack.current.push(JSON.stringify(level));
    setLevel(JSON.parse(prev) as PlatformerLevel);
    setDirty(true);
  };
  const redo = () => {
    const next = redoStack.current.pop();
    if (!next || !level) return;
    undoStack.current.push(JSON.stringify(level));
    setLevel(JSON.parse(next) as PlatformerLevel);
    setDirty(true);
  };

  const save = useCallback(async () => {
    if (!level || !path) return;
    try {
      await api.writeJson(projectId, path, level);
      setDirty(false);
      log('info', 'éditeur', `Niveau ${level.id} enregistré.`);
      void validateProject();
    } catch (error) {
      toastError(error);
    }
  }, [level, path, projectId]);

  // ---------------------------------------------------------------------------
  // Rendu du niveau
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !level) return;
    const ts = TILE_PX * zoom;
    canvas.width = level.width * ts;
    canvas.height = level.height * ts;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = level.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const order: LevelLayerKey[] = ['terrain', 'decor'];
    const editingIndex = order.indexOf(layer);
    order.forEach((name, li) => {
      const values = layerArray(level, name);
      ctx.globalAlpha = editingIndex >= 0 && li > editingIndex ? 0.35 : 1;
      for (let i = 0; i < values.length; i++) {
        const v = values[i] as number;
        if (v < 0) continue;
        const x = (i % level.width) * ts;
        const y = Math.floor(i / level.width) * ts;
        if (tilesetImg) {
          ctx.drawImage(
            tilesetImg,
            (v % columns) * TILE_PX,
            Math.floor(v / columns) * TILE_PX,
            TILE_PX,
            TILE_PX,
            x,
            y,
            ts,
            ts,
          );
        } else {
          ctx.fillStyle = `hsl(${(v * 47) % 360} 35% 35%)`;
          ctx.fillRect(x, y, ts, ts);
        }
      }
    });
    ctx.globalAlpha = 1;

    // Surlignage des collisions (dérivées du rôle de la tuile posée sur « terrain »).
    if (showCollisions) {
      const terrain = layerArray(level, 'terrain');
      for (let i = 0; i < terrain.length; i++) {
        const v = terrain[i] as number;
        if (v < 0) continue;
        const collision = roleByIndex.get(v)?.collision;
        const tint = collision ? COLLISION_TINTS[collision] : '';
        if (!tint) continue;
        const x = (i % level.width) * ts;
        const y = Math.floor(i / level.width) * ts;
        ctx.fillStyle = tint;
        ctx.fillRect(x, y, ts, ts);
      }
    }

    // Grille.
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= level.width; x++) {
      ctx.moveTo(x * ts + 0.5, 0);
      ctx.lineTo(x * ts + 0.5, canvas.height);
    }
    for (let y = 0; y <= level.height; y++) {
      ctx.moveTo(0, y * ts + 0.5);
      ctx.lineTo(canvas.width, y * ts + 0.5);
    }
    ctx.stroke();

    // Entités.
    for (const entity of level.entities) {
      const def = ENTITY_TOOLS.find((t) => t.type === entity.type);
      if (!def) continue;
      const x = entity.x * ts;
      const y = entity.y * ts;
      ctx.fillStyle = def.color;
      if (entity.type === 'coin') {
        ctx.beginPath();
        ctx.arc(x + ts / 2, y + ts / 2, ts * 0.3, 0, Math.PI * 2);
        ctx.fill();
      } else if (entity.type === 'spring') {
        ctx.beginPath();
        ctx.moveTo(x + ts / 2, y + ts * 0.15);
        ctx.lineTo(x + ts * 0.85, y + ts * 0.85);
        ctx.lineTo(x + ts * 0.15, y + ts * 0.85);
        ctx.closePath();
        ctx.fill();
      } else if (entity.type === 'checkpoint' || entity.type === 'goal') {
        ctx.fillRect(x + ts * 0.42, y + ts * 0.15, ts * 0.06, ts * 0.7);
        ctx.beginPath();
        ctx.moveTo(x + ts * 0.48, y + ts * 0.15);
        ctx.lineTo(x + ts * 0.85, y + ts * 0.28);
        ctx.lineTo(x + ts * 0.48, y + ts * 0.42);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(x + ts * 0.2, y + ts * 0.2, ts * 0.6, ts * 0.6);
      }
      if (def.glyph) {
        ctx.fillStyle = '#12141a';
        ctx.font = `bold ${Math.round(ts * 0.4)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(def.glyph, x + ts / 2, y + ts * 0.62);
      }
      ctx.strokeStyle = entity.id === selectedEntity ? '#ffd24a' : 'rgba(255,255,255,0.6)';
      ctx.lineWidth = entity.id === selectedEntity ? 3 : 1;
      ctx.strokeRect(x + 1, y + 1, ts - 2, ts - 2);
    }

    // Point de départ du joueur.
    {
      const x = level.playerStart.x * ts;
      const y = level.playerStart.y * ts;
      ctx.fillStyle = 'rgba(45,157,120,0.85)';
      ctx.beginPath();
      ctx.arc(x + ts / 2, y + ts / 2, ts * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(ts * 0.4)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('S', x + ts / 2, y + ts * 0.64);
    }

    // Survol et aperçu du rectangle.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    if (rectPreview) {
      const x0 = Math.min(rectPreview.x0, rectPreview.x1);
      const y0 = Math.min(rectPreview.y0, rectPreview.y1);
      ctx.strokeRect(
        x0 * ts,
        y0 * ts,
        (Math.abs(rectPreview.x1 - rectPreview.x0) + 1) * ts,
        (Math.abs(rectPreview.y1 - rectPreview.y0) + 1) * ts,
      );
    } else if (hover) {
      ctx.strokeRect(hover.x * ts + 1, hover.y * ts + 1, ts - 2, ts - 2);
    }
  }, [level, zoom, layer, tilesetImg, columns, hover, rectPreview, selectedEntity, showCollisions, roleByIndex]);

  // Palette.
  useEffect(() => {
    const canvas = paletteRef.current;
    if (!canvas || !tilesetImg) return;
    const scale = 2;
    canvas.width = tilesetImg.width * scale;
    canvas.height = tilesetImg.height * scale;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tilesetImg, 0, 0, canvas.width, canvas.height);
    const s = TILE_PX * scale;
    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = 3;
    ctx.strokeRect((tile % columns) * s + 1.5, Math.floor(tile / columns) * s + 1.5, s - 3, s - 3);
  }, [tilesetImg, tile, columns]);

  // ---------------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------------

  const cellAt = (e: React.MouseEvent): { x: number; y: number } | null => {
    if (!level) return null;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const ts = TILE_PX * zoom;
    const x = Math.floor((e.clientX - rect.left) / ts);
    const y = Math.floor((e.clientY - rect.top) / ts);
    return x >= 0 && y >= 0 && x < level.width && y < level.height ? { x, y } : null;
  };

  const entityToolType = (t: Tool): PlatformerEntityType | null =>
    t.startsWith('entity:') ? (t.slice(7) as PlatformerEntityType) : null;

  const onMouseDown = (e: React.MouseEvent) => {
    const cell = cellAt(e);
    if (!cell || !level) return;
    const entType = entityToolType(tool);
    switch (tool) {
      case 'pencil':
      case 'eraser':
        commit(tool === 'pencil' ? paintCell(level, layer, cell, tile) : eraseCell(level, layer, cell));
        drag.current = { start: cell };
        break;
      case 'rect':
        drag.current = { start: cell };
        setRectPreview({ x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y });
        break;
      case 'fill':
        commit(floodFillLayer(level, layer, cell.x, cell.y, tile));
        break;
      case 'picker': {
        const order: LevelLayerKey[] = ['decor', 'terrain'];
        for (const name of order) {
          const v = layerArray(level, name)[cell.y * level.width + cell.x] ?? -1;
          if (v >= 0) {
            setTile(v);
            setTool('pencil');
            break;
          }
        }
        break;
      }
      case 'start':
        commit(setPlayerStart(level, cell));
        break;
      default: {
        if (!entType) break;
        const existing = level.entities.find((ent) => ent.type === entType && ent.x === cell.x && ent.y === cell.y);
        if (existing) {
          setSelectedEntity(existing.id);
          drag.current = { start: cell, moving: existing.id };
        } else {
          const next = addEntity(level, entType, cell);
          commit(next);
          setSelectedEntity((next.entities[next.entities.length - 1] as PlatformerEntity).id);
        }
      }
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const cell = cellAt(e);
    setHover(cell);
    if (!cell || !level || !drag.current || e.buttons !== 1) return;
    if (tool === 'pencil' || tool === 'eraser') {
      const values = layerArray(level, layer);
      if (values[cell.y * level.width + cell.x] !== (tool === 'pencil' ? tile : -1)) {
        commit(tool === 'pencil' ? paintCell(level, layer, cell, tile) : eraseCell(level, layer, cell), false);
      }
    } else if (tool === 'rect') {
      setRectPreview({ x0: drag.current.start.x, y0: drag.current.start.y, x1: cell.x, y1: cell.y });
    } else if (entityToolType(tool) && drag.current.moving) {
      const id = drag.current.moving;
      const ent = level.entities.find((x) => x.id === id);
      if (ent && (ent.x !== cell.x || ent.y !== cell.y)) commit(moveEntity(level, id, cell), false);
    }
  };

  const onMouseUp = () => {
    if (tool === 'rect' && rectPreview && level) {
      commit(fillRectLayer(level, layer, rectPreview.x0, rectPreview.y0, rectPreview.x1, rectPreview.y1, tile));
    }
    setRectPreview(null);
    drag.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    } else if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
    } else if (
      !mod &&
      (e.target as HTMLElement).tagName !== 'INPUT' &&
      (e.target as HTMLElement).tagName !== 'TEXTAREA'
    ) {
      const shortcuts: Record<string, Tool> = { b: 'pencil', r: 'rect', g: 'fill', e: 'eraser', i: 'picker' };
      const next = shortcuts[e.key.toLowerCase()];
      if (next) setTool(next);
    }
  };

  const onPaletteClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const s = rect.width / columns;
    const col = Math.floor((e.clientX - rect.left) / s);
    const row = Math.floor((e.clientY - rect.top) / s);
    setTile(row * columns + col);
    if (tool !== 'rect' && tool !== 'fill') setTool('pencil');
  };

  const onPaletteHover = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const s = rect.width / columns;
    const col = Math.floor((e.clientX - rect.left) / s);
    const row = Math.floor((e.clientY - rect.top) / s);
    setPaletteHover({ index: row * columns + col, clientX: e.clientX, clientY: e.clientY });
  };

  const selected = level?.entities.find((e) => e.id === selectedEntity);
  const tileName = tiles.find((t) => t.index === tile);
  const hoveredRole = paletteHover ? tiles.find((t) => t.index === paletteHover.index) : undefined;
  const paintTools: { key: PaintTool; label: string; icon: JSX.Element }[] = [
    { key: 'pencil', label: 'Crayon (B)', icon: <Brush /> },
    { key: 'rect', label: 'Rectangle (R)', icon: <Rectangle /> },
    { key: 'fill', label: 'Remplissage (G)', icon: <ColorFill /> },
    { key: 'eraser', label: 'Gomme (E)', icon: <Erase /> },
    { key: 'picker', label: 'Pipette (I)', icon: <Crosshairs /> },
  ];
  const tilesetAssets = assets.filter((a) => a.kind === 'tileset' && a.alias);

  if (!project) return null;

  return (
    <div className="fg-panel" tabIndex={-1} onKeyDown={onKeyDown} style={{ outline: 'none' }}>
      <div className="fg-toolbar">
        <Picker
          aria-label="Niveau"
          isQuiet
          selectedKey={path}
          onSelectionChange={(k) => {
            if (dirty && !window.confirm('Modifications non enregistrées. Changer de niveau quand même ?')) return;
            setPath(String(k));
          }}
          width="size-2400"
        >
          {levels.map((m) => {
            const id = m.replace('levels/', '').replace('.json', '');
            return <Item key={m}>{id === system?.startLevel ? `${id} (départ)` : id}</Item>;
          })}
        </Picker>
        <TooltipTrigger>
          <ActionButton isQuiet aria-label="Nouveau niveau" onPress={() => setDialog('new')}>
            <Add />
          </ActionButton>
          <Tooltip>Nouveau niveau</Tooltip>
        </TooltipTrigger>
        <TooltipTrigger>
          <ActionButton
            isQuiet
            aria-label="Propriétés du niveau"
            onPress={() => setDialog('props')}
            isDisabled={!level}
          >
            <Properties />
          </ActionButton>
          <Tooltip>Propriétés du niveau</Tooltip>
        </TooltipTrigger>
        <Divider orientation="vertical" size="S" />
        {paintTools.map((t) => (
          <TooltipTrigger key={t.key}>
            <ToggleButton isQuiet isSelected={tool === t.key} onChange={() => setTool(t.key)} aria-label={t.label}>
              {t.icon}
            </ToggleButton>
            <Tooltip>{t.label}</Tooltip>
          </TooltipTrigger>
        ))}
        <Divider orientation="vertical" size="S" />
        {ENTITY_TOOLS.map((t) => (
          <TooltipTrigger key={t.type}>
            <ToggleButton
              isQuiet
              isSelected={tool === `entity:${t.type}`}
              onChange={() => setTool(`entity:${t.type}`)}
              aria-label={t.label}
            >
              {t.icon}
            </ToggleButton>
            <Tooltip>{t.label}</Tooltip>
          </TooltipTrigger>
        ))}
        <TooltipTrigger>
          <ToggleButton
            isQuiet
            isSelected={tool === 'start'}
            onChange={() => setTool('start')}
            aria-label="Départ du joueur"
          >
            <Flag />
          </ToggleButton>
          <Tooltip>Départ du joueur</Tooltip>
        </TooltipTrigger>
        <Divider orientation="vertical" size="S" />
        <Picker
          aria-label="Calque"
          isQuiet
          selectedKey={layer}
          onSelectionChange={(k) => setLayerKey(k as LevelLayerKey)}
          width="size-2000"
        >
          {(Object.keys(LAYER_LABELS) as LevelLayerKey[]).map((k) => (
            <Item key={k}>{`Calque : ${LAYER_LABELS[k]}`}</Item>
          ))}
        </Picker>
        <ToggleButton isQuiet isSelected={showCollisions} onChange={setShowCollisions}>
          Collisions
        </ToggleButton>
        <Picker
          aria-label="Zoom"
          isQuiet
          selectedKey={String(zoom)}
          onSelectionChange={(k) => setZoom(Number(k))}
          width="size-1200"
        >
          <Item key="1">×1</Item>
          <Item key="2">×2</Item>
          <Item key="3">×3</Item>
          <Item key="4">×4</Item>
        </Picker>
        <ActionButton isQuiet aria-label="Annuler" onPress={undo}>
          <Undo />
        </ActionButton>
        <ActionButton isQuiet aria-label="Rétablir" onPress={redo}>
          <Redo />
        </ActionButton>
        <div className="fg-spacer" />
        <span style={{ fontSize: 12, color: 'var(--fg-text-3)' }}>
          {hover && level ? `(${hover.x}, ${hover.y})` : ''}
        </span>
        <ActionButton onPress={() => void save()} isDisabled={!dirty}>
          <SaveFloppy />
          <Text>Enregistrer{dirty ? ' •' : ''}</Text>
        </ActionButton>
        <Button
          variant="accent"
          isDisabled={!level}
          onPress={() => void save().then(() => play({ startLevel: level!.id, skipTitle: true }))}
        >
          <Play />
          <Text>Jouer ce niveau</Text>
        </Button>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div className="fg-map-canvas-wrap">
          {level ? (
            <canvas
              ref={canvasRef}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={() => {
                setHover(null);
                onMouseUp();
              }}
              style={{ cursor: entityToolType(tool) ? 'pointer' : 'crosshair' }}
            />
          ) : (
            <div className="fg-empty">{levels.length ? 'Chargement…' : 'Aucun niveau. Créez-en un avec « + ».'}</div>
          )}
        </div>
        <aside
          style={{
            width: 330,
            borderLeft: '1px solid var(--fg-bg-0)',
            overflow: 'auto',
            background: 'var(--fg-bg-1)',
            padding: 10,
          }}
        >
          {entityToolType(tool) && selected ? (
            <EntityInspector
              key={selected.id}
              entity={selected}
              onChange={(entity) => level && commit(updateEntity(level, entity))}
              onDelete={() => {
                if (!level) return;
                commit(deleteEntity(level, selected.id));
                setSelectedEntity(null);
              }}
            />
          ) : (
            <Flex direction="column" gap="size-100" UNSAFE_style={{ position: 'relative' }}>
              <div className="fg-section-title" style={{ margin: 0 }}>
                Tuiles — {tilesetAsset?.name ?? level?.tileset ?? '—'}
              </div>
              {tilesetImg ? (
                <canvas
                  ref={paletteRef}
                  className="fg-tile-palette"
                  onClick={onPaletteClick}
                  onMouseMove={onPaletteHover}
                  onMouseLeave={() => setPaletteHover(null)}
                  style={{ width: '100%' }}
                />
              ) : (
                <p style={{ fontSize: 12, color: 'var(--fg-warn)' }}>
                  Tileset introuvable : vérifiez l'alias dans les propriétés du niveau.
                </p>
              )}
              {paletteHover && hoveredRole && (
                <div
                  style={{
                    position: 'fixed',
                    left: paletteHover.clientX + 12,
                    top: paletteHover.clientY + 12,
                    background: 'var(--fg-bg-4)',
                    color: 'var(--fg-text-1, #fff)',
                    padding: '4px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    pointerEvents: 'none',
                    zIndex: 10,
                  }}
                >
                  {hoveredRole.name} · {hoveredRole.collision ? COLLISION_LABELS[hoveredRole.collision] : '—'}
                </div>
              )}
              <span style={{ fontSize: 12, color: 'var(--fg-text-2)' }}>
                Tuile #{tile} : {tileName?.name ?? '—'}
                {tileName?.collision ? ` · ${COLLISION_LABELS[tileName.collision]}` : ''}
              </span>
              <p style={{ fontSize: 11, color: 'var(--fg-text-3)', margin: 0 }}>
                Astuce : le calque « Décor » est purement visuel (dessiné derrière le joueur, sans collision). Les
                outils d'entités placent pièces, ennemis, ressorts, points de contrôle, arrivée et panneaux ; glissez
                pour les déplacer. L'option « Collisions » surligne les tuiles de terrain selon leur rôle.
              </p>
            </Flex>
          )}
        </aside>
      </div>
      <DialogContainer onDismiss={() => setDialog(null)}>
        {dialog === 'new' && (
          <NewLevelDialog
            initialId={nextLevelId(levels)}
            tilesets={tilesetAssets}
            onSubmit={async (values) => {
              const created = emptyLevel(values.id, values.name, values.width, values.height, values.tileset);
              const file = levelPath(values.id);
              await api.writeJson(projectId, file, created);
              setLevels((m) => [...m, file].sort());
              setPath(file);
              setDialog(null);
            }}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'props' && level && (
          <LevelPropsDialog
            level={level}
            tilesets={tilesetAssets}
            musics={assets.filter((a) => a.kind === 'music' && a.alias)}
            backgrounds={assets.filter((a) => a.kind === 'image' && a.alias)}
            onSubmit={async (next) => {
              commit(next);
              setDialog(null);
            }}
            onClose={() => setDialog(null)}
          />
        )}
      </DialogContainer>
    </div>
  );
}

function nextLevelId(levels: string[]): string {
  let n = levels.length + 1;
  while (levels.includes(`levels/level${String(n).padStart(3, '0')}.json`)) n++;
  return `level${String(n).padStart(3, '0')}`;
}

interface NewLevelValues {
  id: string;
  name: string;
  width: number;
  height: number;
  tileset: string;
}

/** Dialogue de création : filtre les tilesets « vue de côté » quand l'info est accessible. */
function NewLevelDialog(props: {
  initialId: string;
  tilesets: AssetMeta[];
  onSubmit(values: NewLevelValues): Promise<void>;
  onClose(): void;
}) {
  const [values, setValues] = useState<NewLevelValues>({
    id: props.initialId,
    name: 'Nouveau niveau',
    width: 40,
    height: 14,
    tileset: props.tilesets[0]?.alias ?? '',
  });
  const set = (patch: Partial<NewLevelValues>) => setValues((v) => ({ ...v, ...patch }));
  const [layouts, setLayouts] = useState<Record<string, 'side' | 'topdown' | undefined>>({});

  // Récupère le fichier `extra.tiles` de chaque tileset pour connaître sa disposition (`layout`),
  // en best-effort : si l'info n'est pas accessible pour un tileset, il reste dans la liste
  // complète (repli) plutôt que d'être exclu à tort.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      props.tilesets.map(async (asset) => {
        if (!asset.extra.tiles) return [asset.alias ?? asset.id, undefined] as const;
        try {
          const res = await fetch(assetUrl(asset, asset.extra.tiles)).catch(() => null);
          if (!res || !res.ok) return [asset.alias ?? asset.id, undefined] as const;
          const info = (await res.json()) as { layout?: 'topdown' | 'side' };
          return [asset.alias ?? asset.id, info.layout] as const;
        } catch {
          return [asset.alias ?? asset.id, undefined] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setLayouts(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [props.tilesets]);

  const knownSide = props.tilesets.filter((t) => layouts[t.alias ?? t.id] === 'side');
  const options = knownSide.length ? knownSide : props.tilesets;

  return (
    <Dialog size="M">
      <Heading>Nouveau niveau</Heading>
      <Divider />
      <Content>
        <Flex direction="column" gap="size-100">
          <Flex gap="size-100">
            <TextField
              label="Identifiant"
              value={values.id}
              onChange={(id) => set({ id: id.replace(/[^a-z0-9_-]/gi, '') })}
              flex
            />
            <TextField label="Nom" value={values.name} onChange={(name) => set({ name })} flex />
          </Flex>
          <Flex gap="size-100">
            <NumberField
              label="Largeur (cases)"
              value={values.width}
              minValue={10}
              maxValue={1024}
              onChange={(width) => set({ width })}
              flex
            />
            <NumberField
              label="Hauteur (cases)"
              value={values.height}
              minValue={6}
              maxValue={256}
              onChange={(height) => set({ height })}
              flex
            />
          </Flex>
          <Picker
            label="Tileset (alias)"
            selectedKey={values.tileset}
            onSelectionChange={(k) => set({ tileset: String(k) })}
          >
            {options.map((t) => (
              <Item key={t.alias!}>{`${t.alias} — ${t.name}`}</Item>
            ))}
          </Picker>
        </Flex>
      </Content>
      <ButtonGroup>
        <Button variant="secondary" onPress={props.onClose}>
          Annuler
        </Button>
        <Button
          variant="accent"
          onPress={() => void props.onSubmit(values).catch(toastError)}
          isDisabled={!values.id || !values.tileset}
        >
          Valider
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}

function LevelPropsDialog(props: {
  level: PlatformerLevel;
  tilesets: AssetMeta[];
  musics: AssetMeta[];
  backgrounds: AssetMeta[];
  onSubmit(next: PlatformerLevel): Promise<void>;
  onClose(): void;
}) {
  const { level } = props;
  const [values, setValues] = useState({
    name: level.name,
    width: level.width,
    height: level.height,
    tileset: level.tileset,
    music: level.music,
    background: level.background,
    backgroundColor: level.backgroundColor,
    next: level.next ?? '',
    timeLimit: level.timeLimit,
  });
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));
  const colorValid = /^#[0-9a-fA-F]{6}$/.test(values.backgroundColor);

  return (
    <Dialog size="M">
      <Heading>Propriétés du niveau</Heading>
      <Divider />
      <Content>
        <Flex direction="column" gap="size-100">
          <Flex gap="size-100">
            <TextField label="Identifiant" value={level.id} isReadOnly flex />
            <TextField label="Nom" value={values.name} onChange={(name) => set({ name })} flex />
          </Flex>
          <Flex gap="size-100">
            <NumberField
              label="Largeur (cases)"
              value={values.width}
              minValue={10}
              maxValue={1024}
              onChange={(width) => set({ width })}
              flex
            />
            <NumberField
              label="Hauteur (cases)"
              value={values.height}
              minValue={6}
              maxValue={256}
              onChange={(height) => set({ height })}
              flex
            />
          </Flex>
          <Picker
            label="Tileset (alias)"
            selectedKey={values.tileset}
            onSelectionChange={(k) => set({ tileset: String(k) })}
          >
            {props.tilesets.map((t) => (
              <Item key={t.alias!}>{`${t.alias} — ${t.name}`}</Item>
            ))}
          </Picker>
          <Picker
            label="Musique"
            selectedKey={values.music ?? 'none'}
            onSelectionChange={(k) => set({ music: k === 'none' ? undefined : String(k) })}
          >
            {[
              <Item key="none">Musique par défaut</Item>,
              ...props.musics.map((m) => <Item key={m.alias!}>{m.alias!}</Item>),
            ]}
          </Picker>
          <Picker
            label="Fond (parallaxe)"
            selectedKey={values.background ?? 'none'}
            onSelectionChange={(k) => set({ background: k === 'none' ? undefined : String(k) })}
          >
            {[
              <Item key="none">Couleur unie</Item>,
              ...props.backgrounds.map((b) => <Item key={b.alias!}>{b.alias!}</Item>),
            ]}
          </Picker>
          <TextField
            label="Couleur de fond (#RRGGBB)"
            value={values.backgroundColor}
            onChange={(backgroundColor) => set({ backgroundColor })}
            validationState={colorValid ? undefined : 'invalid'}
          />
          <Flex gap="size-100">
            <TextField
              label="Niveau suivant (id, optionnel)"
              value={values.next}
              onChange={(next) => set({ next })}
              flex
            />
            <NumberField
              label="Temps limite (s, optionnel)"
              value={values.timeLimit ?? 0}
              minValue={0}
              onChange={(timeLimit) => set({ timeLimit: timeLimit || undefined })}
              flex
            />
          </Flex>
        </Flex>
      </Content>
      <ButtonGroup>
        <Button variant="secondary" onPress={props.onClose}>
          Annuler
        </Button>
        <Button
          variant="accent"
          isDisabled={!values.tileset || !colorValid}
          onPress={() => {
            const next: PlatformerLevel =
              level.width !== values.width || level.height !== values.height
                ? resizeLevel(level, values.width, values.height)
                : level;
            void props
              .onSubmit({
                ...next,
                name: values.name,
                tileset: values.tileset,
                music: values.music,
                background: values.background,
                backgroundColor: values.backgroundColor,
                next: values.next.trim() || undefined,
                timeLimit: values.timeLimit || undefined,
              })
              .catch(toastError);
          }}
        >
          Valider
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}
