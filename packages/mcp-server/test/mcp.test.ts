import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, TOOL_NAMES } from "../src/mcp.js";
import { testDeps, goodDeckText, type TestDeps } from "./helpers.js";

let deps: TestDeps;
let client: Client;

async function callTool(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0].text;
  return { body: JSON.parse(text), isError: result.isError === true };
}

beforeEach(async () => {
  deps = testDeps();
  const server = createMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
});

describe("MCP tool surface", () => {
  it("lists exactly the 9 SPEC §6 tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
    expect(tools).toHaveLength(9);
  });

  it("lorcana_search_cards finds fixture cards", async () => {
    const { body } = await callTool("lorcana_search_cards", { query: "alpha" });
    expect(body.cards.length).toBeGreaterThan(0);
    expect(body.cards[0]).toMatchObject({ id: "TST-001", inkable: true, type: "Character" });
    const { body: filtered } = await callTool("lorcana_search_cards", { color: "ruby" });
    expect(filtered.cards).toHaveLength(1);
    expect(filtered.cards[0].id).toBe("TST-023");
  });

  it("lorcana_get_card returns definition + script + tier, NOT_FOUND for unknown", async () => {
    const { body } = await callTool("lorcana_get_card", { cardId: "TST-021" });
    expect(body.card.fullName).toBe("Fireworks");
    expect(body.script.triggered).toHaveLength(1);
    expect(body.scriptTier).toBe("full");

    const { body: missing, isError } = await callTool("lorcana_get_card", { cardId: "TST-999" });
    expect(isError).toBe(true);
    expect(missing).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "unknown card: TST-999" } });
  });

  it("lorcana_validate_deck validates and lorcana_import_deck stores", async () => {
    const { body } = await callTool("lorcana_validate_deck", { decklistText: goodDeckText() });
    expect(body.valid).toBe(true);
    expect(body.errors).toEqual([]);
    expect(body.deck).toHaveLength(15);

    const { body: bad } = await callTool("lorcana_validate_deck", { decklistText: "4 Alpha - Brave Scout" });
    expect(bad.valid).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);

    const { body: imported } = await callTool("lorcana_import_deck", {
      decklistText: goodDeckText(),
      name: "smoke",
    });
    expect(imported.deckId).toMatch(/^deck-/);

    const { body: badImport, isError } = await callTool("lorcana_import_deck", { decklistText: "1 Alpha - Brave Scout" });
    expect(isError).toBe(true);
    expect(badImport.ok).toBe(false);
    expect(badImport.error.code).toBe("VALIDATION_FAILED");
  });

  it("plays a match end-to-end over MCP with token gating", async () => {
    const { body: deckA } = await callTool("lorcana_import_deck", { decklistText: goodDeckText() });
    const { body: deckB } = await callTool("lorcana_import_deck", { decklistText: goodDeckText() });

    const { body: created } = await callTool("lorcana_create_match", {
      deckIdA: deckA.deckId,
      deckIdB: deckB.deckId,
      seed: 99,
    });
    expect(created.tokenP1).toMatch(/^[0-9a-f]{16}$/);
    expect(created.spectatorUrl).toBe(`/#/match/${created.matchId}`);

    // Wrong token → FORBIDDEN envelope.
    const { body: forbidden, isError } = await callTool("lorcana_get_state", {
      matchId: created.matchId,
      token: "0000000000000000",
    });
    expect(isError).toBe(true);
    expect(forbidden).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    // Fog-of-war state + legal actions for p1.
    const { body: stateRes } = await callTool("lorcana_get_state", {
      matchId: created.matchId,
      token: created.tokenP1,
    });
    expect(stateRes.state.you).toBe("p1");
    expect(stateRes.state.players.p2.hand).toEqual({ count: 7 });
    expect(stateRes.yourTurn).toBe(true);
    const mulligan = stateRes.legalActions.find((l: { action: { type: string } }) => l.action.type === "MULLIGAN");
    expect(mulligan).toBeDefined();

    // Both mulligan (keep all) → main phase.
    const { body: p1Played } = await callTool("lorcana_play_action", {
      matchId: created.matchId,
      token: created.tokenP1,
      action: mulligan.action,
    });
    expect(p1Played.ok).toBe(true);
    expect(p1Played.newEvents.length).toBeGreaterThan(0);

    const { body: st2 } = await callTool("lorcana_get_state", {
      matchId: created.matchId,
      token: created.tokenP2,
    });
    const mull2 = st2.legalActions.find((l: { action: { type: string } }) => l.action.type === "MULLIGAN");
    const { body: p2Played } = await callTool("lorcana_play_action", {
      matchId: created.matchId,
      token: created.tokenP2,
      action: mull2.action,
    });
    expect(p2Played.state.phase).toBe("main");

    // Illegal action → INVALID_ACTION envelope with unchanged state.
    const { body: illegal, isError: illegalErr } = await callTool("lorcana_play_action", {
      matchId: created.matchId,
      token: created.tokenP1,
      action: { type: "PLAY_CARD", cardInstanceId: "match-does-not-exist" },
    });
    expect(illegalErr).toBe(true);
    expect(illegal).toMatchObject({ ok: false, error: { code: "INVALID_ACTION" } });

    // Concede.
    const { body: conceded } = await callTool("lorcana_concede", {
      matchId: created.matchId,
      token: created.tokenP2,
    });
    expect(conceded).toEqual({ ok: true });
    const { body: finalState } = await callTool("lorcana_get_state", {
      matchId: created.matchId,
      token: created.tokenP1,
    });
    expect(finalState.state.phase).toBe("game-over");
    expect(finalState.state.winner).toBe("p1");
    expect(finalState.state.winReason).toBe("concede");
  });
});
