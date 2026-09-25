import { evalExpression, isTruthy } from '@forge/core';
import type { CompareOp, Condition, PageConditions, RpgEvent, VariableCondition } from './schema';
import { RpgScope, scriptOptions, type ScriptContext } from './scope';
import { getSelfSwitch, getSwitch, getVariable, itemCount } from './state';

export type ConditionContext = ScriptContext;

export function compareNumbers(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case '>=':
      return a >= b;
    case '<=':
      return a <= b;
    case '==':
      return a === b;
    case '>':
      return a > b;
    case '<':
      return a < b;
    case '!=':
      return a !== b;
  }
}

function checkVariable(ctx: ConditionContext, cond: VariableCondition): boolean {
  return compareNumbers(getVariable(ctx.state, cond.name), cond.op, cond.value);
}

/** Évalue une condition de bloc `if` (une erreur de script est propagée). */
export function checkCondition(cond: Condition, ctx: ConditionContext): boolean {
  const { state } = ctx;
  if ('switch' in cond) return getSwitch(state, cond.switch) === (cond.value ?? true);
  if ('variable' in cond) return checkVariable(ctx, cond.variable);
  if ('item' in cond) return itemCount(state, cond.item) >= (cond.count ?? 1);
  if ('gold' in cond) return state.gold >= cond.gold;
  if ('selfSwitch' in cond) {
    const on = ctx.eventId !== null && getSelfSwitch(state, ctx.mapId, ctx.eventId, cond.selfSwitch);
    return on === (cond.value ?? true);
  }
  return isTruthy(evalExpression(cond.script, new RpgScope(state), scriptOptions(ctx)));
}

/** Vrai si toutes les conditions présentes d'une page sont remplies. */
export function checkPageConditions(conds: PageConditions | undefined, ctx: ConditionContext): boolean {
  if (!conds) return true;
  const { state } = ctx;
  if (conds.switch !== undefined && !getSwitch(state, conds.switch)) return false;
  if (conds.variable && !checkVariable(ctx, conds.variable)) return false;
  if (conds.item !== undefined && itemCount(state, conds.item) < 1) return false;
  if (conds.selfSwitch !== undefined) {
    if (ctx.eventId === null || !getSelfSwitch(state, ctx.mapId, ctx.eventId, conds.selfSwitch)) return false;
  }
  return true;
}

/** Index de la page active : la DERNIÈRE page dont les conditions sont vraies, ou -1. */
export function activePageIndex(event: RpgEvent, ctx: Omit<ConditionContext, 'eventId'>): number {
  const withEvent = { ...ctx, eventId: event.id };
  for (let i = event.pages.length - 1; i >= 0; i--) {
    if (checkPageConditions(event.pages[i]?.conditions, withEvent)) return i;
  }
  return -1;
}
