import { isTruthy, type EvalOptions, type Rng, type Scope, type Value } from '@forge/core';
import type { SelfSwitchLetter } from './schema';
import { assertSafeName, getSelfSwitch, itemCount, type GameState } from './state';

/**
 * Portée des scripts RPG : un nom désigne d'abord une variable, puis un interrupteur, puis les
 * valeurs intégrées (`gold` en lecture/écriture, `steps` en lecture). Un nom inconnu vaut 0
 * (comme dans RPG Maker : variables à 0, interrupteurs à OFF).
 *
 * Affectation : variable existante → variable ; interrupteur existant → interrupteur (booléen) ;
 * `gold` → or ; nouveau nom booléen → interrupteur ; sinon → nouvelle variable.
 */
export class RpgScope implements Scope {
  constructor(private readonly state: GameState) {}

  get(name: string): Value | undefined {
    const { variables, switches } = this.state;
    if (Object.hasOwn(variables, name)) return variables[name];
    if (Object.hasOwn(switches, name)) return switches[name] ?? false;
    if (name === 'gold') return this.state.gold;
    if (name === 'steps') return this.state.steps;
    return 0;
  }

  has(): boolean {
    return true;
  }

  set(name: string, value: Value): void {
    assertSafeName(name);
    const { variables, switches } = this.state;
    if (Object.hasOwn(variables, name)) variables[name] = value;
    else if (Object.hasOwn(switches, name)) switches[name] = isTruthy(value);
    else if (name === 'gold') this.state.gold = Math.max(0, Math.trunc(typeof value === 'number' ? value : 0));
    else if (name === 'steps') throw new Error('« steps » est en lecture seule');
    else if (typeof value === 'boolean') switches[name] = value;
    else variables[name] = value;
  }
}

/** Contexte d'exécution d'un script : carte et événement courants (interrupteurs locaux). */
export interface ScriptContext {
  state: GameState;
  mapId: string;
  eventId: string | null;
  rng?: Rng;
}

/** Fonctions supplémentaires exposées aux scripts et conditions RPG. */
export function scriptFunctions(ctx: ScriptContext): Record<string, (...args: Value[]) => Value> {
  const { state } = ctx;
  return {
    item_count: (id) => itemCount(state, String(id)),
    has_item: (id) => itemCount(state, String(id)) > 0,
    self_switch: (letter) =>
      ctx.eventId !== null ? getSelfSwitch(state, ctx.mapId, ctx.eventId, String(letter) as SelfSwitchLetter) : false,
    party_size: () => state.party.length,
    actor_level: (id) => state.party.find((a) => a.id === id)?.level ?? 0,
    actor_hp: (id) => state.party.find((a) => a.id === id)?.hp ?? 0,
  };
}

export function scriptOptions(ctx: ScriptContext): EvalOptions {
  const rng = ctx.rng;
  return {
    random: rng ? () => rng.next() : undefined,
    functions: scriptFunctions(ctx),
    lenientNames: true,
  };
}
