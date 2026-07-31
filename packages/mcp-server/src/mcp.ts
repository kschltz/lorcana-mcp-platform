/**
 * mcp.ts — Model Context Protocol endpoint (SPEC §6).
 *
 * StreamableHTTPServerTransport mounted at /mcp with full session semantics:
 *   POST   /mcp  — JSON-RPC messages; an `initialize` request (no session
 *                  header) spins up a new transport+server pair, subsequent
 *                  posts route by the `mcp-session-id` header.
 *   GET    /mcp  — opens the server->client SSE stream for a session.
 *   DELETE /mcp  — terminates a session.
 *
 * A fresh McpServer is created per session (all 9 SPEC tools registered);
 * tool handlers share the package-level CardStore / DeckStore / MatchRegistry.
 */
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { CardStore } from "./cards.js";
import type { DeckStore } from "./tools/decks.js";
import type { MatchRegistry } from "./matches.js";
import { registerCardTools } from "./tools/cards.js";
import { registerDeckTools } from "./tools/decks.js";
import { registerMatchTools } from "./tools/match.js";

export interface McpDeps {
  store: CardStore;
  decks: DeckStore;
  matches: MatchRegistry;
}

export const TOOL_NAMES = [
  "lorcana_search_cards",
  "lorcana_get_card",
  "lorcana_validate_deck",
  "lorcana_import_deck",
  "lorcana_create_match",
  "lorcana_get_state",
  "lorcana_get_legal_actions",
  "lorcana_play_action",
  "lorcana_concede",
] as const;

/** Create an McpServer with all 9 SPEC §6 tools registered. */
export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer(
    { name: "lorcana-mcp-server", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  registerCardTools(server, deps.store);
  registerDeckTools(server, deps.store, deps.decks);
  registerMatchTools(server, deps);
  return server;
}

/** Express router handling POST/GET/DELETE /mcp with per-session transports. */
export function createMcpRouter(deps: McpDeps): Router {
  const router = Router();
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  router.post("/mcp", async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports[sid] = transport;
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) delete transports[transport.sessionId];
        };
        await createMcpServer(deps).connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: no valid session ID provided" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[mcp] error handling POST /mcp:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const sessionHandler = async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: invalid or missing session ID" },
        id: null,
      });
      return;
    }
    try {
      await transports[sessionId].handleRequest(req, res);
    } catch (err) {
      console.error(`[mcp] error handling ${req.method} /mcp:`, err);
      if (!res.headersSent) res.status(500).end();
    }
  };

  router.get("/mcp", sessionHandler);
  router.delete("/mcp", sessionHandler);
  return router;
}
