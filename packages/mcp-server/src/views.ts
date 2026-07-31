/**
 * views.ts — fog of war (SPEC §6).
 *
 *  - playerView(state, player): the viewing player sees their own hand/inkwell
 *    fully; the opponent's hand/deck/inkwell are COUNTS ONLY (no identities).
 *    The player's own deck is also a count (order is secret even to its owner).
 *  - spectatorView(state): the full public broadcast state. Discard and play
 *    zones are fully resolved (CardDefinition incl. imageUrl on every instance
 *    as `card`). Hands and inkwells are face-down: present as card "backs"
 *    carrying only instanceId/owner/zone so the UI can render the correct
 *    number of backs. Decks are counts.
 *
 * Every visible (non-hidden) CardInstance is enriched with its CardDefinition
 * in a `card` field. Ink totals are public information and exposed for both
 * players in every view; `inkAvailable` subtracts `inkUsedThisTurn` when the
 * engine exposes it (SPEC §3.3 "expose remaining ink in state views").
 */
import type {
  CardDefinition,
  CardInstance,
  CardRegistry,
  GameEvent,
  GameState,
  PendingChoice,
  PlayerId,
  Zone,
} from "./contracts.js";

/** A face-down placeholder: identity hidden, presence visible. */
export interface CardBack {
  instanceId: string;
  owner: PlayerId;
  zone: Zone;
  facedown: true;
}

/** A CardInstance with its static definition resolved. */
export interface EnrichedCardInstance extends CardInstance {
  card?: CardDefinition;
}

export type ViewCard = EnrichedCardInstance | CardBack;

/** Hidden zone reduced to a count. */
export interface ZoneCount {
  count: number;
}

export interface ViewPlayerState {
  id: PlayerId;
  lore: number;
  inkPlayedThisTurn: number;
  mulliganDone: boolean;
  /** Public: number of cards in the inkwell. */
  inkTotal: number;
  /** inkTotal minus inkUsedThisTurn when the engine exposes it (else inkTotal). */
  inkAvailable: number;
  deck: ZoneCount;
  hand: ZoneCount | ViewCard[];
  inkwell: ZoneCount | ViewCard[];
  discard: EnrichedCardInstance[];
  play: EnrichedCardInstance[];
}

export interface PlayerView {
  matchId: string;
  turn: number;
  activePlayer: PlayerId;
  phase: GameState["phase"];
  winner?: PlayerId;
  winReason?: GameState["winReason"];
  you: PlayerId;
  players: Record<PlayerId, ViewPlayerState>;
  /** Present only when the viewing player is the one who must choose. */
  pendingChoice?: PendingChoice;
  log: GameEvent[];
}

export interface SpectatorView {
  matchId: string;
  turn: number;
  activePlayer: PlayerId;
  phase: GameState["phase"];
  winner?: PlayerId;
  winReason?: GameState["winReason"];
  players: Record<PlayerId, ViewPlayerState>;
  pendingChoice?: PendingChoice;
  log: GameEvent[];
}

function back(inst: CardInstance): CardBack {
  return { instanceId: inst.instanceId, owner: inst.owner, zone: inst.zone, facedown: true };
}

function enrich(inst: CardInstance, registry?: CardRegistry): EnrichedCardInstance {
  const card = registry?.get(inst.cardId);
  return card ? { ...inst, card } : { ...inst };
}

function count(zone: CardInstance[]): ZoneCount {
  return { count: zone.length };
}

/** Ink spent this turn, when the engine tracks it (SPEC §3.3 "or equivalent"). */
function inkUsed(ps: GameState["players"][PlayerId]): number {
  const v = (ps as unknown as Record<string, unknown>)["inkUsedThisTurn"];
  return typeof v === "number" ? v : 0;
}

function baseView(ps: GameState["players"][PlayerId], registry?: CardRegistry) {
  const inkTotal = ps.inkwell.length;
  return {
    id: ps.id,
    lore: ps.lore,
    inkPlayedThisTurn: ps.inkPlayedThisTurn,
    mulliganDone: ps.mulliganDone,
    inkTotal,
    inkAvailable: inkTotal - inkUsed(ps),
    deck: count(ps.deck),
    discard: ps.discard.map((i) => enrich(i, registry)),
    play: ps.play.map((i) => enrich(i, registry)),
  };
}

function topView(state: GameState) {
  const v: PlayerView = {
    matchId: state.matchId,
    turn: state.turn,
    activePlayer: state.activePlayer,
    phase: state.phase,
    you: "p1",
    players: { p1: undefined as never, p2: undefined as never },
    log: state.log,
  };
  if (state.winner !== undefined) v.winner = state.winner;
  if (state.winReason !== undefined) v.winReason = state.winReason;
  return v;
}

export function playerView(state: GameState, player: PlayerId, registry?: CardRegistry): PlayerView {
  const opponent: PlayerId = player === "p1" ? "p2" : "p1";
  const self = state.players[player];
  const opp = state.players[opponent];

  const view = topView(state);
  view.you = player;
  view.players = {
    [player]: {
      ...baseView(self, registry),
      hand: self.hand.map((i) => enrich(i, registry)),
      inkwell: self.inkwell.map((i) => enrich(i, registry)),
    },
    [opponent]: {
      ...baseView(opp, registry),
      hand: count(opp.hand),
      inkwell: count(opp.inkwell),
    },
  } as Record<PlayerId, ViewPlayerState>;
  if (state.pendingChoice && state.pendingChoice.player === player) {
    view.pendingChoice = state.pendingChoice;
  }
  return view;
}

export function spectatorView(state: GameState, registry?: CardRegistry): SpectatorView {
  const { you: _you, ...base } = topView(state);
  const view: SpectatorView = {
    ...base,
    players: { p1: undefined as never, p2: undefined as never },
  };
  for (const pid of ["p1", "p2"] as const) {
    const ps = state.players[pid];
    view.players[pid] = {
      ...baseView(ps, registry),
      hand: ps.hand.map(back),
      inkwell: ps.inkwell.map(back),
    };
  }
  if (state.pendingChoice) view.pendingChoice = state.pendingChoice;
  return view;
}
