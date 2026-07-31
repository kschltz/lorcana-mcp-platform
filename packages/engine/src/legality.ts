// Legal-action validation + fully expanded enumeration (SPEC §3.2, §3.3).
// All legality/targeting validation happens here, not in the interpreter.

import type { CardInstance, PlayerId } from "./types.js";
import type { LegalAction, PlayChoices, PlayerAction } from "./actions.js";
import {
  activePlay, cardLabel, defOf, effectivePlayCost, findInstance, isWet, ps, readyInk,
  scriptOf, type Rt,
} from "./state.js";
import { effStats } from "./keywords.js";
import {
  canBeAttacker, canChallenge, canQuest, legalDefenders, recklessMustChallenge,
} from "./combat.js";
import { canSingWith, shiftTargets } from "./actions.js";

// ---------------------------------------------------------------------------
// Combinatorics helpers (deterministic order)
// ---------------------------------------------------------------------------

function subsets<T>(arr: T[]): T[][] {
  const out: T[][] = [[]];
  for (const x of arr) {
    const cur = out.map((s) => [...s, x]);
    out.push(...cur);
  }
  return out;
}

function combos<T>(arr: T[], min: number, max: number, cap = 256): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length >= min) out.push([...acc]);
    if (acc.length === max || out.length >= cap) return;
    for (let i = start; i < arr.length; i++) {
      acc.push(arr[i]!);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out.slice(0, cap);
}

function permutations<T>(arr: T[], cap = 120): T[][] {
  if (arr.length <= 1) return [arr.slice()];
  const out: T[][] = [];
  const rec = (rest: T[], acc: T[]) => {
    if (rest.length === 0) { out.push([...acc]); return; }
    if (out.length >= cap) return;
    for (let i = 0; i < rest.length; i++) {
      const next = rest.slice();
      const [x] = next.splice(i, 1);
      acc.push(x!);
      rec(next, acc);
      acc.pop();
    }
  };
  rec(arr, []);
  return out;
}

// ---------------------------------------------------------------------------
// Enumeration
// ---------------------------------------------------------------------------

export function getLegalActions(rt: Rt, player: PlayerId): LegalAction[] {
  const state = rt.state;
  if (state.phase === "game-over") return [];

  // A pending choice gates everything: ONLY RESOLVE_CHOICE is legal.
  if (state.pendingChoice) {
    if (state.pendingChoice.player !== player) return [];
    return legalResolveChoices(rt);
  }

  if (state.phase === "mulligan") {
    const p = ps(state, player);
    if (p.mulliganDone) return [];
    // fully expanded: one MULLIGAN per keep-subset
    return subsets(p.hand.map((c) => c.instanceId)).map((keep) => ({
      action: { type: "MULLIGAN", keep } as PlayerAction,
      description: keep.length === p.hand.length
        ? "Keep the whole hand"
        : keep.length === 0
          ? "Mulligan the whole hand"
          : `Keep ${keep.length} card(s), mulligan ${p.hand.length - keep.length}`,
    }));
  }

  if (state.phase !== "main" || state.activePlayer !== player) return [];

  const out: LegalAction[] = [];
  const p = ps(state, player);
  const ink = readyInk(state, player);

  // PLAY_INK — once per turn, inkable cards only
  if (p.inkPlayedThisTurn === 0) {
    for (const c of p.hand) {
      if (!defOf(rt, c.cardId).inkable) continue;
      out.push({
        action: { type: "PLAY_INK", cardInstanceId: c.instanceId },
        description: `Put ${cardLabel(rt, c)} into your inkwell`,
      });
    }
  }

  // PLAY_CARD — per payable card incl. sing / shift variants
  for (const c of p.hand) {
    out.push(...playCardActions(rt, player, c, ink));
  }

  // QUEST
  for (const c of activePlay(state, player)) {
    if (!canQuest(rt, c)) continue;
    out.push({
      action: { type: "QUEST", characterId: c.instanceId },
      description: `${cardLabel(rt, c)} quests for ${effStats(rt, c).lore} lore`,
    });
  }

  // CHALLENGE — one entry per legal attacker/defender pair
  for (const c of activePlay(state, player)) {
    if (!canBeAttacker(rt, c)) continue;
    for (const d of legalDefenders(rt, c)) {
      out.push({
        action: { type: "CHALLENGE", attackerId: c.instanceId, defenderId: d.instanceId },
        description: `${cardLabel(rt, c)} challenges ${cardLabel(rt, d)}`,
      });
    }
  }

  // ACTIVATE_ABILITY
  for (const c of activePlay(state, player)) {
    const script = scriptOf(rt, c.cardId);
    (script.activated ?? []).forEach((ab, i) => {
      if (!canActivate(rt, player, c, i)) return;
      out.push({
        action: { type: "ACTIVATE_ABILITY", cardInstanceId: c.instanceId, abilityIndex: i },
        description: `Activate ${cardLabel(rt, c)}'s ability${ab.name ? ` (${ab.name})` : ""}`,
      });
    });
  }

  // MOVE_TO_LOCATION
  for (const c of activePlay(state, player)) {
    if (defOf(rt, c.cardId).type !== "Character") continue;
    for (const loc of activePlay(state, player)) {
      if (defOf(rt, loc.cardId).type !== "Location") continue;
      if (c.atLocation === loc.instanceId) continue;
      const cost = effStats(rt, loc).moveCost;
      if (ink < cost) continue;
      out.push({
        action: { type: "MOVE_TO_LOCATION", characterId: c.instanceId, locationId: loc.instanceId },
        description: `${cardLabel(rt, c)} moves to ${cardLabel(rt, loc)} (cost ${cost})`,
      });
    }
  }

  // PASS — blocked while a Reckless character can challenge
  if (!recklessMustChallenge(rt, player)) {
    out.push({ action: { type: "PASS" }, description: "End your turn" });
  }

  return out;
}

function playCardActions(rt: Rt, player: PlayerId, c: CardInstance, ink: number): LegalAction[] {
  const out: LegalAction[] = [];
  const def = defOf(rt, c.cardId);
  const script = scriptOf(rt, c.cardId);
  const label = cardLabel(rt, c);
  const bodyguardVariants = (base: PlayChoices | undefined): Array<PlayChoices | undefined> => {
    // Bodyguard characters may enter play exerted
    if (def.type === "Character" && (script.keywords ?? []).some((k) => k.name === "Bodyguard")) {
      const exert: PlayChoices = { ...(base ?? {}), options: [...(base?.options ?? []), "exert"] };
      return [base, exert];
    }
    return [base];
  };

  // normal payment (after pending cost-reduction discounts)
  const playCost = effectivePlayCost(rt.state, player, def);
  if (ink >= playCost) {
    for (const choices of bodyguardVariants(undefined)) {
      const suffix = choices?.options?.includes("exert") ? " (enters exerted)" : "";
      const discountNote = playCost < def.cost ? ` (discounted from ${def.cost})` : "";
      const action: PlayerAction = choices
        ? { type: "PLAY_CARD", cardInstanceId: c.instanceId, choices }
        : { type: "PLAY_CARD", cardInstanceId: c.instanceId };
      out.push({ action, description: `Play ${label} for ${playCost} ink${discountNote}${suffix}` });
    }
  }

  // sing (Songs only): exert a ready character with sufficient cost/singerAs
  if (def.type === "Action" && def.classifications.includes("Song")) {
    for (const s of activePlay(rt.state, player)) {
      if (!canSingWith(rt, c, s)) continue;
      out.push({
        action: {
          type: "PLAY_CARD", cardInstanceId: c.instanceId,
          choices: { payAlternatives: { mode: "sing", singer: s.instanceId } },
        },
        description: `Sing ${label} with ${cardLabel(rt, s)} (free)`,
      });
    }
  }

  // shift (Floodborn): onto a matching-name character for the shift cost
  if (script.shiftCost !== undefined) {
    for (const t of shiftTargets(rt, player, c)) {
      for (const choices of bodyguardVariants({ targets: [t.instanceId], payAlternatives: { mode: "shift" } })) {
        const suffix = choices?.options?.includes("exert") ? " (enters exerted)" : "";
        out.push({
          action: { type: "PLAY_CARD", cardInstanceId: c.instanceId, choices },
          description: `Shift ${label} onto ${cardLabel(rt, t)} for ${script.shiftCost} ink${suffix}`,
        });
      }
    }
  }

  return out;
}

function legalResolveChoices(rt: Rt): LegalAction[] {
  const choice = rt.state.pendingChoice!;
  const ids = choice.options.map((o) => o.id);
  let selections: string[][];
  if (choice.kind === "order-cards") {
    selections = permutations(ids);
  } else {
    selections = combos(ids, choice.min, choice.max);
  }
  return selections.map((selected) => ({
    action: { type: "RESOLVE_CHOICE", choiceId: choice.id, selected } as PlayerAction,
    description: `${choice.prompt} → ${selected.map((s) => choice.options.find((o) => o.id === s)?.label ?? s).join(", ") || "(nothing)"}`,
  }));
}

// ---------------------------------------------------------------------------
// Ability usability
// ---------------------------------------------------------------------------

export function canActivate(rt: Rt, player: PlayerId, inst: CardInstance, abilityIndex: number): boolean {
  const script = scriptOf(rt, inst.cardId);
  const ab = (script.activated ?? [])[abilityIndex];
  if (!ab) return false;
  if (inst.owner !== player || inst.zone !== "play") return false;
  if (ab.oncePerTurn && inst.modifiers.some((m) => m.id === `abil:${abilityIndex}`)) return false;
  if (ab.cost.ink && readyInk(rt.state, player) < ab.cost.ink) return false;
  if (ab.cost.exert) {
    if (inst.exerted) return false;
    const def = defOf(rt, inst.cardId);
    if (def.type === "Character" && isWet(rt.state, inst)) return false; // wet characters can't exert for abilities
  }
  if (ab.cost.discard && ps(rt.state, player).hand.length < ab.cost.discard) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Validation (applyAction gate)
// ---------------------------------------------------------------------------

/** Returns an error string, or null when the action is legal. */
export function validateAction(rt: Rt, player: PlayerId, action: PlayerAction): string | null {
  const state = rt.state;
  if (state.phase === "game-over") return "game is over";

  if (state.pendingChoice) {
    if (action.type !== "RESOLVE_CHOICE" && action.type !== "CONCEDE")
      return "a choice is pending — only RESOLVE_CHOICE is legal";
    if (action.type === "RESOLVE_CHOICE") return null; // validated by the interpreter
  }

  switch (action.type) {
    case "CONCEDE":
      return null;

    case "MULLIGAN": {
      if (state.phase !== "mulligan") return "not in mulligan phase";
      const p = ps(state, player);
      if (p.mulliganDone) return "mulligan already done";
      const handIds = new Set(p.hand.map((c) => c.instanceId));
      for (const id of action.keep) if (!handIds.has(id)) return `card ${id} not in hand`;
      if (new Set(action.keep).size !== action.keep.length) return "duplicate keep ids";
      return null;
    }

    case "RESOLVE_CHOICE":
      return "no pending choice";

    case "PASS": {
      if (state.phase !== "main") return "not in main phase";
      if (state.activePlayer !== player) return "not your turn";
      if (recklessMustChallenge(rt, player)) return "a Reckless character must challenge if able";
      return null;
    }

    case "PLAY_INK": {
      if (state.phase !== "main") return "not in main phase";
      if (state.activePlayer !== player) return "not your turn";
      const p = ps(state, player);
      if (p.inkPlayedThisTurn > 0) return "already played ink this turn";
      const inst = p.hand.find((c) => c.instanceId === action.cardInstanceId);
      if (!inst) return "card not in hand";
      if (!defOf(rt, inst.cardId).inkable) return "card is not inkable";
      return null;
    }

    case "PLAY_CARD": {
      if (state.phase !== "main") return "not in main phase";
      if (state.activePlayer !== player) return "not your turn";
      const p = ps(state, player);
      const inst = p.hand.find((c) => c.instanceId === action.cardInstanceId);
      if (!inst) return "card not in hand";
      const def = defOf(rt, inst.cardId);
      const script = scriptOf(rt, inst.cardId);
      const mode = action.choices?.payAlternatives?.mode;
      if (mode === "sing") {
        const singerId = action.choices?.payAlternatives?.singer;
        const singer = singerId ? findInstance(state, singerId)?.inst : undefined;
        if (!singer) return "sing: unknown singer";
        if (!canSingWith(rt, inst, singer)) return "sing: invalid singer (needs a ready character with cost/Singer >= song cost)";
        return null;
      }
      if (mode === "shift") {
        const targetId = action.choices?.targets?.[0];
        const target = targetId ? findInstance(state, targetId)?.inst : undefined;
        if (!target) return "shift: unknown target";
        if (!shiftTargets(rt, player, inst).some((t) => t.instanceId === target.instanceId))
          return "shift: invalid target (needs a matching-name character you control and enough ink)";
        return null;
      }
      {
        const need = effectivePlayCost(state, player, def);
        if (readyInk(state, player) < need) return `not enough ink (need ${need})`;
      }
      void script;
      return null;
    }

    case "QUEST": {
      if (state.phase !== "main") return "not in main phase";
      if (state.activePlayer !== player) return "not your turn";
      const loc = findInstance(state, action.characterId);
      if (!loc || loc.owner !== player) return "character not found";
      if (!canQuest(rt, loc.inst)) return "character cannot quest (exerted, wet, or Reckless/cant-quest)";
      return null;
    }

    case "CHALLENGE": {
      if (state.phase !== "main") return "not in main phase";
      if (state.activePlayer !== player) return "not your turn";
      const a = findInstance(state, action.attackerId);
      const d = findInstance(state, action.defenderId);
      if (!a || a.owner !== player) return "attacker not found";
      if (!d) return "defender not found";
      if (!canBeAttacker(rt, a.inst)) return "attacker cannot challenge (exerted, wet without Rush, or cant-challenge)";
      if (!canChallenge(rt, a.inst, d.inst)) return "illegal challenge target (must be exerted/Evasive rules/Bodyguard first)";
      return null;
    }

    case "ACTIVATE_ABILITY": {
      if (state.phase !== "main") return "not in main phase";
      if (state.activePlayer !== player) return "not your turn";
      const loc = findInstance(state, action.cardInstanceId);
      if (!loc || loc.owner !== player) return "card not found";
      if (!canActivate(rt, player, loc.inst, action.abilityIndex)) return "ability cannot be activated";
      return null;
    }

    case "MOVE_TO_LOCATION": {
      if (state.phase !== "main") return "not in main phase";
      if (state.activePlayer !== player) return "not your turn";
      const c = findInstance(state, action.characterId);
      const l = findInstance(state, action.locationId);
      if (!c || c.owner !== player || c.zone !== "play") return "character not in play";
      if (!l || l.owner !== player || l.zone !== "play") return "location not in play";
      if (defOf(rt, c.inst.cardId).type !== "Character") return "only characters move";
      if (defOf(rt, l.inst.cardId).type !== "Location") return "target is not a location";
      if (c.inst.atLocation === l.inst.instanceId) return "already at that location";
      const cost = effStats(rt, l.inst).moveCost;
      if (readyInk(state, player) < cost) return `not enough ink to move (need ${cost})`;
      return null;
    }
  }
}

