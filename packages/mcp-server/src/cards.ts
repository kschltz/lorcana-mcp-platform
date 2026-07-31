/**
 * cards.ts — loads the card-data build artifacts (SPEC §5: dist-data/cards.json,
 * scripts.json, coverage.json) and exposes search/lookup used by the card tools,
 * the fog-of-war views (definition enrichment), and the spectator image route.
 *
 * Resolution order for each artifact (first hit wins):
 *   1. explicit option passed to CardStore.load()
 *   2. env override: LORCANA_CARDS_PATH / LORCANA_SCRIPTS_PATH / LORCANA_COVERAGE_PATH
 *   3. <repo>/packages/card-data/dist-data/<file> resolved relative to this module
 *      (works from both src/ via tsx and dist/ after build)
 *   4. <cwd>/packages/card-data/dist-data/<file>
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CardDefinition, CardRegistry, CardScript, CardType, InkColor } from "./contracts.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
/** packages/mcp-server (both from src/ and dist/). */
export const PKG_DIR = join(MODULE_DIR, "..");

export interface CardSummary {
  id: string;
  fullName: string;
  cost: number;
  colors: InkColor[];
  type: CardType;
  strength?: number;
  willpower?: number;
  lore?: number;
  inkable: boolean;
  bodyText: string;
  imageUrl: string;
}

export interface CardSearchFilter {
  query?: string;
  color?: string;
  type?: string;
  inkable?: boolean;
  maxCost?: number;
  limit?: number;
}

export interface CardStoreOptions {
  cardsPath?: string;
  scriptsPath?: string;
  coveragePath?: string;
}

function resolveDataFile(fileName: string, envVar: string, explicit?: string): string | undefined {
  const candidates = [
    explicit,
    process.env[envVar],
    join(PKG_DIR, "..", "card-data", "dist-data", fileName),
    resolve(process.cwd(), "packages", "card-data", "dist-data", fileName),
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  return candidates.find((p) => existsSync(p));
}

export class CardStore {
  readonly cards: CardDefinition[];
  readonly scripts: Record<string, CardScript>;
  /** Per-card coverage tier from coverage.json ("full" | "partial" | "vanilla"). */
  readonly tiersByCard: Record<string, string>;
  private readonly byId = new Map<string, CardDefinition>();
  private readonly byFullName = new Map<string, CardDefinition>();
  private readonly byName = new Map<string, CardDefinition[]>();

  constructor(
    cards: CardDefinition[],
    scripts: Record<string, CardScript>,
    tiersByCard: Record<string, string> = {},
  ) {
    this.cards = cards;
    this.scripts = scripts;
    this.tiersByCard = tiersByCard;
    for (const c of cards) {
      this.byId.set(c.id, c);
      this.byFullName.set(c.fullName.toLowerCase(), c);
      const list = this.byName.get(c.name.toLowerCase()) ?? [];
      list.push(c);
      this.byName.set(c.name.toLowerCase(), list);
    }
  }

  static load(opts: CardStoreOptions = {}): CardStore {
    const cardsPath = resolveDataFile("cards.json", "LORCANA_CARDS_PATH", opts.cardsPath);
    if (!cardsPath) {
      throw new Error(
        "cards.json not found. Set LORCANA_CARDS_PATH or build @lorcana/card-data " +
          "(npm run build-data -w @lorcana/card-data).",
      );
    }
    const scriptsPath = resolveDataFile("scripts.json", "LORCANA_SCRIPTS_PATH", opts.scriptsPath);
    const coveragePath = resolveDataFile("coverage.json", "LORCANA_COVERAGE_PATH", opts.coveragePath);
    const cards = JSON.parse(readFileSync(cardsPath, "utf8")) as CardDefinition[];
    const scripts = scriptsPath
      ? (JSON.parse(readFileSync(scriptsPath, "utf8")) as Record<string, CardScript>)
      : {};
    let tiersByCard: Record<string, string> = {};
    if (coveragePath) {
      const coverage = JSON.parse(readFileSync(coveragePath, "utf8")) as {
        tiersByCard?: Record<string, string>;
      };
      tiersByCard = coverage.tiersByCard ?? {};
    }
    return new CardStore(cards, scripts, tiersByCard);
  }

  get(cardId: string): CardDefinition | undefined {
    return this.byId.get(cardId);
  }

  getScript(cardId: string): CardScript | undefined {
    return this.scripts[cardId];
  }

  /** Coverage tier for a card; derived from script content when coverage.json is absent. */
  getTier(cardId: string): string {
    const known = this.tiersByCard[cardId];
    if (known) return known;
    const s = this.scripts[cardId];
    if (!s) return "vanilla";
    if ((s.triggered?.length ?? 0) > 0 || (s.activated?.length ?? 0) > 0 || (s.continuous?.length ?? 0) > 0) {
      return "partial";
    }
    return "vanilla";
  }

  /** Case-insensitive exact lookup by full name ("Name - Subtitle"). */
  findByFullName(fullName: string): CardDefinition | undefined {
    return this.byFullName.get(fullName.toLowerCase());
  }

  /** All cards with a given base name (case-insensitive). */
  findByName(name: string): CardDefinition[] {
    return this.byName.get(name.toLowerCase()) ?? [];
  }

  search(filter: CardSearchFilter): CardSummary[] {
    const limit = Math.max(1, Math.min(filter.limit ?? 25, 100));
    const q = filter.query?.trim().toLowerCase();
    const color = filter.color?.trim().toLowerCase();
    const type = filter.type?.trim().toLowerCase();
    const out: CardSummary[] = [];
    for (const c of this.cards) {
      if (q && !c.fullName.toLowerCase().includes(q) && !c.bodyText.toLowerCase().includes(q)) continue;
      if (color && !c.colors.some((col) => col.toLowerCase() === color)) continue;
      if (type && c.type.toLowerCase() !== type) continue;
      if (filter.inkable !== undefined && c.inkable !== filter.inkable) continue;
      if (filter.maxCost !== undefined && c.cost > filter.maxCost) continue;
      out.push({
        id: c.id,
        fullName: c.fullName,
        cost: c.cost,
        colors: c.colors,
        type: c.type,
        strength: c.strength,
        willpower: c.willpower,
        lore: c.lore,
        inkable: c.inkable,
        bodyText: c.bodyText,
        imageUrl: c.imageUrl,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Adapt to the engine-facing CardRegistry contract (SPEC §3.2). */
  toRegistry(): CardRegistry {
    return {
      get: (cardId: string) => this.get(cardId),
      getScript: (cardId: string) => this.getScript(cardId),
    };
  }
}
