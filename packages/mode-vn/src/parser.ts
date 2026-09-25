import { ExprError, ObjectScope, evalExpression, parseExpression, parseStatement } from '@forge/core';
import type { Diagnostic, Value } from '@forge/core';
import { VN_POSITIONS, VN_TRANSITIONS, isPosition, isTransition } from './constants';
import { buildTree, splitLines, type RawLine } from './lines';
import { ParseError, Scanner } from './scanner';
import { extractInterpolations } from './text';
import type {
  AudioChannelName,
  CharacterDef,
  IfBranch,
  MenuChoiceNode,
  MenuNode,
  SayNode,
  ScriptAst,
  SourcePos,
  VNNode,
} from './types';

export interface ParseResult {
  ast: ScriptAst;
  diagnostics: Diagnostic[];
}

/** Noms de variables compatibles avec le langage d'expressions du core. */
const VAR_RE = /^[A-Za-z_À-ɏ][A-Za-z0-9_À-ɏ]*$/;
const LABEL_RE = /^[\p{L}_][\p{L}\p{N}_.]*$/u;
const COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const UNSUPPORTED = new Set(['python', 'init', 'screen', 'transform', 'style', 'nvl', 'translate', 'camera']);
const CHANNELS: Record<string, AudioChannelName> = { music: 'music', sound: 'sound', audio: 'sound', voice: 'voice' };

/**
 * Analyse un script `.vn`. Ne lève jamais d'exception : les erreurs sont renvoyées sous forme de
 * diagnostics et l'AST contient tout ce qui a pu être compris.
 */
export function parseScript(source: string, file = 'script.vn'): ParseResult {
  const parser = new ScriptParser(file);
  let nodes: VNNode[] = [];
  try {
    const tree = buildTree(splitLines(typeof source === 'string' ? source : '', parser.report), parser.report);
    nodes = parser.block(tree, true);
  } catch (error) {
    parser.report(1, 1, `Erreur interne de l'analyseur : ${error instanceof Error ? error.message : String(error)}`);
  }
  const diagnostics = parser.diagnostics.sort(
    (a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0),
  );
  return { ast: { file, nodes }, diagnostics };
}

function firstWord(text: string): string {
  return /^[A-Za-z_]+/.exec(text)?.[0] ?? '';
}

function posOf(raw: RawLine): SourcePos {
  return { line: raw.line, column: raw.indent + 1 };
}

class ScriptParser {
  readonly diagnostics: Diagnostic[] = [];

  constructor(private readonly file: string) {}

  readonly report = (line: number, column: number, message: string, severity: 'error' | 'warning' = 'error') => {
    this.diagnostics.push({ file: this.file, line, column, severity, message });
  };

  private warn(line: number, column: number, message: string): void {
    this.report(line, column, message, 'warning');
  }

  // -------------------------------------------------------------------------
  // Blocs
  // -------------------------------------------------------------------------

  block(lines: RawLine[], topLevel: boolean): VNNode[] {
    const nodes: VNNode[] = [];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i] as RawLine;
      const first = firstWord(raw.text);
      if (first === 'if') {
        const branches: IfBranch[] = [this.branch(raw, 'if')];
        while (i + 1 < lines.length) {
          const next = lines[i + 1] as RawLine;
          const kw = firstWord(next.text);
          if (kw !== 'elif' && kw !== 'else') break;
          i++;
          branches.push(this.branch(next, kw));
          if (kw === 'else') break;
        }
        nodes.push({ kind: 'if', ...posOf(raw), branches });
        continue;
      }
      if (first === 'elif' || first === 'else') {
        this.report(raw.line, raw.indent + 1, `« ${first} » sans « if » correspondant`);
        this.block(raw.children, false);
        continue;
      }
      const node = this.statement(raw, topLevel);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  /** Corps obligatoire d'une instruction de bloc. */
  private body(raw: RawLine): VNNode[] {
    if (raw.children.length === 0) {
      this.report(raw.line, raw.indent + raw.text.length, 'Bloc indenté attendu après « : »');
      return [];
    }
    return this.block(raw.children, false);
  }

  /** Signale des lignes indentées sous une instruction qui n'ouvre pas de bloc. */
  private noChildren(raw: RawLine): void {
    const child = raw.children[0];
    if (child) this.report(child.line, child.indent + 1, 'Indentation inattendue');
  }

  private branch(raw: RawLine, kw: 'if' | 'elif' | 'else'): IfBranch {
    const s = new Scanner(raw.text, raw.indent + 1);
    s.word();
    let cond: string | null = null;
    const col = s.column + 1;
    const rest = s.rest();
    const hasColon = rest.endsWith(':');
    const head = (hasColon ? rest.slice(0, -1) : rest).trim();
    if (kw === 'else') {
      if (head) this.report(raw.line, col, `Texte inattendu après « else » : « ${head} »`);
    } else if (!head) {
      this.report(raw.line, col, `Condition attendue après « ${kw} »`);
      cond = 'False';
    } else {
      cond = head;
      this.checkExpr(cond, raw.line, col);
    }
    if (!hasColon) this.report(raw.line, raw.indent + raw.text.length, '« : » attendu à la fin de la ligne');
    return { ...posOf(raw), cond, body: this.body(raw) };
  }

  // -------------------------------------------------------------------------
  // Instructions
  // -------------------------------------------------------------------------

  private statement(raw: RawLine, topLevel: boolean): VNNode | null {
    const s = new Scanner(raw.text, raw.indent + 1);
    const pos = posOf(raw);
    let keyword: string | null = null;
    try {
      if (raw.text.startsWith('$')) {
        this.noChildren(raw);
        return this.exec(raw, pos);
      }
      if (s.isQuote()) {
        this.noChildren(raw);
        return this.say(s, pos, null);
      }
      keyword = s.word();
      if (!keyword) throw new ParseError(`Instruction invalide : « ${raw.text} »`, pos.column);
      if (keyword === 'label') return this.label(s, raw, pos);
      if (keyword === 'menu') return this.menu(s, raw, pos);
      if (UNSUPPORTED.has(keyword) && !s.isQuote()) {
        throw new ParseError(`Instruction non prise en charge : « ${keyword} »`, pos.column);
      }
      this.noChildren(raw);
      return this.simple(keyword, s, pos, topLevel);
    } catch (error) {
      if (!(error instanceof ParseError)) throw error;
      this.report(raw.line, error.column, error.message);
      // Analyse quand même le contenu des blocs pour signaler leurs erreurs.
      if (keyword === 'label') this.block(raw.children, false);
      return null;
    }
  }

  private simple(keyword: string, s: Scanner, pos: SourcePos, topLevel: boolean): VNNode | null {
    switch (keyword) {
      case 'define':
      case 'default':
        return this.define(keyword, s, pos);
      case 'image':
        return this.image(s, pos);
      case 'include': {
        if (!topLevel) throw new ParseError('« include » doit être au niveau principal du script', pos.column);
        const path = s.string();
        s.end();
        if (!path.trim()) throw new ParseError('Chemin de fichier vide', pos.column);
        return { kind: 'include', ...pos, path };
      }
      case 'scene':
        return this.scene(s, pos);
      case 'show':
        return this.show(s, pos);
      case 'hide': {
        const tag = s.expectWord("Nom d'image");
        let transition: string | null = null;
        while (!s.eof()) {
          const w = s.expectWord("Nom d'image");
          if (w === 'with') transition = this.transitionName(s, pos.line);
        }
        return { kind: 'hide', ...pos, tag, transition };
      }
      case 'with': {
        const transition = this.transitionName(s, pos.line);
        s.end();
        return { kind: 'with', ...pos, transition };
      }
      case 'jump':
      case 'call': {
        const col = s.column + 1;
        const label = s.expectWord('Nom de label');
        if (!LABEL_RE.test(label)) throw new ParseError(`Nom de label invalide : « ${label} »`, col);
        if (keyword === 'call' && s.peekWord() === 'from') {
          s.word();
          s.expectWord('Nom de label');
        }
        s.end();
        return { kind: keyword, ...pos, label };
      }
      case 'return':
        s.end();
        return { kind: 'return', ...pos };
      case 'pass':
        s.end();
        return { kind: 'pass', ...pos };
      case 'pause': {
        const seconds = s.eof() ? null : s.expectNumber('Durée de pause');
        s.end();
        return { kind: 'pause', ...pos, seconds };
      }
      case 'play':
      case 'voice':
        return this.play(keyword, s, pos);
      case 'stop': {
        const channel = this.channel(s);
        let fadeout: number | null = null;
        while (!s.eof()) {
          const col = s.column + 1;
          const opt = s.expectWord('Option');
          if (opt === 'fadeout') fadeout = s.expectNumber('fadeout');
          else throw new ParseError(`Option inconnue pour « stop » : « ${opt} »`, col);
        }
        return { kind: 'stop', ...pos, channel, fadeout };
      }
      case 'window': {
        const col = s.column + 1;
        const mode = s.expectWord('« show » ou « hide »');
        if (mode !== 'show' && mode !== 'hide' && mode !== 'auto') {
          throw new ParseError(`« window show » ou « window hide » attendu, trouvé « ${mode} »`, col);
        }
        if (s.peekWord() === 'with') {
          s.word();
          this.transitionName(s, pos.line);
        }
        s.end();
        return { kind: 'window', ...pos, shown: mode !== 'hide' };
      }
      case 'centered': {
        const text = s.string();
        s.end('le texte');
        this.checkText(text, pos.line, pos.column);
        return { kind: 'centered', ...pos, text };
      }
      default:
        return this.say(s, pos, keyword);
    }
  }

  private exec(raw: RawLine, pos: SourcePos): VNNode {
    const code = raw.text.slice(1).trim();
    if (!code) throw new ParseError('Instruction attendue après « $ »', pos.column + 1);
    this.checkExpr(code, pos.line, pos.column + 2, true);
    return { kind: 'exec', ...pos, code };
  }

  private say(s: Scanner, pos: SourcePos, who: string | null): SayNode {
    const attrs: string[] = [];
    if (who !== null) {
      while (!s.isQuote()) {
        const w = s.word();
        if (!w) throw new ParseError(`Instruction inconnue : « ${who} »`, pos.column);
        attrs.push(w);
      }
      if (!VAR_RE.test(who)) throw new ParseError(`Nom de personnage invalide : « ${who} »`, pos.column);
    }
    const textCol = s.column + 1;
    let text = s.string();
    let whoName: string | null = null;
    if (who === null && s.isQuote()) {
      whoName = text;
      text = s.string();
    }
    let transition: string | null = null;
    if (s.peekWord() === 'with') {
      s.word();
      transition = this.transitionName(s, pos.line);
    }
    s.end('la réplique');
    this.checkText(text, pos.line, textCol);
    if (whoName !== null) this.checkText(whoName, pos.line, pos.column);
    return { kind: 'say', ...pos, who, whoName, attrs, text, transition };
  }

  private label(s: Scanner, raw: RawLine, pos: SourcePos): VNNode {
    const col = s.column + 1;
    const name = s.expectWord('Nom de label');
    if (!LABEL_RE.test(name)) throw new ParseError(`Nom de label invalide : « ${name} »`, col);
    const hasColon = s.eat(':');
    s.end('le nom du label');
    if (!hasColon) this.report(raw.line, raw.indent + raw.text.length, '« : » attendu à la fin de la ligne');
    return { kind: 'label', ...pos, name, body: this.body(raw) };
  }

  private define(keyword: 'define' | 'default', s: Scanner, pos: SourcePos): VNNode {
    const col = s.column + 1;
    const name = s.expectWord('Nom de variable');
    if (!VAR_RE.test(name)) throw new ParseError(`Nom de variable invalide : « ${name} »`, col);
    if (!s.eat('=')) throw new ParseError('« = » attendu', s.column);
    const exprCol = s.column + 1;
    const expr = s.rest();
    if (!expr) throw new ParseError('Expression attendue après « = »', exprCol);
    if (keyword === 'define' && /^Character\s*\(/.test(expr)) {
      const character = this.character(expr, pos.line, exprCol);
      return { kind: 'define', ...pos, name, expr, character };
    }
    this.checkExpr(expr, pos.line, exprCol);
    return keyword === 'define'
      ? { kind: 'define', ...pos, name, expr, character: null }
      : { kind: 'default', ...pos, name, expr };
  }

  /** Analyse `Character("Nom", color="#hex", image="alias")` (arguments littéraux). */
  private character(expr: string, line: number, col: number): CharacterDef {
    const open = expr.indexOf('(');
    const close = matchParen(expr, open);
    if (close < 0 || expr.slice(close + 1).trim()) {
      throw new ParseError('Appel « Character(…) » mal formé', col);
    }
    const def: CharacterDef = { name: null, color: null, image: null };
    let positional = 0;
    for (const arg of splitArgs(expr.slice(open + 1, close))) {
      const m = /^([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]*)$/.exec(arg);
      const key = m ? (m[1] as string) : null;
      const src = (m ? (m[2] as string) : arg).trim();
      if (key !== null && !['name', 'color', 'who_color', 'image'].includes(key)) {
        this.warn(line, col, `Paramètre « ${key} » ignoré par Character`);
        continue;
      }
      let value: Value;
      try {
        value = evalExpression(src, new ObjectScope());
      } catch (error) {
        throw new ParseError(`Argument de Character invalide : ${(error as Error).message}`, col);
      }
      if (value !== null && typeof value !== 'string') {
        throw new ParseError(`Argument de Character invalide : texte attendu pour « ${key ?? 'nom'} »`, col);
      }
      if (key === null || key === 'name') {
        if (key === null && positional++ > 0) this.warn(line, col, 'Argument positionnel ignoré par Character');
        else def.name = value;
      } else if (key === 'color' || key === 'who_color') {
        if (value !== null && !COLOR_RE.test(value)) {
          this.warn(line, col, `Couleur invalide : « ${value} » (format #rrggbb attendu)`);
        }
        def.color = value;
      } else {
        def.image = value;
      }
    }
    return def;
  }

  private image(s: Scanner, pos: SourcePos): VNNode {
    const tag = s.expectWord("Tag d'image");
    const attrs: string[] = [];
    while (!s.eof() && s.peek() !== '=') attrs.push(s.expectWord("Attribut d'image"));
    if (!s.eat('=')) throw new ParseError("« = » attendu après le nom de l'image", s.column);
    if (!s.isQuote()) throw new ParseError("Chaîne attendue après « = » (alias d'asset ou chemin)", s.column + 1);
    const ref = s.string();
    s.end();
    if (!ref.trim()) throw new ParseError("Référence d'image vide", pos.column);
    return { kind: 'image', ...pos, tag, attrs, ref };
  }

  private scene(s: Scanner, pos: SourcePos): VNNode {
    const words: string[] = [];
    let transition: string | null = null;
    while (!s.eof()) {
      const col = s.column + 1;
      const w = s.expectWord("Nom d'image");
      if (w === 'with') {
        transition = this.transitionName(s, pos.line);
        s.end();
      } else if (w === 'at') {
        s.expectWord('Position');
        this.warn(pos.line, col, '« at » est ignoré par « scene »');
      } else words.push(w);
    }
    return { kind: 'scene', ...pos, image: words.length ? words : null, transition };
  }

  private show(s: Scanner, pos: SourcePos): VNNode {
    const col = s.column + 1;
    const tag = s.expectWord("Nom d'image");
    if (tag === 'at' || tag === 'with') throw new ParseError("Nom d'image attendu après « show »", col);
    const attrs: string[] = [];
    let at: string | null = null;
    let transition: string | null = null;
    while (!s.eof()) {
      const w = s.expectWord("Attribut d'image");
      if (w === 'at') at = this.positionName(s, pos.line);
      else if (w === 'with') transition = this.transitionName(s, pos.line);
      else attrs.push(w);
    }
    return { kind: 'show', ...pos, tag, attrs, at, transition };
  }

  private play(keyword: 'play' | 'voice', s: Scanner, pos: SourcePos): VNNode {
    const channel = keyword === 'voice' ? 'voice' : this.channel(s);
    const ref = s.string();
    if (!ref.trim()) throw new ParseError('Référence audio vide', pos.column);
    let fadein: number | null = null;
    let loop: boolean | null = keyword === 'voice' ? false : null;
    while (!s.eof()) {
      const col = s.column + 1;
      const opt = s.expectWord('Option');
      if (opt === 'fadein') fadein = s.expectNumber('fadein');
      else if (opt === 'fadeout') s.expectNumber('fadeout');
      else if (opt === 'loop') loop = true;
      else if (opt === 'noloop') loop = false;
      else throw new ParseError(`Option inconnue pour « play » : « ${opt} »`, col);
    }
    return { kind: 'play', ...pos, channel, ref, fadein, loop };
  }

  private channel(s: Scanner): AudioChannelName {
    const col = s.column + 1;
    const name = s.expectWord('Canal audio (music, sound ou voice)');
    const channel = CHANNELS[name];
    if (!channel) throw new ParseError(`Canal audio inconnu : « ${name} » (music, sound ou voice)`, col);
    return channel;
  }

  private transitionName(s: Scanner, line: number): string {
    const col = s.column + 1;
    const word = s.expectWord('Nom de transition');
    const name = word === 'None' ? 'none' : word;
    if (!isTransition(name)) {
      this.warn(line, col, `Transition inconnue : « ${word} » (disponibles : ${VN_TRANSITIONS.join(', ')})`);
    }
    return name;
  }

  private positionName(s: Scanner, line: number): string {
    const col = s.column + 1;
    const name = s.expectWord('Position');
    if (!isPosition(name)) {
      this.warn(line, col, `Position inconnue : « ${name} » (disponibles : ${VN_POSITIONS.join(', ')})`);
    }
    return name;
  }

  // -------------------------------------------------------------------------
  // Menus
  // -------------------------------------------------------------------------

  private menu(s: Scanner, raw: RawLine, pos: SourcePos): MenuNode {
    let label: string | null = null;
    if (s.peek() !== ':' && !s.eof()) {
      const col = s.column + 1;
      label = s.expectWord('Nom de menu');
      if (!LABEL_RE.test(label)) throw new ParseError(`Nom de menu invalide : « ${label} »`, col);
    }
    const hasColon = s.eat(':');
    s.end('« menu »');
    if (!hasColon) this.report(raw.line, raw.indent + raw.text.length, '« : » attendu à la fin de la ligne');
    const node: MenuNode = { kind: 'menu', ...pos, label, caption: null, choices: [] };
    for (const child of raw.children) {
      const cs = new Scanner(child.text, child.indent + 1);
      const isChoice = cs.isQuote() && (child.text.endsWith(':') || child.children.length > 0);
      if (isChoice) {
        const choice = this.choice(child);
        if (choice) node.choices.push(choice);
        continue;
      }
      const caption = this.statement(child, false);
      if (!caption) continue;
      if (caption.kind !== 'say') {
        this.report(
          child.line,
          child.indent + 1,
          'Un menu ne peut contenir qu\'une légende (réplique) et des choix « "libellé": »',
        );
      } else if (node.choices.length > 0) {
        this.report(child.line, child.indent + 1, 'La légende du menu doit précéder les choix');
      } else if (node.caption) {
        this.report(child.line, child.indent + 1, "Un menu ne peut avoir qu'une seule légende");
      } else {
        node.caption = caption;
      }
    }
    if (node.choices.length === 0) this.report(pos.line, pos.column, 'Menu sans choix');
    return node;
  }

  private choice(raw: RawLine): MenuChoiceNode | null {
    const s = new Scanner(raw.text, raw.indent + 1);
    try {
      const text = s.string();
      const col = s.column + 1;
      const rest = s.rest();
      const hasColon = rest.endsWith(':');
      const head = (hasColon ? rest.slice(0, -1) : rest).trim();
      let cond: string | null = null;
      if (head) {
        if (!/^if\b/.test(head)) {
          throw new ParseError('« if CONDITION » ou « : » attendu après le libellé du choix', col);
        }
        cond = head.slice(2).trim();
        if (!cond) throw new ParseError('Condition attendue après « if »', col + 2);
        this.checkExpr(cond, raw.line, col + 3);
      }
      if (!hasColon) this.report(raw.line, raw.indent + raw.text.length, '« : » attendu à la fin du choix');
      this.checkText(text, raw.line, raw.indent + 1);
      return { ...posOf(raw), text, cond, body: this.body(raw) };
    } catch (error) {
      if (!(error instanceof ParseError)) throw error;
      this.report(raw.line, error.column, error.message);
      this.block(raw.children, false);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Vérifications d'expressions et de textes
  // -------------------------------------------------------------------------

  private checkExpr(src: string, line: number, column: number, statement = false): void {
    try {
      if (statement) parseStatement(src);
      else parseExpression(src);
    } catch (error) {
      const offset = error instanceof ExprError ? error.position : 0;
      const message = error instanceof Error ? error.message : String(error);
      this.report(line, column + offset, `Expression invalide : ${message}`);
    }
  }

  /** Vérifie la syntaxe des interpolations `[expr]` d'un texte. */
  private checkText(text: string, line: number, column: number): void {
    const { segments, unclosed } = extractInterpolations(text);
    for (const seg of segments) {
      if (!seg.expr.trim()) {
        const message = 'Interpolation vide « [] » (utilisez « [[ » pour un crochet littéral)';
        this.report(line, column + seg.start + 1, message);
      } else this.checkExpr(seg.expr, line, column + seg.start + 2);
    }
    if (unclosed !== null) {
      this.warn(line, column + unclosed + 1, 'Crochet « [ » non fermé (utilisez « [[ » pour un crochet littéral)');
    }
  }
}

/** Index de la parenthèse fermante correspondant à `open` (ou -1). */
function matchParen(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i >= 0 && i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if ((c === ')' || c === ']' || c === '}') && --depth === 0) return i;
  }
  return -1;
}

/** Découpe une liste d'arguments aux virgules de premier niveau. */
function splitArgs(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      out.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  out.push(inner.slice(start));
  return out.map((a) => a.trim()).filter(Boolean);
}
