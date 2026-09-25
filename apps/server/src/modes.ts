import { ModeRegistry } from '@forge/core';
import { platformerMode } from '@forge/mode-platformer';
import { rpgMode } from '@forge/mode-rpg';
import { sandbox3dMode } from '@forge/mode-sandbox3d';
import { vnMode } from '@forge/mode-vn';

/** Modes de jeu préinstallés. */
export function createModeRegistry(): ModeRegistry {
  return new ModeRegistry([vnMode, rpgMode, sandbox3dMode, platformerMode]);
}
