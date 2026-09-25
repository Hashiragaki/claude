import type { Facing, PlatformerEntityType } from './schema';

/**
 * Contrat entre la simulation (logique pure, testée sans navigateur) et les rendus (Pixi ou sans
 * affichage). La simulation ne connaît ni Pixi ni le DOM : le rendu lit des instantanés.
 */

/** Commandes du joueur pour un pas de simulation (instantané du clavier/manette). */
export interface PlatformerInput {
  left: boolean;
  right: boolean;
  /** Saut maintenu (pour le saut court quand on relâche). */
  jumpHeld: boolean;
  /** Saut appuyé pendant ce pas (front montant : touche confirm ou haut). */
  jumpPressed: boolean;
  /** Bas maintenu : traverser une plateforme `oneway` en appuyant aussi sur saut. */
  down: boolean;
}

/** Boîte englobante en pixels monde (coin haut-gauche). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PlayerAnim = 'idle' | 'run' | 'jump' | 'fall' | 'hurt' | 'dead';

export interface PlayerView extends Rect {
  vx: number;
  vy: number;
  facing: Facing;
  onGround: boolean;
  anim: PlayerAnim;
  /** Invulnérable (clignotement à l'écran). */
  invincible: boolean;
}

export interface EntityView extends Rect {
  id: string;
  type: PlatformerEntityType;
  /** Encore présent (pièce non ramassée, ennemi vivant…). */
  active: boolean;
  facing?: Facing;
  /** Point de contrôle activé, ressort comprimé… */
  triggered?: boolean;
}

/** Événements produits par un pas de simulation (sons, HUD, transitions). */
export type WorldEvent =
  | { type: 'jump' }
  | { type: 'coin'; id: string }
  | { type: 'stomp'; id: string }
  | { type: 'spring'; id: string }
  | { type: 'hurt' }
  | { type: 'death'; cause: 'enemy' | 'hazard' | 'fall' | 'time' }
  | { type: 'checkpoint'; id: string }
  | { type: 'goal' }
  | { type: 'sign'; id: string; text: string };

/** Phase de la partie pilotée par la session (niveaux, vies, fin). */
export type SessionPhase = 'playing' | 'dying' | 'level-complete' | 'game-over' | 'game-won';

export interface HudView {
  level: string;
  levelName: string;
  lives: number;
  coins: number;
  score: number;
  /** Secondes restantes si le niveau a un temps limite. */
  timeLeft?: number;
  /** Texte du panneau devant lequel se trouve le joueur. */
  sign?: string;
}
