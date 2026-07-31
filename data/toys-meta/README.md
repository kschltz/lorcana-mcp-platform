# Toys meta counter battery (Core Constructed)

In-process AI-vs-AI sims of **Core-legal** counters vs Amber/Ruby Toys.

## Format

Core after July 2026 rotation = Sets **9–13**. This repo’s pool ends at Set 12,
so decks and `bulk-sim --core` use **sets 9–12** (FAB–WUN).

```bash
npx tsx packages/bots/src/bulk-sim.ts \
  --core --matrix data/toys-meta \
  --games 300 --seed 42 \
  --metrics data/toys-meta/results.jsonl
```

## Best answer so far

**`counter-amber-ruby.txt`** — Amber/Ruby L2/L3 lore race + Ghostly Tale  
(~52% combined WR over 600 games; slight favorite into both Toys refs).

## Results

See [`RESULTS.md`](./RESULTS.md).

## Caveats

Heuristic bots; partial WUN Boost scripting; no Set 13. Directional only.
