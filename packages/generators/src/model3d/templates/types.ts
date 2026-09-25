import type { Rng } from '@forge/core';
import type { ModelBuilder } from '../builder';
import type { AnimationSpec } from '../dsl';

/** Contexte d'un modèle procédural : aléa (proportions, couleurs) et couleur d'accent imposée. */
export interface TemplateContext {
  rng: Rng;
  /** Couleur principale demandée (`#rrggbb`), appliquée à l'élément le plus caractéristique. */
  color?: string;
}

export interface TemplateModel {
  /** Nom lisible du modèle. */
  name: string;
  builder: ModelBuilder;
  /** Nœud racine (animations génériques : spin, bob, bounce, pulse). */
  root: string;
  /** Animations propres au modèle ; elles peuvent ajouter des nœuds (ex. fumée). */
  animations: Record<string, (builder: ModelBuilder) => AnimationSpec>;
}

export type TemplateFn = (ctx: TemplateContext) => TemplateModel;
