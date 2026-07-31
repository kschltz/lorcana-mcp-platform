# SPEC.md — Lorcana MCP Playtest Platform (single source of truth)

All subagents MUST implement to this spec exactly: module boundaries, file paths, exported
interfaces, and JSON formats are contracts. Do not rename or reshape them. If something is
underspecified, make the smallest reasonable extension and document it in the module README —
never change an existing contract.

## 1. Product summary

A local platform to playtest Disney Lorcana decks via AI-vs-AI matches:

- **AI players** interact exclusively over the **Model Context Protocol (Streamable HTTP
  transport)** using JSON tool calls: manage decks, create matches, read fog-of-war game
  state, enumerate legal actions, and play actions.
- **Humans** get a visual spectator UI (React) showing the same match state with card art.
- The **rules engine** is a full card-text engine: a deterministic TypeScript core plus a
  JSON **effect DSL**; every card has (or can fall back from) a script in this DSL.

## 2. Tech & repo layout

- Node 20+, TypeScript 5.6+ **strict**, ESM (`"type": "module"`), npm workspaces.
- Tests: **vitest** in every package (`npm test -w <pkg>`). Build: `tsc` per package
  (except `ui`, which uses Vite). No network access at engine runtime.
- Engine must be a pure, deterministic library: no I/O, no `Date.now()`/`Math.random()`
  except through the injected seeded RNG.

```
project/
├── package.json                 # npm workspaces root (private, scripts: build/test/dev)
├── tsconfig.base.json
├── data/lorcana_bulk.raw.json   # raw bulk from lorcana-api (committed, 2487 cards)
├── packages/
│   ├── engine/                  # @lorcana/engine — rules engine + effect DSL interpreter
│   │   └── src/ index.ts, types.ts, state.ts, rng.ts, setup.ts, turn.ts, actions.ts,
│   │       legality.ts, keywords.ts, combat.ts, effects/*.ts, cards/registry.ts, serialize.ts
│   ├── card-data/               # @lorcana/card-data — normalize bulk → engine card defs + DSL scripts
│   │   └── src/ normalize.ts, generate-scripts.ts, templates.ts
│   │   └── dist-data/ cards.json, scripts.json      # generated build artifacts
│   ├── mcp-server/              # @lorcana/mcp-server — MCP Streamable HTTP + spectator HTTP/SSE
│   │   └── src/ server.ts, mcp.ts, tools/*.ts, matches.ts, views.ts
│   ├── bots/                    # @lorcana/bots — heuristic MCP client for AI-vs-AI
│   │   └── src/ client.ts, policy.ts, run-match.ts
│   └── ui/                      # React+Vite spectator app
│       └── src/ App.tsx, api.ts, components/*.tsx
└── SPEC.md (this file, copied into repo root)
```

## 3. Engine package (`@lorcana/engine`)

### 3.1 Core types (`types.ts`) — exact contract

```ts
export type PlayerId = "p1" | "p2";
export type InkColor = "Amber"|"Amethyst"|"Emerald"|"Ruby"|"Sapphire"|"Steel";
export type CardType = "Character"|"Action"|"Item"|"Location";
export type Zone = "deck"|"hand"|"inkwell"|"discard"|"play";
export type Keyword =
  | "Rush"|"Evasive"|"Ward"|"Bodyguard"|"Reckless"|"Support"|"Resist"
  | "Challenger"|"Singer"|"Shift"|"Alert"|"Vanish"|"Boost"; // parameterized where noted

export interface CardDefinition {          // static card data (from card-data pkg)
  id: string;                              // Unique_ID, e.g. "ARI-001"
  name: string;                            // "Rhino"
  subtitle?: string;                       // "Motivational Speaker"
  fullName: string;                        // "Rhino - Motivational Speaker"
  type: CardType;
  colors: InkColor[];                      // dual-ink supported (1–2 entries)
  cost: number;
  inkable: boolean;
  strength?: number; willpower?: number; lore?: number; moveCost?: number;
  classifications: string[];
  bodyText: string;
  rarity: string; setId: string; setNum: number; cardNum: number;
  imageUrl: string;
}

export interface CardInstance {
  instanceId: string;                      // unique per match: "m1-0001"
  cardId: string;
  owner: PlayerId;
  zone: Zone;
  // in-play state (meaningful only when zone==="play"):
  exerted: boolean;
  damage: number;
  enteredTurn: number;                     // turn number when put into play (wet ink)
  shiftedOnto?: string;                    // instanceId this card was shifted onto (stack)
  under?: string[];                        // instanceIds stacked below (shift stack)
  modifiers: Modifier[];                   // active stat/keyword modifiers
}

export interface Modifier {
  id: string;                              // for removal/tracing
  source: string;                          // instanceId that applied it
  duration: "this-turn"|"while-in-play"|"permanent";
  stat?: { strength?: number; willpower?: number; lore?: number };
  grantKeywords?: Keyword[];
  removeKeywords?: Keyword[];
  resist?: number;                         // damage reduction (Resist N)
  cantQuest?: boolean; cantChallenge?: boolean; cantReady?: boolean;
  singerAs?: number;                       // Singer N: counts as cost N for songs
  condition?: string;                      // DSL expression id, optional
}

export interface PlayerState {
  id: PlayerId;
  deck: CardInstance[]; hand: CardInstance[]; inkwell: CardInstance[];
  discard: CardInstance[]; play: CardInstance[];   // play = characters+items+locations
  lore: number;
  inkPlayedThisTurn: number;
  mulliganDone: boolean;
}

export interface PendingChoice {           // engine waits on a decision
  id: string;
  player: PlayerId;                        // who must choose
  kind: "choose-target"|"choose-option"|"choose-cards"|"order-cards";
  prompt: string;
  options: ChoiceOption[];                 // see actions.ts contract
  min: number; max: number;                // how many to pick
}
export interface ChoiceOption { id: string; label: string; cardInstanceId?: string; }

export interface GameEvent {               // appended to log, shown in UI
  turn: number; seq: number; type: string; player?: PlayerId;
  message: string; data?: Record<string, unknown>;
}

export interface GameState {
  matchId: string;
  turn: number;                            // increments each time priority passes to p1
  activePlayer: PlayerId;
  phase: "setup"|"mulligan"|"main"|"game-over";
  players: Record<PlayerId, PlayerState>;
  pendingChoice?: PendingChoice;
  winner?: PlayerId;
  winReason?: "lore"|"deck-out"|"concede";
  log: GameEvent[];
  rngState: number;                        // serialized mulberry32 state (determinism)
}
```

### 3.2 Public engine API (`index.ts`) — exact contract

```ts
export interface CreateGameOptions {
  matchId: string; seed: number;
  deckA: string[]; deckB: string[];        // 60 cardIds each
  registry: CardRegistry;
}
export interface ActionResult {
  ok: boolean; error?: string;
  state: GameState;                        // post-action state (or unchanged on error)
  newEvents: GameEvent[];                  // events produced by this call
}

export class GameEngine {
  constructor(opts: CreateGameOptions);    // shuffles, draws 7 each, phase="mulligan"
  getState(): GameState;                   // deep copy, safe to serialize
  getLegalActions(player: PlayerId): LegalAction[];
  applyAction(player: PlayerId, action: PlayerAction): ActionResult;
  static replay(actions: {player: PlayerId; action: PlayerAction}[],
                opts: CreateGameOptions): GameState;  // for tests
}

export type PlayerAction =
  | { type: "MULLIGAN"; keep: string[] }                       // instanceIds to keep; rest shuffled back, redraw to 7
  | { type: "PLAY_INK"; cardInstanceId: string }
  | { type: "PLAY_CARD"; cardInstanceId: string; choices?: PlayChoices }
  | { type: "QUEST"; characterId: string }
  | { type: "CHALLENGE"; attackerId: string; defenderId: string }   // defender: character or location
  | { type: "ACTIVATE_ABILITY"; cardInstanceId: string; abilityIndex: number; choices?: PlayChoices }
  | { type: "MOVE_TO_LOCATION"; characterId: string; locationId: string }
  | { type: "RESOLVE_CHOICE"; choiceId: string; selected: string[] }  // option ids
  | { type: "PASS" };

export interface PlayChoices { targets?: string[]; options?: string[]; payAlternatives?: Record<string,string>; }

export interface LegalAction {             // fully enumerated, AI-friendly
  action: PlayerAction;                    // ready to submit as-is
  description: string;                     // human/LLM readable
}
```

`getLegalActions` must return **fully expanded** actions: e.g. one CHALLENGE entry per legal
attacker/defender pair, one PLAY_CARD per payable card (with `choices` left empty only when the
card needs no decisions), and the RESOLVE_CHOICE option sets when a PendingChoice exists (in
which case ONLY RESOLVE_CHOICE actions are legal).

### 3.3 Rules implemented (turn 1 differences, wins/losses)

- Deck: 60 cards, ≤ 2 ink colors (Core), ≤ 4 copies of a card (validated by card-data/server, engine assumes legal decks).
- Setup: shuffle (seeded), draw 7; mulligan once (any number, shuffle back, redraw same count, then keep).
- Turn structure per player: **Ready step** (ready all exerted cards; "start of turn" triggers;
  locations grant their lore to controller), **Draw step** (draw 1; the player who takes the
  very first turn of the game skips this draw), **Main phase** (free actions), then pass.
- Inkwell: once per turn, put an **inkable** card from hand face-down into inkwell. Ink =
  count of inkwell cards; playing a card/activating costs requires exerting that much ink
  (track `inkUsedThisTurn` or equivalent — expose remaining ink in state views).
- Play card: pay cost; Characters enter play exerted-irrelevant but "wet" (can't quest/challenge
  the turn they enter unless Rush for challenges); Actions resolve effects then go to discard;
  Songs (classification "Song") may alternatively be **sung**: exert a ready character whose
  cost ≥ song cost (or whose `singerAs` ≥ cost) to play it free; Items/Locations stay in play.
- Quest: exert a ready, dry character → gain lore equal to its (modified) lore value.
- Challenge: exert a ready, dry (or Rush) character to challenge an **exerted** opposing
  character (or one with valid keywords: Alert allows challenging ready characters; Evasive
  can only be challenged by Evasive; Bodyguard must be challenged before non-Bodyguards;
  Reckless can't quest and must challenge if able). Both deal damage = effective strength
  (+Challenger N for attacker while attacking, +Support donated strength) simultaneously;
  Resist N reduces damage received; character banished when damage ≥ willpower → discard.
  Locations may be challenged (they don't deal damage back); location banished at damage ≥ willpower.
- Move to location: pay move cost (ink), move character.
- Shift N: play a Floodborn on top of a matching named character for the shift cost; the stack
  keeps the lower cards (`under`), inherits damage/exertion, top card defines stats.
- Win: first to **20 lore** (checked immediately when lore changes). Loss: must draw from
  empty deck → opponent wins (`deck-out`). Concede supported.
- Keyword reminder semantics: Ward = opponent's effects can't choose it; Vanish = when chosen
  by opponent's effect, banish it; Boost N = once during your turn, pay N ink to put
  the top card of your deck facedown under this character (activated ability)
  (store in `under`); Support = when it quests, may add its strength to another character
  this turn (model as CHOICE + modifier); Resist/Challenger/Singer carry an N parsed from text.
- Triggered abilities: ON_PLAY (when played), ON_QUEST, ON_CHALLENGE_BANISH (when this
  banishes a character in a challenge), ON_BANISH (when this is banished), START_OF_TURN,
  END_OF_TURN, ON_OPPONENT_PLAY etc. Continuous abilities (static modifiers) via
  `CONTINUOUS` effect blocks with a `condition` + `selector`.

### 3.4 Determinism & serialization
- `rng.ts`: mulberry32, serializable state (single uint32). All randomness (shuffle, random
  selection) flows through it.
- `serialize.ts`: `serializeState`/`deserializeState` lossless JSON round-trip (used by
  server persistence and replay tests).

### 3.5 Required tests (engine)
- setup/mulligan sizes; inkwell once-per-turn & inkable-only; wet-ink quest/challenge
  restriction + Rush exception; challenge math incl. Challenger/Support/Resist/Evasive/
  Bodyguard/Reckless/Alert; shift stacking; songs sung vs paid; 20-lore win; deck-out loss;
  determinism: same seed + same action list → identical serialized state (replay test);
  every card script in the registry loads without interpreter errors (schema validation test).

## 4. Effect DSL (`packages/engine/src/effects/`)

Cards never contain code. Each card has a JSON **script** (`scripts.json`, keyed by cardId):

```ts
export interface CardScript {
  cardId: string;
  keywords?: { name: Keyword; value?: number }[];     // e.g. {name:"Resist",value:2}
  shiftCost?: number;
  triggered?: TriggeredAbility[];
  activated?: ActivatedAbility[];
  continuous?: ContinuousAbility[];
}
export interface TriggeredAbility { name?: string; trigger: Trigger; effects: EffectNode[]; }
export interface ActivatedAbility { name?: string; cost: AbilityCost; effects: EffectNode[];
                                    oncePerTurn?: boolean; }
export interface ContinuousAbility { name?: string; selector: Selector; modifier: Omit<Modifier,"id"|"source">; condition?: Condition; }
export type Trigger = "ON_PLAY"|"ON_QUEST"|"ON_CHALLENGE_BANISH"|"ON_BANISH"
                    |"START_OF_TURN"|"END_OF_TURN"|"ON_OPPONENT_PLAY"|"ON_PLAY_CHARACTER";
export interface AbilityCost { ink?: number; exert?: boolean; discard?: number; banishSelf?: boolean; }
```

**EffectNode vocabulary** (interpreter must implement all):
`DRAW{amount}`, `DEAL_DAMAGE{amount,target}`, `REMOVE_DAMAGE{amount,target}`,
`GAIN_LORE{amount}` (controller), `OPPONENT_LOSE_LORE{amount}`, `BANISH{target}`,
`RETURN_TO_HAND{target}`, `EXERT{target}`, `READY{target}`, `ADD_MODIFIER{target,modifier,duration}`,
`GRANT_KEYWORD{target,keyword,value?}`, `DISCARD{amount,who:"self"|"opponent",mode:"random"|"chosen"}`,
`LOOK_TOP{amount,then:"keep-order"|"bottom-rest"|"choose-into-hand"}`,
`PUT_INTO_INKWELL{source:"top-deck"|target}`, `SEARCH_DECK{filter,into:"hand"|"play"}`,
`PLAY_CARD_FREE{filter}`, `MOVE_DAMAGE{amount,from,to}`, `PREVENT_DAMAGE{amount,target,duration}`,
`CHOICE{prompt,options:EffectNode[][],min,max,target?}` (creates PendingChoice; chosen branch runs),
`FOR_EACH{selector,effects}`, `IF{condition,then,else}`.

**Selector** (target queries; resolved against game state):
```ts
{ zone:"play"|"hand"|"discard", who:"self"|"opponent"|"any",
  type?: CardType, classification?: string, name?: string,
  filter?: "exerted"|"ready"|"damaged"|"undamaged"|"wet",
  chosen?: boolean }        // chosen:true → ask player to pick (PendingChoice)
```
**Condition**: `{ kind:"count", selector, op:">="|"<="|"==", value }` |
`{kind:"has-keyword", selector, keyword}` | `{kind:"stat", selector, stat:"strength"|"willpower"|"lore", op, value}`.

Interpreter rules: effects execute atomically in order; any effect needing a decision
suspends resolution into `PendingChoice`; after RESOLVE_CHOICE the continuation runs.
All legality/targeting validation happens in `legality.ts`, not the interpreter.

## 5. Card-data package (`@lorcana/card-data`)

- `normalize.ts`: read `data/lorcana_bulk.raw.json` → `dist-data/cards.json`:
  `CardDefinition[]` per §3.1 (split dual-ink `Color` on ",", parse `{s}{w}{l}{d}{i}`
  symbols are kept raw in `bodyText`; only Lorcana gamemode cards; skip Illumineer's Quest).
- `generate-scripts.ts`: produce `dist-data/scripts.json` (`Record<cardId, CardScript>`):
  1. Parse keywords from Body_Text headers (e.g. "**Rush**", "**Resist** +2", "**Challenger** +3",
     "**Shift** 3", "**Singer** 5", "**Evasive**", "**Ward**", "**Bodyguard**", "**Support**",
     "**Reckless**", "**Alert**", "**Vanish**", "**Boost** 1") → `keywords` + `shiftCost`.
  2. Template-match common ability sentences into EffectNodes (draw N; deal N damage; gain N lore;
     banish chosen X; return to hand; ready/exert; +N {s}/{w}/{l} modifiers; opponent discards;
     look at top N; put into inkwell; each-other-character continuous buffs). Templates live in
     `templates.ts` with regex + builder per pattern.
  3. **Coverage tiers**: `tier:"full"` = every sentence translated; `tier:"partial"` = keywords +
     some abilities; `tier:"vanilla"` = stats only. Emit a `coverage.json` report. Vanilla cards
      remain playable (stats/keywords only). Target: 100% of cards load; ≥60% of non-vanilla
     Body_Text lines template-matched.
- CLI: `npm run build-data -w @lorcana/card-data` regenerates all three artifacts.

## 6. MCP server (`@lorcana/mcp-server`)

- Uses `@modelcontextprotocol/sdk` (latest) with **StreamableHTTPServerTransport** at
  `POST/GET/DELETE /mcp`. Express 4 server, JSON only, CORS open (local use).
- Match registry (`matches.ts`): in-memory Map + JSON file persistence to `data/matches/`
  (state serialized via engine serialize.ts after every action — crash-resumable).
- **Fog of war** (`views.ts`): `playerView(state, player)` — hides opponent hand/deck/inkwell
  identities (counts only); `spectatorView(state)` — full state incl. card defs + image URLs.
- Error format for all tools: `{ ok:false, error:{ code:string, message:string } }`.

### MCP tools (exact names + schemas)

| Tool | Input | Output |
|---|---|---|
| `lorcana_search_cards` | `{ query?: string, color?: string, type?: string, inkable?: boolean, maxCost?: number, limit?: number }` | `{ cards: CardSummary[] }` (id, fullName, cost, colors, type, stats, inkable, bodyText, imageUrl) |
| `lorcana_get_card` | `{ cardId: string }` | `{ card: CardDefinition, script: CardScript, scriptTier: string }` |
| `lorcana_validate_deck` | `{ decklistText: string }` | `{ valid: boolean, errors: string[], deck: {cardId,count}[] }` — parses dreamborn/inktable text format `4 Name - Subtitle`; checks 60 cards, ≤2 inks, ≤4 copies, unknown cards |
| `lorcana_import_deck` | `{ decklistText: string, name?: string }` | `{ deckId: string, deck: {cardId,count}[] }` |
| `lorcana_create_match` | `{ deckIdA: string, deckIdB: string, seed?: number }` | `{ matchId: string, tokenP1: string, tokenP2: string, spectatorUrl: string }` |
| `lorcana_get_state` | `{ matchId: string, token: string }` | `{ state: PlayerView, legalActions: LegalAction[], yourTurn: boolean }` |
| `lorcana_get_legal_actions` | `{ matchId: string, token: string }` | `{ legalActions: LegalAction[] }` |
| `lorcana_play_action` | `{ matchId: string, token: string, action: PlayerAction }` | `{ ok, error?, state: PlayerView, legalActions: LegalAction[], newEvents: GameEvent[] }` |
| `lorcana_concede` | `{ matchId: string, token: string }` | `{ ok: true }` |

Tokens: random 16-hex per seat, gate every state/action call (p1 token can't act for p2).

### Spectator HTTP (same Express server, for the UI + humans)
- `GET /api/matches` → live/finished matches w/ scores.
- `GET /api/matches/:id/state` → spectatorView (full).
- `GET /api/matches/:id/stream` → SSE, pushes spectatorView after every action.
- `GET /api/cards/:cardId/image` → redirect/proxy to imageUrl (UI convenience).
- Serves `packages/ui/dist` statically at `/` in production mode.

## 7. UI (`packages/ui`, React 18 + Vite + TS, no extra design libs required)

Pages/components (react-router not required — single page with match picker):
- **Lobby**: list matches from `/api/matches`, click to spectate.
- **Board** (subscribes SSE): two player areas (opponent top, player bottom) — hand count,
  inkwell (face-down stack + count), lore counter (prominent, /20), discard (top card art),
  play area rows: characters (with damage pips, exerted = rotated 90°, wet-ink marker,
  keyword chips), items/locations row. Card art from imageUrl; hover → full-size card tooltip
  with body text. Center: turn/phase indicator + event **log panel** (scrolling, newest last).
- Replay controls optional (prev/next through stored log states) — nice-to-have, not required.
- Design: dark "ink" theme, low saturation, card-forward. Must be readable as a spectator
  broadcast. No gameplay input — humans only watch.
- During development, UI must run against `GET /api/...` of a locally started server; provide
  `src/mock.ts` with a static spectatorView fixture so the UI builds standalone (`npm run dev`).

## 8. Bots (`@lorcana/bots`)

- MCP **client** over Streamable HTTP (`@modelcontextprotocol/sdk` client) — plays exclusively
  through the MCP tools (this is also the compliance proof).
- `policy.ts` heuristic: mulligan keep ≤ cost-3 inkables + curve; always ink highest-cost
  inkable if ink/turn left; play affordable cards by priority (draw/removal > on-curve
  characters > items/actions); quest with all safe questers; challenge only favorable trades
  (banish + survive, or remove high-lore threats); use activated abilities when free value.
- CLI `npm run match -w @lorcana/bots -- --server http://localhost:8787 --deckA "<text>" --deckB "<text>" --games 4 --verbose`
  → creates match, both seats driven by the policy, prints per-game result + final score.
- Bot-vs-bot must complete a real game in ≤ ~400 actions without illegal-action errors;
  any engine error from a legal action is a P0 bug.

## 9. Integration & acceptance

- Root scripts: `npm run build` (all), `npm test` (all), `npm run dev` (server + UI watch),
  `npm start` (serve UI + MCP on :8787).
- Acceptance checklist: all package tests green; `bots` plays 4 full AI-vs-AI games with two
  real meta decklists (e.g. from dreamborn) end-to-end over MCP; UI shows live board updating
  during the bot match; a human can reproduce an MCP session with `curl`/MCP inspector.
- README.md at repo root: quickstart (build → start → run AI match → open spectator URL →
  connect an MCP client), tool reference, DSL authoring guide, known rules limitations.
