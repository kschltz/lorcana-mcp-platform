/**
 * run-match.ts — AI-vs-AI match runner (SPEC §8).
 *
 *   npm run match -w @lorcana/bots -- --server http://localhost:8787 \
 *     --deckA "<text>" --deckB "<text>" --games 4 --seed 42 --verbose
 *
 * Both seats are driven by the pure heuristic policy (policy.ts) exclusively
 * through MCP tool calls — this is the platform's MCP-compliance proof.
 *
 * Flow: validate both decklists (substituting unknown newest-set cards via
 * lorcana_search_cards, noted on stderr/stdout), import them, then per game
 * create a match and alternate on `yourTurn`/legal-actions until a winner or
 * the 400-action cap (a cap is reported as failure). Any INVALID_ACTION from
 * an enumerated legal action is a P0: the action + state JSON are dumped to
 * `bots-p0-*.json` and the game is failed.
 */
import { writeFileSync } from "node:fs";
import { LorcanaClient } from "./client.js";
import { chooseAction } from "./policy.js";
import { llmChooseAction, type LlmPolicyOptions } from "./llm-policy.js";
import type {
  GetStateResult,
  LegalAction,
  PlayerAction,
  PlayerId,
  PlayerView,
} from "./types.js";

const ACTION_CAP = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CliArgs {
  server: string;
  deckA: string;
  deckB: string;
  games: number;
  seed: number;
  verbose: boolean;
  /** Delay between actions in seconds. */
  delay: number;
  /** Which seat(s) use the LLM policy (p1, p2, both, none). */
  llmSeat: "p1" | "p2" | "both" | "none";
  /** Ollama model for the LLM seat. */
  llmModel: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = {
    games: 1,
    seed: 1,
    verbose: false,
    delay: 0,
    llmSeat: "none",
    llmModel: "llama3.2",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--verbose") {
      args.verbose = true;
      continue;
    }
    const next = argv[++i];
    if (next === undefined) throw new Error(`missing value for ${a}`);
    switch (a) {
      case "--server": args.server = next; break;
      case "--deckA": args.deckA = next; break;
      case "--deckB": args.deckB = next; break;
      case "--games": args.games = Number.parseInt(next, 10); break;
      case "--seed": args.seed = Number.parseInt(next, 10); break;
      case "--delay": args.delay = Number.parseFloat(next); break;
      case "--llm-seat": args.llmSeat = next as CliArgs["llmSeat"]; break;
      case "--llm-model": args.llmModel = next; break;
      default: throw new Error(`unknown argument: ${a}`);
    }
  }
  if (!args.server) throw new Error("--server is required");
  if (!args.deckA) throw new Error("--deckA is required");
  if (!args.deckB) throw new Error("--deckB is required");
  if (!Number.isFinite(args.games) || args.games! < 1) throw new Error("--games must be >= 1");
  if (!Number.isFinite(args.delay!) || args.delay! < 0) throw new Error("--delay must be >= 0");
  if (!["p1", "p2", "both", "none"].includes(args.llmSeat!)) {
    throw new Error("--llm-seat must be one of: p1, p2, both, none");
  }
  return args as CliArgs;
}

// ---------------------------------------------------------------------------
// Deck validation + unknown-card substitution
// ---------------------------------------------------------------------------

const LINE_RE = /^(\d+)\s+(.+?)\s*$/;

interface DeckLine {
  count: number;
  name: string;
}

function parseDeckLines(text: string, label: string): DeckLine[] {
  const lines: DeckLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = LINE_RE.exec(line);
    if (!m) throw new Error(`deck ${label}: unparseable line: "${line}"`);
    lines.push({ count: Number.parseInt(m[1], 10), name: m[2] });
  }
  return lines;
}

/**
 * Resolve every decklist line against lorcana_search_cards. Lines whose exact
 * full name is unknown (newest-set cards not yet in the bulk data) are
 * substituted with the closest known card: prefer another printing of the
 * same character (same base name), within the deck's inks, inkable, and —
 * since the intended card's cost is unknowable — closest to the middle of
 * the curve (cost 3). Substituted lines keep their copy count, never push a
 * card past 4 copies, and every substitution is reported. The rewritten
 * decklist is validated for real with lorcana_validate_deck at the end.
 */
async function ensureValidDeck(
  client: LorcanaClient,
  label: string,
  text: string,
  log: (msg: string) => void,
): Promise<string> {
  const lines = parseDeckLines(text, label);
  const searchCache = new Map<string, Awaited<ReturnType<LorcanaClient["searchCards"]>>["cards"]>();
  const search = async (params: Parameters<LorcanaClient["searchCards"]>[0]) => {
    const key = JSON.stringify(params);
    let cards = searchCache.get(key);
    if (!cards) {
      cards = (await client.searchCards(params)).cards;
      searchCache.set(key, cards);
    }
    return cards;
  };

  // Pass 1: which lines resolve to an exact full-name match?
  interface Resolved {
    count: number;
    name: string;
    cardId?: string;
    colors: string[];
    wasSubstituted?: string;
  }
  const resolved: Resolved[] = [];
  const unknownIdx: number[] = [];
  for (const line of lines) {
    const candidates = await search({ query: line.name, limit: 100 });
    const exact = candidates.find((c) => c.fullName.toLowerCase() === line.name.toLowerCase());
    if (exact) {
      resolved.push({ count: line.count, name: exact.fullName, cardId: exact.id, colors: exact.colors });
    } else {
      resolved.push({ count: line.count, name: line.name, colors: [] });
      unknownIdx.push(resolved.length - 1);
    }
  }

  // Deck inks from the known portion (≤ 2 for a legal deck).
  const deckInks = new Set<string>();
  for (const r of resolved) for (const c of r.colors) deckInks.add(c);

  // Copy counts per card, so substitutions never exceed 4.
  const copies = new Map<string, number>();
  for (const r of resolved) {
    if (r.cardId) copies.set(r.cardId, (copies.get(r.cardId) ?? 0) + r.count);
  }

  // Pass 2: substitute unknown lines.
  const substitutions: string[] = [];
  for (const idx of unknownIdx) {
    const line = resolved[idx];
    const baseName = line.name.split(" - ")[0];
    let pool = await search({ query: baseName, limit: 100 });
    if (pool.length === 0) {
      // Brand-new character name: fall back to a cheap inkable of the deck's ink.
      for (const color of deckInks) {
        pool = await search({ color, inkable: true, type: "Character", maxCost: 3, limit: 100 });
        if (pool.length > 0) break;
      }
    }
    if (pool.length === 0) {
      throw new Error(`deck ${label}: cannot find any substitute for unknown card "${line.name}"`);
    }
    const inInk = pool.filter((c) => deckInks.size === 0 || c.colors.every((col) => deckInks.has(col)));
    if (inInk.length > 0) pool = inInk;
    const fitsCopies = pool.filter((c) => (copies.get(c.id) ?? 0) + line.count <= 4);
    if (fitsCopies.length > 0) pool = fitsCopies;
    const sorted = [...pool].sort((a, b) => {
      const an = a.fullName.toLowerCase().startsWith(baseName.toLowerCase()) ? 0 : 1;
      const bn = b.fullName.toLowerCase().startsWith(baseName.toLowerCase()) ? 0 : 1;
      return (
        an - bn ||
        Number(b.inkable) - Number(a.inkable) ||
        Math.abs(a.cost - 3) - Math.abs(b.cost - 3) ||
        a.id.localeCompare(b.id)
      );
    });
    const sub = sorted[0];
    substitutions.push(
      `"${line.name}" -> "${sub.fullName}" (${sub.id}, cost ${sub.cost}, ${sub.colors.join("/")}${sub.inkable ? ", inkable" : ""})`,
    );
    copies.set(sub.id, (copies.get(sub.id) ?? 0) + line.count);
    resolved[idx] = {
      count: line.count,
      name: sub.fullName,
      cardId: sub.id,
      colors: sub.colors,
      wasSubstituted: line.name,
    };
  }

  if (substitutions.length > 0) {
    log(`[deck ${label}] ${substitutions.length} substitution(s) for unknown cards:`);
    for (const s of substitutions) log(`  ${s}`);
  }

  const rewritten = resolved.map((r) => `${r.count} ${r.name}`).join("\n");
  const res = await client.validateDeck(rewritten);
  if (!res.valid) {
    throw new Error(`deck ${label} is invalid after substitution:\n  ${res.errors.join("\n  ")}`);
  }
  return rewritten;
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------

interface P0Error {
  actor: PlayerId;
  action: PlayerAction;
  error: { code: string; message: string };
  dumpFile: string;
}

interface GameResult {
  game: number;
  matchId: string;
  winner?: PlayerId;
  reason?: string;
  turns: number;
  actions: number;
  failure?: string;
  p0: P0Error[];
}

function sameAction(a: PlayerAction, b: PlayerAction): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function yourTurn(view: PlayerView): boolean {
  return (
    view.phase !== "game-over" &&
    (view.activePlayer === view.you || view.pendingChoice?.player === view.you)
  );
}

function llmOptsFor(args: CliArgs): LlmPolicyOptions {
  return {
    model: args.llmModel,
    temperature: 0.3,
    maxRetries: 1,
    onPrompt: (prompt) => {
      // Useful for debugging LLM decisions; keep quiet unless verbose is desired.
    },
  };
}

async function playGame(
  client: LorcanaClient,
  deckIdA: string,
  deckIdB: string,
  seed: number,
  game: number,
  args: CliArgs,
  log: (msg: string) => void,
): Promise<GameResult> {
  const verbose = args.verbose ?? false;
  const m = await client.createMatch(deckIdA, deckIdB, seed);
  if (verbose) log(`[game ${game}] match ${m.matchId} (seed ${seed}) — spectator ${m.spectatorUrl}`);
  const tokens: Record<PlayerId, string> = { p1: m.tokenP1, p2: m.tokenP2 };
  const views: Partial<Record<PlayerId, GetStateResult>> = {};
  const p0: P0Error[] = [];
  const recentSigs: string[] = [];
  let actions = 0;

  const fresh = async (pid: PlayerId): Promise<GetStateResult> => {
    const s = await client.getState(m.matchId, tokens[pid]);
    views[pid] = s;
    return s;
  };

  while (actions < ACTION_CAP) {
    const s1 = views.p1 ?? (await fresh("p1"));
    const s2 = views.p2 ?? (await fresh("p2"));
    const terminal = [s1.state, s2.state].find((s) => s.phase === "game-over" || s.winner);
    if (terminal) {
      return {
        game, matchId: m.matchId, winner: terminal.winner, reason: terminal.winReason,
        turns: terminal.turn, actions, p0,
      };
    }

    // Actor = a seat with legal actions; prefer the seat whose turn it is, then p1.
    let actor: PlayerId | undefined;
    if (s1.legalActions.length > 0 && (yourTurn(s1.state) || s2.legalActions.length === 0)) actor = "p1";
    else if (s2.legalActions.length > 0) actor = "p2";
    else if (s1.legalActions.length > 0) actor = "p1";
    if (!actor) {
      return {
        game, matchId: m.matchId, turns: s1.state.turn, actions, p0,
        failure: "stall: neither seat has legal actions but the game is not over",
      };
    }

    const seat = actor === "p1" ? s1 : s2;
    const useLlm = args.llmSeat === "both" || args.llmSeat === actor;
    const action = useLlm
      ? await llmChooseAction(seat.state, seat.legalActions, llmOptsFor(args))
      : chooseAction(seat.state, seat.legalActions);
    const legal = seat.legalActions.find((l: LegalAction) => sameAction(l.action, action));
    const description = legal?.description ?? JSON.stringify(action);

    // Repeat guard: a pure policy can in theory loop on a free ability; break
    // out by passing when the identical action repeats too often.
    const sig = `${actor}:${JSON.stringify(action)}`;
    recentSigs.push(sig);
    if (recentSigs.length > 40) recentSigs.shift();
    const repeats = recentSigs.filter((x) => x === sig).length;
    let finalAction = action;
    if (repeats >= 20) {
      const pass = seat.legalActions.find((l) => l.action.type === "PASS");
      if (pass) finalAction = pass.action;
      else {
        return {
          game, matchId: m.matchId, turns: seat.state.turn, actions, p0,
          failure: `policy loop: action repeated ${repeats}x without PASS available: ${description}`,
        };
      }
    }

    if (verbose) log(`[game ${game}] #${actions + 1} ${actor} (turn ${seat.state.turn}): ${description}`);
    const res = await client.playAction(m.matchId, tokens[actor], finalAction);
    actions++;
    if (!res.ok) {
      const dumpFile = `bots-p0-game${game}-action${actions}.json`;
      writeFileSync(
        dumpFile,
        JSON.stringify({ actor, action: finalAction, error: res.error, state: res.state }, null, 2),
      );
      p0.push({ actor, action: finalAction, error: res.error ?? { code: "?", message: "?" }, dumpFile });
      return {
        game, matchId: m.matchId, turns: res.state.turn, actions, p0,
        failure: `INVALID_ACTION (P0 engine bug) — ${res.error?.message ?? "?"}; state dumped to ${dumpFile}`,
      };
    }
    // Fresh view for the actor comes with the response; the other seat's view
    // is stale and must be refetched next iteration.
    views[actor] = {
      state: res.state,
      legalActions: res.legalActions,
      yourTurn: yourTurn(res.state),
    };
    views[actor === "p1" ? "p2" : "p1"] = undefined;
    if (verbose) {
      for (const ev of res.newEvents) log(`    · ${ev.message}`);
    }

    if (args.delay > 0) {
      await sleep(args.delay * 1000);
    }
  }

  const last = views.p1?.state;
  return {
    game, matchId: m.matchId, turns: last?.turn ?? -1, actions, p0,
    failure: `action cap reached (${ACTION_CAP}) without a winner`,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const log = (msg: string) => console.log(msg);
  const client = new LorcanaClient(args.server, {
    onRetry: (tool, attempt, err) => log(`[retry] ${tool} attempt ${attempt} failed: ${String(err)}`),
  });
  await client.connect();
  log(`connected to ${args.server}/mcp`);

  try {
    const deckAText = await ensureValidDeck(client, "A", args.deckA, log);
    const deckBText = await ensureValidDeck(client, "B", args.deckB, log);
    const deckA = await client.importDeck(deckAText, "deckA");
    const deckB = await client.importDeck(deckBText, "deckB");
    log(`imported decks: A=${deckA.deckId} B=${deckB.deckId}`);

    const results: GameResult[] = [];
    for (let g = 1; g <= args.games; g++) {
      const seed = args.seed + (g - 1);
      const r = await playGame(client, deckA.deckId, deckB.deckId, seed, g, args, log);
      results.push(r);
      if (r.failure) {
        log(`game ${g}: FAILURE — ${r.failure}`);
      } else {
        log(`game ${g}: winner=${r.winner} reason=${r.reason} turns=${r.turns} actions=${r.actions}`);
      }
    }

    const wins = { p1: 0, p2: 0 };
    let failures = 0;
    let turnSum = 0;
    let finished = 0;
    for (const r of results) {
      if (r.failure) failures++;
      else if (r.winner) {
        wins[r.winner]++;
        turnSum += r.turns;
        finished++;
      }
    }
    log("");
    log(`=== final score over ${results.length} game(s) ===`);
    log(`deckA (p1): ${wins.p1} win(s) — deckB (p2): ${wins.p2} win(s) — failures: ${failures}`);
    if (finished > 0) log(`average game length: ${(turnSum / finished).toFixed(1)} turns`);
    const allP0 = results.flatMap((r) => r.p0);
    if (allP0.length > 0) {
      log(`P0 INVALID_ACTION errors: ${allP0.length} (see bots-p0-*.json dumps)`);
    }
    return failures > 0 ? 1 : 0;
  } finally {
    await client.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error("fatal:", err instanceof Error ? err.message : err);
    process.exitCode = 2;
  });
