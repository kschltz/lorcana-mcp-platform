/**
 * test/helpers.ts — shared fixtures: fixture CardStore, temp data dirs,
 * a fully wired deps object backed by the deterministic StubEngine.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CardStore } from "../src/cards.js";
import { MatchRegistry } from "../src/matches.js";
import { DeckStore } from "../src/tools/decks.js";
import { StubEngine } from "../src/testing/stubEngine.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export function fixtureStore(): CardStore {
  return CardStore.load({
    cardsPath: join(FIXTURES, "cards.json"),
    scriptsPath: join(FIXTURES, "scripts.json"),
    coveragePath: join(FIXTURES, "coverage.json"),
  });
}

export function tmpDir(prefix = "lorcana-mcp-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export interface TestDeps {
  store: CardStore;
  decks: DeckStore;
  matches: MatchRegistry;
  dataDir: string;
}

export function testDeps(dataDir = tmpDir()): TestDeps {
  const store = fixtureStore();
  const decks = new DeckStore(join(dataDir, "decks"));
  decks.load();
  const matches = new MatchRegistry({
    dataDir: join(dataDir, "matches"),
    engineFactory: StubEngine.factory(),
    registry: store.toRegistry(),
  });
  matches.load();
  return { store, decks, matches, dataDir };
}

/** A legal 60-card decklist: 15 distinct Amber/Steel cards × 4 copies. */
export function goodDeckText(): string {
  const lines: string[] = [];
  for (let i = 1; i <= 15; i++) {
    const id = `TST-${String(i).padStart(3, "0")}`;
    lines.push(`4 ${fullNameOf(id)}`);
  }
  return lines.join("\n");
}

const NAMES: Record<string, string> = {
  "TST-001": "Alpha - Brave Scout",
  "TST-002": "Beta - Loyal Guard",
  "TST-003": "Gamma - Swift Runner",
  "TST-004": "Delta - Wise Sage",
  "TST-005": "Epsilon - Bold Knight",
  "TST-006": "Zeta - Quiet Healer",
  "TST-007": "Eta - Sly Rogue",
  "TST-008": "Theta - Stout Defender",
  "TST-009": "Iota - Quick Fox",
  "TST-010": "Kappa - Calm Monk",
  "TST-011": "Lambda - Sharp Archer",
  "TST-012": "Mu - Kind Shepherd",
  "TST-013": "Nu - Daring Pilot",
  "TST-014": "Xi - Patient Tutor",
  "TST-015": "Omicron - Merry Bard",
  "TST-016": "Pi - Keen Tracker",
  "TST-023": "Ruby Dragon - Fierce Wyrm",
};

export function fullNameOf(id: string): string {
  return NAMES[id];
}
