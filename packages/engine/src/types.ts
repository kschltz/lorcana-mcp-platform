// Core types for @lorcana/engine — exact contract per SPEC §3.1.
// Documented extensions (see README.md):
//  - CardInstance.atLocation?: string  — instanceId of the Location this character is at.
//  - GameState.pendingResolution?: PendingResolution — serializable interpreter
//    continuation used to suspend/resume effects that need a player decision.

import type { EffectNode, Selector } from "./effects/dsl.js";

export type PlayerId = "p1" | "p2";
export type InkColor = "Amber" | "Amethyst" | "Emerald" | "Ruby" | "Sapphire" | "Steel";
export type CardType = "Character" | "Action" | "Item" | "Location";
export type Zone = "deck" | "hand" | "inkwell" | "discard" | "play";
export type Keyword =
  | "Rush" | "Evasive" | "Ward" | "Bodyguard" | "Reckless" | "Support" | "Resist"
  | "Challenger" | "Singer" | "Shift" | "Alert" | "Vanish" | "Boost"; // parameterized where noted

export interface CardDefinition {
  // static card data (from card-data pkg)
  id: string; // Unique_ID, e.g. "ARI-001"
  name: string; // "Rhino"
  subtitle?: string; // "Motivational Speaker"
  fullName: string; // "Rhino - Motivational Speaker"
  type: CardType;
  colors: InkColor[]; // dual-ink supported (1–2 entries)
  cost: number;
  inkable: boolean;
  strength?: number; willpower?: number; lore?: number; moveCost?: number;
  classifications: string[];
  bodyText: string;
  rarity: string; setId: string; setNum: number; cardNum: number;
  imageUrl: string;
}

export interface CardInstance {
  instanceId: string; // unique per match: "m1-0001"
  cardId: string;
  owner: PlayerId;
  zone: Zone;
  // in-play state (meaningful only when zone==="play"):
  exerted: boolean;
  damage: number;
  enteredTurn: number; // turn number when put into play (wet ink)
  shiftedOnto?: string; // instanceId this card was shifted onto (stack)
  under?: string[]; // instanceIds stacked below (shift stack / Boost)
  modifiers: Modifier[]; // active stat/keyword modifiers
  // EXTENSION: location membership for characters (SPEC §3.3 "move to location").
  atLocation?: string;
}

export interface Modifier {
  id: string; // for removal/tracing
  source: string; // instanceId that applied it
  duration: "this-turn" | "while-in-play" | "permanent";
  stat?: { strength?: number; willpower?: number; lore?: number };
  grantKeywords?: Keyword[];
  removeKeywords?: Keyword[];
  resist?: number; // damage reduction (Resist N)
  cantQuest?: boolean; cantChallenge?: boolean; cantReady?: boolean;
  singerAs?: number; // Singer N: counts as cost N for songs
  condition?: string; // DSL expression id, optional
}

export interface PlayerState {
  id: PlayerId;
  deck: CardInstance[]; hand: CardInstance[]; inkwell: CardInstance[];
  discard: CardInstance[]; play: CardInstance[]; // play = characters+items+locations
  lore: number;
  inkPlayedThisTurn: number;
  mulliganDone: boolean;
}

export interface PendingChoice {
  // engine waits on a decision
  id: string;
  player: PlayerId; // who must choose
  kind: "choose-target" | "choose-option" | "choose-cards" | "order-cards";
  prompt: string;
  options: ChoiceOption[]; // see actions.ts contract
  min: number; max: number; // how many to pick
}
export interface ChoiceOption { id: string; label: string; cardInstanceId?: string; }

export interface GameEvent {
  // appended to log, shown in UI
  turn: number; seq: number; type: string; player?: PlayerId;
  message: string; data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Serializable effect-interpreter continuation (engine extension, §4).
// Stored inside GameState so that a game suspended on a PendingChoice survives
// serialize/deserialize (server persistence + replay).
// ---------------------------------------------------------------------------

/** Execution context for one block of effects (fully serializable). */
export interface ExecContext {
  controller: PlayerId; // player controlling the effect
  sourceId?: string; // card instance that owns the ability/effect
  bound: Record<string, string[]>; // variable -> selected instance/option ids
  bindSeq: number; // deterministic binding-name counter
}

/** One frame of interpreter work. `keys` maps per-node binding call-sites to
 * stable variable names in ctx.bound while the head effect suspends/resumes. */
export type ExecFrame =
  | { kind: "effects"; effects: EffectNode[]; ctx: ExecContext; keys?: Record<string, string> }
  | { kind: "support"; sourceId: string; controller: PlayerId };

/** How to interpret the option ids chosen via RESOLVE_CHOICE. */
export type AwaitSpec =
  | { type: "bind-target"; bindAs: string; selector: Selector }
  | { type: "choice-branch"; bindAs: string }
  | { type: "choose-cards"; bindAs: string }
  | { type: "order-cards"; bindAs: string }
  | { type: "support"; sourceId: string };

export interface PendingResolution {
  frames: ExecFrame[]; // FIFO queue of remaining work
  awaiting: AwaitSpec; // what the current PendingChoice feeds
  after?: "switch" | "draw"; // deferred turn-machine segment (see turn.ts)
}

export interface GameState {
  matchId: string;
  turn: number; // increments each time priority passes to p1
  activePlayer: PlayerId;
  phase: "setup" | "mulligan" | "main" | "game-over";
  players: Record<PlayerId, PlayerState>;
  pendingChoice?: PendingChoice;
  winner?: PlayerId;
  winReason?: "lore" | "deck-out" | "concede";
  log: GameEvent[];
  rngState: number; // serialized mulberry32 state (determinism)
  // EXTENSION: interpreter continuation for the current PendingChoice.
  pendingResolution?: PendingResolution;
}
