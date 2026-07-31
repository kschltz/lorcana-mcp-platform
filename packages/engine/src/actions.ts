// PlayerAction contract (SPEC §3.2) + action execution.
// Documented extension: { type: "CONCEDE" } (SPEC §3.3 "Concede supported").

import type { CardInstance, PlayerId } from "./types.js";
import {
  activePlay, addEvent, banishInstance, cardLabel, defOf, findInstance, opponentOf,
  payInk, ps, readyInk, scriptOf, syncRng, type Rt,
} from "./state.js";
import { effStats, hasKeyword, singerValue } from "./keywords.js";
import { doChallenge, doQuest } from "./combat.js";
import {
  makeCtx, queueBanishTriggers, queuePlayTriggers, resolvePendingChoice, runQueue,
} from "./effects/interpreter.js";
import { doMulligan } from "./setup.js";
import { passTurn } from "./turn.js";

export type PlayerAction =
  | { type: "MULLIGAN"; keep: string[] } // instanceIds to keep; rest shuffled back, redraw to 7
  | { type: "PLAY_INK"; cardInstanceId: string }
  | { type: "PLAY_CARD"; cardInstanceId: string; choices?: PlayChoices }
  | { type: "QUEST"; characterId: string }
  | { type: "CHALLENGE"; attackerId: string; defenderId: string } // defender: character or location
  | { type: "ACTIVATE_ABILITY"; cardInstanceId: string; abilityIndex: number; choices?: PlayChoices }
  | { type: "MOVE_TO_LOCATION"; characterId: string; locationId: string }
  | { type: "RESOLVE_CHOICE"; choiceId: string; selected: string[] } // option ids
  | { type: "PASS" }
  | { type: "CONCEDE" }; // EXTENSION: concede the match (SPEC §3.3)

export interface PlayChoices {
  targets?: string[];
  options?: string[];
  payAlternatives?: Record<string, string>;
  // payAlternatives used by the engine:
  //   { mode: "sing", singer: <characterInstanceId> } — sing a Song
  //   { mode: "shift" } + targets: [<baseCharacterId>]  — Shift onto a matching character
}

export interface LegalAction {
  // fully enumerated, AI-friendly
  action: PlayerAction; // ready to submit as-is
  description: string; // human/LLM readable
}

// ---------------------------------------------------------------------------
// Execution (validation lives in legality.ts)
// ---------------------------------------------------------------------------

export function executeAction(rt: Rt, player: PlayerId, action: PlayerAction): string | null {
  switch (action.type) {
    case "MULLIGAN": {
      doMulligan(rt, player, action.keep);
      return null;
    }
    case "PLAY_INK": {
      const p = ps(rt.state, player);
      const idx = p.hand.findIndex((c) => c.instanceId === action.cardInstanceId);
      const inst = p.hand[idx]!;
      p.hand.splice(idx, 1);
      inst.zone = "inkwell";
      inst.exerted = false;
      p.inkwell.push(inst);
      p.inkPlayedThisTurn += 1;
      addEvent(rt, "ink", `${player} puts ${cardLabel(rt, inst)} into their inkwell (ink: ${p.inkwell.length}).`,
        player, { cardInstanceId: inst.instanceId });
      return null;
    }
    case "PLAY_CARD":
      return execPlayCard(rt, player, action.cardInstanceId, action.choices);
    case "QUEST": {
      const inst = findInstance(rt.state, action.characterId)!.inst;
      doQuest(rt, inst);
      runQueue(rt);
      return null;
    }
    case "CHALLENGE": {
      const attacker = findInstance(rt.state, action.attackerId)!.inst;
      const defender = findInstance(rt.state, action.defenderId)!.inst;
      doChallenge(rt, attacker, defender);
      runQueue(rt);
      return null;
    }
    case "ACTIVATE_ABILITY":
      return execActivateAbility(rt, player, action.cardInstanceId, action.abilityIndex);
    case "MOVE_TO_LOCATION": {
      const inst = findInstance(rt.state, action.characterId)!.inst;
      const loc = findInstance(rt.state, action.locationId)!.inst;
      const cost = effStats(rt, loc).moveCost;
      payInk(rt, player, cost);
      inst.atLocation = loc.instanceId;
      addEvent(rt, "move", `${cardLabel(rt, inst)} moves to ${cardLabel(rt, loc)} (paid ${cost} ink).`,
        player, { characterId: inst.instanceId, locationId: loc.instanceId });
      return null;
    }
    case "RESOLVE_CHOICE":
      return resolvePendingChoice(rt, player, action.choiceId, action.selected);
    case "PASS": {
      passTurn(rt);
      return null;
    }
    case "CONCEDE": {
      const winner = opponentOf(player);
      rt.state.winner = winner;
      rt.state.winReason = "concede";
      rt.state.phase = "game-over";
      rt.state.pendingChoice = undefined;
      rt.state.pendingResolution = undefined;
      rt.queue = [];
      addEvent(rt, "game-over", `${player} concedes — ${winner} wins.`, player);
      return null;
    }
  }
}

function execPlayCard(
  rt: Rt, player: PlayerId, cardInstanceId: string, choices?: PlayChoices,
): string | null {
  const p = ps(rt.state, player);
  const idx = p.hand.findIndex((c) => c.instanceId === cardInstanceId);
  const inst = p.hand[idx]!;
  const def = defOf(rt, inst.cardId);
  const script = scriptOf(rt, inst.cardId);
  const mode = choices?.payAlternatives?.mode;

  // --- payment -----------------------------------------------------------
  let shiftTarget: CardInstance | undefined;
  if (mode === "sing") {
    const singerId = choices?.payAlternatives?.singer;
    const singerLoc = singerId ? findInstance(rt.state, singerId) : undefined;
    if (!singerLoc) return "sing: missing singer";
    singerLoc.inst.exerted = true;
    addEvent(rt, "sing", `${cardLabel(rt, singerLoc.inst)} sings ${cardLabel(rt, inst)}.`, player,
      { singerId, cardInstanceId: inst.instanceId });
  } else if (mode === "shift") {
    const targetId = choices?.targets?.[0];
    const targetLoc = targetId ? findInstance(rt.state, targetId) : undefined;
    if (!targetLoc) return "shift: missing target";
    shiftTarget = targetLoc.inst;
    payInk(rt, player, script.shiftCost ?? def.cost);
  } else {
    payInk(rt, player, def.cost);
  }

  p.hand.splice(idx, 1);

  // --- actions resolve then go to discard (they are put into discard as
  // they resolve — documented simplification so suspended resolutions work).
  if (def.type === "Action") {
    inst.zone = "discard";
    p.discard.push(inst);
    addEvent(rt, "play", `${player} plays ${cardLabel(rt, inst)}${mode === "sing" ? " (sung)" : ""}.`,
      player, { cardInstanceId: inst.instanceId });
    queuePlayTriggers(rt, inst);
    runQueue(rt);
    return null;
  }

  // --- characters / items / locations enter play -------------------------
  inst.zone = "play";
  inst.enteredTurn = rt.state.turn;
  p.play.push(inst);

  if (shiftTarget) {
    // Shift: the base card (and anything under it) moves under the new card;
    // damage/exertion/dryness/location are inherited by the stack.
    inst.under = [shiftTarget.instanceId, ...(shiftTarget.under ?? [])];
    inst.shiftedOnto = shiftTarget.instanceId;
    inst.damage = shiftTarget.damage;
    inst.exerted = shiftTarget.exerted;
    inst.enteredTurn = shiftTarget.enteredTurn;
    inst.atLocation = shiftTarget.atLocation;
    shiftTarget.atLocation = undefined;
    shiftTarget.damage = 0;
    shiftTarget.exerted = false;
    addEvent(rt, "shift", `${cardLabel(rt, inst)} shifts onto ${cardLabel(rt, shiftTarget)}.`,
      player, { cardInstanceId: inst.instanceId, onto: shiftTarget.instanceId });
  }

  // Boost N: when played, put the top N cards of your deck under it.
  const boost = (script.keywords ?? []).find((k) => k.name === "Boost")?.value;
  if (boost && boost > 0) {
    for (let i = 0; i < boost && p.deck.length > 0; i++) {
      const top = p.deck.shift()!;
      top.zone = "play";
      top.enteredTurn = rt.state.turn;
      p.play.push(top);
      (inst.under ??= []).push(top.instanceId);
    }
    addEvent(rt, "boost", `${cardLabel(rt, inst)} boosts ${boost} card(s) under it.`, player,
      { cardInstanceId: inst.instanceId, amount: boost });
  }

  // Bodyguard: may enter play exerted (choice via options:["exert"]).
  if (hasKeyword(rt, inst, "Bodyguard") && choices?.options?.includes("exert")) {
    inst.exerted = true;
    addEvent(rt, "bodyguard", `${cardLabel(rt, inst)} enters play exerted (Bodyguard).`, player,
      { cardInstanceId: inst.instanceId });
  }

  addEvent(rt, "play", `${player} plays ${cardLabel(rt, inst)}.`, player,
    { cardInstanceId: inst.instanceId, shift: mode === "shift" || undefined });
  queuePlayTriggers(rt, inst);
  runQueue(rt);
  return null;
}

function execActivateAbility(
  rt: Rt, player: PlayerId, cardInstanceId: string, abilityIndex: number,
): string | null {
  const inst = findInstance(rt.state, cardInstanceId)!.inst;
  const script = scriptOf(rt, inst.cardId);
  const ab = script.activated![abilityIndex]!;
  const p = ps(rt.state, player);

  if (ab.cost.ink) payInk(rt, player, ab.cost.ink);
  if (ab.cost.exert) inst.exerted = true;
  if (ab.cost.discard) {
    for (let i = 0; i < ab.cost.discard && p.hand.length > 0; i++) {
      const di = rt.rng.nextInt(p.hand.length);
      const [c] = p.hand.splice(di, 1);
      if (!c) break;
      c.zone = "discard";
      p.discard.push(c);
      addEvent(rt, "discard", `${player} discards ${cardLabel(rt, c)} to pay an ability cost.`, player,
        { cardInstanceId: c.instanceId });
    }
    syncRng(rt);
  }
  if (ab.oncePerTurn) {
    inst.modifiers.push({ id: `abil:${abilityIndex}`, source: inst.instanceId, duration: "this-turn" });
  }
  addEvent(rt, "activate", `${player} activates ${cardLabel(rt, inst)}'s ability${ab.name ? ` (${ab.name})` : ""}.`,
    player, { cardInstanceId: inst.instanceId, abilityIndex });

  rt.queue.push({ kind: "effects", effects: [...ab.effects], ctx: makeCtx(player, inst.instanceId) });
  if (ab.cost.banishSelf) {
    const banished = banishInstance(rt, inst, "ability cost");
    queueBanishTriggers(rt, banished);
  }
  runQueue(rt);
  return null;
}

/** Helper for legality: may this card be sung by the given singer? */
export function canSingWith(rt: Rt, song: CardInstance, singer: CardInstance): boolean {
  const def = defOf(rt, song.cardId);
  if (def.type !== "Action" || !def.classifications.includes("Song")) return false;
  if (singer.owner !== song.owner || singer.zone !== "play" || singer.exerted) return false;
  if (defOf(rt, singer.cardId).type !== "Character") return false;
  return singerValue(rt, singer) >= def.cost;
}

/** Helper for legality: valid shift targets for a Floodborn card in hand. */
export function shiftTargets(rt: Rt, player: PlayerId, card: CardInstance): CardInstance[] {
  const script = scriptOf(rt, card.cardId);
  if (script.shiftCost === undefined) return [];
  const def = defOf(rt, card.cardId);
  if (def.type !== "Character") return [];
  if (readyInk(rt.state, player) < script.shiftCost) return [];
  return activePlay(rt.state, player).filter(
    (c) => defOf(rt, c.cardId).type === "Character" && defOf(rt, c.cardId).name === def.name,
  );
}

