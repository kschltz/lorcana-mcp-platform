# dreamborn.ink

Deck builder + public meta decks + market prices (USD). Often ahead of lorcana-api on the newest set.

**Cloudflare** frequently challenges non-browser clients (HTTP 403). The lookup script retries with browser-like headers; if still blocked, say so and fall back to lorcana-api / web search — do not invent prices or decklists.

## Public surface (best-effort)

There is no official public developer API. Community tools typically use:

| Purpose | URL pattern | Notes |
|---------|-------------|-------|
| Site / deck UI | `https://dreamborn.ink/decks/{id}` | Human-readable deck page |
| Popular decks | `https://dreamborn.ink/decks?sort=popular` | Meta browsing |
| JSON (unstable) | `https://dreamborn.ink/api/...` | May 403 behind CF; script probes known paths |

When JSON is available, expect deck payloads roughly like:

```json
{
  "id": "abc123",
  "name": "Ruby/Sapphire Aggro",
  "description": "…",
  "likes": 120,
  "views": 4000,
  "totalPrice": 84.5,
  "formats": [1],
  "cards": [{ "name": "Elsa - Spirit of Winter", "quantity": 2, "price": 12.0 }]
}
```

- `formats`: `1` = Core, `2` = Infinity (confirm current rotation before advising Core legality).
- Prefer `totalPrice` from the deck payload over summing card prices when both exist.

## Decklist text format (dreamborn / inktable / pixelborn)

One card per line:

```
4 Elsa - Spirit of Winter
2 Be Prepared
4 Sail the Azurite Sea
```

Rules for delivery:

- `{qty} {Name} - {Subtitle}` for named versions; actions/items without subtitle omit ` - …`.
- Blank lines, `#` / `//` comments, and `Total: 60` lines are ignored by most importers.
- Max 4 copies of a Unique_ID (except special cases); ≤2 inks in Core constructed.

## What to pull from dreamborn vs lorcana-api

| Data | Prefer |
|------|--------|
| Body text / abilities | lorcana-api `Body_Text` |
| Stats (cost/strength/willpower/lore/inkable) | lorcana-api (cross-check dreamborn) |
| Market price USD | dreamborn |
| Public meta decks / likes / archetype notes | dreamborn |
| Newest set not yet in lorcana-api | dreamborn + web for text |

## Manual fallback when API is blocked

1. Open the deck URL in a browser / computer-use agent.
2. Export or copy the text list from the deck builder.
3. Paste into analysis; still resolve each line against lorcana-api bulk for stats.
