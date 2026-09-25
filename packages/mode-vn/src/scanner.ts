/** Erreur d'analyse interne (convertie en diagnostic, jamais propagée hors de l'analyseur). */
export class ParseError extends Error {
  constructor(
    message: string,
    public readonly column: number,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

const WORD_RE = /^[\p{L}\p{N}_][\p{L}\p{N}_.-]*/u;

/** Lecteur de jetons sur une seule ligne de script. */
export class Scanner {
  pos = 0;

  /** `baseColumn` : colonne (1-based) du premier caractère de `text`. */
  constructor(
    readonly text: string,
    readonly baseColumn: number,
  ) {}

  get column(): number {
    return this.baseColumn + this.pos;
  }

  private ws(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos] as string)) this.pos++;
  }

  eof(): boolean {
    this.ws();
    return this.pos >= this.text.length;
  }

  peek(): string {
    this.ws();
    return this.text[this.pos] ?? '';
  }

  isQuote(): boolean {
    const c = this.peek();
    return c === '"' || c === "'";
  }

  /** Mot (identifiant, tag d'image, nombre) ou `null`. */
  word(): string | null {
    this.ws();
    const m = WORD_RE.exec(this.text.slice(this.pos));
    if (!m) return null;
    this.pos += m[0].length;
    return m[0];
  }

  peekWord(): string | null {
    const save = this.pos;
    const w = this.word();
    this.pos = save;
    return w;
  }

  /** Mot obligatoire. */
  expectWord(what: string): string {
    const col = this.column;
    const w = this.word();
    if (!w) throw new ParseError(`${what} attendu`, this.eof() ? this.column : col);
    return w;
  }

  /** Nombre positif obligatoire. */
  expectNumber(what: string): number {
    this.ws();
    const col = this.column;
    const w = this.word();
    const n = w === null ? NaN : Number(w);
    if (!Number.isFinite(n) || n < 0) throw new ParseError(`${what} : nombre attendu`, col);
    return n;
  }

  eat(char: string): boolean {
    if (this.peek() === char) {
      this.pos++;
      return true;
    }
    return false;
  }

  /** Chaîne entre guillemets `"…"` ou apostrophes `'…'`, avec échappements `\n`, `\"`… */
  string(): string {
    this.ws();
    const start = this.column;
    const quote = this.text[this.pos];
    if (quote !== '"' && quote !== "'") throw new ParseError('Chaîne entre guillemets attendue', start);
    this.pos++;
    let out = '';
    while (this.pos < this.text.length) {
      const c = this.text[this.pos] as string;
      if (c === '\\') {
        const n = this.text[this.pos + 1];
        if (n === undefined) break;
        out += n === 'n' ? '\n' : n === 't' ? '\t' : n;
        this.pos += 2;
        continue;
      }
      if (c === quote) {
        this.pos++;
        return out;
      }
      out += c;
      this.pos++;
    }
    throw new ParseError('Chaîne non terminée', start);
  }

  /** Reste de la ligne (sans espaces de bord). */
  rest(): string {
    this.ws();
    const r = this.text.slice(this.pos).trim();
    this.pos = this.text.length;
    return r;
  }

  /** Vérifie qu'il ne reste rien sur la ligne. */
  end(context = "l'instruction"): void {
    if (this.eof()) return;
    throw new ParseError(`Texte inattendu après ${context} : « ${this.text.slice(this.pos).trim()} »`, this.column);
  }
}
