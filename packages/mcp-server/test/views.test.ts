import { describe, expect, it } from "vitest";
import { playerView, spectatorView, type CardBack, type EnrichedCardInstance, type ZoneCount } from "../src/views.js";
import { fixtureStore, tmpDir } from "./helpers.js";
import { MatchRegistry } from "../src/matches.js";
import { StubEngine } from "../src/testing/stubEngine.js";
import { expandDeck } from "../src/tools/decks.js";

function liveMatch() {
  const store = fixtureStore();
  const registry = store.toRegistry();
  const deck = expandDeck(
    Array.from({ length: 15 }, (_, i) => ({ cardId: `TST-${String(i + 1).padStart(3, "0")}`, count: 4 })),
  );
  const matches = new MatchRegistry({
    dataDir: tmpDir(),
    engineFactory: StubEngine.factory(),
    registry,
  });
  const { matchId, tokenP1, tokenP2 } = matches.create(deck, deck, 7);
  return { store, registry, matches, matchId, tokenP1, tokenP2 };
}

describe("playerView (fog of war)", () => {
  it("shows the viewer's own hand with full card definitions", () => {
    const { registry, matches, matchId, tokenP1 } = liveMatch();
    const { player, state } = matches.getState(matchId, tokenP1);
    const view = playerView(state, player, registry);

    expect(view.you).toBe("p1");
    const ownHand = view.players.p1.hand as EnrichedCardInstance[];
    expect(Array.isArray(ownHand)).toBe(true);
    expect(ownHand).toHaveLength(7);
    for (const inst of ownHand) {
      expect(inst.card).toBeDefined();
      expect(inst.card!.id).toBe(inst.cardId);
      expect(inst.card!.imageUrl).toContain("https://");
    }
  });

  it("hides opponent hand/deck/inkwell identities (counts only)", () => {
    const { registry, matches, matchId, tokenP1, tokenP2 } = liveMatch();
    // Give p2 an ink so the inkwell count is non-trivial.
    matches.playAction(matchId, tokenP1, { type: "MULLIGAN", keep: matches.getState(matchId, tokenP1).state.players.p1.hand.map((c) => c.instanceId) });
    matches.playAction(matchId, tokenP2, { type: "MULLIGAN", keep: matches.getState(matchId, tokenP2).state.players.p2.hand.map((c) => c.instanceId) });
    const p2ink = matches.getState(matchId, tokenP2).state.players.p2.hand[0];
    // p1 passes; p2 inks.
    matches.playAction(matchId, tokenP1, { type: "PASS" });
    matches.playAction(matchId, tokenP2, { type: "PLAY_INK", cardInstanceId: p2ink.instanceId });

    const { player, state } = matches.getState(matchId, tokenP1);
    const view = playerView(state, player, registry);
    const opp = view.players.p2;

    const hand = opp.hand as ZoneCount;
    // p2 kept 7, drew 1 on their turn, inked 1 → 7 in hand.
    expect(hand).toEqual({ count: 7 });
    expect(JSON.stringify(hand)).not.toContain("cardId");
    expect(opp.deck).toEqual({ count: 52 }); // 60 - 7 opening - 1 turn draw
    expect(opp.inkwell).toEqual({ count: 1 });

    // No opponent card identities anywhere in the opponent's hidden zones.
    const oppJson = JSON.stringify({ hand: opp.hand, deck: opp.deck, inkwell: opp.inkwell });
    expect(oppJson).not.toMatch(/TST-\d{3}/);

    // Public zones stay visible.
    expect(Array.isArray(opp.discard)).toBe(true);
    expect(Array.isArray(opp.play)).toBe(true);
    expect(opp.inkTotal).toBe(1);
  });
});

describe("spectatorView", () => {
  it("shows both hands as face-down backs with instanceIds, everything else resolved", () => {
    const { registry, matches, matchId, tokenP1, tokenP2 } = liveMatch();
    matches.playAction(matchId, tokenP1, { type: "MULLIGAN", keep: [] });
    matches.playAction(matchId, tokenP2, { type: "MULLIGAN", keep: [] });

    const view = spectatorView(matches.spectatorState(matchId), registry);
    for (const pid of ["p1", "p2"] as const) {
      const p = view.players[pid];
      const hand = p.hand as CardBack[];
      expect(hand).toHaveLength(7);
      for (const back of hand) {
        expect(back.facedown).toBe(true);
        expect(back.instanceId).toMatch(/^match-/);
        expect((back as Record<string, unknown>).cardId).toBeUndefined();
        expect((back as Record<string, unknown>).card).toBeUndefined();
      }
      expect(p.deck).toEqual({ count: 53 });
      expect(Array.isArray(p.play)).toBe(true);
      expect(Array.isArray(p.discard)).toBe(true);
    }
  });

  it("resolves card definitions incl. imageUrl on in-play instances", () => {
    const { registry, matches, matchId, tokenP1, tokenP2 } = liveMatch();
    const keep = (t: string) => {
      const { player, state } = matches.getState(matchId, t);
      return state.players[player].hand.map((c) => c.instanceId);
    };
    matches.playAction(matchId, tokenP1, { type: "MULLIGAN", keep: keep(tokenP1) });
    matches.playAction(matchId, tokenP2, { type: "MULLIGAN", keep: keep(tokenP2) });

    // p1: over up to 4 own turns, ink an inkable each turn and play the first
    // affordable card found (hand contents are seed-dependent).
    let playedCard = false;
    for (let t = 0; t < 4 && !playedCard; t++) {
      const hand = matches.getState(matchId, tokenP1).state.players.p1.hand;
      const inkCard = hand.find((c) => registry.get(c.cardId)?.inkable);
      if (inkCard) {
        matches.playAction(matchId, tokenP1, { type: "PLAY_INK", cardInstanceId: inkCard.instanceId });
      }
      const afterInk = matches.getState(matchId, tokenP1).state.players.p1;
      const affordable = afterInk.hand.find(
        (c) => (registry.get(c.cardId)?.cost ?? 99) <= afterInk.inkwell.length,
      );
      if (affordable) {
        const r = matches.playAction(matchId, tokenP1, { type: "PLAY_CARD", cardInstanceId: affordable.instanceId });
        expect(r.result.ok).toBe(true);
        playedCard = true;
      }
      matches.playAction(matchId, tokenP1, { type: "PASS" });
      if (!playedCard) matches.playAction(matchId, tokenP2, { type: "PASS" });
    }
    expect(playedCard).toBe(true);

    const view = spectatorView(matches.spectatorState(matchId), registry);
    const inPlay = view.players.p1.play as EnrichedCardInstance[];
    expect(inPlay).toHaveLength(1);
    expect(inPlay[0].card).toBeDefined();
    expect(inPlay[0].card!.imageUrl).toBe(`https://img.example.com/${inPlay[0].cardId}.png`);
    // Inkwell remains face-down even for spectators.
    const inkwell = view.players.p1.inkwell as CardBack[];
    expect(inkwell[0].facedown).toBe(true);
    expect((inkwell[0] as Record<string, unknown>).cardId).toBeUndefined();
  });
});
