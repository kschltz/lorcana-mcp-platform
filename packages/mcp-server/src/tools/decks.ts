/**
 * tools/decks.ts — decklist parsing/validation + deck storage (SPEC §6 tools
 * `lorcana_validate_deck` / `lorcana_import_deck`).
 *
 * Text format: dreamborn/inktable export, one line per entry:
 *     4 Rhino - Motivational Speaker
 * Matching is case-insensitive against CardDefinition.fullName first, then
 * against the base name when the line has no subtitle (or the full name misses)
 * — only when the base name is unambiguous.
 *
 * Deck rules (SPEC §3.3): exactly 60 cards, ≤ 2 ink colors (dual-ink cards
 * contribute both colors), ≤ 4 copies of any card, all cards known.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CardStore } from "../cards.js";
import { CodedError } from "../matches.js";
import { guarded, jsonContent } from "./util.js";

export interface DeckEntry {
  cardId: string;
  count: number;
}

export interface ParsedDeck {
  deck: DeckEntry[];
  errors: string[];
}

export interface StoredDeck {
  deckId: string;
  name?: string;
  createdAt: string;
  deck: DeckEntry[];
}

const LINE_RE = /^(\d+)\s+(.+?)\s*$/;

/** Parse dreamborn/inktable text and resolve each line to cardIds. */
export function parseDecklist(decklistText: string, store: CardStore): ParsedDeck {
  const errors: string[] = [];
  const counts = new Map<string, number>();

  for (const rawLine of decklistText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = LINE_RE.exec(line);
    if (!m) {
      errors.push(`unparseable line: "${line}" (expected "<count> <Name>[- <Subtitle>]")`);
      continue;
    }
    const count = Number.parseInt(m[1], 10);
    if (!Number.isFinite(count) || count <= 0) {
      errors.push(`invalid count in line: "${line}"`);
      continue;
    }
    const cardName = m[2];
    let card = store.findByFullName(cardName);
    if (!card) {
      // Try base-name match: either the line had no subtitle, or the
      // " - " split belongs to the card's own punctuation.
      const baseName = cardName.split(" - ")[0];
      const candidates = store.findByName(baseName);
      if (candidates.length === 1) card = candidates[0];
      else if (candidates.length > 1) {
        errors.push(
          `ambiguous card name "${baseName}" in line "${line}" — use the full name ` +
            `(e.g. "${candidates[0].fullName}")`,
        );
        continue;
      }
    }
    if (!card) {
      errors.push(`unknown card: "${cardName}"`);
      continue;
    }
    counts.set(card.id, (counts.get(card.id) ?? 0) + count);
  }

  const deck = [...counts.entries()].map(([cardId, count]) => ({ cardId, count }));
  return { deck, errors };
}

/** Validate a parsed deck against the 60 / ≤2 inks / ≤4 copies rules. */
export function validateDeck(deck: DeckEntry[], store: CardStore): string[] {
  const errors: string[] = [];
  const total = deck.reduce((n, e) => n + e.count, 0);
  if (total !== 60) errors.push(`deck has ${total} cards, must be exactly 60`);

  const inks = new Set<string>();
  for (const { cardId, count } of deck) {
    const card = store.get(cardId);
    if (!card) {
      errors.push(`unknown cardId: ${cardId}`);
      continue;
    }
    if (count > 4) errors.push(`${card.fullName} appears ${count} times (max 4 copies)`);
    for (const c of card.colors) inks.add(c);
  }
  if (inks.size > 2) {
    errors.push(`deck uses ${inks.size} ink colors (max 2): ${[...inks].sort().join(", ")}`);
  }
  return errors;
}

export function totalCards(deck: DeckEntry[]): number {
  return deck.reduce((n, e) => n + e.count, 0);
}

/** Expand [{cardId,count}] to the flat 60-cardId list the engine consumes. */
export function expandDeck(deck: DeckEntry[]): string[] {
  const out: string[] = [];
  for (const { cardId, count } of deck) {
    for (let i = 0; i < count; i++) out.push(cardId);
  }
  return out;
}

/**
 * Deck storage: in-memory Map + JSON persistence under <dataDir>/decks/ so
 * imported decks survive restarts and can be referenced by lorcana_create_match.
 */
export class DeckStore {
  private readonly decks = new Map<string, StoredDeck>();
  readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    mkdirSync(dataDir, { recursive: true });
  }

  load(): void {
    if (!existsSync(this.dataDir)) return;
    for (const file of readdirSync(this.dataDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const deck = JSON.parse(readFileSync(join(this.dataDir, file), "utf8")) as StoredDeck;
        this.decks.set(deck.deckId, deck);
      } catch (err) {
        console.error(`[decks] failed to load ${file}:`, err);
      }
    }
  }

  /** Validate + store a decklist. Throws CodedError("VALIDATION_FAILED", ...) when invalid. */
  import(decklistText: string, store: CardStore, name?: string): StoredDeck {
    const { deck, errors } = parseDecklist(decklistText, store);
    errors.push(...validateDeck(deck, store));
    if (errors.length > 0) {
      throw new CodedError("VALIDATION_FAILED", `invalid decklist: ${errors.join("; ")}`);
    }
    const record: StoredDeck = {
      deckId: `deck-${randomBytes(6).toString("hex")}`,
      createdAt: new Date().toISOString(),
      deck,
    };
    if (name !== undefined) record.name = name;
    this.decks.set(record.deckId, record);
    writeFileSync(join(this.dataDir, `${record.deckId}.json`), JSON.stringify(record, null, 2));
    return record;
  }

  get(deckId: string): StoredDeck {
    const deck = this.decks.get(deckId);
    if (!deck) throw new CodedError("NOT_FOUND", `unknown deck: ${deckId}`);
    return deck;
  }
}

/** `lorcana_validate_deck` / `lorcana_import_deck` (SPEC §6). */
export function registerDeckTools(server: McpServer, store: CardStore, decks: DeckStore): void {
  server.registerTool(
    "lorcana_validate_deck",
    {
      description:
        "Parse a dreamborn/inktable decklist (\"4 Name - Subtitle\" lines, case-insensitive) " +
        "and validate it: exactly 60 cards, at most 2 ink colors, at most 4 copies per card, " +
        "all cards known. Returns { valid, errors, deck:[{cardId,count}] }.",
      inputSchema: {
        decklistText: z.string().describe("decklist text, one \"<count> <name>\" entry per line"),
      },
    },
    async ({ decklistText }) =>
      jsonContent(
        (() => {
          const { deck, errors } = parseDecklist(decklistText, store);
          errors.push(...validateDeck(deck, store));
          return { valid: errors.length === 0, errors, deck };
        })(),
      ),
  );

  server.registerTool(
    "lorcana_import_deck",
    {
      description:
        "Validate and store a decklist for later use with lorcana_create_match. " +
        "Returns { deckId, deck:[{cardId,count}] }.",
      inputSchema: {
        decklistText: z.string().describe("decklist text, one \"<count> <name>\" entry per line"),
        name: z.string().optional().describe("optional human-readable deck name"),
      },
    },
    async ({ decklistText, name }) =>
      guarded(() => {
        const record = decks.import(decklistText, store, name);
        return jsonContent({ deckId: record.deckId, deck: record.deck });
      }),
  );
}
