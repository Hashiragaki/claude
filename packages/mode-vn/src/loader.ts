import { normalizeProjectPath } from '@forge/core';
import type { Diagnostic, ProjectFiles } from '@forge/core';
import { compileProgram } from './compiler';
import { parseScript } from './parser';
import type { Program, ScriptAst } from './types';

export type ScriptReader = Pick<ProjectFiles, 'readText' | 'exists'>;

export interface LoadedScripts {
  /** Point d'entrée en premier, puis les fichiers inclus dans l'ordre de découverte. */
  scripts: ScriptAst[];
  sources: Record<string, string>;
  diagnostics: Diagnostic[];
}

export interface LoadedProgram {
  program: Program;
  sources: Record<string, string>;
  diagnostics: Diagnostic[];
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Chemin d'un `include` : relatif à la racine du projet, sinon au dossier du fichier qui inclut. */
async function resolveInclude(files: ScriptReader, from: string, path: string): Promise<string> {
  const candidates: string[] = [];
  for (const candidate of [path, dirname(from) ? `${dirname(from)}/${path}` : null]) {
    if (!candidate) continue;
    try {
      candidates.push(normalizeProjectPath(candidate));
    } catch {
      // chemin interdit : ignoré
    }
  }
  for (const candidate of candidates) {
    if (await files.exists(candidate).catch(() => false)) return candidate;
  }
  return candidates[0] ?? path;
}

/** Charge et analyse le script d'entrée et, récursivement, ses `include`. */
export async function loadScripts(files: ScriptReader, entry: string): Promise<LoadedScripts> {
  const result: LoadedScripts = { scripts: [], sources: {}, diagnostics: [] };
  const visited = new Set<string>();

  const visit = async (path: string, from: { file: string; line: number } | null): Promise<void> => {
    const report = (message: string) =>
      result.diagnostics.push({ file: from?.file ?? path, line: from?.line ?? 1, severity: 'error', message });
    let file: string;
    try {
      file = normalizeProjectPath(path);
    } catch {
      report(`Chemin de script invalide : « ${path} »`);
      return;
    }
    if (visited.has(file)) return;
    visited.add(file);
    let source: string;
    try {
      source = await files.readText(file);
    } catch {
      report(from ? `Fichier inclus introuvable : « ${path} »` : `Script introuvable : « ${path} »`);
      return;
    }
    result.sources[file] = source;
    const { ast, diagnostics } = parseScript(source, file);
    result.scripts.push(ast);
    result.diagnostics.push(...diagnostics);
    for (const node of ast.nodes) {
      if (node.kind !== 'include') continue;
      await visit(await resolveInclude(files, file, node.path), { file, line: node.line });
    }
  };

  await visit(entry, null);
  return result;
}

/** Charge, analyse et compile un projet VN à partir de son script d'entrée. */
export async function loadProgram(files: ScriptReader, entry: string): Promise<LoadedProgram> {
  const loaded = await loadScripts(files, entry);
  const compiled = compileProgram(loaded.scripts.length > 0 ? loaded.scripts : [{ file: entry, nodes: [] }]);
  return {
    program: compiled.program,
    sources: loaded.sources,
    diagnostics: [...loaded.diagnostics, ...compiled.diagnostics],
  };
}
