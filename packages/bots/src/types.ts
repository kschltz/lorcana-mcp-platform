/**
 * types.ts — local mirrors of the SPEC §3.1/§3.2/§6 wire shapes the bots
 * consume over MCP. Kept dependency-free on purpose: the bots package talks
 * to the platform exclusively through the MCP tools, so it must not import
 * engine/server internals.
 */

export type PlayerId = "p1" | "p2";
export type InkColor = "Amber" | "Amethyst" | "Emerald" | "Ruby" | "Sapphire" | "Steel";
export type CardType = "Character" | "Action" | "Item" | "Location";
export type Zone = "deck" | "hand" | "inkwell" | "discard" | "play";

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

export interface Modifier {
  id: string;
  source: string;
  duration: "this-turn" | "while-in-play" | "permanent";
  stat?: { strength?: number; willpower?: number; lore?: number };
  grantKeywords?: string[];
  removeKeywords?: string[];
  resist?: number;
  cantQuest?: boolean;
  cantChallenge?: boolean;
  cantReady?: boolean;
  singerAs?: number;
  condition?: string;
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
  atLocation?: string;
}

/** A CardInstance enriched by the server views with its static definition. */
export interface EnrichedCardInstance extends CardInstance {
  card?: CardDefinition;
}

/** Face-down placeholder for hidden zones in spectator views. */
export interface CardBack {
  instanceId: string;
  owner: PlayerId;
  zone: Zone;
  facedown: true;
}

export type ViewCard = EnrichedCardInstance | CardBack;

export interface ZoneCount {
  count: number;
}

export interface ViewPlayerState {
  id: PlayerId;
  lore: number;
  inkPlayedThisTurn: number;
  mulliganDone: boolean;
  inkTotal: number;
  inkAvailable: number;
  deck: ZoneCount;
  hand: ZoneCount | ViewCard[];
  inkwell: ZoneCount | ViewCard[];
  discard: EnrichedCardInstance[];
  play: EnrichedCardInstance[];
}

export interface ChoiceOption {
  id: string;
  label: string;
  cardInstanceId?: string;
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

export interface GameEvent {
  turn: number;
  seq: number;
  type: string;
  player?: PlayerId;
  message: string;
  data?: Record<string, unknown>;
}

export interface PlayerView {
  matchId: string;
  turn: number;
  activePlayer: PlayerId;
  phase: "setup" | "mulligan" | "main" | "game-over";
  winner?: PlayerId;
  winReason?: "lore" | "deck-out" | "concede";
  you: PlayerId;
  players: Record<PlayerId, ViewPlayerState>;
  pendingChoice?: PendingChoice;
  log: GameEvent[];
}

// --- PlayerAction / LegalAction (SPEC §3.2) ---------------------------------

export interface PlayChoices {
  targets?: string[];
  options?: string[];
  payAlternatives?: Record<string, string>;
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

export interface LegalAction {
  action: PlayerAction;
  description: string;
}

// --- MCP tool result envelopes (SPEC §6) -------------------------------------

export interface ToolError {
  code: string;
  message: string;
}

export interface CardSummary {
  id: string;
  fullName: string;
  cost: number;
  colors: InkColor[];
  type: CardType;
  strength?: number;
  willpower?: number;
  lore?: number;
  inkable: boolean;
  bodyText: string;
  imageUrl: string;
}

export interface SearchCardsResult {
  cards: CardSummary[];
}

export interface ValidateDeckResult {
  valid: boolean;
  errors: string[];
  deck: { cardId: string; count: number }[];
}

export interface ImportDeckResult {
  deckId: string;
  deck: { cardId: string; count: number }[];
}

export interface CreateMatchResult {
  matchId: string;
  tokenP1: string;
  tokenP2: string;
  spectatorUrl: string;
}

export interface GetStateResult {
  state: PlayerView;
  legalActions: LegalAction[];
  yourTurn: boolean;
}

export interface PlayActionResult {
  ok: boolean;
  error?: ToolError;
  state: PlayerView;
  legalActions: LegalAction[];
  newEvents: GameEvent[];
}
