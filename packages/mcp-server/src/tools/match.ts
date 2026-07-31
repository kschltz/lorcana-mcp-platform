/**
 * tools/match.ts — match lifecycle tools (SPEC §6): lorcana_create_match,
 * lorcana_get_state, lorcana_get_legal_actions, lorcana_play_action, lorcana_concede.
 *
 * State returned to players is always the fog-of-war playerView (opponent
 * hand/deck/inkwell = counts only). `spectatorUrl` from create_match is the
 * UI hash route `/#/match/<id>` served by the same Express server.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CardStore } from "../cards.js";
import type { MatchRegistry } from "../matches.js";
import { expandDeck, DeckStore } from "./decks.js";
import { playerView } from "../views.js";
import { guarded, jsonContent } from "./util.js";

const playChoicesSchema = z
  .object({
    targets: z.array(z.string()).optional(),
    options: z.array(z.string()).optional(),
    payAlternatives: z.record(z.string()).optional(),
  })
  .optional();

/** PlayerAction (SPEC §3.2) as a zod discriminated union. */
const playerActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MULLIGAN"), keep: z.array(z.string()) }),
  z.object({ type: z.literal("PLAY_INK"), cardInstanceId: z.string() }),
  z.object({ type: z.literal("PLAY_CARD"), cardInstanceId: z.string(), choices: playChoicesSchema }),
  z.object({ type: z.literal("QUEST"), characterId: z.string() }),
  z.object({ type: z.literal("CHALLENGE"), attackerId: z.string(), defenderId: z.string() }),
  z.object({
    type: z.literal("ACTIVATE_ABILITY"),
    cardInstanceId: z.string(),
    abilityIndex: z.number().int(),
    choices: playChoicesSchema,
  }),
  z.object({ type: z.literal("MOVE_TO_LOCATION"), characterId: z.string(), locationId: z.string() }),
  z.object({ type: z.literal("RESOLVE_CHOICE"), choiceId: z.string(), selected: z.array(z.string()) }),
  z.object({ type: z.literal("PASS") }),
]);

const matchTokenSchema = {
  matchId: z.string().describe("match id returned by lorcana_create_match"),
  token: z.string().describe("your secret 16-hex seat token (tokenP1 or tokenP2)"),
};

export interface MatchToolDeps {
  store: CardStore;
  decks: DeckStore;
  matches: MatchRegistry;
}

export function registerMatchTools(server: McpServer, deps: MatchToolDeps): void {
  const { store, decks, matches } = deps;
  const registry = store.toRegistry();

  server.registerTool(
    "lorcana_create_match",
    {
      description:
        "Create a match between two imported decks. Returns per-seat secret tokens " +
        "(gate every state/action call) and a spectatorUrl for humans.",
      inputSchema: {
        deckIdA: z.string().describe("deckId of player 1 (from lorcana_import_deck)"),
        deckIdB: z.string().describe("deckId of player 2"),
        seed: z.number().int().optional().describe("RNG seed for deterministic setup"),
      },
    },
    async ({ deckIdA, deckIdB, seed }) =>
      guarded(() => {
        const deckA = expandDeck(decks.get(deckIdA).deck);
        const deckB = expandDeck(decks.get(deckIdB).deck);
        const { matchId, tokenP1, tokenP2 } = matches.create(deckA, deckB, seed);
        return { matchId, tokenP1, tokenP2, spectatorUrl: `/#/match/${matchId}` };
      }),
  );

  server.registerTool(
    "lorcana_get_state",
    {
      description:
        "Get your fog-of-war view of a match (opponent hand/deck/inkwell are counts only), " +
        "plus your currently legal actions and whether it is your turn.",
      inputSchema: matchTokenSchema,
    },
    async ({ matchId, token }) =>
      guarded(() => {
        const { player, state } = matches.getState(matchId, token);
        const { legalActions } = matches.getLegalActions(matchId, token);
        const yourTurn =
          state.phase !== "game-over" &&
          (state.activePlayer === player || state.pendingChoice?.player === player);
        return { state: playerView(state, player, registry), legalActions, yourTurn };
      }),
  );

  server.registerTool(
    "lorcana_get_legal_actions",
    {
      description: "Enumerate your fully-expanded legal actions in a match.",
      inputSchema: matchTokenSchema,
    },
    async ({ matchId, token }) =>
      guarded(() => {
        const { legalActions } = matches.getLegalActions(matchId, token);
        return { legalActions };
      }),
  );

  server.registerTool(
    "lorcana_play_action",
    {
      description:
        "Submit one action from your legal-actions list. On success returns your updated " +
        "player view, refreshed legal actions and the events the action produced. Rule " +
        "violations return ok:false with code INVALID_ACTION and the unchanged state.",
      inputSchema: {
        ...matchTokenSchema,
        action: playerActionSchema.describe("a PlayerAction exactly as enumerated by get_legal_actions"),
      },
    },
    async ({ matchId, token, action }) =>
      guarded(() => {
        const { player, result } = matches.playAction(matchId, token, action);
        const { legalActions } = matches.getLegalActions(matchId, token);
        const view = playerView(result.state, player, registry);
        if (!result.ok) {
          return {
            ...jsonContent({
              ok: false,
              error: { code: "INVALID_ACTION", message: result.error ?? "illegal action" },
              state: view,
              legalActions,
              newEvents: result.newEvents,
            }),
            isError: true,
          };
        }
        return { ok: true, state: view, legalActions, newEvents: result.newEvents };
      }),
  );

  server.registerTool(
    "lorcana_concede",
    {
      description: "Concede the match; your opponent wins immediately (winReason=concede).",
      inputSchema: matchTokenSchema,
    },
    async ({ matchId, token }) =>
      guarded(() => {
        matches.concede(matchId, token);
        return { ok: true };
      }),
  );
}
