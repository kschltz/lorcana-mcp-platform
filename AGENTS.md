# AGENTS.md

## Cursor Cloud specific instructions

This repo is the **Lorcana MCP Playtest Platform** — an npm-workspaces monorepo (Node 20+, TypeScript ESM) with five packages under `packages/`:

- `@lorcana/engine` — deterministic rules engine (library, no process).
- `@lorcana/card-data` — builds `dist-data/*.json` card definitions/scripts (library; artifacts committed).
- `@lorcana/mcp-server` — the one long-running service: MCP endpoint + spectator REST/SSE API + serves the built UI. Default port **8787**.
- `@lorcana/ui` — React spectator app (Vite). In prod it is static files served by `mcp-server`; `npm run dev -w @lorcana/ui` runs a separate Vite dev server on `:5173` that proxies `/api` → `:8787`.
- `@lorcana/bots` — CLI (not a daemon) that drives AI-vs-AI matches over MCP.

### Running / building / testing (standard commands live in root `package.json` and `README.md`)

- Build all packages: `npm run build` (order matters: card-data → engine → mcp-server → bots → ui). **The build is also the type-check/lint step — there is no ESLint config; correctness relies on `tsc`.**
- Run the server (dev, hot reload): `npm run dev` (tsx watch on mcp-server). Production entrypoint: `npm start`.
- Tests: `npm test` (Vitest across all workspaces). No running services needed for tests.

### Non-obvious caveats

- **The server serves the spectator UI only if `packages/ui/dist` exists.** `npm run dev` (mcp-server) does NOT build the UI. If you want the browser UI at `http://localhost:8787/`, run `npm run build` (or at least `npm run build -w @lorcana/ui`) first. Otherwise use the `@lorcana/ui` Vite dev server on `:5173`.
- `mcp-server` dynamically imports `@lorcana/engine` at runtime; if the engine's `dist` is missing it silently falls back to a limited **StubEngine** (logs a warning). Always `npm run build` before running for full rules behavior.
- Sample decks in `data/acceptance/*.txt` reference some card names not in the committed pool; the bot runner auto-substitutes them (prints substitution notes) — this is expected, not an error.
- Persistence is plain JSON on disk (`packages/mcp-server/data/matches/*.json`, gitignored) — no external DB/Docker. Matches resume across server restarts.
- Optional LLM bot seats (`--llmSeat`) require a local Ollama at `:11434`; heuristic bots need nothing extra.

### Hello-world / E2E smoke check

With the server running (`npm run dev`), from repo root:

```bash
npx tsx packages/bots/src/run-match.ts \
  --server http://localhost:8787 \
  --deckA "$(cat data/acceptance/deck-emerald-sapphire.txt)" \
  --deckB "$(cat data/acceptance/deck-amber-emerald.txt)" \
  --games 1 --seed 42
```

Then open `http://localhost:8787/` to watch the match on the spectator board.
