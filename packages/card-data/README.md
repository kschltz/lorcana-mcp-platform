# @lorcana/card-data

Normalizes the official Lorcana bulk dump (`data/lorcana_bulk.raw.json`) into
engine-ready card definitions (`dist-data/cards.json`, SPEC §3.1) and effect-DSL
scripts (`dist-data/scripts.json`, `Record<cardId, CardScript>`, SPEC §4), plus a
coverage report (`dist-data/coverage.json`).

## Commands

- `npm run build -w @lorcana/card-data` — `tsc`
- `npm run build-data -w @lorcana/card-data` — regenerate all three `dist-data/` artifacts (tsx)
- `npm test -w @lorcana/card-data` — vitest (includes the coverage gate)

## Pipeline

1. `normalize.ts` — keeps Lorcana-gamemode cards (missing/empty `Gamemode` counts as
   Lorcana; only an explicit foreign gamemode such as Illumineer's Quest is skipped),
   splits `Name - Subtitle` on the first `" - "` (verified: no bulk name contains two),
   splits dual-ink `Color` on `","`, maps `Action - Song` → `type:"Action"` +
   `Song` classification, keeps `bodyText` raw.
2. `templates.ts` — keyword header parsing (Rush; Evasive; Ward; Bodyguard; Support;
   Reckless; Alert; Vanish; Resist +N; Challenger +N; Shift N → `shiftCost`; Singer N;
   Boost N; named Shift variants like "Puppy Shift 3") and the sentence-template
   library (regex → EffectNode builder). Sentences are matched through a pipeline:
   `choose one` lists → templates → `you may X` (optional CHOICE) → `if …, X`
   (condition dropped) → `X, then Y` / `X and Y` conjunctions → discard/pay costs.
3. `generate-scripts.ts` — emits scripts + `coverage.json` (tier counts, matched-line
   ratio, unmatched pattern histogram) and prints the report.

**Coverage tiers**: `full` = every sentence translated, `partial` = keywords + some
abilities, `vanilla` = stats only (still emits a `CardScript`).

## Documented deviations / smallest-reasonable extensions (SPEC §4)

- `Selector.self?: boolean` — targets the script's own card ("this character").
- `DRAW.who?: "self" | "opponent"` (default `"self"`) — for "each player draws".
- `PUT_INTO_INKWELL.source` also accepts `"self"`, and may carry `target` for
  "put chosen X into the inkwell" effects.
- `Sing Together N` maps to `{name:"Singer", value:N}` (closest `Keyword` member).
- Triggers without a SPEC equivalent map to the closest one (documented in code):
  "whenever X challenges" → `ON_CHALLENGE_BANISH`; "whenever a(n) X is banished" →
  `ON_BANISH`; "whenever you play a character/location/action…" → `ON_PLAY_CHARACTER`;
  "whenever your characters sing a song" → `ON_PLAY_CHARACTER`;
  "whenever you put a card under this …" → `ON_PUT_UNDER`;
  "whenever you put a card under one of your …" → `ON_PUT_UNDER_FRIENDLY`.
- **Boost N** emits a once-per-turn activated ability (`pay N` → `PUT_UNDER` top deck
  under self), matching the printed reminder text.
- "You pay N {i} less for the next …" → `COST_REDUCTION` (turn-scoped ink discount).
- "Until the start of your next turn" / "during their next turn" → modifier duration
  `until-start-of-next-turn` (cleared at that player's next ready step).
- Continuous "while there's a card under …" uses `has-cards-under` conditions.
- Continuous abilities whose printed condition is still unmodelable (`if you have 3+
  cards in hand`, …) are emitted without `condition`; per-unit scaling buffs
  ("+1 {s} for each card under him") use the flat per-unit value; "your other
  characters" buffs apply to all your characters (the selector cannot exclude self).
- `If you do, …` / `if <unmodelable>, …` prefixes are dropped, keeping the effect.
- `you may pay N {i} to X` keeps X (the optional ink payment is not modeled).
- Remaining put-under phrasings without a top-deck source stay as `unmodeled-put-under`
  noops; deck-ordering bookkeeping continuations ("Put the rest on the bottom of
  your deck in any order") are `cont-*` noops.
- "Remove all damage" uses `REMOVE_DAMAGE{amount:99}`; "discard your hand" is not
  matched.
- Plain effect text on a permanent with no printed cost/trigger becomes a zero-cost
  activated ability; on Actions it becomes an `ON_PLAY` trigger.
- "This character can't {e} to sing songs" ≈ `cantQuest` modifier.
