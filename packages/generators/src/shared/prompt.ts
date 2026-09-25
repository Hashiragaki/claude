/** Fragments de prompts communs aux générateurs d'images. */

/** Rappel commun : le public est francophone, mais aucun texte ne doit être dessiné. */
export const FRENCH_AUDIENCE_NOTE =
  'The game and its players are French-speaking: if you ever write human-readable text (names, ids meant ' +
  'to be displayed), write it in French. Never draw letters, words or numbers inside the image itself.';

/** Paramètres non vides, hors `prompt`, sous forme de lignes `- clé : valeur`. */
export function paramLines(params: object, skip: readonly string[] = ['prompt']): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (skip.includes(key) || value === undefined || value === '' || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    lines.push(`- ${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`);
  }
  return lines.join('\n');
}

/** Message utilisateur standard : description + paramètres. */
export function requestMessage(what: string, prompt: string, params: object, extra: string[] = []): string {
  const desc = prompt.trim();
  const lines = paramLines(params);
  return [
    `Create ${what}.`,
    desc
      ? `Description from the user (French): « ${desc} »`
      : 'No description was given: pick a charming, coherent subject yourself.',
    lines ? `Parameters:\n${lines}` : '',
    ...extra,
    'Answer only by calling the tool with the complete spec.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Message de modification d'une spec existante. */
export function editMessage(spec: unknown, instruction: string, params: object, extra: string[] = []): string {
  const lines = paramLines(params);
  return [
    'Here is the current spec of the asset (JSON):',
    `\`\`\`json\n${JSON.stringify(spec)}\n\`\`\``,
    `Requested change (from the user, in French): « ${instruction.trim()} »`,
    lines ? `Original parameters:\n${lines}` : '',
    ...extra,
    'Apply only this change and keep everything else identical (identity, composition, palette and size, ' +
      'unless the change asks otherwise). Return the complete updated spec by calling the tool.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
