// Lossless JSON serialization of GameState (SPEC §3.4). GameState is pure
// JSON data (including rngState and the effect continuation), so a plain
// JSON round-trip is sufficient and used by server persistence + replay.

import type { GameState } from "./types.js";

export function serializeState(state: GameState): string {
  return JSON.stringify(state);
}

export function deserializeState(json: string): GameState {
  return JSON.parse(json) as GameState;
}
