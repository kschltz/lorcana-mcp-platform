# lorcana-api.com

Base URL: `https://api.lorcana-api.com` (not `lorcana-api.com` — that host is docs/UI only).

Free, no auth. Prefer the skill script (`scripts/lorcana_lookup.py`) over ad-hoc calls.

## Endpoints used by the skill

| Command | HTTP | Notes |
|---------|------|-------|
| `bulk` | `GET /bulk/cards` | Full pool (~2487 cards, sets 1–12). Also pageable via `/cards/all`. |
| `card` / fuzzy | `GET /cards/fetch?fuzzy={name}` or `/fuzzy/{name}` | Partial name match; returns one best hit (legacy `/fuzzy` uses kebab-case keys). |
| `search` | `GET /cards/fetch?search=Field=Value;Field2=Value` | Chain filters with `;`. `~` = contains (e.g. `Name~Elsa`). |
| strict | `GET /cards/fetch?strict={Full Name}` | Exact full name (`Name - Subtitle`). |

## Search field names (case-insensitive in practice)

Common filters: `Name`, `Color`, `Rarity`, `Type`, `Cost`, `Set_ID`, `Set_Num`, `Inkable`, `Classifications`, `Franchise`.

Examples:

```
Name~Elsa
Color=Ruby;Rarity=Legendary
Set_ID=WUN;Type=Character
Cost>=5;Inkable=true
```

## Bulk card model (PascalCase)

Key fields from `/bulk/cards`:

| Field | Meaning |
|-------|---------|
| `Unique_ID` | e.g. `FAB-043` |
| `Name` | Full printed name (`Elsa - Spirit of Winter`) |
| `Type` | Character / Action / Item / Location |
| `Color` | Ink(s), comma-separated for dual |
| `Cost`, `Inkable` | Ink cost / whether it can go in inkwell |
| `Strength`, `Willpower`, `Lore` | Character/location stats (absent on some types) |
| `Classifications` | Traits string, e.g. `Floodborn, Hero, Queen` |
| `Body_Text` | Abilities (primary rules text source) |
| `Flavor_Text`, `Rarity`, `Artist` | Extra |
| `Set_ID`, `Set_Num`, `Set_Name`, `Card_Num` | Set identity |
| `Image` | Art URL |
| `Gamemode` | Empty/Lorcana vs Illumineer's Quest etc. |

## Strict / fuzzy vs bulk

- **Bulk / fetch search**: PascalCase keys (`Body_Text`, `Set_ID`, …). Prefer this for analysis.
- **Legacy `/fuzzy/{name}`**: kebab-case (`body-text`, `set-code`, `lore-value`). Same card conceptually; normalize before merging.
- Bulk coverage historically lags brand-new sets; if a card is missing, fall back to dreamborn + web for text.

## Local fallback

This repo may already have `data/lorcana_bulk.raw.json` (same shape as `/bulk/cards`). The lookup script uses it when the network bulk fetch fails or when `--local-bulk` is passed.
