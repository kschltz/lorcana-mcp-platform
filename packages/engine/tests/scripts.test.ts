import { describe, expect, it } from "vitest";
import {
  CardRegistry, FIXTURE_CARDS, FIXTURE_SCRIPTS, createTestRegistry, validateCardScript,
} from "../src/index.js";

describe("card registry & script schema validation (SPEC §3.5)", () => {
  it("every fixture script loads without interpreter/schema errors", () => {
    const reg = createTestRegistry();
    expect(reg.validateScripts()).toEqual({});
    for (const script of Object.values(FIXTURE_SCRIPTS)) {
      expect(validateCardScript(script)).toEqual([]);
    }
  });

  it("fixture covers the required card variety (~12+ hand-written cards)", () => {
    expect(FIXTURE_CARDS.length).toBeGreaterThanOrEqual(12);
    const types = new Set(FIXTURE_CARDS.map((c) => c.type));
    expect(types).toEqual(new Set(["Character", "Action", "Item", "Location"]));
    // keywords covered by the fixture
    const kws = new Set(Object.values(FIXTURE_SCRIPTS).flatMap((s) => (s.keywords ?? []).map((k) => k.name)));
    for (const k of ["Rush", "Bodyguard", "Resist", "Challenger", "Support", "Evasive", "Shift", "Singer", "Reckless", "Alert"]) {
      expect(kws.has(k as never), `fixture should cover ${k}`).toBe(true);
    }
    expect(FIXTURE_CARDS.some((c) => c.classifications.includes("Song"))).toBe(true);
  });

  it("unknown script id falls back to a vanilla card (stats only)", () => {
    const reg = createTestRegistry();
    const script = reg.getScript("TST-001"); // no script registered
    expect(script).toEqual({ cardId: "TST-001" });
    expect(script.triggered).toBeUndefined();
    expect(script.activated).toBeUndefined();
  });

  it("get throws on unknown card id; has() reports presence", () => {
    const reg = createTestRegistry();
    expect(reg.has("TST-001")).toBe(true);
    expect(reg.has("NOPE-001")).toBe(false);
    expect(() => reg.get("NOPE-001")).toThrow(/unknown card id/);
    expect(reg.all().length).toBe(FIXTURE_CARDS.length);
  });

  it("validateCardScript flags malformed scripts", () => {
    const bad = {
      cardId: "TST-099",
      keywords: [{ name: "NotAKeyword" as never }],
      triggered: [{
        trigger: "ON_PLAY" as const,
        effects: [{ type: "DEAL_DAMAGE", amount: "three" as never, target: { zone: "nowhere", who: "self" } as never }],
      }],
    };
    const errs = validateCardScript(bad);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.join("\n")).toMatch(/unknown keyword/);
    expect(errs.join("\n")).toMatch(/amount/);
  });

  it("a registry built from defs + scripts records round-trips", () => {
    const reg = new CardRegistry(FIXTURE_CARDS, FIXTURE_SCRIPTS);
    expect(reg.get("TST-013").fullName).toBe("Stitch - Abomination");
    expect(reg.getScript("TST-013").shiftCost).toBe(4);
    expect(reg.validateScripts()).toEqual({});
  });
});
