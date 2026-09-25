/**
 * Découpage d'un script en lignes logiques et construction de l'arbre d'indentation.
 * Aucune erreur n'est levée : les problèmes sont signalés via `report`.
 */

/** Ligne non vide, sans commentaire, avec ses lignes enfants (plus indentées). */
export interface RawLine {
  line: number;
  indent: number;
  text: string;
  children: RawLine[];
}

export type Reporter = (line: number, column: number, message: string, severity?: 'error' | 'warning') => void;

/** Retire un commentaire `#` situé hors d'une chaîne. */
export function stripComment(text: string): string {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#') {
      return text.slice(0, i);
    }
  }
  return text;
}

/** Découpe le source en lignes utiles (les lignes vides et les commentaires sont ignorés). */
export function splitLines(source: string, report: Reporter): RawLine[] {
  const out: RawLine[] = [];
  const lines = source.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  lines.forEach((raw, i) => {
    let indent = 0;
    let k = 0;
    let tab = false;
    while (k < raw.length && (raw[k] === ' ' || raw[k] === '\t')) {
      if (raw[k] === '\t') {
        tab = true;
        indent += 4 - (indent % 4);
      } else indent++;
      k++;
    }
    const text = stripComment(raw.slice(k)).trimEnd();
    if (!text) return;
    if (tab) report(i + 1, 1, 'Tabulation dans l\'indentation : utilisez des espaces', 'warning');
    out.push({ line: i + 1, indent, text, children: [] });
  });
  return out;
}

interface Frame {
  indent: number;
  nodes: RawLine[];
}

/**
 * Range les lignes en arbre : une ligne plus indentée que la précédente devient son enfant.
 * Les désindentations qui ne retombent sur aucun niveau englobant sont signalées.
 */
export function buildTree(lines: RawLine[], report: Reporter): RawLine[] {
  const root: RawLine[] = [];
  const stack: Frame[] = [{ indent: 0, nodes: root }];
  const top = () => stack[stack.length - 1] as Frame;
  for (const l of lines) {
    if (l.indent > top().indent) {
      const parent = top().nodes[top().nodes.length - 1];
      if (parent) {
        stack.push({ indent: l.indent, nodes: parent.children });
      } else {
        report(l.line, l.indent + 1, 'Indentation inattendue');
        stack.push({ indent: l.indent, nodes: top().nodes });
      }
    } else if (l.indent < top().indent) {
      while (stack.length > 1 && top().indent > l.indent) stack.pop();
      if (top().indent !== l.indent) {
        report(l.line, l.indent + 1, 'Indentation incohérente : ce niveau ne correspond à aucun bloc englobant');
        stack.push({ indent: l.indent, nodes: top().nodes });
      }
    }
    top().nodes.push(l);
  }
  return root;
}
