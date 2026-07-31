/**
 * policy.ts — heuristic decision policy (SPEC §8).
 *
 * `chooseAction(view, legalActions)` is a PURE function over the fog-of-war
 * player view plus the fully-enumerated legal actions: no server access, no
 * hidden information, no memory between calls. Every returned action is one
 * of the enumerated legal actions, so a policy-driven seat can never emit an
 * INVALID_ACTION by construction.
 *
 * Priority each call (one action per call; the runner loops until PASS):
 *   0. RESOLVE_CHOICE (gates everything while a PendingChoice exists)
 *   0. MULLIGAN (during the mulligan phase)
 *   1. PLAY_INK — highest-cost inkable in hand, once per turn
 *   2. ACTIVATE_ABILITY — only clearly profitable ones (draw/lore/damage/ready)
 *   3. PLAY_CARD — draw/removal actions & sung songs > on-curve characters >
 *      items/locations with spare ink
 *   4. CHALLENGE — only favorable: banish + survive, or trading into a
 *      high-lore/bodyguard blocker; never suicide
 *   5. QUEST — lethal, safe (no ready opposing attacker kills us), or lore ≥ 2
 *   6. PASS (or the least-bad challenge when PASS is illegal, e.g. Reckless)
 */
import type {
  EnrichedCardInstance,
  LegalAction,
  PlayerAction,
  PlayerId,
  PlayerView,
  ViewCard,
} from "./types.js";

// ---------------------------------------------------------------------------
// View helpers
// ---------------------------------------------------------------------------

function oppOf(p: PlayerId): PlayerId {
  return p === "p1" ? "p2" : "p1";
}

/** Own hand is fully visible to us in a player view. */
export function ownHand(view: PlayerView): EnrichedCardInstance[] {
  const hand = view.players[view.you].hand;
  if (!Array.isArray(hand)) return [];
  return hand.filter((c): c is EnrichedCardInstance => !("facedown" in c));
}

function asInstances(cards: ViewCard[] | { count: number }): EnrichedCardInstance[] {
  if (!Array.isArray(cards)) return [];
  return cards.filter((c): c is EnrichedCardInstance => !("facedown" in c));
}

/** Every instance whose identity is visible in this view. */
export function visibleInstances(view: PlayerView): EnrichedCardInstance[] {
  const out: EnrichedCardInstance[] = [];
  for (const pid of ["p1", "p2"] as const) {
    const p = view.players[pid];
    out.push(...p.play, ...p.discard);
  }
  out.push(...ownHand(view));
  return out;
}

export function findInstance(view: PlayerView, instanceId: string): EnrichedCardInstance | undefined {
  return visibleInstances(view).find((c) => c.instanceId === instanceId);
}

// ---------------------------------------------------------------------------
// Stats & keywords (approximation from the public view: base stats + visible
// modifiers + keyword headers parsed from bodyText, e.g. "**Resist** +2")
// ---------------------------------------------------------------------------

export interface EffStats {
  strength: number;
  willpower: number;
  lore: number;
  resist: number;
  challenger: number;
  keywords: Set<string>;
}

export function effStats(inst: EnrichedCardInstance): EffStats {
  const def = inst.card;
  const kw = new Set<string>();
  let resist = 0;
  let challenger = 0;
  const text = def?.bodyText ?? "";
  // Markdown keyword headers (**Evasive**) and plain Lorcana headers
  // ("Evasive (Only characters...") both appear in card text dumps.
  for (const m of text.matchAll(/\*\*(\w+)\*\*(?:\s*\+?(\d+))?/g)) {
    kw.add(m[1]!);
    if (m[1] === "Resist") resist += Number(m[2] ?? 0);
    if (m[1] === "Challenger") challenger += Number(m[2] ?? 0);
  }
  for (const m of text.matchAll(
    /\b(Evasive|Rush|Bodyguard|Ward|Reckless|Support|Alert|Vanish|Boost)\b(?:\s*\+?(\d+))?/gi,
  )) {
    const name = m[1]![0]!.toUpperCase() + m[1]!.slice(1).toLowerCase();
    // Normalize Resist/Challenger separately below; Boost has no combat role here.
    if (name === "Resist" || name === "Challenger") continue;
    kw.add(name === "Boost" ? "Boost" : name);
  }
  for (const m of text.matchAll(/\bResist\s*\+?(\d+)/gi)) {
    kw.add("Resist");
    resist += Number(m[1] ?? 0);
  }
  for (const m of text.matchAll(/\bChallenger\s*\+?(\d+)/gi)) {
    kw.add("Challenger");
    challenger += Number(m[1] ?? 0);
  }
  let strength = def?.strength ?? 0;
  let willpower = def?.willpower ?? 0;
  let lore = def?.lore ?? 0;
  for (const mod of inst.modifiers ?? []) {
    strength += mod.stat?.strength ?? 0;
    willpower += mod.stat?.willpower ?? 0;
    lore += mod.stat?.lore ?? 0;
    resist += mod.resist ?? 0;
    for (const k of mod.grantKeywords ?? []) kw.add(k);
    for (const k of mod.removeKeywords ?? []) kw.delete(k);
  }
  return { strength, willpower, lore, resist, challenger, keywords: kw };
}

/** Rough card value for trade evaluation. */
function cardValue(inst: EnrichedCardInstance): number {
  const s = effStats(inst);
  const cost = inst.card?.cost ?? 0;
  return cost * 2 + s.lore * 6 + s.strength + s.willpower * 0.5;
}

function isDry(view: PlayerView, inst: EnrichedCardInstance): boolean {
  return inst.enteredTurn < view.turn;
}

// ---------------------------------------------------------------------------
// Mulligan
// ---------------------------------------------------------------------------

function chooseMulligan(view: PlayerView, legalActions: LegalAction[]): PlayerAction {
  const hand = ownHand(view);
  const keep = new Set<string>();

  // Keep inkables costing ≤ 3 (early ink + plays).
  for (const c of hand) {
    if (c.card?.inkable && (c.card.cost ?? 99) <= 3) keep.add(c.instanceId);
  }
  // Plus a couple of the cheapest remaining playable cards (cost ≤ 4).
  const extras = hand
    .filter((c) => !keep.has(c.instanceId) && (c.card?.cost ?? 99) <= 4)
    .sort((a, b) => (a.card?.cost ?? 99) - (b.card?.cost ?? 99));
  for (const c of extras.slice(0, 2)) keep.add(c.instanceId);
  // Guarantee at least one inkable kept (we need ink next turns).
  if (![...keep].some((id) => findInstance(view, id)?.card?.inkable)) {
    const cheapestInkable = hand
      .filter((c) => c.card?.inkable)
      .sort((a, b) => (a.card?.cost ?? 99) - (b.card?.cost ?? 99))[0];
    if (cheapestInkable) keep.add(cheapestInkable.instanceId);
  }

  const mulligans = legalActions.filter((l) => l.action.type === "MULLIGAN");
  const exact = mulligans.find((l) => {
    const k = (l.action as { keep: string[] }).keep;
    return k.length === keep.size && k.every((id) => keep.has(id));
  });
  if (exact) return exact.action;
  // Fallback: closest subset by overlap (engine enumerates all subsets, so
  // the exact one should exist; stay defensive anyway).
  const best = mulligans
    .map((l) => {
      const k = (l.action as { keep: string[] }).keep;
      const overlap = k.filter((id) => keep.has(id)).length;
      return { l, score: overlap - Math.abs(k.length - keep.size) * 0.1 };
    })
    .sort((a, b) => b.score - a.score)[0];
  return best ? best.l.action : legalActions[0].action;
}

// ---------------------------------------------------------------------------
// Pending choice (generic)
// ---------------------------------------------------------------------------

const HARM_RE = /banish|damage|discard|exert|return .*hand|return chosen|lose|put .*discard/i;
const BENEFIT_RE = /draw|ready|gain|lore|remove .*damage|heal|inkwell|play .*free/i;

type OptionKind = "own" | "opponent" | "neutral";

function chooseResolve(view: PlayerView, legalActions: LegalAction[]): PlayerAction {
  const choice = view.pendingChoice;
  const resolves = legalActions.filter((l) => l.action.type === "RESOLVE_CHOICE");
  if (resolves.length === 0) return legalActions[0].action;
  if (!choice) return resolves[0].action;

  if (choice.kind === "order-cards") {
    // Ordering matters little to us; keep high-value cards on top when visible.
    const valued = [...choice.options].sort((a, b) => {
      const ia = a.cardInstanceId ? findInstance(view, a.cardInstanceId) : undefined;
      const ib = b.cardInstanceId ? findInstance(view, b.cardInstanceId) : undefined;
      return (ib ? cardValue(ib) : 0) - (ia ? cardValue(ia) : 0);
    });
    const want = valued.map((o) => o.id);
    const exact = resolves.find((l) => {
      const s = (l.action as { selected: string[] }).selected;
      return s.length === want.length && s.every((id, i) => id === want[i]);
    });
    return (exact ?? resolves[0]).action;
  }

  const harmful = HARM_RE.test(choice.prompt);
  const beneficial = BENEFIT_RE.test(choice.prompt);

  const classify = (optionId: string): { kind: OptionKind; value: number } => {
    const opt = choice.options.find((o) => o.id === optionId);
    if (!opt?.cardInstanceId) return { kind: "neutral", value: 0 };
    const inst = findInstance(view, opt.cardInstanceId);
    if (!inst) return { kind: "neutral", value: 0 };
    return { kind: inst.owner === view.you ? "own" : "opponent", value: cardValue(inst) };
  };

  const ranked = [...choice.options].map((o) => {
    const { kind, value } = classify(o.id);
    // Label-level safety net: an option whose own label implies harm to our
    // board is treated as harmful-to-self even when the prompt is ambiguous.
    const selfHarmLabel = kind === "own" && HARM_RE.test(o.label);
    let score: number;
    if (harmful) {
      score = kind === "opponent" ? 100 + value : kind === "neutral" ? 0 : -100 - value;
    } else if (beneficial) {
      score = kind === "own" ? 100 + value : kind === "neutral" ? 0 : -100 - value;
    } else {
      score = kind === "own" ? 10 + value : kind === "neutral" ? 0 : -value;
    }
    if (selfHarmLabel) score -= 50;
    return { id: o.id, score };
  });
  ranked.sort((a, b) => b.score - a.score);

  // Harmful choices: pick only the minimum required. Beneficial "may" choices:
  // take as many positively-scored options as allowed. Neutral: the minimum.
  const howMany = harmful ? choice.min : beneficial ? Math.min(choice.max, ranked.filter((r) => r.score > 0).length || choice.min) : choice.min;
  const want = new Set(ranked.slice(0, Math.max(0, howMany)).map((r) => r.id));

  const exact = resolves.find((l) => {
    const s = (l.action as { selected: string[] }).selected;
    return s.length === want.size && s.every((id) => want.has(id));
  });
  if (exact) return exact.action;
  // Fallback: the enumerated selection with the best total score.
  const best = resolves
    .map((l) => {
      const s = (l.action as { selected: string[] }).selected;
      return { l, score: s.reduce((n, id) => n + (ranked.find((r) => r.id === id)?.score ?? 0), 0) };
    })
    .sort((a, b) => b.score - a.score)[0];
  return best ? best.l.action : resolves[0].action;
}

// ---------------------------------------------------------------------------
// Ink
// ---------------------------------------------------------------------------

function chooseInk(view: PlayerView, legalActions: LegalAction[]): PlayerAction | undefined {
  const inks = legalActions.filter((l) => l.action.type === "PLAY_INK");
  if (inks.length === 0) return undefined;
  const best = inks
    .map((l) => {
      const id = (l.action as { cardInstanceId: string }).cardInstanceId;
      return { l, cost: findInstance(view, id)?.card?.cost ?? 0 };
    })
    .sort((a, b) => b.cost - a.cost)[0];
  return best.l.action;
}

// ---------------------------------------------------------------------------
// Activated abilities
// ---------------------------------------------------------------------------

const ABILITY_VALUE_RE = /draw|gain .*lore|deal .*damage|ready chosen|remove .*damage|chosen character gets|inkwell/i;
const ABILITY_SELF_HARM_RE = /banish this|banish it|discard your hand/i;

function chooseAbility(view: PlayerView, legalActions: LegalAction[]): PlayerAction | undefined {
  const abilities = legalActions.filter((l) => l.action.type === "ACTIVATE_ABILITY");
  for (const l of abilities) {
    const id = (l.action as { cardInstanceId: string }).cardInstanceId;
    const inst = findInstance(view, id);
    const text = `${l.description} ${inst?.card?.bodyText ?? ""}`;
    if (ABILITY_SELF_HARM_RE.test(text)) continue;
    if (ABILITY_VALUE_RE.test(text)) return l.action;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Play cards
// ---------------------------------------------------------------------------

const DRAW_RE = /draw (?:a |\d+ )?card/i;
const REMOVAL_RE = /banish chosen|banish all|deal \d|damage to chosen|return chosen .* to .*hand|put all characters|exert all opposing|spooky|into their players'? inkwell/i;

function scorePlayCard(view: PlayerView, l: LegalAction): number {
  const action = l.action as { cardInstanceId: string; choices?: { options?: string[]; payAlternatives?: Record<string, string> } };
  const inst = findInstance(view, action.cardInstanceId);
  const def = inst?.card;
  if (!def) return -1;
  const me = view.players[view.you];
  const sing = action.choices?.payAlternatives?.mode === "sing";
  const shift = action.choices?.payAlternatives?.mode === "shift";
  let score: number;
  switch (def.type) {
    case "Character": {
      const onCurve = def.cost === me.inkAvailable || sing || shift;
      score = 20 + (def.lore ?? 0) * 4 + (def.strength ?? 0) + (def.willpower ?? 0) * 0.5 + def.cost * 0.5;
      if (onCurve) score += 6;
      break;
    }
    case "Action": {
      if (DRAW_RE.test(def.bodyText)) score = 32;
      else if (REMOVAL_RE.test(def.bodyText)) {
        score = 26;
        const opp = view.players[oppOf(view.you)];
        const oppChars = asInstances(opp.play).filter((c) => c.card?.type === "Character");
        const meChars = asInstances(me.play).filter((c) => c.card?.type === "Character");
        const text = def.bodyText ?? "";
        // Mass board wipes / Spooky Sight — cast into wide opposing boards.
        if (/put all characters with cost|banish all characters|exert all opposing/i.test(text)) {
          const oppLow = oppChars.filter((c) => (c.card?.cost ?? 99) <= 3).length;
          const meLow = meChars.filter((c) => (c.card?.cost ?? 99) <= 3).length;
          if (/put all characters with cost/i.test(text)) {
            // Spooky Sight also inks our ≤3s — only fire when opponent is wider.
            score = oppLow >= 3 && oppLow > meLow ? 48 : oppLow >= 2 ? 18 : 4;
          } else if (oppChars.length >= 3) {
            score = 44;
          }
        }
      } else score = 8;
      break;
    }
    case "Item":
      score = 10 + def.cost * 0.5;
      break;
    case "Location":
      score = 12 + (def.lore ?? 0) * 3 + def.cost * 0.5;
      break;
    default:
      score = 0;
  }
  if (sing) score += 15; // free spell
  if (shift) score += 4; // discounted body
  if (action.choices?.options?.includes("exert")) score -= 2; // prefer ready bodyguards
  return score;
}

function choosePlayCard(view: PlayerView, legalActions: LegalAction[]): PlayerAction | undefined {
  const plays = legalActions.filter((l) => l.action.type === "PLAY_CARD");
  if (plays.length === 0) return undefined;
  const me = view.players[view.you];
  const best = plays
    .map((l) => ({ l, score: scorePlayCard(view, l) }))
    .sort((a, b) => b.score - a.score)[0];
  // Items/locations/actions of unclear value only with spare ink (don't eat
  // the whole turn's ink on a marginal permanent).
  const a = best.l.action as { cardInstanceId: string; choices?: { payAlternatives?: Record<string, string> } };
  const def = findInstance(view, a.cardInstanceId)?.card;
  if (def && (def.type === "Item" || (def.type === "Action" && best.score <= 8)) && !a.choices?.payAlternatives) {
    if (me.inkAvailable - def.cost < 2 && def.cost >= 3) return undefined;
  }
  return best.l.action;
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

interface ChallengeEval {
  legal: LegalAction;
  kills: boolean;
  survives: boolean;
  score: number;
}

function evaluateChallenge(view: PlayerView, l: LegalAction): ChallengeEval | undefined {
  const a = l.action as { attackerId: string; defenderId: string };
  const attacker = findInstance(view, a.attackerId);
  const defender = findInstance(view, a.defenderId);
  if (!attacker?.card || !defender?.card) return undefined;
  const att = effStats(attacker);
  const def = effStats(defender);
  const attStr = att.strength + att.challenger; // Challenger applies while attacking
  const attRemainingWp = att.willpower - attacker.damage;
  const isLocation = defender.card.type === "Location";
  const defStr = isLocation ? 0 : Math.max(0, def.strength - att.resist * 0); // resist applies below
  const defRemainingWp = def.willpower - defender.damage;

  const dmgToDef = Math.max(0, attStr - def.resist);
  const dmgToAtt = Math.max(0, defStr - att.resist);
  const kills = dmgToDef >= defRemainingWp;
  const survives = dmgToAtt < attRemainingWp;

  const defValue = cardValue(defender);
  const attValue = cardValue(attacker);
  const highValueTarget = def.lore >= 2 || def.keywords.has("Bodyguard") || isLocation;

  let score = -Infinity;
  if (isLocation) {
    if (kills) score = 15 + defValue; // free hit, locations don't hit back
  } else if (kills && survives) {
    score = 20 + defValue * 0.5;
  } else if (kills && !survives && highValueTarget && defValue >= attValue * 0.8) {
    score = 12 + defValue * 0.5 - attValue * 0.3; // trade into a blocker/threat
  }
  // never: chipping damage without the kill, and never suicide
  return { legal: l, kills, survives, score };
}

function chooseChallenge(view: PlayerView, legalActions: LegalAction[]): PlayerAction | undefined {
  const evals = legalActions
    .filter((l) => l.action.type === "CHALLENGE")
    .map((l) => evaluateChallenge(view, l))
    .filter((e): e is ChallengeEval => e !== undefined);
  const favorable = evals.filter((e) => e.score > -Infinity).sort((a, b) => b.score - a.score);
  if (favorable.length > 0) return favorable[0].legal.action;

  // PASS is illegal while a Reckless character must challenge: take the
  // least-bad attack (prefer kills, then best value differential).
  const hasPass = legalActions.some((l) => l.action.type === "PASS");
  if (!hasPass && evals.length > 0) {
    const leastBad = evals
      .map((e) => {
        const a = e.legal.action as { attackerId: string; defenderId: string };
        const att = findInstance(view, a.attackerId);
        const def = findInstance(view, a.defenderId);
        const diff = (def ? cardValue(def) : 0) - (att && !e.survives ? cardValue(att) : 0);
        return { e, score: (e.kills ? 100 : 0) + diff };
      })
      .sort((a, b) => b.score - a.score)[0];
    return leastBad.e.legal.action;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Quest
// ---------------------------------------------------------------------------

function chooseQuest(view: PlayerView, legalActions: LegalAction[]): PlayerAction | undefined {
  const me = view.players[view.you];
  const opp = view.players[oppOf(view.you)];
  // Ready opposing characters that could challenge an exerted quester next turn.
  const threats = opp.play
    .filter((c) => c.card?.type === "Character" && !c.exerted && isDry(view, c))
    .map((c) => effStats(c).strength);

  // Opposing ready Evasive attackers (only they can challenge our Evasive).
  const evasiveThreats = opp.play
    .filter((c) => {
      if (c.card?.type !== "Character" || c.exerted || !isDry(view, c)) return false;
      return effStats(c).keywords.has("Evasive");
    })
    .map((c) => effStats(c).strength);

  const quests = legalActions
    .filter((l) => l.action.type === "QUEST")
    .map((l) => {
      const id = (l.action as { characterId: string }).characterId;
      const inst = findInstance(view, id);
      if (!inst) return undefined;
      const s = effStats(inst);
      const remainingWp = s.willpower - inst.damage;
      const isEvasive = s.keywords.has("Evasive");
      // Evasive questers only fear opposing Evasive attackers.
      const relevantThreats = isEvasive ? evasiveThreats : threats;
      const diesNextTurn = relevantThreats.some((str) => str >= remainingWp);
      const lethal = me.lore + s.lore >= 20;
      const safe = !diesNextTurn;
      if (!lethal && !safe && s.lore < 2) return undefined; // hold back chump questers under fire
      return { l, lore: s.lore, lethal };
    })
    .filter((q): q is { l: LegalAction; lore: number; lethal: boolean } => q !== undefined);
  if (quests.length === 0) return undefined;
  quests.sort((a, b) => Number(b.lethal) - Number(a.lethal) || b.lore - a.lore);
  return quests[0].l.action;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function chooseAction(view: PlayerView, legalActions: LegalAction[]): PlayerAction {
  if (legalActions.length === 0) return { type: "PASS" };

  const types = new Set(legalActions.map((l) => l.action.type));
  if (types.size === 1 && types.has("RESOLVE_CHOICE")) return chooseResolve(view, legalActions);
  if (types.has("MULLIGAN")) return chooseMulligan(view, legalActions);

  // In race matchups, questing L2+ characters is usually higher EV than
  // optional favorable challenges (which stall our lore clock). Prefer
  // quest-before-challenge when any legal quester has lore ≥ 2.
  const hasValueQuest = legalActions.some((l) => {
    if (l.action.type !== "QUEST") return false;
    const id = (l.action as { characterId: string }).characterId;
    const inst = findInstance(view, id);
    return !!inst && effStats(inst).lore >= 2;
  });

  return (
    chooseInk(view, legalActions) ??
    chooseAbility(view, legalActions) ??
    choosePlayCard(view, legalActions) ??
    (hasValueQuest ? chooseQuest(view, legalActions) : undefined) ??
    chooseChallenge(view, legalActions) ??
    chooseQuest(view, legalActions) ??
    legalActions.find((l) => l.action.type === "PASS")?.action ??
    // Absolute fallback (should be unreachable): first enumerated action.
    legalActions[0].action
  );
}
