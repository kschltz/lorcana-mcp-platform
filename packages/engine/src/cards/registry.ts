// Card registry: static CardDefinition[] + CardScript records keyed by cardId.
// Cards without a script are playable as vanilla (stats/keywords only).
// Also ships a small hand-written fixture used by engine tests (and reusable
// by other packages' tests).

import type { CardDefinition } from "../types.js";
import { validateCardScript, type CardScript } from "../effects/dsl.js";

export class CardRegistry {
  private defs = new Map<string, CardDefinition>();
  private scripts = new Map<string, CardScript>();

  constructor(defs: CardDefinition[], scripts: Record<string, CardScript> = {}) {
    for (const d of defs) this.defs.set(d.id, d);
    for (const [cardId, script] of Object.entries(scripts)) this.scripts.set(cardId, script);
  }

  has(cardId: string): boolean {
    return this.defs.has(cardId);
  }

  /** Static definition; throws on unknown card id. */
  get(cardId: string): CardDefinition {
    const d = this.defs.get(cardId);
    if (!d) throw new Error(`unknown card id "${cardId}"`);
    return d;
  }

  /** Script for a card; unknown script = vanilla card (stats only). */
  getScript(cardId: string): CardScript {
    return this.scripts.get(cardId) ?? { cardId };
  }

  all(): CardDefinition[] {
    return [...this.defs.values()];
  }

  /** Schema-validate every loaded script; map of cardId → problems (empty = all ok). */
  validateScripts(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [cardId, script] of this.scripts) {
      const errs = validateCardScript(script);
      if (script.cardId !== cardId) errs.push(`script.cardId "${script.cardId}" != key "${cardId}"`);
      if (errs.length > 0) out[cardId] = errs;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Built-in test fixture (~12 hand-written cards covering every keyword path).
// ---------------------------------------------------------------------------

function def(partial: Partial<CardDefinition> & Pick<CardDefinition,
  "id" | "name" | "fullName" | "type" | "colors" | "cost" | "inkable">): CardDefinition {
  return {
    classifications: [],
    bodyText: "",
    rarity: "Common",
    setId: "TST",
    setNum: Number(partial.id.split("-")[1] ?? 0),
    cardNum: Number(partial.id.split("-")[1] ?? 0),
    imageUrl: `https://example.test/img/${partial.id}.png`,
    ...partial,
  };
}

export const FIXTURE_CARDS: CardDefinition[] = [
  // vanilla questers
  def({ id: "TST-001", name: "Pico", fullName: "Pico - Helpful Mouse", type: "Character",
    colors: ["Amber"], cost: 1, inkable: true, strength: 1, willpower: 1, lore: 1,
    classifications: ["Storyborn", "Ally"] }),
  def({ id: "TST-002", name: "Stitch", fullName: "Stitch - Little Guy", type: "Character",
    colors: ["Emerald"], cost: 3, inkable: true, strength: 3, willpower: 3, lore: 2,
    classifications: ["Storyborn", "Alien"] }),
  // Rush
  def({ id: "TST-003", name: "Dash", fullName: "Dash - Quick Sprinter", type: "Character",
    colors: ["Ruby"], cost: 2, inkable: true, strength: 2, willpower: 2, lore: 1,
    classifications: ["Storyborn", "Hero"], bodyText: "Rush" }),
  // Bodyguard
  def({ id: "TST-004", name: "Goliath", fullName: "Goliath - Castle Guardian", type: "Character",
    colors: ["Steel"], cost: 4, inkable: true, strength: 3, willpower: 5, lore: 1,
    classifications: ["Storyborn", "Guardian"], bodyText: "Bodyguard" }),
  // Resist 2
  def({ id: "TST-005", name: "Boulder", fullName: "Boulder - Stone Wall", type: "Character",
    colors: ["Sapphire"], cost: 4, inkable: true, strength: 2, willpower: 6, lore: 1,
    classifications: ["Storyborn"], bodyText: "Resist +2" }),
  // Challenger +2
  def({ id: "TST-006", name: "Rex", fullName: "Rex - Fierce Challenger", type: "Character",
    colors: ["Ruby"], cost: 3, inkable: true, strength: 2, willpower: 4, lore: 2,
    classifications: ["Storyborn"], bodyText: "Challenger +2" }),
  // Support
  def({ id: "TST-007", name: "Remy", fullName: "Remy - Little Chef", type: "Character",
    colors: ["Amber"], cost: 2, inkable: true, strength: 2, willpower: 2, lore: 1,
    classifications: ["Storyborn", "Ally"], bodyText: "Support" }),
  // Song with a draw effect
  def({ id: "TST-008", name: "Be Our Guest", fullName: "Be Our Guest", type: "Action",
    colors: ["Emerald"], cost: 3, inkable: true,
    classifications: ["Song"], bodyText: "Draw 2 cards." }),
  // action dealing 3 damage to a chosen opposing character
  def({ id: "TST-009", name: "Fire the Cannons", fullName: "Fire the Cannons", type: "Action",
    colors: ["Steel"], cost: 2, inkable: false,
    classifications: [], bodyText: "Deal 3 damage to chosen opposing character." }),
  // location
  def({ id: "TST-010", name: "Mystic Cave", fullName: "Mystic Cave - Hidden Hollow", type: "Location",
    colors: ["Amethyst"], cost: 2, inkable: true, willpower: 6, lore: 1, moveCost: 1,
    classifications: [] }),
  // item with an activated ability
  def({ id: "TST-011", name: "Magic Mirror", fullName: "Magic Mirror - Seeing All", type: "Item",
    colors: ["Sapphire"], cost: 2, inkable: true,
    classifications: [], bodyText: "{e} Draw a card." }),
  // Evasive
  def({ id: "TST-012", name: "Peter Pan", fullName: "Peter Pan - Never Landing", type: "Character",
    colors: ["Emerald"], cost: 3, inkable: true, strength: 2, willpower: 2, lore: 2,
    classifications: ["Storyborn", "Hero"], bodyText: "Evasive" }),
  // Shift Floodborn (shifts onto "Stitch")
  def({ id: "TST-013", name: "Stitch", fullName: "Stitch - Abomination", type: "Character",
    colors: ["Emerald"], cost: 6, inkable: true, strength: 5, willpower: 5, lore: 3,
    classifications: ["Floodborn", "Alien"], bodyText: "Shift 4" }),
  // Singer 5 (can sing expensive songs)
  def({ id: "TST-014", name: "Ariel", fullName: "Ariel - Spectacular Singer", type: "Character",
    colors: ["Amber"], cost: 2, inkable: true, strength: 1, willpower: 2, lore: 1,
    classifications: ["Storyborn", "Princess"], bodyText: "Singer 5" }),
  // ON_QUEST trigger (engine/DSL trigger coverage)
  def({ id: "TST-015", name: "Merlin", fullName: "Merlin - Turtle", type: "Character",
    colors: ["Amethyst"], cost: 3, inkable: true, strength: 2, willpower: 3, lore: 1,
    classifications: ["Storyborn", "Sorcerer"], bodyText: "When this quests, gain 1 lore." }),
  // Reckless (can't quest, must challenge if able)
  def({ id: "TST-016", name: "Beast", fullName: "Beast - Reckless Rager", type: "Character",
    colors: ["Ruby"], cost: 3, inkable: true, strength: 4, willpower: 3, lore: 1,
    classifications: ["Storyborn"], bodyText: "Reckless" }),
  // Alert (can challenge ready characters)
  def({ id: "TST-017", name: "Robin Hood", fullName: "Robin Hood - Sneaky Archer", type: "Character",
    colors: ["Emerald"], cost: 3, inkable: true, strength: 3, willpower: 2, lore: 1,
    classifications: ["Storyborn", "Hero"], bodyText: "Alert" }),
];

export const FIXTURE_SCRIPTS: Record<string, CardScript> = {
  "TST-003": { cardId: "TST-003", keywords: [{ name: "Rush" }] },
  "TST-004": { cardId: "TST-004", keywords: [{ name: "Bodyguard" }] },
  "TST-005": { cardId: "TST-005", keywords: [{ name: "Resist", value: 2 }] },
  "TST-006": { cardId: "TST-006", keywords: [{ name: "Challenger", value: 2 }] },
  "TST-007": { cardId: "TST-007", keywords: [{ name: "Support" }] },
  "TST-008": {
    cardId: "TST-008",
    triggered: [{ name: "Be Our Guest", trigger: "ON_PLAY", effects: [{ type: "DRAW", amount: 2 }] }],
  },
  "TST-009": {
    cardId: "TST-009",
    triggered: [{
      name: "Fire the Cannons", trigger: "ON_PLAY",
      effects: [{
        type: "DEAL_DAMAGE", amount: 3,
        target: { zone: "play", who: "opponent", type: "Character", chosen: true },
      }],
    }],
  },
  "TST-011": {
    cardId: "TST-011",
    activated: [{ name: "See All", cost: { exert: true }, effects: [{ type: "DRAW", amount: 1 }], oncePerTurn: true }],
  },
  "TST-012": { cardId: "TST-012", keywords: [{ name: "Evasive" }] },
  "TST-013": { cardId: "TST-013", keywords: [{ name: "Shift", value: 4 }], shiftCost: 4 },
  "TST-014": { cardId: "TST-014", keywords: [{ name: "Singer", value: 5 }] },
  "TST-015": {
    cardId: "TST-015",
    triggered: [{ trigger: "ON_QUEST", effects: [{ type: "GAIN_LORE", amount: 1 }] }],
  },
  "TST-016": { cardId: "TST-016", keywords: [{ name: "Reckless" }] },
  "TST-017": { cardId: "TST-017", keywords: [{ name: "Alert" }] },
};

/** Registry pre-loaded with the fixture cards + scripts. */
export function createTestRegistry(): CardRegistry {
  return new CardRegistry(FIXTURE_CARDS, FIXTURE_SCRIPTS);
}
