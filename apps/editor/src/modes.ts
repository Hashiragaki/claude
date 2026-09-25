import { ModeRegistry } from '@forge/core';
import { rpgMode } from '@forge/mode-rpg';
import { sandbox3dMode } from '@forge/mode-sandbox3d';
import { vnMode } from '@forge/mode-vn';

/** Modes de jeu disponibles dans le navigateur (les moteurs de rendu sont chargés à la demande). */
export const modes = new ModeRegistry([vnMode, rpgMode, sandbox3dMode]);
