import { describe, expect, it } from "vitest";
import type { CardDefinition, EffectNode } from "../src/dsl-types.js";
import { generateScript, matchSentence, type SentenceContext } from "../src/templates.js";

const ctx: SentenceContext = { card: {} as CardDefinition };

function nodes(text: string): EffectNode[] {
  const r = matchSentence(text, ctx);
  expect(r.matched).toBe(true);
  return r.nodes;
}

describe("sentence templates", () => {
  it("draw N cards", () => {
    expect(nodes("Draw a card.")).toEqual([{ type: "DRAW", amount: 1 }]);
    expect(nodes("Draw 3 cards.")).toEqual([{ type: "DRAW", amount: 3 }]);
  });

  it("deal N damage to chosen character / each opposing character", () => {
    const [n1] = nodes("Deal 2 damage to chosen character.");
    expect(n1).toMatchObject({ type: "DEAL_DAMAGE", amount: 2, target: { chosen: true, type: "Character" } });
    const [n2] = nodes("Deal 1 damage to each opposing character.");
    expect(n2).toMatchObject({ type: "FOR_EACH", selector: { who: "opponent", type: "Character" } });
  });

  it("remove up to N damage", () => {
    const [n] = nodes("Remove up to 3 damage from chosen character.");
    expect(n).toMatchObject({ type: "REMOVE_DAMAGE", amount: 3, target: { chosen: true } });
  });

  it("gain N lore / opponent loses N lore", () => {
    expect(nodes("Gain 2 lore.")).toEqual([{ type: "GAIN_LORE", amount: 2 }]);
    expect(nodes("Each opponent loses 1 lore.")).toEqual([{ type: "OPPONENT_LOSE_LORE", amount: 1 }]);
  });

  it("banish chosen character/item/location", () => {
    expect(nodes("Banish chosen character.")[0]).toMatchObject({ type: "BANISH", target: { type: "Character", chosen: true } });
    expect(nodes("Banish chosen item.")[0]).toMatchObject({ type: "BANISH", target: { type: "Item", chosen: true } });
    expect(nodes("Banish chosen location.")[0]).toMatchObject({ type: "BANISH", target: { type: "Location", chosen: true } });
  });

  it("return chosen character to hand / card from discard", () => {
    expect(nodes("Return chosen character to their player's hand.")[0]).toMatchObject({ type: "RETURN_TO_HAND", target: { chosen: true } });
    const [n] = nodes("Return a character card from your discard to your hand.");
    expect(n).toMatchObject({ type: "RETURN_TO_HAND", target: { zone: "discard", type: "Character", chosen: true } });
  });

  it("ready / exert chosen character", () => {
    expect(nodes("Ready chosen character.")[0]).toMatchObject({ type: "READY", target: { chosen: true } });
    expect(nodes("Exert chosen opposing character.")[0]).toMatchObject({ type: "EXERT", target: { who: "opponent", chosen: true } });
  });

  it("chosen character gets +N {s}/{w}/{l} this turn", () => {
    const [n] = nodes("Chosen character gets +2 {s} this turn.");
    expect(n).toMatchObject({ type: "ADD_MODIFIER", duration: "this-turn", modifier: { stat: { strength: 2 } } });
    const [n2] = nodes("Chosen character gets +1 {s} and +1 {w} this turn.");
    expect(n2).toMatchObject({ type: "ADD_MODIFIER", modifier: { stat: { strength: 1, willpower: 1 } } });
  });

  it("opponent discards (chosen / random)", () => {
    expect(nodes("Each opponent chooses and discards a card.")).toEqual([
      { type: "DISCARD", amount: 1, who: "opponent", mode: "chosen" },
    ]);
    expect(nodes("Choose and discard a card.")).toEqual([
      { type: "DISCARD", amount: 1, who: "self", mode: "chosen" },
    ]);
  });

  it("look at the top N / put top card into inkwell", () => {
    expect(nodes("Look at the top 4 cards of your deck.")).toEqual([{ type: "LOOK_TOP", amount: 4, then: "keep-order" }]);
    expect(nodes("Put the top card of your deck into your inkwell facedown and exerted.")).toEqual([
      { type: "PUT_INTO_INKWELL", source: "top-deck" },
    ]);
  });

  it("search deck for X", () => {
    const [n] = nodes("Search your deck for a character card and put it into your hand.");
    expect(n).toMatchObject({ type: "SEARCH_DECK", filter: { type: "Character" }, into: "hand" });
  });

  it("'you may X' becomes an optional CHOICE", () => {
    const [n] = nodes("You may draw a card.");
    expect(n).toMatchObject({ type: "CHOICE", min: 0, max: 1 });
    expect((n as { options: EffectNode[][] }).options[0]).toEqual([{ type: "DRAW", amount: 1 }]);
  });

  it("'X, then Y' sequences both effects", () => {
    expect(nodes("Draw a card, then choose and discard a card.")).toEqual([
      { type: "DRAW", amount: 1 },
      { type: "DISCARD", amount: 1, who: "self", mode: "chosen" },
    ]);
  });

  it("keyword grants with parameters", () => {
    expect(nodes("Chosen character gains Challenger +2 this turn.")[0]).toMatchObject({
      type: "GRANT_KEYWORD", keyword: "Challenger", value: 2,
    });
    expect(nodes("Chosen character gains Evasive until the start of your next turn.")[0]).toMatchObject({
      type: "GRANT_KEYWORD", keyword: "Evasive",
    });
  });

  it("rejects sentences it does not understand", () => {
    expect(matchSentence("Whenever a card is put into your inkwell, draw a card.", ctx).matched).toBe(false);
  });
});

function fakeCard(partial: Partial<CardDefinition>): CardDefinition {
  return {
    id: "TST-001", name: "Test", fullName: "Test", type: "Character", colors: ["Amber"],
    cost: 3, inkable: true, classifications: [], bodyText: "", rarity: "Common",
    setId: "TST", setNum: 1, cardNum: 1, imageUrl: "", ...partial,
  };
}

describe("block-level generation", () => {
  it("maps 'When you play this character' to ON_PLAY with ability name", () => {
    const { script, tier } = generateScript(fakeCard({ bodyText: "DESTINY CALLING: When you play this character, you may draw a card." }));
    expect(tier).toBe("full");
    expect(script.triggered).toHaveLength(1);
    expect(script.triggered![0]).toMatchObject({ name: "DESTINY CALLING", trigger: "ON_PLAY" });
  });

  it("maps 'Whenever this character quests' to ON_QUEST", () => {
    const { script } = generateScript(fakeCard({ bodyText: "Whenever this character quests, deal 1 damage to chosen character." }));
    expect(script.triggered![0].trigger).toBe("ON_QUEST");
  });

  it("maps 'At the start of your turn' to START_OF_TURN", () => {
    const { script } = generateScript(fakeCard({ bodyText: "At the start of your turn, gain 1 lore." }));
    expect(script.triggered![0].trigger).toBe("START_OF_TURN");
  });

  it("maps 'your other characters get +N {w}' to a continuous buff", () => {
    const { script, tier } = generateScript(fakeCard({ bodyText: "Destiny Calling: Your other characters get +2 {w}." }));
    expect(tier).toBe("full");
    expect(script.continuous![0]).toMatchObject({
      name: "Destiny Calling",
      selector: { who: "self", type: "Character" },
      modifier: { stat: { willpower: 2 } },
    });
  });

  it("parses activated abilities with {e}/ink/banish costs", () => {
    const { script } = generateScript(fakeCard({
      type: "Item",
      bodyText: "SUPPRESSED ANGER: {e}, 1 {i} - Put 1 damage counter on chosen character.",
    }));
    expect(script.activated![0]).toMatchObject({
      name: "SUPPRESSED ANGER",
      cost: { exert: true, ink: 1 },
    });
    const banish = generateScript(fakeCard({
      type: "Item",
      bodyText: "{e}, Banish this item - Banish chosen character.",
    }));
    expect(banish.script.activated![0].cost).toMatchObject({ exert: true, banishSelf: true });
  });

  it("handles 'choose one' bullet lists", () => {
    const { script, tier } = generateScript(fakeCard({
      bodyText: "At the start of your turn, you may choose one:\n- This character gets +1 {l} this turn.\n- Draw a card.",
    }));
    expect(tier).toBe("full");
    const choice = script.triggered![0].effects.find((e) => e.type === "CHOICE");
    expect(choice).toBeDefined();
  });

  it("emits keyword-only scripts for vanilla-with-keywords cards", () => {
    const { script, tier } = generateScript(fakeCard({ bodyText: "Rush (This character can challenge the turn they're played.)" }));
    expect(tier).toBe("full");
    expect(script.keywords).toEqual([{ name: "Rush" }]);
    const vanilla = generateScript(fakeCard({ bodyText: "" }));
    expect(vanilla.tier).toBe("vanilla");
    expect(vanilla.script).toEqual({ cardId: "TST-001" });
  });

  it("marks partially matched cards as partial", () => {
    const { tier } = generateScript(fakeCard({
      bodyText: "When you play this character, draw a card. Whenever a card is put into your inkwell, look at the top card of your deck.",
    }));
    expect(tier).toBe("partial");
  });
});
