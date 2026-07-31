// Effective keyword / stat computation: base card data + instance modifiers
// + continuous abilities of all cards in play (SPEC §3.3, §4).

import type { CardInstance, Keyword, Modifier, PlayerId } from "./types.js";
import type { ContinuousAbility } from "./effects/dsl.js";
import { activePlay, defOf, isWet, scriptOf, type Rt } from "./state.js";
import { evalCondition } from "./effects/conditions.js";

export interface KeywordEntry { name: Keyword; value?: number; }

export interface EffStats {
  strength: number;
  willpower: number;
  lore: number;
  moveCost: number;
  cost: number;
}

/** Zone/who/type/classification/name/filter match for a single instance.
 * Used by continuous abilities (no Ward/chosen logic here). */
export function matchesSelectorBasic(
  rt: Rt, inst: CardInstance,
  sel: { zone: string; who: string; type?: string; classification?: string; name?: string; filter?: string },
  controller: PlayerId,
): boolean {
  const state = rt.state;
  if (sel.zone !== "play") {
    if (inst.zone !== sel.zone) return false;
  } else {
    if (inst.zone !== "play") return false;
    // stacked-under cards are not independently in play
    const under = new Set<string>();
    for (const pid of ["p1", "p2"] as PlayerId[]) {
      for (const c of state.players[pid].play) for (const u of c.under ?? []) under.add(u);
    }
    if (under.has(inst.instanceId)) return false;
  }
  if (sel.who === "self" && inst.owner !== controller) return false;
  if (sel.who === "opponent" && inst.owner === controller) return false;
  const def = defOf(rt, inst.cardId);
  if (sel.type && def.type !== sel.type) return false;
  if (sel.classification && !def.classifications.includes(sel.classification)) return false;
  if (sel.name && def.name !== sel.name) return false;
  switch (sel.filter) {
    case "exerted": if (!inst.exerted) return false; break;
    case "ready": if (inst.exerted) return false; break;
    case "damaged": if (inst.damage <= 0) return false; break;
    case "undamaged": if (inst.damage > 0) return false; break;
    case "wet": if (!isWet(state, inst)) return false; break;
  }
  return true;
}

/** Continuous abilities from every card in play that apply to `inst`. */
function continuousModifiers(rt: Rt, inst: CardInstance): Array<{ ab: ContinuousAbility; sourceId: string }> {
  const out: Array<{ ab: ContinuousAbility; sourceId: string }> = [];
  for (const src of activePlay(rt.state)) {
    const script = scriptOf(rt, src.cardId);
    for (const ab of script.continuous ?? []) {
      if (ab.selector.self) {
        if (inst.instanceId !== src.instanceId) continue; // self-targeting continuous
      } else if (!matchesSelectorBasic(rt, inst, ab.selector, src.owner)) {
        continue;
      }
      if (ab.condition && !evalCondition(rt, ab.condition, src.owner, { self: src })) continue;
      out.push({ ab, sourceId: src.instanceId });
    }
  }
  return out;
}

/** All modifiers (instance + continuous) currently affecting `inst`. */
export function allModifiers(rt: Rt, inst: CardInstance): Modifier[] {
  const mods: Modifier[] = [...inst.modifiers];
  for (const { ab, sourceId } of continuousModifiers(rt, inst)) {
    mods.push({ id: `cont:${sourceId}`, source: sourceId, ...ab.modifier });
  }
  return mods;
}

/** Effective keywords: base script keywords + granted − removed. Parameterized
 * grants via GRANT_KEYWORD carry their value in Modifier.condition as
 * "grant:<Keyword>:<N>" (documented extension). */
export function effKeywords(rt: Rt, inst: CardInstance): KeywordEntry[] {
  const script = scriptOf(rt, inst.cardId);
  const result: KeywordEntry[] = (script.keywords ?? []).map((k) => ({ ...k }));
  const mods = allModifiers(rt, inst);
  const removed = new Set<Keyword>();
  for (const m of mods) {
    for (const rk of m.removeKeywords ?? []) removed.add(rk);
  }
  const kept = result.filter((k) => !removed.has(k.name));
  for (const m of mods) {
    for (const gk of m.grantKeywords ?? []) {
      if (removed.has(gk)) continue;
      if (kept.some((k) => k.name === gk)) continue;
      const entry: KeywordEntry = { name: gk };
      const gm = /^grant:([A-Za-z]+):(\d+)$/.exec(m.condition ?? "");
      if (gm && gm[1] === gk) entry.value = Number(gm[2]);
      kept.push(entry);
    }
  }
  return kept;
}

export function hasKeyword(rt: Rt, inst: CardInstance, kw: Keyword): boolean {
  return effKeywords(rt, inst).some((k) => k.name === kw);
}

/** Highest value among entries of a parameterized keyword (keywords with
 * different values do not stack in Lorcana). */
export function keywordValue(rt: Rt, inst: CardInstance, kw: Keyword): number | undefined {
  let best: number | undefined;
  for (const k of effKeywords(rt, inst)) {
    if (k.name !== kw) continue;
    const v = k.value ?? 0;
    if (best === undefined || v > best) best = v;
  }
  return best;
}

/** Total damage reduction (Resist N): best keyword value + modifier resist
 * (Resist sources do not stack — take the maximum, documented). */
export function resistValue(rt: Rt, inst: CardInstance): number {
  let best = keywordValue(rt, inst, "Resist") ?? 0;
  for (const m of allModifiers(rt, inst)) {
    if (m.resist !== undefined && m.resist > best) best = m.resist;
  }
  return best;
}

/** What cost this character counts as for singing songs: max(own cost,
 * Singer N, singerAs modifiers). */
export function singerValue(rt: Rt, inst: CardInstance): number {
  let v = defOf(rt, inst.cardId).cost;
  const kw = keywordValue(rt, inst, "Singer");
  if (kw !== undefined && kw > v) v = kw;
  for (const m of allModifiers(rt, inst)) {
    if (m.singerAs !== undefined && m.singerAs > v) v = m.singerAs;
  }
  return v;
}

export function effStats(rt: Rt, inst: CardInstance): EffStats {
  const def = defOf(rt, inst.cardId);
  const s: EffStats = {
    strength: def.strength ?? 0,
    willpower: def.willpower ?? 0,
    lore: def.lore ?? 0,
    moveCost: def.moveCost ?? 0,
    cost: def.cost,
  };
  for (const m of allModifiers(rt, inst)) {
    if (m.stat?.strength) s.strength += m.stat.strength;
    if (m.stat?.willpower) s.willpower += m.stat.willpower;
    if (m.stat?.lore) s.lore += m.stat.lore;
  }
  return s;
}

export function cantQuest(rt: Rt, inst: CardInstance): boolean {
  return hasKeyword(rt, inst, "Reckless") || allModifiers(rt, inst).some((m) => m.cantQuest === true);
}

export function cantChallenge(rt: Rt, inst: CardInstance): boolean {
  return allModifiers(rt, inst).some((m) => m.cantChallenge === true);
}

export function cantReady(rt: Rt, inst: CardInstance): boolean {
  return allModifiers(rt, inst).some((m) => m.cantReady === true);
}
