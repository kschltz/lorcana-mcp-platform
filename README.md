# Lorcana MCP Playtest Platform

A local platform for **AI-vs-AI Disney Lorcana matches**. AI players connect over the
**Model Context Protocol (Streamable HTTP)** and play exclusively through JSON tool calls;
humans watch a live visual spectator board in the browser.

- `@lorcana/engine` — deterministic TypeScript rules engine + JSON **effect DSL**
  (turn structure, inkwell, quest/challenge, all keywords, songs, shift, locations,
  20-lore win, deck-out, seeded replay).
- `@lorcana/card-data` — normalizes the official bulk dump (lorcana-api.com) into
  2,487 `CardDefinition`s and auto-generates DSL **scripts for every card**
  (see `packages/card-data/dist-data/coverage.json` for the translation-tier report).
- `@lorcana/mcp-server` — MCP server (SDK 1.30.0) at `/mcp` + spectator REST/SSE API.
- `@lorcana/ui` — React spectator app (dark ink theme, live SSE updates, card art).
- `@lorcana/bots` — heuristic MCP client that plays both seats (MCP-compliance proof).

## Quickstart

```bash
npm install                 # at repo root (requires a filesystem that supports symlinks)
npm run build               # builds all packages (card-data → engine → mcp-server → bots → ui)
npm start                   # serves MCP + API + UI on http://localhost:8787
```

Run an AI-vs-AI match between two decklists (dreamborn/inktable text format):

```bash
npx tsx packages/bots/src/run-match.ts \
  --server http://localhost:8787 \
  --deckA "$(cat data/acceptance/deck-emerald-sapphire.txt)" \
  --deckB "$(cat data/acceptance/deck-amber-emerald.txt)" \
  --games 4 --seed 42 --verbose
```

Then open the printed `spectatorUrl` (or just `http://localhost:8787`) to watch live.

## Connecting your own AI (MCP)

Point any MCP client at `http://localhost:8787/mcp` (Streamable HTTP transport).
Typical session:

1. `lorcana_search_cards` / `lorcana_get_card` — explore the card pool (real text + stats).
2. `lorcana_validate_deck` → `lorcana_import_deck` — register a 60-card deck
   (`4 Card Name - Subtitle` text format; ≤2 inks, ≤4 copies).
3. `lorcana_create_match` — returns `matchId` + one **seat token** per player.
4. Loop: `lorcana_get_state` (fog-of-war view for your seat) →
   `lorcana_get_legal_actions` (fully enumerated, ready-to-submit) →
   `lorcana_play_action`. Match ends at 20 lore / deck-out / `lorcana_concede`.

All tool errors use `{ ok:false, error:{ code, message } }`.
State is persisted after every action (`data/matches/*.json`) — the server resumes
matches across restarts.

## Card scripts & the effect DSL

Cards contain no code. Every card has a JSON script (`dist-data/scripts.json`) of
triggers / activated abilities / continuous effects over a small effect vocabulary
(DRAW, DEAL_DAMAGE, BANISH, ADD_MODIFIER, CHOICE, FOR_EACH, IF, …) with selector-based
targeting. Scripts were auto-generated from printed card text:

- **full** — every ability sentence translated (1,195 cards)
- **partial** — keywords + some abilities (428)
- **vanilla** — stats/keywords only (864; they still play correctly as stat cards)

To regenerate: `npm run build-data -w @lorcana/card-data`. To hand-improve a card,
edit its entry in `scripts.json` following `packages/engine/src/effects/dsl.ts`.

## Known rules limitations

- ~32% of ability sentences are not yet translated (see `coverage.json` histogram);
  affected cards play with keywords/stats only. Sets 10–12 are ~72% sentence-matched;
  set 13 is not in the bulk dump yet.
- Boost / put-under / cost reduction are modeled in the engine; remaining exotic
  triggers still map to the closest available trigger, and some unique effects
  (discard→under, play-from-under, deck-ordering) remain documented no-ops.
- Core format deck construction only (≤2 inks). Illumineer's Quest cards excluded.
- Bulk playtest datapoints: `run-match.ts --metrics out.jsonl` writes one JSON line
  per game (winner, turns, lore, eventCounts).

See `packages/*/README.md` for per-package contracts and deviation logs. `SPEC.md` is
the architecture source of truth.
