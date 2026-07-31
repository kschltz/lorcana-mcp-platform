# Toys meta counter battery

In-process AI-vs-AI sims of candidate counters vs Amber/Ruby Toys
(Wilds Unknown package), using `@lorcana/bots` heuristics + `@lorcana/engine`.

## Toys references

| File | Notes |
|------|--------|
| `toys-ar-classic.txt` | Thijn W. "Toys 'r us" (inkdecks 512188) |
| `toys-ar-sidbox.txt` | Vince "Sid's toybox" (inkdecks 516250) |

## Counter candidates

| File | Plan |
|------|------|
| `counter-amethyst-ruby.txt` | Evasive + ruby tempo (primary pick) |
| `counter-amber-amethyst.txt` | Cheap L2 lore race + amethyst draw |
| `counter-amethyst-sapphire.txt` | Classic evasive + sapphire filter |
| `counter-emerald-ruby.txt` | Bounce tempo + ruby evasives |
| `counter-amber-emerald.txt` | Amber race + emerald bounce |
| `counter-amber-steel.txt` | Amber lore + steel songs |
| `counter-ruby-steel.txt` | Ruby/Steel removal midrange |
| `counter-sapphire-steel.txt` | Sapphire ramp into board clears |

## How to run

```bash
# Full matrix (N games per matchup, seats alternated)
npx tsx packages/bots/src/bulk-sim.ts \
  --matrix data/toys-meta \
  --games 250 --seed 42 \
  --metrics data/toys-meta/results.jsonl
```

Inkable flags for sets 6/10/11/12 are patched from
`data/inkable/lorcast-sets-6-10-11-12.json` (committed lorcana-api bulk has
broken `Inkable` on those sets).

## Caveats

- Heuristic bots, not humans; results are directional.
- Many WUN toy texts (Boost / Friend in Me tutoring) are only partially
  scripted — Toys may be weaker or differently shaped than paper.
- Set 13 (Attack of the Vine) is not in the committed card pool.
