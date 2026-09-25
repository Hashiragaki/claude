import type { Command, RpgMap } from '@forge/mode-rpg';

export type LayerKey = 'ground' | 'decor' | 'overhead' | 'collision';

/** Tableau de couche normalisé à `width * height` (les couches vides `[]` sont remplies de -1). */
export function layerArray(map: RpgMap, layer: LayerKey): number[] {
  const size = map.width * map.height;
  const source = layer === 'collision' ? (map.collision ?? []) : map.layers[layer];
  if (source.length === size) return [...source];
  const fill = layer === 'collision' ? 0 : -1;
  return Array.from({ length: size }, (_, i) => source[i] ?? fill);
}

export function setLayer(map: RpgMap, layer: LayerKey, values: number[]): RpgMap {
  if (layer === 'collision') return { ...map, collision: values };
  return { ...map, layers: { ...map.layers, [layer]: values } };
}

/** Remplissage par diffusion (4 voisins) des cases de même valeur. */
export function floodFill(values: number[], width: number, height: number, x: number, y: number, value: number): number[] {
  const out = [...values];
  const target = out[y * width + x];
  if (target === value) return out;
  const stack: [number, number][] = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop() as [number, number];
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
    const i = cy * width + cx;
    if (out[i] !== target) continue;
    out[i] = value;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  return out;
}

export function fillRect(values: number[], width: number, x0: number, y0: number, x1: number, y1: number, value: number): number[] {
  const out = [...values];
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) out[y * width + x] = value;
  }
  return out;
}

/** Redimensionne une carte en conservant le contenu en haut à gauche. */
export function resizeMap(map: RpgMap, width: number, height: number, fillGround: number): RpgMap {
  const resize = (values: number[], fill: number) =>
    Array.from({ length: width * height }, (_, i) => {
      const x = i % width;
      const y = Math.floor(i / width);
      return x < map.width && y < map.height ? (values[y * map.width + x] ?? fill) : fill;
    });
  return {
    ...map,
    width,
    height,
    layers: {
      ground: resize(layerArray(map, 'ground'), fillGround),
      decor: resize(layerArray(map, 'decor'), -1),
      overhead: resize(layerArray(map, 'overhead'), -1),
    },
    ...(map.collision ? { collision: resize(layerArray(map, 'collision'), 0) } : {}),
    events: map.events.filter((e) => e.x < width && e.y < height),
  };
}

export function emptyMap(id: string, name: string, width: number, height: number, tileset: string, ground: number): RpgMap {
  return {
    id,
    name,
    width,
    height,
    tileset,
    layers: {
      ground: Array.from({ length: width * height }, () => ground),
      decor: Array.from({ length: width * height }, () => -1),
      overhead: Array.from({ length: width * height }, () => -1),
    },
    events: [],
  };
}

// ---------------------------------------------------------------------------
// Listes de commandes imbriquées (chemins)
// ---------------------------------------------------------------------------

/** Chemin vers une liste de commandes : [] = liste racine, puis (index, clé[, index d'option], ...). */
export type ListPath = (string | number)[];

type Json = Record<string, unknown> | unknown[];

function walk(root: Command[], path: ListPath): unknown {
  let node: unknown = root;
  for (const key of path) node = (node as Json as Record<string | number, unknown>)[key];
  return node;
}

export function getList(root: Command[], path: ListPath): Command[] {
  const list = walk(root, path);
  return Array.isArray(list) ? (list as Command[]) : [];
}

/** Applique une modification sur une copie profonde de la liste racine. */
export function editList(root: Command[], path: ListPath, edit: (list: Command[]) => void): Command[] {
  const copy = structuredClone(root);
  let parent: unknown = copy;
  for (let i = 0; i < path.length; i++) {
    const key = path[i] as string | number;
    const container = parent as Record<string | number, unknown>;
    if (container[key] === undefined) container[key] = typeof path[i + 1] === 'number' || i === path.length - 1 ? [] : {};
    parent = container[key];
  }
  edit(parent as Command[]);
  return copy;
}

/** Sous-listes d'une commande conteneur, avec leur libellé. */
export function childLists(command: Command): { key: ListPath; label: string; list: Command[] }[] {
  switch (command.type) {
    case 'choice':
      return command.options.map((o, i) => ({ key: ['options', i, 'commands'], label: `Si « ${o.label} »`, list: o.commands }));
    case 'if':
      return [
        { key: ['then'], label: 'Alors', list: command.then },
        { key: ['else'], label: 'Sinon', list: command.else ?? [] },
      ];
    case 'battle':
      return [
        { key: ['onWin'], label: 'En cas de victoire', list: command.onWin ?? [] },
        { key: ['onLose'], label: 'En cas de défaite', list: command.onLose ?? [] },
        { key: ['onEscape'], label: 'En cas de fuite', list: command.onEscape ?? [] },
      ];
    default:
      return [];
  }
}

const ARROWS: Record<string, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  turnUp: '⤒',
  turnDown: '⤓',
  turnLeft: '⇤',
  turnRight: '⇥',
  wait: '…',
};

function describeCondition(c: Record<string, unknown>): string {
  if ('switch' in c) return `interrupteur ${String(c.switch)} ${c.value === false ? 'OFF' : 'ON'}`;
  if ('variable' in c) {
    const v = c.variable as { name: string; op: string; value: number };
    return `variable ${v.name} ${v.op} ${v.value}`;
  }
  if ('item' in c) return `possède ${String(c.count ?? 1)} × ${String(c.item)}`;
  if ('gold' in c) return `or ≥ ${String(c.gold)}`;
  if ('selfSwitch' in c) return `interrupteur local ${String(c.selfSwitch)} ${c.value === false ? 'OFF' : 'ON'}`;
  if ('script' in c) return `« ${String(c.script)} »`;
  return JSON.stringify(c);
}

/** Résumé lisible d'une commande (liste façon RPG Maker). */
export function describeCommand(c: Command): string {
  switch (c.type) {
    case 'text':
      return `Texte : ${c.speaker ? `[${c.speaker}] ` : ''}« ${c.text.replace(/\n/g, ' ')} »`;
    case 'choice':
      return `Choix : ${c.options.map((o) => o.label).join(' / ')}`;
    case 'if':
      return `Si ${describeCondition(c.condition as Record<string, unknown>)}`;
    case 'setSwitch':
      return `Interrupteur ${c.name} = ${c.value === false ? 'OFF' : 'ON'}`;
    case 'setSelfSwitch':
      return `Interrupteur local ${c.letter} = ${c.value === false ? 'OFF' : 'ON'}${c.event ? ` (${c.event})` : ''}`;
    case 'setVariable': {
      const ops: Record<string, string> = { set: '=', add: '+=', sub: '-=', mul: '×=', div: '÷=', mod: '%=', random: '= hasard' };
      return `Variable ${c.name} ${ops[c.op ?? 'set']} ${c.value}${c.op === 'random' ? `..${c.max ?? c.value}` : ''}`;
    }
    case 'giveItem':
      return `Objet : ${(c.count ?? 1) >= 0 ? '+' : ''}${c.count ?? 1} ${c.item}`;
    case 'giveGold':
      return `Or : ${c.amount >= 0 ? '+' : ''}${c.amount}`;
    case 'teleport':
      return `Téléporter : ${c.map} (${c.x}, ${c.y})${c.direction ? ` ${c.direction}` : ''}`;
    case 'battle':
      return `Combat : ${c.troop}${c.canEscape ? ', fuite possible' : ''}${c.canLose ? ', défaite possible' : ''}`;
    case 'wait':
      return `Attendre ${c.seconds} s`;
    case 'playSfx':
      return `Son : ${c.ref}`;
    case 'playMusic':
      return `Musique : ${c.ref}`;
    case 'stopMusic':
      return 'Arrêter la musique';
    case 'moveRoute':
      return `Déplacer ${c.target} : ${c.steps.map((s) => ARROWS[s] ?? s).join(' ')}${c.wait ? ' (attendre)' : ''}`;
    case 'healParty':
      return 'Soigner l\'équipe';
    case 'erase':
      return 'Effacer l\'événement';
    case 'setFlag':
      return `Option ${c.flag} = ${c.value ? 'activée' : 'désactivée'}`;
    case 'gameOver':
      return 'Game over';
    case 'returnToTitle':
      return 'Retour à l\'écran titre';
    case 'script':
      return `Script : ${c.code}`;
    case 'comment':
      return `// ${c.text}`;
  }
}

/** Commande par défaut insérée pour chaque type. */
export const COMMAND_TEMPLATES: Record<Command['type'], { label: string; command: Command }> = {
  text: { label: 'Afficher un texte', command: { type: 'text', speaker: '', text: 'Bonjour !' } },
  choice: {
    label: 'Proposer un choix',
    command: { type: 'choice', options: [{ label: 'Oui', commands: [] }, { label: 'Non', commands: [] }], cancel: 1 },
  },
  if: { label: 'Condition', command: { type: 'if', condition: { switch: 'mon_interrupteur' }, then: [], else: [] } },
  setSwitch: { label: 'Interrupteur', command: { type: 'setSwitch', name: 'mon_interrupteur', value: true } },
  setSelfSwitch: { label: 'Interrupteur local', command: { type: 'setSelfSwitch', letter: 'A', value: true } },
  setVariable: { label: 'Variable', command: { type: 'setVariable', name: 'ma_variable', op: 'add', value: 1 } },
  giveItem: { label: 'Donner un objet', command: { type: 'giveItem', item: 'potion', count: 1 } },
  giveGold: { label: 'Donner de l\'or', command: { type: 'giveGold', amount: 10 } },
  teleport: { label: 'Téléporter', command: { type: 'teleport', map: 'map001', x: 0, y: 0 } },
  battle: { label: 'Lancer un combat', command: { type: 'battle', troop: 'troupe', canEscape: true, onWin: [] } },
  wait: { label: 'Attendre', command: { type: 'wait', seconds: 1 } },
  playSfx: { label: 'Jouer un son', command: { type: 'playSfx', ref: 'alias' } },
  playMusic: { label: 'Jouer une musique', command: { type: 'playMusic', ref: 'alias' } },
  stopMusic: { label: 'Arrêter la musique', command: { type: 'stopMusic' } },
  moveRoute: { label: 'Déplacer', command: { type: 'moveRoute', target: 'this', steps: ['left', 'left'], wait: true } },
  healParty: { label: 'Soigner l\'équipe', command: { type: 'healParty' } },
  erase: { label: 'Effacer l\'événement', command: { type: 'erase' } },
  setFlag: { label: 'Option de jeu', command: { type: 'setFlag', flag: 'encounters', value: false } },
  gameOver: { label: 'Game over', command: { type: 'gameOver' } },
  returnToTitle: { label: 'Retour au titre', command: { type: 'returnToTitle' } },
  script: { label: 'Script', command: { type: 'script', code: 'quete += 1' } },
  comment: { label: 'Commentaire', command: { type: 'comment', text: 'Note' } },
};
