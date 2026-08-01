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

## Amber/Emerald Dogs vs Toys

Tournament Dogs lists vs both Toys refs — **4000 games**:
see [`RESULTS-ae-vs-toys.md`](./RESULTS-ae-vs-toys.md) (~9–11% Dogs WR).
**Elinor COORDINATED EFFORTS is unscripted**, so treat as a floor.

## Forum lists (Toys-era Core 5–12)

Tournament lists people cite as Toys answers:

- `counter-forum-dale.txt` — Amber/Amethyst Dale (Cervellione)
- `counter-forum-amethyst-steel.txt` — Purple Steel + Cobra (Tiny_Dragon_88)
- `counter-forum-cobra-steel.txt` — leaner Cobra Steel (Jeff Douglas)

**3000-game** matrix: see [`RESULTS-forum.md`](./RESULTS-forum.md). Combined WRs ~8–19% — **not trustworthy yet** because Dale SPIKE SUIT and Doc Bold Knight are unscripted.

## Results

See [`RESULTS.md`](./RESULTS.md) (Core 9–12 homebrew) and [`RESULTS-forum.md`](./RESULTS-forum.md).

## Caveats

Heuristic bots; partial WUN Boost scripting; no Set 13; Dale SPIKE SUIT missing. Directional only.
