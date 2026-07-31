// Runtime context + low-level state helpers shared by every engine module.

import type {
  CardDefinition, CardInstance, ExecFrame, GameEvent, GameState, PlayerId, PlayerState, Zone,
} from "./types.js";
import type { CardScript } from "./effects/dsl.js";
import type { CardRegistry } from "./cards/registry.js";
import { Rng } from "./rng.js";

/** Mutable engine runtime. Only `state` is serializable — everything else is
 * derived from it (rng is re-seeded from state.rngState, queue is mirrored into
 * state.pendingResolution whenever resolution suspends). */
export interface Rt {
  state: GameState;
  registry: CardRegistry;
  rng: Rng;
  queue: ExecFrame[]; // live effect queue (FIFO)
  after?: "switch" | "draw"; // deferred turn-machine segment while queue runs
  onQueueDrained?: () => void; // installed by turn.ts
}

export function opponentOf(p: PlayerId): PlayerId {
  return p === "p1" ? "p2" : "p1";
}

export function ps(state: GameState, p: PlayerId): PlayerState {
  return state.players[p];
}

export function addEvent(
  rt: Rt, type: string, message: string, player?: PlayerId, data?: Record<string, unknown>,
): void {
  const ev: GameEvent = { turn: rt.state.turn, seq: rt.state.log.length, type, message };
  if (player !== undefined) ev.player = player;
  if (data !== undefined) ev.data = data;
  rt.state.log.push(ev);
}

/** Persist the RNG state back into the serializable game state. */
export function syncRng(rt: Rt): void {
  rt.state.rngState = rt.rng.state;
}

// ---------------------------------------------------------------------------
// Instance lookup
// ---------------------------------------------------------------------------

export interface Located { inst: CardInstance; owner: PlayerId; zone: Zone; }

function* zoneLists(p: PlayerState): Generator<{ list: CardInstance[]; zone: Zone }> {
  yield { list: p.deck, zone: "deck" };
  yield { list: p.hand, zone: "hand" };
  yield { list: p.inkwell, zone: "inkwell" };
  yield { list: p.discard, zone: "discard" };
  yield { list: p.play, zone: "play" };
}

export function findInstance(state: GameState, instanceId: string): Located | undefined {
  for (const pid of ["p1", "p2"] as PlayerId[]) {
    const p = state.players[pid];
    for (const { list, zone } of zoneLists(p)) {
      const inst = list.find((c) => c.instanceId === instanceId);
      if (inst) return { inst, owner: pid, zone };
    }
  }
  return undefined;
}

/** Ids of every card stacked underneath another (shift stack / Boost). */
export function underIdSet(state: GameState): Set<string> {
  const s = new Set<string>();
  for (const pid of ["p1", "p2"] as PlayerId[]) {
    for (const c of state.players[pid].play) {
      for (const u of c.under ?? []) s.add(u);
    }
  }
  return s;
}

/** Cards meaningfully "in play" (excludes cards stacked under others). */
export function activePlay(state: GameState, who?: PlayerId): CardInstance[] {
  const under = underIdSet(state);
  const out: CardInstance[] = [];
  const pids: PlayerId[] = who ? [who] : ["p1", "p2"];
  for (const pid of pids) {
    for (const c of state.players[pid].play) {
      if (c.zone === "play" && !under.has(c.instanceId)) out.push(c);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Card data access
// ---------------------------------------------------------------------------

export function defOf(rt: Rt, cardId: string): CardDefinition {
  return rt.registry.get(cardId);
}

export function scriptOf(rt: Rt, cardId: string): CardScript {
  return rt.registry.getScript(cardId);
}

// ---------------------------------------------------------------------------
// Ink
// ---------------------------------------------------------------------------

/** Ready (unexerted) ink. Inkwell cards reuse CardInstance.exerted to track
 * payment — exerted inkwell cards are "used" this turn (documented extension). */
export function readyInk(state: GameState, p: PlayerId): number {
  return state.players[p].inkwell.filter((c) => !c.exerted).length;
}

export function payInk(rt: Rt, p: PlayerId, amount: number): boolean {
  const ink = rt.state.players[p].inkwell;
  let remaining = amount;
  for (const c of ink) {
    if (remaining === 0) break;
    if (!c.exerted) {
      c.exerted = true;
      remaining--;
    }
  }
  return remaining === 0;
}

// ---------------------------------------------------------------------------
// Lore / wins / draws
// ---------------------------------------------------------------------------

export function gainLore(rt: Rt, p: PlayerId, amount: number): void {
  if (amount <= 0 || rt.state.phase === "game-over") return;
  const player = rt.state.players[p];
  player.lore += amount;
  if (player.lore >= 20 && !rt.state.winner) {
    rt.state.winner = p;
    rt.state.winReason = "lore";
    rt.state.phase = "game-over";
    addEvent(rt, "game-over", `${p} reaches ${player.lore} lore and wins the game!`, p);
  }
}

export function loseLore(rt: Rt, p: PlayerId, amount: number): void {
  const player = rt.state.players[p];
  player.lore = Math.max(0, player.lore - amount);
}

/** Draw n cards. Drawing from an empty deck loses the game (deck-out). */
export function drawCards(rt: Rt, p: PlayerId, n: number): CardInstance[] {
  const player = rt.state.players[p];
  const drawn: CardInstance[] = [];
  for (let i = 0; i < n; i++) {
    if (rt.state.phase === "game-over") break;
    const card = player.deck.shift();
    if (!card) {
      // deck-out loss
      const opp = opponentOf(p);
      rt.state.winner = opp;
      rt.state.winReason = "deck-out";
      rt.state.phase = "game-over";
      addEvent(rt, "game-over", `${p} must draw from an empty deck — ${opp} wins (deck-out).`, p);
      break;
    }
    card.zone = "hand";
    player.hand.push(card);
    drawn.push(card);
  }
  return drawn;
}

// ---------------------------------------------------------------------------
// Leaving play (banish / bounce) — handles shift stacks and modifier cleanup
// ---------------------------------------------------------------------------

function removeFromPlayArray(p: PlayerState, inst: CardInstance): void {
  const idx = p.play.findIndex((c) => c.instanceId === inst.instanceId);
  if (idx >= 0) p.play.splice(idx, 1);
}

/** Remove modifiers sourced from a card that left play (while-in-play only). */
function sweepSourceModifiers(rt: Rt, sourceId: string): void {
  for (const pid of ["p1", "p2"] as PlayerId[]) {
    for (const c of rt.state.players[pid].play) {
      c.modifiers = c.modifiers.filter(
        (m) => !(m.source === sourceId && m.duration === "while-in-play"),
      );
    }
  }
}

function stackWith(rt: Rt, inst: CardInstance): CardInstance[] {
  const cards: CardInstance[] = [inst];
  for (const uid of inst.under ?? []) {
    const loc = findInstance(rt.state, uid);
    if (loc) cards.push(loc.inst);
  }
  return cards;
}

/** Banish an in-play card (and everything under it) to its owner's discard.
 * Returns all banished instances (top first). Does NOT queue ON_BANISH —
 * callers do that via the interpreter. */
export function banishInstance(rt: Rt, inst: CardInstance, cause: string): CardInstance[] {
  const loc = findInstance(rt.state, inst.instanceId);
  if (!loc || loc.zone !== "play") return [];
  const owner = rt.state.players[loc.owner];
  const cards = stackWith(rt, inst);
  for (const c of cards) {
    removeFromPlayArray(owner, c);
    c.zone = "discard";
    c.exerted = false;
    c.atLocation = undefined;
    c.shiftedOnto = undefined;
    c.under = undefined;
    c.modifiers = [];
    owner.discard.push(c);
  }
  sweepSourceModifiers(rt, inst.instanceId);
  // characters at a banished location stay in play but are no longer "at" it
  for (const pid of ["p1", "p2"] as PlayerId[]) {
    for (const c of rt.state.players[pid].play) {
      if (c.atLocation === inst.instanceId) c.atLocation = undefined;
    }
  }
  addEvent(rt, "banish", `${cardLabel(rt, inst)} is banished (${cause}).`, loc.owner, {
    cardInstanceId: inst.instanceId, cause,
  });
  return cards;
}

/** Return an in-play card (and everything under it) to its owner's hand. */
export function returnToHand(rt: Rt, inst: CardInstance): CardInstance[] {
  const loc = findInstance(rt.state, inst.instanceId);
  if (!loc || loc.zone !== "play") return [];
  const owner = rt.state.players[loc.owner];
  const cards = stackWith(rt, inst);
  for (const c of cards) {
    removeFromPlayArray(owner, c);
    c.zone = "hand";
    c.exerted = false;
    c.damage = 0;
    c.atLocation = undefined;
    c.shiftedOnto = undefined;
    c.under = undefined;
    c.modifiers = [];
    owner.hand.push(c);
  }
  sweepSourceModifiers(rt, inst.instanceId);
  addEvent(rt, "return-to-hand", `${cardLabel(rt, inst)} returns to its owner's hand.`, loc.owner, {
    cardInstanceId: inst.instanceId,
  });
  return cards;
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

export function cardLabel(rt: Rt, inst: CardInstance): string {
  try {
    return defOf(rt, inst.cardId).fullName;
  } catch {
    return inst.cardId;
  }
}

export function isWet(state: GameState, inst: CardInstance): boolean {
  return inst.zone === "play" && inst.enteredTurn >= state.turn;
}

/** Deterministic modifier id. */
export function modId(source: string, target: CardInstance): string {
  return `${source}->${target.instanceId}#${target.modifiers.length}`;
}
