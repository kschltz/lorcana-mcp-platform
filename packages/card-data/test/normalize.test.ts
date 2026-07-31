import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isLorcanaCard,
  normalizeAll,
  normalizeCard,
  parseColors,
  splitName,
  type RawBulkCard,
} from "../src/normalize.js";

const RAW_PATH = join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "data", "lorcana_bulk.raw.json");
const raw = JSON.parse(readFileSync(RAW_PATH, "utf8")) as RawBulkCard[];
const cards = normalizeAll(raw);

describe("normalize", () => {
  it("keeps all Lorcana-gamemode cards (2400+, no Illumineer's Quest)", () => {
    expect(cards.length).toBeGreaterThanOrEqual(2400);
    // every explicit non-Lorcana gamemode was filtered out
    const skipped = raw.filter((r) => !isLorcanaCard(r));
    expect(skipped.every((r) => r.Gamemode !== undefined && r.Gamemode !== "" && r.Gamemode !== "Lorcana")).toBe(true);
    // unique ids preserved and unique
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
  });

  it("splits dual-ink colors on ','", () => {
    expect(parseColors("Amber, Steel")).toEqual(["Amber", "Steel"]);
    expect(parseColors("Ruby")).toEqual(["Ruby"]);
    const dual = cards.filter((c) => c.colors.length === 2);
    expect(dual.length).toBe(120); // 15 pairs x 8 dual-ink cards in the dump
    for (const c of cards) {
      expect(c.colors.length).toBeGreaterThanOrEqual(1);
      expect(c.colors.length).toBeLessThanOrEqual(2);
    }
  });

  it("splits 'Name - Subtitle' on the first ' - '", () => {
    expect(splitName("Rhino - Motivational Speaker")).toEqual({ name: "Rhino", subtitle: "Motivational Speaker" });
    expect(splitName("Hades")).toEqual({ name: "Hades" });
    const rhino = cards.find((c) => c.id === "ARI-001")!;
    expect(rhino.name).toBe("Rhino");
    expect(rhino.subtitle).toBe("Motivational Speaker");
    expect(rhino.fullName).toBe("Rhino - Motivational Speaker");
    expect(rhino.colors).toEqual(["Amber", "Steel"]);
    expect(rhino.type).toBe("Character");
    expect(rhino.strength).toBe(4);
    expect(rhino.willpower).toBe(7);
    expect(rhino.lore).toBe(2);
    // bodyText is kept raw (symbols intact)
    expect(rhino.bodyText).toContain("{w}");
    // no residual " - " inside split names (verified: bulk has no double-dash names)
    for (const c of cards) {
      expect(c.name).not.toContain(" - ");
      if (c.subtitle) expect(c.fullName).toBe(`${c.name} - ${c.subtitle}`);
    }
  });

  it("maps 'Action - Song' to Action + Song classification", () => {
    const songs = cards.filter((c) => c.classifications.includes("Song"));
    expect(songs.length).toBeGreaterThan(0);
    for (const s of songs) expect(s.type).toBe("Action");
  });

  it("carries locations' moveCost and keeps bodyText raw", () => {
    const withMove = cards.filter((c) => c.moveCost !== undefined);
    expect(withMove.length).toBeGreaterThan(0);
    expect(withMove.every((c) => c.type === "Location")).toBe(true);
  });

  it("isLorcanaCard: missing/empty gamemode counts as Lorcana", () => {
    expect(isLorcanaCard({} as RawBulkCard)).toBe(true);
    expect(isLorcanaCard({ Gamemode: "" } as RawBulkCard)).toBe(true);
    expect(isLorcanaCard({ Gamemode: "Lorcana" } as RawBulkCard)).toBe(true);
    expect(isLorcanaCard({ Gamemode: "Illumineer's Quest" } as RawBulkCard)).toBe(false);
  });

  it("normalizeCard throws on unknown type", () => {
    expect(() =>
      normalizeCard({ Unique_ID: "X-1", Name: "N", Type: "Sorcery", Color: "Amber", Cost: 1, Inkable: true, Rarity: "Common", Set_ID: "X", Set_Num: 1, Card_Num: 1, Image: "" }),
    ).toThrow(/Unknown card type/);
  });
});
