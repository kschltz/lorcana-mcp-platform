/**
 * generate-scripts.ts — turn CardDefinition[] into dist-data/scripts.json
 * (Record<cardId, CardScript>) plus a dist-data/coverage.json report.
 *
 * Coverage tiers (SPEC §5):
 *   full    — every body-text sentence/keyword line translated
 *   partial — keywords and/or some ability sentences translated
 *   vanilla — stats only (empty/unparseable body); still emits a CardScript
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CardDefinition, CardScript, ScriptTier } from "./dsl-types.js";
import { DIST_DATA_DIR } from "./normalize.js";
import { generateScript } from "./templates.js";

export { DIST_DATA_DIR };

export interface UnmatchedSample {
  cardId: string;
  fullName: string;
  sentence: string;
}

export interface CoverageReport {
  totalCards: number;
  tiers: Record<ScriptTier, number>;
  sentences: { total: number; matched: number; ratio: number };
  unmatchedPatterns: { pattern: string; count: number }[];
  unmatchedSamples: UnmatchedSample[];
}

export interface GenerateResult {
  scripts: Record<string, CardScript>;
  tiers: Record<string, ScriptTier>;
  coverage: CoverageReport;
}

function normalizePattern(sentence: string): string {
  return sentence
    .replace(/\d+/g, "N")
    .replace(/\{[iswlde]\}/g, "{X}")
    .replace(/\s+/g, " ")
    .trim();
}

export function generateAll(cards: CardDefinition[]): GenerateResult {
  const scripts: Record<string, CardScript> = {};
  const tiers: Record<string, ScriptTier> = {};
  const patternCounts = new Map<string, number>();
  const samples: UnmatchedSample[] = [];
  let totalSentences = 0;
  let matchedSentences = 0;
  const tierCounts: Record<ScriptTier, number> = { full: 0, partial: 0, vanilla: 0 };

  for (const card of cards) {
    const { script, tier, matched, total, unmatched } = generateScript(card);
    scripts[card.id] = script;
    tiers[card.id] = tier;
    tierCounts[tier] += 1;
    totalSentences += total;
    matchedSentences += matched;
    for (const u of unmatched) {
      const p = normalizePattern(u);
      patternCounts.set(p, (patternCounts.get(p) ?? 0) + 1);
      if (samples.length < 200) samples.push({ cardId: card.id, fullName: card.fullName, sentence: u });
    }
  }

  const unmatchedPatterns = [...patternCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([pattern, count]) => ({ pattern, count }));

  const coverage: CoverageReport = {
    totalCards: cards.length,
    tiers: tierCounts,
    sentences: {
      total: totalSentences,
      matched: matchedSentences,
      ratio: totalSentences === 0 ? 1 : matchedSentences / totalSentences,
    },
    unmatchedPatterns,
    unmatchedSamples: samples,
  };
  return { scripts, tiers, coverage };
}

export function printReport(result: GenerateResult): void {
  const { coverage } = result;
  console.log(`generate-scripts: ${coverage.totalCards} cards`);
  console.log(
    `  tiers: full=${coverage.tiers.full} partial=${coverage.tiers.partial} vanilla=${coverage.tiers.vanilla}`,
  );
  console.log(
    `  sentences: ${coverage.sentences.matched}/${coverage.sentences.total} matched (${(coverage.sentences.ratio * 100).toFixed(1)}%)`,
  );
  console.log("  top unmatched patterns:");
  for (const { pattern, count } of coverage.unmatchedPatterns.slice(0, 15)) {
    console.log(`    ${String(count).padStart(4)}  ${pattern.slice(0, 110)}`);
  }
}

export function main(): void {
  const cardsPath = join(DIST_DATA_DIR, "cards.json");
  const cards = JSON.parse(readFileSync(cardsPath, "utf8")) as CardDefinition[];
  const result = generateAll(cards);
  mkdirSync(DIST_DATA_DIR, { recursive: true });
  writeFileSync(join(DIST_DATA_DIR, "scripts.json"), JSON.stringify(result.scripts, null, 1) + "\n");
  writeFileSync(
    join(DIST_DATA_DIR, "coverage.json"),
    JSON.stringify({ ...result.coverage, tiersByCard: result.tiers }, null, 1) + "\n",
  );
  printReport(result);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
