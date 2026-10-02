import type { HotspotKind, ItemsFile, Point, PointClickState, PointClickSystem, Scene, Verb } from './schema';

/**
 * Contrat entre la session (logique pure, testée sans navigateur) et les rendus (Pixi ou sans
 * affichage). La session ne connaît ni Pixi ni le DOM : le rendu lui transmet les clics en
 * coordonnées de scène et lit des instantanés (`SessionView`) à chaque image.
 */

/** Ce que le joueur est en train de faire, du point de vue de l'interface. */
export type SessionPhase =
  /** Libre : clics sur la scène et l'inventaire. */
  | 'explore'
  /** Le personnage marche vers une cible (un clic l'interrompt et le redirige). */
  | 'walking'
  /** Une bulle est affichée : un clic (ou Entrée) passe à la suite. */
  | 'message'
  /** Des choix de dialogue sont proposés. */
  | 'choice'
  /** Une pause `wait` ou une transition est en cours (clics ignorés). */
  | 'busy'
  /** Fin du jeu atteinte. */
  | 'ended';

export interface HotspotView {
  id: string;
  name: string;
  kind: HotspotKind;
  /** Boîte englobante (pixels de scène) pour le survol et le sprite. */
  bounds: { x: number; y: number; w: number; h: number };
  sprite?: string;
  spriteAt?: { x: number; y: number; w: number; h: number };
}

export interface PlayerView {
  x: number;
  y: number;
  /** Échelle finale (`playerScale` × profondeur). */
  scale: number;
  facing: 'down' | 'left' | 'right' | 'up';
  walking: boolean;
}

export interface MessageView {
  text: string;
  speaker?: string;
}

export interface ChoiceView {
  speaker?: string;
  prompt?: string;
  /** Choix visibles uniquement (conditions déjà évaluées). */
  options: { index: number; text: string }[];
}

export interface InventoryItemView {
  id: string;
  name: string;
  icon: string;
  description: string;
}

/** Instantané complet de ce qu'il faut afficher. */
export interface SessionView {
  phase: SessionPhase;
  scene: {
    id: string;
    name: string;
    background: string;
    width: number;
    height: number;
  };
  /** Zones visibles, dans l'ordre de dessin. */
  hotspots: HotspotView[];
  player?: PlayerView;
  inventory: InventoryItemView[];
  /** Objet sélectionné dans l'inventaire (curseur « utiliser … sur »). */
  selectedItem?: string;
  message?: MessageView;
  choice?: ChoiceView;
  /** Texte de fin (phase `ended`). */
  endText?: string;
}

/** Événements à consommer par le rendu (sons, musique, transitions). */
export type SessionEvent =
  | { type: 'scene-changed'; scene: string; previous?: string }
  | { type: 'sound'; asset: string }
  | { type: 'music'; asset?: string }
  | { type: 'item-gained'; item: string }
  | { type: 'item-lost'; item: string }
  | { type: 'combined'; a: string; b: string; result?: string }
  | { type: 'fail' }
  | { type: 'ended'; text?: string };

/** Résultat du survol : ce qu'afficher sous le curseur. */
export interface HoverInfo {
  hotspot?: { id: string; name: string; kind: HotspotKind };
  /** Libellé complet, ex. « Utiliser Clé sur Porte » ou « Porte ». */
  label: string;
}

/**
 * API de la session (implémentée par `PointClickSession` dans `session.ts`). Toutes les
 * coordonnées sont en pixels de scène.
 */
export interface PointClickSessionApi {
  /** Entre dans la scène de départ (ou celle de l'état restauré) et exécute ses actions d'entrée. */
  start(): void;
  /** Avance la simulation (marche, pauses) de `dt` secondes. */
  update(dt: number): void;
  /** Clic sur la scène : `interact` (gauche) ou `look` (droit). */
  click(point: Point, verb: Verb): void;
  /** Ce qui est sous le curseur. */
  hover(point: Point): HoverInfo;
  /** Sélectionne un objet d'inventaire (ou désélectionne avec `null`). Re-cliquer le même le désélectionne. */
  selectItem(id: string | null): void;
  /** Utilise l'objet sélectionné sur un autre objet d'inventaire (combinaison). */
  useItemOnItem(target: string): void;
  /** Regarde un objet d'inventaire (affiche sa description). */
  lookItem(id: string): void;
  /** Passe la bulle courante (phase `message`). */
  advance(): void;
  /** Choisit l'option `index` (index d'origine dans le dialogue, cf. `ChoiceView.options`). */
  choose(index: number): void;
  view(): SessionView;
  /** Événements produits depuis le dernier appel (puis vidés). */
  drainEvents(): SessionEvent[];
  serialize(): PointClickState;
  /** Restaure un état (sans réexécuter `onFirstEnter`). */
  restore(state: PointClickState): void;
  /** Variables pour l'inspecteur de l'éditeur. */
  debugState(): Record<string, unknown>;
}

/**
 * Données du jeu chargées et validées (`loadPointClickProject(bundle)` dans `loader.ts`).
 * Construction de la session : `new PointClickSession(data, { state?, log? })` dans `session.ts`.
 */
export interface PointClickData {
  system: PointClickSystem;
  items: ItemsFile;
  scenes: Map<string, Scene>;
}

export interface PointClickSessionOptions {
  /** État restauré (sauvegarde) ; sinon nouvelle partie. */
  state?: PointClickState;
  /** Journal (erreurs d'expressions, références manquantes) : la session ne lève jamais pendant le jeu. */
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}
