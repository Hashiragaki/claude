/** Aides pour l'éditeur de scripts (liste des scènes, navigation). */

const LABEL_LINE = /^\s*label\s+([\p{L}_][\p{L}\p{N}_.]*)\s*:/u;

/** Labels déclarés dans un source, avec leur ligne (1-based). Tolérant aux erreurs de syntaxe. */
export function listLabels(source: string): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = [];
  source.split(/\r\n|\r|\n/).forEach((text, i) => {
    const m = LABEL_LINE.exec(text);
    if (m) out.push({ name: m[1] as string, line: i + 1 });
  });
  return out;
}

const DEFINE_CHARACTER = /^\s*define\s+([A-Za-z_À-ɏ][A-Za-z0-9_À-ɏ]*)\s*=\s*Character\s*\(\s*(?:"([^"]*)"|'([^']*)')?/;

/** Personnages définis par `define x = Character("Nom")` (complétion dans l'éditeur). */
export function listCharacters(source: string): { id: string; name: string | null; line: number }[] {
  const out: { id: string; name: string | null; line: number }[] = [];
  source.split(/\r\n|\r|\n/).forEach((text, i) => {
    const m = DEFINE_CHARACTER.exec(text);
    if (m) out.push({ id: m[1] as string, name: m[2] ?? m[3] ?? null, line: i + 1 });
  });
  return out;
}
