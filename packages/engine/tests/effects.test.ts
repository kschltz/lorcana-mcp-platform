import { describe, expect, it } from "vitest";
import type { GameEngine, PlayerId } from "../src/index.js";
import {
  act, actErr, deckOf, handOf, inkFirst, pass, playCard, playOf, quest, startGame,
} from "./helpers.js";

function inkPass(e: GameEngine, p: PlayerId): void {
  inkFirst(e, p);
  pass(e, p);
}

describe("effect DSL interpreter (SPEC §4)", () => {
  it("DEAL_DAMAGE with a chosen target suspends into PendingChoice, then resumes", () => {
    const e = startGame(deckOf("TST-009", "TST-001"), deckOf("TST-006", "TST-001"), 61);
    inkPass(e, "p1"); // t1
    inkFirst(e, "p2"); playCard(e, "p2", "TST-001"); pass(e, "p2"); // pico
    inkPass(e, "p1"); inkPass(e, "p2"); // t2
    inkPass(e, "p1"); // t3
    inkFirst(e, "p2"); playCard(e, "p2", "TST-006"); pass(e, "p2"); // Rex (4 willpower)
    // t4 p1: play Fire the Cannons (cost 2), non-inkable in hand alongside inkable picos
    inkFirst(e, "p1", "TST-001");
    const song = handOf(e.getState(), "p1", "TST-009")[0]!;
    const res = act(e, "p1", { type: "PLAY_CARD", cardInstanceId: song.instanceId });
    // action went to discard, but a target choice is pending (two candidates)
    expect(res.state.players.p1.discard.map((c) => c.cardId)).toContain("TST-009");
    const pend = res.state.pendingChoice!;
    expect(pend.kind).toBe("choose-target");
    expect(pend.player).toBe("p1");
    expect(pend.options).toHaveLength(2);
    const rex = playOf(res.state, "p2", "TST-006")[0]!;
    expect(pend.options.map((o) => o.id)).toContain(rex.instanceId);
    // only RESOLVE_CHOICE legal now
    expect(e.getLegalActions("p1").every((l) => l.action.type === "RESOLVE_CHOICE")).toBe(true);
    // 3 damage < 4 willpower: Rex survives with 3 damage
    act(e, "p1", { type: "RESOLVE_CHOICE", choiceId: pend.id, selected: [rex.instanceId] });
    const s = e.getState();
    expect(s.pendingChoice).toBeUndefined();
    expect(playOf(s, "p2", "TST-006")[0]!.damage).toBe(3);
  });

  it("a lethal DEAL_DAMAGE banishes the chosen target", () => {
    const e = startGame(deckOf("TST-009", "TST-001"), deckOf("TST-001"), 63);
    inkPass(e, "p1"); // t1
    inkFirst(e, "p2"); playCard(e, "p2", "TST-001"); pass(e, "p2"); // pico #1
    inkPass(e, "p1"); // t2
    inkFirst(e, "p2"); playCard(e, "p2", "TST-001"); pass(e, "p2"); // pico #2
    inkFirst(e, "p1", "TST-001"); // t3
    const cannons = handOf(e.getState(), "p1", "TST-009")[0]!;
    act(e, "p1", { type: "PLAY_CARD", cardInstanceId: cannons.instanceId });
    const pend = e.getState().pendingChoice!;
    expect(pend.options).toHaveLength(2);
    const pico = playOf(e.getState(), "p2", "TST-001")[0]!;
    act(e, "p1", { type: "RESOLVE_CHOICE", choiceId: pend.id, selected: [pico.instanceId] });
    const s = e.getState();
    expect(playOf(s, "p2", "TST-001")).toHaveLength(1); // the other pico survives
    expect(s.players.p2.discard.map((c) => c.cardId)).toContain("TST-001");
  });

  it("RESOLVE_CHOICE validates player, id, count and option ids", () => {
    const e = startGame(deckOf("TST-009", "TST-001"), deckOf("TST-001"), 65);
    inkPass(e, "p1"); // t1
    inkFirst(e, "p2"); playCard(e, "p2", "TST-001"); pass(e, "p2");
    inkPass(e, "p1"); // t2
    inkFirst(e, "p2"); playCard(e, "p2", "TST-001"); pass(e, "p2"); // second pico → real choice
    inkFirst(e, "p1", "TST-001"); // t3
    const cannons = handOf(e.getState(), "p1", "TST-009")[0]!;
    act(e, "p1", { type: "PLAY_CARD", cardInstanceId: cannons.instanceId });
    const pend = e.getState().pendingChoice!;
    const pico = playOf(e.getState(), "p2", "TST-001")[0]!;
    expect(actErr(e, "p2", { type: "RESOLVE_CHOICE", choiceId: pend.id, selected: [pico.instanceId] }))
      .toMatch(/waiting on p1/);
    expect(actErr(e, "p1", { type: "RESOLVE_CHOICE", choiceId: "wrong-id", selected: [pico.instanceId] }))
      .toMatch(/mismatch/);
    expect(actErr(e, "p1", { type: "RESOLVE_CHOICE", choiceId: pend.id, selected: ["nope"] }))
      .toMatch(/invalid option/);
    expect(actErr(e, "p1", { type: "RESOLVE_CHOICE", choiceId: pend.id, selected: [] }))
      .toMatch(/between 1 and 1/);
    // state unchanged by failed resolutions
    expect(e.getState().pendingChoice).toBeDefined();
    act(e, "p1", { type: "RESOLVE_CHOICE", choiceId: pend.id, selected: [pico.instanceId] });
    expect(e.getState().pendingChoice).toBeUndefined();
  });

  it("ON_QUEST triggered ability fires (Merlin: gain 1 lore when this quests)", () => {
    const e = startGame(deckOf("TST-015"), deckOf("TST-001"), 67);
    inkPass(e, "p1"); inkPass(e, "p2"); // t1
    inkPass(e, "p1"); inkPass(e, "p2"); // t2
    inkFirst(e, "p1"); playCard(e, "p1", "TST-015"); pass(e, "p1"); // t3: Merlin 2/3 lore 1
    inkPass(e, "p2");
    // t4: quest → 1 lore from questing + 1 from the trigger
    quest(e, "p1", "TST-015");
    expect(e.getState().players.p1.lore).toBe(2);
    const loreEvents = e.getState().log.filter((ev) => ev.type === "lore");
    expect(loreEvents.some((ev) => ev.message.includes("gains 1 lore"))).toBe(true);
  });
});
