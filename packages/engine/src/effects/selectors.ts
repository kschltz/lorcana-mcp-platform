// Selector resolution for the effect DSL (SPEC §4).

import type { CardInstance, PlayerId } from "../types.js";
import type { Selector } from "./dsl.js";
import { hasKeyword, matchesSelectorBasic } from "../keywords.js";
import { findInstance, type Rt } from "../state.js";
import { selectorPool } from "./conditions.js";

export interface ResolveOptions {
  /** True when resolving targets of an opponent's effect: Ward cards are
   * excluded from *chosen* selection (they cannot be chosen by opposing
   * effects). Non-chosen effects are unaffected. */
  chosen?: boolean;
}

/** Resolve a Selector to matching card instances (deterministic order). */
export function resolveSelector(
  rt: Rt, sel: Selector, controller: PlayerId, opts: ResolveOptions = {},
): CardInstance[] {
  // Variable reference (engine extension, e.g. "$each" inside FOR_EACH).
  if (sel.ref) return [];
  const pool = selectorPool(rt, sel, controller);
  return pool.filter((c) => {
    if (!matchesSelectorBasic(rt, c, sel, controller)) return false;
    if (opts.chosen && c.owner !== controller && hasKeyword(rt, c, "Ward")) return false;
    return true;
  });
}

/** Apply the Vanish keyword: chosen targets owned by the opponent of the
 * effect controller that have Vanish are banished instead of affected.
 * Returns the surviving targets; banishment is performed by the caller-provided
 * callback so the interpreter can queue ON_BANISH triggers. */
export function applyVanish(
  rt: Rt, targets: CardInstance[], controller: PlayerId,
  banish: (inst: CardInstance) => void,
): CardInstance[] {
  const out: CardInstance[] = [];
  for (const t of targets) {
    if (t.owner !== controller && hasKeyword(rt, t, "Vanish")) {
      banish(t);
    } else {
      out.push(t);
    }
  }
  return out;
}

/** Map bound ids back to live instances (drops ids that no longer exist). */
export function idsToInstances(rt: Rt, ids: string[]): CardInstance[] {
  const out: CardInstance[] = [];
  for (const id of ids) {
    const loc = findInstance(rt.state, id);
    if (loc) out.push(loc.inst);
  }
  return out;
}
