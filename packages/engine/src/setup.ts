// Game creation: instance building, seeded shuffle, opening hands, mulligan.

import type { CardInstance, GameState, PlayerId } from "./types.js";
import type { CardRegistry } from "./cards/registry.js";
import { Rng } from "./rng.js";
import { addEvent, drawCards, syncRng, type Rt } from "./state.js";

export interface SetupOptions {
  matchId: string;
  seed: number;
  deckA: string[]; // 60 cardIds for p1
  deckB: string[]; // 60 cardIds for p2
}

function buildInstances(matchId: string, deck: string[], owner: PlayerId, startSeq: number): CardInstance[] {
  return deck.map((cardId, i) => ({
    instanceId: `${matchId}-${String(startSeq + i).padStart(4, "0")}`,
    cardId,
    owner,
    zone: "deck" as const,
    exerted: false,
    damage: 0,
    enteredTurn: 0,
    modifiers: [],
  }));
}

/** Create the initial GameState + RNG: shuffle both decks, draw 7 each,
 * phase="mulligan", p1 takes the first turn. */
export function createInitialRt(opts: SetupOptions, registry: CardRegistry): Rt {
  const rng = new Rng(opts.seed);
  const p1deck = buildInstances(opts.matchId, opts.deckA, "p1", 1);
  const p2deck = buildInstances(opts.matchId, opts.deckB, "p2", opts.deckA.length + 1);
  rng.shuffle(p1deck);
  rng.shuffle(p2deck);

  const state: GameState = {
    matchId: opts.matchId,
    turn: 1,
    activePlayer: "p1",
    phase: "mulligan",
    players: {
      p1: { id: "p1", deck: p1deck, hand: [], inkwell: [], discard: [], play: [], lore: 0, inkPlayedThisTurn: 0, mulliganDone: false },
      p2: { id: "p2", deck: p2deck, hand: [], inkwell: [], discard: [], play: [], lore: 0, inkPlayedThisTurn: 0, mulliganDone: false },
    },
    log: [],
    rngState: rng.state,
  };
  const rt: Rt = { state, registry, rng, queue: [] };
  addEvent(rt, "game-start", `Match ${opts.matchId} begins (seed ${opts.seed}).`);
  const a = drawCards(rt, "p1", 7);
  addEvent(rt, "setup", `p1 draws their opening hand of ${a.length} cards.`, "p1");
  const b = drawCards(rt, "p2", 7);
  addEvent(rt, "setup", `p2 draws their opening hand of ${b.length} cards.`, "p2");
  addEvent(rt, "mulligan", "Both players may mulligan (MULLIGAN with keep list).");
  syncRng(rt);
  return rt;
}

/** Execute a mulligan: keep the listed cards, shuffle the rest back, redraw to 7. */
export function doMulligan(rt: Rt, player: PlayerId, keep: string[]): void {
  const p = rt.state.players[player];
  const keepSet = new Set(keep);
  const kept = p.hand.filter((c) => keepSet.has(c.instanceId));
  const back = p.hand.filter((c) => !keepSet.has(c.instanceId));
  p.hand = kept;
  for (const c of back) {
    c.zone = "deck";
    p.deck.push(c);
  }
  rt.rng.shuffle(p.deck);
  syncRng(rt);
  const need = 7 - p.hand.length;
  drawCards(rt, player, need);
  p.mulliganDone = true;
  addEvent(rt, "mulligan",
    `${player} keeps ${kept.length} card(s), shuffles ${back.length} back and redraws to ${p.hand.length}.`,
    player);
  if (rt.state.players.p1.mulliganDone && rt.state.players.p2.mulliganDone) {
    startFirstTurn(rt);
  }
}

/** Both mulligans done → p1's first turn (Ready trivial, Draw skipped). */
function startFirstTurn(rt: Rt): void {
  rt.state.phase = "main";
  rt.state.turn = 1;
  rt.state.activePlayer = "p1";
  rt.state.players.p1.inkPlayedThisTurn = 0;
  addEvent(rt, "turn", "Turn 1 — p1's turn begins (no draw on the very first turn).", "p1");
}
