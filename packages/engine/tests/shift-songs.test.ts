import { describe, expect, it } from "vitest";
import type { GameEngine, PlayerId } from "../src/index.js";
import {
  act, actErr, deckOf, findSeed, handOf, inkFirst, pass, playCard, playOf, quest, startGame,
} from "./helpers.js";

function inkPass(e: GameEngine, p: PlayerId): void {
  inkFirst(e, p);
  pass(e, p);
}

describe("songs: sung vs paid (SPEC §3.3)", () => {
  it("a Song can be paid with ink and resolves its effect (draw 2)", () => {
    const e = startGame(deckOf("TST-008"), deckOf("TST-001"), 41);
    inkPass(e, "p1"); inkPass(e, "p2"); // t1
    inkPass(e, "p1"); inkPass(e, "p2"); // t2
    // t3: pay 3 ink for Be Our Guest
    inkFirst(e, "p1");
    const handBefore = e.getState().players.p1.hand.length;
    playCard(e, "p1", "TST-008");
    const s = e.getState();
    expect(s.players.p1.inkwell.every((c) => c.exerted)).toBe(true); // all 3 ink spent
    expect(s.players.p1.discard.map((c) => c.cardId)).toContain("TST-008");
    // -1 song played, +2 drawn
    expect(s.players.p1.hand.length).toBe(handBefore - 1 + 2);
  });

  it("a Song can be sung for free by a ready character (even a wet one, with Singer N)", () => {
    const deckA = deckOf(...Array(30).fill("TST-014"), ...Array(30).fill("TST-008"));
    const seed = findSeed(deckA, deckOf("TST-001"), (s) =>
      handOf(s, "p1", "TST-014").length > 0 && handOf(s, "p1", "TST-008").length > 0);
    const e = startGame(deckA, deckOf("TST-001"), seed);
    inkPass(e, "p1"); inkPass(e, "p2"); // t1
    // t2: play Ariel (Singer 5), she is wet — singing is still allowed
    inkFirst(e, "p1");
    playCard(e, "p1", "TST-014");
    const s0 = e.getState();
    const ariel = playOf(s0, "p1", "TST-014")[0]!;
    const song = handOf(s0, "p1", "TST-008")[0]!;
    const handBefore = s0.players.p1.hand.length;
    act(e, "p1", {
      type: "PLAY_CARD", cardInstanceId: song.instanceId,
      choices: { payAlternatives: { mode: "sing", singer: ariel.instanceId } },
    });
    const s = e.getState();
    expect(playOf(s, "p1", "TST-014")[0]!.exerted).toBe(true); // singer exerted
    // sung for free: it succeeded with 0 ready ink available (song costs 3)
    expect(s.players.p1.inkwell.filter((c) => !c.exerted)).toHaveLength(0);
    expect(s.players.p1.inkwell).toHaveLength(2);
    expect(s.players.p1.hand.length).toBe(handBefore - 1 + 2); // song left, drew 2
  });

  it("a character whose cost is too low cannot sing the song", () => {
    const deckA = deckOf(...Array(30).fill("TST-001"), ...Array(30).fill("TST-008"));
    const seed = findSeed(deckA, deckOf("TST-001"), (s) => handOf(s, "p1", "TST-008").length > 0);
    const e = startGame(deckA, deckOf("TST-001"), seed);
    inkFirst(e, "p1"); playCard(e, "p1", "TST-001"); pass(e, "p1"); // t1: pico cost 1
    inkPass(e, "p2");
    // t2: pico is dry but cost 1 < song cost 3
    inkFirst(e, "p1");
    const s = e.getState();
    const pico = playOf(s, "p1", "TST-001")[0]!;
    const song = handOf(s, "p1", "TST-008")[0]!;
    const err = actErr(e, "p1", {
      type: "PLAY_CARD", cardInstanceId: song.instanceId,
      choices: { payAlternatives: { mode: "sing", singer: pico.instanceId } },
    });
    expect(err).toMatch(/invalid singer/);
  });
});

describe("Shift (SPEC §3.3)", () => {
  it("shift stacks cards, inherits damage/exertion/dryness, top card defines stats", () => {
    const deckA = deckOf(...Array(30).fill("TST-002"), ...Array(30).fill("TST-013"));
    const seed = findSeed(deckA, deckOf("TST-001"), (s) =>
      handOf(s, "p1", "TST-002").length > 0 && handOf(s, "p1", "TST-013").length > 0);
    const e = startGame(deckA, deckOf("TST-001"), seed);
    inkPass(e, "p1"); inkPass(e, "p2"); // t1
    inkPass(e, "p1"); inkPass(e, "p2"); // t2
    // t3: play Stitch - Little Guy (3/3)
    inkFirst(e, "p1"); playCard(e, "p1", "TST-002"); pass(e, "p1");
    inkPass(e, "p2");
    // t4: stitch is dry — quest (2 lore, exerted), then shift Abomination on top for 4
    inkFirst(e, "p1");
    quest(e, "p1", "TST-002");
    const s0 = e.getState();
    const base = playOf(s0, "p1", "TST-002")[0]!;
    expect(base.exerted).toBe(true);
    const abom = handOf(s0, "p1", "TST-013")[0]!;
    act(e, "p1", {
      type: "PLAY_CARD", cardInstanceId: abom.instanceId,
      choices: { targets: [base.instanceId], payAlternatives: { mode: "shift" } },
    });
    const s = e.getState();
    expect(s.players.p1.lore).toBe(2); // from the quest before shifting
    const top = playOf(s, "p1", "TST-013")[0]!;
    expect(top.under).toEqual([base.instanceId]);
    expect(top.shiftedOnto).toBe(base.instanceId);
    expect(top.exerted).toBe(true); // inherited exertion
    expect(top.enteredTurn).toBe(base.enteredTurn); // inherited dryness
    // the base card is no longer independently in play
    expect(playOf(s, "p1", "TST-002")).toHaveLength(0);
    expect(s.players.p1.play).toHaveLength(2); // stack = top + under
    // 4 ink spent on shift, 0 of 4 left
    expect(s.players.p1.inkwell.every((c) => c.exerted)).toBe(true);
    pass(e, "p1");
    inkPass(e, "p2");
    // t5: the shifted Abomination is dry (inherited) — quests for 3 lore (top defines stats)
    quest(e, "p1", "TST-013");
    expect(e.getState().players.p1.lore).toBe(5);
  });

  it("a Floodborn cannot shift onto a non-matching name", () => {
    const deckA = deckOf(...Array(30).fill("TST-001"), ...Array(30).fill("TST-013"));
    const seed = findSeed(deckA, deckOf("TST-001"), (s) => handOf(s, "p1", "TST-013").length > 0);
    const e = startGame(deckA, deckOf("TST-001"), seed);
    // build 4 ink and a pico in play
    inkFirst(e, "p1"); playCard(e, "p1", "TST-001"); pass(e, "p1");
    inkPass(e, "p2");
    inkPass(e, "p1"); inkPass(e, "p2");
    inkPass(e, "p1"); inkPass(e, "p2");
    inkFirst(e, "p1"); // t4: 4 ink
    const s = e.getState();
    const pico = playOf(s, "p1", "TST-001")[0]!;
    const abom = handOf(s, "p1", "TST-013")[0]!;
    const err = actErr(e, "p1", {
      type: "PLAY_CARD", cardInstanceId: abom.instanceId,
      choices: { targets: [pico.instanceId], payAlternatives: { mode: "shift" } },
    });
    expect(err).toMatch(/shift: invalid target/);
    // full cost 6 is also unpayable with 4 ink
    expect(actErr(e, "p1", { type: "PLAY_CARD", cardInstanceId: abom.instanceId })).toMatch(/not enough ink/);
  });
});

describe("items with activated abilities", () => {
  it("exert to draw 1, once per turn, usable again next turn", () => {
    const e = startGame(deckOf("TST-011"), deckOf("TST-001"), 43);
    inkPass(e, "p1"); inkPass(e, "p2"); // t1
    // t2: play Magic Mirror
    inkFirst(e, "p1"); playCard(e, "p1", "TST-011");
    let s = e.getState();
    const mirror = playOf(s, "p1", "TST-011")[0]!;
    const handBefore = s.players.p1.hand.length;
    const deckBefore = s.players.p1.deck.length;
    act(e, "p1", { type: "ACTIVATE_ABILITY", cardInstanceId: mirror.instanceId, abilityIndex: 0 });
    s = e.getState();
    expect(playOf(s, "p1", "TST-011")[0]!.exerted).toBe(true);
    expect(s.players.p1.hand.length).toBe(handBefore + 1);
    expect(s.players.p1.deck.length).toBe(deckBefore - 1);
    // once per turn
    actErr(e, "p1", { type: "ACTIVATE_ABILITY", cardInstanceId: mirror.instanceId, abilityIndex: 0 });
    pass(e, "p1");
    inkPass(e, "p2");
    // t3: ready again, usable again
    inkFirst(e, "p1");
    act(e, "p1", { type: "ACTIVATE_ABILITY", cardInstanceId: mirror.instanceId, abilityIndex: 0 });
    expect(playOf(e.getState(), "p1", "TST-011")[0]!.exerted).toBe(true);
  });
});
