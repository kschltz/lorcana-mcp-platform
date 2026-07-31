import { describe, expect, it } from "vitest";
import type { GameEngine, PlayerId } from "../src/index.js";
import {
  act, actErr, challenge, deckOf, findSeed, handOf, inkFirst, pass, playCard, playOf, quest,
  startGame,
} from "./helpers.js";

function inkPass(e: GameEngine, p: PlayerId): void {
  inkFirst(e, p);
  pass(e, p);
}

describe("challenge basics", () => {
  it("simultaneous damage banishes both 3/3 characters", () => {
    const e = startGame(deckOf("TST-002"), deckOf("TST-002"), 21);
    inkPass(e, "p1"); inkPass(e, "p2"); // t1
    inkPass(e, "p1"); inkPass(e, "p2"); // t2
    inkFirst(e, "p1"); playCard(e, "p1", "TST-002"); pass(e, "p1"); // t3
    inkFirst(e, "p2"); playCard(e, "p2", "TST-002"); pass(e, "p2");
    inkPass(e, "p1"); // t4
    quest(e, "p2", "TST-002"); // exerted, 2 lore
    inkFirst(e, "p2"); pass(e, "p2");
    // t5: p1 attacks the exerted Stitch
    const res = challenge(e, "p1", "TST-002", "TST-002");
    const s = res.state;
    expect(playOf(s, "p1", "TST-002")).toHaveLength(0);
    expect(playOf(s, "p2", "TST-002")).toHaveLength(0);
    expect(s.players.p1.discard).toHaveLength(1);
    expect(s.players.p2.discard).toHaveLength(1);
    expect(s.players.p2.lore).toBe(2);
  });

  it("Challenger +2 boosts attacker strength; Resist 2 reduces damage received", () => {
    const e = startGame(deckOf("TST-006"), deckOf("TST-005"), 23);
    inkPass(e, "p1"); inkPass(e, "p2"); // t1
    inkPass(e, "p1"); inkPass(e, "p2"); // t2
    inkFirst(e, "p1"); playCard(e, "p1", "TST-006"); pass(e, "p1"); // t3: Rex 2/4 Challenger+2
    inkFirst(e, "p2"); pass(e, "p2");
    inkFirst(e, "p1"); pass(e, "p1"); // t4
    inkFirst(e, "p2"); playCard(e, "p2", "TST-005"); pass(e, "p2"); // Boulder 2/6 Resist2
    inkPass(e, "p1"); // t5
    quest(e, "p2", "TST-005"); // exert Boulder
    inkFirst(e, "p2"); pass(e, "p2");
    // t6: Rex (2 + 2 challenger = 4) hits Boulder; Resist 2 → 2 damage.
    // Boulder (2) hits Rex (4 willpower) → 2 damage.
    const res = challenge(e, "p1", "TST-006", "TST-005");
    const s = res.state;
    expect(playOf(s, "p2", "TST-005")[0]!.damage).toBe(2);
    expect(playOf(s, "p1", "TST-006")[0]!.damage).toBe(2);
    // nobody banished
    expect(s.players.p1.discard).toHaveLength(0);
    expect(s.players.p2.discard).toHaveLength(0);
  });

  it("Support donates strength to another character for the turn (CHOICE + modifier)", () => {
    const deckA = deckOf(...Array(30).fill("TST-007"), ...Array(30).fill("TST-002"));
    const deckB = deckOf("TST-002");
    const seed = findSeed(deckA, deckB, (s) =>
      handOf(s, "p1", "TST-007").length > 0 && handOf(s, "p1", "TST-002").length > 0);
    const e = startGame(deckA, deckB, seed);
    inkPass(e, "p1"); inkPass(e, "p2"); // t1
    inkFirst(e, "p1"); playCard(e, "p1", "TST-007"); pass(e, "p1"); // t2: Remy 2/2 Support
    inkPass(e, "p2");
    inkFirst(e, "p1"); playCard(e, "p1", "TST-002"); pass(e, "p1"); // t3: Stitch 3/3
    inkFirst(e, "p2"); playCard(e, "p2", "TST-002"); pass(e, "p2");
    inkPass(e, "p1"); // t4
    quest(e, "p2", "TST-002"); // p2's Stitch exerted
    inkFirst(e, "p2"); pass(e, "p2");
    // t5: Remy quests → Support pending choice
    quest(e, "p1", "TST-007");
    let s = e.getState();
    expect(s.pendingChoice).toBeDefined();
    expect(s.pendingChoice!.player).toBe("p1");
    // only RESOLVE_CHOICE is legal while the choice is pending
    const legal = e.getLegalActions("p1");
    expect(legal.length).toBeGreaterThan(0);
    expect(legal.every((l) => l.action.type === "RESOLVE_CHOICE")).toBe(true);
    expect(e.getLegalActions("p2")).toHaveLength(0);
    // other actions are rejected while pending
    actErr(e, "p1", { type: "PASS" });
    // donate to Stitch
    const stitch = playOf(s, "p1", "TST-002")[0]!;
    act(e, "p1", { type: "RESOLVE_CHOICE", choiceId: s.pendingChoice!.id, selected: [stitch.instanceId] });
    s = e.getState();
    expect(s.pendingChoice).toBeUndefined();
    const mod = playOf(s, "p1", "TST-002")[0]!.modifiers.find((m) => m.stat?.strength === 2);
    expect(mod).toBeDefined();
    expect(mod!.duration).toBe("this-turn");
    // Stitch now challenges for 3+2=5 damage → banishes p2's 3-willpower Stitch
    const res = challenge(e, "p1", "TST-002", "TST-002");
    expect(playOf(res.state, "p2", "TST-002")).toHaveLength(0);
    // our Stitch took 3 back and lives with 3 damage (3+... willpower 3 → banished too!)
    // 3 damage >= 3 willpower → also banished (simultaneous damage).
    expect(playOf(res.state, "p1", "TST-002")).toHaveLength(0);
  });
});

describe("combat keywords", () => {
  it("Evasive can only be challenged by Evasive", () => {
    const e = startGame(deckOf("TST-002"), deckOf("TST-012"), 25);
    inkPass(e, "p1"); inkPass(e, "p2"); // t1
    inkPass(e, "p1"); inkPass(e, "p2"); // t2
    inkFirst(e, "p1"); playCard(e, "p1", "TST-002"); pass(e, "p1"); // t3
    inkFirst(e, "p2"); playCard(e, "p2", "TST-012"); pass(e, "p2"); // Peter Pan (Evasive)
    inkPass(e, "p1"); // t4
    quest(e, "p2", "TST-012"); // exert Peter
    inkFirst(e, "p2"); pass(e, "p2");
    // t5: non-Evasive attacker cannot challenge the Evasive
    const s = e.getState();
    const atk = playOf(s, "p1", "TST-002")[0]!;
    const def = playOf(s, "p2", "TST-012")[0]!;
    const err = actErr(e, "p1", { type: "CHALLENGE", attackerId: atk.instanceId, defenderId: def.instanceId });
    expect(err).toMatch(/illegal challenge target/);
  });

  it("Evasive attacker may challenge an Evasive defender", () => {
    const e = startGame(deckOf("TST-012"), deckOf("TST-012"), 27);
    inkPass(e, "p1"); inkPass(e, "p2");
    inkPass(e, "p1"); inkPass(e, "p2");
    inkFirst(e, "p1"); playCard(e, "p1", "TST-012"); pass(e, "p1");
    inkFirst(e, "p2"); playCard(e, "p2", "TST-012"); pass(e, "p2");
    inkPass(e, "p1");
    quest(e, "p2", "TST-012");
    inkFirst(e, "p2"); pass(e, "p2");
    const res = challenge(e, "p1", "TST-012", "TST-012"); // 2/2 vs 2/2 → both banished
    expect(playOf(res.state, "p1", "TST-012")).toHaveLength(0);
    expect(playOf(res.state, "p2", "TST-012")).toHaveLength(0);
  });

  it("Bodyguard must be challenged before non-Bodyguards (and may enter exerted)", () => {
    const deckB = deckOf(...Array(30).fill("TST-004"), ...Array(30).fill("TST-001"));
    const seed = findSeed(deckOf("TST-002"), deckB, (s) =>
      handOf(s, "p2", "TST-004").length > 0 && handOf(s, "p2", "TST-001").length > 0);
    const e = startGame(deckOf("TST-002"), deckB, seed);
    inkPass(e, "p1"); // t1
    inkFirst(e, "p2"); playCard(e, "p2", "TST-001"); pass(e, "p2");
    inkPass(e, "p1"); // t2
    quest(e, "p2", "TST-001"); // pico exerted
    inkFirst(e, "p2"); pass(e, "p2");
    inkFirst(e, "p1"); playCard(e, "p1", "TST-002"); pass(e, "p1"); // t3
    inkFirst(e, "p2"); pass(e, "p2");
    inkPass(e, "p1"); // t4
    inkFirst(e, "p2"); // t4: Goliath enters exerted via the Bodyguard choice
    playCard(e, "p2", "TST-004", { options: ["exert"] });
    pass(e, "p2");
    // t5: pico is exerted too, but only Goliath is a legal challenge target
    const s = e.getState();
    const challenges = e.getLegalActions("p1").filter((l) => l.action.type === "CHALLENGE");
    const goliath = playOf(s, "p2", "TST-004")[0]!;
    const pico = playOf(s, "p2", "TST-001")[0]!;
    expect(challenges.length).toBeGreaterThan(0);
    expect(challenges.every((l) => l.action.type === "CHALLENGE" && l.action.defenderId === goliath.instanceId)).toBe(true);
    const atk = playOf(s, "p1", "TST-002")[0]!;
    const err = actErr(e, "p1", { type: "CHALLENGE", attackerId: atk.instanceId, defenderId: pico.instanceId });
    expect(err).toMatch(/Bodyguard/i);
    // challenging the Bodyguard works
    const res = act(e, "p1", { type: "CHALLENGE", attackerId: atk.instanceId, defenderId: goliath.instanceId });
    expect(playOf(res.state, "p2", "TST-004")[0]!.damage).toBe(3); // 5 willpower survives
    expect(playOf(res.state, "p1", "TST-002")).toHaveLength(0); // 3 damage back banishes Stitch
  });

  it("Reckless cannot quest and must challenge if able (blocks PASS)", () => {
    const e = startGame(deckOf("TST-016"), deckOf("TST-001"), 29);
    inkPass(e, "p1"); // t1
    inkFirst(e, "p2"); playCard(e, "p2", "TST-001"); pass(e, "p2");
    inkPass(e, "p1"); inkPass(e, "p2"); // t2
    inkFirst(e, "p1"); playCard(e, "p1", "TST-016"); pass(e, "p1"); // t3: Beast 4/3 Reckless
    quest(e, "p2", "TST-001"); // t3 p2: pico quests and stays exerted into p1's turn
    inkFirst(e, "p2"); pass(e, "p2");
    // t4: Beast is dry and must challenge
    const s = e.getState();
    const beast = playOf(s, "p1", "TST-016")[0]!;
    expect(actErr(e, "p1", { type: "QUEST", characterId: beast.instanceId })).toMatch(/cannot quest/);
    expect(actErr(e, "p1", { type: "PASS" })).toMatch(/Reckless/);
    expect(e.getLegalActions("p1").some((l) => l.action.type === "PASS")).toBe(false);
    const res = challenge(e, "p1", "TST-016", "TST-001");
    expect(res.ok).toBe(true);
    expect(playOf(res.state, "p2", "TST-001")).toHaveLength(0); // 4 damage banishes pico
    // after challenging, PASS is legal again
    pass(e, "p1");
  });

  it("Alert allows challenging ready (unexerted) characters", () => {
    const e = startGame(deckOf("TST-017"), deckOf("TST-002"), 31);
    inkPass(e, "p1"); inkPass(e, "p2"); // t1
    inkPass(e, "p1"); inkPass(e, "p2"); // t2
    inkFirst(e, "p1"); playCard(e, "p1", "TST-017"); pass(e, "p1"); // t3: Robin 3/2 Alert
    inkFirst(e, "p2"); playCard(e, "p2", "TST-002"); pass(e, "p2"); // Stitch stays READY
    // t4: Robin challenges the ready Stitch (only possible via Alert)
    const res = challenge(e, "p1", "TST-017", "TST-002");
    const s = res.state;
    expect(playOf(s, "p2", "TST-002")).toHaveLength(0); // 3 damage banishes Stitch
    expect(playOf(s, "p1", "TST-017")).toHaveLength(0); // 3 damage back banishes Robin (2 willpower)
  });
});

describe("locations", () => {
  it("locations grant lore at the ready step and can be challenged to banish", () => {
    const e = startGame(deckOf("TST-002"), deckOf("TST-010"), 33);
    inkPass(e, "p1"); inkPass(e, "p2"); // t1
    inkPass(e, "p1"); // t2
    inkFirst(e, "p2"); playCard(e, "p2", "TST-010"); pass(e, "p2"); // Mystic Cave (lore 1, will 6)
    inkFirst(e, "p1"); playCard(e, "p1", "TST-002"); pass(e, "p1"); // t3: Stitch
    inkFirst(e, "p2"); pass(e, "p2"); // t3 p2: ready step granted 1 lore
    expect(e.getState().players.p2.lore).toBe(1);
    // t4: challenge the location (no damage back)
    const res1 = challenge(e, "p1", "TST-002", "TST-010");
    const cave = playOf(res1.state, "p2", "TST-010")[0]!;
    expect(cave.damage).toBe(3);
    expect(playOf(res1.state, "p1", "TST-002")[0]!.damage).toBe(0);
    pass(e, "p1");
    inkPass(e, "p2");
    // t5: second challenge banishes it (6 damage >= 6 willpower)
    const res2 = challenge(e, "p1", "TST-002", "TST-010");
    expect(playOf(res2.state, "p2", "TST-010")).toHaveLength(0);
    expect(res2.state.players.p2.discard.map((c) => c.cardId)).toContain("TST-010");
  });

  it("move to location pays move cost and sets atLocation", () => {
    const deckA = deckOf(...Array(30).fill("TST-002"), ...Array(30).fill("TST-010"));
    const seed = findSeed(deckA, deckOf("TST-001"), (s) =>
      handOf(s, "p1", "TST-002").length > 0 && handOf(s, "p1", "TST-010").length > 0);
    const e = startGame(deckA, deckOf("TST-001"), seed);
    inkPass(e, "p1"); inkPass(e, "p2"); // t1
    inkFirst(e, "p1"); playCard(e, "p1", "TST-010"); pass(e, "p1"); // t2: cave
    inkPass(e, "p2");
    inkFirst(e, "p1"); playCard(e, "p1", "TST-002"); // t3: stitch (3 ink used, 0 left... 3 ink total)
    // not enough ink to move this turn (move cost 1, 0 ready ink)
    let s = e.getState();
    const stitch = playOf(s, "p1", "TST-002")[0]!;
    const cave = playOf(s, "p1", "TST-010")[0]!;
    actErr(e, "p1", { type: "MOVE_TO_LOCATION", characterId: stitch.instanceId, locationId: cave.instanceId });
    pass(e, "p1");
    inkPass(e, "p2");
    // t4: 4 ink, move for 1
    inkFirst(e, "p1");
    act(e, "p1", { type: "MOVE_TO_LOCATION", characterId: stitch.instanceId, locationId: cave.instanceId });
    s = e.getState();
    expect(playOf(s, "p1", "TST-002")[0]!.atLocation).toBe(cave.instanceId);
    expect(s.players.p1.inkwell.filter((c) => !c.exerted)).toHaveLength(3); // 4 ink, 1 spent
  });
});
