import { describe, expect, it } from "vitest";
import {
  GameEngine, deserializeState, serializeState, type PlayerAction, type PlayerId,
} from "../src/index.js";
import { deckOf, handOf, playOf, registry } from "./helpers.js";

interface Recorded { player: PlayerId; action: PlayerAction; }

/**
 * Drive a scripted game that exercises: partial mulligan (RNG), inking,
 * playing characters, a chosen-target action (pending choice + resume),
 * Support's pending choice, a challenge, and passing — while recording every
 * action for replay. Returns the engine, the recorded actions and the seed.
 */
function scriptedGame(): { engine: GameEngine; actions: Recorded[]; opts: { matchId: string; seed: number; deckA: string[]; deckB: string[]; registry: typeof registry } } {
  // Remy-heavy deck so inking/playing never starves (cannons are not inkable)
  const deckA = deckOf(...Array(45).fill("TST-007"), ...Array(15).fill("TST-009"));
  const deckB = deckOf(...Array(30).fill("TST-001"), ...Array(30).fill("TST-002"));
  // find a seed where the *post-mulligan* hands contain what the script needs
  let seed = -1;
  for (let cand = 1; cand <= 500; cand++) {
    const probe = new GameEngine({ matchId: "m1", seed: cand, deckA, deckB, registry });
    const sp = probe.getState();
    probe.applyAction("p1", { type: "MULLIGAN", keep: sp.players.p1.hand.slice(0, 3).map((c) => c.instanceId) });
    probe.applyAction("p2", { type: "MULLIGAN", keep: sp.players.p2.hand.map((c) => c.instanceId) });
    const s = probe.getState();
    if (handOf(s, "p1", "TST-007").length >= 4 && handOf(s, "p1", "TST-009").length > 0 &&
        handOf(s, "p2", "TST-001").length > 0 && handOf(s, "p2", "TST-002").length > 0) {
      seed = cand;
      break;
    }
  }
  if (seed < 0) throw new Error("no seed found for scripted game");
  const opts = { matchId: "m1", seed, deckA, deckB, registry };
  const engine = new GameEngine(opts);
  const actions: Recorded[] = [];
  const doAct = (player: PlayerId, action: PlayerAction) => {
    const res = engine.applyAction(player, action);
    if (!res.ok) throw new Error(`scripted action failed: ${action.type} by ${player}: ${res.error}`);
    actions.push({ player, action: structuredClone(action) });
    return res;
  };
  const inkFirst = (p: PlayerId) => {
    const s = engine.getState();
    const card = s.players[p].hand.find((c) => registry.get(c.cardId).inkable);
    if (card) doAct(p, { type: "PLAY_INK", cardInstanceId: card.instanceId });
  };
  const pass = (p: PlayerId) => doAct(p, { type: "PASS" });
  const play = (p: PlayerId, cardId: string) => {
    const c = handOf(engine.getState(), p, cardId)[0]!;
    doAct(p, { type: "PLAY_CARD", cardInstanceId: c.instanceId });
  };

  // mulligan: p1 keeps only 3 (exercises RNG shuffle-back), p2 keeps all
  const s0 = engine.getState();
  doAct("p1", { type: "MULLIGAN", keep: s0.players.p1.hand.slice(0, 3).map((c) => c.instanceId) });
  doAct("p2", { type: "MULLIGAN", keep: s0.players.p2.hand.map((c) => c.instanceId) });

  // t1
  inkFirst("p1"); pass("p1");
  inkFirst("p2"); pass("p2");
  // t2
  inkFirst("p1"); play("p1", "TST-007"); pass("p1"); // Remy (Support)
  inkFirst("p2"); play("p2", "TST-001"); pass("p2");
  // t3
  inkFirst("p1"); play("p1", "TST-007"); pass("p1"); // second Remy
  inkFirst("p2");
  const pico = playOf(engine.getState(), "p2", "TST-001")[0]!;
  doAct("p2", { type: "QUEST", characterId: pico.instanceId });
  play("p2", "TST-002"); // Stitch
  pass("p2");
  // t4: Remy #1 quests → Support choice → donate to Remy #2
  inkFirst("p1");
  const remys = playOf(engine.getState(), "p1", "TST-007");
  doAct("p1", { type: "QUEST", characterId: remys[0]!.instanceId });
  let pend = engine.getState().pendingChoice;
  if (pend) {
    doAct("p1", { type: "RESOLVE_CHOICE", choiceId: pend.id, selected: [remys[1]!.instanceId] });
  }
  // Fire the Cannons at Stitch → pending choose-target → resolve
  play("p1", "TST-009");
  pend = engine.getState().pendingChoice;
  if (!pend) throw new Error("expected pending choice from Fire the Cannons");
  const stitch = playOf(engine.getState(), "p2", "TST-002")[0]!;
  doAct("p1", { type: "RESOLVE_CHOICE", choiceId: pend.id, selected: [stitch.instanceId] });
  // Remy #2 (now 2+2 strength) challenges the exerted pico
  const picoNow = playOf(engine.getState(), "p2", "TST-001")[0]!;
  doAct("p1", { type: "CHALLENGE", attackerId: remys[1]!.instanceId, defenderId: picoNow.instanceId });
  pass("p1");

  return { engine, actions, opts };
}

describe("determinism & serialization (SPEC §3.4)", () => {
  it("same seed + same actions → identical serialized state (static replay)", () => {
    const { engine, actions, opts } = scriptedGame();
    const replayed = GameEngine.replay(actions, opts);
    expect(serializeState(replayed)).toBe(serializeState(engine.getState()));
  });

  it("two engines with the same seed and action stream stay identical", () => {
    const { engine, actions, opts } = scriptedGame();
    const other = new GameEngine(opts);
    for (const { player, action } of actions) {
      const res = other.applyAction(player, action);
      expect(res.ok).toBe(true);
    }
    expect(serializeState(other.getState())).toBe(serializeState(engine.getState()));
  });

  it("serialize/deserialize round-trips losslessly, incl. a pending choice continuation", () => {
    const { engine, actions, opts } = scriptedGame();
    // full round trip of the final state
    const s = engine.getState();
    expect(deserializeState(serializeState(s))).toEqual(s);

    // resume mid-choice: replay to just after the cannons PLAY_CARD (which
    // leaves a PendingChoice), serialize, restore, and finish the game.
    const cannonsIdx = actions.findIndex((a, i) =>
      a.action.type === "RESOLVE_CHOICE" && i > 0 && actions[i - 1]!.action.type === "PLAY_CARD");
    const splitAt = cannonsIdx; // actions[0..splitAt) ends with pending choice active
    const before = actions.slice(0, splitAt);
    const after = actions.slice(splitAt);
    const mid = GameEngine.replay(before, opts);
    expect(mid.pendingChoice).toBeDefined();
    expect(mid.pendingResolution).toBeDefined();
    const restored = GameEngine.fromSerialized(serializeState(mid), opts.registry);
    expect(serializeState(restored.getState())).toBe(serializeState(mid));
    for (const { player, action } of after) {
      const res = restored.applyAction(player, action);
      expect(res.ok).toBe(true);
    }
    expect(serializeState(restored.getState())).toBe(serializeState(engine.getState()));
  });

  it("getState returns a deep copy (mutating it cannot corrupt the engine)", () => {
    const { engine } = scriptedGame();
    const s = engine.getState();
    s.players.p1.lore = 999;
    s.players.p1.hand.length = 0;
    s.log.length = 0;
    const again = engine.getState();
    expect(again.players.p1.lore).not.toBe(999);
    expect(again.log.length).toBeGreaterThan(0);
  });
});
