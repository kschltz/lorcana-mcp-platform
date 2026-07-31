# Toys meta counter battery (Core Constructed)

In-process AI-vs-AI sims of **Core-legal** candidate counters vs Amber/Ruby
Toys, using `@lorcana/bots` heuristics + `@lorcana/engine`.

## Format

Core Constructed after the July 2026 rotation = **Sets 9–13** (FAB–Attack of
the Vine). This repo’s card pool currently tops out at **Set 12 (WUN)** — Set 13
is not present — so decks and the `--core` filter use **sets 9–12**.

```bash
npx tsx packages/bots/src/bulk-sim.ts \
  --core \
  --matrix data/toys-meta \
  --games 250 --seed 42 \
  --metrics data/toys-meta/results.jsonl
```

Inkable flags for sets 6/10/11/12 are patched from
`data/inkable/lorcast-sets-6-10-11-12.json`.

## Toys references (Core-legal)

| File | Notes |
|------|--------|
| `toys-ar-classic.txt` | Thijn W. "Toys 'r us" (inkdecks 512188) |
| `toys-ar-sidbox.txt` | Vince "Sid's toybox" (inkdecks 516250) |

## Counter candidates (Core 9–12)

| File | Plan |
|------|------|
| `counter-amber-amethyst.txt` | Cheap L2 lore + Amethyst evasives |
| `counter-amethyst-ruby.txt` | Amethyst/Ruby Evasive + Ruby removal |
| `counter-amethyst-sapphire.txt` | Evasive + sapphire filter / ink hate |
| `counter-amber-emerald.txt` | Amber race + Mother Knows Best package |
| `counter-amber-ruby.txt` | Amber/Ruby aggressive race |
| `counter-amber-steel.txt` | Amber lore + steel damage |
| `counter-emerald-sapphire.txt` | Bounce-control |
| `counter-ruby-steel.txt` | Ruby/Steel removal midrange |
| `counter-sapphire-steel.txt` | Sapphire filter into steel clears |

## Results

See [`RESULTS.md`](./RESULTS.md) for the latest Core matrix.

## Caveats

- Heuristic bots; directional only.
- Partial WUN scripting (Boost / Friend in Me tutoring).
- No Set 13 cards (Elinor Brave package, Boost payoffs, etc.).
