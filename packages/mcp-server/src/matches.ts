/**
 * matches.ts — match registry (SPEC §6).
 *
 * In-memory Map of live matches plus crash-resumable JSON persistence: after
 * every mutating call (create / play_action / concede) the match record —
 * creation options, seat tokens, and the full ordered action history — is
 * rewritten to `<dataDir>/matches/<matchId>.json`. On startup `load()` replays
 * each record's action history through the engine (equivalent to
 * `GameEngine.replay`, SPEC §3.2) so state survives process restarts.
 *
 * Seat tokens: random 16-hex per seat, generated at create time; every
 * state/action call is gated — a p1 token can never act or look as p2.
 *
 * Concede: `PlayerAction` has no CONCEDE variant (SPEC §3.2), so concede is a
 * server-level overlay: the registry records `concededBy` and projects
 * phase="game-over", winner=<opponent>, winReason="concede" onto every state
 * read (and blocks further actions). The overlay is persisted in the record.
 */
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type {
  ActionResult,
  CardRegistry,
  EngineFactory,
  EngineLike,
  GameEvent,
  GameState,
  LegalAction,
  PlayerAction,
  PlayerId,
} from "./contracts.js";

/** Error with a stable machine-readable code (SPEC §6 error envelope). */
export class CodedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CodedError";
  }
}

export interface SeatTokens {
  p1: string;
  p2: string;
}

export interface RecordedAction {
  player: PlayerId;
  action: PlayerAction;
}

/** Persisted shape of data/matches/<matchId>.json. */
export interface MatchRecord {
  matchId: string;
  seed: number;
  deckA: string[];
  deckB: string[];
  tokens: SeatTokens;
  createdAt: string;
  actions: RecordedAction[];
  concededBy?: PlayerId;
}

export interface MatchSummary {
  matchId: string;
  createdAt: string;
  turn: number;
  phase: GameState["phase"];
  activePlayer: PlayerId;
  scores: Record<PlayerId, number>;
  winner?: PlayerId;
  winReason?: GameState["winReason"];
}

interface LiveMatch {
  record: MatchRecord;
  engine: EngineLike;
}

export interface MatchRegistryOptions {
  /** Directory for match persistence files (created if missing). */
  dataDir: string;
  engineFactory: EngineFactory;
  registry: CardRegistry;
}

function token(): string {
  return randomBytes(8).toString("hex"); // 16 hex chars, SPEC §6
}

export class MatchRegistry extends EventEmitter {
  private readonly matches = new Map<string, LiveMatch>();
  readonly dataDir: string;
  private readonly engineFactory: EngineFactory;
  private readonly registry: CardRegistry;

  constructor(opts: MatchRegistryOptions) {
    super();
    this.dataDir = opts.dataDir;
    this.engineFactory = opts.engineFactory;
    this.registry = opts.registry;
    mkdirSync(this.dataDir, { recursive: true });
  }

  /** Resume persisted matches from disk (call once at startup). */
  load(): void {
    if (!existsSync(this.dataDir)) return;
    for (const file of readdirSync(this.dataDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const record = JSON.parse(readFileSync(join(this.dataDir, file), "utf8")) as MatchRecord;
        if (this.matches.has(record.matchId)) continue;
        const engine = this.replay(record);
        this.matches.set(record.matchId, { record, engine });
      } catch (err) {
        // A corrupt record must not take down the server; skip it loudly.
        console.error(`[matches] failed to resume ${file}:`, err);
      }
    }
  }

  /** Rebuild an engine by replaying the recorded action history. */
  private replay(record: MatchRecord): EngineLike {
    const engine = this.engineFactory({
      matchId: record.matchId,
      seed: record.seed,
      deckA: record.deckA,
      deckB: record.deckB,
      registry: this.registry,
    });
    for (const { player, action } of record.actions) {
      const result = engine.applyAction(player, action);
      if (!result.ok) {
        throw new Error(
          `replay of ${record.matchId} diverged at ${player} ${action.type}: ${result.error}`,
        );
      }
    }
    return engine;
  }

  create(deckA: string[], deckB: string[], seed?: number): {
    matchId: string;
    tokenP1: string;
    tokenP2: string;
  } {
    const matchId = `match-${randomBytes(6).toString("hex")}`;
    const record: MatchRecord = {
      matchId,
      seed: seed ?? randomBytes(4).readUInt32BE(0),
      deckA,
      deckB,
      tokens: { p1: token(), p2: token() },
      createdAt: new Date().toISOString(),
      actions: [],
    };
    const engine = this.engineFactory({
      matchId,
      seed: record.seed,
      deckA,
      deckB,
      registry: this.registry,
    });
    this.matches.set(matchId, { record, engine });
    this.persist(record);
    return { matchId, tokenP1: record.tokens.p1, tokenP2: record.tokens.p2 };
  }

  has(matchId: string): boolean {
    return this.matches.has(matchId);
  }

  private live(matchId: string): LiveMatch {
    const m = this.matches.get(matchId);
    if (!m) throw new CodedError("NOT_FOUND", `unknown match: ${matchId}`);
    return m;
  }

  /** Resolve a seat token to its PlayerId; wrong/unknown tokens are FORBIDDEN. */
  private seatFor(liveMatch: LiveMatch, provided: string): PlayerId {
    const { tokens } = liveMatch.record;
    if (provided === tokens.p1) return "p1";
    if (provided === tokens.p2) return "p2";
    throw new CodedError("FORBIDDEN", "invalid seat token for this match");
  }

  /** Current state with the concede overlay applied. */
  private projectedState(liveMatch: LiveMatch): GameState {
    const state = liveMatch.engine.getState();
    const concededBy = liveMatch.record.concededBy;
    if (concededBy && state.phase !== "game-over") {
      state.phase = "game-over";
      state.winner = concededBy === "p1" ? "p2" : "p1";
      state.winReason = "concede";
    }
    return state;
  }

  getState(matchId: string, providedToken: string): { player: PlayerId; state: GameState } {
    const m = this.live(matchId);
    const player = this.seatFor(m, providedToken);
    return { player, state: this.projectedState(m) };
  }

  getLegalActions(matchId: string, providedToken: string): { player: PlayerId; legalActions: LegalAction[] } {
    const m = this.live(matchId);
    const player = this.seatFor(m, providedToken);
    if (m.record.concededBy) return { player, legalActions: [] };
    return { player, legalActions: m.engine.getLegalActions(player) };
  }

  playAction(
    matchId: string,
    providedToken: string,
    action: PlayerAction,
  ): { player: PlayerId; result: ActionResult } {
    const m = this.live(matchId);
    const player = this.seatFor(m, providedToken);
    if (m.record.concededBy) {
      throw new CodedError("GAME_OVER", "match is already over (conceded)");
    }
    const result = m.engine.applyAction(player, action);
    if (result.ok) {
      m.record.actions.push({ player, action });
      this.persist(m.record); // persist after every mutating call (SPEC §6)
      this.emit("action", matchId, result.newEvents);
    }
    return { player, result };
  }

  concede(matchId: string, providedToken: string): { player: PlayerId } {
    const m = this.live(matchId);
    const player = this.seatFor(m, providedToken);
    if (this.projectedState(m).phase === "game-over") {
      throw new CodedError("GAME_OVER", "match is already over");
    }
    m.record.concededBy = player;
    this.persist(m.record);
    this.emit("action", matchId, [] as GameEvent[]);
    return { player };
  }

  spectatorState(matchId: string): GameState {
    return this.projectedState(this.live(matchId));
  }

  list(): MatchSummary[] {
    return [...this.matches.values()].map((m) => {
      const s = this.projectedState(m);
      const summary: MatchSummary = {
        matchId: m.record.matchId,
        createdAt: m.record.createdAt,
        turn: s.turn,
        phase: s.phase,
        activePlayer: s.activePlayer,
        scores: { p1: s.players.p1.lore, p2: s.players.p2.lore },
      };
      if (s.winner !== undefined) summary.winner = s.winner;
      if (s.winReason !== undefined) summary.winReason = s.winReason;
      return summary;
    });
  }

  private persist(record: MatchRecord): void {
    writeFileSync(join(this.dataDir, `${record.matchId}.json`), JSON.stringify(record, null, 2));
  }
}
