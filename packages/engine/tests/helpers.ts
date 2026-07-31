// Shared test helpers: deterministic decks, seed search, action shortcuts.

import { GameEngine, createTestRegistry, type CardRegistry } from "../src/index.js";
import type { PlayerAction, PlayerId, GameState, CardInstance } from "../src/index.js";

export const registry: CardRegistry = createTestRegistry();

/** A 60-card deck cycling through the given card ids. */
export function deckOf(...cardIds: string[]): string[] {
  const deck: string[] = [];
  for (let i = 0; i < 60; i++) deck.push(cardIds[i % cardIds.length]!);
  return deck;
}

/** Find a seed whose opening hands satisfy `pred` (checked after keep-all
 * mulligans, which preserve the initial hands). */
export function findSeed(
  deckA: string[], deckB: string[],
  pred: (state: GameState) => boolean,
  maxTries = 500,
): number {
  for (let seed = 1; seed <= maxTries; seed++) {
    const e = new GameEngine({ matchId: "m1", seed, deckA, deckB, registry });
    if (pred(e.getState())) return seed;
  }
  throw new Error("no seed found");
}

/** Create an engine and complete keep-all mulligans for both players. */
export function startGame(deckA: string[], deckB: string[], seed = 1, matchId = "m1"): GameEngine {
  const e = new GameEngine({ matchId, seed, deckA, deckB, registry });
  const s = e.getState();
  act(e, "p1", { type: "MULLIGAN", keep: s.players.p1.hand.map((c) => c.instanceId) });
  act(e, "p2", { type: "MULLIGAN", keep: s.players.p2.hand.map((c) => c.instanceId) });
  return e;
}

/** Apply an action and assert success. */
export function act(e: GameEngine, player: PlayerId, action: PlayerAction) {
  const res = e.applyAction(player, action);
  if (!res.ok) throw new Error(`action failed: ${action.type} by ${player}: ${res.error}`);
  return res;
}

/** Apply an action expecting failure; returns the error. */
export function actErr(e: GameEngine, player: PlayerId, action: PlayerAction): string {
  const res = e.applyAction(player, action);
  if (res.ok) throw new Error(`expected failure but ${action.type} by ${player} succeeded`);
  return res.error ?? "unknown";
}

/** Instances of a card id in a player's hand. */
export function handOf(state: GameState, player: PlayerId, cardId?: string): CardInstance[] {
  const h = state.players[player].hand;
  return cardId ? h.filter((c) => c.cardId === cardId) : h;
}

/** Instances of a card id in a player's play area (active only). */
export function playOf(state: GameState, player: PlayerId, cardId?: string): CardInstance[] {
  const under = new Set<string>();
  for (const c of state.players[player].play) for (const u of c.under ?? []) under.add(u);
  const p = state.players[player].play.filter((c) => !under.has(c.instanceId));
  return cardId ? p.filter((c) => c.cardId === cardId) : p;
}

/** Play the first inkable card in hand as ink. */
export function inkFirst(e: GameEngine, player: PlayerId, cardId?: string): void {
  const s = e.getState();
  const hand = s.players[player].hand;
  const card = cardId
    ? hand.find((c) => c.cardId === cardId)
    : hand.find((c) => registry.get(c.cardId).inkable);
  if (!card) throw new Error(`no inkable card in ${player}'s hand`);
  act(e, player, { type: "PLAY_INK", cardInstanceId: card.instanceId });
}

/** Play the first matching card from hand (assumes affordable). */
export function playCard(e: GameEngine, player: PlayerId, cardId: string, choices?: import("../src/index.js").PlayChoices) {
  const s = e.getState();
  const card = handOf(s, player, cardId)[0];
  if (!card) throw new Error(`${cardId} not in ${player}'s hand`);
  return act(e, player, choices
    ? { type: "PLAY_CARD", cardInstanceId: card.instanceId, choices }
    : { type: "PLAY_CARD", cardInstanceId: card.instanceId });
}

export function pass(e: GameEngine, player: PlayerId) {
  return act(e, player, { type: "PASS" });
}

export function quest(e: GameEngine, player: PlayerId, cardId: string) {
  const s = e.getState();
  const c = playOf(s, player, cardId)[0];
  if (!c) throw new Error(`${cardId} not in play for ${player}`);
  return act(e, player, { type: "QUEST", characterId: c.instanceId });
}

export function challenge(e: GameEngine, player: PlayerId, attackerId: string, defenderId: string) {
  const s = e.getState();
  const a = playOf(s, player, attackerId)[0];
  const d = playOf(s, player === "p1" ? "p2" : "p1", defenderId)[0];
  if (!a || !d) throw new Error(`challenge actors not found (${attackerId} -> ${defenderId})`);
  return act(e, player, { type: "CHALLENGE", attackerId: a.instanceId, defenderId: d.instanceId });
}
