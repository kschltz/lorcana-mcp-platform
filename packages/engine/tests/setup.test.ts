import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/index.js";
import {
  act, actErr, challenge, deckOf, findSeed, handOf, inkFirst, playCard, playOf, quest, registry, startGame,
} from "./helpers.js";

describe("setup & mulligan (SPEC §3.3, §3.5)", () => {
  it("shuffles, draws 7 each, starts in mulligan phase with p1 first", () => {
    const e = new GameEngine({ matchId: "m1", seed: 42, deckA: deckOf("TST-001"), deckB: deckOf("TST-002"), registry });
    const s = e.getState();
    expect(s.phase).toBe("mulligan");
    expect(s.turn).toBe(1);
    expect(s.activePlayer).toBe("p1");
    expect(s.players.p1.hand).toHaveLength(7);
    expect(s.players.p2.hand).toHaveLength(7);
    expect(s.players.p1.deck).toHaveLength(53);
    expect(s.players.p2.deck).toHaveLength(53);
    expect(s.players.p1.mulliganDone).toBe(false);
    expect(typeof s.rngState).toBe("number");
  });

  it("mulligan keeps selected cards, shuffles the rest back, redraws to 7", () => {
    const e = new GameEngine({ matchId: "m1", seed: 7, deckA: deckOf("TST-001", "TST-002"), deckB: deckOf("TST-001"), registry });
    const s0 = e.getState();
    const keepIds = s0.players.p1.hand.slice(0, 3).map((c) => c.instanceId);
    act(e, "p1", { type: "MULLIGAN", keep: keepIds });
    const s1 = e.getState();
    expect(s1.players.p1.hand).toHaveLength(7);
    const kept = s1.players.p1.hand.filter((c) => keepIds.includes(c.instanceId));
    expect(kept).toHaveLength(3);
    expect(s1.players.p1.deck).toHaveLength(53);
    expect(s1.players.p1.mulliganDone).toBe(true);
    expect(s1.phase).toBe("mulligan"); // p2 still pending
    // p1 cannot mulligan twice
    actErr(e, "p1", { type: "MULLIGAN", keep: [] });
    // p2 keep-all finishes setup
    act(e, "p2", { type: "MULLIGAN", keep: s1.players.p2.hand.map((c) => c.instanceId) });
    const s2 = e.getState();
    expect(s2.phase).toBe("main");
    expect(s2.activePlayer).toBe("p1");
    expect(s2.turn).toBe(1);
  });

  it("mulligan rejects cards not in hand", () => {
    const e = new GameEngine({ matchId: "m1", seed: 3, deckA: deckOf("TST-001"), deckB: deckOf("TST-001"), registry });
    actErr(e, "p1", { type: "MULLIGAN", keep: ["m1-9999"] });
  });
});

describe("inkwell rules", () => {
  it("allows one ink per turn, inkable cards only, ink refreshes each turn", () => {
    // deck with a non-inkable action mixed in
    const deckA = deckOf(...Array(30).fill("TST-001"), ...Array(30).fill("TST-009"));
    const deckB = deckOf("TST-001");
    const seed = findSeed(deckA, deckB, (s) => handOf(s, "p1", "TST-009").length > 0);
    const e = startGame(deckA, deckB, seed);

    // non-inkable cannot be inked
    const nonInkable = handOf(e.getState(), "p1", "TST-009")[0]!;
    actErr(e, "p1", { type: "PLAY_INK", cardInstanceId: nonInkable.instanceId });

    inkFirst(e, "p1", "TST-001");
    expect(e.getState().players.p1.inkwell).toHaveLength(1);
    expect(e.getState().players.p1.inkPlayedThisTurn).toBe(1);

    // second ink same turn is illegal
    const another = handOf(e.getState(), "p1", "TST-001")[0]!;
    const err = actErr(e, "p1", { type: "PLAY_INK", cardInstanceId: another.instanceId });
    expect(err).toMatch(/already played ink/);
  });

  it("ink is exerted to pay costs and readies at the start of your turn", () => {
    const e = startGame(deckOf("TST-001"), deckOf("TST-001"), 5);
    inkFirst(e, "p1");
    playCard(e, "p1", "TST-001"); // cost 1 → the one ink is exerted
    const ink = e.getState().players.p1.inkwell;
    expect(ink).toHaveLength(1);
    expect(ink[0]!.exerted).toBe(true);
    act(e, "p1", { type: "PASS" });
    // p2's turn: p2 inks and passes
    inkFirst(e, "p2");
    act(e, "p2", { type: "PASS" });
    // p1's next turn: ink ready again
    const s = e.getState();
    expect(s.turn).toBe(2);
    expect(s.activePlayer).toBe("p1");
    expect(s.players.p1.inkwell[0]!.exerted).toBe(false);
    expect(s.players.p1.inkPlayedThisTurn).toBe(0);
  });
});

describe("wet ink (SPEC §3.3)", () => {
  it("a character cannot quest or challenge the turn it enters", () => {
    const e = startGame(deckOf("TST-001"), deckOf("TST-001"), 9);
    inkFirst(e, "p1");
    playCard(e, "p1", "TST-001");
    const pico = playOf(e.getState(), "p1", "TST-001")[0]!;
    const err = actErr(e, "p1", { type: "QUEST", characterId: pico.instanceId });
    expect(err).toMatch(/cannot quest/);
    const other = playOf(e.getState(), "p2", "TST-001")[0];
    void other;
  });

  it("Rush lets a character challenge (but not quest) the turn it enters", () => {
    const deckA = deckOf("TST-003"); // Rush 2/2 cost 2
    const deckB = deckOf("TST-001"); // 1/1 cost 1
    const e = startGame(deckA, deckB, 11);
    // t1 p1: ink, pass
    inkFirst(e, "p1");
    act(e, "p1", { type: "PASS" });
    // t1 p2: ink, play pico (wet), pass
    inkFirst(e, "p2");
    playCard(e, "p2", "TST-001");
    act(e, "p2", { type: "PASS" });
    // t2 p1: ink, pass (save ink); t2 p2: quest pico (now exerted), pass
    inkFirst(e, "p1");
    act(e, "p1", { type: "PASS" });
    quest(e, "p2", "TST-001");
    inkFirst(e, "p2");
    act(e, "p2", { type: "PASS" });
    // t3 p1: ink (3), play Rush character and challenge the exerted pico immediately
    inkFirst(e, "p1");
    playCard(e, "p1", "TST-003");
    const res = challenge(e, "p1", "TST-003", "TST-001");
    expect(res.ok).toBe(true);
    const s = res.state;
    // pico (1 willpower) is banished by 2 damage; rush char takes 1 back
    expect(playOf(s, "p2", "TST-001")).toHaveLength(0);
    expect(s.players.p2.discard).toHaveLength(1);
    expect(playOf(s, "p1", "TST-003")[0]!.damage).toBe(1);
    // but Rush still cannot quest while wet
    const rush = playOf(s, "p1", "TST-003")[0]!;
    actErr(e, "p1", { type: "QUEST", characterId: rush.instanceId });
  });
});
