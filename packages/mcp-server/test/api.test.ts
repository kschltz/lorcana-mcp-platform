import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { createApp } from "../src/server.js";
import { expandDeck } from "../src/tools/decks.js";
import { testDeps, goodDeckText, type TestDeps } from "./helpers.js";

let deps: TestDeps;
let app: ReturnType<typeof createApp>;
let matchId: string;
let tokenP1: string;

beforeEach(async () => {
  deps = testDeps();
  app = createApp(deps);
  const deckA = deps.decks.import(goodDeckText(), deps.store);
  const deckB = deps.decks.import(goodDeckText(), deps.store);
  const created = deps.matches.create(
    expandDeck(deckA.deck),
    expandDeck(deckB.deck),
    5,
  );
  matchId = created.matchId;
  tokenP1 = created.tokenP1;
});

describe("spectator HTTP API", () => {
  it("GET /api/matches lists matches with scores", async () => {
    const res = await request(app).get("/api/matches").expect(200);
    expect(res.body.matches).toHaveLength(1);
    expect(res.body.matches[0]).toMatchObject({
      matchId,
      phase: "mulligan",
      scores: { p1: 0, p2: 0 },
    });
  });

  it("GET /api/matches/:id/state returns the spectator view; 404 envelope for unknown", async () => {
    const res = await request(app).get(`/api/matches/${matchId}/state`).expect(200);
    expect(res.body.matchId).toBe(matchId);
    expect(res.body.players.p1.hand).toHaveLength(7);
    expect(res.body.players.p1.hand[0].facedown).toBe(true);
    expect(res.body.players.p1.deck).toEqual({ count: 53 });

    const missing = await request(app).get("/api/matches/match-nope/state").expect(404);
    expect(missing.body).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("GET /api/cards/:cardId/image redirects (302) to the imageUrl", async () => {
    const res = await request(app).get("/api/cards/TST-001/image").expect(302);
    expect(res.headers.location).toBe("https://img.example.com/TST-001.png");
    await request(app).get("/api/cards/TST-999/image").expect(404);
  });

  it("GET /api/matches/:id/stream pushes spectatorView after each action (SSE)", async () => {
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;

    try {
      const chunks: string[] = [];
      let actionFired = false;
      await new Promise<void>((resolvePromise, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/api/matches/${matchId}/stream`, (res) => {
          expect(res.headers["content-type"]).toBe("text/event-stream");
          res.setEncoding("utf8");
          let buffer = "";
          res.on("data", (chunk: string) => {
            buffer += chunk;
            chunks.push(chunk);
            // First state event = initial snapshot; then trigger an action once.
            if (!actionFired && buffer.includes("event: state")) {
              actionFired = true;
              const { player, state } = deps.matches.getState(matchId, tokenP1);
              deps.matches.playAction(matchId, tokenP1, {
                type: "MULLIGAN",
                keep: state.players[player].hand.map((c) => c.instanceId),
              });
            }
            if (buffer.split("event: state").length - 1 >= 2) {
              req.destroy();
              resolvePromise();
            }
          });
          res.on("error", reject);
        });
        req.on("error", () => resolvePromise()); // destroy() surfaces as error
        setTimeout(() => reject(new Error("SSE timed out")), 8000);
      });

      const events = chunks.join("").split("event: state").slice(1);
      expect(events.length).toBeGreaterThanOrEqual(2);
      const first = JSON.parse(events[0].split("data: ")[1].trim());
      const second = JSON.parse(events[1].split("data: ")[1].trim());
      expect(first.matchId).toBe(matchId);
      expect(second.players.p1.hand).toHaveLength(7); // still 7 after keep-all mulligan
      expect(first.phase).toBe("mulligan");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("SSE stream 404s for unknown matches", async () => {
    await request(app).get("/api/matches/match-nope/stream").expect(404);
  });
});
