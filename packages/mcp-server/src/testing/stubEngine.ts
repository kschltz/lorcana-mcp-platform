/**
 * testing/stubEngine.ts — minimal in-memory engine conforming to the SPEC §3.2
 * GameEngine interface, used ONLY for tests and for running the server before
 * `@lorcana/engine` is merged. It implements a small scripted subset of the
 * rules (mulligan, inkwell, play characters, quest, pass/turn cycle, 20-lore
 * win, deck-out loss) deterministically via a seeded mulberry32 — enough to
 * exercise tools, fog-of-war views, SSE and persistence/replay end-to-end.
 *
 * NOT a rules engine: challenge/shift/songs/abilities intentionally return
 * errors. Swap for the real GameEngine at integration time (see server.ts).
 */
import type {
  ActionResult,
  CardInstance,
  CreateGameOptions,
  EngineFactory,
  EngineLike,
  GameEvent,
  GameState,
  LegalAction,
  PlayerAction,
  PlayerId,
  PlayerState,
} from "../contracts.js";

/** mulberry32 — same PRNG family the real engine uses (SPEC §3.4). */
function mulberry32(seed: number): { next(): number; state(): number; setState(s: number): void } {
  let a = seed >>> 0;
  return {
    next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    state: () => a >>> 0,
    setState(s: number) {
      a = s >>> 0;
    },
  };
}

interface StubPlayerState extends PlayerState {
  inkUsedThisTurn: number;
}

export class StubEngine implements EngineLike {
  /** EngineFactory entry point (matches MatchRegistryOptions.engineFactory). */
  static factory(): EngineFactory {
    return (opts) => new StubEngine(opts);
  }

  private state: GameState & { players: Record<PlayerId, StubPlayerState> };
  private readonly registry: CreateGameOptions["registry"];
  private readonly rng: ReturnType<typeof mulberry32>;
  private seq = 0;
  private emitted: GameEvent[] = [];

  constructor(opts: CreateGameOptions) {
    this.registry = opts.registry;
    this.rng = mulberry32(opts.seed);

    const build = (cardIds: string[], owner: PlayerId, prefix: string): CardInstance[] =>
      cardIds.map((cardId, i) => ({
        instanceId: `${opts.matchId}-${prefix}${String(i).padStart(4, "0")}`,
        cardId,
        owner,
        zone: "deck" as const,
        exerted: false,
        damage: 0,
        enteredTurn: 0,
        modifiers: [],
      }));

    const deckA = this.shuffle(build(opts.deckA, "p1", "a"));
    const deckB = this.shuffle(build(opts.deckB, "p2", "b"));

    const player = (id: PlayerId, deck: CardInstance[]): StubPlayerState => ({
      id,
      deck,
      hand: [],
      inkwell: [],
      discard: [],
      play: [],
      lore: 0,
      inkPlayedThisTurn: 0,
      mulliganDone: false,
      inkUsedThisTurn: 0,
    });

    this.state = {
      matchId: opts.matchId,
      turn: 1,
      activePlayer: "p1",
      phase: "mulligan",
      players: { p1: player("p1", deckA), p2: player("p2", deckB) },
      log: [],
      rngState: this.rng.state(),
    };
    this.draw("p1", 7);
    this.draw("p2", 7);
    this.event("setup", undefined, `match ${opts.matchId} created (stub engine)`);
  }

  static replay(
    actions: { player: PlayerId; action: PlayerAction }[],
    opts: CreateGameOptions,
  ): GameState {
    const engine = new StubEngine(opts);
    for (const { player, action } of actions) {
      const r = engine.applyAction(player, action);
      if (!r.ok) throw new Error(`stub replay failed: ${r.error}`);
    }
    return engine.getState();
  }

  getState(): GameState {
    return structuredClone(this.state);
  }

  getLegalActions(player: PlayerId): LegalAction[] {
    const s = this.state;
    if (s.phase === "game-over") return [];
    const ps = s.players[player];
    const out: LegalAction[] = [];

    // Mulligans happen "simultaneously": either player may mulligan during the
    // mulligan phase regardless of who the active player is.
    if (s.phase === "mulligan") {
      if (!ps.mulliganDone) {
        out.push(
          { action: { type: "MULLIGAN", keep: ps.hand.map((c) => c.instanceId) }, description: "Keep your whole hand" },
          { action: { type: "MULLIGAN", keep: [] }, description: "Mulligan your whole hand" },
        );
      }
      return out;
    }

    if (player !== s.activePlayer) return [];

    // phase === "main"
    if (ps.inkPlayedThisTurn === 0) {
      for (const c of ps.hand) {
        if (this.registry.get(c.cardId)?.inkable) {
          out.push({
            action: { type: "PLAY_INK", cardInstanceId: c.instanceId },
            description: `Put ${c.cardId} into your inkwell`,
          });
        }
      }
    }
    const inkAvailable = ps.inkwell.length - ps.inkUsedThisTurn;
    for (const c of ps.hand) {
      const def = this.registry.get(c.cardId);
      if (def && def.cost <= inkAvailable) {
        out.push({
          action: { type: "PLAY_CARD", cardInstanceId: c.instanceId },
          description: `Play ${def.fullName} (cost ${def.cost})`,
        });
      }
    }
    for (const c of ps.play) {
      const def = this.registry.get(c.cardId);
      if (def?.type === "Character" && !c.exerted && c.enteredTurn < s.turn) {
        out.push({
          action: { type: "QUEST", characterId: c.instanceId },
          description: `Quest with ${def.fullName} (+${def.lore ?? 1} lore)`,
        });
      }
    }
    out.push({ action: { type: "PASS" }, description: "End your turn" });
    return out;
  }

  applyAction(player: PlayerId, action: PlayerAction): ActionResult {
    this.emitted = [];
    const fail = (error: string): ActionResult => ({
      ok: false,
      error,
      state: this.getState(),
      newEvents: [],
    });
    const s = this.state;
    if (s.phase === "game-over") return fail("the game is over");
    const isMulliganWindow = s.phase === "mulligan" && action.type === "MULLIGAN";
    if (!isMulliganWindow && player !== s.activePlayer) {
      return fail(`not your turn (active player is ${s.activePlayer})`);
    }
    const ps = s.players[player];

    switch (action.type) {
      case "MULLIGAN": {
        if (s.phase !== "mulligan" || ps.mulliganDone) return fail("mulligan is not available now");
        const handIds = new Set(ps.hand.map((c) => c.instanceId));
        if (!action.keep.every((id) => handIds.has(id))) return fail("keep contains cards not in hand");
        const keep = new Set(action.keep);
        const returned = ps.hand.filter((c) => !keep.has(c.instanceId));
        ps.hand = ps.hand.filter((c) => keep.has(c.instanceId));
        for (const c of returned) c.zone = "deck";
        ps.deck = this.shuffle([...ps.deck, ...returned]);
        this.draw(player, returned.length);
        ps.mulliganDone = true;
        this.event("mulligan", player, `${player} mulliganed ${returned.length} card(s)`);
        if (s.players.p1.mulliganDone && s.players.p2.mulliganDone) {
          s.phase = "main";
          // The player taking the very first turn skips their first draw;
          // setup already dealt the opening hands, so nothing to do here.
          this.event("phase", undefined, "mulligans complete — main phase begins");
        }
        break;
      }
      case "PLAY_INK": {
        if (s.phase !== "main") return fail("not in main phase");
        if (ps.inkPlayedThisTurn > 0) return fail("already played ink this turn");
        const idx = ps.hand.findIndex((c) => c.instanceId === action.cardInstanceId);
        if (idx < 0) return fail("card not in hand");
        const card = ps.hand[idx];
        if (!this.registry.get(card.cardId)?.inkable) return fail("card is not inkable");
        ps.hand.splice(idx, 1);
        card.zone = "inkwell";
        ps.inkwell.push(card);
        ps.inkPlayedThisTurn = 1;
        this.event("ink", player, `${player} put a card into their inkwell`);
        break;
      }
      case "PLAY_CARD": {
        if (s.phase !== "main") return fail("not in main phase");
        const idx = ps.hand.findIndex((c) => c.instanceId === action.cardInstanceId);
        if (idx < 0) return fail("card not in hand");
        const card = ps.hand[idx];
        const def = this.registry.get(card.cardId);
        if (!def) return fail(`unknown card ${card.cardId}`);
        const inkAvailable = ps.inkwell.length - ps.inkUsedThisTurn;
        if (def.cost > inkAvailable) return fail(`not enough ink (need ${def.cost}, have ${inkAvailable})`);
        ps.inkUsedThisTurn += def.cost;
        ps.hand.splice(idx, 1);
        if (def.type === "Character" || def.type === "Item" || def.type === "Location") {
          card.zone = "play";
          card.enteredTurn = s.turn;
          ps.play.push(card);
          this.event("play", player, `${player} played ${def.fullName}`);
        } else {
          card.zone = "discard";
          ps.discard.push(card);
          this.event("play", player, `${player} played ${def.fullName} (action → discard)`);
        }
        break;
      }
      case "QUEST": {
        if (s.phase !== "main") return fail("not in main phase");
        const card = ps.play.find((c) => c.instanceId === action.characterId);
        if (!card) return fail("character not in play");
        const def = this.registry.get(card.cardId);
        if (def?.type !== "Character") return fail("only characters can quest");
        if (card.exerted) return fail("character is exerted");
        if (card.enteredTurn >= s.turn) return fail("character has wet ink (entered this turn)");
        card.exerted = true;
        const gained = def.lore ?? 1;
        ps.lore += gained;
        this.event("quest", player, `${player} quested with ${def.fullName} (+${gained} lore, total ${ps.lore})`);
        if (ps.lore >= 20) {
          s.phase = "game-over";
          s.winner = player;
          s.winReason = "lore";
          this.event("game-over", player, `${player} wins with ${ps.lore} lore`);
        }
        break;
      }
      case "PASS": {
        if (s.phase !== "main") return fail("finish your mulligan first");
        this.endTurn(player);
        break;
      }
      default:
        return fail(`action ${action.type} is not supported by the stub engine`);
    }

    s.rngState = this.rng.state();
    return { ok: true, state: this.getState(), newEvents: [...this.emitted] };
  }

  private endTurn(player: PlayerId): void {
    const s = this.state;
    const next: PlayerId = player === "p1" ? "p2" : "p1";
    s.activePlayer = next;
    if (next === "p1") s.turn += 1;
    const ps = s.players[next] as StubPlayerState;
    for (const c of [...ps.play, ...ps.inkwell]) c.exerted = false;
    ps.inkPlayedThisTurn = 0;
    ps.inkUsedThisTurn = 0;
    this.event("pass", player, `${player} passed — ${next}'s turn ${s.turn}`);
    // Draw step (the very first turn of the game was skipped by construction).
    if (ps.deck.length === 0) {
      s.phase = "game-over";
      s.winner = player;
      s.winReason = "deck-out";
      this.event("game-over", player, `${next} must draw from an empty deck — ${player} wins (deck-out)`);
    } else {
      this.draw(next, 1);
      this.event("draw", next, `${next} drew a card`);
    }
  }

  private draw(player: PlayerId, n: number): void {
    const ps = this.state.players[player];
    for (let i = 0; i < n && ps.deck.length > 0; i++) {
      const card = ps.deck.shift()!;
      card.zone = "hand";
      ps.hand.push(card);
    }
  }

  private shuffle(cards: CardInstance[]): CardInstance[] {
    const arr = [...cards];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  private event(type: string, player: PlayerId | undefined, message: string): void {
    const e: GameEvent = { turn: this.state?.turn ?? 1, seq: ++this.seq, type, message };
    if (player !== undefined) e.player = player;
    this.state.log.push(e);
    this.emitted.push(e);
  }
}
