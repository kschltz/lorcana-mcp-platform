/**
 * client.ts — MCP client for the Lorcana platform (SPEC §8).
 *
 * Thin typed wrappers around the 9 `lorcana_*` tools over the Streamable HTTP
 * transport (`${server}/mcp`). Session semantics (initialize → mcp-session-id
 * header → DELETE on close) are handled by the SDK transport.
 *
 * Error model:
 *  - Transport/HTTP failures (network errors, 5xx) are retried with
 *    exponential backoff, then rethrown as `McpTransportError`.
 *  - Tool-level failures come back as `isError` results carrying the SPEC §6
 *    envelope `{ ok:false, error:{ code, message } }`; every wrapper except
 *    `playAction` surfaces them by throwing `LorcanaToolError`. `playAction`
 *    instead returns the envelope as a normal `PlayActionResult` with
 *    `ok:false` because INVALID_ACTION is part of the match loop's control
 *    flow (and a P0 signal for the platform).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  CreateMatchResult,
  GetStateResult,
  ImportDeckResult,
  PlayActionResult,
  PlayerAction,
  SearchCardsResult,
  ToolError,
  ValidateDeckResult,
} from "./types.js";

export class LorcanaToolError extends Error {
  readonly code: string;
  constructor(error: ToolError) {
    super(`${error.code}: ${error.message}`);
    this.name = "LorcanaToolError";
    this.code = error.code;
  }
}

export class McpTransportError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "McpTransportError";
  }
}

export interface LorcanaClientOptions {
  /** Attempts per tool call before giving up (default 4). */
  maxRetries?: number;
  /** Base backoff in ms, doubled per attempt (default 200). */
  baseDelayMs?: number;
  /** Optional hook for retry/diagnostics. */
  onRetry?: (tool: string, attempt: number, err: unknown) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class LorcanaClient {
  private readonly client: Client;
  private readonly transport: StreamableHTTPClientTransport;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly onRetry?: (tool: string, attempt: number, err: unknown) => void;

  constructor(serverUrl: string, opts: LorcanaClientOptions = {}) {
    const base = serverUrl.replace(/\/+$/, "");
    this.transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`));
    this.client = new Client(
      { name: "lorcana-bots", version: "0.1.0" },
      { capabilities: {} },
    );
    this.maxRetries = opts.maxRetries ?? 4;
    this.baseDelayMs = opts.baseDelayMs ?? 200;
    this.onRetry = opts.onRetry;
  }

  /** Establish the MCP session (initialize handshake). */
  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  /** Terminate the MCP session (DELETE /mcp) and close the transport. */
  async close(): Promise<void> {
    await this.client.close();
  }

  /** Low-level call with retry/backoff. Returns the parsed JSON payload plus
   * the MCP `isError` flag; never throws for tool-level errors. */
  private async call<T>(tool: string, args: Record<string, unknown>): Promise<{ data: T; isError: boolean }> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.client.callTool({ name: tool, arguments: args });
        const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
        const text = content
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text as string)
          .join("\n");
        let data: T;
        try {
          data = JSON.parse(text) as T;
        } catch {
          throw new McpTransportError(`tool ${tool} returned non-JSON content: ${text.slice(0, 200)}`);
        }
        return { data, isError: result.isError === true };
      } catch (err) {
        if (err instanceof McpTransportError) throw err; // got a response; don't retry
        lastErr = err;
        if (attempt < this.maxRetries) {
          this.onRetry?.(tool, attempt, err);
          await sleep(this.baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 50));
        }
      }
    }
    throw new McpTransportError(
      `tool ${tool} failed after ${this.maxRetries} attempts: ${String(lastErr)}`,
      lastErr,
    );
  }

  /** Call a tool and throw LorcanaToolError when the SPEC error envelope comes back. */
  private async callOrThrow<T>(tool: string, args: Record<string, unknown>): Promise<T> {
    const { data, isError } = await this.call<{ ok?: boolean; error?: ToolError } & T>(tool, args);
    if (isError || data.ok === false) {
      throw new LorcanaToolError(data.error ?? { code: "INTERNAL", message: "unknown tool error" });
    }
    return data;
  }

  // --- the 9 SPEC §6 tools ----------------------------------------------------

  async searchCards(params: {
    query?: string;
    color?: string;
    type?: string;
    inkable?: boolean;
    maxCost?: number;
    limit?: number;
  }): Promise<SearchCardsResult> {
    return this.callOrThrow("lorcana_search_cards", { ...params });
  }

  async getCard(cardId: string): Promise<unknown> {
    return this.callOrThrow("lorcana_get_card", { cardId });
  }

  async validateDeck(decklistText: string): Promise<ValidateDeckResult> {
    // lorcana_validate_deck reports invalid decks in-band (valid:false), not as errors.
    return this.callOrThrow("lorcana_validate_deck", { decklistText });
  }

  async importDeck(decklistText: string, name?: string): Promise<ImportDeckResult> {
    return this.callOrThrow("lorcana_import_deck", name === undefined ? { decklistText } : { decklistText, name });
  }

  async createMatch(deckIdA: string, deckIdB: string, seed?: number): Promise<CreateMatchResult> {
    return this.callOrThrow(
      "lorcana_create_match",
      seed === undefined ? { deckIdA, deckIdB } : { deckIdA, deckIdB, seed },
    );
  }

  async getState(matchId: string, token: string): Promise<GetStateResult> {
    return this.callOrThrow("lorcana_get_state", { matchId, token });
  }

  async getLegalActions(matchId: string, token: string): Promise<{ legalActions: unknown[] }> {
    return this.callOrThrow("lorcana_get_legal_actions", { matchId, token });
  }

  /** Play an action. Tool-level rule failures (INVALID_ACTION etc.) are
   * returned, not thrown, so the caller can report them as P0 engine bugs. */
  async playAction(matchId: string, token: string, action: PlayerAction): Promise<PlayActionResult> {
    const { data } = await this.call<PlayActionResult>("lorcana_play_action", { matchId, token, action });
    return data;
  }

  async concede(matchId: string, token: string): Promise<{ ok: true }> {
    return this.callOrThrow("lorcana_concede", { matchId, token });
  }
}
