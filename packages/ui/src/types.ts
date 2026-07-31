// Type contract for the spectator UI, mirroring SPEC §3.1 / §5 (spectatorView).
// The spectator view enriches every known CardInstance with its CardDefinition.

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
  /** Present in spectatorView when the card identity is known (full state). */
  card?: CardDefinition;
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
  winner?: PlayerId;
  winReason?: "lore" | "deck-out" | "concede";
  log: GameEvent[];
  rngState: number;
}

/** GET /api/matches entry (live/finished matches w/ scores). */
export interface MatchSummary {
  matchId: string;
  live: boolean;
  turn: number;
  phase: string;
  scores: { p1: number; p2: number };
  winner?: PlayerId;
  winReason?: string;
  createdAt?: string;
}

export const LORE_TO_WIN = 20;
