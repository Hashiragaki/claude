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
import { TILE, TILE_ROLES, TILESET_COLUMNS, type AssetMeta, type TileRole } from '@forge/core';
import { RpgMapSchema, RpgSystemSchema, type RpgEvent, type RpgMap, type RpgSystem } from '@forge/mode-rpg';
import Add from '@spectrum-icons/workflow/Add';
import Brush from '@spectrum-icons/workflow/Brush';
import ColorFill from '@spectrum-icons/workflow/ColorFill';
import Erase from '@spectrum-icons/workflow/Erase';
import Event from '@spectrum-icons/workflow/Event';
import Flag from '@spectrum-icons/workflow/Flag';
import Play from '@spectrum-icons/workflow/Play';
import Properties from '@spectrum-icons/workflow/Properties';
import Rectangle from '@spectrum-icons/workflow/Rectangle';
import Redo from '@spectrum-icons/workflow/Redo';
import SaveFloppy from '@spectrum-icons/workflow/SaveFloppy';
import Undo from '@spectrum-icons/workflow/Undo';
import Crosshairs from '@spectrum-icons/workflow/Crosshairs';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { api } from '../api';
import { assetUrl, log, play, toastError, useApp, validateProject } from '../state/app';
import { EventInspector, newPage } from './map/EventInspector';
import { emptyMap, fillRect, floodFill, layerArray, resizeMap, setLayer, type LayerKey } from './map/mapOps';

type Tool = 'pencil' | 'rect' | 'fill' | 'eraser' | 'picker' | 'event' | 'start';

const TILE_PX = 16;
const LAYER_LABELS: Record<LayerKey, string> = {
  ground: 'Sol',
  decor: 'Décor',
  overhead: 'Au-dessus (feuillages, toits)',
  collision: 'Collisions',
};

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

/** Éditeur de cartes RPG : calques de tuiles, collisions, événements et point de départ. */
export function MapEditor({ initialPath }: { initialPath?: string }) {
  const project = useApp((s) => s.project);
  const revisions = useApp((s) => s.fileRevision);
  const [maps, setMaps] = useState<string[]>([]);
  const [path, setPath] = useState<string | null>(initialPath?.endsWith('.json') ? initialPath : null);
  const [map, setMap] = useState<RpgMap | null>(null);
  const [system, setSystem] = useState<RpgSystem | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState<Tool>('pencil');
  const [layer, setLayerKey] = useState<LayerKey>('ground');
  const [tile, setTile] = useState<number>(TILE.ground);
  const [collisionBrush, setCollisionBrush] = useState(1);
  const [zoom, setZoom] = useState(2);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [lastCell, setLastCell] = useState<{ x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<null | 'new' | 'props'>(null);
  const [tiles, setTiles] = useState<TileRole[]>([...TILE_ROLES]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paletteRef = useRef<HTMLCanvasElement>(null);
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const drag = useRef<{ start: { x: number; y: number }; moving?: string } | null>(null);
  const [rectPreview, setRectPreview] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [charsetImages, setCharsetImages] = useState<Record<string, HTMLImageElement>>({});

  const projectId = project?.id ?? '';
  const assets = project?.assets ?? [];

  // Liste des cartes et système.
  useEffect(() => {
    if (!projectId) return;
    void api.tree(projectId).then((files) => {
      const list = files.map((f) => f.path).filter((p) => p.startsWith('maps/') && p.endsWith('.json'));
      setMaps(list);
      void api.readJson<unknown>(projectId, project?.entry ?? 'data/system.json').then(
        (raw) => {
          const sys = RpgSystemSchema.parse(raw);
          setSystem(sys);
          setPath(
            (current) =>
              current ?? (list.includes(`maps/${sys.startMap}.json`) ? `maps/${sys.startMap}.json` : (list[0] ?? null)),
          );
        },
        () => setPath((current) => current ?? list[0] ?? null),
      );
    }, toastError);
  }, [projectId, project?.entry, revisions['data/system.json']]);

  // Chargement de la carte.
  useEffect(() => {
    if (!projectId || !path) return;
    let cancelled = false;
    void api.readJson<unknown>(projectId, path).then((raw) => {
      if (cancelled) return;
      const parsed = RpgMapSchema.safeParse(raw);
      if (!parsed.success) {
        toastError(new Error(`Carte invalide (${path}) : ${parsed.error.issues[0]?.message ?? ''}`));
        return;
      }
      setMap(parsed.data);
      setDirty(false);
      setSelectedEvent(null);
      undoStack.current = [];
      redoStack.current = [];
    }, toastError);
    return () => {
      cancelled = true;
    };
  }, [projectId, path]);

  const tilesetAsset = findAsset(assets, map?.tileset);
  const tilesetImg = useImage(tilesetAsset ? assetUrl(tilesetAsset) : null);
  const columns = tilesetImg ? Math.max(1, Math.floor(tilesetImg.width / TILE_PX)) : TILESET_COLUMNS;

  useEffect(() => {
    if (!tilesetAsset?.extra.tiles) {
      setTiles([...TILE_ROLES]);
      return;
    }
    void fetch(assetUrl(tilesetAsset, tilesetAsset.extra.tiles))
      .then((r) => r.json() as Promise<{ tiles: TileRole[] }>)
      .then((info) => setTiles(info.tiles?.length ? info.tiles : [...TILE_ROLES]))
      .catch(() => setTiles([...TILE_ROLES]));
  }, [tilesetAsset]);

  // Images des charsets utilisés par les événements.
  useEffect(() => {
    if (!map) return;
    const refs = new Set<string>();
    for (const e of map.events)
      for (const p of e.pages) if (p.graphic && 'charset' in p.graphic) refs.add(p.graphic.charset);
    for (const ref of refs) {
      if (charsetImages[ref]) continue;
      const asset = findAsset(assets, ref);
      if (!asset) continue;
      const img = new Image();
      img.onload = () => setCharsetImages((prev) => ({ ...prev, [ref]: img }));
      img.src = assetUrl(asset);
    }
  }, [map, assets, charsetImages]);

  const passable = useMemo(() => new Map(tiles.map((t) => [t.index, t])), [tiles]);

  const commit = useCallback((next: RpgMap, snapshot = true) => {
    setMap((prev) => {
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
    if (!prev || !map) return;
    redoStack.current.push(JSON.stringify(map));
    setMap(JSON.parse(prev) as RpgMap);
    setDirty(true);
  };
  const redo = () => {
    const next = redoStack.current.pop();
    if (!next || !map) return;
    undoStack.current.push(JSON.stringify(map));
    setMap(JSON.parse(next) as RpgMap);
    setDirty(true);
  };

  const save = useCallback(async () => {
    if (!map || !path) return;
    try {
      await api.writeJson(projectId, path, map);
      setDirty(false);
      log('info', 'éditeur', `Carte ${map.id} enregistrée.`);
      void validateProject();
    } catch (error) {
      toastError(error);
    }
  }, [map, path, projectId]);

  // ---------------------------------------------------------------------------
  // Rendu de la carte
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map) return;
    const ts = TILE_PX * zoom;
    canvas.width = map.width * ts;
    canvas.height = map.height * ts;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#16181c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const order: LayerKey[] = ['ground', 'decor', 'overhead'];
    const editingIndex = order.indexOf(layer);
    order.forEach((name, li) => {
      const values = layerArray(map, name);
      ctx.globalAlpha = editingIndex >= 0 && li > editingIndex ? 0.35 : 1;
      for (let i = 0; i < values.length; i++) {
        const v = values[i] as number;
        if (v < 0) continue;
        const x = (i % map.width) * ts;
        const y = Math.floor(i / map.width) * ts;
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

    if (layer === 'collision') {
      const overrides = layerArray(map, 'collision');
      const ground = layerArray(map, 'ground');
      const decor = layerArray(map, 'decor');
      for (let i = 0; i < overrides.length; i++) {
        const o = overrides[i] as number;
        const blocked =
          o === 1 ||
          (o === 0 &&
            [ground[i], decor[i]].some((v) => v !== undefined && v >= 0 && passable.get(v)?.passable === false));
        const x = (i % map.width) * ts;
        const y = Math.floor(i / map.width) * ts;
        if (o === 2) {
          ctx.fillStyle = 'rgba(45,157,120,0.45)';
          ctx.fillRect(x, y, ts, ts);
        } else if (blocked) {
          ctx.fillStyle = o === 1 ? 'rgba(227,72,80,0.6)' : 'rgba(227,72,80,0.28)';
          ctx.fillRect(x, y, ts, ts);
        }
      }
    }

    // Grille.
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= map.width; x++) {
      ctx.moveTo(x * ts + 0.5, 0);
      ctx.lineTo(x * ts + 0.5, canvas.height);
    }
    for (let y = 0; y <= map.height; y++) {
      ctx.moveTo(0, y * ts + 0.5);
      ctx.lineTo(canvas.width, y * ts + 0.5);
    }
    ctx.stroke();

    // Événements.
    for (const event of map.events) {
      const page = event.pages[0];
      const x = event.x * ts;
      const y = event.y * ts;
      const graphic = page?.graphic;
      if (graphic && 'charset' in graphic && charsetImages[graphic.charset]) {
        const img = charsetImages[graphic.charset] as HTMLImageElement;
        const fw = img.width / 3;
        const fh = img.height / 4;
        const row = ['down', 'left', 'right', 'up'].indexOf(graphic.direction ?? 'down');
        const w = (fw / TILE_PX) * ts;
        const h = (fh / TILE_PX) * ts;
        ctx.drawImage(img, fw, Math.max(0, row) * fh, fw, fh, x + (ts - w) / 2, y + ts - h, w, h);
      } else if (graphic && 'tile' in graphic && tilesetImg) {
        const v = graphic.tile;
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
      }
      ctx.strokeStyle = event.id === selectedEvent ? '#ffd24a' : 'rgba(92,160,242,0.9)';
      ctx.lineWidth = event.id === selectedEvent ? 3 : 2;
      ctx.strokeRect(x + 2, y + 2, ts - 4, ts - 4);
      if (!graphic) {
        ctx.fillStyle = 'rgba(92,160,242,0.9)';
        ctx.font = `bold ${Math.round(ts * 0.45)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('E', x + ts / 2, y + ts * 0.66);
      }
    }

    // Point de départ.
    if (system && system.startMap === map.id) {
      const x = system.startX * ts;
      const y = system.startY * ts;
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
  }, [map, zoom, layer, tilesetImg, columns, hover, rectPreview, selectedEvent, system, charsetImages, passable]);

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
    if (!map) return null;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const ts = TILE_PX * zoom;
    const x = Math.floor((e.clientX - rect.left) / ts);
    const y = Math.floor((e.clientY - rect.top) / ts);
    return x >= 0 && y >= 0 && x < map.width && y < map.height ? { x, y } : null;
  };

  const paint = (current: RpgMap, cell: { x: number; y: number }, value: number): RpgMap => {
    const values = layerArray(current, layer);
    values[cell.y * current.width + cell.x] = value;
    return setLayer(current, layer, values);
  };

  const brushValue = () => (layer === 'collision' ? collisionBrush : tile);
  const emptyValue = () => (layer === 'collision' ? 0 : -1);

  const onMouseDown = (e: React.MouseEvent) => {
    const cell = cellAt(e);
    if (!cell || !map) return;
    setLastCell(cell);
    switch (tool) {
      case 'pencil':
      case 'eraser':
        commit(paint(map, cell, tool === 'pencil' ? brushValue() : emptyValue()));
        drag.current = { start: cell };
        break;
      case 'rect':
        drag.current = { start: cell };
        setRectPreview({ x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y });
        break;
      case 'fill':
        commit(
          setLayer(map, layer, floodFill(layerArray(map, layer), map.width, map.height, cell.x, cell.y, brushValue())),
        );
        break;
      case 'picker': {
        if (layer === 'collision') break;
        const order: LayerKey[] = ['overhead', 'decor', 'ground'];
        for (const name of [layer, ...order]) {
          const v = layerArray(map, name)[cell.y * map.width + cell.x] ?? -1;
          if (v >= 0) {
            setTile(v);
            setTool('pencil');
            break;
          }
        }
        break;
      }
      case 'event': {
        const existing = map.events.find((ev) => ev.x === cell.x && ev.y === cell.y);
        if (existing) {
          setSelectedEvent(existing.id);
          drag.current = { start: cell, moving: existing.id };
        } else {
          let n = map.events.length + 1;
          while (map.events.some((ev) => ev.id === `ev${n}`)) n++;
          const event: RpgEvent = {
            id: `ev${n}`,
            name: `Événement ${n}`,
            x: cell.x,
            y: cell.y,
            pages: [{ ...newPage(), commands: [{ type: 'text', text: '…' }] }],
          };
          commit({ ...map, events: [...map.events, event] });
          setSelectedEvent(event.id);
        }
        break;
      }
      case 'start': {
        const base = system ?? RpgSystemSchema.parse({ startMap: map.id });
        const next = { ...base, startMap: map.id, startX: cell.x, startY: cell.y };
        setSystem(next);
        void api
          .writeJson(projectId, project?.entry ?? 'data/system.json', next)
          .then(() => log('info', 'éditeur', `Point de départ : ${map.id} (${cell.x}, ${cell.y}).`))
          .catch(toastError);
        break;
      }
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const cell = cellAt(e);
    setHover(cell);
    if (!cell || !map || !drag.current || e.buttons !== 1) return;
    if (tool === 'pencil' || tool === 'eraser') {
      const values = layerArray(map, layer);
      const value = tool === 'pencil' ? brushValue() : emptyValue();
      if (values[cell.y * map.width + cell.x] !== value) commit(paint(map, cell, value), false);
    } else if (tool === 'rect') {
      setRectPreview({ x0: drag.current.start.x, y0: drag.current.start.y, x1: cell.x, y1: cell.y });
    } else if (tool === 'event' && drag.current.moving) {
      const id = drag.current.moving;
      const occupied = map.events.some((ev) => ev.id !== id && ev.x === cell.x && ev.y === cell.y);
      const ev = map.events.find((x) => x.id === id);
      if (ev && !occupied && (ev.x !== cell.x || ev.y !== cell.y)) {
        commit({ ...map, events: map.events.map((x) => (x.id === id ? { ...x, x: cell.x, y: cell.y } : x)) }, false);
      }
    }
  };

  const onMouseUp = () => {
    if (tool === 'rect' && rectPreview && map) {
      commit(
        setLayer(
          map,
          layer,
          fillRect(
            layerArray(map, layer),
            map.width,
            rectPreview.x0,
            rectPreview.y0,
            rectPreview.x1,
            rectPreview.y1,
            brushValue(),
          ),
        ),
      );
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
      const shortcuts: Record<string, Tool> = {
        b: 'pencil',
        r: 'rect',
        g: 'fill',
        e: 'eraser',
        i: 'picker',
        v: 'event',
      };
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

  const selected = map?.events.find((e) => e.id === selectedEvent);
  const tileName = tiles.find((t) => t.index === tile);
  const tools: { key: Tool; label: string; icon: JSX.Element }[] = [
    { key: 'pencil', label: 'Crayon (B)', icon: <Brush /> },
    { key: 'rect', label: 'Rectangle (R)', icon: <Rectangle /> },
    { key: 'fill', label: 'Remplissage (G)', icon: <ColorFill /> },
    { key: 'eraser', label: 'Gomme (E)', icon: <Erase /> },
    { key: 'picker', label: 'Pipette (I)', icon: <Crosshairs /> },
    { key: 'event', label: 'Événements (V)', icon: <Event /> },
    { key: 'start', label: 'Point de départ du joueur', icon: <Flag /> },
  ];
  const tilesetAssets = assets.filter((a) => a.kind === 'tileset' && a.alias);

  if (!project) return null;

  return (
    <div className="fg-panel" tabIndex={-1} onKeyDown={onKeyDown} style={{ outline: 'none' }}>
      <div className="fg-toolbar">
        <Picker
          aria-label="Carte"
          isQuiet
          selectedKey={path}
          onSelectionChange={(k) => {
            if (dirty && !window.confirm('Modifications non enregistrées. Changer de carte quand même ?')) return;
            setPath(String(k));
          }}
          width="size-2400"
        >
          {maps.map((m) => (
            <Item key={m}>{m.replace('maps/', '').replace('.json', '')}</Item>
          ))}
        </Picker>
        <TooltipTrigger>
          <ActionButton isQuiet aria-label="Nouvelle carte" onPress={() => setDialog('new')}>
            <Add />
          </ActionButton>
          <Tooltip>Nouvelle carte</Tooltip>
        </TooltipTrigger>
        <TooltipTrigger>
          <ActionButton
            isQuiet
            aria-label="Propriétés de la carte"
            onPress={() => setDialog('props')}
            isDisabled={!map}
          >
            <Properties />
          </ActionButton>
          <Tooltip>Propriétés de la carte</Tooltip>
        </TooltipTrigger>
        <Divider orientation="vertical" size="S" />
        {tools.map((t) => (
          <TooltipTrigger key={t.key}>
            <ToggleButton isQuiet isSelected={tool === t.key} onChange={() => setTool(t.key)} aria-label={t.label}>
              {t.icon}
            </ToggleButton>
            <Tooltip>{t.label}</Tooltip>
          </TooltipTrigger>
        ))}
        <Divider orientation="vertical" size="S" />
        <Picker
          aria-label="Calque"
          isQuiet
          selectedKey={layer}
          onSelectionChange={(k) => setLayerKey(k as LayerKey)}
          width="size-2400"
        >
          {(Object.keys(LAYER_LABELS) as LayerKey[]).map((k) => (
            <Item key={k}>{`Calque : ${LAYER_LABELS[k]}`}</Item>
          ))}
        </Picker>
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
          {hover && map ? `(${hover.x}, ${hover.y})` : ''}
        </span>
        <ActionButton onPress={() => void save()} isDisabled={!dirty}>
          <SaveFloppy />
          <Text>Enregistrer{dirty ? ' •' : ''}</Text>
        </ActionButton>
        <Button
          variant="accent"
          isDisabled={!map}
          onPress={() =>
            void save().then(() =>
              play({ startMap: map!.id, startX: lastCell?.x, startY: lastCell?.y, skipTitle: true }),
            )
          }
        >
          <Play />
          <Text>Jouer ici</Text>
        </Button>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div className="fg-map-canvas-wrap">
          {map ? (
            <canvas
              ref={canvasRef}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={() => {
                setHover(null);
                onMouseUp();
              }}
              style={{ cursor: tool === 'event' ? 'pointer' : 'crosshair' }}
            />
          ) : (
            <div className="fg-empty">{maps.length ? 'Chargement…' : 'Aucune carte. Créez-en une avec « + ».'}</div>
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
          {tool === 'event' && selected ? (
            <EventInspector
              key={selected.id}
              event={selected}
              onChange={(event) =>
                map && commit({ ...map, events: map.events.map((e) => (e.id === event.id ? event : e)) })
              }
              onDelete={() => {
                if (!map) return;
                commit({ ...map, events: map.events.filter((e) => e.id !== selected.id) });
                setSelectedEvent(null);
              }}
            />
          ) : layer === 'collision' ? (
            <Flex direction="column" gap="size-100">
              <div className="fg-section-title" style={{ margin: 0 }}>
                Collisions
              </div>
              <p style={{ fontSize: 12, color: 'var(--fg-text-2)', margin: 0 }}>
                Par défaut, la praticabilité vient des tuiles (rouge pâle = bloquant). Vous pouvez la forcer case par
                case.
              </p>
              {[
                [1, 'Bloquer'],
                [2, 'Forcer le passage'],
                [0, 'Automatique (selon les tuiles)'],
              ].map(([value, label]) => (
                <ToggleButton
                  key={String(value)}
                  isSelected={collisionBrush === value}
                  onChange={() => setCollisionBrush(value as number)}
                >
                  {label as string}
                </ToggleButton>
              ))}
            </Flex>
          ) : (
            <Flex direction="column" gap="size-100">
              <div className="fg-section-title" style={{ margin: 0 }}>
                Tuiles — {tilesetAsset?.name ?? map?.tileset ?? '—'}
              </div>
              {tilesetImg ? (
                <canvas
                  ref={paletteRef}
                  className="fg-tile-palette"
                  onClick={onPaletteClick}
                  style={{ width: '100%' }}
                />
              ) : (
                <p style={{ fontSize: 12, color: 'var(--fg-warn)' }}>
                  Tileset introuvable : vérifiez l'alias dans les propriétés de la carte.
                </p>
              )}
              <span style={{ fontSize: 12, color: 'var(--fg-text-2)' }}>
                Tuile #{tile} : {tileName?.name ?? '—'}{' '}
                {tileName ? (tileName.passable ? '· praticable' : '· bloquante') : ''}
                {tileName && tileName.layer !== layer
                  ? ` · calque conseillé : ${LAYER_LABELS[tileName.layer as LayerKey]}`
                  : ''}
              </span>
              <p style={{ fontSize: 11, color: 'var(--fg-text-3)', margin: 0 }}>
                Astuce : les feuillages et toits vont sur le calque « Au-dessus », les objets sur « Décor ». Outil
                Événements (V) : cliquez une case pour créer ou sélectionner un événement, glissez pour le déplacer.
              </p>
            </Flex>
          )}
        </aside>
      </div>
      <DialogContainer onDismiss={() => setDialog(null)}>
        {dialog === 'new' && (
          <MapDialog
            title="Nouvelle carte"
            initial={{
              id: nextMapId(maps),
              name: 'Nouvelle carte',
              width: 20,
              height: 15,
              tileset: map?.tileset ?? tilesetAssets[0]?.alias ?? '',
            }}
            tilesets={tilesetAssets}
            onSubmit={async (values) => {
              const created = emptyMap(
                values.id,
                values.name,
                values.width,
                values.height,
                values.tileset,
                TILE.ground,
              );
              const file = `maps/${values.id}.json`;
              await api.writeJson(projectId, file, created);
              setMaps((m) => [...m, file].sort());
              setPath(file);
              setDialog(null);
            }}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'props' && map && (
          <MapDialog
            title="Propriétés de la carte"
            initial={{
              id: map.id,
              name: map.name,
              width: map.width,
              height: map.height,
              tileset: map.tileset,
              music: map.music,
              rate: map.encounters?.rate,
              troops: map.encounters?.troops.join(', '),
            }}
            tilesets={tilesetAssets}
            musics={assets.filter((a) => a.kind === 'music' && a.alias)}
            showEncounters
            lockId
            onSubmit={async (values) => {
              let next =
                map.width !== values.width || map.height !== values.height
                  ? resizeMap(map, values.width, values.height, TILE.ground)
                  : map;
              const troops = (values.troops ?? '')
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean);
              next = {
                ...next,
                name: values.name,
                tileset: values.tileset,
                ...(values.music ? { music: values.music } : { music: undefined }),
                encounters: troops.length
                  ? {
                      troops,
                      rate: values.rate ?? 20,
                      ...(map.encounters?.onlyOnRole ? { onlyOnRole: map.encounters.onlyOnRole } : {}),
                    }
                  : undefined,
              };
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

function nextMapId(maps: string[]): string {
  let n = maps.length + 1;
  while (maps.includes(`maps/map${String(n).padStart(3, '0')}.json`)) n++;
  return `map${String(n).padStart(3, '0')}`;
}

interface MapValues {
  id: string;
  name: string;
  width: number;
  height: number;
  tileset: string;
  music?: string;
  rate?: number;
  troops?: string;
}

function MapDialog(props: {
  title: string;
  initial: MapValues;
  tilesets: AssetMeta[];
  musics?: AssetMeta[];
  showEncounters?: boolean;
  lockId?: boolean;
  onSubmit(values: MapValues): Promise<void>;
  onClose(): void;
}) {
  const [values, setValues] = useState<MapValues>(props.initial);
  const set = (patch: Partial<MapValues>) => setValues((v) => ({ ...v, ...patch }));
  return (
    <Dialog size="M">
      <Heading>{props.title}</Heading>
      <Divider />
      <Content>
        <Flex direction="column" gap="size-100">
          <Flex gap="size-100">
            <TextField
              label="Identifiant"
              value={values.id}
              onChange={(id) => set({ id: id.replace(/[^a-z0-9_-]/gi, '') })}
              isReadOnly={props.lockId}
              flex
            />
            <TextField label="Nom" value={values.name} onChange={(name) => set({ name })} flex />
          </Flex>
          <Flex gap="size-100">
            <NumberField
              label="Largeur (cases)"
              value={values.width}
              minValue={5}
              maxValue={200}
              onChange={(width) => set({ width })}
              flex
            />
            <NumberField
              label="Hauteur (cases)"
              value={values.height}
              minValue={5}
              maxValue={200}
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
          {props.musics && (
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
          )}
          {props.showEncounters && (
            <Flex gap="size-100">
              <TextField
                label="Rencontres : troupes (ids séparés par des virgules)"
                value={values.troops ?? ''}
                onChange={(troops) => set({ troops })}
                flex
              />
              <NumberField
                label="Pas moyens"
                value={values.rate ?? 20}
                minValue={1}
                onChange={(rate) => set({ rate })}
                width="size-1600"
              />
            </Flex>
          )}
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
