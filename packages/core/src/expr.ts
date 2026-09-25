/**
 * Langage d'expressions sûr (syntaxe inspirée de Python) utilisé par les scripts de jeu.
 * Aucun `eval` : l'expression est analysée en AST puis interprétée avec une liste blanche de
 * fonctions et de méthodes. Les accès aux propriétés dangereuses (`__proto__`, `constructor`…)
 * sont interdits.
 *
 * Exemples : `score >= 10 and not met_boss`, `name.upper()`, `items + ["clé"]`, `x if y else z`.
 * Instructions : `affection += 1`, `inventory.append("potion")`, `player["hp"] = 10`.
 */

export type Value = null | boolean | number | string | Value[] | { [key: string]: Value };

export class ExprError extends Error {
  constructor(
    message: string,
    public readonly source: string,
    public readonly position: number,
  ) {
    super(`${message} (position ${position} dans « ${source} »)`);
    this.name = 'ExprError';
  }
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

type TokenType = 'num' | 'str' | 'name' | 'op' | 'eof';
interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

const OPERATORS = [
  '**=', '//=', '**', '//', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '&&', '||',
  '+', '-', '*', '/', '%', '<', '>', '=', '(', ')', '[', ']', '{', '}', ',', '.', ':', '!',
];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c === '#') break; // commentaire jusqu'à la fin
    const start = i;
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      while (i < src.length && /[0-9_]/.test(src[i] as string)) i++;
      if (src[i] === '.' && /[0-9]/.test(src[i + 1] ?? '')) {
        i++;
        while (i < src.length && /[0-9_]/.test(src[i] as string)) i++;
      }
      if (src[i] === 'e' || src[i] === 'E') {
        const save = i;
        i++;
        if (src[i] === '+' || src[i] === '-') i++;
        if (/[0-9]/.test(src[i] ?? '')) {
          while (i < src.length && /[0-9]/.test(src[i] as string)) i++;
        } else i = save;
      }
      tokens.push({ type: 'num', value: src.slice(start, i).replace(/_/g, ''), pos: start });
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      let out = '';
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') {
          const n = src[i + 1];
          out += n === 'n' ? '\n' : n === 't' ? '\t' : (n ?? '');
          i += 2;
        } else {
          out += src[i];
          i++;
        }
      }
      if (src[i] !== c) throw new ExprError('Chaîne non terminée', src, start);
      i++;
      tokens.push({ type: 'str', value: out, pos: start });
      continue;
    }
    if (/[A-Za-z_À-ɏ]/.test(c)) {
      while (i < src.length && /[A-Za-z0-9_À-ɏ]/.test(src[i] as string)) i++;
      tokens.push({ type: 'name', value: src.slice(start, i), pos: start });
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`Caractère inattendu « ${c} »`, src, i);
    tokens.push({ type: 'op', value: op, pos: i });
    i += op.length;
  }
  tokens.push({ type: 'eof', value: '', pos: src.length });
  return tokens;
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export type Node =
  | { kind: 'lit'; value: Value }
  | { kind: 'name'; name: string; pos: number }
  | { kind: 'list'; items: Node[] }
  | { kind: 'dict'; entries: [Node, Node][] }
  | { kind: 'unary'; op: string; arg: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'logical'; op: 'and' | 'or'; left: Node; right: Node }
  | { kind: 'compare'; ops: string[]; operands: Node[] }
  | { kind: 'cond'; test: Node; then: Node; otherwise: Node }
  | { kind: 'member'; object: Node; prop: string; pos: number }
  | { kind: 'index'; object: Node; index: Node }
  | { kind: 'call'; callee: Node; args: Node[]; pos: number };

export type Statement =
  | { kind: 'assign'; op: string; target: Node; value: Node }
  | { kind: 'expr'; expr: Node };

const KEYWORD_LITERALS: Record<string, Value> = {
  True: true, False: false, None: null, true: true, false: false, null: null,
};

class Parser {
  private i = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly src: string,
  ) {}

  private peek(): Token {
    return this.tokens[this.i] as Token;
  }
  private next(): Token {
    return this.tokens[this.i++] as Token;
  }
  private isOp(value: string): boolean {
    const t = this.peek();
    return t.type === 'op' && t.value === value;
  }
  private isName(value: string): boolean {
    const t = this.peek();
    return t.type === 'name' && t.value === value;
  }
  private expectOp(value: string): void {
    const t = this.next();
    if (t.type !== 'op' || t.value !== value) {
      throw new ExprError(`« ${value} » attendu, trouvé « ${t.value || 'fin'} »`, this.src, t.pos);
    }
  }
  private fail(message: string): never {
    throw new ExprError(message, this.src, this.peek().pos);
  }

  parseStatement(): Statement {
    const expr = this.parseExpression();
    const t = this.peek();
    if (t.type === 'op' && ['=', '+=', '-=', '*=', '/=', '//=', '%=', '**='].includes(t.value)) {
      if (expr.kind !== 'name' && expr.kind !== 'member' && expr.kind !== 'index') {
        this.fail('Cible d\'affectation invalide');
      }
      this.next();
      const value = this.parseExpression();
      this.end();
      return { kind: 'assign', op: t.value, target: expr, value };
    }
    this.end();
    return { kind: 'expr', expr };
  }

  parseStandalone(): Node {
    const expr = this.parseExpression();
    this.end();
    return expr;
  }

  private end(): void {
    if (this.peek().type !== 'eof') this.fail(`Jeton inattendu « ${this.peek().value} »`);
  }

  parseExpression(): Node {
    const value = this.parseOr();
    if (this.isName('if')) {
      this.next();
      const test = this.parseOr();
      if (!this.isName('else')) this.fail('« else » attendu dans l\'expression conditionnelle');
      this.next();
      const otherwise = this.parseExpression();
      return { kind: 'cond', test, then: value, otherwise };
    }
    return value;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.isName('or') || this.isOp('||')) {
      this.next();
      left = { kind: 'logical', op: 'or', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseNot();
    while (this.isName('and') || this.isOp('&&')) {
      this.next();
      left = { kind: 'logical', op: 'and', left, right: this.parseNot() };
    }
    return left;
  }

  private parseNot(): Node {
    if (this.isName('not') || this.isOp('!')) {
      this.next();
      return { kind: 'unary', op: 'not', arg: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): Node {
    const first = this.parseAdditive();
    const ops: string[] = [];
    const operands: Node[] = [first];
    for (;;) {
      const t = this.peek();
      let op: string | null = null;
      if (t.type === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(t.value)) {
        op = t.value;
        this.next();
      } else if (this.isName('in')) {
        op = 'in';
        this.next();
      } else if (this.isName('not') && this.tokens[this.i + 1]?.value === 'in') {
        op = 'not in';
        this.next();
        this.next();
      } else if (this.isName('is')) {
        this.next();
        if (this.isName('not')) {
          this.next();
          op = '!=';
        } else op = '==';
      }
      if (!op) break;
      ops.push(op);
      operands.push(this.parseAdditive());
    }
    return ops.length === 0 ? first : { kind: 'compare', ops, operands };
  }

  private parseAdditive(): Node {
    let left = this.parseMultiplicative();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next().value;
      left = { kind: 'binary', op, left, right: this.parseMultiplicative() };
    }
    return left;
  }

  private parseMultiplicative(): Node {
    let left = this.parseUnary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('//') || this.isOp('%')) {
      const op = this.next().value;
      left = { kind: 'binary', op, left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): Node {
    if (this.isOp('-') || this.isOp('+')) {
      const op = this.next().value;
      return { kind: 'unary', op, arg: this.parseUnary() };
    }
    return this.parsePower();
  }

  private parsePower(): Node {
    const base = this.parsePostfix();
    if (this.isOp('**')) {
      this.next();
      return { kind: 'binary', op: '**', left: base, right: this.parseUnary() };
    }
    return base;
  }

  private parsePostfix(): Node {
    let node = this.parsePrimary();
    for (;;) {
      if (this.isOp('.')) {
        this.next();
        const t = this.next();
        if (t.type !== 'name') throw new ExprError('Nom de propriété attendu', this.src, t.pos);
        node = { kind: 'member', object: node, prop: t.value, pos: t.pos };
      } else if (this.isOp('[')) {
        this.next();
        const index = this.parseExpression();
        this.expectOp(']');
        node = { kind: 'index', object: node, index };
      } else if (this.isOp('(')) {
        const pos = this.next().pos;
        const args: Node[] = [];
        while (!this.isOp(')')) {
          args.push(this.parseExpression());
          if (!this.isOp(',')) break;
          this.next();
        }
        this.expectOp(')');
        node = { kind: 'call', callee: node, args, pos };
      } else break;
    }
    return node;
  }

  private parsePrimary(): Node {
    const t = this.next();
    switch (t.type) {
      case 'num':
        return { kind: 'lit', value: Number(t.value) };
      case 'str':
        return { kind: 'lit', value: t.value };
      case 'name':
        if (Object.hasOwn(KEYWORD_LITERALS, t.value)) return { kind: 'lit', value: KEYWORD_LITERALS[t.value] as Value };
        if (['and', 'or', 'not', 'in', 'if', 'else', 'is'].includes(t.value)) {
          throw new ExprError(`Mot-clé « ${t.value} » inattendu`, this.src, t.pos);
        }
        return { kind: 'name', name: t.value, pos: t.pos };
      case 'op':
        if (t.value === '(') {
          const expr = this.parseExpression();
          this.expectOp(')');
          return expr;
        }
        if (t.value === '[') {
          const items: Node[] = [];
          while (!this.isOp(']')) {
            items.push(this.parseExpression());
            if (!this.isOp(',')) break;
            this.next();
          }
          this.expectOp(']');
          return { kind: 'list', items };
        }
        if (t.value === '{') {
          const entries: [Node, Node][] = [];
          while (!this.isOp('}')) {
            const key = this.parseExpression();
            this.expectOp(':');
            entries.push([key, this.parseExpression()]);
            if (!this.isOp(',')) break;
            this.next();
          }
          this.expectOp('}');
          return { kind: 'dict', entries };
        }
        throw new ExprError(`Opérateur « ${t.value} » inattendu`, this.src, t.pos);
      default:
        throw new ExprError('Fin d\'expression inattendue', this.src, t.pos);
    }
  }
}

const exprCache = new Map<string, Node>();
const stmtCache = new Map<string, Statement>();

/** Analyse une expression (résultat mis en cache). */
export function parseExpression(source: string): Node {
  let node = exprCache.get(source);
  if (!node) {
    node = new Parser(tokenize(source), source).parseStandalone();
    exprCache.set(source, node);
  }
  return node;
}

/** Analyse une instruction (affectation ou expression). */
export function parseStatement(source: string): Statement {
  let stmt = stmtCache.get(source);
  if (!stmt) {
    stmt = new Parser(tokenize(source), source).parseStatement();
    stmtCache.set(source, stmt);
  }
  return stmt;
}

// ---------------------------------------------------------------------------
// Évaluation
// ---------------------------------------------------------------------------

/** Portée de variables consultée et modifiée par l'évaluateur. */
export interface Scope {
  get(name: string): Value | undefined;
  set(name: string, value: Value): void;
  has(name: string): boolean;
}

/** Portée simple adossée à un objet. */
export class ObjectScope implements Scope {
  constructor(public readonly vars: Record<string, Value> = {}) {}
  get(name: string): Value | undefined {
    return Object.hasOwn(this.vars, name) ? this.vars[name] : undefined;
  }
  set(name: string, value: Value): void {
    assertSafeKey(name);
    this.vars[name] = value;
  }
  has(name: string): boolean {
    return Object.hasOwn(this.vars, name);
  }
}

export interface EvalOptions {
  /** Source de hasard pour `random()`, `randint()`, `choice()` (par défaut Math.random). */
  random?: () => number;
  /** Fonctions supplémentaires exposées aux scripts. */
  functions?: Record<string, (...args: Value[]) => Value>;
  /** Si vrai, une variable inconnue vaut `null` au lieu de lever une erreur. */
  lenientNames?: boolean;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype', '__defineGetter__', '__defineSetter__']);

function assertSafeKey(key: string): void {
  if (FORBIDDEN_KEYS.has(key)) throw new Error(`Accès interdit à « ${key} »`);
}

export function isTruthy(v: Value | undefined): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

export function deepEqual(a: Value | undefined, b: Value | undefined): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

export function toDisplayString(v: Value | undefined): string {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function typeName(v: Value | undefined): string {
  if (v === null || v === undefined) return 'None';
  if (Array.isArray(v)) return 'list';
  return typeof v === 'object' ? 'dict' : typeof v;
}

function num(v: Value | undefined, what: string): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new Error(`${what} : nombre attendu, obtenu ${typeName(v)}`);
}

function compareValues(a: Value | undefined, b: Value | undefined): number {
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return num(a, 'comparaison') - num(b, 'comparaison');
}

function containment(needle: Value | undefined, haystack: Value | undefined): boolean {
  if (typeof haystack === 'string') return typeof needle === 'string' && haystack.includes(needle);
  if (Array.isArray(haystack)) return haystack.some((x) => deepEqual(x, needle));
  if (haystack && typeof haystack === 'object') return typeof needle === 'string' && Object.hasOwn(haystack, needle);
  throw new Error(`« in » impossible sur ${typeName(haystack)}`);
}

const BUILTINS: Record<string, (opts: EvalOptions, ...args: Value[]) => Value> = {
  len: (_o, v) => {
    if (typeof v === 'string' || Array.isArray(v)) return v.length;
    if (v && typeof v === 'object') return Object.keys(v).length;
    throw new Error(`len() impossible sur ${typeName(v)}`);
  },
  min: (_o, ...args) => {
    const list = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    return Math.min(...list.map((x) => num(x, 'min')));
  },
  max: (_o, ...args) => {
    const list = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    return Math.max(...list.map((x) => num(x, 'max')));
  },
  abs: (_o, v) => Math.abs(num(v, 'abs')),
  round: (_o, v, digits) => {
    const f = 10 ** (typeof digits === 'number' ? digits : 0);
    return Math.round(num(v, 'round') * f) / f;
  },
  floor: (_o, v) => Math.floor(num(v, 'floor')),
  ceil: (_o, v) => Math.ceil(num(v, 'ceil')),
  int: (_o, v) => (typeof v === 'string' ? parseInt(v, 10) || 0 : Math.trunc(num(v, 'int'))),
  float: (_o, v) => (typeof v === 'string' ? parseFloat(v) || 0 : num(v, 'float')),
  str: (_o, v) => toDisplayString(v),
  bool: (_o, v) => isTruthy(v),
  random: (o) => (o.random ?? Math.random)(),
  randint: (o, a, b) => {
    const lo = num(a, 'randint');
    const hi = num(b, 'randint');
    return lo + Math.floor((o.random ?? Math.random)() * (hi - lo + 1));
  },
  choice: (o, list) => {
    if (!Array.isArray(list) || list.length === 0) throw new Error('choice() attend une liste non vide');
    return list[Math.floor((o.random ?? Math.random)() * list.length)] as Value;
  },
  range: (_o, a, b, step) => {
    const start = b === undefined ? 0 : num(a, 'range');
    const stop = b === undefined ? num(a, 'range') : num(b, 'range');
    const s = step === undefined ? 1 : num(step, 'range');
    if (s === 0) throw new Error('range() : pas nul');
    const out: number[] = [];
    for (let i = start; s > 0 ? i < stop : i > stop; i += s) {
      out.push(i);
      if (out.length > 10000) throw new Error('range() trop grand');
    }
    return out;
  },
};

function callMethod(target: Value, method: string, args: Value[]): Value {
  if (Array.isArray(target)) {
    switch (method) {
      case 'append':
        target.push(args[0] ?? null);
        return null;
      case 'pop': {
        const i = args.length ? num(args[0], 'pop') : target.length - 1;
        const [removed] = target.splice(i < 0 ? target.length + i : i, 1);
        return removed ?? null;
      }
      case 'remove': {
        const idx = target.findIndex((x) => deepEqual(x, args[0]));
        if (idx >= 0) target.splice(idx, 1);
        return null;
      }
      case 'insert':
        target.splice(num(args[0], 'insert'), 0, args[1] ?? null);
        return null;
      case 'index':
        return target.findIndex((x) => deepEqual(x, args[0]));
      case 'count':
        return target.filter((x) => deepEqual(x, args[0])).length;
      case 'contains':
      case 'includes':
        return target.some((x) => deepEqual(x, args[0]));
      case 'clear':
        target.length = 0;
        return null;
      case 'join':
        return target.map(toDisplayString).join(typeof args[0] === 'string' ? args[0] : '');
    }
  } else if (typeof target === 'string') {
    switch (method) {
      case 'upper':
        return target.toUpperCase();
      case 'lower':
        return target.toLowerCase();
      case 'strip':
        return target.trim();
      case 'capitalize':
        return target.charAt(0).toUpperCase() + target.slice(1);
      case 'startswith':
        return target.startsWith(String(args[0] ?? ''));
      case 'endswith':
        return target.endsWith(String(args[0] ?? ''));
      case 'replace':
        return target.split(String(args[0] ?? '')).join(String(args[1] ?? ''));
      case 'split':
        return target.split(typeof args[0] === 'string' ? args[0] : /\s+/);
      case 'join':
        return Array.isArray(args[0]) ? args[0].map(toDisplayString).join(target) : '';
      case 'format': {
        let n = 0;
        return target.replace(/\{\}/g, () => toDisplayString(args[n++]));
      }
    }
  } else if (target && typeof target === 'object') {
    switch (method) {
      case 'get': {
        const key = String(args[0]);
        return Object.hasOwn(target, key) ? (target[key] as Value) : (args[1] ?? null);
      }
      case 'keys':
        return Object.keys(target);
      case 'values':
        return Object.values(target);
      case 'items':
        return Object.entries(target).map(([k, v]) => [k, v]);
    }
  }
  throw new Error(`Méthode « ${method} » inconnue pour ${typeName(target)}`);
}

export function evaluate(node: Node, scope: Scope, options: EvalOptions = {}): Value {
  switch (node.kind) {
    case 'lit':
      return node.value;
    case 'name': {
      if (scope.has(node.name)) return scope.get(node.name) ?? null;
      if (options.lenientNames) return null;
      throw new Error(`Variable inconnue « ${node.name} »`);
    }
    case 'list':
      return node.items.map((n) => evaluate(n, scope, options));
    case 'dict': {
      const out: Record<string, Value> = {};
      for (const [k, v] of node.entries) {
        const key = toDisplayString(evaluate(k, scope, options));
        assertSafeKey(key);
        out[key] = evaluate(v, scope, options);
      }
      return out;
    }
    case 'unary': {
      const v = evaluate(node.arg, scope, options);
      if (node.op === 'not') return !isTruthy(v);
      if (node.op === '-') return -num(v, 'négation');
      return num(v, '+');
    }
    case 'logical': {
      const left = evaluate(node.left, scope, options);
      if (node.op === 'and') return isTruthy(left) ? evaluate(node.right, scope, options) : left;
      return isTruthy(left) ? left : evaluate(node.right, scope, options);
    }
    case 'cond':
      return isTruthy(evaluate(node.test, scope, options))
        ? evaluate(node.then, scope, options)
        : evaluate(node.otherwise, scope, options);
    case 'compare': {
      let left = evaluate(node.operands[0] as Node, scope, options);
      for (let i = 0; i < node.ops.length; i++) {
        const right = evaluate(node.operands[i + 1] as Node, scope, options);
        const op = node.ops[i];
        let ok: boolean;
        switch (op) {
          case '==': ok = deepEqual(left, right); break;
          case '!=': ok = !deepEqual(left, right); break;
          case '<': ok = compareValues(left, right) < 0; break;
          case '<=': ok = compareValues(left, right) <= 0; break;
          case '>': ok = compareValues(left, right) > 0; break;
          case '>=': ok = compareValues(left, right) >= 0; break;
          case 'in': ok = containment(left, right); break;
          case 'not in': ok = !containment(left, right); break;
          default: throw new Error(`Opérateur inconnu ${op}`);
        }
        if (!ok) return false;
        left = right;
      }
      return true;
    }
    case 'binary':
      return binaryOp(node.op, evaluate(node.left, scope, options), evaluate(node.right, scope, options));
    case 'member': {
      const obj = evaluate(node.object, scope, options);
      return readProperty(obj, node.prop);
    }
    case 'index': {
      const obj = evaluate(node.object, scope, options);
      const idx = evaluate(node.index, scope, options);
      return readIndex(obj, idx);
    }
    case 'call': {
      const args = node.args.map((a) => evaluate(a, scope, options));
      if (node.callee.kind === 'name') {
        const custom = options.functions?.[node.callee.name];
        if (custom && Object.hasOwn(options.functions!, node.callee.name)) return custom(...args);
        const builtin = BUILTINS[node.callee.name];
        if (builtin && Object.hasOwn(BUILTINS, node.callee.name)) return builtin(options, ...args);
        throw new Error(`Fonction inconnue « ${node.callee.name} »`);
      }
      if (node.callee.kind === 'member') {
        const target = evaluate(node.callee.object, scope, options);
        return callMethod(target, node.callee.prop, args);
      }
      throw new Error('Appel invalide');
    }
  }
}

function readProperty(obj: Value, prop: string): Value {
  assertSafeKey(prop);
  if (Array.isArray(obj) || typeof obj === 'string') {
    if (prop === 'length') return obj.length;
    throw new Error(`Propriété « ${prop} » inconnue pour ${typeName(obj)}`);
  }
  if (obj && typeof obj === 'object') return Object.hasOwn(obj, prop) ? (obj[prop] as Value) : null;
  throw new Error(`Impossible de lire « ${prop} » sur ${typeName(obj)}`);
}

function readIndex(obj: Value, idx: Value): Value {
  if (Array.isArray(obj) || typeof obj === 'string') {
    let i = num(idx, 'index');
    if (i < 0) i += obj.length;
    const v = obj[i];
    if (v === undefined) throw new Error(`Index ${idx} hors limites`);
    return v;
  }
  if (obj && typeof obj === 'object') {
    const key = toDisplayString(idx);
    assertSafeKey(key);
    return Object.hasOwn(obj, key) ? (obj[key] as Value) : null;
  }
  throw new Error(`Indexation impossible sur ${typeName(obj)}`);
}

function binaryOp(op: string, a: Value, b: Value): Value {
  switch (op) {
    case '+':
      if (typeof a === 'string' || typeof b === 'string') {
        if (typeof a === 'string' && typeof b === 'string') return a + b;
        return toDisplayString(a) + toDisplayString(b);
      }
      if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
      return num(a, '+') + num(b, '+');
    case '-':
      return num(a, '-') - num(b, '-');
    case '*':
      if (typeof a === 'string' && typeof b === 'number') return a.repeat(Math.max(0, b));
      if (Array.isArray(a) && typeof b === 'number') {
        const out: Value[] = [];
        for (let i = 0; i < b; i++) out.push(...a);
        return out;
      }
      return num(a, '*') * num(b, '*');
    case '/': {
      const d = num(b, '/');
      if (d === 0) throw new Error('Division par zéro');
      return num(a, '/') / d;
    }
    case '//': {
      const d = num(b, '//');
      if (d === 0) throw new Error('Division par zéro');
      return Math.floor(num(a, '//') / d);
    }
    case '%': {
      const d = num(b, '%');
      if (d === 0) throw new Error('Modulo par zéro');
      const x = num(a, '%');
      return ((x % d) + d) % d;
    }
    case '**':
      return num(a, '**') ** num(b, '**');
  }
  throw new Error(`Opérateur inconnu ${op}`);
}

function assignTo(target: Node, value: Value, scope: Scope, options: EvalOptions): void {
  if (target.kind === 'name') {
    scope.set(target.name, value);
    return;
  }
  if (target.kind === 'member') {
    const obj = evaluate(target.object, scope, options);
    assertSafeKey(target.prop);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error(`Impossible d'affecter « ${target.prop} » sur ${typeName(obj)}`);
    }
    obj[target.prop] = value;
    return;
  }
  if (target.kind === 'index') {
    const obj = evaluate(target.object, scope, options);
    const idx = evaluate(target.index, scope, options);
    if (Array.isArray(obj)) {
      let i = num(idx, 'index');
      if (i < 0) i += obj.length;
      if (i < 0 || i >= obj.length) throw new Error(`Index ${idx} hors limites`);
      obj[i] = value;
      return;
    }
    if (obj && typeof obj === 'object') {
      const key = toDisplayString(idx);
      assertSafeKey(key);
      obj[key] = value;
      return;
    }
    throw new Error(`Indexation impossible sur ${typeName(obj)}`);
  }
  throw new Error('Cible d\'affectation invalide');
}

/** Exécute une instruction (`x = 1`, `x += 2`, `inv.append("clé")`). Retourne la valeur produite. */
export function execute(source: string, scope: Scope, options: EvalOptions = {}): Value {
  const stmt = parseStatement(source);
  if (stmt.kind === 'expr') return evaluate(stmt.expr, scope, options);
  let value = evaluate(stmt.value, scope, options);
  if (stmt.op !== '=') {
    const current = evaluate(stmt.target, scope, options);
    value = binaryOp(stmt.op.slice(0, -1), current, value);
  }
  assignTo(stmt.target, value, scope, options);
  return value;
}

/** Évalue une expression source dans une portée. */
export function evalExpression(source: string, scope: Scope, options: EvalOptions = {}): Value {
  return evaluate(parseExpression(source), scope, options);
}

function findClosingBracket(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return i;
  }
  return -1;
}

/** Remplace les `[expr]` d'un texte par leur valeur (comme l'interpolation de Ren'Py). `[[` échappe. */
export function interpolate(text: string, scope: Scope, options: EvalOptions = {}): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '[' && text[i + 1] === '[') {
      out += '[';
      i += 2;
      continue;
    }
    if (c === '[') {
      const end = findClosingBracket(text, i);
      if (end < 0) {
        out += text.slice(i);
        break;
      }
      const expr = text.slice(i + 1, end);
      out += toDisplayString(evalExpression(expr, scope, { lenientNames: true, ...options }));
      i = end + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
