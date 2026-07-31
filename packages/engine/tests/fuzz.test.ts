import { describe, expect, it } from "vitest";
import { GameEngine, Rng, type PlayerId } from "../src/index.js";
import { deckOf, registry } from "./helpers.js";

const ALL = [
  "TST-001", "TST-002", "TST-003", "TST-004", "TST-005", "TST-006", "TST-007", "TST-008",
  "TST-009", "TST-010", "TST-011", "TST-012", "TST-013", "TST-014", "TST-015", "TST-016", "TST-017",
];

/**
 * Drive full games using ONLY actions from getLegalActions, with a seeded
 * random-ish policy biased toward questing so games terminate. Any engine
 * error from an enumerated legal action is a P0 bug (SPEC §8).
 */
function fuzzGame(seed: number, maxActions = 600): { winner?: PlayerId; actions: number } {
  const deckA = deckOf(...ALL);
  const deckB = deckOf(...ALL.slice().reverse());
  const e = new GameEngine({ matchId: "fz", seed, deckA, deckB, registry });
  const rng = new Rng(seed * 7919 + 13);
  let n = 0;
  while (!e.getState().winner && n++ < maxActions) {
    const s = e.getState();
    let player: PlayerId;
    if (s.phase === "mulligan") player = !s.players.p1.mulliganDone ? "p1" : "p2";
    else if (s.pendingChoice) player = s.pendingChoice.player;
    else player = s.activePlayer;
    const legal = e.getLegalActions(player);
    if (legal.length === 0) throw new Error(`no legal actions for ${player} but game not over`);
    const quests = legal.filter((l) => l.action.type === "QUEST");
    const pick = quests.length > 0 && rng.next() < 0.7
      ? quests[rng.nextInt(quests.length)]!
      : legal[rng.nextInt(legal.length)]!;
    const res = e.applyAction(player, pick.action);
    if (!res.ok) {
      throw new Error(`P0: enumerated legal action rejected: ${res.error} :: ${JSON.stringify(pick.action)}`);
    }
  }
  return { winner: e.getState().winner, actions: n };
}

describe("fuzz: full games through legal-action enumeration only", () => {
  for (const seed of [3, 5, 8, 13]) {
    it(`seed ${seed}: no illegal-action errors, game terminates`, () => {
      const { winner, actions } = fuzzGame(seed);
      expect(winner, `game should terminate within the action cap`).toBeDefined();
      expect(actions).toBeLessThanOrEqual(600);
    });
  }
});
