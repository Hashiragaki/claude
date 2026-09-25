import { anim2dGenerator } from './anim2d';
import { musicGenerator, sfxGenerator } from './audio';
import { model3dGenerator } from './model3d';
import { charsetGenerator, imagePixelGenerator, tilesetGenerator } from './pixel';
import { imageSvgGenerator } from './svg';
import type { GeneratorDefinition } from './types';

/** Tous les générateurs d'assets disponibles, dans l'ordre d'affichage de l'éditeur. */
export const GENERATORS: readonly GeneratorDefinition[] = [
  imageSvgGenerator,
  imagePixelGenerator,
  charsetGenerator,
  tilesetGenerator,
  anim2dGenerator,
  sfxGenerator,
  musicGenerator,
  model3dGenerator,
];

export function getGenerator(id: string): GeneratorDefinition | undefined {
  return GENERATORS.find((g) => g.id === id);
}
