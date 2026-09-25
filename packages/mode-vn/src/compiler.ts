import { hashString, normalizeAlias } from '@forge/core';
import type { Diagnostic } from '@forge/core';
import { parseScript } from './parser';
import type { Instruction, MenuNode, Program, SayData, SayNode, ScriptAst, VNNode } from './types';

export interface CompileResult {
  program: Program;
  diagnostics: Diagnostic[];
}

/** Clé normalisée d'une image (`Mina  Happy` → `mina happy`). */
export function imageKey(tag: string, attrs: readonly string[] = []): string {
  return normalizeAlias([tag, ...attrs].join(' '));
}

/**
 * Référence à charger pour une image : définition `image` exacte, sinon « tag attrs » tel quel
 * (l'AssetRegistry résout ensuite l'alias avec repli sur les préfixes, comme Ren'Py).
 */
export function resolveImageRef(images: Record<string, string>, tag: string, attrs: readonly string[] = []): string {
  const key = imageKey(tag, attrs);
  return Object.hasOwn(images, key) ? (images[key] as string) : key;
}

interface PendingRef {
  name: string;
  file: string;
  line: number;
  column: number;
}

/**
 * Compile un ou plusieurs scripts (le premier est le point d'entrée) en programme plat.
 * Les blocs `menu` / `if` deviennent des sauts : le compteur de programme est un simple entier.
 */
export function compileProgram(scripts: ScriptAst | ScriptAst[]): CompileResult {
  return new Compiler().compile(Array.isArray(scripts) ? scripts : [scripts]);
}

/** Analyse et compile un script isolé (sans suivre les `include`). */
export function compileSource(source: string, file = 'script.vn'): CompileResult {
  const parsed = parseScript(source, file);
  const compiled = compileProgram(parsed.ast);
  return { program: compiled.program, diagnostics: [...parsed.diagnostics, ...compiled.diagnostics] };
}

class Compiler {
  private readonly instructions: Instruction[] = [];
  private readonly labels: Record<string, number> = {};
  private readonly labelSites = new Map<string, { file: string; line: number }>();
  private readonly program: Omit<Program, 'instructions' | 'labels' | 'hash'> = {
    defines: [],
    defaults: [],
    images: {},
    files: [],
  };
  private readonly diagnostics: Diagnostic[] = [];
  private readonly jumps: PendingRef[] = [];
  private readonly speakers: PendingRef[] = [];
  private file = '';

  compile(scripts: ScriptAst[]): CompileResult {
    for (const script of scripts) {
      this.file = script.file;
      this.program.files.push(script.file);
      this.nodes(script.nodes);
      // Fin de fichier : équivaut à `return` (fin du jeu si la pile d'appels est vide).
      const last = lastLine(script.nodes);
      this.emit({ op: 'return' }, last);
    }
    this.checkReferences(scripts[0]?.file ?? 'script.vn');
    const { instructions, labels } = this;
    const hash = hashString(JSON.stringify({ instructions, labels })).toString(16).padStart(8, '0');
    return { program: { ...this.program, instructions, labels, hash }, diagnostics: this.diagnostics };
  }

  private report(
    line: number,
    column: number,
    message: string,
    severity: Diagnostic['severity'] = 'error',
    file = this.file,
  ): void {
    this.diagnostics.push({ file, line, column, severity, message });
  }

  private emit(ins: DistributiveOmit<Instruction, 'file' | 'line'>, line: number): number {
    this.instructions.push({ ...ins, file: this.file, line } as Instruction);
    return this.instructions.length - 1;
  }

  private nodes(nodes: VNNode[]): void {
    for (const node of nodes) this.node(node);
  }

  private registerLabel(name: string, line: number, column: number): void {
    if (name === '__proto__') {
      this.report(line, column, `Nom réservé : « ${name} »`);
      return;
    }
    const previous = this.labelSites.get(name);
    if (previous) {
      this.report(line, column, `Label « ${name} » déjà défini (${previous.file}, ligne ${previous.line})`);
      return;
    }
    this.labelSites.set(name, { file: this.file, line });
    this.labels[name] = this.instructions.length;
  }

  private node(node: VNNode): void {
    const { line } = node;
    switch (node.kind) {
      case 'define':
        this.program.defines.push({
          name: node.name,
          expr: node.expr,
          character: node.character,
          file: this.file,
          line,
        });
        break;
      case 'default':
        this.program.defaults.push({ name: node.name, expr: node.expr, file: this.file, line });
        break;
      case 'image': {
        const key = imageKey(node.tag, node.attrs);
        if (key === '__proto__') {
          this.report(line, node.column, `Nom réservé : « ${key} »`);
          break;
        }
        if (Object.hasOwn(this.program.images, key)) {
          this.report(line, node.column, `Image « ${key} » redéfinie`, 'warning');
        }
        this.program.images[key] = node.ref;
        break;
      }
      case 'include':
      case 'pass':
        break;
      case 'label':
        this.registerLabel(node.name, line, node.column);
        this.nodes(node.body);
        break;
      case 'say':
        this.emit({ op: 'say', ...this.sayData(node), transition: node.transition }, line);
        break;
      case 'centered':
        this.emit({ op: 'centered', text: node.text }, line);
        break;
      case 'menu':
        this.menu(node);
        break;
      case 'if': {
        const exits: number[] = [];
        node.branches.forEach((branch, i) => {
          const test =
            branch.cond === null ? -1 : this.emit({ op: 'gotoIfNot', cond: branch.cond, target: -1 }, branch.line);
          this.nodes(branch.body);
          // Le dernier bloc retombe directement après le `if`.
          if (i < node.branches.length - 1) exits.push(this.emit({ op: 'goto', target: -1 }, branch.line));
          if (test >= 0) this.patch(test, this.instructions.length);
        });
        for (const exit of exits) this.patch(exit, this.instructions.length);
        break;
      }
      case 'exec':
        this.emit({ op: 'exec', code: node.code }, line);
        break;
      case 'jump':
      case 'call':
        this.jumps.push({ name: node.label, file: this.file, line, column: node.column });
        this.emit({ op: node.kind, label: node.label }, line);
        break;
      case 'return':
        this.emit({ op: 'return' }, line);
        break;
      case 'scene':
        this.emit({ op: 'scene', image: node.image, transition: node.transition }, line);
        break;
      case 'show':
        this.emit({ op: 'show', tag: node.tag, attrs: node.attrs, at: node.at, transition: node.transition }, line);
        break;
      case 'hide':
        this.emit({ op: 'hide', tag: node.tag, transition: node.transition }, line);
        break;
      case 'with':
        this.emit({ op: 'with', transition: node.transition }, line);
        break;
      case 'pause':
        this.emit({ op: 'pause', seconds: node.seconds }, line);
        break;
      case 'play':
        this.emit({ op: 'play', channel: node.channel, ref: node.ref, fadein: node.fadein, loop: node.loop }, line);
        break;
      case 'stop':
        this.emit({ op: 'stop', channel: node.channel, fadeout: node.fadeout }, line);
        break;
      case 'window':
        this.emit({ op: 'window', shown: node.shown }, line);
        break;
    }
  }

  private sayData(node: SayNode): SayData {
    if (node.who !== null) {
      this.speakers.push({ name: node.who, file: this.file, line: node.line, column: node.column });
    }
    return { who: node.who, whoName: node.whoName, attrs: node.attrs, text: node.text };
  }

  private menu(node: MenuNode): void {
    if (node.label) this.registerLabel(node.label, node.line, node.column);
    const caption = node.caption ? this.sayData(node.caption) : null;
    const index = this.emit({ op: 'menu', caption, choices: [], end: -1 }, node.line);
    const menu = this.instructions[index] as Extract<Instruction, { op: 'menu' }>;
    const exits: number[] = [];
    node.choices.forEach((choice, i) => {
      menu.choices.push({ text: choice.text, cond: choice.cond, target: this.instructions.length });
      this.nodes(choice.body);
      if (i < node.choices.length - 1) exits.push(this.emit({ op: 'goto', target: -1 }, choice.line));
    });
    for (const exit of exits) this.patch(exit, this.instructions.length);
    menu.end = this.instructions.length;
  }

  private patch(index: number, target: number): void {
    const ins = this.instructions[index];
    if (ins && (ins.op === 'goto' || ins.op === 'gotoIfNot')) ins.target = target;
  }

  private checkReferences(entryFile: string): void {
    for (const ref of this.jumps) {
      if (!Object.hasOwn(this.labels, ref.name)) {
        this.report(ref.line, ref.column, `Label « ${ref.name} » introuvable`, 'error', ref.file);
      }
    }
    const known = new Set([...this.program.defines.map((d) => d.name), ...this.program.defaults.map((d) => d.name)]);
    for (const ref of this.speakers) {
      if (!known.has(ref.name)) {
        const hint = `ajoutez « define ${ref.name} = Character("…") »`;
        this.report(ref.line, ref.column, `Personnage « ${ref.name} » non défini (${hint})`, 'error', ref.file);
      }
    }
    if (!Object.hasOwn(this.labels, 'start')) {
      this.report(1, 1, 'Label « start » introuvable : le jeu ne pourra pas démarrer', 'warning', entryFile);
    }
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function lastLine(nodes: VNNode[]): number {
  let line = 1;
  const visit = (list: VNNode[]) => {
    for (const n of list) {
      line = Math.max(line, n.line);
      if (n.kind === 'label') visit(n.body);
      else if (n.kind === 'if') for (const b of n.branches) visit(b.body);
      else if (n.kind === 'menu') for (const c of n.choices) visit(c.body);
    }
  };
  visit(nodes);
  return line;
}
