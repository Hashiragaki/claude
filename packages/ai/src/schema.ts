import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

type InputSchema = Anthropic.Beta.BetaTool.InputSchema;

/** Convertit un schéma zod (objet) en schéma d'entrée d'outil pour l'API. */
export function toInputSchema(schema: z.ZodType): InputSchema {
  // Schéma « entrée » : les champs avec valeur par défaut restent facultatifs pour le modèle.
  const json = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
  delete json.$schema;
  if (json.type !== 'object') {
    throw new Error("Le schéma d'un outil doit décrire un objet JSON.");
  }
  return json as unknown as InputSchema;
}

/** Formate les erreurs de validation pour que le modèle puisse les corriger. */
export function formatZodError(error: z.ZodError, maxIssues = 25): string {
  const lines = error.issues.slice(0, maxIssues).map((issue) => {
    const path = issue.path.length ? issue.path.map(String).join('.') : '(racine)';
    return `- ${path} : ${issue.message}`;
  });
  if (error.issues.length > maxIssues) lines.push(`- … et ${error.issues.length - maxIssues} autres erreurs`);
  return lines.join('\n');
}

/** Tronque un texte long (résultats d'outils) en conservant le début et la fin. */
export function truncate(text: string, max = 20000): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.8);
  return `${text.slice(0, head)}\n…[${text.length - max} caractères omis]…\n${text.slice(-(max - head))}`;
}
