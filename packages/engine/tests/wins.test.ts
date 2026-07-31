import { describe, expect, it } from "vitest";
import { act, actErr, deckOf, inkFirst, pass, startGame } from "./helpers.js";

describe("wins & losses (SPEC §3.3)", () => {
  it("first to 20 lore wins immediately", () => {
    const e = startGame(deckOf("TST-001"), deckOf("TST-001"), 51);
    // drive p1 purely through enumerated legal actions (also smoke-tests enumeration)
    let guard = 0;
    while (!e.getState().winner && guard++ < 400) {
      const s = e.getState();
      const active = s.activePlayer;
      const legal = e.getLegalActions(active);
      expect(legal.length).toBeGreaterThan(0);
      const pick =
        legal.find((l) => l.action.type === "QUEST") ??
        (active === "p1" ? legal.find((l) => l.action.type === "PLAY_CARD") : undefined) ??
        legal.find((l) => l.action.type === "PLAY_INK") ??
        legal.find((l) => l.action.type === "PASS")!;
      const res = e.applyAction(active, pick.action);
      if (!res.ok) throw new Error(`illegal action enumerated: ${JSON.stringify(pick.action)} → ${res.error}`);
    }
    const s = e.getState();
    expect(s.winner).toBe("p1");
    expect(s.winReason).toBe("lore");
    expect(s.players.p1.lore).toBeGreaterThanOrEqual(20);
    expect(s.phase).toBe("game-over");
    expect(e.getLegalActions("p1")).toHaveLength(0);
    expect(actErr(e, "p1", { type: "PASS" })).toMatch(/game is over/);
  });

  it("drawing from an empty deck loses (deck-out)", () => {
    // p1 has only 7 cards: opening hand empties the deck
    const e = startGame(Array(7).fill("TST-001"), deckOf("TST-001"), 53);
    const s0 = e.getState();
    expect(s0.players.p1.deck).toHaveLength(0);
    expect(s0.players.p1.hand).toHaveLength(7);
    pass(e, "p1"); // t1: p1 skips the first-turn draw
    pass(e, "p2"); // t1: p2 draws fine; passing back triggers p1's draw step
    const s = e.getState();
    expect(s.winner).toBe("p2");
    expect(s.winReason).toBe("deck-out");
    expect(s.phase).toBe("game-over");
  });

  it("concede ends the game for the conceding player", () => {
    const e = startGame(deckOf("TST-001"), deckOf("TST-001"), 55);
    act(e, "p2", { type: "CONCEDE" });
    const s = e.getState();
    expect(s.winner).toBe("p1");
    expect(s.winReason).toBe("concede");
    expect(s.phase).toBe("game-over");
    expect(e.getLegalActions("p1")).toHaveLength(0);
    actErr(e, "p1", { type: "PASS" });
  });

  it("the very first turn skips the draw but later turns draw", () => {
    const e = startGame(deckOf("TST-001"), deckOf("TST-001"), 57);
    expect(e.getState().players.p1.hand).toHaveLength(7);
    inkFirst(e, "p1");
    pass(e, "p1"); // p1's first turn had no draw step (hand was 7 → 6 after inking)
    expect(e.getState().players.p1.hand).toHaveLength(6);
    // p2's first turn DOES draw
    expect(e.getState().players.p2.hand).toHaveLength(8);
    inkFirst(e, "p2");
    pass(e, "p2");
    // p1's second turn draws too
    expect(e.getState().players.p1.hand).toHaveLength(7);
  });
});
