/**
 * policy.test.ts — unit tests for the heuristic policy on crafted fog-of-war
 * view fixtures. No server involved: chooseAction is pure.
 */
import { describe, expect, it } from "vitest";
import { chooseAction } from "../src/policy.js";
import type {
  CardDefinition,
  EnrichedCardInstance,
  LegalAction,
  PendingChoice,
  PlayerAction,
  PlayerId,
  PlayerView,
  ViewPlayerState,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

let seq = 0;

function card(over: Partial<CardDefinition> = {}): CardDefinition {
  seq++;
  return {
    id: `TST-${String(seq).padStart(3, "0")}`,
    name: `Card${seq}`,
    fullName: `Card${seq} - Test`,
    type: "Character",
    colors: ["Amber"],
    cost: 3,
    inkable: true,
    strength: 2,
    willpower: 3,
    lore: 1,
    classifications: [],
    bodyText: "",
    rarity: "Common",
    setId: "TST",
    setNum: 1,
    cardNum: seq,
    imageUrl: "",
    ...over,
  };
}

function inst(over: Partial<EnrichedCardInstance> = {}): EnrichedCardInstance {
  seq++;
  return {
    instanceId: `m1-${String(seq).padStart(4, "0")}`,
    cardId: "TST-001",
    owner: "p1",
    zone: "play",
    exerted: false,
    damage: 0,
    enteredTurn: 1,
    modifiers: [],
    card: card(),
    ...over,
  };
}

function playerState(id: PlayerId, over: Partial<ViewPlayerState> = {}): ViewPlayerState {
  return {
    id,
    lore: 0,
    inkPlayedThisTurn: 1,
    mulliganDone: true,
    inkTotal: 3,
    inkAvailable: 3,
    deck: { count: 40 },
    hand: { count: 0 },
    inkwell: { count: 3 },
    discard: [],
    play: [],
    ...over,
  };
}

function makeView(over: {
  you?: PlayerId;
  phase?: PlayerView["phase"];
  turn?: number;
  pendingChoice?: PendingChoice;
  p1?: Partial<ViewPlayerState>;
  p2?: Partial<ViewPlayerState>;
}): PlayerView {
  const you = over.you ?? "p1";
  return {
    matchId: "m1",
    turn: over.turn ?? 3,
    activePlayer: you,
    phase: over.phase ?? "main",
    you,
    players: {
      p1: playerState("p1", over.p1),
      p2: playerState("p2", over.p2),
    },
    pendingChoice: over.pendingChoice,
    log: [],
  };
}

function la(action: PlayerAction, description = ""): LegalAction {
  return { action, description };
}

function subsets<T>(items: T[]): T[][] {
  const out: T[][] = [[]];
  for (const it of items) out.push(...out.map((s) => [...s, it]));
  return out;
}

function combos<T>(items: T[], min: number, max: number): T[][] {
  return subsets(items).filter((s) => s.length >= min && s.length <= max);
}

// ---------------------------------------------------------------------------
// Mulligan
// ---------------------------------------------------------------------------

describe("mulligan", () => {
  it("keeps ≤3-cost inkables plus a couple of cheap playables, redraws the rest", () => {
    const cheapInk1 = inst({ zone: "hand", card: card({ cost: 2, inkable: true }) });
    const cheapInk2 = inst({ zone: "hand", card: card({ cost: 3, inkable: true }) });
    const cheapInk3 = inst({ zone: "hand", card: card({ cost: 1, inkable: true }) });
    const bigInk = inst({ zone: "hand", card: card({ cost: 6, inkable: true }) });
    const cheapPlay = inst({ zone: "hand", card: card({ cost: 2, inkable: false }) });
    const midPlay = inst({ zone: "hand", card: card({ cost: 4, inkable: false }) });
    const bigPlay = inst({ zone: "hand", card: card({ cost: 7, inkable: false }) });
    const hand = [cheapInk1, cheapInk2, cheapInk3, bigInk, cheapPlay, midPlay, bigPlay];

    const view = makeView({ phase: "mulligan", turn: 1, p1: { hand } });
    const legal = subsets(hand.map((c) => c.instanceId)).map((keep) =>
      la({ type: "MULLIGAN", keep }),
    );
    const chosen = chooseAction(view, legal);
    expect(chosen.type).toBe("MULLIGAN");
    const keep = new Set((chosen as { keep: string[] }).keep);
    expect(keep).toEqual(
      new Set([cheapInk1, cheapInk2, cheapInk3, cheapPlay, midPlay].map((c) => c.instanceId)),
    );
  });

  it("keeps at least one inkable even when none is cheap", () => {
    const pricey = inst({ zone: "hand", card: card({ cost: 5, inkable: true }) });
    const nonInk = inst({ zone: "hand", card: card({ cost: 6, inkable: false }) });
    const hand = [pricey, nonInk];
    const view = makeView({ phase: "mulligan", turn: 1, p1: { hand } });
    const legal = subsets(hand.map((c) => c.instanceId)).map((keep) =>
      la({ type: "MULLIGAN", keep }),
    );
    const chosen = chooseAction(view, legal) as { keep: string[] };
    expect(chosen.keep).toContain(pricey.instanceId);
  });
});

// ---------------------------------------------------------------------------
// Ink & playing cards
// ---------------------------------------------------------------------------

describe("ink & plays", () => {
  it("inks the highest-cost inkable before anything else", () => {
    const cheap = inst({ zone: "hand", card: card({ cost: 2 }) });
    const pricey = inst({ zone: "hand", card: card({ cost: 5 }) });
    const view = makeView({ p1: { hand: [cheap, pricey], inkPlayedThisTurn: 0 } });
    const legal = [
      la({ type: "PLAY_INK", cardInstanceId: cheap.instanceId }),
      la({ type: "PLAY_INK", cardInstanceId: pricey.instanceId }),
      la({ type: "PLAY_CARD", cardInstanceId: cheap.instanceId }),
      la({ type: "PASS" }),
    ];
    expect(chooseAction(view, legal)).toEqual({ type: "PLAY_INK", cardInstanceId: pricey.instanceId });
  });

  it("plays an on-curve character over a cheap item", () => {
    const char = inst({ zone: "hand", card: card({ cost: 3, lore: 2, strength: 3, willpower: 4 }) });
    const item = inst({ zone: "hand", card: card({ type: "Item", cost: 2, strength: undefined, willpower: undefined, lore: undefined }) });
    const view = makeView({ p1: { hand: [char, item], inkAvailable: 3 } });
    const legal = [
      la({ type: "PLAY_CARD", cardInstanceId: char.instanceId }),
      la({ type: "PLAY_CARD", cardInstanceId: item.instanceId }),
      la({ type: "PASS" }),
    ];
    expect(chooseAction(view, legal)).toEqual({ type: "PLAY_CARD", cardInstanceId: char.instanceId });
  });

  it("prefers singing a draw-song for free", () => {
    const song = inst({
      zone: "hand",
      card: card({ type: "Action", cost: 4, classifications: ["Song"], bodyText: "Draw 2 cards.", strength: undefined, willpower: undefined, lore: undefined }),
    });
    const singer = inst({ card: card({ cost: 4 }) });
    const char = inst({ zone: "hand", card: card({ cost: 3 }) });
    const view = makeView({ p1: { hand: [song, char], play: [singer], inkAvailable: 3 } });
    const legal = [
      la({ type: "PLAY_CARD", cardInstanceId: song.instanceId, choices: { payAlternatives: { mode: "sing", singer: singer.instanceId } } }),
      la({ type: "PLAY_CARD", cardInstanceId: char.instanceId }),
      la({ type: "PASS" }),
    ];
    expect(chooseAction(view, legal)).toEqual({
      type: "PLAY_CARD",
      cardInstanceId: song.instanceId,
      choices: { payAlternatives: { mode: "sing", singer: singer.instanceId } },
    });
  });
});

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

describe("challenges", () => {
  it("takes a favorable trade: banishes the defender and survives", () => {
    const attacker = inst({ card: card({ strength: 4, willpower: 4, lore: 1 }) });
    const defender = inst({ owner: "p2", exerted: true, card: card({ strength: 3, willpower: 3, lore: 1 }) });
    const view = makeView({ p1: { play: [attacker] }, p2: { play: [defender] } });
    const legal = [
      la({ type: "CHALLENGE", attackerId: attacker.instanceId, defenderId: defender.instanceId }),
      la({ type: "PASS" }),
    ];
    expect(chooseAction(view, legal)).toEqual({
      type: "CHALLENGE", attackerId: attacker.instanceId, defenderId: defender.instanceId,
    });
  });

  it("never suicides: passes when the attacker dies without banishing", () => {
    const attacker = inst({ card: card({ strength: 2, willpower: 2, lore: 2 }) });
    const defender = inst({ owner: "p2", exerted: true, card: card({ strength: 5, willpower: 5, lore: 1 }) });
    const view = makeView({ p1: { play: [attacker] }, p2: { play: [defender] } });
    const legal = [
      la({ type: "CHALLENGE", attackerId: attacker.instanceId, defenderId: defender.instanceId }),
      la({ type: "PASS" }),
    ];
    expect(chooseAction(view, legal)).toEqual({ type: "PASS" });
  });

  it("trades up into a high-lore bodyguard blocker", () => {
    const attacker = inst({ card: card({ cost: 3, strength: 3, willpower: 3, lore: 1 }) });
    const defender = inst({
      owner: "p2",
      exerted: true,
      card: card({ cost: 3, strength: 3, willpower: 3, lore: 2, bodyText: "**Bodyguard**" }),
    });
    const view = makeView({ p1: { play: [attacker] }, p2: { play: [defender] } });
    const legal = [
      la({ type: "CHALLENGE", attackerId: attacker.instanceId, defenderId: defender.instanceId }),
      la({ type: "PASS" }),
    ];
    expect(chooseAction(view, legal)).toEqual({
      type: "CHALLENGE", attackerId: attacker.instanceId, defenderId: defender.instanceId,
    });
  });

  it("takes the least-bad challenge when PASS is illegal (Reckless)", () => {
    const attacker = inst({ card: card({ strength: 5, willpower: 5, lore: 0 }) });
    const defender = inst({ owner: "p2", exerted: true, card: card({ strength: 6, willpower: 3, lore: 1 }) });
    const view = makeView({ p1: { play: [attacker] }, p2: { play: [defender] } });
    // kills (5 >= 3) but dies (6 >= 5): not favorable, but PASS is unavailable.
    const legal = [
      la({ type: "CHALLENGE", attackerId: attacker.instanceId, defenderId: defender.instanceId }),
    ];
    expect(chooseAction(view, legal)).toEqual({
      type: "CHALLENGE", attackerId: attacker.instanceId, defenderId: defender.instanceId,
    });
  });
});

// ---------------------------------------------------------------------------
// Questing
// ---------------------------------------------------------------------------

describe("questing", () => {
  it("quests with a dry character when safe", () => {
    const quester = inst({ card: card({ strength: 2, willpower: 3, lore: 2 }) });
    const view = makeView({ p1: { play: [quester] } });
    const legal = [la({ type: "QUEST", characterId: quester.instanceId }), la({ type: "PASS" })];
    expect(chooseAction(view, legal)).toEqual({ type: "QUEST", characterId: quester.instanceId });
  });

  it("holds back a 1-lore chump that would die to a ready attacker", () => {
    const chump = inst({ card: card({ strength: 1, willpower: 2, lore: 1 }) });
    const threat = inst({ owner: "p2", card: card({ strength: 3, willpower: 3, lore: 1 }) });
    const view = makeView({ p1: { play: [chump] }, p2: { play: [threat] } });
    const legal = [la({ type: "QUEST", characterId: chump.instanceId }), la({ type: "PASS" })];
    expect(chooseAction(view, legal)).toEqual({ type: "PASS" });
  });

  it("quests for the win even into a lethal threat", () => {
    const chump = inst({ card: card({ strength: 1, willpower: 2, lore: 1 }) });
    const threat = inst({ owner: "p2", card: card({ strength: 3, willpower: 3, lore: 1 }) });
    const view = makeView({ p1: { play: [chump], lore: 19 }, p2: { play: [threat] } });
    const legal = [la({ type: "QUEST", characterId: chump.instanceId }), la({ type: "PASS" })];
    expect(chooseAction(view, legal)).toEqual({ type: "QUEST", characterId: chump.instanceId });
  });
});

// ---------------------------------------------------------------------------
// Pending choices
// ---------------------------------------------------------------------------

function resolveLegal(choice: PendingChoice): LegalAction[] {
  return combos(choice.options.map((o) => o.id), choice.min, choice.max).map((selected) =>
    la({ type: "RESOLVE_CHOICE", choiceId: choice.id, selected }),
  );
}

describe("choices", () => {
  it("points harmful effects at the opponent's cards", () => {
    const mine = inst({ card: card({ cost: 4 }) });
    const theirs = inst({ owner: "p2", card: card({ cost: 4 }) });
    const choice: PendingChoice = {
      id: "ch1",
      player: "p1",
      kind: "choose-target",
      prompt: "Banish chosen character",
      min: 1,
      max: 1,
      options: [
        { id: "o-mine", label: mine.card!.fullName, cardInstanceId: mine.instanceId },
        { id: "o-theirs", label: theirs.card!.fullName, cardInstanceId: theirs.instanceId },
      ],
    };
    const view = makeView({ pendingChoice: choice, p1: { play: [mine] }, p2: { play: [theirs] } });
    expect(chooseAction(view, resolveLegal(choice))).toEqual({
      type: "RESOLVE_CHOICE", choiceId: "ch1", selected: ["o-theirs"],
    });
  });

  it("takes the maximum of beneficial may-effects on its own cards", () => {
    const a = inst({ exerted: true });
    const b = inst({ exerted: true });
    const choice: PendingChoice = {
      id: "ch2",
      player: "p1",
      kind: "choose-cards",
      prompt: "Ready up to 2 chosen characters",
      min: 0,
      max: 2,
      options: [
        { id: "o-a", label: a.card!.fullName, cardInstanceId: a.instanceId },
        { id: "o-b", label: b.card!.fullName, cardInstanceId: b.instanceId },
      ],
    };
    const view = makeView({ pendingChoice: choice, p1: { play: [a, b] } });
    expect(chooseAction(view, resolveLegal(choice))).toEqual({
      type: "RESOLVE_CHOICE", choiceId: "ch2", selected: ["o-a", "o-b"],
    });
  });

  it("picks nothing for optional harmful choices", () => {
    const mine = inst({ zone: "hand" });
    const choice: PendingChoice = {
      id: "ch3",
      player: "p1",
      kind: "choose-cards",
      prompt: "You may discard chosen card",
      min: 0,
      max: 1,
      options: [{ id: "o-c", label: mine.card!.fullName, cardInstanceId: mine.instanceId }],
    };
    const view = makeView({ pendingChoice: choice, p1: { hand: [mine] } });
    expect(chooseAction(view, resolveLegal(choice))).toEqual({
      type: "RESOLVE_CHOICE", choiceId: "ch3", selected: [],
    });
  });
});

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

describe("fallback", () => {
  it("always passes when nothing productive is available", () => {
    const view = makeView({});
    expect(chooseAction(view, [la({ type: "PASS" })])).toEqual({ type: "PASS" });
  });

  it("never invents actions: result is always one of the enumerated legal actions", () => {
    const char = inst({ zone: "hand", card: card({ cost: 3 }) });
    const view = makeView({ p1: { hand: [char] } });
    const legal = [
      la({ type: "PLAY_CARD", cardInstanceId: char.instanceId }),
      la({ type: "PASS" }),
    ];
    const chosen = chooseAction(view, legal);
    expect(legal.some((l) => JSON.stringify(l.action) === JSON.stringify(chosen))).toBe(true);
  });
});
