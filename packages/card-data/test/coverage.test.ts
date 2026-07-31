import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CardDefinition, CardScript, EffectNode } from "../src/dsl-types.js";
import { normalizeAll, type RawBulkCard } from "../src/normalize.js";
import { generateAll } from "../src/generate-scripts.js";

const PKG = join(fileURLToPath(import.meta.url), "..", "..");
const RAW_PATH = join(PKG, "..", "..", "data", "lorcana_bulk.raw.json");
const raw = JSON.parse(readFileSync(RAW_PATH, "utf8")) as RawBulkCard[];
const cards = normalizeAll(raw);
const result = generateAll(cards);

const EFFECT_TYPES = new Set([
  "DRAW", "DEAL_DAMAGE", "REMOVE_DAMAGE", "GAIN_LORE", "OPPONENT_LOSE_LORE", "BANISH",
  "RETURN_TO_HAND", "EXERT", "READY", "ADD_MODIFIER", "GRANT_KEYWORD", "DISCARD",
  "LOOK_TOP", "PUT_INTO_INKWELL", "SEARCH_DECK", "PLAY_CARD_FREE", "MOVE_DAMAGE",
  "PREVENT_DAMAGE", "CHOICE", "FOR_EACH", "IF",
  "PUT_UNDER", "COST_REDUCTION",
]);
const KEYWORDS = new Set([
  "Rush", "Evasive", "Ward", "Bodyguard", "Reckless", "Support", "Resist",
  "Challenger", "Singer", "Shift", "Alert", "Vanish", "Boost",
]);
const TRIGGERS = new Set([
  "ON_PLAY", "ON_QUEST", "ON_CHALLENGE_BANISH", "ON_BANISH",
  "START_OF_TURN", "END_OF_TURN", "ON_OPPONENT_PLAY", "ON_PLAY_CHARACTER",
  "ON_PUT_UNDER", "ON_PUT_UNDER_FRIENDLY",
]);

function validateNodes(nodes: EffectNode[], path: string): string[] {
  const errors: string[] = [];
  for (const n of nodes) {
    if (!EFFECT_TYPES.has(n.type)) errors.push(`${path}: unknown effect type ${(n as { type: string }).type}`);
    if (n.type === "CHOICE") for (const opt of n.options) errors.push(...validateNodes(opt, path));
    if (n.type === "FOR_EACH") errors.push(...validateNodes(n.effects, path));
    if (n.type === "IF") {
      errors.push(...validateNodes(n.then, path));
      errors.push(...validateNodes(n.else, path));
    }
  }
  return errors;
}

function validateScript(script: CardScript): string[] {
  const errors: string[] = [];
  for (const kw of script.keywords ?? []) {
    if (!KEYWORDS.has(kw.name)) errors.push(`${script.cardId}: bad keyword ${kw.name}`);
  }
  for (const t of script.triggered ?? []) {
    if (!TRIGGERS.has(t.trigger)) errors.push(`${script.cardId}: bad trigger ${t.trigger}`);
    errors.push(...validateNodes(t.effects, script.cardId));
  }
  for (const a of script.activated ?? []) errors.push(...validateNodes(a.effects, script.cardId));
  for (const c of script.continuous ?? []) {
    if (!c.selector || !c.modifier) errors.push(`${script.cardId}: malformed continuous ability`);
  }
  return errors;
}

describe("coverage gate", () => {
  it("100% of cards produce a loadable script", () => {
    expect(Object.keys(result.scripts)).toHaveLength(cards.length);
    for (const card of cards) {
      const script = result.scripts[card.id];
      expect(script, `missing script for ${card.id}`).toBeDefined();
      expect(script.cardId).toBe(card.id);
      // JSON-serializable (loadable artifact)
      expect(() => JSON.stringify(script)).not.toThrow();
    }
    // schema sanity over all scripts
    const errors = Object.values(result.scripts).flatMap(validateScript);
    expect(errors).toEqual([]);
  });

  it("matched-line ratio is at least 60% over all non-empty Body_Text ability lines", () => {
    expect(result.coverage.sentences.total).toBeGreaterThan(0);
    expect(result.coverage.sentences.ratio).toBeGreaterThanOrEqual(0.6);
  });

  it("tier counts are consistent and every tier is valid", () => {
    const { tiers } = result.coverage;
    expect(tiers.full + tiers.partial + tiers.vanilla).toBe(cards.length);
    for (const t of Object.values(result.tiers)) {
      expect(["full", "partial", "vanilla"]).toContain(t);
    }
  });

  it("dist-data artifacts on disk match the generated pipeline", () => {
    const cardsJson = JSON.parse(readFileSync(join(PKG, "dist-data", "cards.json"), "utf8")) as CardDefinition[];
    const scriptsJson = JSON.parse(readFileSync(join(PKG, "dist-data", "scripts.json"), "utf8")) as Record<string, CardScript>;
    const coverage = JSON.parse(readFileSync(join(PKG, "dist-data", "coverage.json"), "utf8"));
    expect(cardsJson.length).toBe(cards.length);
    expect(Object.keys(scriptsJson).length).toBe(cards.length);
    expect(coverage.sentences.ratio).toBeGreaterThanOrEqual(0.6);
  });
});
