import { describe, expect, it } from "vitest";
import { parseKeywordHeader } from "../src/templates.js";

describe("keyword header parsing", () => {
  it("parses plain keywords", () => {
    for (const kw of ["Rush", "Evasive", "Ward", "Bodyguard", "Support", "Reckless", "Alert", "Vanish"] as const) {
      const r = parseKeywordHeader(`${kw} (some reminder text)`);
      expect(r?.keywords).toEqual([{ name: kw }]);
      expect(r?.rest).toBe("");
    }
  });

  it("parses parameterized keywords", () => {
    expect(parseKeywordHeader("Resist +2 (reminder)")?.keywords).toEqual([{ name: "Resist", value: 2 }]);
    expect(parseKeywordHeader("Challenger +3 (reminder)")?.keywords).toEqual([{ name: "Challenger", value: 3 }]);
    expect(parseKeywordHeader("Singer 5 (reminder)")?.keywords).toEqual([{ name: "Singer", value: 5 }]);
    expect(parseKeywordHeader("Boost 1 (reminder)")?.keywords).toEqual([{ name: "Boost", value: 1 }]);
  });

  it("parses Shift N into keyword + shiftCost", () => {
    const r = parseKeywordHeader("Shift 5 (You may pay 5 {i} to play this on top of one of your characters named X.)");
    expect(r?.keywords).toEqual([{ name: "Shift", value: 5 }]);
    expect(r?.shiftCost).toBe(5);
  });

  it("parses stacked keyword headers on one line", () => {
    const r = parseKeywordHeader("Shift 4 {i} Evasive (reminder)");
    expect(r?.keywords).toEqual([
      { name: "Shift", value: 4 },
      { name: "Evasive" },
    ]);
    expect(r?.shiftCost).toBe(4);
    const r2 = parseKeywordHeader("Rush Reckless");
    expect(r2?.keywords).toEqual([{ name: "Rush" }, { name: "Reckless" }]);
  });

  it("maps Sing Together N to Singer (documented approximation)", () => {
    expect(parseKeywordHeader("Sing Together 7")?.keywords).toEqual([{ name: "Singer", value: 7 }]);
  });

  it("parses named Shift variants", () => {
    const r = parseKeywordHeader("Puppy Shift 3: (reminder)");
    expect(r?.keywords).toEqual([{ name: "Shift", value: 3 }]);
    expect(r?.shiftCost).toBe(3);
  });

  it("keeps ability text after the keyword in rest", () => {
    const r = parseKeywordHeader("Sing Together 7 Look at the top 4 cards of your deck.");
    expect(r?.keywords).toEqual([{ name: "Singer", value: 7 }]);
    expect(r?.rest).toContain("Look at the top 4 cards");
  });

  it("returns null for non-keyword text", () => {
    expect(parseKeywordHeader("Whenever this character quests, draw a card.")).toBeNull();
  });
});
