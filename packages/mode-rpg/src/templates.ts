import type { ProjectTemplate } from '@forge/core';
import { blankTemplate } from './templates/blank';
import { demoTemplate } from './templates/demo';

export { blankTemplate, buildBlankMap, BLANK_DATABASE, BLANK_SYSTEM } from './templates/blank';
export { demoTemplate, DEMO_DATABASE, DEMO_SYSTEM } from './templates/demo';
export { DEMO_POSITIONS, buildInnMap, buildVillageMap } from './templates/demoMaps';
export * from './templates/assets';

/** Modèles de projet du mode RPG : vide et démo. */
export const RPG_TEMPLATES: ProjectTemplate[] = [blankTemplate, demoTemplate];
