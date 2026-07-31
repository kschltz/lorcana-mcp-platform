// Quest & challenge rules, including all combat keywords (SPEC §3.3).

import type { CardInstance, PlayerId } from "./types.js";
import {
  activePlay, addEvent, cardLabel, defOf, gainLore, isWet, opponentOf, type Rt,
} from "./state.js";
import {
  cantChallenge, cantQuest, effStats, hasKeyword, keywordValue,
} from "./keywords.js";
import { checkBanishment, dealDamage, queueCardTriggers } from "./effects/interpreter.js";

/** May this character quest right now (wetness/cantQuest/readiness)? */
export function canQuest(rt: Rt, inst: CardInstance): boolean {
  if (inst.zone !== "play") return false;
  if (defOf(rt, inst.cardId).type !== "Character") return false;
  if (inst.exerted) return false;
  if (isWet(rt.state, inst)) return false; // wet ink (no Rush exception for questing)
  if (cantQuest(rt, inst)) return false;
  return true;
}

/** May this character challenge at all right now (ignoring targets)? */
export function canBeAttacker(rt: Rt, inst: CardInstance): boolean {
  if (inst.zone !== "play") return false;
  if (defOf(rt, inst.cardId).type !== "Character") return false;
  if (inst.exerted) return false;
  if (isWet(rt.state, inst) && !hasKeyword(rt, inst, "Rush")) return false; // Rush exception
  if (cantChallenge(rt, inst)) return false;
  return true;
}

/** Basic target validity of a single defender for this attacker
 * (exertion / Evasive), ignoring the Bodyguard override. */
function basicTargetOk(rt: Rt, attacker: CardInstance, defender: CardInstance): boolean {
  if (defender.owner === attacker.owner) return false;
  if (defender.zone !== "play") return false;
  const def = defOf(rt, defender.cardId);
  if (def.type === "Location") return true; // locations may always be challenged
  if (def.type !== "Character") return false;
  if (defender.exerted === false && !hasKeyword(rt, attacker, "Alert")) return false; // Alert hits ready chars
  if (hasKeyword(rt, defender, "Evasive") && !hasKeyword(rt, attacker, "Evasive")) return false;
  return true;
}

/** Full challenge legality, enforcing Bodyguard (a Bodyguard must be chosen
 * before non-Bodyguards when one is a legal target). */
export function canChallenge(rt: Rt, attacker: CardInstance, defender: CardInstance): boolean {
  if (!canBeAttacker(rt, attacker)) return false;
  if (!basicTargetOk(rt, attacker, defender)) return false;
  const dDef = defOf(rt, defender.cardId);
  const defenderIsBodyguard = dDef.type === "Character" && hasKeyword(rt, defender, "Bodyguard");
  if (!defenderIsBodyguard) {
    const opp = opponentOf(attacker.owner);
    const bodyguardAvailable = activePlay(rt.state, opp).some((c) => {
      if (defOf(rt, c.cardId).type !== "Character") return false;
      if (!hasKeyword(rt, c, "Bodyguard")) return false;
      return basicTargetOk(rt, attacker, c);
    });
    if (bodyguardAvailable) return false;
  }
  return true;
}

/** All legal defenders for an attacker (characters + locations). */
export function legalDefenders(rt: Rt, attacker: CardInstance): CardInstance[] {
  const opp = opponentOf(attacker.owner);
  return activePlay(rt.state, opp).filter((c) => canChallenge(rt, attacker, c));
}

/** Whether the active player has a Reckless character that must challenge
 * (blocks PASS — Reckless characters must challenge if able). */
export function recklessMustChallenge(rt: Rt, player: PlayerId): boolean {
  return activePlay(rt.state, player).some((c) => {
    if (defOf(rt, c.cardId).type !== "Character") return false;
    if (!hasKeyword(rt, c, "Reckless")) return false;
    if (!canBeAttacker(rt, c)) return false;
    return legalDefenders(rt, c).length > 0;
  });
}

/** Quest: exert, gain lore, fire ON_QUEST + Support. */
export function doQuest(rt: Rt, inst: CardInstance): void {
  inst.exerted = true;
  const lore = effStats(rt, inst).lore;
  addEvent(rt, "quest", `${cardLabel(rt, inst)} quests for ${lore} lore.`, inst.owner,
    { cardInstanceId: inst.instanceId, lore });
  gainLore(rt, inst.owner, lore);
  queueCardTriggers(rt, inst, "ON_QUEST");
  if (hasKeyword(rt, inst, "Support")) {
    rt.queue.push({ kind: "support", sourceId: inst.instanceId, controller: inst.owner });
  }
}

/** Challenge: simultaneous damage with Challenger/Support/Resist math. */
export function doChallenge(rt: Rt, attacker: CardInstance, defender: CardInstance): void {
  attacker.exerted = true;
  const dDef = defOf(rt, defender.cardId);
  const challenger = keywordValue(rt, attacker, "Challenger") ?? 0;
  const atkStr = effStats(rt, attacker).strength + challenger; // Challenger +N while attacking
  addEvent(rt, "challenge",
    `${cardLabel(rt, attacker)} challenges ${cardLabel(rt, defender)}.`,
    attacker.owner, { attackerId: attacker.instanceId, defenderId: defender.instanceId });

  let defenderBanished: CardInstance[] = [];
  let attackerBanished: CardInstance[] = [];

  if (dDef.type === "Location") {
    // locations don't deal damage back
    dealDamage(rt, defender, atkStr);
    defenderBanished = checkBanishment(rt, defender, "challenge");
  } else {
    const defStr = effStats(rt, defender).strength;
    // simultaneous damage
    dealDamage(rt, defender, atkStr);
    dealDamage(rt, attacker, defStr);
    defenderBanished = checkBanishment(rt, defender, "challenge");
    attackerBanished = checkBanishment(rt, attacker, "challenge");
  }

  // ON_CHALLENGE_BANISH: attacker banished a character in this challenge
  // (ON_BANISH frames were already queued inside checkBanishment)
  if (defenderBanished.length > 0 && dDef.type === "Character" && attackerBanished.length === 0) {
    queueCardTriggers(rt, attacker, "ON_CHALLENGE_BANISH");
  }
}
