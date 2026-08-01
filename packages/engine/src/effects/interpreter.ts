// Effect DSL interpreter (SPEC §4). Effects execute atomically in order; any
// effect needing a decision suspends resolution into PendingChoice; after
// RESOLVE_CHOICE the continuation runs. The continuation (frame queue +
// await spec) is pure JSON and lives in GameState.pendingResolution.
//
// Legality/targeting validation lives in legality.ts, not here.

import type {
  CardInstance, ChoiceOption, ExecContext, ExecFrame, GameState, Modifier, PlayerId,
} from "../types.js";
import type { EffectNode, Selector, Trigger } from "./dsl.js";
import {
  addEvent, banishInstance, cardLabel, drawCards, findInstance, gainLore, loseLore,
  modId, opponentOf, ps, putOnBottomOfDeck, returnToHand, scriptOf, defOf, activePlay, type Rt,
} from "../state.js";
import { cantReady, effStats, resistValue } from "../keywords.js";
import { applyVanish, idsToInstances, resolveSelector } from "./selectors.js";
import { evalCondition } from "./conditions.js";

type EffectsFrame = Extract<ExecFrame, { kind: "effects" }>;

export function makeCtx(controller: PlayerId, sourceId?: string): ExecContext {
  const ctx: ExecContext = { controller, bound: {}, bindSeq: 0 };
  if (sourceId !== undefined) ctx.sourceId = sourceId;
  return ctx;
}

function childCtx(ctx: ExecContext): ExecContext {
  return { ...ctx, bound: { ...ctx.bound } };
}

// ---------------------------------------------------------------------------
// Trigger collection (frames are queued FIFO; resolved in order)
// ---------------------------------------------------------------------------

function triggerFrames(rt: Rt, inst: CardInstance, trigger: Trigger): ExecFrame[] {
  const script = scriptOf(rt, inst.cardId);
  const frames: ExecFrame[] = [];
  for (const ab of script.triggered ?? []) {
    if (ab.trigger !== trigger) continue;
    frames.push({ kind: "effects", effects: [...ab.effects], ctx: makeCtx(inst.owner, inst.instanceId) });
  }
  return frames;
}

/** Queue a single card's triggers for an event. */
export function queueCardTriggers(rt: Rt, inst: CardInstance, trigger: Trigger): void {
  rt.queue.push(...triggerFrames(rt, inst, trigger));
}

/** Queue all triggers that fire when `played` enters play / is played. */
export function queuePlayTriggers(rt: Rt, played: CardInstance): void {
  const isChar = defOf(rt, played.cardId).type === "Character";
  // the played card's own ON_PLAY
  rt.queue.push(...triggerFrames(rt, played, "ON_PLAY"));
  // other in-play cards of the controller: ON_PLAY_CHARACTER
  if (isChar) {
    for (const c of activePlay(rt.state, played.owner)) {
      if (c.instanceId === played.instanceId) continue;
      rt.queue.push(...triggerFrames(rt, c, "ON_PLAY_CHARACTER"));
    }
  }
  // opponent's in-play cards: ON_OPPONENT_PLAY
  for (const c of activePlay(rt.state, opponentOf(played.owner))) {
    rt.queue.push(...triggerFrames(rt, c, "ON_OPPONENT_PLAY"));
  }
}

/** Queue ON_BANISH triggers for banished cards (top of stack first). */
export function queueBanishTriggers(rt: Rt, banished: CardInstance[]): void {
  for (const c of banished) rt.queue.push(...triggerFrames(rt, c, "ON_BANISH"));
}

/** Queue START_OF_TURN / END_OF_TURN triggers for a player's in-play cards. */
export function queueTurnTriggers(rt: Rt, player: PlayerId, trigger: Trigger): void {
  for (const c of activePlay(rt.state, player)) {
    rt.queue.push(...triggerFrames(rt, c, trigger));
  }
}

// ---------------------------------------------------------------------------
// Suspend / resume plumbing
// ---------------------------------------------------------------------------

function mirrorIntoState(rt: Rt, awaiting: import("../types.js").AwaitSpec): void {
  rt.state.pendingResolution = {
    frames: rt.queue.map((f) => structuredClone(f)),
    awaiting,
  };
  if (rt.after) rt.state.pendingResolution.after = rt.after;
}

function suspend(
  rt: Rt, choicePlayer: PlayerId, kind: import("../types.js").PendingChoice["kind"],
  prompt: string, options: ChoiceOption[], min: number, max: number,
  awaiting: import("../types.js").AwaitSpec,
): void {
  const id = `choice-${rt.state.log.length}-${rt.state.pendingChoice ? "x" : "0"}-${options.length}`;
  rt.state.pendingChoice = { id, player: choicePlayer, kind, prompt, options, min, max };
  mirrorIntoState(rt, awaiting);
}

function describeNode(n: EffectNode): string {
  switch (n.type) {
    case "DRAW": return `Draw ${n.amount}`;
    case "DEAL_DAMAGE": return `Deal ${n.amount} damage`;
    case "REMOVE_DAMAGE": return `Remove ${n.amount} damage`;
    case "GAIN_LORE": return `Gain ${n.amount} lore`;
    case "OPPONENT_LOSE_LORE": return `Opponent loses ${n.amount} lore`;
    case "BANISH": return "Banish a card";
    case "RETURN_TO_HAND": return "Return to hand";
    case "PUT_ON_BOTTOM": return "Put on bottom of deck";
    case "EXERT": return "Exert";
    case "READY": return "Ready";
    case "ADD_MODIFIER": return "Apply modifier";
    case "GRANT_KEYWORD": return `Grant ${n.keyword}`;
    case "DISCARD": return `Discard ${n.amount}`;
    case "LOOK_TOP": return `Look at top ${n.amount}`;
    case "PUT_INTO_INKWELL": return "Put into inkwell";
    case "SEARCH_DECK": return "Search deck";
    case "PLAY_CARD_FREE": return "Play a card for free";
    case "MOVE_DAMAGE": return `Move ${n.amount} damage`;
    case "PREVENT_DAMAGE": return `Prevent ${n.amount} damage`;
    case "CHOICE": return n.prompt;
    case "FOR_EACH": return "For each";
    case "IF": return "If";
  }
}

// ---------------------------------------------------------------------------
// Target binding (suspend/resume aware). Returns null when suspended.
// ---------------------------------------------------------------------------

function bindTargets(
  rt: Rt, frame: EffectsFrame, sel: Selector, callsite: string,
): CardInstance[] | null {
  const ctx = frame.ctx;
  frame.keys ??= {};
  const existing = frame.keys[callsite];
  if (existing !== undefined) {
    const bound = idsToInstances(rt, ctx.bound[existing] ?? []);
    return filterVanish(rt, bound, ctx.controller, sel);
  }
  // Self-targeting: the source card instance itself.
  if (sel.self) {
    const src = ctx.sourceId ? findInstance(rt.state, ctx.sourceId)?.inst : undefined;
    return src ? [src] : [];
  }
  // Variable reference (e.g. "$each" from FOR_EACH).
  if (sel.ref) {
    return idsToInstances(rt, ctx.bound[sel.ref] ?? []);
  }
  if (!sel.chosen) {
    return resolveSelector(rt, sel, ctx.controller);
  }
  const candidates = resolveSelector(rt, sel, ctx.controller, { chosen: true });
  const want = sel.count ?? 1;
  const min = Math.min(want, candidates.length);
  if (candidates.length === 0) {
    const name = `b${ctx.bindSeq++}`;
    ctx.bound[name] = [];
    frame.keys[callsite] = name;
    return [];
  }
  if (candidates.length <= min) {
    // must take all — no decision needed
    const name = `b${ctx.bindSeq++}`;
    ctx.bound[name] = candidates.map((c) => c.instanceId);
    frame.keys[callsite] = name;
    return filterVanish(rt, candidates, ctx.controller, sel);
  }
  const options: ChoiceOption[] = candidates.map((c) => ({
    id: c.instanceId, label: cardLabel(rt, c), cardInstanceId: c.instanceId,
  }));
  const name = `b${ctx.bindSeq}`; // assigned on resume
  frame.keys[callsite] = name;
  ctx.bindSeq++;
  suspend(rt, ctx.controller, "choose-target",
    `Choose ${want === 1 ? "a target" : `${want} targets`}`, options, min, Math.min(want, candidates.length),
    { type: "bind-target", bindAs: name, selector: sel });
  return null;
}

/** Vanish: opponent-owned chosen targets with Vanish are banished instead. */
function filterVanish(
  rt: Rt, targets: CardInstance[], controller: PlayerId, sel: Selector,
): CardInstance[] {
  if (!sel.chosen) return targets;
  return applyVanish(rt, targets, controller, (inst) => {
    const banished = banishInstance(rt, inst, "Vanish");
    queueBanishTriggers(rt, banished);
  });
}

function optionLabel(rt: Rt, id: string): string {
  const loc = findInstance(rt.state, id);
  return loc ? cardLabel(rt, loc.inst) : id;
}

// ---------------------------------------------------------------------------
// Damage / banishment helpers
// ---------------------------------------------------------------------------

export function dealDamage(rt: Rt, target: CardInstance, amount: number, opts: { ignoreResist?: boolean } = {}): void {
  let dealt = amount;
  if (!opts.ignoreResist) dealt = Math.max(0, amount - resistValue(rt, target));
  if (dealt <= 0) {
    addEvent(rt, "damage", `${cardLabel(rt, target)} resists all ${amount} damage.`, target.owner,
      { cardInstanceId: target.instanceId, amount: 0 });
    return;
  }
  target.damage += dealt;
  addEvent(rt, "damage", `${cardLabel(rt, target)} takes ${dealt} damage (${target.damage} total).`,
    target.owner, { cardInstanceId: target.instanceId, amount: dealt });
}

/** Banish a character/location whose damage met its willpower. Returns banished cards. */
export function checkBanishment(rt: Rt, inst: CardInstance, cause: string): CardInstance[] {
  if (inst.zone !== "play") return [];
  const def = defOf(rt, inst.cardId);
  if (def.type !== "Character" && def.type !== "Location") return [];
  const will = effStats(rt, inst).willpower;
  if (will > 0 && inst.damage >= will) {
    const banished = banishInstance(rt, inst, cause);
    queueBanishTriggers(rt, banished);
    return banished;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Node execution. Returns true when the node is complete; false = suspended.
// ---------------------------------------------------------------------------

function execNode(rt: Rt, node: EffectNode, frame: EffectsFrame): boolean {
  const ctx = frame.ctx;
  switch (node.type) {
    case "DRAW": {
      const drawFor = (p: PlayerId) => {
        const drawn = drawCards(rt, p, node.amount);
        addEvent(rt, "draw", `${p} draws ${drawn.length} card(s).`, p,
          { amount: drawn.length, source: ctx.sourceId });
      };
      const who = node.who ?? "self";
      if (who === "self" || who === "each") drawFor(ctx.controller);
      if (who === "opponent" || who === "each") drawFor(opponentOf(ctx.controller));
      return true;
    }
    case "DEAL_DAMAGE": {
      const targets = bindTargets(rt, frame, node.target, "t");
      if (!targets) return false;
      for (const t of targets) {
        dealDamage(rt, t, node.amount);
        checkBanishment(rt, t, "effect damage");
      }
      return true;
    }
    case "REMOVE_DAMAGE": {
      const targets = bindTargets(rt, frame, node.target, "t");
      if (!targets) return false;
      for (const t of targets) {
        const healed = Math.min(t.damage, node.amount);
        t.damage -= healed;
        addEvent(rt, "heal", `${cardLabel(rt, t)} recovers ${healed} damage.`, t.owner,
          { cardInstanceId: t.instanceId, amount: healed });
      }
      return true;
    }
    case "GAIN_LORE": {
      gainLore(rt, ctx.controller, node.amount);
      addEvent(rt, "lore", `${ctx.controller} gains ${node.amount} lore from an effect.`, ctx.controller,
        { amount: node.amount, source: ctx.sourceId });
      return true;
    }
    case "OPPONENT_LOSE_LORE": {
      loseLore(rt, opponentOf(ctx.controller), node.amount);
      addEvent(rt, "lore", `${opponentOf(ctx.controller)} loses ${node.amount} lore.`, ctx.controller,
        { amount: node.amount });
      return true;
    }
    case "BANISH": {
      const targets = bindTargets(rt, frame, node.target, "t");
      if (!targets) return false;
      for (const t of targets) {
        const banished = banishInstance(rt, t, "effect");
        queueBanishTriggers(rt, banished);
      }
      return true;
    }
    case "RETURN_TO_HAND": {
      const targets = bindTargets(rt, frame, node.target, "t");
      if (!targets) return false;
      for (const t of targets) returnToHand(rt, t);
      return true;
    }
    case "PUT_ON_BOTTOM": {
      const targets = bindTargets(rt, frame, node.target, "t");
      if (!targets) return false;
      for (const t of targets) putOnBottomOfDeck(rt, t);
      return true;
    }
    case "EXERT": {
      const targets = bindTargets(rt, frame, node.target, "t");
      if (!targets) return false;
      for (const t of targets) t.exerted = true;
      return true;
    }
    case "READY": {
      const targets = bindTargets(rt, frame, node.target, "t");
      if (!targets) return false;
      for (const t of targets) if (!cantReady(rt, t)) t.exerted = false;
      return true;
    }
    case "ADD_MODIFIER": {
      const targets = bindTargets(rt, frame, node.target, "t");
      if (!targets) return false;
      for (const t of targets) {
        const m: Modifier = {
          id: modId(ctx.sourceId ?? "effect", t),
          source: ctx.sourceId ?? "effect",
          duration: node.duration,
          ...structuredClone(node.modifier),
        };
        t.modifiers.push(m);
        addEvent(rt, "modifier", `${cardLabel(rt, t)} gains a modifier (${node.duration}).`, t.owner,
          { cardInstanceId: t.instanceId, source: ctx.sourceId });
      }
      return true;
    }
    case "GRANT_KEYWORD": {
      const targets = bindTargets(rt, frame, node.target, "t");
      if (!targets) return false;
      for (const t of targets) {
        const m: Modifier = {
          id: modId(ctx.sourceId ?? "effect", t),
          source: ctx.sourceId ?? "effect",
          duration: "this-turn",
          grantKeywords: [node.keyword],
        };
        if (node.value !== undefined) {
          if (node.keyword === "Resist") m.resist = node.value;
          else if (node.keyword === "Singer") m.singerAs = node.value;
          else m.condition = `grant:${node.keyword}:${node.value}`; // parameterized grant
        }
        t.modifiers.push(m);
      }
      return true;
    }
    case "DISCARD": {
      const victim = node.who === "self" ? ctx.controller : opponentOf(ctx.controller);
      const hand = ps(rt.state, victim).hand;
      if (node.mode === "random") {
        for (let i = 0; i < node.amount && hand.length > 0; i++) {
          const idx = rt.rng.nextInt(hand.length);
          const [c] = hand.splice(idx, 1);
          if (!c) break;
          c.zone = "discard";
          ps(rt.state, victim).discard.push(c);
          addEvent(rt, "discard", `${victim} discards ${cardLabel(rt, c)} at random.`, victim,
            { cardInstanceId: c.instanceId });
        }
        return true;
      }
      // chosen: the victim picks which cards to discard
      const amount = Math.min(node.amount, hand.length);
      if (amount === 0) return true;
      frame.keys ??= {};
      const existing = frame.keys["d"];
      if (existing !== undefined) {
        const ids = ctx.bound[existing] ?? [];
        for (const id of ids) {
          const idx = hand.findIndex((c) => c.instanceId === id);
          if (idx < 0) continue;
          const [c] = hand.splice(idx, 1);
          if (!c) continue;
          c.zone = "discard";
          ps(rt.state, victim).discard.push(c);
          addEvent(rt, "discard", `${victim} discards ${cardLabel(rt, c)}.`, victim,
            { cardInstanceId: c.instanceId });
        }
        return true;
      }
      if (hand.length <= amount) {
        // no real choice — discard everything
        const name = `b${ctx.bindSeq++}`;
        ctx.bound[name] = hand.map((c) => c.instanceId);
        frame.keys["d"] = name;
        return execNode(rt, node, frame);
      }
      const name = `b${ctx.bindSeq}`;
      frame.keys["d"] = name;
      ctx.bindSeq++;
      suspend(rt, victim, "choose-cards", `Choose ${amount} card(s) to discard`,
        hand.map((c) => ({ id: c.instanceId, label: cardLabel(rt, c), cardInstanceId: c.instanceId })),
        amount, amount, { type: "choose-cards", bindAs: name });
      return false;
    }
    case "LOOK_TOP": {
      const deck = ps(rt.state, ctx.controller).deck;
      const n = Math.min(node.amount, deck.length);
      if (n === 0) return true;
      const top = deck.slice(0, n);
      if (node.then === "bottom-rest") {
        deck.splice(0, n);
        deck.push(...top);
        addEvent(rt, "look-top", `${ctx.controller} puts ${n} card(s) on the bottom of their deck.`,
          ctx.controller);
        return true;
      }
      frame.keys ??= {};
      if (node.then === "keep-order") {
        const existing = frame.keys["o"];
        if (existing !== undefined) {
          const order = ctx.bound[existing] ?? [];
          const chosen = order
            .map((id) => top.find((c) => c.instanceId === id))
            .filter((c): c is CardInstance => !!c);
          const rest = top.filter((c) => !order.includes(c.instanceId));
          deck.splice(0, n, ...chosen, ...rest);
          addEvent(rt, "look-top", `${ctx.controller} reorders the top ${n} card(s) of their deck.`,
            ctx.controller);
          return true;
        }
        if (n === 1) {
          const name = `b${ctx.bindSeq++}`;
          ctx.bound[name] = [top[0]!.instanceId];
          frame.keys["o"] = name;
          return execNode(rt, node, frame);
        }
        const name = `b${ctx.bindSeq}`;
        frame.keys["o"] = name;
        ctx.bindSeq++;
        suspend(rt, ctx.controller, "order-cards",
          `Look at the top ${n} cards; put them back in any order (pick top-to-bottom)`,
          top.map((c) => ({ id: c.instanceId, label: cardLabel(rt, c), cardInstanceId: c.instanceId })),
          n, n, { type: "order-cards", bindAs: name });
        return false;
      }
      // choose-into-hand: pick up to `n` into hand (min 1), rest on the bottom
      const existing = frame.keys["h"];
      if (existing !== undefined) {
        const ids = ctx.bound[existing] ?? [];
        const intoHand = top.filter((c) => ids.includes(c.instanceId));
        const rest = top.filter((c) => !ids.includes(c.instanceId));
        deck.splice(0, n);
        for (const c of intoHand) {
          c.zone = "hand";
          ps(rt.state, ctx.controller).hand.push(c);
        }
        deck.push(...rest);
        addEvent(rt, "look-top", `${ctx.controller} puts ${intoHand.length} card(s) into their hand.`,
          ctx.controller);
        return true;
      }
      const name = `b${ctx.bindSeq}`;
      frame.keys["h"] = name;
      ctx.bindSeq++;
      suspend(rt, ctx.controller, "choose-cards",
        `Look at the top ${n} cards; put up to ${n} into your hand (rest on bottom)`,
        top.map((c) => ({ id: c.instanceId, label: cardLabel(rt, c), cardInstanceId: c.instanceId })),
        Math.min(1, n), n, { type: "choose-cards", bindAs: name });
      return false;
    }
    case "PUT_INTO_INKWELL": {
      // Moves a card into its OWNER's inkwell (face down, ready).
      const putIntoInkwell = (c: CardInstance) => {
        const loc = findInstance(rt.state, c.instanceId);
        if (!loc) return;
        const owner = ps(rt.state, loc.owner);
        const list = loc.zone === "hand" ? owner.hand
          : loc.zone === "play" ? owner.play
          : loc.zone === "deck" ? owner.deck
          : owner.discard;
        const idx = list.findIndex((x) => x.instanceId === c.instanceId);
        if (idx < 0) return;
        list.splice(idx, 1);
        c.zone = "inkwell";
        c.exerted = false;
        c.atLocation = undefined;
        c.under = undefined;
        c.shiftedOnto = undefined;
        c.modifiers = [];
        owner.inkwell.push(c);
        addEvent(rt, "inkwell", `${cardLabel(rt, c)} is put into ${loc.owner}'s inkwell.`, loc.owner,
          { cardInstanceId: c.instanceId, source: ctx.sourceId });
      };
      // target form: put the selected card(s) into their owners' inkwells
      if (node.target) {
        const targets = bindTargets(rt, frame, node.target, "t");
        if (!targets) return false;
        for (const t of targets) putIntoInkwell(t);
        return true;
      }
      const src = node.source ?? "top-deck";
      // source:"self" — this card into its owner's inkwell
      if (src === "self") {
        const me = ctx.sourceId ? findInstance(rt.state, ctx.sourceId)?.inst : undefined;
        if (me) putIntoInkwell(me);
        return true;
      }
      // Selector form (SPEC §4 shape)
      if (src !== "top-deck") {
        const targets = bindTargets(rt, frame, src, "t");
        if (!targets) return false;
        for (const t of targets) putIntoInkwell(t);
        return true;
      }
      // default: top of the controller's deck
      const meP = ps(rt.state, ctx.controller);
      const top = meP.deck.shift();
      if (top) {
        top.zone = "inkwell";
        top.exerted = false;
        meP.inkwell.push(top);
        addEvent(rt, "inkwell", `${ctx.controller} puts the top card of their deck into their inkwell.`,
          ctx.controller);
      }
      return true;
    }
    case "SEARCH_DECK": {
      const me = ps(rt.state, ctx.controller);
      const matches = me.deck.filter((c) => {
        const d = defOf(rt, c.cardId);
        if (node.filter.type && d.type !== node.filter.type) return false;
        if (node.filter.classification && !d.classifications.includes(node.filter.classification)) return false;
        if (node.filter.name && d.name !== node.filter.name) return false;
        if (node.filter.maxCost !== undefined && d.cost > node.filter.maxCost) return false;
        return true;
      });
      frame.keys ??= {};
      const existing = frame.keys["s"];
      if (existing !== undefined) {
        const ids = ctx.bound[existing] ?? [];
        for (const id of ids) {
          const idx = me.deck.findIndex((c) => c.instanceId === id);
          if (idx < 0) continue;
          const [c] = me.deck.splice(idx, 1);
          if (!c) continue;
          if (node.into === "hand") {
            c.zone = "hand";
            me.hand.push(c);
            addEvent(rt, "search", `${ctx.controller} searches their deck for ${cardLabel(rt, c)}.`,
              ctx.controller, { cardInstanceId: c.instanceId });
          } else {
            c.zone = "play";
            c.enteredTurn = rt.state.turn;
            me.play.push(c);
            addEvent(rt, "search", `${ctx.controller} puts ${cardLabel(rt, c)} into play from their deck.`,
              ctx.controller, { cardInstanceId: c.instanceId });
            queuePlayTriggers(rt, c);
          }
        }
        rt.rng.shuffle(me.deck);
        addEvent(rt, "shuffle", `${ctx.controller} shuffles their deck.`, ctx.controller);
        return true;
      }
      if (matches.length <= 1) {
        const name = `b${ctx.bindSeq++}`;
        ctx.bound[name] = matches.map((c) => c.instanceId);
        frame.keys["s"] = name;
        return execNode(rt, node, frame);
      }
      const name = `b${ctx.bindSeq}`;
      frame.keys["s"] = name;
      ctx.bindSeq++;
      suspend(rt, ctx.controller, "choose-cards", "Choose a card from your deck",
        matches.map((c) => ({ id: c.instanceId, label: cardLabel(rt, c), cardInstanceId: c.instanceId })),
        0, 1, { type: "choose-cards", bindAs: name });
      return false;
    }
    case "PLAY_CARD_FREE": {
      const me = ps(rt.state, ctx.controller);
      const matches = me.hand.filter((c) => {
        const d = defOf(rt, c.cardId);
        if (node.filter.type && d.type !== node.filter.type) return false;
        if (node.filter.classification && !d.classifications.includes(node.filter.classification)) return false;
        if (node.filter.name && d.name !== node.filter.name) return false;
        if (node.filter.maxCost !== undefined && d.cost > node.filter.maxCost) return false;
        return true;
      });
      frame.keys ??= {};
      const existing = frame.keys["f"];
      if (existing !== undefined) {
        const ids = ctx.bound[existing] ?? [];
        for (const id of ids) {
          const idx = me.hand.findIndex((c) => c.instanceId === id);
          if (idx < 0) continue;
          const [c] = me.hand.splice(idx, 1);
          if (!c) continue;
          const d = defOf(rt, c.cardId);
          if (d.type === "Action") {
            c.zone = "discard";
            me.discard.push(c);
            queueCardTriggers(rt, c, "ON_PLAY");
          } else {
            c.zone = "play";
            c.enteredTurn = rt.state.turn;
            me.play.push(c);
            queuePlayTriggers(rt, c);
          }
          addEvent(rt, "play-free", `${ctx.controller} plays ${cardLabel(rt, c)} for free.`,
            ctx.controller, { cardInstanceId: c.instanceId });
        }
        return true;
      }
      if (matches.length === 0) {
        const name = `b${ctx.bindSeq++}`;
        ctx.bound[name] = [];
        frame.keys["f"] = name;
        return true;
      }
      if (matches.length === 1) {
        const name = `b${ctx.bindSeq++}`;
        ctx.bound[name] = [matches[0]!.instanceId];
        frame.keys["f"] = name;
        return execNode(rt, node, frame);
      }
      const name = `b${ctx.bindSeq}`;
      frame.keys["f"] = name;
      ctx.bindSeq++;
      suspend(rt, ctx.controller, "choose-cards", "Choose a card to play for free",
        matches.map((c) => ({ id: c.instanceId, label: cardLabel(rt, c), cardInstanceId: c.instanceId })),
        0, 1, { type: "choose-cards", bindAs: name });
      return false;
    }
    case "MOVE_DAMAGE": {
      const froms = bindTargets(rt, frame, node.from, "from");
      if (!froms) return false;
      const tos = bindTargets(rt, frame, node.to, "to");
      if (!tos) return false;
      const from = froms[0];
      const to = tos[0];
      if (from && to) {
        const moved = Math.min(node.amount, from.damage);
        from.damage -= moved;
        to.damage += moved;
        addEvent(rt, "move-damage", `${moved} damage moves from ${cardLabel(rt, from)} to ${cardLabel(rt, to)}.`,
          ctx.controller);
        checkBanishment(rt, to, "moved damage");
      }
      return true;
    }
    case "PREVENT_DAMAGE": {
      const targets = bindTargets(rt, frame, node.target, "t");
      if (!targets) return false;
      // Modeled as per-instance damage reduction (Resist-like) for the duration
      // (documented approximation).
      for (const t of targets) {
        t.modifiers.push({
          id: modId(ctx.sourceId ?? "effect", t),
          source: ctx.sourceId ?? "effect",
          duration: node.duration,
          resist: node.amount,
        });
      }
      return true;
    }
    case "CHOICE": {
      if (node.target) {
        const t = bindTargets(rt, frame, node.target, "ct");
        if (!t) return false;
        ctx.bound["$target"] = t.map((c) => c.instanceId);
      }
      frame.keys ??= {};
      const existing = frame.keys["c"];
      if (existing === undefined) {
        const options: ChoiceOption[] = node.options.map((branch, i) => ({
          id: String(i), label: branch.map(describeNode).join("; ") || "(nothing)",
        }));
        const min = Math.min(node.min, options.length);
        if (options.length <= min && min === node.max) {
          const name = `b${ctx.bindSeq++}`;
          ctx.bound[name] = options.map((o) => o.id);
          frame.keys["c"] = name;
        } else {
          const name = `b${ctx.bindSeq}`;
          frame.keys["c"] = name;
          ctx.bindSeq++;
          suspend(rt, ctx.controller, "choose-option", node.prompt, options,
            min, Math.min(node.max, options.length), { type: "choice-branch", bindAs: name });
          return false;
        }
      }
      const key = frame.keys["c"]!;
      const chosenIdx = (ctx.bound[key] ?? []).map(Number).sort((a, b) => a - b);
      const insertAt = 1; // right after the current frame
      const branchFrames: ExecFrame[] = [];
      for (const i of chosenIdx) {
        const branch = node.options[i];
        if (branch) branchFrames.push({ kind: "effects", effects: [...branch], ctx: childCtx(ctx) });
      }
      rt.queue.splice(insertAt, 0, ...branchFrames);
      return true;
    }
    case "FOR_EACH": {
      const targets = bindTargets(rt, frame, node.selector, "each");
      if (!targets) return false;
      const frames: ExecFrame[] = targets.map((t) => {
        const c = childCtx(ctx);
        c.bound["$each"] = [t.instanceId];
        return { kind: "effects", effects: [...node.effects], ctx: c } as ExecFrame;
      });
      rt.queue.splice(1, 0, ...frames);
      return true;
    }
    case "IF": {
      const cond = evalCondition(rt, node.condition, ctx.controller);
      const branch = cond ? node.then : (node.else ?? []);
      if (branch.length > 0) {
        rt.queue.splice(1, 0, { kind: "effects", effects: [...branch], ctx: childCtx(ctx) });
      }
      return true;
    }
  }
}

// ---------------------------------------------------------------------------
// Support keyword frames (SPEC §3.3: CHOICE + modifier when a Support quests)
// ---------------------------------------------------------------------------

function handleSupportFrame(rt: Rt, frame: Extract<ExecFrame, { kind: "support" }>): boolean {
  const loc = findInstance(rt.state, frame.sourceId);
  const supporter = loc?.inst;
  const candidates = activePlay(rt.state, frame.controller).filter(
    (c) => c.instanceId !== frame.sourceId && defOf(rt, c.cardId).type === "Character",
  );
  if (!supporter || candidates.length === 0) return true; // nothing to donate to
  const str = effStats(rt, supporter).strength;
  if (str <= 0) return true;
  suspend(rt, frame.controller, "choose-target",
    `Support: you may add ${cardLabel(rt, supporter)}'s strength (${str}) to another character this turn`,
    candidates.map((c) => ({ id: c.instanceId, label: cardLabel(rt, c), cardInstanceId: c.instanceId })),
    0, 1, { type: "support", sourceId: frame.sourceId });
  return false;
}

function applySupportChoice(rt: Rt, sourceId: string, selected: string[]): void {
  // pop the support frame
  if (rt.queue[0]?.kind === "support") rt.queue.shift();
  const targetId = selected[0];
  if (!targetId) return;
  const sup = findInstance(rt.state, sourceId)?.inst;
  const tgt = findInstance(rt.state, targetId)?.inst;
  if (!sup || !tgt) return;
  const str = effStats(rt, sup).strength;
  if (str <= 0) return;
  tgt.modifiers.push({
    id: modId(sourceId, tgt), source: sourceId, duration: "this-turn",
    stat: { strength: str },
  });
  addEvent(rt, "support", `${cardLabel(rt, sup)} supports ${cardLabel(rt, tgt)} (+${str} strength this turn).`,
    tgt.owner, { source: sourceId, target: targetId, amount: str });
}

// ---------------------------------------------------------------------------
// Queue driver
// ---------------------------------------------------------------------------

export function runQueue(rt: Rt): void {
  while (rt.queue.length > 0) {
    if (rt.state.phase === "game-over") {
      rt.queue = [];
      break;
    }
    const frame = rt.queue[0]!;
    if (frame.kind === "support") {
      const done = handleSupportFrame(rt, frame);
      if (!done) return; // suspended
      rt.queue.shift();
      continue;
    }
    if (frame.effects.length === 0) {
      rt.queue.shift();
      continue;
    }
    const node = frame.effects[0]!;
    const done = execNode(rt, node, frame);
    if (!done) return; // suspended — node stays at head, state mirrors queue
    frame.effects.shift();
    frame.keys = undefined; // node-local bindings are spent
  }
  finishQueue(rt);
}

function finishQueue(rt: Rt): void {
  rt.state.pendingResolution = undefined;
  const cb = rt.onQueueDrained;
  if (cb && rt.after) cb(); // turn.ts advances the deferred segment
}

/** Enqueue frames and run the queue (entry point used by actions/turn). */
export function runEffects(rt: Rt, frames: ExecFrame[]): void {
  rt.queue.push(...frames);
  runQueue(rt);
}

// ---------------------------------------------------------------------------
// RESOLVE_CHOICE handling
// ---------------------------------------------------------------------------

/** Returns an error string, or null on success. */
export function resolvePendingChoice(
  rt: Rt, player: PlayerId, choiceId: string, selected: string[],
): string | null {
  const state: GameState = rt.state;
  const choice = state.pendingChoice;
  if (!choice) return "no pending choice";
  if (choice.id !== choiceId) return `choice id mismatch (expected ${choice.id})`;
  if (choice.player !== player) return `waiting on ${choice.player}, not ${player}`;
  if (selected.length < choice.min || selected.length > choice.max)
    return `must select between ${choice.min} and ${choice.max} option(s)`;
  const validIds = new Set(choice.options.map((o) => o.id));
  for (const s of selected) if (!validIds.has(s)) return `invalid option id "${s}"`;
  if (choice.kind === "order-cards" && selected.length === choice.options.length) {
    const sorted = [...selected].sort();
    const expected = [...choice.options.map((o) => o.id)].sort();
    if (sorted.join("|") !== expected.join("|")) return "order-cards must arrange all options";
  }
  const res = state.pendingResolution;
  if (!res) return "no pending resolution";
  // restore the live queue from the serialized continuation
  rt.queue = res.frames;
  rt.after = res.after;
  state.pendingChoice = undefined;
  state.pendingResolution = undefined;

  const awaiting = res.awaiting;
  if (awaiting.type === "support") {
    applySupportChoice(rt, awaiting.sourceId, selected);
  } else {
    const top = rt.queue[0];
    if (!top || top.kind !== "effects") return "corrupt continuation";
    top.ctx.bound[awaiting.bindAs] = [...selected];
  }
  addEvent(rt, "choice", `${player} resolves a choice (${selected.map((s) => optionLabel(rt, s)).join(", ") || "nothing"}).`,
    player, { choiceId, selected });
  runQueue(rt);
  return null;
}
