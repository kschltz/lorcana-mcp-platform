# Toys counter matrix results

- Games: **4000** (8 counters × 2 Toys lists × 250, seats alternated)
- Seed: 42
- Failures: **0**
- Engine: in-process GameEngine + heuristic policy + Lorcast inkable patch

## Combined ranking (win rate as deckA / counter)

| Rank | Counter | WR | Games | Avg turns | vs classic | vs sidbox |
|------|---------|----|------:|----------:|-----------:|----------:|
| 1 | `counter-amber-amethyst` | **81.6%** | 500 | 7.1 | 77.2% | 86.0% |
| 2 | `counter-amethyst-ruby` | **74.2%** | 500 | 6.7 | 74.4% | 74.0% |
| 3 | `counter-amethyst-sapphire` | **45.8%** | 500 | 7.8 | 45.6% | 46.0% |
| 4 | `counter-amber-steel` | **28.6%** | 500 | 9.3 | 24.0% | 33.2% |
| 5 | `counter-amber-emerald` | **22.0%** | 500 | 8.7 | 17.2% | 26.8% |
| 6 | `counter-emerald-ruby` | **10.8%** | 500 | 7.8 | 11.6% | 10.0% |
| 7 | `counter-ruby-steel` | **8.8%** | 500 | 11.1 | 6.8% | 10.8% |
| 8 | `counter-sapphire-steel` | **0.4%** | 500 | 9.9 | 0.8% | 0.0% |

## Takeaways

1. **Best counters:** Amber/Amethyst L2-lore race and Amethyst/Ruby Evasive (~74–86% WR).
2. **Playable:** Amethyst/Sapphire Evasive (~46%) — roughly even.
3. **Weak into Toys under this bot:** Emerald bounce shells and Steel removal (~0–33%). Steel stalls on challenges; Toys outrace them.
4. Sidbox Toys is slightly easier for the top race decks than the classic Horseman-heavy list.

## Caveats

Heuristic bots; incomplete WUN scripting (Boost / You've Got a Friend in Me tutoring); Set 13 absent. Treat as directional playtest data, not paper truth.
