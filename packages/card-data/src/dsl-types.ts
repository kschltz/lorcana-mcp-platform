/**
 * Local copies of the contracts from SPEC.md §3.1 / §4.
 *
 * card-data is generated ahead of (and independently from) @lorcana/engine, so the
 * shapes are duplicated here to keep the package buildable on its own. Field names and
 * semantics MUST stay in sync with the engine contract.
 *
 * Documented smallest-reasonable extensions over SPEC §4 (see README.md):
 *  - Selector.self?: boolean — targets the source card of the script itself.
 *  - PUT_INTO_INKWELL.source also accepts "self" (put this card into the inkwell).
 *  - DISCARD.who "each" is not used; "each player" effects are emitted as two nodes.
 *  - LOOK_TOP gains an optional `filter` (card type / classification being looked for
 *    when `then` is "choose-into-hand").
 */

export type PlayerId = "p1" | "p2";
export type InkColor = "Amber" | "Amethyst" | "Emerald" | "Ruby" | "Sapphire" | "Steel";
export type CardType = "Character" | "Action" | "Item" | "Location";
export type Zone = "deck" | "hand" | "inkwell" | "discard" | "play";
export type Keyword =
  | "Rush" | "Evasive" | "Ward" | "Bodyguard" | "Reckless" | "Support" | "Resist"
  | "Challenger" | "Singer" | "Shift" | "Alert" | "Vanish" | "Boost";

export interface CardDefinition {
  id: string;
  name: string;
  subtitle?: string;
  fullName: string;
  type: CardType;
  colors: InkColor[];
  cost: number;
  inkable: boolean;
  strength?: number;
  willpower?: number;
  lore?: number;
  moveCost?: number;
  classifications: string[];
  bodyText: string;
  rarity: string;
  setId: string;
  setNum: number;
  cardNum: number;
  imageUrl: string;
}

export interface Modifier {
  id: string;
  source: string;
  duration: "this-turn" | "while-in-play" | "permanent";
  stat?: { strength?: number; willpower?: number; lore?: number };
  grantKeywords?: Keyword[];
  removeKeywords?: Keyword[];
  resist?: number;
  cantQuest?: boolean;
  cantChallenge?: boolean;
  cantReady?: boolean;
  singerAs?: number;
  condition?: string;
}

export interface Selector {
  zone: "play" | "hand" | "discard";
  who: "self" | "opponent" | "any";
  type?: CardType;
  classification?: string;
  name?: string;
  filter?: "exerted" | "ready" | "damaged" | "undamaged" | "wet";
  maxCost?: number;
  maxStrength?: number;
  chosen?: boolean;
  count?: number;
  ref?: string;
  /** extension: target the source card of this script */
  self?: boolean;
}

export type Condition =
  | { kind: "count"; selector: Selector; op: ">=" | "<=" | "=="; value: number }
  | { kind: "has-keyword"; selector: Selector; keyword: Keyword }
  | { kind: "stat"; selector: Selector; stat: "strength" | "willpower" | "lore"; op: ">=" | "<=" | "=="; value: number };

export type Trigger =
  | "ON_PLAY" | "ON_QUEST" | "ON_CHALLENGE_BANISH" | "ON_BANISH"
  | "START_OF_TURN" | "END_OF_TURN" | "ON_OPPONENT_PLAY" | "ON_PLAY_CHARACTER";

export interface AbilityCost {
  ink?: number;
  exert?: boolean;
  discard?: number;
  banishSelf?: boolean;
}

export type EffectNode =
  | { type: "DRAW"; amount: number; who?: "self" | "opponent" } // who: extension (default "self")
  | { type: "DEAL_DAMAGE"; amount: number; target: Selector }
  | { type: "REMOVE_DAMAGE"; amount: number; target: Selector }
  | { type: "GAIN_LORE"; amount: number }
  | { type: "OPPONENT_LOSE_LORE"; amount: number }
  | { type: "BANISH"; target: Selector }
  | { type: "RETURN_TO_HAND"; target: Selector }
  | { type: "PUT_ON_BOTTOM"; target: Selector }
  | { type: "EXERT"; target: Selector }
  | { type: "READY"; target: Selector }
  | { type: "ADD_MODIFIER"; target: Selector; modifier: Omit<Modifier, "id" | "source">; duration: Modifier["duration"] }
  | { type: "GRANT_KEYWORD"; target: Selector; keyword: Keyword; value?: number }
  | { type: "DISCARD"; amount: number; who: "self" | "opponent"; mode: "random" | "chosen" }
  | { type: "LOOK_TOP"; amount: number; then: "keep-order" | "bottom-rest" | "choose-into-hand"; filter?: { type?: CardType; classification?: string } }
  | { type: "PUT_INTO_INKWELL"; source?: "top-deck" | "self"; target?: Selector }
  | { type: "SEARCH_DECK"; filter: { type?: CardType; classification?: string; name?: string }; into: "hand" | "play" }
  | { type: "PLAY_CARD_FREE"; filter: { type?: CardType; classification?: string; maxCost?: number; from?: "hand" | "discard" } }
  | { type: "MOVE_DAMAGE"; amount: number; from: Selector; to: Selector }
  | { type: "PREVENT_DAMAGE"; amount: number; target: Selector; duration: Modifier["duration"] }
  | { type: "CHOICE"; prompt: string; options: EffectNode[][]; min: number; max: number; target?: Selector }
  | { type: "FOR_EACH"; selector: Selector; effects: EffectNode[] }
  | { type: "IF"; condition: Condition; then: EffectNode[]; else: EffectNode[] };

export interface TriggeredAbility {
  name?: string;
  trigger: Trigger;
  effects: EffectNode[];
}

export interface ActivatedAbility {
  name?: string;
  cost: AbilityCost;
  effects: EffectNode[];
  oncePerTurn?: boolean;
}

export interface ContinuousAbility {
  name?: string;
  selector: Selector;
  modifier: Omit<Modifier, "id" | "source">;
  condition?: Condition;
}

export interface CardScript {
  cardId: string;
  keywords?: { name: Keyword; value?: number }[];
  shiftCost?: number;
  /** Sing Together N — multi-character song payment threshold. */
  singTogether?: number;
  triggered?: TriggeredAbility[];
  activated?: ActivatedAbility[];
  continuous?: ContinuousAbility[];
}

export type ScriptTier = "full" | "partial" | "vanilla";
