import type { Command, EventPage, RpgEvent, RpgMap } from './schema';

/** Parcourt récursivement des commandes (blocs de choix, conditions, branches de combat). */
export function forEachCommand(commands: readonly Command[], visit: (command: Command) => void): void {
  for (const command of commands) {
    visit(command);
    switch (command.type) {
      case 'choice':
        for (const option of command.options) forEachCommand(option.commands, visit);
        break;
      case 'if':
        forEachCommand(command.then, visit);
        if (command.else) forEachCommand(command.else, visit);
        break;
      case 'battle':
        for (const branch of [command.onWin, command.onLose, command.onEscape]) {
          if (branch) forEachCommand(branch, visit);
        }
        break;
      default:
        break;
    }
  }
}

/** Parcourt toutes les commandes d'une carte avec leur événement et leur page. */
export function forEachMapCommand(
  map: RpgMap,
  visit: (command: Command, event: RpgEvent, page: EventPage, pageIndex: number) => void,
): void {
  for (const event of map.events) {
    event.pages.forEach((page, pageIndex) => forEachCommand(page.commands, (c) => visit(c, event, page, pageIndex)));
  }
}

/** Identifiants des cartes atteintes par les téléportations d'une carte. */
export function teleportTargets(map: RpgMap): string[] {
  const out = new Set<string>();
  forEachMapCommand(map, (c) => {
    if (c.type === 'teleport') out.add(c.map);
  });
  return [...out];
}
