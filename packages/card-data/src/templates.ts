/**
 * templates.ts — the template library that translates Lorcana Body_Text into
 * CardScript ability blocks (SPEC §4 / §5).
 *
 * Pipeline (generate-scripts.ts drives it per card):
 *   1. splitBlocks(bodyText) — reflow the hard-wrapped bulk text into ability
 *      blocks (keyword headers, named abilities, plain text).
 *   2. parseKeywordHeader — keyword headers: Rush; Evasive; Ward; Bodyguard;
 *      Support; Reckless; Alert; Vanish; Resist +N; Challenger +N; Shift N;
 *      Singer N; Boost N; (Sing Together N → Singer, documented).
 *   3. For each ability block: activated-cost prefix, trigger prefixes,
 *      continuous templates, then per-sentence EffectNode templates
 *      (SENTENCE_TEMPLATES) with "you may" / "If you do" / "choose one" /
 *      conjunction handling.
 */
import type {
  AbilityCost,
  CardDefinition,
  CardScript,
  CardType,
  ContinuousAbility,
  EffectNode,
  Keyword,
  Modifier,
  Selector,
  Trigger,
} from "./dsl-types.js";

/* ---------------------------------------------------------------- helpers */

const NUM_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
export function parseNum(raw: string): number {
  const t = raw.trim().toLowerCase();
  if (NUM_WORDS[t] !== undefined) return NUM_WORDS[t];
  const n = Number.parseInt(t, 10);
  if (Number.isNaN(n)) throw new Error(`not a number: ${raw}`);
  return n;
}
const N = String.raw`(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)`;

/** strip parenthesized reminder text; tolerant of unbalanced parens in the dump */
export function stripReminders(text: string): string {
  let out = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === "(") { depth++; continue; }
    if (ch === ")") { if (depth > 0) depth--; continue; } // drop stray ")"
    if (depth === 0) out += ch;
  }
  return out
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .trim();
}

function isCapsWord(w: string): boolean {
  const letters = [...w].filter((c) => /[a-zA-Z]/.test(c));
  return letters.length > 0 && letters.every((c) => c === c.toUpperCase());
}

/** reflow hard-wrapped body text into ability blocks */
export function splitBlocks(bodyText: string): string[] {
  const lines = bodyText.split("\n").map((l) => l.trim());
  const blocks: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) { blocks.push(cur.join(" ").trim()); cur = []; }
  };
  const kwStart = /^(?:[A-Z][a-z]+ )?(?:Shift \d|Boost \d|Singer \d|Sing Together \d|Resist \+|Challenger \+|Rush\b|Evasive\b|Ward\b|Bodyguard\b|Support\b|Reckless\b|Alert\b|Vanish\b)/;
  for (const line of lines) {
    if (!line) continue;
    if (/^[-•]\s/.test(line)) { cur.push(line); continue; } // "choose one" bullets
    // a keyword-looking line continuing an unpunctuated previous line is just a wrap
    const prev = cur[cur.length - 1];
    const continuation = prev !== undefined && !/[.!?:)]$/.test(prev);
    let startsNew = kwStart.test(line) && !continuation;
    if (!startsNew) {
      // ALL-CAPS ability name header? (up to 8 caps words then normal text)
      const words = line.replace(/[–—]/g, "-").split(/\s+/);
      let caps = 0;
      for (const w of words) {
        if (isCapsWord(w.replace(/^[,.'"!?:]+|[,.'"!?:]+$/g, "")) || /^[-:]$/.test(w)) caps++;
        else break;
      }
      startsNew = caps >= 1 && caps <= 8 && words.length > caps;
    }
    if (startsNew) flush();
    cur.push(line);
  }
  flush();
  // Some dump records put several abilities on ONE physical line
  // ("...this turn. Don't Be Afraid: Your Puppy characters gain Ward.").
  // Split blocks again at mid-line "Name:" boundaries.
  const NAME_STARTER = /^(you|your|when|whenever|if|at|during|each|chosen|the|a|an|put|look|draw|deal|gain|banish|return|ready|exert|remove|otherwise)\b/i;
  const out: string[] = [];
  for (const b of blocks) {
    let start = 0;
    const re = /(?<=[.!?])\s+([A-Z][\w'’!?,·&.-]*(?: [\w'’!?,·&.-]+){0,5}:)\s+/g;
    let m: RegExpExecArray | null;
    const cuts: number[] = [];
    while ((m = re.exec(b))) {
      const candidate = m[1].slice(0, -1); // drop ":"
      if (NAME_STARTER.test(candidate)) continue;
      if (!/[a-z]/.test(candidate) && !/^[A-Z0-9'’ ,!&·?-]+$/.test(candidate)) continue;
      cuts.push(m.index);
    }
    if (cuts.length === 0) { out.push(b); continue; }
    for (let i = 0; i <= cuts.length; i++) {
      const from = i === 0 ? 0 : cuts[i - 1];
      const to = i === cuts.length ? b.length : cuts[i];
      const piece = b.slice(from, to).trim();
      if (piece) out.push(piece);
    }
    void start;
  }
  return out;
}

/** split a reflowed block into (optional) printed ability name + body */
export function splitAbilityName(block: string): { name?: string; text: string } {
  // "NAME: rest" / "NAME - rest" / "NAME – rest" (all-caps)
  const m = block.match(/^([A-Z0-9'’][A-Z0-9'’ ,!&·?]*?)\s*(?::|\s[-–—]\s)\s*(.+)$/s);
  if (m && isCapsWord(m[1].split(" ")[0])) {
    return { name: m[1].replace(/[,.!?]+$/, "").trim(), text: m[2].trim() };
  }
  // "Title Case Name: rest" / "Title Case Name - rest"
  const t = block.match(/^([A-Z0-9][\w'’!?,·&.-]*(?: [\w'’!?,·&.-]+){0,5})(?::|\s[-–—]\s)\s*(.+)$/s);
  if (t && !/^(you|your|when|whenever|if|at|during|each|chosen|the|a|an|put|look|draw|deal|gain|banish|return|ready|exert|remove)\b/i.test(t[1])) {
    return { name: t[1].replace(/[,.!?]+$/, "").trim(), text: t[2].trim() };
  }
  // "NAME Rest..." — leading run of all-caps words
  const words = block.split(/\s+/);
  let i = 0;
  while (i < words.length && isCapsWord(words[i].replace(/^[,.'"!?]+|[,.'"!?]+$/g, ""))) i++;
  if (i > 0 && i < words.length) {
    return { name: words.slice(0, i).join(" ").replace(/[,.!?]+$/, ""), text: words.slice(i).join(" ") };
  }
  if (i > 0 && i === words.length) {
    return { name: words.join(" ").replace(/[,.!?]+$/, ""), text: "" };
  }
  return { text: block };
}

export function splitSentences(text: string): string[] {
  return text
    // don't split after "!" inside card names ("Fire the Cannons! from your discard")
    .split(/(?<=[.!?])\s+(?=[A-Z{(-])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.replace(/[.\s-]/g, "").length > 0);
}

/* ------------------------------------------------------------- selectors */

const chosenCharacter = (who: Selector["who"] = "any"): Selector => ({ zone: "play", who, type: "Character", chosen: true });
const selfSel = (type?: CardType): Selector => ({ zone: "play", who: "self", ...(type ? { type } : {}), self: true });
const yourCharacters: Selector = { zone: "play", who: "self", type: "Character" };
const opposingCharacters: Selector = { zone: "play", who: "opponent", type: "Character" };

/* ----------------------------------------------------------- stat parser */

function parseStatMods(text: string): { strength?: number; willpower?: number; lore?: number } | null {
  const stat: { strength?: number; willpower?: number; lore?: number } = {};
  const re = /([+-]\s*\d+)\s*(?:\{([swl])\}|(strength|willpower|lore))/g;
  let m: RegExpExecArray | null;
  let found = false;
  while ((m = re.exec(text))) {
    found = true;
    const amount = Number.parseInt(m[1].replace(/\s/g, ""), 10);
    const sym = m[2] ?? m[3]?.[0];
    if (sym === "s") stat.strength = (stat.strength ?? 0) + amount;
    else if (sym === "w") stat.willpower = (stat.willpower ?? 0) + amount;
    else if (sym === "l") stat.lore = (stat.lore ?? 0) + amount;
  }
  return found ? stat : null;
}

const THIS_TURN = "this-turn" as const;
const WHILE_IN_PLAY = "while-in-play" as const;

type Mod = Omit<Modifier, "id" | "source">;

function statModifier(stat: NonNullable<Mod["stat"]>): Mod {
  return { duration: THIS_TURN, stat };
}

/* ---------------------------------------------------- keyword headers */

export interface ParsedKeywords {
  keywords: { name: Keyword; value?: number }[];
  shiftCost?: number;
  /** Sing Together N threshold (songs). */
  singTogether?: number;
  /** leftover text after consuming the keyword tokens (reminders stripped) */
  rest: string;
}

const KEYWORD_TOKEN =
  /^(?:(?:([A-Z][a-z]+)\s+)?(Shift)\s+(\d+)|(Boost)\s+(\d+)|(Singer)\s+(\d+)|(Sing Together)\s+(\d+)|(Resist)\s*\+?\s*(\d+)|(Challenger)\s*\+?\s*(\d+)|(Rush)|(Evasive)|(Ward)|(Bodyguard)|(Support)|(Reckless)|(Alert)|(Vanish))\s*(?:\{i\})?[.,]?\s*/;

/**
 * Parse a leading run of keyword tokens (a block may start with several, e.g.
 * "Shift 4 {i} Evasive"). Returns null when the text does not start with a keyword.
 */
export function parseKeywordHeader(text: string): ParsedKeywords | null {
  const stripped = stripReminders(text);
  let rest = stripped;
  const keywords: { name: Keyword; value?: number }[] = [];
  let shiftCost: number | undefined;
  let singTogether: number | undefined;
  let matched = false;
  for (;;) {
    const m = rest.match(KEYWORD_TOKEN);
    if (!m) break;
    matched = true;
    const [, variant, shift, shiftV, boost, boostV, singer, singerV, singT, singTV, resist, resistV, challenger, challV, ...plain] = m;
    void variant; // named Shift variants ("Puppy Shift 3") — name not modeled
    if (shift) { keywords.push({ name: "Shift", value: parseNum(shiftV) }); shiftCost = parseNum(shiftV); }
    else if (boost) keywords.push({ name: "Boost", value: parseNum(boostV) });
    else if (singer) keywords.push({ name: "Singer", value: parseNum(singerV) });
    else if (singT) singTogether = parseNum(singTV);
    else if (resist) keywords.push({ name: "Resist", value: parseNum(resistV) });
    else if (challenger) keywords.push({ name: "Challenger", value: parseNum(challV) });
    else {
      const name = plain.find(Boolean) as Keyword;
      keywords.push({ name });
    }
    rest = rest.slice(m[0].length);
  }
  if (!matched) return null;
  return { keywords, shiftCost, singTogether, rest };
}

/* --------------------------------------------------- activated costs */

function parseCostPrefix(text: string): { cost: AbilityCost; text: string; oncePerTurn?: boolean } | null {
  let rest = text;
  let oncePerTurn = false;
  const once = rest.match(/^(?:Once|Twice) during your turn,\s*/i);
  if (once) { oncePerTurn = true; rest = rest.slice(once[0].length); }
  const cost: AbilityCost = {};
  // cost segment is everything up to the first " - " (costs never contain it)
  const sep = rest.match(/^([^.:]{1,60}?)\s*[-–—]\s+/);
  if (!sep) return null;
  const seg = sep[1];
  const tokenRe = /(\{e\})(?: one of your [\w ]+? characters)?|(\d+)\s*\{i\}|banish (?:this (item|character|location)|one of your (items|characters|locations))|choose and discard (a|\d+) cards?/gi;
  let tm: RegExpExecArray | null;
  let consumed = "";
  let any = false;
  while ((tm = tokenRe.exec(seg))) {
    any = true;
    consumed += tm[0];
    if (tm[1]) cost.exert = true;
    else if (tm[2]) cost.ink = (cost.ink ?? 0) + Number.parseInt(tm[2], 10);
    else if (tm[3] || tm[4]) cost.banishSelf = true; // "banish one of your items" ≈ banishSelf (documented)
    else if (tm[5]) cost.discard = (cost.discard ?? 0) + parseNum(tm[5]);
  }
  // the whole cost segment must be cost tokens + separators
  if (!any || seg.replace(tokenRe, "").replace(/[,\s]/g, "").length > 0) return null;
  return { cost, text: rest.slice(sep[0].length), oncePerTurn };
}

/* ------------------------------------------------------- triggers */

interface TriggerMatch { triggers: Trigger[]; text: string }

const TRIGGER_PREFIXES: [RegExp, Trigger][] = [
  [/^when you play this (?:character|item|location|card),\s*/i, "ON_PLAY"],
  [/^whenever (?:this character|he|she|it) quests,\s*/i, "ON_QUEST"],
  [/^whenever this character banishes another character in a challenge,\s*/i, "ON_CHALLENGE_BANISH"],
  [/^(?:once |twice )?during your turn, whenever one of your characters banishes another character in a challenge,\s*/i, "ON_CHALLENGE_BANISH"],
  [/^whenever one of your (?:other )?characters banishes another character in a challenge,\s*/i, "ON_CHALLENGE_BANISH"],
  [/^(?:if|when) (?:this character|he|she|it) is banished(?: in a challenge)?,\s*/i, "ON_BANISH"],
  [/^(?:once |twice )?during (?:your|an opponent's) turn, whenever one of your (?:other )?characters is banished(?: in a challenge)?,\s*/i, "ON_BANISH"],
  [/^whenever one of your (?:other )?characters is banished(?: in a challenge)?,\s*/i, "ON_BANISH"],
  [/^whenever another character is banished(?: in a challenge)?,\s*/i, "ON_BANISH"], // approximation (documented)
  [/^whenever (?:this character|one of your (?:other )?characters|they|a damaged character|he|she|it) challenges?(?: another character)?(?: this turn)?,\s*/i, "ON_CHALLENGE_BANISH"], // closest trigger (documented)
  [/^whenever (?:a|an) \w+ is banished[^,]*,\s*/i, "ON_BANISH"], // approximation (documented)
  [/^(?:once |twice )?during (?:your|an opponent's) turn, whenever one of your (?:\w+ )?characters is banished(?: in a challenge)?,\s*/i, "ON_BANISH"],
  [/^at the start of your turn,\s*/i, "START_OF_TURN"],
  [/^at the end of your turn,\s*/i, "END_OF_TURN"],
  [/^whenever an? opponent plays (?:a|an)[^,]+,\s*/i, "ON_OPPONENT_PLAY"],
  [/^whenever (?:another|a) character is played,\s*/i, "ON_PLAY_CHARACTER"], // approximation
  [/^when you play a \w+ character on this card,\s*/i, "ON_PLAY_CHARACTER"], // shift-onto (approximation)
  [/^whenever one (?:or more )?of your characters sings a song,\s*/i, "ON_PLAY_CHARACTER"], // approximation
  [/^(?:once |twice )?during your turn, whenever you play (?:a|an)[^,]+,\s*/i, "ON_PLAY_CHARACTER"],
  [/^whenever you play (?:a|an)[^,]+,\s*/i, "ON_PLAY_CHARACTER"],
];

function matchTriggerPrefixes(sentence: string): TriggerMatch | null {
  const combo = sentence.match(/^when you play this character and whenever (?:he|she|it|this character) quests,\s*/i);
  if (combo) return { triggers: ["ON_PLAY", "ON_QUEST"], text: sentence.slice(combo[0].length) };
  const during = sentence.match(/^(?:once |twice )?during your turn,\s*/i);
  const body = during ? sentence.slice(during[0].length) : sentence;
  for (const [re, trigger] of TRIGGER_PREFIXES) {
    const m = body.match(re);
    if (m) return { triggers: [trigger], text: body.slice(m[0].length) };
  }
  return null;
}

/* ------------------------------------------------- sentence templates */

export interface SentenceContext {
  card: CardDefinition;
  /** set when the previous sentence was a look/reveal/search effect */
  afterDeckPeek?: boolean;
}

type Builder = (m: RegExpMatchArray, ctx: SentenceContext) => EffectNode[];

export interface SentenceTemplate {
  name: string;
  re: RegExp;
  build: Builder;
}

const TYPE_WORDS: Record<string, CardType> = {
  character: "Character", item: "Item", location: "Location", action: "Action", song: "Action",
};

function typeFilter(word: string): { type?: CardType; classification?: string } {
  const w = word.trim();
  const last = w.split(/\s+/).pop()!.toLowerCase();
  if (TYPE_WORDS[last]) {
    if (last === "song") return { type: "Action", classification: "Song" };
    const head = w.split(/\s+/).slice(0, -1).join(" ");
    if (head && /^[A-Z]/.test(head)) return { type: TYPE_WORDS[last], classification: head };
    return { type: TYPE_WORDS[last] };
  }
  // capitalized noun = classification ("a Princess character card" handled above)
  return /^[A-Z]/.test(last) ? { classification: w } : {};
}

/** "chosen character or location" / "chosen opposing character" → Selector */
function chosenSelector(raw: string, whoDefault: Selector["who"] = "any"): Selector {
  const lower = raw.toLowerCase();
  const who: Selector["who"] = lower.includes("opposing") ? "opponent" : whoDefault;
  const filter = lower.includes("damaged") ? "damaged" : lower.includes("exerted") ? "exerted" : lower.includes("ready") ? "ready" : undefined;
  // leading capitalized words = classification ("chosen Illusion character")
  const cls = raw.match(/(?:^| )(?!opposing|damaged|exerted|ready)([A-Z][a-z]+)(?= (?:character|item|location|action)\b)/);
  const types: CardType[] = [];
  if (lower.includes("character")) types.push("Character");
  if (lower.includes("item")) types.push("Item");
  if (lower.includes("location")) types.push("Location");
  return {
    zone: "play",
    who,
    ...(types.length === 1 ? { type: types[0] } : {}),
    ...(cls ? { classification: cls[1] } : {}),
    ...(filter ? { filter } : {}),
    chosen: true,
  };
}

export const SENTENCE_TEMPLATES: SentenceTemplate[] = [
  /* ---- draw ---- */
  { name: "draw", re: new RegExp(`^draw ${N} cards?$`, "i"),
    build: (m) => [{ type: "DRAW", amount: parseNum(m[1]) }] },
  { name: "draw-then-discard", re: new RegExp(`^draw ${N} cards?, then choose and discard ${N} cards?$`, "i"),
    build: (m) => [
      { type: "DRAW", amount: parseNum(m[1]) },
      { type: "DISCARD", amount: parseNum(m[2]), who: "self", mode: "chosen" },
    ] },
  { name: "player-draws", re: new RegExp(`^(?:that player|chosen player|its player) draws ${N} cards?$`, "i"),
    build: (m) => [{ type: "DRAW", amount: parseNum(m[1]) }] },
  { name: "draw-for-each", re: /^draw a card for each .+$/i,
    build: () => [{ type: "DRAW", amount: 1 }] }, // flat approximation (documented)
  { name: "each-player-draws", re: new RegExp(`^each player (?:may )?draws? ${N} cards?$`, "i"),
    build: (m) => [
      { type: "DRAW", amount: parseNum(m[1]) },
      { type: "DRAW", amount: parseNum(m[1]), who: "opponent" } as EffectNode,
    ] },

  /* ---- discard ---- */
  { name: "choose-discard", re: new RegExp(`^choose and discard ${N} cards?$`, "i"),
    build: (m) => [{ type: "DISCARD", amount: parseNum(m[1]), who: "self", mode: "chosen" }] },
  { name: "discard-random", re: new RegExp(`^discard ${N} cards? at random$`, "i"),
    build: (m) => [{ type: "DISCARD", amount: parseNum(m[1]), who: "self", mode: "random" }] },
  { name: "opp-discard", re: new RegExp(`^each opponent chooses and discards ${N} cards?$`, "i"),
    build: (m) => [{ type: "DISCARD", amount: parseNum(m[1]), who: "opponent", mode: "chosen" }] },
  { name: "opp-may-discard", re: new RegExp(`^each opponent may choose and discard ${N} cards?$`, "i"),
    build: (m) => [{ type: "DISCARD", amount: parseNum(m[1]), who: "opponent", mode: "chosen" }] },
  { name: "opp-discard-random", re: new RegExp(`^(?:chosen opponent|that player) discards ${N} cards?(?: at random)?$`, "i"),
    build: (m) => [{ type: "DISCARD", amount: parseNum(m[1]), who: "opponent", mode: "random" }] },
  { name: "opp-reveal-hand-discard", re: /^chosen opponent reveals their hand and discards (?:a|an) [\w-]+ card of your choice$/i,
    build: () => [{ type: "DISCARD", amount: 1, who: "opponent", mode: "chosen" }] },
  { name: "each-player-discard", re: new RegExp(`^each player chooses and discards ${N} cards?$`, "i"),
    build: (m) => [
      { type: "DISCARD", amount: parseNum(m[1]), who: "self", mode: "chosen" },
      { type: "DISCARD", amount: parseNum(m[1]), who: "opponent", mode: "chosen" },
    ] },

  /* ---- damage ---- */
  { name: "deal-damage-chosen", re: new RegExp(`^deal ${N} damage to chosen ([\\w ]+?)(?: with .+)?$`, "i"),
    build: (m) => [{ type: "DEAL_DAMAGE", amount: parseNum(m[1]), target: chosenSelector(m[2]) }] },
  { name: "damage-counters-chosen", re: new RegExp(`^put ${N} damage counters? on chosen character$`, "i"),
    build: (m) => [{ type: "DEAL_DAMAGE", amount: parseNum(m[1]), target: chosenCharacter() }] },
  { name: "deal-damage-each-opp", re: new RegExp(`^deal ${N} damage to each opposing character$`, "i"),
    build: (m) => [{ type: "FOR_EACH", selector: opposingCharacters, effects: [{ type: "DEAL_DAMAGE", amount: parseNum(m[1]), target: { zone: "play", who: "opponent", type: "Character" } }] }] },
  { name: "deal-damage-per-character", re: /^deal damage to chosen character equal to the number of characters you have in play$/i,
    build: () => [{ type: "FOR_EACH", selector: yourCharacters, effects: [{ type: "DEAL_DAMAGE", amount: 1, target: chosenCharacter() }] }] },
  { name: "deal-damage-up-to-chosen", re: new RegExp(`^deal ${N} damage to up to ${N} chosen characters(?: and\\/or locations)?$`, "i"),
    build: (m) => [{ type: "DEAL_DAMAGE", amount: parseNum(m[1]), target: chosenCharacter() }] },
  { name: "deal-damage-each-yours", re: new RegExp(`^deal ${N} damage to each of your characters$`, "i"),
    build: (m) => [{ type: "FOR_EACH", selector: yourCharacters, effects: [{ type: "DEAL_DAMAGE", amount: parseNum(m[1]), target: { zone: "play", who: "self", type: "Character" } }] }] },
  { name: "opp-deals-own", re: new RegExp(`^each opponent chooses one of their characters and deals ${N} damage to them$`, "i"),
    build: (m) => [{ type: "DEAL_DAMAGE", amount: parseNum(m[1]), target: { zone: "play", who: "opponent", type: "Character", chosen: true } }] },
  { name: "move-damage", re: new RegExp(`^move (?:up to )?${N} damage counters? from chosen character to chosen opposing character$`, "i"),
    build: (m) => [{
      type: "MOVE_DAMAGE", amount: parseNum(m[1]),
      from: chosenCharacter(), to: chosenCharacter("opponent"),
    }] },

  /* ---- remove damage ---- */
  { name: "remove-damage-chosen", re: new RegExp(`^remove up to ${N} damage from chosen character( of yours)?$`, "i"),
    build: (m) => [{ type: "REMOVE_DAMAGE", amount: parseNum(m[1]), target: chosenCharacter() }] },
  { name: "remove-damage-exact", re: new RegExp(`^remove ${N} damage from chosen character( of yours)?$`, "i"),
    build: (m) => [{ type: "REMOVE_DAMAGE", amount: parseNum(m[1]), target: chosenCharacter() }] },
  { name: "remove-damage-each-yours", re: new RegExp(`^remove up to ${N} damage from each of your characters$`, "i"),
    build: (m) => [{ type: "FOR_EACH", selector: yourCharacters, effects: [{ type: "REMOVE_DAMAGE", amount: parseNum(m[1]), target: { zone: "play", who: "self", type: "Character" } }] }] },
  { name: "remove-all-damage", re: /^remove all damage from chosen character( of yours)?$/i,
    build: () => [{ type: "REMOVE_DAMAGE", amount: 99, target: chosenCharacter() }] },
  { name: "remove-all-damage-them", re: /^remove all damage from (?:them|him|her|it)$/i,
    build: () => [{ type: "REMOVE_DAMAGE", amount: 99, target: chosenCharacter() }] },
  { name: "remove-damage-any-number", re: new RegExp(`^remove up to ${N} damage from any number of (?:chosen )?characters$`, "i"),
    build: (m) => [{ type: "REMOVE_DAMAGE", amount: parseNum(m[1]), target: chosenCharacter() }] },
  { name: "remove-damage-classification", re: new RegExp(`^remove up to ${N} damage from each of your ([A-Z]\\w+) characters$`, "i"),
    build: (m) => [{ type: "FOR_EACH", selector: { zone: "play", who: "self", type: "Character", classification: m[2] }, effects: [{ type: "REMOVE_DAMAGE", amount: parseNum(m[1]), target: { zone: "play", who: "self", type: "Character" } }] }] },

  /* ---- lore ---- */
  { name: "gain-lore", re: new RegExp(`^(?:you )?gain ${N} lore$`, "i"),
    build: (m) => [{ type: "GAIN_LORE", amount: parseNum(m[1]) }] },
  { name: "opp-lose-lore", re: new RegExp(`^each opponent loses ${N} lore$`, "i"),
    build: (m) => [{ type: "OPPONENT_LOSE_LORE", amount: parseNum(m[1]) }] },
  { name: "its-player-gains-lore", re: new RegExp(`^its player gains ${N} lore$`, "i"),
    build: (m) => [{ type: "GAIN_LORE", amount: parseNum(m[1]) }] }, // approximation (documented)
  { name: "gain-lore-for-each", re: new RegExp(`^gain ${N} lore for each .+$`, "i"),
    build: (m) => [{ type: "GAIN_LORE", amount: parseNum(m[1]) }] }, // flat approximation (documented)
  { name: "gain-lore-max", re: new RegExp(`^gain lore equal to .+, to a maximum of (\\d+) lore$`, "i"),
    build: (m) => [{ type: "GAIN_LORE", amount: parseNum(m[1]) }] }, // uses the printed maximum (documented)

  /* ---- banish ---- */
  { name: "banish-chosen", re: /^banish chosen ([\w ]+?)(?: with .+)?$/i,
    build: (m) => [{ type: "BANISH", target: chosenSelector(m[1]) }] },
  { name: "banish-all", re: /^banish all (characters|items|locations)$/i,
    build: (m) => [{
      type: "FOR_EACH",
      selector: { zone: "play", who: "any", type: (m[1][0].toUpperCase() + m[1].slice(1, -1)) as CardType },
      effects: [{ type: "BANISH", target: { zone: "play", who: "any", type: (m[1][0].toUpperCase() + m[1].slice(1, -1)) as CardType } }],
    }] },
  { name: "opp-chooses-banish", re: /^each opponent chooses and banishes one of their characters$/i,
    build: () => [{ type: "BANISH", target: chosenCharacter("opponent") }] },
  { name: "banish-them", re: /^(?:at the end of (?:the|your) turn, )?banish (?:him|her|it|them)$/i,
    build: () => [{ type: "BANISH", target: { zone: "play", who: "any", chosen: true } }] },
  { name: "banish-or-return-choice", re: /^banish (?:him|her|it|this character) or return (?:another )?chosen character(?: of yours)? to (?:your|their player's) hand$/i,
    build: () => [{
      type: "CHOICE", prompt: "Choose one", min: 1, max: 1,
      options: [
        [{ type: "BANISH", target: selfSel("Character") }],
        [{ type: "RETURN_TO_HAND", target: chosenCharacter() }],
      ],
    }] },

  /* ---- return to hand ---- */
  { name: "return-chosen", re: /^return chosen ([\w, ]+?)(?: of yours)?(?: with (?:cost )?.+?)? to (?:their player's|your|its owner's) hand$/i,
    build: (m) => [{ type: "RETURN_TO_HAND", target: chosenSelector(m[1].replace(/,/g, " ")) }] },
  { name: "return-named-from-discard", re: /^return (?:a|an) ([\w ]+?) card named ([\w'’!?. ]+?) from your discard to your hand$/i,
    build: (m) => [{ type: "RETURN_TO_HAND", target: { zone: "discard", who: "self", ...typeFilter(m[1]), name: m[2].trim(), chosen: true } }] },
  { name: "return-up-to-discard", re: new RegExp(`^return up to ${N} ([\\w ]+?) cards? with cost .+? from your discard to your hand$`, "i"),
    build: (m) => [{ type: "RETURN_TO_HAND", target: { zone: "discard", who: "self", ...typeFilter(m[1]), chosen: true } }] },
  { name: "return-from-discard", re: new RegExp(`^return (?:a|an) ([\\w ]+?) card(?: with cost ${N} or less)? from your discard to your hand$`, "i"),
    build: (m) => [{ type: "RETURN_TO_HAND", target: { zone: "discard", who: "self", ...typeFilter(m[1]), chosen: true } }] },
  { name: "return-that-card", re: /^return that card to (?:your|its owner's) hand$/i,
    build: () => [{ type: "RETURN_TO_HAND", target: selfSel() }] },
  { name: "return-self", re: /^return this card to (?:your|its owner's) hand$/i,
    build: () => [{ type: "RETURN_TO_HAND", target: selfSel() }] },

  /* ---- ready / exert ---- */
  { name: "ready-chosen", re: /^ready (?:another )?chosen ([\w ]+?)?character( of yours)?$/i,
    build: (m) => [{ type: "READY", target: chosenSelector(`${m[1] ?? ""}character`) }] },
  { name: "ready-all-yours", re: /^ready all your characters$/i,
    build: () => [{ type: "FOR_EACH", selector: yourCharacters, effects: [{ type: "READY", target: { zone: "play", who: "self", type: "Character" } }] }] },
  { name: "ready-self", re: /^ready (?:him|her|it|this character)$/i,
    build: () => [{ type: "READY", target: selfSel("Character") }] },
  { name: "exert-chosen", re: /^exert chosen ([\w ]+?)(?: with .+)?$/i,
    build: (m) => [{ type: "EXERT", target: chosenSelector(m[1]) }] },
  { name: "exert-all-opposing", re: /^exert all opposing characters$/i,
    build: () => [{ type: "FOR_EACH", selector: opposingCharacters, effects: [{ type: "EXERT", target: { zone: "play", who: "opponent", type: "Character" } }] }] },
  // Ghostly Tale — soft board stall vs low-strength swarms.
  { name: "exert-all-opposing-max-str",
    re: new RegExp(`^exert all opposing characters with ${N} \\{s\\} or less$`, "i"),
    build: (m) => {
      const maxStrength = parseNum(m[1]);
      const sel = { zone: "play" as const, who: "opponent" as const, type: "Character" as const, maxStrength };
      return [{
        type: "FOR_EACH",
        selector: sel,
        effects: [{ type: "EXERT", target: { zone: "play", who: "opponent", type: "Character", ref: "$each" } }],
      }];
    } },
  // Under the Sea — put opposing ≤N strength characters on bottom of deck.
  { name: "bottom-all-opposing-max-str",
    re: new RegExp(
      `^put all opposing characters with ${N}\\s*\\{s\\} or less on the bottom of their (?:players'|player's) decks?(?: in any order)?$`,
      "i",
    ),
    build: (m) => {
      const maxStrength = parseNum(m[1]);
      const sel = { zone: "play" as const, who: "opponent" as const, type: "Character" as const, maxStrength };
      return [{
        type: "FOR_EACH",
        selector: sel,
        effects: [{ type: "PUT_ON_BOTTOM", target: { zone: "play", who: "opponent", type: "Character", ref: "$each" } }],
      }];
    } },
  { name: "opp-exerts-own", re: /^each opponent chooses and exerts one of their ready characters$/i,
    build: () => [{ type: "EXERT", target: { zone: "play", who: "opponent", type: "Character", filter: "ready", chosen: true } }] },
  { name: "enters-exerted-may", re: /^this (character|item|location) may enter play exerted$/i,
    build: (m) => [{ type: "EXERT", target: selfSel(TYPE_WORDS[m[1].toLowerCase()]) }] },
  { name: "exert-self", re: /^this (character|item|location) enters play exerted$/i,
    build: (m) => [{ type: "EXERT", target: selfSel(TYPE_WORDS[m[1].toLowerCase()]) }] },
  { name: "enters-with-damage", re: new RegExp(`^this character enters play with ${N} damage$`, "i"),
    build: (m) => [{ type: "DEAL_DAMAGE", amount: parseNum(m[1]), target: selfSel("Character") }] },

  /* ---- stat modifiers ---- */
  { name: "stat-chosen", re: /^chosen (opposing )?character(?: of yours)? gets ([+-]\s*\d+\s*(?:\{[swl]\}|strength|willpower|lore))(?: and [+-]\s*\d+\s*(?:\{[swl]\}|strength|willpower|lore))*( this turn| until the start of your next turn)?$/i,
    build: (m) => {
      const stat = parseStatMods(m[2] + (m[0].match(/ and [+-]\s*\d+\s*(?:\{[swl]\}|strength|willpower|lore)/g)?.join("") ?? ""));
      return stat ? [{ type: "ADD_MODIFIER", target: chosenSelector(m[1] ? "opposing character" : "character"), modifier: statModifier(stat), duration: THIS_TURN }] : [];
    } },
  { name: "stat-bare", re: /^gets? ([+-]\s*\d+\s*(?:\{[swl]\}|strength|willpower|lore))(?: and [+-]\s*\d+\s*(?:\{[swl]\}|strength|willpower|lore))*( this turn| until the start of your next turn)?$/i,
    build: (m) => {
      const stat = parseStatMods(m[0]);
      return stat ? [{ type: "ADD_MODIFIER", target: chosenCharacter(), modifier: statModifier(stat), duration: THIS_TURN }] : [];
    } },
  { name: "stat-each-opposing", re: /^each opposing character gets ([+-]\s*\d+\s*(?:\{[swl]\}))(?: and [+-]\s*\d+\s*(?:\{[swl]\}))*(?: this turn| until the start of your next turn)?$/i,
    build: (m) => {
      const stat = parseStatMods(m[0]);
      return stat ? [{ type: "FOR_EACH", selector: opposingCharacters, effects: [{ type: "ADD_MODIFIER", target: { zone: "play", who: "opponent", type: "Character" }, modifier: statModifier(stat), duration: THIS_TURN }] }] : [];
    } },
  { name: "self-buff-at-location-fx", re: /^while (?:this character is )?at a location, (?:he|she|it|this character) gets? ([+-]\s*\d+\s*(?:\{[swl]\}))(?: and [+-]\s*\d+\s*(?:\{[swl]\}))*$/i,
    build: (m) => {
      const stat = parseStatMods(m[0]);
      return stat ? [{ type: "ADD_MODIFIER", target: selfSel("Character"), modifier: { duration: "while-in-play", stat }, duration: "while-in-play" }] : [];
    } },
  { name: "stat-self-this-turn", re: /^(?:this character|he|she|it) gets ([+-]\s*\d+\s*(?:\{[swl]\}|\w+))(?: and [+-]\s*\d+\s*(?:\{[swl]\}|\w+))* this turn$/i,
    build: (m) => {
      const stat = parseStatMods(m[0]);
      return stat ? [{ type: "ADD_MODIFIER", target: selfSel("Character"), modifier: statModifier(stat), duration: THIS_TURN }] : [];
    } },
  { name: "stat-yours-this-turn", re: /^your characters get ([+-]\s*\d+\s*(?:\{[swl]\}))(?: and [+-]\s*\d+\s*(?:\{[swl]\}))* this turn$/i,
    build: (m) => {
      const stat = parseStatMods(m[0]);
      return stat ? [{ type: "FOR_EACH", selector: yourCharacters, effects: [{ type: "ADD_MODIFIER", target: { zone: "play", who: "self", type: "Character" }, modifier: statModifier(stat), duration: THIS_TURN }] }] : [];
    } },

  /* ---- keyword grants ---- */
  { name: "grant-keyword-chosen", re: /^chosen (opposing )?character(?: of yours)? gains (Rush|Evasive|Ward|Bodyguard|Support|Reckless|Alert|Vanish)(?: this turn| until the start of your next turn| during (?:their|the) next turn)?$/i,
    build: (m) => [{ type: "GRANT_KEYWORD", target: chosenCharacter(m[1] ? "opponent" : "any"), keyword: capitalize(m[2]) as Keyword }] },
  { name: "grant-keyword-bare", re: /^gains? (Rush|Evasive|Ward|Bodyguard|Support|Reckless|Alert|Vanish)(?: this turn| until the start of your next turn| during (?:their|the) next turn)?$/i,
    build: (m) => [{ type: "GRANT_KEYWORD", target: chosenCharacter(), keyword: capitalize(m[1]) as Keyword }] },
  { name: "grant-keyword-param-bare", re: new RegExp(`^gains? (Challenger|Resist|Singer) \\+?${N}(?: this turn| until the start of your next turn)?$`, "i"),
    build: (m) => [{ type: "GRANT_KEYWORD", target: chosenCharacter(), keyword: capitalize(m[1]) as Keyword, value: parseNum(m[2]) }] },
  { name: "grant-keyword-those", re: /^those characters gain (Rush|Evasive|Ward|Bodyguard|Support|Reckless|Alert|Vanish)(?: until the start of your next turn| this turn)?$/i,
    build: (m) => [{ type: "GRANT_KEYWORD", target: { zone: "play", who: "self", type: "Character", chosen: true }, keyword: capitalize(m[1]) as Keyword }] },
  { name: "grant-keyword-your-chars", re: new RegExp(`^your characters gain (Rush|Evasive|Ward|Bodyguard|Support|Reckless|Alert|Vanish)(?: until the start of your next turn| this turn)?$`, "i"),
    build: (m) => [{ type: "FOR_EACH", selector: yourCharacters, effects: [{ type: "GRANT_KEYWORD", target: { zone: "play", who: "self", type: "Character" }, keyword: capitalize(m[1]) as Keyword }] }] },
  { name: "grant-keyword-param-your-chars", re: new RegExp(`^your characters gain (Resist|Challenger) \\+?${N}(?: until the start of your next turn| this turn)?$`, "i"),
    build: (m) => [{ type: "FOR_EACH", selector: yourCharacters, effects: [{ type: "GRANT_KEYWORD", target: { zone: "play", who: "self", type: "Character" }, keyword: capitalize(m[1]) as Keyword, value: parseNum(m[2]) }] }] },
  { name: "grant-keyword-reckless-opp", re: /^chosen opposing character gains Reckless during their next turn$/i,
    build: () => [{ type: "GRANT_KEYWORD", target: chosenCharacter("opponent"), keyword: "Reckless" }] },
  { name: "self-keyword-during-your-turn-fx", re: /^during your turn, this character gains? (Rush|Evasive|Ward|Bodyguard|Support|Reckless|Alert|Vanish)$/i,
    build: (m) => [{ type: "GRANT_KEYWORD", target: selfSel("Character"), keyword: capitalize(m[1]) as Keyword }] },
  { name: "grant-keyword-param-chosen", re: new RegExp(`^chosen (opposing )?character(?: of yours)? gains (Challenger|Resist|Singer) \\+?${N}(?: this turn| until the start of your next turn)?$`, "i"),
    build: (m) => [{ type: "GRANT_KEYWORD", target: chosenCharacter(m[1] ? "opponent" : "any"), keyword: capitalize(m[2]) as Keyword, value: parseNum(m[3]) }] },
  { name: "grant-keyword-self", re: /^(?:this character|he|she|it|they) gains? (Rush|Evasive|Ward|Bodyguard|Support|Reckless|Alert|Vanish)(?: this turn| until the start of your next turn)?$/i,
    build: (m) => [{ type: "GRANT_KEYWORD", target: selfSel("Character"), keyword: capitalize(m[1]) as Keyword }] },
  { name: "grant-keyword-param-self", re: new RegExp(`^(?:this character|he|she|it|they) gains? (Challenger|Resist) \\+?${N}(?: this turn| until the start of your next turn)?$`, "i"),
    build: (m) => [{ type: "GRANT_KEYWORD", target: selfSel("Character"), keyword: capitalize(m[1]) as Keyword, value: parseNum(m[2]) }] },
  { name: "challenge-ready", re: /^this character can challenge ready [\w ]*characters$/i,
    build: () => [{ type: "GRANT_KEYWORD", target: selfSel("Character"), keyword: "Alert" }] },

  /* ---- cant modifiers ---- */
  { name: "cant-quest", re: /^(?:they|he|she|it|this character|that character|chosen character) can't quest( or challenge)?(?: for the rest of this turn)?$/i,
    build: (m) => [{
      type: "ADD_MODIFIER", target: chosenCharacter(),
      modifier: { duration: THIS_TURN, cantQuest: true, ...(m[1] ? { cantChallenge: true } : {}) },
      duration: THIS_TURN,
    }] },
  { name: "cant-ready", re: /^(?:they|he|she|it|this character) can't ready at the start of (?:their|its) next turn$/i,
    build: () => [{
      type: "ADD_MODIFIER", target: chosenCharacter(),
      modifier: { duration: THIS_TURN, cantReady: true }, duration: THIS_TURN,
    }] },
  { name: "opp-cant-ready-chosen", re: /^chosen opposing character can't ready at the start of their next turn$/i,
    build: () => [{
      type: "ADD_MODIFIER", target: chosenCharacter("opponent"),
      modifier: { duration: THIS_TURN, cantReady: true }, duration: THIS_TURN,
    }] },
  { name: "cant-ready-chosen-exerted", re: /^chosen exerted character can't ready at the start of their next turn$/i,
    build: () => [{
      type: "ADD_MODIFIER", target: { zone: "play", who: "any", type: "Character", filter: "exerted", chosen: true },
      modifier: { duration: THIS_TURN, cantReady: true }, duration: THIS_TURN,
    }] },
  { name: "cant-challenge-chosen", re: /^chosen (opposing )?character can't challenge(?: during their next turn| until the start of your next turn)?$/i,
    build: (m) => [{
      type: "ADD_MODIFIER", target: chosenCharacter(m[1] ? "opponent" : "any"),
      modifier: { duration: THIS_TURN, cantChallenge: true }, duration: THIS_TURN,
    }] },

  /* ---- deck peeking ---- */
  { name: "look-top", re: new RegExp(`^look at the top ${N} cards? of your deck$`, "i"),
    build: (m) => [{ type: "LOOK_TOP", amount: parseNum(m[1]), then: "keep-order" }] },
  { name: "look-top-one", re: /^look at the top card of your deck$/i,
    build: () => [{ type: "LOOK_TOP", amount: 1, then: "keep-order" }] },
  { name: "name-reveal-top", re: /^name a card, then reveal the top card of your deck$/i,
    build: () => [{ type: "LOOK_TOP", amount: 1, then: "keep-order" }] },
  { name: "look-inkwell", re: /^look at the cards in your inkwell$/i, build: () => [] },
  { name: "look-top-reveal-into-hand", re: new RegExp(`^look at the top ${N} cards? of your deck[.,]\\s*(?:you may )?reveal (?:a|an|up to ${N}) ([\\w ]+?) cards? and put (?:it|them|one) into your hand[.,]?$`, "i"),
    build: (m) => [{ type: "LOOK_TOP", amount: parseNum(m[1]), then: "choose-into-hand", filter: typeFilter(m[3] ?? m[2]) }] },
  { name: "reveal-top", re: /^reveal the top card of your deck$/i,
    build: () => [{ type: "LOOK_TOP", amount: 1, then: "keep-order" }] },
  { name: "each-player-reveals", re: /^each player (?:reveals the top card of their deck|shuffles their deck and then reveals the top card)$/i,
    build: () => [{ type: "LOOK_TOP", amount: 1, then: "keep-order" }] },
  { name: "look-top-chosen-player", re: /^look at the top card of chosen player's deck$/i,
    build: () => [{ type: "LOOK_TOP", amount: 1, then: "keep-order" }] },

  /* ---- inkwell ---- */
  { name: "top-into-inkwell", re: /^put the top card of your deck into your inkwell facedown(?: and exerted)?$/i,
    build: () => [{ type: "PUT_INTO_INKWELL", source: "top-deck" }] },
  { name: "self-into-inkwell", re: /^put this card into your inkwell facedown(?: and exerted)?$/i,
    build: () => [{ type: "PUT_INTO_INKWELL", source: "self" }] },
  { name: "discard-into-inkwell", re: /^put (?:a card|that card) from (?:your|chosen player's) discard into (?:your|their) inkwell facedown(?: and exerted)?$/i,
    build: () => [{ type: "PUT_INTO_INKWELL", source: "top-deck", target: { zone: "discard", who: "self", chosen: true } }] },
  { name: "chosen-into-inkwell", re: /^put chosen ([\w ]+?) into (?:its|their) player's inkwell facedown(?: and exerted)?$/i,
    build: (m) => [{ type: "PUT_INTO_INKWELL", source: "top-deck", target: chosenSelector(m[1]) }] },
  { name: "hand-into-inkwell", re: /^put a card from your hand into your inkwell facedown$/i,
    build: () => [{ type: "PUT_INTO_INKWELL", source: "top-deck", target: { zone: "hand", who: "self", chosen: true } }] },
  // Spooky Sight — mass ink of low-cost boards (hard Toys hate).
  { name: "all-chars-cost-into-inkwell", re: new RegExp(
    `^put all characters with cost ${N} or less into their players'? inkwells? facedown(?: and exerted)?$`, "i"),
    build: (m) => {
      const maxCost = parseNum(m[1]);
      const sel = { zone: "play" as const, who: "any" as const, type: "Character" as const, maxCost };
      return [{
        type: "FOR_EACH",
        selector: sel,
        effects: [{
          type: "PUT_INTO_INKWELL",
          source: "top-deck",
          target: { zone: "play", who: "any", type: "Character", ref: "$each" },
        }],
      }];
    } },

  /* ---- search / play free ---- */
  { name: "search-deck", re: /^search your deck for (?:a|an) ([\w ]+?) card(?: with cost .+)? and put (?:it|that card) into your hand$/i,
    build: (m) => [{ type: "SEARCH_DECK", filter: typeFilter(m[1]), into: "hand" }] },
  { name: "play-free", re: new RegExp(`^(?:you may )?play (?:that|a|an) (character|action|item|location)(?: card)?(?: with cost ${N} or less)? for free(?: and (?:he|she|it|they) enter(?:s)? play exerted)?$`, "i"),
    build: (m) => [{
      type: "PLAY_CARD_FREE",
      filter: { type: TYPE_WORDS[m[1].toLowerCase()], ...(m[2] ? { maxCost: parseNum(m[2]) } : {}), from: "hand" },
    }] },
  { name: "play-free-from-discard", re: new RegExp(`^(?:you may )?play (?:a|an) (character|action)(?: card)? with cost ${N} or less from your discard for free$`, "i"),
    build: (m) => [{ type: "PLAY_CARD_FREE", filter: { type: TYPE_WORDS[m[1].toLowerCase()], maxCost: parseNum(m[2]), from: "discard" } }] },
  { name: "play-free-each-player", re: /^each player who reveals a character card may play that character for free$/i,
    build: () => [{ type: "PLAY_CARD_FREE", filter: { type: "Character" } }] },
  { name: "play-free-there", re: /^(?:you may )?play (?:a|an) ([A-Z]\w+ )?(character|action|item|location)(?: card)? from there for free$/i,
    build: (m) => [{ type: "PLAY_CARD_FREE", filter: { type: TYPE_WORDS[m[2].toLowerCase()], ...(m[1] ? { classification: m[1].trim() } : {}) } }] },

  /* ---- prevent damage ---- */
  { name: "prevent-damage", re: new RegExp(`^prevent (?:up to )?${N} damage(?: that would be dealt)? to (?:chosen character|each of your characters|them)(?: .+)?$`, "i"),
    build: (m) => [{ type: "PREVENT_DAMAGE", amount: parseNum(m[1]), target: chosenCharacter(), duration: THIS_TURN }] },

  /* ---- noop continuations (understood deck-ordering bookkeeping) ---- */
  { name: "cont-song-reminder", re: /^\{?(?:a )?character with cost [\dx]+ or more can \{e\} to sing this song for free$/i, build: () => [] },
  { name: "cont-reveal-into-hand", re: /^(?:you may )?reveal (?:a|an) [\w ]+? card and put it into your hand$/i, build: () => [] },
  { name: "cont-bottom-rest", re: /^put the rest on the bottom of (?:your|their) deck in any order$/i, build: () => [] },
  { name: "cont-otherwise-top-bottom", re: /^otherwise, (?:they )?put (?:it|that card) on the (?:top|bottom) of (?:your|their) deck$/i, build: () => [] },
  { name: "cont-top-or-bottom", re: /^(?:you may )?put (?:it|one) on (?:either )?the top (?:or|and) (?:the )?bottom of your deck$/i, build: () => [] },
  { name: "cont-one-top-other-bottom", re: /^put one on the top of your deck and the other on the bottom$/i, build: () => [] },
  { name: "cont-into-hand-rest", re: /^put one into your hand and the other (?:on the bottom of your deck|into your inkwell facedown(?: and exerted)?)$/i, build: () => [] },
  { name: "cont-shuffle", re: /^(?:put (?:that card|it) into your hand and )?shuffle your deck(?: and put that card on top of it)?$/i, build: () => [] },
  { name: "cont-rest-discard", re: /^put the rest into your discard$/i, build: () => [] },
  { name: "cont-may-into-hand", re: /^you may put (?:one|it|that card) into your hand$/i, build: () => [] },
  { name: "cont-count", re: /^count the number of characters you have in play$/i, build: () => [] },
  { name: "cont-bottom-deck", re: /^put (?:that card|it|the revealed cards) on the bottom of (?:your|their|their player's) deck$/i, build: () => [] },
  { name: "cont-discard-bottom", re: /^put a card from chosen player's discard on the bottom of their deck$/i, build: () => [] },
  { name: "cont-dangling-duration", re: /^(?:until the start of your next turn|this turn)$/i, build: () => [] },
  { name: "cont-ink-discard", re: /^you can ink cards from your discard$/i, build: () => [] },
  { name: "cont-not-songs", re: /^this doesn't apply to singing songs$/i, build: () => [] },
  { name: "cont-top-rest", re: /^put the rest on the top of your deck in any order$/i, build: () => [] },
  { name: "cont-reveal-up-to", re: new RegExp(`^(?:you may )?reveal up to ${N} [\\w ]+ cards? and put (?:it|them|one) into your hand$`, "i"), build: () => [] },
  { name: "cont-rules-text", re: /^(?:opponents need \d+ lore to win the game|you may only have \d+ copies of [\w ]+ in your deck|if an effect would cause you to discard one or more cards, you don't discard)$/i, build: () => [] },
  { name: "cont-colon", re: /^:$/, build: () => [] },
  { name: "cont-its-card-into-hand", re: /^if it's (?:a|an) [\w ]+ card, (?:you may )?put it into your hand$/i, build: () => [] },
  { name: "cant-sing", re: /^this character can't \{e\} to sing songs$/i,
    build: () => [{ type: "ADD_MODIFIER", target: selfSel("Character"), modifier: { duration: "while-in-play", cantQuest: true }, duration: "while-in-play" }] }, // approximation (documented)
  /* ---- effects with no DSL node: matched as understood, emitted as noops (documented) ---- */
  { name: "unmodeled-cost-reduction", re: /^(?:if this is your first turn and you're not the first player, )?(?:for each .+?, )?you pay \d+\s*\{i\} less (?:for|to) .+$/i, build: () => [] },
  { name: "unmodeled-put-under", re: /^put (?:the top card|a card|all cards) .+? facedown under .+$/i, build: () => [] },
];

function capitalize(s: string): string {
  return s[0].toUpperCase() + s.slice(1).toLowerCase();
}

/* ------------------------------------------- sentence matching pipeline */

export interface SentenceResult {
  matched: boolean;
  nodes: EffectNode[];
  template?: string;
}

const MAX_DEPTH = 3;

export function matchSentence(rawSentence: string, ctx: SentenceContext, depth = 0): SentenceResult {
  let s = rawSentence.trim().replace(/[.]+$/, "").trim();
  if (/^[-•]\s/.test(s)) s = s.slice(2).trim();
  s = s.replace(/^(?:once|twice) during your turn,\s*/i, ""); // frequency limiter not modeled per-sentence
  if (!s) return { matched: true, nodes: [] };

  // "choose one:" lists (options separated by " - ")
  if (depth < MAX_DEPTH) {
    const choose = s.match(/^(?:you may )?choose one(?: of the following)?:\s*(.+)$/is);
    if (choose) {
      const parts = choose[1].split(/\s+[-•]\s+/).map((p) => p.trim()).filter(Boolean);
      const options: EffectNode[][] = [];
      for (const part of parts) {
        const r = matchSentence(part, ctx, depth + 1);
        if (!r.matched) return { matched: false, nodes: [] };
        options.push(r.nodes);
      }
      return { matched: true, template: "choose-one", nodes: [{ type: "CHOICE", prompt: "Choose one", options, min: 1, max: 1 }] };
    }
  }

  for (const t of SENTENCE_TEMPLATES) {
    const m = s.match(t.re);
    if (m) return { matched: true, template: t.name, nodes: t.build(m, ctx) };
  }

  if (depth < MAX_DEPTH) {
    // "if you have N or more characters in play, X" → IF{count}
    const ifCount = s.match(new RegExp(`^if you have ${N} or more (?:other )?characters in play,\\s*(?:you may )?(.+)$`, "is"));
    if (ifCount) {
      const inner = matchSentence(ifCount[2], ctx, depth + 1);
      if (inner.matched) {
        return {
          matched: true, template: `if-count:${inner.template ?? "?"}`,
          nodes: [{
            type: "IF",
            condition: { kind: "count", selector: yourCharacters, op: ">=", value: parseNum(ifCount[1]) },
            then: inner.nodes, else: [],
          }],
        };
      }
    }
    // "if you have N or more (other) Toy characters in play, X" → IF{count+classification}
    const ifClass = s.match(new RegExp(
      `^if you have ${N} or more (other )?([A-Z][\\w'-]*) characters in play,\\s*(?:you may )?(.+)$`, "is"));
    if (ifClass) {
      const inner = matchSentence(ifClass[4], ctx, depth + 1);
      if (inner.matched) {
        // "other" excludes the source character; count threshold is on the full
        // classification pool, so add 1 when the printed text says "other".
        const need = parseNum(ifClass[1]) + (ifClass[2] ? 1 : 0);
        return {
          matched: true, template: `if-class-count:${inner.template ?? "?"}`,
          nodes: [{
            type: "IF",
            condition: {
              kind: "count",
              selector: {
                zone: "play", who: "self", type: "Character",
                classification: ifClass[3],
              },
              op: ">=",
              value: need,
            },
            then: inner.nodes,
            else: [],
          }],
        };
      }
    }
    // "you may X" → optional choice
    const may = s.match(/^(?:you may|chosen player may)\s+(.+)$/is);
    if (may) {
      const inner = matchSentence(may[1], ctx, depth + 1);
      if (inner.matched) {
        return {
          matched: true, template: `may:${inner.template ?? "?"}`,
          nodes: [{ type: "CHOICE", prompt: `You may: ${may[1]}`, options: [inner.nodes], min: 0, max: 1 }],
        };
      }
    }
    // "If you do, X" / conditional continuations — condition dropped (documented)
    const ifDo = s.match(/^if (?:you do|you removed damage this way|it's (?:a|an) [\w ]+ card|there's a card under (?:him|her|it|this character)),\s*(?:you may )?(.+)$/is);
    if (ifDo) {
      const inner = matchSentence(ifDo[1], ctx, depth + 1);
      if (inner.matched) return { matched: true, template: `if:${inner.template ?? "?"}`, nodes: inner.nodes };
    }
    // "if <unmodelable condition>, X" — condition dropped (documented)
    const ifDrop = s.match(/^if [^,]{3,80},\s*(?:you may )?(.+)$/is);
    if (ifDrop && !/^you have \d+ or more/i.test(s)) {
      const inner = matchSentence(ifDrop[1], ctx, depth + 1);
      if (inner.matched) return { matched: true, template: `ifx:${inner.template ?? "?"}`, nodes: inner.nodes };
    }
    // "you may choose and discard a card to X" / "you may pay N {i} to X" — cost + effect
    const discardTo = s.match(/^(?:you may )?choose and discard (a|\d+) cards? to (.+)$/is);
    if (discardTo) {
      const inner = matchSentence(discardTo[2], ctx, depth + 1);
      if (inner.matched) {
        return {
          matched: true, template: `discard-to:${inner.template ?? "?"}`,
          nodes: [{ type: "DISCARD", amount: parseNum(discardTo[1]), who: "self", mode: "chosen" }, ...inner.nodes],
        };
      }
    }
    const payTo = s.match(/^(?:you may )?pay\s*(\d+)\s*\{i\}\s*to (.+)$/is);
    if (payTo) {
      const inner = matchSentence(payTo[2], ctx, depth + 1);
      if (inner.matched) return { matched: true, template: `pay-to:${inner.template ?? "?"}`, nodes: inner.nodes }; // ink cost dropped (documented)
    }
    // conjunction: "X, then Y" / "X then Y"
    for (const sep of [/,\s+then\s+/i, /\s+then\s+/i]) {
      const idx = s.search(sep);
      if (idx > 0) {
        const left = s.slice(0, idx);
        const right = s.slice(idx).replace(sep, "");
        const l = matchSentence(left, ctx, depth + 1);
        if (l.matched) {
          const r = matchSentence(right, ctx, depth + 1);
          if (r.matched) return { matched: true, template: `seq:${l.template}+${r.template}`, nodes: [...l.nodes, ...r.nodes] };
        }
      }
    }
    // conjunction: "X and Y" — only when both halves match independently
    const andIdx = indexOfTopLevelAnd(s);
    if (andIdx > 0) {
      const l = matchSentence(s.slice(0, andIdx), ctx, depth + 1);
      if (l.matched) {
        const r = matchSentence(s.slice(andIdx + 5), ctx, depth + 1);
        if (r.matched) return { matched: true, template: `and:${l.template}+${r.template}`, nodes: [...l.nodes, ...r.nodes] };
      }
    }
  }

  return { matched: false, nodes: [] };
}

function indexOfTopLevelAnd(s: string): number {
  // split on " and " but not inside stat chains ("+2 {s} and +2 {w}") or
  // fixed phrases where "and" is part of a single effect
  const re = /\s+and\s+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const before = s.slice(Math.max(0, m.index - 12), m.index);
    const after = s.slice(m.index + 5, m.index + 14);
    if (/[+-]\s*\d+\s*(?:\{[swl]\}|\w+)$/.test(before) && /^[+-]\s*\d+/.test(after)) continue;
    if (/^facedown and exerted/.test(after)) continue;
    return m.index;
  }
  return -1;
}

/* --------------------------------------------- continuous (block-level) */

interface ContinuousMatch { ability: ContinuousAbility; matchedAll: boolean }

const CONTINUOUS_TEMPLATES: {
  name: string;
  re: RegExp;
  build: (m: RegExpMatchArray, card: CardDefinition) => Omit<ContinuousAbility, "name">;
}[] = [
  { name: "buff-your-characters",
    re: /^your (other )?characters get ([+-]\s*\d+\s*(?:\{[swl]\}))(?: and [+-]\s*\d+\s*(?:\{[swl]\}))*$/i,
    build: (m) => {
      const stat = parseStatMods(m[0])!;
      return { selector: yourCharacters, modifier: { duration: WHILE_IN_PLAY, stat } };
    } },
  { name: "buff-your-classification-stat",
    re: /^your (other )?([A-Z]\w+ )?characters get ([+-]\s*\d+\s*(?:\{[swl]\}))(?: and [+-]\s*\d+\s*(?:\{[swl]\}))*$/i,
    build: (m) => ({
      selector: {
        zone: "play", who: "self", type: "Character",
        ...(m[2] ? { classification: m[2].trim() } : {}),
      },
      modifier: { duration: WHILE_IN_PLAY, stat: parseStatMods(m[0])! },
    }) },
  { name: "opponents-cant-choose",
    re: /^opponents can't choose your (characters|items|locations)(?: for abilities or effects)?$/i,
    build: (m) => ({
      selector: { zone: "play", who: "self", type: (m[1][0].toUpperCase() + m[1].slice(1, -1)) as CardType },
      modifier: { duration: WHILE_IN_PLAY, grantKeywords: ["Ward"] },
    }) },
  { name: "self-keyword-during-your-turn-while",
    re: /^during your turn, this character gains? (\w+) while .+$/i,
    build: (m) => ({
      selector: selfSel("Character"),
      modifier: { duration: WHILE_IN_PLAY, grantKeywords: [capitalize(m[1]) as Keyword] },
    }) },
  { name: "buff-your-classification-keyword",
    re: /^your (other )?([A-Z]\w+ )?characters(?: with (\w+))? gain (\w+)$/i,
    build: (m) => ({
      selector: {
        zone: "play", who: "self", type: "Character",
        ...(m[2] ? { classification: m[2].trim() } : {}),
      },
      modifier: { duration: WHILE_IN_PLAY, grantKeywords: [capitalize(m[4]) as Keyword] },
    }) },
  { name: "buff-your-locations-keyword",
    re: new RegExp(`^your locations gain (Resist) \\+?${N}$`, "i"),
    build: (m) => ({
      selector: { zone: "play", who: "self", type: "Location" },
      modifier: { duration: WHILE_IN_PLAY, grantKeywords: ["Resist"], resist: parseNum(m[2]) },
    }) },
  { name: "buff-while-here",
    re: /^characters get ([+-]\s*\d+\s*(?:\{[swl]\}))(?: and [+-]\s*\d+\s*(?:\{[swl]\}))* while here$/i,
    build: (m) => {
      const stat = parseStatMods(m[0])!;
      return { selector: { zone: "play", who: "any", type: "Character" }, modifier: { duration: WHILE_IN_PLAY, stat } };
    } },
  { name: "self-buff-while",
    re: /^while .+?, (?:this character|he|she|it) gets? ([+-]\s*\d+\s*(?:\{[swl]\}))(?: and [+-]\s*\d+\s*(?:\{[swl]\}))*$/i,
    build: (m) => {
      const stat = parseStatMods(m[0])!;
      return { selector: selfSel("Character"), modifier: { duration: WHILE_IN_PLAY, stat } };
    } },
  { name: "self-keyword-while",
    re: new RegExp(`^while .+?, (?:this character|that character|he|she|it|they) gains? (Evasive|Ward|Bodyguard|Support|Reckless|Alert|Vanish|Rush|Resist \\+?${N}|Challenger \\+?${N})$`, "i"),
    build: (m) => {
      const kw = m[1].split(" ")[0];
      const value = m[1].split(" ")[1];
      return {
        selector: selfSel("Character"),
        modifier: {
          duration: WHILE_IN_PLAY,
          grantKeywords: [capitalize(kw) as Keyword],
          ...(capitalize(kw) === "Resist" && value ? { resist: parseNum(value.replace("+", "")) } : {}),
        },
      };
    } },
  { name: "self-buff-for-each",
    re: /^(?:this character|he|she|it) gets? ([+-]\s*\d+\s*(?:\{[swl]\}))(?: and [+-]\s*\d+\s*(?:\{[swl]\}))* for each .+$/i,
    build: (m) => {
      const stat = parseStatMods(m[0])!;
      // flat approximation of the per-unit buff (documented)
      return { selector: selfSel("Character"), modifier: { duration: WHILE_IN_PLAY, stat } };
    } },
  { name: "self-keyword-during-your-turn",
    re: /^during your turn, this character gains? (Evasive|Ward|Bodyguard|Support|Reckless|Alert|Vanish|Rush)$/i,
    build: (m) => ({
      selector: selfSel("Character"),
      modifier: { duration: WHILE_IN_PLAY, grantKeywords: [capitalize(m[1]) as Keyword] },
    }) },
  { name: "self-cant-if",
    re: /^if .+?, this character can't (challenge|ready|quest)$/i,
    build: (m) => ({
      selector: selfSel("Character"),
      modifier: {
        duration: WHILE_IN_PLAY,
        ...(m[1].toLowerCase() === "challenge" ? { cantChallenge: true } : {}),
        ...(m[1].toLowerCase() === "ready" ? { cantReady: true } : {}),
        ...(m[1].toLowerCase() === "quest" ? { cantQuest: true } : {}),
      },
    }) },
  { name: "self-keyword-if",
    re: new RegExp(`^if .+?, (?:this character|he|she|it) gains? (Evasive|Ward|Bodyguard|Support|Reckless|Alert|Vanish|Rush|Resist \\+?${N}|Challenger \\+?${N})$`, "i"),
    build: (m) => {
      const kw = m[1].split(" ")[0];
      const value = m[1].split(" ")[1];
      return {
        selector: selfSel("Character"),
        modifier: {
          duration: WHILE_IN_PLAY,
          grantKeywords: [capitalize(kw) as Keyword],
          ...(capitalize(kw) === "Resist" && value ? { resist: parseNum(value.replace("+", "")) } : {}),
        },
      };
    } },
  { name: "self-buff-if",
    re: /^if .+?, (?:this character|he|she|it) gets? ([+-]\s*\d+\s*(?:\{[swl]\}))(?: and [+-]\s*\d+\s*(?:\{[swl]\}))*$/i,
    build: (m) => {
      const stat = parseStatMods(m[0])!;
      return { selector: selfSel("Character"), modifier: { duration: WHILE_IN_PLAY, stat } };
    } },
  { name: "self-cant",
    re: /^this character can't (challenge|ready|quest)$/i,
    build: (m) => ({
      selector: selfSel("Character"),
      modifier: {
        duration: WHILE_IN_PLAY,
        ...(m[1].toLowerCase() === "challenge" ? { cantChallenge: true } : {}),
        ...(m[1].toLowerCase() === "ready" ? { cantReady: true } : {}),
        ...(m[1].toLowerCase() === "quest" ? { cantQuest: true } : {}),
      },
    }) },
];

function matchContinuous(text: string, card: CardDefinition, name?: string): ContinuousMatch | null {
  const t0 = text.replace(/[.\s]+$/g, "");
  for (const t of CONTINUOUS_TEMPLATES) {
    const m = t0.match(t.re);
    if (m) return { matchedAll: true, ability: { ...(name ? { name } : {}), ...t.build(m, card) } };
  }
  return null;
}

/* --------------------------------------------------- block processing */

export interface BlockOutcome {
  matchedSentences: number;
  totalSentences: number;
  script: Pick<CardScript, "keywords" | "shiftCost" | "singTogether" | "triggered" | "activated" | "continuous">;
  unmatched: string[];
}

export const emptyBlockOutcome = (): BlockOutcome => ({
  matchedSentences: 0, totalSentences: 0,
  script: { keywords: [], triggered: [], activated: [], continuous: [] },
  unmatched: [],
});
// singTogether is optional on script; set only when a Sing Together keyword is parsed.

export function processBlock(block: string, card: CardDefinition, out: BlockOutcome): void {
  // 1) keyword headers (possibly followed by ability text, e.g. "Sing Together 7 Look at...")
  const kw = parseKeywordHeader(block);
  let workText = block;
  if (kw) {
    out.script.keywords!.push(...kw.keywords);
    if (kw.shiftCost !== undefined) out.script.shiftCost = kw.shiftCost;
    if (kw.singTogether !== undefined) out.script.singTogether = kw.singTogether;
    if (kw.rest.replace(/[.\s]/g, "").length === 0) {
      out.matchedSentences += 1;
      out.totalSentences += 1;
      return;
    }
    out.matchedSentences += 1; // the keyword header itself is translated
    out.totalSentences += 1;
    workText = kw.rest;
  }

  // 2) split printed name
  const { name, text } = splitAbilityName(workText);
  const cleanText = stripReminders(text);
  if (!cleanText) {
    // name-only block (e.g. keyword header wrapped by reminders)
    return;
  }

  // 3) continuous block?
  const cont = matchContinuous(cleanText, card, name);
  if (cont) {
    out.script.continuous!.push(cont.ability);
    const scount = splitSentences(cleanText).length || 1;
    out.matchedSentences += scount;
    out.totalSentences += scount;
    return;
  }

  // 4) activated cost prefix?
  const costMatch = parseCostPrefix(cleanText);
  // 5) trigger prefix on first sentence
  const sentences = splitSentences(costMatch ? costMatch.text : cleanText);
  let triggerMatch: TriggerMatch | null = null;
  let body = sentences;
  if (!costMatch && sentences.length > 0) {
    triggerMatch = matchTriggerPrefixes(sentences[0]);
    if (triggerMatch) {
      body = [triggerMatch.text, ...sentences.slice(1)];
    }
  }

  const effects: EffectNode[] = [];
  let allMatched = true;
  const ctx: SentenceContext = { card };
  for (let i = 0; i < body.length; i++) {
    let sentence = body[i];
    if (!sentence) continue;
    out.totalSentences += 1;
    // standalone "choose one:" with following "- " bullets
    if (/^(?:you may )?choose one:?$/i.test(sentence.replace(/[.]+$/, ""))) {
      const options: EffectNode[][] = [];
      let j = i + 1;
      let ok = true;
      for (; j < body.length && /^[-•]/.test(body[j].trim()); j++) {
        out.totalSentences += 1;
        const r = matchSentence(body[j], ctx);
        if (r.matched) { out.matchedSentences += 1; options.push(r.nodes); }
        else { ok = false; out.unmatched.push(body[j]); }
      }
      if (options.length > 0) {
        effects.push({ type: "CHOICE", prompt: "Choose one", options, min: 1, max: 1 });
        out.matchedSentences += 1; // the "choose one" intro line itself
      } else {
        out.unmatched.push(sentence);
      }
      i = j - 1;
      if (!ok) allMatched = false;
      continue;
    }
    const result = matchSentence(sentence, ctx);
    if (result.matched) {
      out.matchedSentences += 1;
      effects.push(...result.nodes);
      if (result.template && /look-top|reveal-top|search-deck|cont-/.test(result.template)) ctx.afterDeckPeek = true;
    } else {
      out.unmatched.push(sentence);
      allMatched = false;
    }
  }

  if (effects.length === 0) return;

  if (costMatch) {
    out.script.activated!.push({
      ...(name ? { name } : {}),
      cost: costMatch.cost,
      effects,
      ...(costMatch.oncePerTurn ? { oncePerTurn: true } : {}),
    });
  } else if (triggerMatch) {
    for (const trigger of triggerMatch.triggers) {
      out.script.triggered!.push({ ...(name ? { name } : {}), trigger, effects });
    }
  } else if (card.type === "Action") {
    out.script.triggered!.push({ ...(name ? { name } : {}), trigger: "ON_PLAY", effects });
  } else {
    // plain effect text on a permanent with no printed cost: smallest
    // reasonable fallback — zero-cost activated ability (documented).
    out.script.activated!.push({ ...(name ? { name } : {}), cost: {}, effects });
  }
  void allMatched;
}

/* ------------------------------------------------------- card driver */

import type { ScriptTier } from "./dsl-types.js";

export interface GeneratedCard {
  script: CardScript;
  tier: ScriptTier;
  matched: number;
  total: number;
  unmatched: string[];
}

export function generateScript(card: CardDefinition): GeneratedCard {
  const out = emptyBlockOutcome();
  const body = card.bodyText.trim().replace(/\r/g, "\n").replace(/\\n/g, "\n"); // a few dumps contain literal "\n"
  if (body) {
    for (const block of splitBlocks(stripReminders(body))) {
      processBlock(block, card, out);
    }
  }
  const s = out.script;
  const script: CardScript = { cardId: card.id };
  if (s.keywords!.length > 0) script.keywords = s.keywords;
  if (s.shiftCost !== undefined) script.shiftCost = s.shiftCost;
  if (s.singTogether !== undefined) script.singTogether = s.singTogether;
  if (s.triggered!.length > 0) script.triggered = s.triggered;
  if (s.activated!.length > 0) script.activated = s.activated;
  if (s.continuous!.length > 0) script.continuous = s.continuous;

  const hasContent =
    (script.keywords?.length ?? 0) > 0 ||
    script.singTogether !== undefined ||
    (script.triggered?.length ?? 0) > 0 ||
    (script.activated?.length ?? 0) > 0 ||
    (script.continuous?.length ?? 0) > 0;
  const tier: ScriptTier = !hasContent ? "vanilla" : out.unmatched.length === 0 ? "full" : "partial";
  return { script, tier, matched: out.matchedSentences, total: out.totalSentences, unmatched: out.unmatched };
}
