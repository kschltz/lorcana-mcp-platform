// @lorcana/engine — public API (SPEC §3.2). Deterministic, pure library:
// no I/O, no Date.now()/Math.random() outside the injected seeded RNG.

import type { GameEvent, GameState, PlayerId } from "./types.js";
import type { CardRegistry } from "./cards/registry.js";
import { Rng } from "./rng.js";
import { syncRng, type Rt } from "./state.js";
import { createInitialRt } from "./setup.js";
import { executeAction, type LegalAction, type PlayerAction } from "./actions.js";
import { getLegalActions, validateAction } from "./legality.js";
import { installTurnHook } from "./turn.js";
import { deserializeState } from "./serialize.js";

export interface CreateGameOptions {
  matchId: string; seed: number;
  deckA: string[]; deckB: string[]; // 60 cardIds each
  registry: CardRegistry;
}
export interface ActionResult {
  ok: boolean; error?: string;
  state: GameState; // post-action state (or unchanged on error)
  newEvents: GameEvent[]; // events produced by this call
}

export class GameEngine {
  private rt: Rt;

  constructor(opts: CreateGameOptions) {
    // validate deck card ids up-front (engine assumes legal decks otherwise)
    for (const id of [...opts.deckA, ...opts.deckB]) opts.registry.get(id);
    this.rt = createInitialRt(opts, opts.registry);
    installTurnHook(this.rt);
  }

  /** Deep copy, safe to serialize. */
  getState(): GameState {
    return structuredClone(this.rt.state);
  }

  getLegalActions(player: PlayerId): LegalAction[] {
    return getLegalActions(this.rt, player);
  }

  applyAction(player: PlayerId, action: PlayerAction): ActionResult {
    const logStart = this.rt.state.log.length;
    const err = validateAction(this.rt, player, action);
    if (err) {
      return { ok: false, error: err, state: this.getState(), newEvents: [] };
    }
    const execErr = executeAction(this.rt, player, action);
    syncRng(this.rt);
    if (execErr) {
      return { ok: false, error: execErr, state: this.getState(), newEvents: [] };
    }
    return {
      ok: true,
      state: this.getState(),
      newEvents: structuredClone(this.rt.state.log.slice(logStart)),
    };
  }

  /** Static replay for tests (SPEC §3.2): applies the action list from scratch
   * and returns the final state. Throws on the first illegal action. */
  static replay(
    actions: { player: PlayerId; action: PlayerAction }[],
    opts: CreateGameOptions,
  ): GameState {
    const engine = new GameEngine(opts);
    for (const { player, action } of actions) {
      const res = engine.applyAction(player, action);
      if (!res.ok) {
        throw new Error(`replay failed for ${player} ${action.type}: ${res.error ?? "unknown error"}`);
      }
    }
    return engine.getState();
  }

  /** EXTENSION: rebuild an engine around a serialized state (server resume).
   * The RNG is re-seeded from state.rngState and the effect continuation is
   * read back from state.pendingResolution. */
  static fromSerialized(json: string, registry: CardRegistry): GameEngine {
    const state = deserializeState(json);
    const engine = Object.create(GameEngine.prototype) as GameEngine;
    const rng = new Rng(state.rngState);
    const rt: Rt = { state, registry, rng, queue: [] };
    engine.rt = rt;
    installTurnHook(rt);
    return engine;
  }
}

// ---------------------------------------------------------------------------
// Re-exports — the full public contract.
// ---------------------------------------------------------------------------

export * from "./types.js";
export * from "./effects/dsl.js";
export * from "./actions.js";
export { CardRegistry, createTestRegistry, FIXTURE_CARDS, FIXTURE_SCRIPTS } from "./cards/registry.js";
export { serializeState, deserializeState } from "./serialize.js";
export { Rng } from "./rng.js";
