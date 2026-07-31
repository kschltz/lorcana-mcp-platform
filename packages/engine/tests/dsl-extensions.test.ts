import { describe, expect, it } from "vitest";
import {
  CardRegistry, FIXTURE_CARDS, FIXTURE_SCRIPTS, GameEngine, type CardScript, type PlayerId,
} from "../src/index.js";
import { act, deckOf, handOf, inkFirst, pass, playCard, playOf } from "./helpers.js";

/** Registry with fixture defs but caller-supplied script overrides. */
function customRegistry(overrides: Record<string, CardScript>): CardRegistry {
  return new CardRegistry(FIXTURE_CARDS, { ...FIXTURE_SCRIPTS, ...overrides });
}

function startCustom(
  reg: CardRegistry, deckA: string[], deckB: string[], seed = 1,
): GameEngine {
  const e = new GameEngine({ matchId: "mx", seed, deckA, deckB, registry: reg });
  const s = e.getState();
  act(e, "p1", { type: "MULLIGAN", keep: s.players.p1.hand.map((c) => c.instanceId) });
  act(e, "p2", { type: "MULLIGAN", keep: s.players.p2.hand.map((c) => c.instanceId) });
  return e;
}

function inkPass(e: GameEngine, p: PlayerId): void {
  inkFirst(e, p);
  pass(e, p);
}

describe("DSL extensions from card-data integration", () => {
  it("Selector.self targets the source card itself", () => {
    const reg = customRegistry({
      "TST-001": {
        cardId: "TST-001",
        triggered: [{
          trigger: "ON_PLAY",
          effects: [{
            type: "ADD_MODIFIER",
            target: { zone: "play", who: "self", self: true },
            modifier: { stat: { lore: 2 } },
            duration: "permanent",
          }],
        }],
      },
    });
    const e = startCustom(reg, deckOf("TST-001"), deckOf("TST-002"), 71);
    inkFirst(e, "p1");
    playCard(e, "p1", "TST-001");
    const pico = playOf(e.getState(), "p1", "TST-001")[0]!;
    expect(pico.modifiers.some((m) => m.stat?.lore === 2 && m.source === pico.instanceId)).toBe(true);
    pass(e, "p1");
    inkPass(e, "p2");
    // quests for 1 + 2 = 3 lore
    act(e, "p1", { type: "QUEST", characterId: pico.instanceId });
    expect(e.getState().players.p1.lore).toBe(3);
  });

  it("DRAW.who: 'opponent' draws for the opponent, 'each' draws for both", () => {
    const reg = customRegistry({
      "TST-009": {
        cardId: "TST-009",
        triggered: [{ trigger: "ON_PLAY", effects: [{ type: "DRAW", amount: 2, who: "opponent" }] }],
      },
      "TST-008": {
        cardId: "TST-008",
        triggered: [{ trigger: "ON_PLAY", effects: [{ type: "DRAW", amount: 1, who: "each" }] }],
      },
    });
    const e = startCustom(reg, deckOf("TST-009", "TST-008", "TST-001"), deckOf("TST-001"), 73);
    inkPass(e, "p1"); inkPass(e, "p2"); // t1
    inkPass(e, "p1"); inkPass(e, "p2"); // t2
    // t3 p1: play cannons → OPPONENT draws 2
    inkFirst(e, "p1", "TST-001");
    const p2Before = e.getState().players.p2.hand.length;
    const p1Before = e.getState().players.p1.hand.length;
    playCard(e, "p1", "TST-009");
    let s = e.getState();
    expect(s.players.p2.hand.length).toBe(p2Before + 2);
    expect(s.players.p1.hand.length).toBe(p1Before - 1); // only the action card left hand
    // t4 p1: play song (paid) → EACH draws 1
    pass(e, "p1");
    inkPass(e, "p2");
    inkFirst(e, "p1", "TST-001");
    s = e.getState(); // includes p1's t4 draw
    const p1b = s.players.p1.hand.length;
    const p2b = s.players.p2.hand.length;
    playCard(e, "p1", "TST-008");
    s = e.getState();
    expect(s.players.p1.hand.length).toBe(p1b); // -1 song, +1 draw
    expect(s.players.p2.hand.length).toBe(p2b + 1);
  });

  it("PUT_INTO_INKWELL source:'self' puts the card into its owner's inkwell", () => {
    const reg = customRegistry({
      "TST-011": {
        cardId: "TST-011",
        activated: [{
          name: "Ink Self", cost: { exert: true },
          effects: [{ type: "PUT_INTO_INKWELL", source: "self" }],
        }],
      },
    });
    const e = startCustom(reg, deckOf("TST-011"), deckOf("TST-001"), 77);
    inkPass(e, "p1"); inkPass(e, "p2"); // t1
    inkFirst(e, "p1"); playCard(e, "p1", "TST-011"); // t2: Magic Mirror
    const mirror = playOf(e.getState(), "p1", "TST-011")[0]!;
    act(e, "p1", { type: "ACTIVATE_ABILITY", cardInstanceId: mirror.instanceId, abilityIndex: 0 });
    const s = e.getState();
    expect(playOf(s, "p1", "TST-011")).toHaveLength(0);
    expect(s.players.p1.inkwell.map((c) => c.cardId)).toContain("TST-011");
    expect(s.players.p1.inkwell).toHaveLength(3); // 2 inked + the mirror
  });

  it("zero-node abilities (named noops) resolve gracefully", () => {
    const reg = customRegistry({
      "TST-001": {
        cardId: "TST-001",
        triggered: [{ name: "unmodeled-cost-reduction", trigger: "ON_PLAY", effects: [] }],
        activated: [{ name: "unmodeled-noop", cost: { exert: true }, effects: [] }],
      },
    });
    const e = startCustom(reg, deckOf("TST-001"), deckOf("TST-001"), 79);
    inkFirst(e, "p1");
    playCard(e, "p1", "TST-001"); // ON_PLAY noop fires without error
    const pico = playOf(e.getState(), "p1", "TST-001")[0]!;
    expect(pico).toBeDefined();
    pass(e, "p1");
    inkPass(e, "p2");
    // activated noop: exerts, resolves nothing, no crash
    act(e, "p1", { type: "ACTIVATE_ABILITY", cardInstanceId: pico.instanceId, abilityIndex: 0 });
    expect(playOf(e.getState(), "p1", "TST-001")[0]!.exerted).toBe(true);
  });

  it("vanilla keyword-only scripts play as plain stat cards", () => {
    // ~864 real scripts are keyword-only; the fixture's plain questers model that tier
    const e = startCustom(customRegistry({}), deckOf("TST-001"), deckOf("TST-001"), 83);
    inkFirst(e, "p1");
    playCard(e, "p1", "TST-001");
    pass(e, "p1");
    inkPass(e, "p2");
    const pico = playOf(e.getState(), "p1", "TST-001")[0]!;
    act(e, "p1", { type: "QUEST", characterId: pico.instanceId });
    expect(e.getState().players.p1.lore).toBe(1);
  });
});
