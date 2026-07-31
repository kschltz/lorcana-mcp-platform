// Condition evaluation for the effect DSL (SPEC §4).

import type { CardInstance, PlayerId } from "../types.js";
import type { Condition, ConditionOp, Selector } from "./dsl.js";
import { matchesSelectorBasic, effStats, hasKeyword } from "../keywords.js";
import { activePlay, type Rt } from "../state.js";

function cmp(op: ConditionOp, a: number, b: number): boolean {
  switch (op) {
    case ">=": return a >= b;
    case "<=": return a <= b;
    case "==": return a === b;
  }
}

/** Candidate pool for a selector zone/who (no filtering applied here). */
export function selectorPool(rt: Rt, sel: Selector, controller: PlayerId): CardInstance[] {
  const who = sel.who;
  const pids: PlayerId[] =
    who === "any" ? ["p1", "p2"] : who === "self" ? [controller] : [controller === "p1" ? "p2" : "p1"];
  const out: CardInstance[] = [];
  for (const pid of pids) {
    const p = rt.state.players[pid];
    if (sel.zone === "play") out.push(...activePlay(rt.state, pid));
    else if (sel.zone === "hand") out.push(...p.hand);
    else out.push(...p.discard);
  }
  return out;
}

/** Evaluate a Condition against the game state from `controller`'s perspective. */
export function evalCondition(rt: Rt, cond: Condition, controller: PlayerId): boolean {
  switch (cond.kind) {
    case "count": {
      const n = selectorPool(rt, cond.selector, controller).filter((c) =>
        matchesSelectorBasic(rt, c, cond.selector, controller)).length;
      return cmp(cond.op, n, cond.value);
    }
    case "has-keyword": {
      return selectorPool(rt, cond.selector, controller).some((c) =>
        matchesSelectorBasic(rt, c, cond.selector, controller) && hasKeyword(rt, c, cond.keyword));
    }
    case "stat": {
      return selectorPool(rt, cond.selector, controller).some((c) => {
        if (!matchesSelectorBasic(rt, c, cond.selector, controller)) return false;
        const s = effStats(rt, c);
        const v = cond.stat === "strength" ? s.strength : cond.stat === "willpower" ? s.willpower : s.lore;
        return cmp(cond.op, v, cond.value);
      });
    }
  }
}
