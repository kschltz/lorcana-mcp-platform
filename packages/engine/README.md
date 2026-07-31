# @lorcana/engine

Deterministic Disney Lorcana rules engine + JSON effect-DSL interpreter.
Pure library: no I/O, no `Date.now()`/`Math.random()` — all randomness flows
through the seeded mulberry32 RNG (`src/rng.ts`), whose state lives in
`GameState.rngState`. Fog of war is NOT handled here (that's the server's job).

Implements SPEC §3 (core types, public API, rules) and §4 (Effect DSL) exactly.
Build: `npm run build -w @lorcana/engine`. Test: `npm test -w @lorcana/engine`.

## Documented extensions (smallest reasonable, per SPEC preamble)

The SPEC contracts are unchanged; these are additive and documented here:

1. **`{ type: "CONCEDE" }`** added to `PlayerAction` (SPEC §3.3 requires concede
   support; the action union had no path for it). Sets `winner` to the opponent
   with `winReason: "concede"`. Legal any time before game-over.
2. **`GameState.pendingResolution?: PendingResolution`** — the effect
   interpreter's continuation (frame queue + await spec + deferred turn
   segment) is pure JSON stored in the state, so a game suspended on a
   `PendingChoice` survives `serializeState`/`deserializeState` (needed for
   crash-resumable server persistence and replay).
3. **`CardInstance.atLocation?: string`** — instanceId of the Location a
   character is currently at (SPEC §3.3 "move to location" needs it; the
   contract had no field for it).
4. **Ink payment via `CardInstance.exerted` on inkwell cards** — "exerting ink"
   is tracked by exerting inkwell instances (ready each turn), per SPEC §3.3's
   "track `inkUsedThisTurn` or equivalent". Remaining ink = unexerted inkwell count.
5. **`GameEngine.fromSerialized(json, registry)`** (static) — rebuild an engine
   around a serialized state (server resume). RNG re-seeds from `rngState`;
   the continuation is read back from `pendingResolution`.
6. **`Selector.count?: number`** (chosen pick count, default 1) and
   **`Selector.ref?: string`** (variable reference, e.g. `"$each"` inside
   `FOR_EACH`, `"$target"` inside `CHOICE{target}`) — the SPEC Selector shape
   had no way to reference FOR_EACH iteration targets.
7. **`PlayChoices.payAlternatives`** usage: `{ mode: "sing", singer: <id> }`
   to sing a Song; `{ mode: "shift" }` + `targets: [<base id>]` to Shift.
   Bodyguard characters accept `options: ["exert"]` to enter play exerted.

## card-data integration (generated scripts.json contract)

The interpreter fully supports the DSL shapes emitted by
`@lorcana/card-data` (`dist-data/scripts.json`, 2487 scripts):

- **`Selector.self: boolean`** — targets the source card instance itself
  (self-targeting abilities; works for chosen targets and continuous abilities).
- **`DRAW.who?: "self" | "opponent" | "each"`** — controller draws (default) /
  opponent draws / each player draws (controller first).
- **`PUT_INTO_INKWELL`** accepts `source: "self"` (this card into its owner's
  inkwell) and an optional `target: Selector`; with no target it defaults to the
  top of the controller's deck. Targeted cards go to their *owner's* inkwell.
- Vanilla-tier scripts (keywords only, no abilities) play as plain stat cards;
  zero-node abilities (named noops such as `unmodeled-cost-reduction`) resolve
  gracefully as no-ops.
- `tests/real-scripts.test.ts` schema-validates ~20 sampled real generated
  scripts (including every extension user) plus 25 keyword-only scripts.

## Rules notes / simplifications

- **Reckless** enforcement: a Reckless character cannot quest, and PASS is
  illegal while any of your ready Reckless characters has a legal challenge.
- **Bodyguard** may enter play exerted via the play choice above; while an
  opposing Bodyguard is a legal challenge target, no other defender may be chosen.
- **Resist** sources do not stack — the highest applies (keyword + modifiers).
- **Parameterized keyword grants** (`GRANT_KEYWORD` with `value`): Resist uses
  `Modifier.resist`, Singer uses `Modifier.singerAs`; others are carried in
  `Modifier.condition` as `"grant:<Keyword>:<N>"`.
- **PREVENT_DAMAGE** is modeled as per-instance damage reduction (Resist-like)
  for the given duration.
- **Activated-ability discard costs** pick random cards (seeded RNG).
- **Action cards go to discard as they resolve** (before their effects finish),
  which keeps suspended resolutions consistent; their `ON_PLAY` effects still run.
- **`LOOK_TOP`**: `keep-order` asks for the resulting top-to-bottom order
  (`order-cards`); `bottom-rest` bottoms all looked-at cards; `choose-into-hand`
  puts any number (min 1) into hand and the rest on the bottom.
- **Single-candidate forced choices auto-resolve** (a `chosen` selector with
  exactly one legal candidate binds it without a PendingChoice).
- **Shift stacks**: the base card (and anything under it) moves into the new
  card's `under`; damage/exertion/dryness/location are inherited; the top card
  defines stats. Banished/returned stacks move all cards together.
- Turn numbering per SPEC: increments each time priority passes to p1; the very
  first turn (p1, turn 1) skips the draw step.
