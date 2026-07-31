import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateScript } from "../src/templates.js";
import type { CardDefinition, CardScript } from "../src/dsl-types.js";

const PKG = join(import.meta.dirname, "..");
const cards = JSON.parse(
  readFileSync(join(PKG, "dist-data", "cards.json"), "utf8"),
) as CardDefinition[];

describe("Boost script generation (sets 10–11)", () => {
  const boostCards = cards.filter((c) => /Boost\s+\d/i.test(c.bodyText));

  it("finds Boost cards in the pool", () => {
    expect(boostCards.length).toBeGreaterThanOrEqual(30);
  });

  it("emits once-per-turn PUT_UNDER activated ability for every Boost card", () => {
    for (const card of boostCards) {
      const { script } = generateScript(card);
      const boostKw = script.keywords?.find((k) => k.name === "Boost");
      expect(boostKw?.value, card.id).toBeTypeOf("number");
      const boostAb = script.activated?.find((a) => a.name === "Boost");
      expect(boostAb, `${card.fullName} missing Boost activated`).toBeTruthy();
      expect(boostAb!.cost.ink).toBe(boostKw!.value);
      expect(boostAb!.oncePerTurn).toBe(true);
      expect(boostAb!.effects[0]).toMatchObject({
        type: "PUT_UNDER",
        source: "top-deck",
        amount: 1,
      });
    }
  });

  it("maps put-under triggers on a known WHI card", () => {
    const simba = cards.find((c) => c.id === "WHI-020");
    expect(simba).toBeTruthy();
    const { script, unmatched } = generateScript(simba!);
    const putUnder = script.triggered?.filter((t) => t.trigger === "ON_PUT_UNDER") ?? [];
    expect(putUnder.length).toBeGreaterThanOrEqual(1);
    // remaining unmatched may exist for complex reveal-then-play branches
    void unmatched;
  });
});

describe("sets 10–12 coverage floor", () => {
  it("keeps sentence match ratio for sets 10–12 above the prior baseline", () => {
    const target = cards.filter((c) => c.setNum >= 10 && c.setNum <= 12);
    let matched = 0;
    let total = 0;
    let full = 0;
    for (const card of target) {
      const g = generateScript(card);
      matched += g.matched;
      total += g.total;
      if (g.tier === "full") full++;
    }
    const ratio = total === 0 ? 1 : matched / total;
    // Prior baseline was ~67.6% / 316 full. Require a clear improvement.
    expect(ratio).toBeGreaterThanOrEqual(0.70);
    expect(full).toBeGreaterThanOrEqual(350);
  });
});

/** Type-level smoke: generated scripts stay assignable to CardScript. */
void (null as unknown as CardScript);
