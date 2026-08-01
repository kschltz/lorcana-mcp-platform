# Forum counters vs Toys (Toys-era Core sets 5–12)

**3000 games** — seed 42, 500/matchup, seats alternated. Heuristic bots.

| Counter | vs Classic | vs Sidbox | Combined | Fails |
|---|---:|---:|---:|---:|
| `counter-forum-dale` | 16.0% (500) | 22.0% (500) | **19.0%** | 0 |
| `counter-forum-amethyst-steel` | 18.5% (498) | 18.8% (499) | **18.7%** | 3 |
| `counter-forum-cobra-steel` | 8.2% (499) | 8.2% (499) | **8.2%** | 2 |

Raw rows: [`results-forum.jsonl`](./results-forum.jsonl).

## Why this disagrees with paper

Community cites these as Toys’ **bad** matchups; bots show ~8–19% WR. Main engine gaps:

| Card | Ability | Script status |
|---|---|---|
| Dale - Ready for His Shot | SPIKE SUIT (challenge with Willpower) | **empty** — guts Dale midrange |
| Doc - Bold Knight | discard hand → draw 2 | **empty** |
| Giant Cobra | Vanish + discard for 2 lore | present |
| Calhoun - Marine Sergeant | Resist + lore on challenge banish | present |
| Cheshire Cat - Inexplicable | Boost 2 | keyword only (Boost engine incomplete) |

Until Dale’s SPIKE SUIT is implemented, these forum lists are not a fair sim of the paper MU.

## Notes

- Window is **sets 5–12** (Toys-era Core). Hook / Calhoun / Doc / Cobra / Elsa Fifth Spirit / Genie Wish Fulfilled are illegal in post-rotation Core 9–12.
- Homebrew `counter-amber-ruby.txt` still leads under Core 9–12 (~52%).
