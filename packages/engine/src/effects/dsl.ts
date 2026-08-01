// Effect DSL types (SPEC §4). Cards never contain code: every card has a JSON
// script keyed by cardId. All shapes below are pure JSON-serializable data.

import type { CardType, Keyword, Modifier } from "../types.js";

export interface CardScript {
  cardId: string;
  keywords?: { name: Keyword; value?: number }[]; // e.g. {name:"Resist",value:2}
  shiftCost?: number;
  /** Sing Together N — song may be sung by multiple characters whose costs sum to ≥ N. */
  singTogether?: number;
  triggered?: TriggeredAbility[];
  activated?: ActivatedAbility[];
  continuous?: ContinuousAbility[];
}
export interface TriggeredAbility { name?: string; trigger: Trigger; effects: EffectNode[]; }
export interface ActivatedAbility {
  name?: string; cost: AbilityCost; effects: EffectNode[];
  oncePerTurn?: boolean;
}
export interface ContinuousAbility {
  name?: string; selector: Selector;
  modifier: Omit<Modifier, "id" | "source">; condition?: Condition;
}
export type Trigger =
  | "ON_PLAY" | "ON_QUEST" | "ON_CHALLENGE_BANISH" | "ON_BANISH"
  | "START_OF_TURN" | "END_OF_TURN" | "ON_OPPONENT_PLAY" | "ON_PLAY_CHARACTER";
export interface AbilityCost { ink?: number; exert?: boolean; discard?: number; banishSelf?: boolean; }

// ---------------------------------------------------------------------------
// Selector — target queries resolved against game state.
// ---------------------------------------------------------------------------
export interface Selector {
  zone: "play" | "hand" | "discard";
  who: "self" | "opponent" | "any";
  type?: CardType;
  classification?: string;
  name?: string;
  filter?: "exerted" | "ready" | "damaged" | "undamaged" | "wet";
  /** Printed cost ≤ this value (engine extension — mass effects like Spooky Sight). */
  maxCost?: number;
  /** Effective strength ≤ this value (engine extension — Ghostly Tale / Under the Sea). */
  maxStrength?: number;
  chosen?: boolean; // chosen:true → ask player to pick (PendingChoice)
  count?: number; // how many to pick when chosen (default 1) — engine extension
  ref?: string; // variable reference, e.g. "$each" inside FOR_EACH — engine extension
  self?: boolean; // targets the source card instance itself (self-targeting abilities)
}

// ---------------------------------------------------------------------------
// Condition
// ---------------------------------------------------------------------------
export type ConditionOp = ">=" | "<=" | "==";
export type Condition =
  | { kind: "count"; selector: Selector; op: ConditionOp; value: number }
  | { kind: "has-keyword"; selector: Selector; keyword: Keyword }
  | { kind: "stat"; selector: Selector; stat: "strength" | "willpower" | "lore"; op: ConditionOp; value: number };

// ---------------------------------------------------------------------------
// EffectNode vocabulary (SPEC §4 — interpreter implements all).
// ---------------------------------------------------------------------------
export type EffectNode =
  | { type: "DRAW"; amount: number; who?: "self" | "opponent" | "each" } // default self (controller)
  | { type: "PUT_INTO_INKWELL"; source?: "top-deck" | "self" | Selector; target?: Selector }
  //   ^ target selects what to put into its owner's inkwell; absent target = top of
  //     controller's deck ("top-deck"). source:"self" = this card into its owner's inkwell.
  | { type: "DEAL_DAMAGE"; amount: number; target: Selector }
  | { type: "REMOVE_DAMAGE"; amount: number; target: Selector }
  | { type: "GAIN_LORE"; amount: number } // controller
  | { type: "OPPONENT_LOSE_LORE"; amount: number }
  | { type: "BANISH"; target: Selector }
  | { type: "RETURN_TO_HAND"; target: Selector }
  /** Put in-play card(s) on the bottom of their owner's deck (Under the Sea, etc.). */
  | { type: "PUT_ON_BOTTOM"; target: Selector }
  | { type: "EXERT"; target: Selector }
  | { type: "READY"; target: Selector }
  | { type: "ADD_MODIFIER"; target: Selector; modifier: Omit<Modifier, "id" | "source" | "duration">; duration: Modifier["duration"] }
  | { type: "GRANT_KEYWORD"; target: Selector; keyword: Keyword; value?: number }
  | { type: "DISCARD"; amount: number; who: "self" | "opponent"; mode: "random" | "chosen" }
  | { type: "LOOK_TOP"; amount: number; then: "keep-order" | "bottom-rest" | "choose-into-hand" }
  | { type: "SEARCH_DECK"; filter: DeckFilter; into: "hand" | "play" }
  | { type: "PLAY_CARD_FREE"; filter: DeckFilter }
  | { type: "MOVE_DAMAGE"; amount: number; from: Selector; to: Selector }
  | { type: "PREVENT_DAMAGE"; amount: number; target: Selector; duration: Modifier["duration"] }
  | { type: "CHOICE"; prompt: string; options: EffectNode[][]; min: number; max: number; target?: Selector }
  | { type: "FOR_EACH"; selector: Selector; effects: EffectNode[] }
  | { type: "IF"; condition: Condition; then: EffectNode[]; else?: EffectNode[] };

/** Subset of Selector usable for deck/hand searches (no zone/who). */
export interface DeckFilter {
  type?: CardType;
  classification?: string;
  name?: string;
  maxCost?: number;
}

export const EFFECT_NODE_TYPES = [
  "DRAW", "DEAL_DAMAGE", "REMOVE_DAMAGE", "GAIN_LORE", "OPPONENT_LOSE_LORE",
  "BANISH", "RETURN_TO_HAND", "PUT_ON_BOTTOM", "EXERT", "READY", "ADD_MODIFIER", "GRANT_KEYWORD",
  "DISCARD", "LOOK_TOP", "PUT_INTO_INKWELL", "SEARCH_DECK", "PLAY_CARD_FREE",
  "MOVE_DAMAGE", "PREVENT_DAMAGE", "CHOICE", "FOR_EACH", "IF",
] as const;

export const TRIGGERS: Trigger[] = [
  "ON_PLAY", "ON_QUEST", "ON_CHALLENGE_BANISH", "ON_BANISH",
  "START_OF_TURN", "END_OF_TURN", "ON_OPPONENT_PLAY", "ON_PLAY_CHARACTER",
];

const KEYWORDS: Keyword[] = [
  "Rush", "Evasive", "Ward", "Bodyguard", "Reckless", "Support", "Resist",
  "Challenger", "Singer", "Shift", "Alert", "Vanish", "Boost",
];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Validate a Selector shape; returns a list of problems (empty = ok). */
export function validateSelector(s: unknown, path: string): string[] {
  const errs: string[] = [];
  if (!isObj(s)) return [`${path}: selector must be an object`];
  if (!["play", "hand", "discard"].includes(s.zone as string)) errs.push(`${path}.zone: invalid`);
  if (!["self", "opponent", "any"].includes(s.who as string)) errs.push(`${path}.who: invalid`);
  if (s.type !== undefined && !["Character", "Action", "Item", "Location"].includes(s.type as string))
    errs.push(`${path}.type: invalid`);
  if (s.filter !== undefined &&
      !["exerted", "ready", "damaged", "undamaged", "wet"].includes(s.filter as string))
    errs.push(`${path}.filter: invalid`);
  if (s.count !== undefined && typeof s.count !== "number") errs.push(`${path}.count: must be number`);
  if (s.maxCost !== undefined && typeof s.maxCost !== "number") errs.push(`${path}.maxCost: must be number`);
  if (s.maxStrength !== undefined && typeof s.maxStrength !== "number") errs.push(`${path}.maxStrength: must be number`);
  if (s.self !== undefined && typeof s.self !== "boolean") errs.push(`${path}.self: must be boolean`);
  return errs;
}

function validateCondition(c: unknown, path: string): string[] {
  const errs: string[] = [];
  if (!isObj(c)) return [`${path}: condition must be an object`];
  if (!["count", "has-keyword", "stat"].includes(c.kind as string)) errs.push(`${path}.kind: invalid`);
  if (c.kind === "count" || c.kind === "stat") {
    if (![">=", "<=", "=="].includes(c.op as string)) errs.push(`${path}.op: invalid`);
    if (typeof c.value !== "number") errs.push(`${path}.value: must be number`);
  }
  if (c.kind === "has-keyword" && !KEYWORDS.includes(c.keyword as Keyword))
    errs.push(`${path}.keyword: invalid`);
  if ("selector" in c) errs.push(...validateSelector(c.selector, `${path}.selector`));
  return errs;
}

function validateDeckFilter(f: unknown, path: string): string[] {
  const errs: string[] = [];
  if (!isObj(f)) return [`${path}: filter must be an object`];
  if (f.type !== undefined && !["Character", "Action", "Item", "Location"].includes(f.type as string))
    errs.push(`${path}.type: invalid`);
  if (f.maxCost !== undefined && typeof f.maxCost !== "number") errs.push(`${path}.maxCost: must be number`);
  return errs;
}

/** Validate a single EffectNode (recursively); returns problems (empty = ok). */
export function validateEffectNode(n: unknown, path: string): string[] {
  const errs: string[] = [];
  if (!isObj(n)) return [`${path}: effect node must be an object`];
  const t = n.type as string;
  if (!(EFFECT_NODE_TYPES as readonly string[]).includes(t)) {
    return [`${path}.type: unknown effect node type "${String(t)}"`];
  }
  const needAmount = ["DRAW", "DEAL_DAMAGE", "REMOVE_DAMAGE", "GAIN_LORE",
    "OPPONENT_LOSE_LORE", "DISCARD", "LOOK_TOP", "MOVE_DAMAGE", "PREVENT_DAMAGE"];
  if (needAmount.includes(t) && typeof n.amount !== "number") errs.push(`${path}.amount: must be number`);
  if (t === "DRAW" && n.who !== undefined && !["self", "opponent", "each"].includes(n.who as string))
    errs.push(`${path}.who: invalid`);
  const needTarget = ["DEAL_DAMAGE", "REMOVE_DAMAGE", "BANISH", "RETURN_TO_HAND", "PUT_ON_BOTTOM",
    "EXERT", "READY", "ADD_MODIFIER", "GRANT_KEYWORD", "PREVENT_DAMAGE"];
  if (needTarget.includes(t)) errs.push(...validateSelector(n.target, `${path}.target`));
  if (t === "MOVE_DAMAGE") {
    errs.push(...validateSelector(n.from, `${path}.from`));
    errs.push(...validateSelector(n.to, `${path}.to`));
  }
  if (t === "GRANT_KEYWORD" && !KEYWORDS.includes(n.keyword as Keyword))
    errs.push(`${path}.keyword: invalid`);
  if (t === "DISCARD") {
    if (!["self", "opponent"].includes(n.who as string)) errs.push(`${path}.who: invalid`);
    if (!["random", "chosen"].includes(n.mode as string)) errs.push(`${path}.mode: invalid`);
  }
  if (t === "LOOK_TOP" && !["keep-order", "bottom-rest", "choose-into-hand"].includes(n.then as string))
    errs.push(`${path}.then: invalid`);
  if (t === "PUT_INTO_INKWELL") {
    if (n.source !== undefined && n.source !== "top-deck" && n.source !== "self")
      errs.push(...validateSelector(n.source, `${path}.source`));
    if (n.target !== undefined) errs.push(...validateSelector(n.target, `${path}.target`));
  }
  if (t === "SEARCH_DECK") {
    errs.push(...validateDeckFilter(n.filter, `${path}.filter`));
    if (!["hand", "play"].includes(n.into as string)) errs.push(`${path}.into: invalid`);
  }
  if (t === "PLAY_CARD_FREE") errs.push(...validateDeckFilter(n.filter, `${path}.filter`));
  if (t === "CHOICE") {
    if (typeof n.prompt !== "string") errs.push(`${path}.prompt: must be string`);
    if (!Array.isArray(n.options) || n.options.length === 0) {
      errs.push(`${path}.options: must be a non-empty array of effect arrays`);
    } else {
      (n.options as unknown[]).forEach((branch, i) => {
        if (!Array.isArray(branch)) errs.push(`${path}.options[${i}]: must be an array`);
        else (branch as unknown[]).forEach((e, j) =>
          errs.push(...validateEffectNode(e, `${path}.options[${i}][${j}]`)));
      });
    }
    if (typeof n.min !== "number" || typeof n.max !== "number") errs.push(`${path}: min/max must be numbers`);
    if (n.target !== undefined) errs.push(...validateSelector(n.target, `${path}.target`));
  }
  if (t === "FOR_EACH") {
    errs.push(...validateSelector(n.selector, `${path}.selector`));
    if (!Array.isArray(n.effects)) errs.push(`${path}.effects: must be an array`);
    else (n.effects as unknown[]).forEach((e, i) =>
      errs.push(...validateEffectNode(e, `${path}.effects[${i}]`)));
  }
  if (t === "IF") {
    errs.push(...validateCondition(n.condition, `${path}.condition`));
    if (!Array.isArray(n.then)) errs.push(`${path}.then: must be an array`);
    else (n.then as unknown[]).forEach((e, i) =>
      errs.push(...validateEffectNode(e, `${path}.then[${i}]`)));
    if (n.else !== undefined) {
      if (!Array.isArray(n.else)) errs.push(`${path}.else: must be an array`);
      else (n.else as unknown[]).forEach((e, i) =>
        errs.push(...validateEffectNode(e, `${path}.else[${i}]`)));
    }
  }
  return errs;
}

/** Validate a whole CardScript; returns problems (empty = ok). */
export function validateCardScript(script: CardScript): string[] {
  const errs: string[] = [];
  if (typeof script.cardId !== "string" || script.cardId.length === 0) errs.push("cardId: required");
  for (const kw of script.keywords ?? []) {
    if (!KEYWORDS.includes(kw.name)) errs.push(`keywords: unknown keyword "${String(kw.name)}"`);
    if (kw.value !== undefined && typeof kw.value !== "number") errs.push(`keywords.${kw.name}: value must be number`);
  }
  if (script.shiftCost !== undefined && typeof script.shiftCost !== "number") errs.push("shiftCost: must be number");
  if (script.singTogether !== undefined && typeof script.singTogether !== "number") {
    errs.push("singTogether: must be number");
  }
  (script.triggered ?? []).forEach((ab, i) => {
    if (!TRIGGERS.includes(ab.trigger)) errs.push(`triggered[${i}].trigger: invalid`);
    (ab.effects ?? []).forEach((e, j) => errs.push(...validateEffectNode(e, `triggered[${i}].effects[${j}]`)));
  });
  (script.activated ?? []).forEach((ab, i) => {
    if (!isObj(ab.cost)) errs.push(`activated[${i}].cost: required`);
    (ab.effects ?? []).forEach((e, j) => errs.push(...validateEffectNode(e, `activated[${i}].effects[${j}]`)));
  });
  (script.continuous ?? []).forEach((ab, i) => {
    errs.push(...validateSelector(ab.selector, `continuous[${i}].selector`));
    if (ab.condition) errs.push(...validateCondition(ab.condition, `continuous[${i}].condition`));
    if (!isObj(ab.modifier)) errs.push(`continuous[${i}].modifier: required`);
  });
  return errs;
}
