import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MatchRegistry, CodedError } from "../src/matches.js";
import { StubEngine } from "../src/testing/stubEngine.js";
import { expandDeck } from "../src/tools/decks.js";
import type { PlayerId } from "../src/contracts.js";
import { fixtureStore, goodDeckText, tmpDir } from "./helpers.js";

function setup() {
  const store = fixtureStore();
  const dataDir = tmpDir();
  const decks = expandDeck(
    Array.from({ length: 15 }, (_, i) => ({
      cardId: `TST-${String(i + 1).padStart(3, "0")}`,
      count: 4,
    })),
  );
  const matches = new MatchRegistry({
    dataDir,
    engineFactory: StubEngine.factory(),
    registry: store.toRegistry(),
  });
  const created = matches.create(decks, decks, 42);
  return { store, dataDir, matches, ...created };
}

/** Mulligan with both players so the match reaches the main phase. */
function finishMulligans(matches: MatchRegistry, matchId: string, tokenP1: string, tokenP2: string) {
  const handOf = (token: string) => {
    const { state, player } = matches.getState(matchId, token);
    return state.players[player].hand.map((c) => c.instanceId);
  };
  expect(matches.playAction(matchId, tokenP1, { type: "MULLIGAN", keep: handOf(tokenP1) }).result.ok).toBe(true);
  expect(matches.playAction(matchId, tokenP2, { type: "MULLIGAN", keep: handOf(tokenP2) }).result.ok).toBe(true);
}

describe("MatchRegistry", () => {
  it("creates matches with 16-hex seat tokens and persists the record", () => {
    const { matches, matchId, tokenP1, tokenP2, dataDir } = setup();
    expect(tokenP1).toMatch(/^[0-9a-f]{16}$/);
    expect(tokenP2).toMatch(/^[0-9a-f]{16}$/);
    expect(tokenP1).not.toBe(tokenP2);
    const file = join(dataDir, `${matchId}.json`);
    expect(existsSync(file)).toBe(true);
    const record = JSON.parse(readFileSync(file, "utf8"));
    expect(record.actions).toEqual([]);
    expect(record.seed).toBe(42);
    expect(matches.has(matchId)).toBe(true);
  });

  it("gates state and actions by seat token (wrong token → FORBIDDEN)", () => {
    const { matches, matchId, tokenP1 } = setup();
    expect(() => matches.getState(matchId, "deadbeefdeadbeef")).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN" }) as CodedError,
    );
    expect(() => matches.playAction(matchId, "0000000000000000", { type: "PASS" })).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN" }) as CodedError,
    );
    expect(() => matches.concede(matchId, "ffffffffffffffff")).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN" }) as CodedError,
    );
    // A valid p1 token resolves to seat p1 only.
    expect(matches.getState(matchId, tokenP1).player).toBe("p1");
  });

  it("returns NOT_FOUND for unknown matches", () => {
    const { matches } = setup();
    expect(() => matches.getState("match-nope", "x")).toThrowError(
      expect.objectContaining({ code: "NOT_FOUND" }) as CodedError,
    );
  });

  it("records successful actions and rejects illegal ones without recording", () => {
    const { matches, matchId, tokenP1, tokenP2 } = setup();
    finishMulligans(matches, matchId, tokenP1, tokenP2);
    const before = matches.spectatorState(matchId);
    expect(before.phase).toBe("main");
    expect(before.activePlayer).toBe("p1");

    // p2 cannot act on p1's turn (engine-level error, not recorded).
    const bad = matches.playAction(matchId, tokenP2, { type: "PASS" });
    expect(bad.result.ok).toBe(false);
    const persisted = JSON.parse(readFileSync(setupDataDir(matches, matchId), "utf8"));
    expect(persisted.actions).toHaveLength(2); // only the two mulligans

    const ok = matches.playAction(matchId, tokenP1, { type: "PASS" });
    expect(ok.result.ok).toBe(true);
    expect(ok.result.newEvents.length).toBeGreaterThan(0);
    expect(matches.spectatorState(matchId).activePlayer).toBe("p2");
  });

  it("concede ends the match with winReason=concede and blocks further actions", () => {
    const { matches, matchId, tokenP1, tokenP2 } = setup();
    const { player } = matches.concede(matchId, tokenP1);
    expect(player).toBe("p1");
    const state = matches.spectatorState(matchId);
    expect(state.phase).toBe("game-over");
    expect(state.winner).toBe("p2");
    expect(state.winReason).toBe("concede");
    expect(matches.getLegalActions(matchId, tokenP2).legalActions).toEqual([]);
    expect(() => matches.playAction(matchId, tokenP2, { type: "PASS" })).toThrowError(
      expect.objectContaining({ code: "GAME_OVER" }) as CodedError,
    );
    expect(matches.list()[0].winner).toBe("p2");
  });

  it("survives a kill+reload: replay restores the exact state and tokens", () => {
    const { matches, matchId, tokenP1, tokenP2, dataDir, store } = setup();
    finishMulligans(matches, matchId, tokenP1, tokenP2);
    // Play a few more actions: p1 inks + plays a card, then passes.
    const p1State = () => matches.getState(matchId, tokenP1).state;
    const inkable = p1State().players.p1.hand.find(
      (c) => store.get(c.cardId)?.inkable,
    );
    expect(inkable).toBeDefined();
    expect(
      matches.playAction(matchId, tokenP1, { type: "PLAY_INK", cardInstanceId: inkable!.instanceId }).result.ok,
    ).toBe(true);
    expect(matches.playAction(matchId, tokenP1, { type: "PASS" }).result.ok).toBe(true);
    expect(matches.playAction(matchId, tokenP2, { type: "PASS" }).result.ok).toBe(true);

    const stateBefore = matches.spectatorState(matchId);
    const filesBefore = readdirSync(dataDir);
    expect(filesBefore).toContain(`${matchId}.json`);

    // Simulate process restart: brand-new registry over the same data dir.
    const revived = new MatchRegistry({
      dataDir,
      engineFactory: StubEngine.factory(),
      registry: store.toRegistry(),
    });
    revived.load();
    expect(revived.has(matchId)).toBe(true);
    const stateAfter = revived.spectatorState(matchId);
    expect(JSON.parse(JSON.stringify(stateAfter))).toEqual(JSON.parse(JSON.stringify(stateBefore)));
    // Tokens still gate the revived match.
    expect(revived.getState(matchId, tokenP2).player).toBe("p2");
    expect(() => revived.getState(matchId, "0000000000000000")).toThrowError(CodedError);
  });

  it("lists matches with scores", () => {
    const { matches, matchId } = setup();
    const list = matches.list();
    expect(list).toHaveLength(1);
    expect(list[0].matchId).toBe(matchId);
    expect(list[0].scores).toEqual({ p1: 0, p2: 0 });
    expect(list[0].phase).toBe("mulligan");
  });
});

/** Helper: path of the persisted record for assertions above. */
function setupDataDir(matches: MatchRegistry, matchId: string): string {
  return join(matches.dataDir, `${matchId}.json`);
}

// Type-only reference to keep PlayerId import used (docs for future seat tests).
export type { PlayerId };
