import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server.js";
import { TOOL_NAMES } from "../src/mcp.js";
import { testDeps, type TestDeps } from "./helpers.js";

/**
 * Exercises the real StreamableHTTPServerTransport session semantics at /mcp:
 * initialize (no session header) → session id issued → subsequent requests
 * route by mcp-session-id → DELETE terminates the session.
 */
let deps: TestDeps;
let server: http.Server;
let baseUrl: string;

const INIT_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "http-test", version: "0.0.1" },
  },
};

beforeEach(async () => {
  deps = testDeps();
  server = http.createServer(createApp(deps));
  await new Promise<void>((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

async function mcpPost(body: unknown, sessionId?: string): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  return fetch(`${baseUrl}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
}

/** Read a (possibly SSE-framed) JSON-RPC response body. */
async function readJsonRpc(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  const dataLine = text
    .split("\n")
    .find((l) => l.startsWith("data:"));
  return JSON.parse(dataLine ? dataLine.slice(5).trim() : text);
}

describe("POST/GET/DELETE /mcp transport", () => {
  it("rejects non-initialize POSTs without a session id", async () => {
    const res = await mcpPost({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("session");
  });

  it("runs a full session: initialize → tools/list → DELETE", async () => {
    // initialize → session id in response header
    const initRes = await mcpPost(INIT_BODY);
    expect(initRes.status).toBe(200);
    const sessionId = initRes.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    const initBody = await readJsonRpc(initRes);
    expect((initBody.result as { serverInfo: { name: string } }).serverInfo.name).toBe(
      "lorcana-mcp-server",
    );

    // notifications/initialized (required by the protocol before other calls)
    const noteRes = await mcpPost(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      sessionId!,
    );
    expect(noteRes.status).toBe(202);

    // tools/list with the session id → all 9 SPEC tools
    const listRes = await mcpPost({ jsonrpc: "2.0", id: 2, method: "tools/list" }, sessionId!);
    expect(listRes.status).toBe(200);
    const listBody = await readJsonRpc(listRes);
    const names = (
      listBody.result as { tools: { name: string }[] }
    ).tools.map((t) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());

    // Unknown session id → 400
    const badRes = await mcpPost({ jsonrpc: "2.0", id: 3, method: "tools/list" }, "bogus-session");
    expect(badRes.status).toBe(400);

    // DELETE terminates the session; further requests with it fail.
    const delRes = await fetch(`${baseUrl}/mcp`, {
      method: "DELETE",
      headers: { "mcp-session-id": sessionId! },
    });
    expect([200, 202, 204]).toContain(delRes.status);
    const afterDelete = await mcpPost({ jsonrpc: "2.0", id: 4, method: "tools/list" }, sessionId!);
    expect(afterDelete.status).toBe(400);
  });

  it("GET /mcp without a session id is rejected", async () => {
    const res = await fetch(`${baseUrl}/mcp`);
    expect(res.status).toBe(400);
  });
});
