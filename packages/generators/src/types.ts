import type { AssetKind, Rng } from '@forge/core';
import type { z } from 'zod';

/** Fichier produit par un générateur. */
export interface GeneratedFile {
  /**
   * Rôle du fichier : `main` devient `AssetMeta.file`, `source` devient `AssetMeta.source`,
   * tout autre rôle (ex. `atlas`, `tiles`) devient `AssetMeta.extra[role]`.
   */
  role: string;
  /** Extension sans point : `png`, `svg`, `json`, `wav`, `glb`. */
  ext: string;
  mime: string;
  data: Uint8Array | string;
}

export interface GeneratorResult {
  files: GeneratedFile[];
  /** Informations techniques stockées dans `AssetMeta.info` (largeur, durée, frames…). */
  info: Record<string, string | number | boolean>;
}

/** Services fournis par l'hôte (serveur) au moment du rendu. */
export interface RenderContext {
  /** Rasterise un SVG en PNG aux dimensions données. */
  rasterizeSvg(svg: string, width: number, height: number): Promise<Uint8Array>;
}

/**
 * Définition d'un générateur d'assets.
 *
 * Pipeline : paramètres utilisateur → « spec » (produite par Claude selon `systemPrompt` et
 * validée par `specSchema`, ou par `procedural` hors-ligne) → `render` → fichiers.
 */
export interface GeneratorDefinition<P = any, S = any> {
  id: string;
  kind: AssetKind;
  /** Libellé affiché dans l'éditeur (français). */
  label: string;
  description: string;
  /** Paramètres utilisateur, avec valeurs par défaut. Doit accepter `{}` et `{ prompt }`. */
  paramsSchema: z.ZodType<P>;
  /**
   * Format que l'IA doit produire. Doit être convertible avec `z.toJSONSchema()` (pas de
   * `.transform`) : il sert de schéma d'entrée d'outil pour Claude.
   */
  specSchema: z.ZodType<S>;
  /** Instructions système pour Claude : format de la spec, direction artistique, contraintes. */
  systemPrompt: string;
  /** Message utilisateur envoyé à Claude pour ces paramètres. */
  buildPrompt(params: P): string;
  /**
   * Indications données à l'IA lors de la critique visuelle du rendu (disposition d'une planche,
   * lecture des lignes/colonnes…). Présent seulement pour les générateurs dont le rendu est une image.
   */
  reviewHint?: string;
  /** Message pour modifier une spec existante selon une instruction (« plus sombre »). */
  buildEditPrompt(spec: S, instruction: string, params: P): string;
  /** Génération procédurale déterministe (repli hors-ligne, modèles de projet, tests). */
  procedural(params: P, rng: Rng): S;
  render(spec: S, params: P, ctx: RenderContext): Promise<GeneratorResult>;
}
