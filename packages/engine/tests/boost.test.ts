import { describe, expect, it } from "vitest";
import {
  CardRegistry, FIXTURE_CARDS, FIXTURE_SCRIPTS, GameEngine, type CardScript, type PlayerId,
} from "../src/index.js";
import { act, deckOf, inkFirst, pass, playCard, playOf } from "./helpers.js";

function customRegistry(overrides: Record<string, CardScript>): CardRegistry {
  return new CardRegistry(FIXTURE_CARDS, { ...FIXTURE_SCRIPTS, ...overrides });
}

function startCustom(
  reg: CardRegistry, deckA: string[], deckB: string[], seed = 1,
): GameEngine {
  const e = new GameEngine({ matchId: "boost", seed, deckA, deckB, registry: reg });
  const s = e.getState();
  act(e, "p1", { type: "MULLIGAN", keep: s.players.p1.hand.map((c) => c.instanceId) });
  act(e, "p2", { type: "MULLIGAN", keep: s.players.p2.hand.map((c) => c.instanceId) });
  return e;
}

function inkPass(e: GameEngine, p: PlayerId): void {
  inkFirst(e, p);
  pass(e, p);
}

describe("Boost keyword (activated put-under)", () => {
  it("does not put cards under on play; activates for ink once per turn", () => {
    const reg = customRegistry({
      "TST-001": {
        cardId: "TST-001",
        keywords: [{ name: "Boost", value: 2 }],
        activated: [{
          name: "Boost",
          cost: { ink: 2 },
          oncePerTurn: true,
          effects: [{
            type: "PUT_UNDER",
            source: "top-deck",
            amount: 1,
            target: { zone: "play", who: "self", self: true },
          }],
        }],
      },
    });
    // Need ink to play (cost 1) and later activate (cost 2) — build ink over turns.
    const e = startCustom(reg, deckOf("TST-001"), deckOf("TST-002"), 11);
    inkPass(e, "p1");
    inkPass(e, "p2");
    inkPass(e, "p1");
    inkPass(e, "p2");
    inkFirst(e, "p1"); // 3rd ink
    playCard(e, "p1", "TST-001");
    let host = playOf(e.getState(), "p1", "TST-001")[0]!;
    expect(host.under ?? []).toHaveLength(0);

    // Activate Boost for 2 ink
    const beforeDeck = e.getState().players.p1.deck.length;
    act(e, "p1", {
      type: "ACTIVATE_ABILITY",
      cardInstanceId: host.instanceId,
      abilityIndex: 0,
    });
    host = playOf(e.getState(), "p1", "TST-001")[0]!;
    expect(host.under ?? []).toHaveLength(1);
    expect(e.getState().players.p1.deck.length).toBe(beforeDeck - 1);

    // oncePerTurn — second activate this turn is illegal
    const illegal = e.applyAction("p1", {
      type: "ACTIVATE_ABILITY",
      cardInstanceId: host.instanceId,
      abilityIndex: 0,
    });
    expect(illegal.ok).toBe(false);
  });

  it("fires ON_PUT_UNDER on the host and ON_PUT_UNDER_FRIENDLY on allies", () => {
    const reg = customRegistry({
      "TST-001": {
        cardId: "TST-001",
        keywords: [{ name: "Boost", value: 1 }],
        activated: [{
          name: "Boost",
          cost: { ink: 1 },
          oncePerTurn: true,
          effects: [{
            type: "PUT_UNDER",
            source: "top-deck",
            amount: 1,
            target: { zone: "play", who: "self", self: true },
          }],
        }],
        triggered: [{
          trigger: "ON_PUT_UNDER",
          effects: [{ type: "GAIN_LORE", amount: 1 }],
        }],
      },
      "TST-007": {
        // cost 2 Ally — cheaper than TST-002 so we can field both with modest ink
        cardId: "TST-007",
        triggered: [{
          trigger: "ON_PUT_UNDER_FRIENDLY",
          effects: [{ type: "DRAW", amount: 1 }],
        }],
      },
    });
    const e = startCustom(reg, deckOf("TST-001", "TST-007"), deckOf("TST-003"), 22);
    // Build 3 ink, play both characters, then activate Boost.
    inkPass(e, "p1"); inkPass(e, "p2");
    inkPass(e, "p1"); inkPass(e, "p2");
    inkFirst(e, "p1"); // 3 ready ink
    playCard(e, "p1", "TST-001"); // −1
    playCard(e, "p1", "TST-007"); // −2
    const host = playOf(e.getState(), "p1", "TST-001")[0]!;
    pass(e, "p1");
    inkPass(e, "p2");
    // next turn: ink readies; activate Boost for 1
    const handBefore = e.getState().players.p1.hand.length;
    const loreBefore = e.getState().players.p1.lore;
    act(e, "p1", {
      type: "ACTIVATE_ABILITY",
      cardInstanceId: host.instanceId,
      abilityIndex: 0,
    });
    const s = e.getState();
    expect(s.players.p1.lore).toBe(loreBefore + 1);
    expect(s.players.p1.hand.length).toBe(handBefore + 1);
  });

  it("applies COST_REDUCTION to the next character play", () => {
    const reg = customRegistry({
      "TST-008": {
        cardId: "TST-008",
        triggered: [{
          trigger: "ON_PLAY",
          effects: [{ type: "COST_REDUCTION", amount: 2, filter: { type: "Character" }, uses: 1 }],
        }],
      },
    });
    // TST-008 is a song/action cost 3 in fixtures — check registry
    const e = startCustom(reg, deckOf("TST-008", "TST-001"), deckOf("TST-002"), 33);
    inkPass(e, "p1"); inkPass(e, "p2");
    inkPass(e, "p1"); inkPass(e, "p2");
    inkFirst(e, "p1");
    // play the action that grants -2 for next character
    playCard(e, "p1", "TST-008");
    expect(e.getState().players.p1.inkDiscounts?.[0]?.amount).toBe(2);
    // character costs 1; with -2 discount it should be free (need 0 ink)
    const inkBefore = e.getState().players.p1.inkwell.filter((c) => !c.exerted).length;
    playCard(e, "p1", "TST-001");
    const inkAfter = e.getState().players.p1.inkwell.filter((c) => !c.exerted).length;
    expect(inkAfter).toBe(inkBefore); // paid 0
    expect(playOf(e.getState(), "p1", "TST-001")).toHaveLength(1);
  });
});
