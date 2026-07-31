/**
 * server.ts — Express app for the MCP endpoint + spectator HTTP API (SPEC §6).
 *
 *   POST/GET/DELETE /mcp               — MCP Streamable HTTP transport
 *   GET  /api/matches                  — live/finished matches with scores
 *   GET  /api/matches/:id/state        — spectatorView (full broadcast state)
 *   GET  /api/matches/:id/stream       — SSE: spectatorView after every action,
 *                                        heartbeat every 15s
 *   GET  /api/cards/:cardId/image      — 302 redirect to the card's imageUrl
 *   /*                                 — static serve of packages/ui/dist (if built)
 *
 * Engine wiring: the server prefers the real `@lorcana/engine` GameEngine via a
 * dynamic import (it is being built in parallel and is not yet a dependency of
 * this package — see contracts.ts). When it cannot be loaded, the process falls
 * back to the deterministic StubEngine with a loud warning so the platform is
 * still runnable/demoable today. LORCANA_ENGINE_MODULE can point at an
 * alternative module path (used by tests and for early integration).
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import cors from "cors";
import express, { type Express, type Request, type Response } from "express";
import { CardStore, PKG_DIR } from "./cards.js";
import { MatchRegistry, CodedError } from "./matches.js";
import { DeckStore } from "./tools/decks.js";
import { createMcpRouter, type McpDeps } from "./mcp.js";
import { spectatorView } from "./views.js";
import { StubEngine } from "./testing/stubEngine.js";
import { toolError, type CreateGameOptions, type EngineFactory, type EngineLike } from "./contracts.js";

export interface ServerDeps extends McpDeps {
  /** Directory of a built UI (packages/ui/dist); served statically when present. */
  uiDistDir?: string;
}

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json(toolError(code, message));
}

export function createApp(deps: ServerDeps): Express {
  const { store, matches } = deps;
  const registry = store.toRegistry();
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  // ---- MCP Streamable HTTP transport --------------------------------------
  app.use(createMcpRouter(deps));

  // ---- Spectator HTTP API ---------------------------------------------------
  app.get("/api/matches", (_req: Request, res: Response) => {
    res.json({ matches: matches.list() });
  });

  app.get("/api/matches/:id/state", (req: Request, res: Response) => {
    try {
      res.json(spectatorView(matches.spectatorState(req.params.id), registry));
    } catch (err) {
      if (err instanceof CodedError) return sendError(res, 404, err.code, err.message);
      throw err;
    }
  });

  app.get("/api/matches/:id/stream", (req: Request, res: Response) => {
    const matchId = req.params.id;
    if (!matches.has(matchId)) return sendError(res, 404, "NOT_FOUND", `unknown match: ${matchId}`);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n");

    const push = () => {
      res.write(`event: state\ndata: ${JSON.stringify(spectatorView(matches.spectatorState(matchId), registry))}\n\n`);
    };
    push(); // initial snapshot

    const onAction = (changedMatchId: string) => {
      if (changedMatchId === matchId) push();
    };
    matches.on("action", onAction);
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      matches.off("action", onAction);
    });
  });

  app.get("/api/cards/:cardId/image", (req: Request, res: Response) => {
    const card = store.get(req.params.cardId);
    if (!card) return sendError(res, 404, "NOT_FOUND", `unknown card: ${req.params.cardId}`);
    res.redirect(302, card.imageUrl);
  });

  // ---- Static UI (production) ------------------------------------------------
  const uiDist = deps.uiDistDir ?? join(PKG_DIR, "..", "ui", "dist");
  if (existsSync(uiDist)) {
    app.use(express.static(uiDist));
    app.get("*", (_req, res) => res.sendFile(join(uiDist, "index.html")));
  }

  // JSON 404 for unknown API routes.
  app.use("/api", (_req, res) => sendError(res, 404, "NOT_FOUND", "unknown API route"));

  return app;
}

export interface BuiltServer extends ServerDeps {
  app: Express;
}

/** Build stores + registries from disk/env. Exported for reuse by tests/CLI. */
export async function buildServer(opts: {
  dataDir?: string;
  engineFactory?: EngineFactory;
} = {}): Promise<BuiltServer> {
  const store = CardStore.load();
  const dataDir = opts.dataDir ?? process.env.LORCANA_DATA_DIR ?? join(PKG_DIR, "data");
  const decks = new DeckStore(join(dataDir, "decks"));
  decks.load();
  const engineFactory = opts.engineFactory ?? (await loadEngineFactory());
  const matches = new MatchRegistry({ dataDir: join(dataDir, "matches"), engineFactory, registry: store.toRegistry() });
  matches.load();
  return { store, decks, matches, app: createApp({ store, decks, matches }) };
}

/**
 * Resolve the engine factory: real @lorcana/engine when available, else the
 * stub. Dynamic so this package builds and runs before the engine is merged.
 */
async function loadEngineFactory(): Promise<EngineFactory> {
  const moduleName = process.env.LORCANA_ENGINE_MODULE ?? "@lorcana/engine";
  try {
    const mod = (await import(moduleName)) as {
      GameEngine?: new (opts: CreateGameOptions) => EngineLike;
    };
    if (mod.GameEngine) return (opts) => new mod.GameEngine!(opts);
    throw new Error(`module ${moduleName} has no GameEngine export`);
  } catch (err) {
    console.warn(
      `[server] could not load real engine (${moduleName}): ${(err as Error).message}. ` +
        "Falling back to the deterministic StubEngine (test subset of the rules).",
    );
    return StubEngine.factory();
  }
}

// ---------------------------------------------------------------- entrypoint ---

const isMain = (() => {
  try {
    return import.meta.url === `file://${resolve(process.argv[1] ?? "")}`;
  } catch {
    return false;
  }
})();

if (isMain) {
  const port = Number(process.env.PORT ?? 8787);
  buildServer()
    .then(({ app }) => {
      app.listen(port, () => {
        console.log(`[server] Lorcana MCP server listening on http://localhost:${port}`);
        console.log(`[server] MCP endpoint: http://localhost:${port}/mcp`);
        console.log(`[server] Spectator UI: http://localhost:${port}/#/match/<matchId>`);
      });
    })
    .catch((err) => {
      console.error("[server] fatal startup error:", err);
      process.exit(1);
    });
}
