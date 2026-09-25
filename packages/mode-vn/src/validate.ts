import { AssetRegistry } from '@forge/core';
import type { Diagnostic, ProjectBundle } from '@forge/core';
import { resolveImageRef } from './compiler';
import { builtinImageColor } from './constants';
import { loadProgram } from './loader';
import { looksLikePath, resolveAudioAsset, resolveImageAsset } from './refs';
import type { AudioChannelName, Instruction } from './types';

/**
 * Vérifie un projet VN : erreurs de script (entrée + includes) et références d'images ou de sons
 * absentes des assets du projet.
 */
export async function validateBundle(bundle: ProjectBundle): Promise<Diagnostic[]> {
  const { program, diagnostics } = await loadProgram(bundle.files, bundle.manifest.entry);
  const assets = new AssetRegistry(bundle.manifest.assets, bundle.files);
  const out = [...diagnostics];
  const checked = new Set<string>();

  const fileExists = async (ref: string) => looksLikePath(ref) && (await bundle.files.exists(ref).catch(() => false));

  const checkImage = async (ins: Instruction, ref: string) => {
    const key = `image:${ref}`;
    if (checked.has(key)) return;
    checked.add(key);
    if (resolveImageAsset(assets, ref) || builtinImageColor(ref) !== null || (await fileExists(ref))) return;
    out.push({
      file: ins.file,
      line: ins.line,
      severity: 'warning',
      message: `Image introuvable : « ${ref} » (aucun asset image avec cet alias ; un substitut sera affiché)`,
    });
  };

  const checkAudio = async (ins: Instruction, ref: string, channel: AudioChannelName) => {
    const key = `audio:${ref}`;
    if (checked.has(key)) return;
    checked.add(key);
    if (resolveAudioAsset(assets, ref, channel) || (await fileExists(ref))) return;
    out.push({
      file: ins.file,
      line: ins.line,
      severity: 'warning',
      message: `Son introuvable : « ${ref} » (aucun asset audio avec cet alias)`,
    });
  };

  for (const ins of program.instructions) {
    if (ins.op === 'scene' && ins.image) {
      await checkImage(ins, resolveImageRef(program.images, ins.image[0] as string, ins.image.slice(1)));
    } else if (ins.op === 'show') {
      await checkImage(ins, resolveImageRef(program.images, ins.tag, ins.attrs));
    } else if (ins.op === 'play') {
      await checkAudio(ins, ins.ref, ins.channel);
    }
  }
  return out;
}
