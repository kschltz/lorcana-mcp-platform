import type {
  CardDefinition,
  CardInstance,
  GameState,
  MatchSummary,
  Modifier,
  PlayerId,
  PlayerState,
  Zone,
} from "./types";

// ---------------------------------------------------------------------------
// Static card definitions (subset of the real card pool, from card-data).
// ---------------------------------------------------------------------------

function def(partial: Omit<CardDefinition, "setNum"> & { setNum?: number }): CardDefinition {
  return { setNum: partial.setId === "AZS" ? 6 : 7, ...partial };
}

const CARDS: Record<string, CardDefinition> = Object.fromEntries(
  [
    def({
      id: "AZS-020", name: "Simba", subtitle: "Pride Protector",
      fullName: "Simba - Pride Protector", type: "Character", colors: ["Amber"],
      cost: 5, inkable: false, strength: 4, willpower: 4, lore: 2,
      classifications: ["Floodborn", "Hero", "Prince"],
      bodyText: "Shift 3 (You may pay 3 {i} to play this on top of one of your characters named Simba.)\nUnderstand The Balance: At the end of your turn, if this character is exerted, you may ready your other characters.",
      rarity: "Legendary", setId: "AZS", cardNum: 20,
      imageUrl: "https://lorcana-api.com/images/simba/pride_protector/simba-pride_protector-large.png",
    }),
    def({
      id: "ARI-172", name: "Lady Click", subtitle: "Protective Confidant",
      fullName: "Lady Click - Protective Confidant", type: "Character",
      colors: ["Sapphire", "Steel"], cost: 5, inkable: true, strength: 2, willpower: 7, lore: 1,
      classifications: ["Storyborn", "Ally"],
      bodyText: "Bodyguard (This character may enter play exerted. An opposing character who challenges one of your characters must choose one with Bodyguard if able.)\nWard (Opponents can't choose this character except to challenge.)",
      rarity: "Uncommon", setId: "ARI", cardNum: 172,
      imageUrl: "https://lorcana-api.com/images/lady_click/protective_confidant/lady_click-protective_confidant-large.png",
    }),
    def({
      id: "ARI-023", name: "Thunderbolt", subtitle: "Wonder Dog",
      fullName: "Thunderbolt - Wonder Dog", type: "Character",
      colors: ["Amber", "Sapphire"], cost: 5, inkable: true, strength: 3, willpower: 7, lore: 2,
      classifications: ["Floodborn", "Hero"],
      bodyText: "Puppy Shift 3: (You may pay 3 {i} to play this on top of one of your Puppy characters.)\nBodyguard (This character may enter play exerted. An opposing character who challenges one of your characters must choose one with Bodyguard if able.)",
      rarity: "Uncommon", setId: "ARI", cardNum: 23,
      imageUrl: "https://lorcana-api.com/images/thunderbolt/wonder_dog/thunderbolt-wonder_dog-large.png",
    }),
    def({
      id: "ARI-002", name: "Perdita", subtitle: "Playful Mother",
      fullName: "Perdita - Playful Mother", type: "Character",
      colors: ["Amber", "Sapphire"], cost: 4, inkable: true, strength: 1, willpower: 4, lore: 2,
      classifications: ["Storyborn", "Hero"],
      bodyText: "Who's Next?: Whenever this character quests, you pay 2{i} less for the next Puppy character you play this turn.\nDon't Be Afraid: Your Puppy characters gain Ward. (Opponents can't choose them except to challenge.)",
      rarity: "Rare", setId: "ARI", cardNum: 2,
      imageUrl: "https://lorcana-api.com/images/perdita/playful_mother/perdita-playful_mother-large.png",
    }),
    def({
      id: "ARI-011", name: "The Troubadour", subtitle: "Musical Narrator",
      fullName: "The Troubadour - Musical Narrator", type: "Character",
      colors: ["Amber", "Steel"], cost: 2, inkable: true, strength: 1, willpower: 3, lore: 1,
      classifications: ["Storyborn", "Ally"],
      bodyText: "Resist +1 (Damage dealt to this character is reduced by 1.)\nSinger 4 (This character counts as cost 4 to sing songs.)",
      rarity: "Uncommon", setId: "ARI", cardNum: 11,
      imageUrl: "https://lorcana-api.com/images/the_troubadour/musical_narrator/the_troubadour-musical_narrator-large.png",
    }),
    def({
      id: "ARI-093", name: "Basil", subtitle: "Secret Informer",
      fullName: "Basil - Secret Informer", type: "Character", colors: ["Emerald"],
      cost: 6, inkable: true, strength: 3, willpower: 6, lore: 3,
      classifications: ["Dreamborn", "Hero", "Detective"],
      bodyText: "DRAW THEM OUT: Whenever this character quests, opposing damaged characters gain Reckless during their next turn. (They can't quest and must challenge if able.)",
      rarity: "Rare", setId: "ARI", cardNum: 93,
      imageUrl: "https://lorcana-api.com/images/basil/secret_informer/basil-secret_informer-large.png",
    }),
    def({
      id: "AZS-053", name: "Genie", subtitle: "Wish Fulfilled",
      fullName: "Genie - Wish Fulfilled", type: "Character", colors: ["Amethyst"],
      cost: 4, inkable: false, strength: 2, willpower: 4, lore: 2,
      classifications: ["Storyborn", "Ally"],
      bodyText: "Evasive (Only characters with Evasive can challenge this character.)\nWhat Comes Next?: When you play this character, draw a card.",
      rarity: "Rare", setId: "AZS", cardNum: 53,
      imageUrl: "https://lorcana-api.com/images/genie/wish_fulfilled/genie-wish_fulfilled-large.png",
    }),
    def({
      id: "AZS-034", name: "Hundred Acre Island", subtitle: "Pooh's Home",
      fullName: "Hundred Acre Island - Pooh's Home", type: "Location", colors: ["Amber"],
      cost: 1, inkable: false, strength: 0, willpower: 5, lore: 0, moveCost: 1,
      classifications: [],
      bodyText: "FRIENDS FOREVER - During an opponent's turn, whenever a character is banished while here, gain 1 lore.",
      rarity: "Common", setId: "AZS", cardNum: 34,
      imageUrl: "https://lorcana-api.com/images/hundred_acre_island/pooh's_home/hundred_acre_island-pooh's_home-large.png",
    }),
    def({
      id: "ARI-041", name: "Amber Coil", fullName: "Amber Coil", type: "Item",
      colors: ["Amber"], cost: 1, inkable: true, classifications: [],
      bodyText: "HEALING AURA: During your turn, whenever a card is put into your inkwell, you may remove up to 2 damage from chosen character.",
      rarity: "Uncommon", setId: "ARI", cardNum: 41,
      imageUrl: "https://lorcana-api.com/images/amber_coil/amber_coil-large.png",
    }),
    def({
      id: "ARI-042", name: "Spaghetti Dinner", fullName: "Spaghetti Dinner", type: "Item",
      colors: ["Amber"], cost: 2, inkable: false, classifications: [],
      bodyText: "FINE DINING: {e},1 {i} - If you have 2 or more characters in play, gain 1 lore.",
      rarity: "Common", setId: "ARI", cardNum: 42,
      imageUrl: "https://lorcana-api.com/images/spaghetti_dinner/spaghetti_dinner-large.png",
    }),
    def({
      id: "AZS-047", name: "Scar", subtitle: "Tempestuous Lion",
      fullName: "Scar - Tempestuous Lion", type: "Character", colors: ["Amethyst"],
      cost: 6, inkable: false, strength: 4, willpower: 4, lore: 2,
      classifications: ["Dreamborn", "Villain", "Sorcerer"],
      bodyText: "Rush (This character can challenge the turn they’re played.)\nChallenger +3 (While challenging, this character gets +3 {s}.)",
      rarity: "Uncommon", setId: "AZS", cardNum: 47,
      imageUrl: "https://lorcana-api.com/images/scar/tempestuous_lion/scar-tempestuous_lion-large.png",
    }),
    def({
      id: "ARI-009", name: "Mittens", subtitle: "Sassy Street Cat",
      fullName: "Mittens - Sassy Street Cat", type: "Character", colors: ["Amber"],
      cost: 5, inkable: false, strength: 4, willpower: 5, lore: 2,
      classifications: ["Storyborn", "Ally"],
      bodyText: "Bodyguard (This character may enter play exerted. An opposing character who challenges one of your characters must choose one with Bodyguard if able.)\nNO THANKS NECESSARY: Once during your turn, whenever a card is put into your inkwell, your other characters with Bodyguard get +1 {l} this turn.",
      rarity: "Rare", setId: "ARI", cardNum: 9,
      imageUrl: "https://lorcana-api.com/images/mittens/sassy_street_cat/mittens-sassy_street_cat-large.png",
    }),
    def({
      id: "AZS-039", name: "Sisu", subtitle: "In Her Element",
      fullName: "Sisu - In Her Element", type: "Character", colors: ["Amethyst"],
      cost: 5, inkable: false, strength: 3, willpower: 6, lore: 2,
      classifications: ["Storyborn", "Hero", "Deity", "Dragon"],
      bodyText: "Challenger +2 (While challenging, this character gets +2 {s}.)",
      rarity: "Common", setId: "AZS", cardNum: 39,
      imageUrl: "https://lorcana-api.com/images/sisu/in_her_element/sisu-in_her_element-large.png",
    }),
    def({
      id: "ARI-012", name: "Wendy Darling", subtitle: "Pirate Queen",
      fullName: "Wendy Darling - Pirate Queen", type: "Character",
      colors: ["Amber", "Ruby"], cost: 7, inkable: true, strength: 5, willpower: 7, lore: 2,
      classifications: ["Dreamborn", "Hero", "Queen", "Pirate", "Captain"],
      bodyText: "Evasive (Only characters with Evasive can challenge this character.)\nTELL NO TALES: Whenever one of your other characters is banished, you may remove all\ndamage from chosen character.",
      rarity: "Uncommon", setId: "ARI", cardNum: 12,
      imageUrl: "https://lorcana-api.com/images/wendy_darling/pirate_queen/wendy_darling-pirate_queen-large.png",
    }),
    def({
      id: "ARI-014", name: "Aurora", subtitle: "Waking Beauty",
      fullName: "Aurora - Waking Beauty", type: "Character", colors: ["Amber"],
      cost: 3, inkable: true, strength: 1, willpower: 4, lore: 2,
      classifications: ["Storyborn", "Hero", "Princess"],
      bodyText: "Singer 5 (This character counts as cost 5 to sing songs.)\nSWEET DREAMS: Whenever you remove 1 or more damage from a character, ready this character. She can't quest or challenge for the rest of this turn.",
      rarity: "Legendary", setId: "ARI", cardNum: 14,
      imageUrl: "https://lorcana-api.com/images/aurora/waking_beauty/aurora-waking_beauty-large.png",
    }),
    def({
      id: "AZS-037", name: "Madam Mim", subtitle: "Tiny Adversary",
      fullName: "Madam Mim - Tiny Adversary", type: "Character", colors: ["Amethyst"],
      cost: 2, inkable: false, strength: 0, willpower: 3, lore: 1,
      classifications: ["Storyborn", "Villain", "Sorcerer"],
      bodyText: "Challenger +1 (While challenging, this character gets +1 {s}.)\nZim Zabberim Bim: Your other characters gain Challenger +1.",
      rarity: "Rare", setId: "AZS", cardNum: 37,
      imageUrl: "https://lorcana-api.com/images/madam_mim/tiny_adversary/madam_mim-tiny_adversary-large.png",
    }),
    def({
      id: "AZS-035", name: "Sugar Rush Speedway", subtitle: "Finish Line",
      fullName: "Sugar Rush Speedway - Finish Line", type: "Location", colors: ["Amber"],
      cost: 2, inkable: false, strength: 0, willpower: 7, lore: 0, moveCost: 2,
      classifications: [],
      bodyText: "BRING IT HOME, KID! - When you move a character here from a location, you may banish this location to gain 3 lore and draw 3 cards.",
      rarity: "Super Rare", setId: "AZS", cardNum: 35,
      imageUrl: "https://lorcana-api.com/images/sugar_rush_speedway/finish_line/sugar_rush_speedway-finish_line-large.png",
    }),
    def({
      id: "ARI-043", name: "Kanine Krunchies", fullName: "Kanine Krunchies", type: "Item",
      colors: ["Amber"], cost: 1, inkable: true, classifications: [],
      bodyText: "YOU CAN BE A CHAMPION, TOO: Your Puppy characters get +1 {w}",
      rarity: "Common", setId: "ARI", cardNum: 43,
      imageUrl: "https://lorcana-api.com/images/kanine_krunchies/kanine_krunchies-large.png",
    }),
    def({
      id: "ARI-021", name: "Penny", subtitle: "Bolt's Person",
      fullName: "Penny - Bolt's Person", type: "Character",
      colors: ["Amber", "Steel"], cost: 2, inkable: true, strength: 1, willpower: 2, lore: 2,
      classifications: ["Storyborn", "Ally"],
      bodyText: "ENDURING LOYALTY: When you play this character, you may remove up to 2 damage from chosen character and they gain Resist +1 until the start of your next turn. (Damage dealt to them is reduced by 1.)",
      rarity: "Uncommon", setId: "ARI", cardNum: 21,
      imageUrl: "https://lorcana-api.com/images/penny/bolt's_person/penny-bolt's_person-large.png",
    }),
    def({
      id: "ARI-066", name: "Diablo", subtitle: "Spiteful Raven",
      fullName: "Diablo - Spiteful Raven", type: "Character",
      colors: ["Amethyst", "Emerald"], cost: 2, inkable: true, strength: 1, willpower: 2, lore: 1,
      classifications: ["Storyborn", "Ally"],
      bodyText: "Evasive (Only characters with Evasive can challenge this character.)\nChallenger +2 (While challenging, this character gets +2 {s}.)",
      rarity: "Uncommon", setId: "ARI", cardNum: 66,
      imageUrl: "https://lorcana-api.com/images/diablo/spiteful_raven/diablo-spiteful_raven-large.png",
    }),
    def({
      id: "ARI-006", name: "Trusty", subtitle: "Loyal Bloodhound",
      fullName: "Trusty - Loyal Bloodhound", type: "Character", colors: ["Amber"],
      cost: 2, inkable: true, strength: 2, willpower: 2, lore: 1,
      classifications: ["Storyborn", "Ally"],
      bodyText: "Support (Whenever this character quests, you may add their {s} to another chosen character's {s} this turn.)",
      rarity: "Common", setId: "ARI", cardNum: 6,
      imageUrl: "https://lorcana-api.com/images/trusty/loyal_bloodhound/trusty-loyal_bloodhound-large.png",
    }),
    def({
      id: "ARI-057", name: "Giant Cobra", subtitle: "Ghostly Serpent",
      fullName: "Giant Cobra - Ghostly Serpent", type: "Character",
      colors: ["Amethyst", "Steel"], cost: 3, inkable: true, strength: 4, willpower: 4, lore: 1,
      classifications: ["Dreamborn", "Ally", "Illusion"],
      bodyText: "Vanish (When an opponent chooses this character for an action, banish them.)\nMYSTERIOUS ADVANTAGE: When you play this character, you may choose and discard a card to gain 2 lore.",
      rarity: "Uncommon", setId: "ARI", cardNum: 57,
      imageUrl: "https://lorcana-api.com/images/giant_cobra/ghostly_serpent/giant_cobra-ghostly_serpent-large.png",
    }),
    def({
      id: "AZS-043", name: "Tinker Bell", subtitle: "Fast Flier",
      fullName: "Tinker Bell - Fast Flier", type: "Character", colors: ["Amethyst"],
      cost: 3, inkable: false, strength: 1, willpower: 3, lore: 2,
      classifications: ["Storyborn", "Ally", "Fairy"],
      bodyText: "Evasive (Only characters with Evasive can challenge this character.)",
      rarity: "Common", setId: "AZS", cardNum: 43,
      imageUrl: "https://lorcana-api.com/images/tinker_bell/fast_flier/tinker_bell-fast_flier-large.png",
    }),
    def({
      id: "ARI-070", name: "Kenai", subtitle: "Magical Bear",
      fullName: "Kenai - Magical Bear", type: "Character", colors: ["Amethyst"],
      cost: 3, inkable: true, strength: 1, willpower: 4, lore: 1,
      classifications: ["Storyborn", "Hero"],
      bodyText: "Challenger +2 (While challenging, this character gets +2 {s}.)\nWISDOM OF HIS STORY During your turn, when this character is banished in a challenge, return this card to your hand and gain 1 lore.",
      rarity: "Rare", setId: "ARI", cardNum: 70,
      imageUrl: "https://lorcana-api.com/images/kenai/magical_bear/kenai-magical_bear-large.png",
    }),
    def({
      id: "ARI-088", name: "Thomas O'Malley", subtitle: "Feline Charmer",
      fullName: "Thomas O'Malley - Feline Charmer", type: "Character", colors: ["Emerald"],
      cost: 3, inkable: true, strength: 4, willpower: 2, lore: 1,
      classifications: ["Storyborn", "Hero"],
      bodyText: "Ward (Opponents can't choose this character except to challenge.)",
      rarity: "Uncommon", setId: "ARI", cardNum: 88,
      imageUrl: "https://lorcana-api.com/images/thomas_o'malley/feline_charmer/thomas_o'malley-feline_charmer-large.png",
    }),
    def({
      id: "AZS-003", name: "Winnie the Pooh", subtitle: "Hunny Pirate",
      fullName: "Winnie the Pooh - Hunny Pirate", type: "Character", colors: ["Amber"],
      cost: 2, inkable: false, strength: 2, willpower: 2, lore: 1,
      classifications: ["Storyborn", "Hero", "Pirate"],
      bodyText: "Support (Whenever this character quests, you may add their {s} to another chosen character's {s} this turn.)\nWe're Pirates, You See: Whenever this character quests, you may pay 1 {i} less for the next Pirate character you play this turn.",
      rarity: "Rare", setId: "AZS", cardNum: 3,
      imageUrl: "https://lorcana-api.com/images/winnie_the_pooh/hunny_pirate/winnie_the_pooh-hunny_pirate-large.png",
    }),
    def({
      id: "ARI-124", name: "Denahi", subtitle: "Impatient Hunter",
      fullName: "Denahi - Impatient Hunter", type: "Character",
      colors: ["Ruby", "Steel"], cost: 3, inkable: true, strength: 3, willpower: 2, lore: 0,
      classifications: ["Storyborn"],
      bodyText: "Reckless (This character can't quest and must challenge each turn if able.)\nResist +2 (Damage dealt to this character is reduced by 2.)",
      rarity: "Uncommon", setId: "ARI", cardNum: 124,
      imageUrl: "https://lorcana-api.com/images/denahi/impatient_hunter/denahi-impatient_hunter-large.png",
    }),
  ].map((c) => [c.id, c]),
);

// ---------------------------------------------------------------------------
// Instance builders
// ---------------------------------------------------------------------------

let seq = 0;
function nextId(): string {
  seq += 1;
  return `m1-${String(seq).padStart(4, "0")}`;
}

interface InstOpts {
  exerted?: boolean;
  damage?: number;
  enteredTurn?: number;
  shiftedOnto?: string;
  under?: string[];
  modifiers?: Modifier[];
  withCard?: boolean;
}

function inst(
  owner: PlayerId,
  cardId: string,
  zone: Zone,
  opts: InstOpts = {},
): CardInstance {
  return {
    instanceId: nextId(),
    cardId,
    owner,
    zone,
    exerted: opts.exerted ?? false,
    damage: opts.damage ?? 0,
    enteredTurn: opts.enteredTurn ?? 1,
    shiftedOnto: opts.shiftedOnto,
    under: opts.under,
    modifiers: opts.modifiers ?? [],
    card: opts.withCard === false ? undefined : CARDS[cardId],
  };
}

/** Face-down stack filler (deck / inkwell) — no card identity exposed. */
function faceDown(owner: PlayerId, zone: Zone, count: number): CardInstance[] {
  return Array.from({ length: count }, () => inst(owner, "UNKNOWN", zone, { withCard: false }));
}

// ---------------------------------------------------------------------------
// The fixture: mid-game, turn 9, p1 to act, lore 12 vs 9.
// ---------------------------------------------------------------------------

function buildState(): GameState {
  seq = 0;

  const perdita = inst("p1", "ARI-002", "play", { enteredTurn: 3 });
  const thunderbolt = inst("p1", "ARI-023", "play", {
    enteredTurn: 8,
    shiftedOnto: perdita.instanceId,
    under: [perdita.instanceId],
  });

  const p1: PlayerState = {
    id: "p1",
    deck: faceDown("p1", "deck", 36),
    hand: [
      inst("p1", "ARI-124", "hand"),
      inst("p1", "AZS-003", "hand"),
      inst("p1", "ARI-021", "hand"),
      inst("p1", "ARI-006", "hand"),
      inst("p1", "ARI-023", "hand"),
    ],
    inkwell: faceDown("p1", "inkwell", 8),
    discard: [
      inst("p1", "ARI-006", "discard"),
      inst("p1", "ARI-021", "discard"),
    ],
    play: [
      thunderbolt,
      inst("p1", "AZS-020", "play", { enteredTurn: 5 }),
      inst("p1", "ARI-172", "play", { exerted: true, enteredTurn: 7 }),
      inst("p1", "ARI-011", "play", { exerted: true, enteredTurn: 9 }), // wet ink, sang this turn
      inst("p1", "ARI-093", "play", {
        enteredTurn: 6,
        damage: 2,
        modifiers: [
          {
            id: "mod-1",
            source: "m1-support",
            duration: "this-turn",
            stat: { strength: 2 },
          },
        ],
      }),
      inst("p1", "AZS-053", "play", { exerted: true, damage: 1, enteredTurn: 8 }),
      inst("p1", "AZS-034", "play", { enteredTurn: 4 }),
      inst("p1", "ARI-041", "play", { enteredTurn: 6 }),
      inst("p1", "ARI-042", "play", { exerted: true, enteredTurn: 7 }),
    ],
    lore: 12,
    inkPlayedThisTurn: 1,
    mulliganDone: true,
  };

  const mim = inst("p2", "AZS-037", "play", { enteredTurn: 8 });

  const p2: PlayerState = {
    id: "p2",
    deck: faceDown("p2", "deck", 37),
    hand: [
      inst("p2", "AZS-043", "hand"),
      inst("p2", "ARI-070", "hand"),
      inst("p2", "ARI-088", "hand"),
      inst("p2", "ARI-057", "hand"),
    ],
    inkwell: faceDown("p2", "inkwell", 7),
    discard: [
      inst("p2", "ARI-124", "discard"),
      inst("p2", "ARI-066", "discard"),
    ],
    play: [
      inst("p2", "AZS-047", "play", { exerted: true, damage: 3, enteredTurn: 8 }),
      inst("p2", "ARI-009", "play", { exerted: true, enteredTurn: 6 }),
      inst("p2", "AZS-039", "play", {
        enteredTurn: 7,
        modifiers: [
          {
            id: "mod-2",
            source: mim.instanceId,
            duration: "while-in-play",
            grantKeywords: ["Challenger"],
          },
        ],
      }),
      inst("p2", "ARI-012", "play", { enteredTurn: 8 }),
      inst("p2", "ARI-014", "play", { exerted: true, enteredTurn: 7 }),
      mim,
      inst("p2", "AZS-035", "play", { enteredTurn: 8 }),
      inst("p2", "ARI-043", "play", { enteredTurn: 6 }),
    ],
    lore: 9,
    inkPlayedThisTurn: 0,
    mulliganDone: true,
  };

  return {
    matchId: "mock-001",
    turn: 9,
    activePlayer: "p1",
    phase: "main",
    players: { p1, p2 },
    log: [
      { turn: 7, seq: 41, type: "turn-start", player: "p1", message: "Turn 7 — Player 1's turn begins." },
      { turn: 7, seq: 42, type: "ink", player: "p1", message: "Player 1 puts a card into their inkwell (8 ink)." },
      { turn: 7, seq: 43, type: "play", player: "p1", message: "Player 1 plays Lady Click - Protective Confidant. She enters play exerted (Bodyguard)." },
      { turn: 7, seq: 44, type: "quest", player: "p1", message: "Genie - Wish Fulfilled quests for 2 lore. (12 total)" },
      { turn: 7, seq: 45, type: "turn-start", player: "p2", message: "Turn 8 — Player 2's turn begins." },
      { turn: 8, seq: 46, type: "ink", player: "p2", message: "Player 2 puts a card into their inkwell (7 ink)." },
      { turn: 8, seq: 47, type: "play", player: "p2", message: "Player 2 plays Scar - Tempestuous Lion." },
      { turn: 8, seq: 48, type: "challenge", player: "p2", message: "Scar - Tempestuous Lion (Rush) challenges Genie - Wish Fulfilled." },
      { turn: 8, seq: 49, type: "damage", player: "p2", message: "Scar deals 3 damage to Genie - Wish Fulfilled." },
      { turn: 8, seq: 50, type: "damage", player: "p1", message: "Genie deals 2 damage back to Scar." },
      { turn: 8, seq: 51, type: "play", player: "p2", message: "Player 2 plays Sugar Rush Speedway - Finish Line." },
      { turn: 8, seq: 52, type: "move", player: "p2", message: "Sisu - In Her Element moves to Sugar Rush Speedway (2 ink)." },
      { turn: 9, seq: 53, type: "turn-start", player: "p1", message: "Turn 9 — Player 1's turn begins." },
      { turn: 9, seq: 54, type: "ink", player: "p1", message: "Player 1 puts a card into their inkwell (9 ink)." },
      { turn: 9, seq: 55, type: "play", player: "p1", message: "Player 1 plays The Troubadour - Musical Narrator." },
      { turn: 9, seq: 56, type: "sing", player: "p1", message: "The Troubadour sings (Singer 4) — Player 1 plays a song for free." },
      { turn: 9, seq: 57, type: "draw", player: "p1", message: "Player 1 draws 2 cards." },
      { turn: 9, seq: 58, type: "quest", player: "p1", message: "Basil - Secret Informer quests for 3 lore. (12 total)" },
    ],
    rngState: 123456789,
  };
}

const MOCK_STATE = buildState();

/** Finished variant used to demo the winner banner. */
const MOCK_FINISHED: GameState = {
  ...MOCK_STATE,
  matchId: "mock-000",
  turn: 21,
  phase: "game-over",
  winner: "p1",
  winReason: "lore",
  players: {
    ...MOCK_STATE.players,
    p1: { ...MOCK_STATE.players.p1, lore: 20 },
    p2: { ...MOCK_STATE.players.p2, lore: 14 },
  },
  log: [
    ...MOCK_STATE.log,
    { turn: 21, seq: 130, type: "quest", player: "p1", message: "Simba - Pride Protector quests for 2 lore. (20 total)" },
    { turn: 21, seq: 131, type: "game-over", player: "p1", message: "Player 1 reaches 20 lore and wins the game!" },
  ],
};

export const MOCK_MATCHES: MatchSummary[] = [
  {
    matchId: "mock-001",
    live: true,
    turn: 9,
    phase: "main",
    scores: { p1: 12, p2: 9 },
    createdAt: new Date(Date.now() - 18 * 60_000).toISOString(),
  },
  {
    matchId: "mock-000",
    live: false,
    turn: 21,
    phase: "game-over",
    scores: { p1: 20, p2: 14 },
    winner: "p1",
    winReason: "lore",
    createdAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
  },
];

export function getMockState(matchId: string): GameState {
  return matchId === "mock-000" ? MOCK_FINISHED : MOCK_STATE;
}
