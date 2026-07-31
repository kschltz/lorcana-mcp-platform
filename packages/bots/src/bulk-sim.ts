/**
 * bulk-sim.ts — in-process AI-vs-AI match battery (no MCP round-trips).
 *
 * Usage:
 *   npx tsx packages/bots/src/bulk-sim.ts \
 *     --deckA data/toys-meta/counter-sapphire-steel.txt \
 *     --deckB data/toys-meta/toys-ar-classic.txt \
 *     --games 500 --seed 1 --metrics /tmp/out.jsonl
 *
 * Or matrix mode:
 *   npx tsx packages/bots/src/bulk-sim.ts --matrix data/toys-meta --games 200 --seed 42 \
 *     --metrics /tmp/toys-matrix.jsonl
 *
 * Applies Lorcast inkable overrides for sets with broken Inkable flags in the
 * committed lorcana-api bulk (notably WHI/WIN/WUN/AZS).
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  CardRegistry,
  GameEngine,
  type CardDefinition,
  type CardScript,
  type GameState,
  type LegalAction,
  type PlayerAction,
  type PlayerId,
} from "@lorcana/engine";
import { chooseAction } from "./policy.js";
import type { PlayerView, ViewPlayerState, EnrichedCardInstance } from "./types.js";

const ACTION_CAP = 400;
const ROOT = resolve(join(import.meta.dirname, "../../.."));

interface Cli {
  deckA?: string;
  deckB?: string;
  matrix?: string;
  games: number;
  seed: number;
  metrics?: string;
  inkable?: string;
  verbose: boolean;
  /** Restrict deckbuilding to Core Constructed set numbers (inclusive). */
  coreMin?: number;
  coreMax?: number;
}

function parseArgs(argv: string[]): Cli {
  const out: Partial<Cli> = { games: 100, seed: 1, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--verbose") { out.verbose = true; continue; }
    if (a === "--core") {
      // Post–July 2026 Core: Sets 9–13. Set 13 is absent from this repo's pool,
      // so the default window is 9–12 (FAB–WUN).
      out.coreMin = 9;
      out.coreMax = 12;
      continue;
    }
    const v = argv[++i];
    if (v === undefined) throw new Error(`missing value for ${a}`);
    switch (a) {
      case "--deckA": out.deckA = v; break;
      case "--deckB": out.deckB = v; break;
      case "--matrix": out.matrix = v; break;
      case "--games": out.games = Number.parseInt(v, 10); break;
      case "--seed": out.seed = Number.parseInt(v, 10); break;
      case "--metrics": out.metrics = v; break;
      case "--inkable": out.inkable = v; break;
      case "--coreMin": out.coreMin = Number.parseInt(v, 10); break;
      case "--coreMax": out.coreMax = Number.parseInt(v, 10); break;
      default: throw new Error(`unknown arg ${a}`);
    }
  }
  if (!out.matrix && (!out.deckA || !out.deckB)) {
    throw new Error("need --deckA/--deckB or --matrix <dir>");
  }
  return out as Cli;
}

// ---------------------------------------------------------------------------
// Card pool + inkable patch
// ---------------------------------------------------------------------------

function loadInkableMap(path: string | undefined): Map<string, boolean> {
  const p = path ?? join(ROOT, "data/inkable/lorcast-sets-6-10-11-12.json");
  const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, boolean>;
  return new Map(Object.entries(raw));
}

function loadRegistry(inkable: Map<string, boolean>): {
  registry: CardRegistry;
  byName: Map<string, CardDefinition[]>;
} {
  const cardsPath = join(ROOT, "packages/card-data/dist-data/cards.json");
  const scriptsPath = join(ROOT, "packages/card-data/dist-data/scripts.json");
  const cards = JSON.parse(readFileSync(cardsPath, "utf8")) as CardDefinition[];
  const scripts = JSON.parse(readFileSync(scriptsPath, "utf8")) as Record<string, CardScript>;

  let patched = 0;
  for (const c of cards) {
    if (inkable.has(c.fullName)) {
      const v = inkable.get(c.fullName)!;
      if (c.inkable !== v) { c.inkable = v; patched++; }
    }
  }
  console.error(`[bulk-sim] patched inkable on ${patched} card printings`);

  const byName = new Map<string, CardDefinition[]>();
  for (const c of cards) {
    const list = byName.get(c.fullName) ?? [];
    list.push(c);
    byName.set(c.fullName, list);
  }
  return { registry: new CardRegistry(cards, scripts), byName };
}

function parseDeckText(
  text: string,
  byName: Map<string, CardDefinition[]>,
  core?: { min: number; max: number },
): string[] {
  const ids: string[] = [];
  const colors = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(\d+)\s+(.+)$/.exec(line);
    if (!m) throw new Error(`bad deck line: ${line}`);
    const qty = Number.parseInt(m[1]!, 10);
    const name = m[2]!.trim();
    let opts = byName.get(name) ?? [];
    if (core) {
      opts = opts.filter((c) => c.setNum >= core.min && c.setNum <= core.max);
      if (!opts.length) {
        throw new Error(
          `not Core-legal (sets ${core.min}–${core.max}): ${name}`,
        );
      }
    }
    if (!opts.length) throw new Error(`unknown card: ${name}`);
    // Prefer newest legal printing when duplicates share a fullName.
    const card = opts.reduce((a, b) => (a.setNum >= b.setNum ? a : b));
    for (const col of card.colors) colors.add(col);
    for (let i = 0; i < qty; i++) ids.push(card.id);
  }
  if (ids.length !== 60) throw new Error(`deck must be 60 cards, got ${ids.length}`);
  if (colors.size > 2) {
    throw new Error(`deck uses ${colors.size} inks (${[...colors].join(", ")}); max 2`);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Minimal fog-of-war view (mirrors mcp-server playerView enough for the policy)
// ---------------------------------------------------------------------------

function enrich(inst: GameState["players"]["p1"]["play"][number], reg: CardRegistry): EnrichedCardInstance {
  // Policy reads definition via `inst.card` (same shape as mcp-server views).
  return { ...inst, card: reg.get(inst.cardId) };
}

function playerView(state: GameState, you: PlayerId, reg: CardRegistry): PlayerView {
  const opp: PlayerId = you === "p1" ? "p2" : "p1";
  const self = state.players[you];
  const other = state.players[opp];
  const mkBase = (p: typeof self): Omit<ViewPlayerState, "hand" | "inkwell"> => ({
    id: p.id,
    lore: p.lore,
    inkPlayedThisTurn: p.inkPlayedThisTurn,
    mulliganDone: p.mulliganDone,
    inkTotal: p.inkwell.length,
    inkAvailable: p.inkwell.filter((c) => !c.exerted).length,
    deck: { count: p.deck.length },
    discard: p.discard.map((i) => enrich(i, reg)),
    play: p.play.map((i) => enrich(i, reg)),
  });
  const view: PlayerView = {
    matchId: state.matchId,
    turn: state.turn,
    activePlayer: state.activePlayer,
    phase: state.phase,
    you,
    players: {
      [you]: {
        ...mkBase(self),
        hand: self.hand.map((i) => enrich(i, reg)),
        inkwell: self.inkwell.map((i) => enrich(i, reg)),
      },
      [opp]: {
        ...mkBase(other),
        hand: { count: other.hand.length },
        inkwell: { count: other.inkwell.length },
      },
    } as Record<PlayerId, ViewPlayerState>,
    log: state.log,
  };
  if (state.winner) view.winner = state.winner;
  if (state.winReason) view.winReason = state.winReason;
  if (state.pendingChoice?.player === you) view.pendingChoice = state.pendingChoice;
  return view;
}

// ---------------------------------------------------------------------------
// Match loop
// ---------------------------------------------------------------------------

interface GameRow {
  game: number;
  seed: number;
  deckA: string;
  deckB: string;
  winner: PlayerId | null;
  reason: string | null;
  turns: number;
  actions: number;
  failure: string | null;
  lore: { p1: number; p2: number } | null;
}

function playGame(
  reg: CardRegistry,
  deckA: string[],
  deckB: string[],
  seed: number,
  game: number,
  labelA: string,
  labelB: string,
): GameRow {
  const engine = new GameEngine({
    matchId: `sim-${game}-${seed}`,
    seed,
    deckA,
    deckB,
    registry: reg,
  });

  let actions = 0;
  const recent: string[] = [];
  while (actions < ACTION_CAP) {
    const state = engine.getState();
    if (state.phase === "game-over" || state.winner) {
      return {
        game, seed, deckA: labelA, deckB: labelB,
        winner: state.winner ?? null,
        reason: state.winReason ?? null,
        turns: state.turn,
        actions,
        failure: null,
        lore: { p1: state.players.p1.lore, p2: state.players.p2.lore },
      };
    }

    // Who acts: pending choice player, else active player (both may still need mulligan).
    let actor: PlayerId | undefined;
    if (state.pendingChoice) actor = state.pendingChoice.player;
    else if (state.phase === "mulligan") {
      if (!state.players.p1.mulliganDone) actor = "p1";
      else if (!state.players.p2.mulliganDone) actor = "p2";
    } else {
      actor = state.activePlayer;
    }
    if (!actor) {
      return {
        game, seed, deckA: labelA, deckB: labelB,
        winner: null, reason: null, turns: state.turn, actions,
        failure: "stall: no actor", lore: null,
      };
    }

    const legal = engine.getLegalActions(actor);
    if (legal.length === 0) {
      return {
        game, seed, deckA: labelA, deckB: labelB,
        winner: null, reason: null, turns: state.turn, actions,
        failure: `stall: ${actor} has no legal actions`, lore: null,
      };
    }

    const view = playerView(state, actor, reg);
    let action: PlayerAction = chooseAction(view, legal as LegalAction[]);
    const sig = `${actor}:${JSON.stringify(action)}`;
    recent.push(sig);
    if (recent.length > 40) recent.shift();
    if (recent.filter((x) => x === sig).length >= 20) {
      const pass = legal.find((l) => l.action.type === "PASS");
      if (pass) action = pass.action;
      else {
        return {
          game, seed, deckA: labelA, deckB: labelB,
          winner: null, reason: null, turns: state.turn, actions,
          failure: "policy loop", lore: null,
        };
      }
    }

    const res = engine.applyAction(actor, action);
    actions++;
    if (!res.ok) {
      return {
        game, seed, deckA: labelA, deckB: labelB,
        winner: null, reason: null, turns: state.turn, actions,
        failure: `INVALID_ACTION: ${res.error}`, lore: null,
      };
    }
  }
  const s = engine.getState();
  return {
    game, seed, deckA: labelA, deckB: labelB,
    winner: null, reason: null, turns: s.turn, actions,
    failure: `action cap ${ACTION_CAP}`, lore: null,
  };
}

function runPair(
  reg: CardRegistry,
  byName: Map<string, CardDefinition[]>,
  pathA: string,
  pathB: string,
  games: number,
  seed0: number,
  core?: { min: number; max: number },
): GameRow[] {
  const labelA = basename(pathA, ".txt");
  const labelB = basename(pathB, ".txt");
  const deckA = parseDeckText(readFileSync(pathA, "utf8"), byName, core);
  const deckB = parseDeckText(readFileSync(pathB, "utf8"), byName, core);
  const rows: GameRow[] = [];
  for (let g = 1; g <= games; g++) {
    const seed = seed0 + g - 1;
    // Alternate seats so deck identity isn't glued to p1 initiative.
    const swap = g % 2 === 0;
    const r = playGame(
      reg,
      swap ? deckB : deckA,
      swap ? deckA : deckB,
      seed,
      g,
      swap ? labelB : labelA,
      swap ? labelA : labelB,
    );
    // Normalize winner relative to counter label when needed — keep raw seats;
    // matrix summarizer maps by deckA/deckB fields on the row.
    if (swap && r.winner) {
      // After swap, engine p1 was originally deckB. Remap so row.deckA always
      // means pathA's deck and winner is from that deck's perspective.
      const winnerDeck = r.winner === "p1" ? r.deckA : r.deckB;
      rows.push({
        ...r,
        deckA: labelA,
        deckB: labelB,
        winner: winnerDeck === labelA ? "p1" : winnerDeck === labelB ? "p2" : r.winner,
      });
    } else {
      rows.push({ ...r, deckA: labelA, deckB: labelB });
    }
    if (g % 50 === 0 || g === games) {
      const wins = rows.filter((x) => x.winner === "p1" && !x.failure).length;
      const done = rows.filter((x) => !x.failure && x.winner).length;
      console.error(`[${labelA} vs ${labelB}] ${g}/${games}  A_wins=${wins}/${done}`);
    }
  }
  return rows;
}

function summarize(rows: GameRow[]): void {
  const keys = new Map<string, GameRow[]>();
  for (const r of rows) {
    const k = `${r.deckA}||${r.deckB}`;
    (keys.get(k) ?? (keys.set(k, []), keys.get(k)!)).push(r);
  }
  console.log("\n=== matchup summary (deckA win rate; seats alternated) ===");
  console.log(
    "matchup".padEnd(55),
    "games".padStart(6),
    "A_wr".padStart(8),
    "B_wr".padStart(8),
    "fail".padStart(6),
    "avgT".padStart(7),
  );
  for (const [k, list] of [...keys.entries()].sort()) {
    const [a, b] = k.split("||");
    const finished = list.filter((r) => !r.failure && r.winner);
    const aWins = finished.filter((r) => r.winner === "p1").length;
    const bWins = finished.filter((r) => r.winner === "p2").length;
    const fails = list.filter((r) => r.failure).length;
    const avgT = finished.length
      ? (finished.reduce((s, r) => s + r.turns, 0) / finished.length).toFixed(1)
      : "-";
    const aWr = finished.length ? ((100 * aWins) / finished.length).toFixed(1) + "%" : "-";
    const bWr = finished.length ? ((100 * bWins) / finished.length).toFixed(1) + "%" : "-";
    console.log(
      `${a} vs ${b}`.padEnd(55),
      String(list.length).padStart(6),
      aWr.padStart(8),
      bWr.padStart(8),
      String(fails).padStart(6),
      String(avgT).padStart(7),
    );
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const inkable = loadInkableMap(args.inkable);
  const { registry, byName } = loadRegistry(inkable);
  const core =
    args.coreMin !== undefined && args.coreMax !== undefined
      ? { min: args.coreMin, max: args.coreMax }
      : undefined;
  if (core) {
    console.error(`[bulk-sim] Core Constructed filter: sets ${core.min}–${core.max}`);
  }

  let rows: GameRow[] = [];
  if (args.matrix) {
    const dir = resolve(args.matrix);
    const files = readdirSync(dir).filter((f) => f.endsWith(".txt")).sort();
    const toys = files.filter((f) => f.startsWith("toys-")).map((f) => join(dir, f));
    const counters = files.filter((f) => f.startsWith("counter-")).map((f) => join(dir, f));
    if (toys.length === 0 || counters.length === 0) {
      throw new Error(`matrix dir needs toys-*.txt and counter-*.txt (found ${files.join(",")})`);
    }
    console.error(`[bulk-sim] matrix: ${counters.length} counters × ${toys.length} toys × ${args.games} games`);
    let pairSeed = args.seed;
    for (const c of counters) {
      for (const t of toys) {
        rows = rows.concat(runPair(registry, byName, c, t, args.games, pairSeed, core));
        pairSeed += args.games;
      }
    }
  } else {
    rows = runPair(
      registry,
      byName,
      resolve(args.deckA!),
      resolve(args.deckB!),
      args.games,
      args.seed,
      core,
    );
  }

  summarize(rows);
  if (args.metrics) {
    mkdirSync(resolve(args.metrics, ".."), { recursive: true });
    writeFileSync(args.metrics, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.error(`[bulk-sim] wrote ${rows.length} rows → ${args.metrics}`);
  }
}

main();
