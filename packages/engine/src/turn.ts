// Turn structure (SPEC §3.3): Ready step (ready all, start-of-turn triggers,
// locations grant lore), Draw step (skipped on the very first turn), Main
// phase, then PASS. Turn number increments each time priority passes to p1.

import type { PlayerId } from "./types.js";
import {
  activePlay, addEvent, cardLabel, defOf, drawCards, gainLore, type Rt,
} from "./state.js";
import { cantReady, effStats } from "./keywords.js";
import { queueTurnTriggers, runQueue } from "./effects/interpreter.js";

/** Generic queue-drained dispatcher installed by index.ts (also restores
 * correctly after deserialize/resume, since it reads rt.after generically). */
export function installTurnHook(rt: Rt): void {
  rt.onQueueDrained = () => {
    const seg = rt.after;
    if (seg) advanceTurn(rt, seg);
  };
}

/** PASS: queue END_OF_TURN triggers; the switch happens once they resolve. */
export function passTurn(rt: Rt): void {
  const active = rt.state.activePlayer;
  addEvent(rt, "turn", `${active} passes.`, active);
  queueTurnTriggers(rt, active, "END_OF_TURN");
  rt.after = "switch";
  if (rt.queue.length === 0) {
    rt.after = undefined;
    advanceTurn(rt, "switch");
  } else {
    runQueue(rt);
  }
}

/** Advance the deferred turn machine (after triggered abilities resolve). */
export function advanceTurn(rt: Rt, seg: "switch" | "draw"): void {
  rt.after = undefined;
  if (rt.state.phase === "game-over") return;
  if (seg === "switch") {
    endOfTurnCleanup(rt);
    switchActivePlayer(rt);
    readyStep(rt);
    if (rt.state.winner !== undefined) return; // location lore may end the game
    queueTurnTriggers(rt, rt.state.activePlayer, "START_OF_TURN");
    if (rt.queue.length === 0) {
      drawStep(rt);
    } else {
      rt.after = "draw";
      runQueue(rt);
    }
  } else {
    drawStep(rt);
  }
}

/** Clear "this-turn" modifiers and pending ink discounts at the end of the
 * active player's turn. */
function endOfTurnCleanup(rt: Rt): void {
  const active = rt.state.activePlayer;
  for (const pid of ["p1", "p2"] as PlayerId[]) {
    for (const c of rt.state.players[pid].play) {
      c.modifiers = c.modifiers.filter((m) => m.duration !== "this-turn");
    }
  }
  // Cost reductions are turn-scoped for the player who gained them.
  rt.state.players[active].inkDiscounts = undefined;
}

function switchActivePlayer(rt: Rt): void {
  const next: PlayerId = rt.state.activePlayer === "p1" ? "p2" : "p1";
  rt.state.activePlayer = next;
  if (next === "p1") rt.state.turn += 1;
  addEvent(rt, "turn", `Turn ${rt.state.turn} — ${next}'s turn begins.`, next);
}

/** Ready step: ready all exerted cards (inkwell included), locations grant
 * their lore to their controller. */
function readyStep(rt: Rt): void {
  const p = rt.state.players[rt.state.activePlayer];
  // Clear until-start-of-next-turn modifiers that expire for the player whose
  // turn is beginning (they lasted through the opponent's turn).
  for (const pid of ["p1", "p2"] as PlayerId[]) {
    for (const c of rt.state.players[pid].play) {
      c.modifiers = c.modifiers.filter((m) =>
        !(m.duration === "until-start-of-next-turn" && m.expiresFor === p.id));
    }
  }
  p.inkPlayedThisTurn = 0;
  for (const c of p.inkwell) c.exerted = false;
  for (const c of p.play) {
    if (cantReady(rt, c)) continue;
    c.exerted = false;
  }
  // locations grant their lore
  for (const c of activePlay(rt.state, p.id)) {
    if (defOf(rt, c.cardId).type !== "Location") continue;
    const lore = effStats(rt, c).lore;
    if (lore > 0) {
      gainLore(rt, p.id, lore);
      if (rt.state.phase === "game-over") return;
      addEvent(rt, "lore", `${cardLabel(rt, c)} grants ${lore} lore to ${p.id} at the ready step.`, p.id,
        { cardInstanceId: c.instanceId, lore });
    }
  }
}

/** Draw step: draw 1, skipped on the very first turn of the game. */
function drawStep(rt: Rt): void {
  if (rt.state.phase === "game-over") return;
  const isVeryFirstTurn = rt.state.turn === 1 && rt.state.activePlayer === "p1";
  if (isVeryFirstTurn) return;
  drawCards(rt, rt.state.activePlayer, 1);
}
