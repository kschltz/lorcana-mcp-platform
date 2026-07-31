/**
 * tools/cards.ts — `lorcana_search_cards` / `lorcana_get_card` (SPEC §6).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CardStore } from "../cards.js";
import { errorContent, guarded, jsonContent } from "./util.js";

export function registerCardTools(server: McpServer, store: CardStore): void {
  server.registerTool(
    "lorcana_search_cards",
    {
      description:
        "Search Lorcana cards by name/text, ink color, card type, inkability and cost. " +
        "Returns card summaries (id, fullName, cost, colors, type, stats, inkable, bodyText, imageUrl).",
      inputSchema: {
        query: z.string().optional().describe("substring match on full name or body text (case-insensitive)"),
        color: z
          .string()
          .optional()
          .describe("ink color: Amber | Amethyst | Emerald | Ruby | Sapphire | Steel"),
        type: z.string().optional().describe("card type: Character | Action | Item | Location"),
        inkable: z.boolean().optional().describe("only cards that can (or cannot) be put into the inkwell"),
        maxCost: z.number().int().optional().describe("maximum ink cost"),
        limit: z.number().int().optional().describe("max results (default 25, cap 100)"),
      },
    },
    async (args) => jsonContent({ cards: store.search(args) }),
  );

  server.registerTool(
    "lorcana_get_card",
    {
      description:
        "Get the full CardDefinition, effect-DSL CardScript and script coverage tier for one card.",
      inputSchema: {
        cardId: z.string().describe("card id, e.g. \"ARI-001\""),
      },
    },
    async ({ cardId }) =>
      guarded(() => {
        const card = store.get(cardId);
        if (!card) return errorContent("NOT_FOUND", `unknown card: ${cardId}`);
        return jsonContent({
          card,
          script: store.getScript(cardId) ?? { cardId },
          scriptTier: store.getTier(cardId),
        });
      }),
  );
}
