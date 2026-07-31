# @lorcana/mcp-server

MCP (Model Context Protocol) Streamable HTTP server + spectator HTTP/SSE API for
the Lorcana playtest platform. Implements SPEC §6 exactly: 9 MCP tools, fog-of-war
player views, full spectator views, match persistence, seat-token gating.

## Run

```bash
npm run build -w @lorcana/mcp-server
npm start                       # or: npm run dev -w @lorcana/mcp-server
# MCP:      POST/GET/DELETE http://localhost:8787/mcp
# Spectate: http://localhost:8787/#/match/<matchId>
```

Env: `PORT` (default 8787), `LORCANA_DATA_DIR` (match/deck persistence, default
`packages/mcp-server/data`), `LORCANA_CARDS_PATH` / `LORCANA_SCRIPTS_PATH` /
`LORCANA_COVERAGE_PATH` (override card-data artifact locations),
`LORCANA_ENGINE_MODULE` (override engine module specifier).

## Layout

- `src/contracts.ts` — verbatim SPEC §3.1/§3.2/§4 type shapes + `EngineLike`/
  `EngineFactory`. **Integration seam:** until `@lorcana/engine` is merged this
  package compiles against these local declarations; swap the imports for
  `@lorcana/engine` / `@lorcana/card-data` at integration time.
- `src/cards.ts` — loads `packages/card-data/dist-data/{cards,scripts,coverage}.json`.
- `src/views.ts` — `playerView(state, player)` (opponent hand/deck/inkwell =
  counts only), `spectatorView(state)` (hands/inkwells as face-down backs with
  instanceIds; discard/play enriched with full `card: CardDefinition` incl. imageUrl).
- `src/matches.ts` — match registry, 16-hex seat tokens, JSON persistence +
  replay-on-load recovery, concede overlay.
- `src/tools/{cards,decks,match}.ts` — the 9 MCP tools.
- `src/mcp.ts` — `McpServer` + `StreamableHTTPServerTransport` session router.
- `src/server.ts` — Express app (MCP + `/api/*` + SSE + static UI) and entrypoint.
- `src/testing/stubEngine.ts` — deterministic in-memory engine subset used by
  tests and as runtime fallback until the real engine lands.

## Documented extensions to SPEC (smallest reasonable, per SPEC preamble)

1. **Concede**: `PlayerAction` has no CONCEDE variant (SPEC §3.2), so
   `lorcana_concede` is a server-level overlay: the registry records
   `concededBy` in the persisted match record and projects
   `phase="game-over"`, `winner=<opponent>`, `winReason="concede"` onto all
   state reads; further actions are rejected with code `GAME_OVER`.
2. **Engine fallback**: `server.ts` dynamically imports `@lorcana/engine` (or
   `LORCANA_ENGINE_MODULE`); when unavailable it warns and uses `StubEngine`
   (mulligan/inkwell/play/quest/pass/20-lore/deck-out only). Tests always use
   the stub. `StubEngine` additionally tracks `inkUsedThisTurn` on player
   state, which views surface as `inkAvailable` (SPEC §3.3 "expose remaining
   ink in state views").
3. **Persistence format**: `data/matches/<matchId>.json` stores creation
   options, seat tokens, the ordered successful-action history, and
   `concededBy`; recovery replays the history through the engine factory
   (equivalent to `GameEngine.replay`, SPEC §3.2). Decks persist to
   `data/decks/<deckId>.json`.
4. **Error codes**: `NOT_FOUND`, `FORBIDDEN` (wrong seat token),
   `VALIDATION_FAILED`, `INVALID_ACTION` (engine rule violation),
   `GAME_OVER`, `INTERNAL`. `lorcana_play_action` rule failures return the
   SPEC envelope plus the unchanged `state`/`legalActions`/`newEvents` fields
   and `isError: true`.
5. **View shapes**: hidden zones are `{ count: number }`; spectator hands and
   inkwells are arrays of `{ instanceId, owner, zone, facedown: true }` backs;
   visible instances are the engine `CardInstance` plus `card: CardDefinition`.
   `playerView.pendingChoice` is included only when the viewing player must
   choose. Ink totals are public in every view.
6. **Deck parsing**: lines are `<count> <name>` matched case-insensitively
   against `fullName` first, then base name when unambiguous; ambiguous base
   names and unparseable lines are validation errors.

## Tests

```bash
npm test -w @lorcana/mcp-server
```

33 tests: deck parsing/validation (good, 59 cards, 3 inks, 5 copies, unknown
card, unparseable lines, persistence), token gating (`FORBIDDEN`), fog-of-war
player/spectator views, match persistence kill+reload round-trip, MCP tool
listing (all 9 names via in-memory SDK client), full MCP-over-HTTP session
semantics (initialize → tools/list → DELETE), spectator REST + SSE push,
image redirect. Uses `@modelcontextprotocol/sdk` 1.30.x.
