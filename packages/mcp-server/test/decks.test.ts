import { describe, expect, it } from "vitest";
import { parseDecklist, validateDeck, DeckStore, expandDeck } from "../src/tools/decks.js";
import { CodedError } from "../src/matches.js";
import { fixtureStore, fullNameOf, goodDeckText, tmpDir } from "./helpers.js";

const store = fixtureStore();

describe("parseDecklist + validateDeck", () => {
  it("accepts a legal 60-card dreamborn decklist (case-insensitive)", () => {
    const text = goodDeckText().toLowerCase(); // case-insensitive matching
    const { deck, errors } = parseDecklist(text, store);
    expect(errors).toEqual([]);
    expect(deck).toHaveLength(15);
    expect(expandDeck(deck)).toHaveLength(60);
    expect(validateDeck(deck, store)).toEqual([]);
  });

  it("rejects a 59-card deck", () => {
    const text = goodDeckText()
      .split("\n")
      .slice(0, 14)
      .concat([`3 ${fullNameOf("TST-015")}`])
      .join("\n");
    const { deck, errors } = parseDecklist(text, store);
    errors.push(...validateDeck(deck, store));
    expect(errors.some((e) => e.includes("59") && e.includes("exactly 60"))).toBe(true);
  });

  it("rejects a deck with 3 ink colors", () => {
    const text = goodDeckText()
      .split("\n")
      .slice(0, 14)
      .concat([`4 ${fullNameOf("TST-023")}`]) // Ruby, alongside Amber + Steel
      .join("\n");
    const { deck, errors } = parseDecklist(text, store);
    errors.push(...validateDeck(deck, store));
    expect(errors.some((e) => e.includes("3 ink colors"))).toBe(true);
  });

  it("rejects 5 copies of one card", () => {
    const text = [`5 ${fullNameOf("TST-001")}`]
      .concat(goodDeckText().split("\n").slice(1, 14))
      .concat([`3 ${fullNameOf("TST-015")}`])
      .concat([`3 ${fullNameOf("TST-016")}`])
      .join("\n");
    const { deck, errors } = parseDecklist(text, store);
    errors.push(...validateDeck(deck, store));
    expect(errors.some((e) => e.includes("5 times") && e.includes("max 4"))).toBe(true);
  });

  it("reports unknown cards", () => {
    const { errors } = parseDecklist(`4 Notacard - Does Not Exist`, store);
    expect(errors.some((e) => e.includes("unknown card"))).toBe(true);
  });

  it("rejects unparseable lines", () => {
    const { errors } = parseDecklist(`Alpha - Brave Scout`, store);
    expect(errors.some((e) => e.includes("unparseable line"))).toBe(true);
  });
});

describe("DeckStore", () => {
  it("imports a valid deck, persists it, and reloads it", () => {
    const dir = tmpDir();
    const decks = new DeckStore(dir);
    const record = decks.import(goodDeckText(), store, "test deck");
    expect(record.deckId).toMatch(/^deck-[0-9a-f]{12}$/);
    expect(record.name).toBe("test deck");

    const reloaded = new DeckStore(dir);
    reloaded.load();
    expect(reloaded.get(record.deckId).deck).toEqual(record.deck);
  });

  it("refuses to import an invalid deck with VALIDATION_FAILED", () => {
    const decks = new DeckStore(tmpDir());
    try {
      decks.import(`4 ${fullNameOf("TST-001")}`, store);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CodedError);
      expect((err as CodedError).code).toBe("VALIDATION_FAILED");
    }
  });

  it("throws NOT_FOUND for unknown deckIds", () => {
    const decks = new DeckStore(tmpDir());
    expect(() => decks.get("deck-nope")).toThrowError(CodedError);
  });
});
