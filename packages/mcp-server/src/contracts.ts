/**
 * contracts.ts — local re-declaration of the exact SPEC type shapes this package
 * consumes from `@lorcana/engine` (SPEC §3.1, §3.2) and `@lorcana/card-data` (§4).
 *
 * INTEGRATION NOTE: this file exists only because the engine package is being
 * built in parallel and is not merged yet. At integration time, delete this file
 * and replace every `from "../contracts.js"` / `from "./contracts.js"` import with
 * the equivalent import from `@lorcana/engine` (types + GameEngine + CardRegistry)
 * and `@lorcana/card-data` (CardScript). The shapes below are verbatim copies of
 * the SPEC contract — no divergent logic lives here.
 *
 * `EngineLike` / `EngineFactory` are the *only* additions: they are the minimal
 * structural interface of SPEC §3.2 `GameEngine` used so the server can be wired
 * to either the real `GameEngine` class or a test stub.
 */

// ---------------------------------------------------------------- SPEC §3.1 ---

export type PlayerId = "p1" | "p2";
export type InkColor =
  | "Amber"
  | "Amethyst"
  | "Emerald"
  | "Ruby"
  | "Sapphire"
  | "Steel";
export type CardType = "Character" | "Action" | "Item" | "Location";
export type Zone = "deck" | "hand" | "inkwell" | "discard" | "play";
export type Keyword =
  | "Rush"
  | "Evasive"
  | "Ward"
  | "Bodyguard"
  | "Reckless"
  | "Support"
  | "Resist"
  | "Challenger"
  | "Singer"
  | "Shift"
  | "Alert"
  | "Vanish"
  | "Boost";

export interface CardDefinition {
  id: string;
  name: string;
  subtitle?: string;
  fullName: string;
  type: CardType;
  colors: InkColor[];
  cost: number;
  inkable: boolean;
  strength?: number;
  willpower?: number;
  lore?: number;
  moveCost?: number;
  classifications: string[];
  bodyText: string;
  rarity: string;
  setId: string;
  setNum: number;
  cardNum: number;
  imageUrl: string;
}

export interface CardInstance {
  instanceId: string;
  cardId: string;
  owner: PlayerId;
  zone: Zone;
  exerted: boolean;
  damage: number;
  enteredTurn: number;
  shiftedOnto?: string;
  under?: string[];
  modifiers: Modifier[];
}

export interface Modifier {
  id: string;
  source: string;
  duration: "this-turn" | "while-in-play" | "permanent";
  stat?: { strength?: number; willpower?: number; lore?: number };
  grantKeywords?: Keyword[];
  removeKeywords?: Keyword[];
  resist?: number;
  cantQuest?: boolean;
  cantChallenge?: boolean;
  cantReady?: boolean;
  singerAs?: number;
  condition?: string;
}

export interface PlayerState {
  id: PlayerId;
  deck: CardInstance[];
  hand: CardInstance[];
  inkwell: CardInstance[];
  discard: CardInstance[];
  play: CardInstance[];
  lore: number;
  inkPlayedThisTurn: number;
  mulliganDone: boolean;
}

export interface PendingChoice {
  id: string;
  player: PlayerId;
  kind: "choose-target" | "choose-option" | "choose-cards" | "order-cards";
  prompt: string;
  options: ChoiceOption[];
  min: number;
  max: number;
}
export interface ChoiceOption {
  id: string;
  label: string;
  cardInstanceId?: string;
}

export interface GameEvent {
  turn: number;
  seq: number;
  type: string;
  player?: PlayerId;
  message: string;
  data?: Record<string, unknown>;
}

export interface GameState {
  matchId: string;
  turn: number;
  activePlayer: PlayerId;
  phase: "setup" | "mulligan" | "main" | "game-over";
  players: Record<PlayerId, PlayerState>;
  pendingChoice?: PendingChoice;
  winner?: PlayerId;
  winReason?: "lore" | "deck-out" | "concede";
  log: GameEvent[];
  rngState: number;
}

// ---------------------------------------------------------------- SPEC §3.2 ---

export interface CreateGameOptions {
  matchId: string;
  seed: number;
  deckA: string[];
  deckB: string[];
  registry: CardRegistry;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  state: GameState;
  newEvents: GameEvent[];
}

export type PlayerAction =
  | { type: "MULLIGAN"; keep: string[] }
  | { type: "PLAY_INK"; cardInstanceId: string }
  | { type: "PLAY_CARD"; cardInstanceId: string; choices?: PlayChoices }
  | { type: "QUEST"; characterId: string }
  | { type: "CHALLENGE"; attackerId: string; defenderId: string }
  | { type: "ACTIVATE_ABILITY"; cardInstanceId: string; abilityIndex: number; choices?: PlayChoices }
  | { type: "MOVE_TO_LOCATION"; characterId: string; locationId: string }
  | { type: "RESOLVE_CHOICE"; choiceId: string; selected: string[] }
  | { type: "PASS" };

export interface PlayChoices {
  targets?: string[];
  options?: string[];
  payAlternatives?: Record<string, string>;
}

export interface LegalAction {
  action: PlayerAction;
  description: string;
}

/**
 * Minimal structural shape of the engine's CardRegistry (SPEC §3.2 references it
 * in CreateGameOptions; the engine package owns the concrete class). The server
 * only needs lookup by cardId; script lookup is optional.
 */
export interface CardRegistry {
  get(cardId: string): CardDefinition | undefined;
  getScript?(cardId: string): CardScript | undefined;
}

// ------------------------------------------------------------------ SPEC §4 ---

export interface CardScript {
  cardId: string;
  keywords?: { name: Keyword; value?: number }[];
  shiftCost?: number;
  triggered?: TriggeredAbility[];
  activated?: ActivatedAbility[];
  continuous?: ContinuousAbility[];
}
export interface TriggeredAbility {
  name?: string;
  trigger: Trigger;
  effects: EffectNode[];
}
export interface ActivatedAbility {
  name?: string;
  cost: AbilityCost;
  effects: EffectNode[];
  oncePerTurn?: boolean;
}
export interface ContinuousAbility {
  name?: string;
  selector: Selector;
  modifier: Omit<Modifier, "id" | "source">;
  condition?: Condition;
}
export type Trigger =
  | "ON_PLAY"
  | "ON_QUEST"
  | "ON_CHALLENGE_BANISH"
  | "ON_BANISH"
  | "START_OF_TURN"
  | "END_OF_TURN"
  | "ON_OPPONENT_PLAY"
  | "ON_PLAY_CHARACTER";
export interface AbilityCost {
  ink?: number;
  exert?: boolean;
  discard?: number;
  banishSelf?: boolean;
}

/** EffectNode / Selector / Condition are owned by the engine's DSL interpreter.
 *  The server never interprets them; they are passed through opaquely in
 *  `lorcana_get_card` output, so `unknown`-shaped records suffice here. */
export type EffectNode = Record<string, unknown>;
export interface Selector {
  zone: "play" | "hand" | "discard";
  who: "self" | "opponent" | "any";
  type?: CardType;
  classification?: string;
  name?: string;
  filter?: "exerted" | "ready" | "damaged" | "undamaged" | "wet";
  chosen?: boolean;
}
export type Condition = Record<string, unknown>;

// -------------------------------------------------- server-local additions ---

/**
 * Structural interface of SPEC §3.2 `GameEngine` (instance side). The real
 * engine class satisfies this; the test StubEngine implements it directly.
 */
export interface EngineLike {
  getState(): GameState;
  getLegalActions(player: PlayerId): LegalAction[];
  applyAction(player: PlayerId, action: PlayerAction): ActionResult;
}

/**
 * Factory for engine instances. At integration time this becomes
 * `(opts) => new GameEngine(opts)`; replay for crash recovery is performed by
 * re-applying the persisted action history through `applyAction`
 * (equivalent to `GameEngine.replay`, SPEC §3.2).
 */
export type EngineFactory = (opts: CreateGameOptions) => EngineLike;

/** Standard error envelope for all tools (SPEC §6). */
export interface ToolError {
  ok: false;
  error: { code: string; message: string };
}

export function toolError(code: string, message: string): ToolError {
  return { ok: false, error: { code, message } };
}
