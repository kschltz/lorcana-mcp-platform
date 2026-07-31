#!/usr/bin/env python3
"""lorcana_lookup.py — stdlib-only client for lorcana-api.com + best-effort dreamborn.ink.

Usage (from the skill directory, or pass absolute path):

  python3 scripts/lorcana_lookup.py card "Elsa" --title "Spirit of Winter" [--set FAB]
  python3 scripts/lorcana_lookup.py search color=Ruby rarity=Legendary [set-code=WUN]
  python3 scripts/lorcana_lookup.py bulk [--out /tmp/lorcana_bulk.json] [--local-bulk]
  python3 scripts/lorcana_lookup.py decks [--max-results 10]
  python3 scripts/lorcana_lookup.py deck <deck-id>
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

LORCANA_API = "https://api.lorcana-api.com"
DREAMBORN = "https://dreamborn.ink"
UA = "lorcana-card-analysis/1.0 (+stdlib urllib; Disney Lorcana analysis skill)"
DEFAULT_BULK_OUT = "/tmp/lorcana_bulk.json"

# Repo-local fallback (same shape as /bulk/cards) when running inside this monorepo.
_REPO_ROOT = Path(__file__).resolve().parents[4] if len(Path(__file__).resolve().parts) > 4 else Path.cwd()
_LOCAL_BULK_CANDIDATES = [
    Path.cwd() / "data" / "lorcana_bulk.raw.json",
    _REPO_ROOT / "data" / "lorcana_bulk.raw.json",
    Path("/workspace/data/lorcana_bulk.raw.json"),
]


class SourceError(RuntimeError):
    def __init__(self, source: str, message: str):
        super().__init__(f"[{source}] {message}")
        self.source = source


def _http_get_json(url: str, *, source: str, timeout: float = 45.0) -> Any:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            if not raw:
                raise SourceError(source, f"empty body from {url}")
            return json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:300]
        raise SourceError(source, f"HTTP {e.code} for {url}: {body}") from e
    except urllib.error.URLError as e:
        raise SourceError(source, f"network error for {url}: {e.reason}") from e
    except json.JSONDecodeError as e:
        raise SourceError(source, f"invalid JSON from {url}: {e}") from e


def _emit(obj: Any) -> None:
    json.dump(obj, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


def _split_name(full: str) -> tuple[str, str | None]:
    if " - " in full:
        a, b = full.split(" - ", 1)
        return a.strip(), b.strip()
    return full.strip(), None


def _norm_card(c: dict[str, Any], source: str) -> dict[str, Any]:
    """Normalize PascalCase (bulk) or kebab-case (legacy fuzzy) into one shape."""
    if "Name" in c or "Unique_ID" in c:
        name = c.get("Name") or ""
        base, title = _split_name(name)
        return {
            "source": source,
            "id": c.get("Unique_ID"),
            "fullName": name,
            "name": base,
            "title": title,
            "type": c.get("Type"),
            "colors": [x.strip() for x in str(c.get("Color") or "").split(",") if x.strip()],
            "cost": c.get("Cost"),
            "inkable": c.get("Inkable"),
            "strength": c.get("Strength"),
            "willpower": c.get("Willpower"),
            "lore": c.get("Lore"),
            "classifications": [
                x.strip() for x in str(c.get("Classifications") or "").split(",") if x.strip()
            ],
            "bodyText": c.get("Body_Text") or "",
            "flavorText": c.get("Flavor_Text") or "",
            "rarity": c.get("Rarity"),
            "setId": c.get("Set_ID"),
            "setNum": c.get("Set_Num"),
            "setName": c.get("Set_Name"),
            "cardNum": c.get("Card_Num"),
            "image": c.get("Image"),
            "artist": c.get("Artist"),
            "franchise": c.get("Franchise"),
            "raw": c,
        }
    # legacy fuzzy
    base = c.get("name") or ""
    title = c.get("subtitle")
    full = f"{base} - {title}" if title else base
    return {
        "source": source,
        "id": None,
        "fullName": full,
        "name": base,
        "title": title,
        "type": c.get("type"),
        "colors": [c["color"]] if c.get("color") else [],
        "cost": c.get("ink-cost") or c.get("cost"),
        "inkable": c.get("inkable"),
        "strength": c.get("strength"),
        "willpower": c.get("willpower"),
        "lore": c.get("lore-value") or c.get("lore"),
        "classifications": c.get("subtypes") or c.get("traits") or [],
        "bodyText": c.get("body-text") or c.get("abilities") or "",
        "flavorText": c.get("flavor-text") or "",
        "rarity": c.get("rarity"),
        "setId": c.get("set-code"),
        "setNum": None,
        "setName": c.get("set"),
        "cardNum": c.get("card-number"),
        "image": c.get("image"),
        "artist": c.get("artist"),
        "franchise": c.get("franchise"),
        "raw": c,
    }


# ---------------------------------------------------------------------------
# lorcana-api
# ---------------------------------------------------------------------------

def fetch_bulk(*, prefer_local: bool = False) -> list[dict[str, Any]]:
    if prefer_local:
        local = _load_local_bulk()
        if local is not None:
            return local
    try:
        data = _http_get_json(f"{LORCANA_API}/bulk/cards", source="lorcana-api")
        if not isinstance(data, list):
            raise SourceError("lorcana-api", f"/bulk/cards returned {type(data).__name__}")
        return data
    except SourceError:
        local = _load_local_bulk()
        if local is not None:
            return local
        raise


def _load_local_bulk() -> list[dict[str, Any]] | None:
    for path in _LOCAL_BULK_CANDIDATES:
        if path.is_file():
            with path.open(encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list):
                return data
    return None


def api_search(clauses: list[str]) -> list[dict[str, Any]]:
    q = ";".join(clauses)
    url = f"{LORCANA_API}/cards/fetch?search={urllib.parse.quote(q, safe=';=')}"
    data = _http_get_json(url, source="lorcana-api")
    if isinstance(data, dict) and data.get("status"):
        # error envelope
        raise SourceError("lorcana-api", data.get("details") or str(data))
    if isinstance(data, dict) and "Name" in data:
        return [data]
    if not isinstance(data, list):
        raise SourceError("lorcana-api", f"unexpected search payload: {type(data).__name__}")
    return data


def api_fuzzy(name: str) -> dict[str, Any] | None:
    url = f"{LORCANA_API}/cards/fetch?fuzzy={urllib.parse.quote(name)}"
    data = _http_get_json(url, source="lorcana-api")
    if isinstance(data, dict) and data.get("Name"):
        return data
    if isinstance(data, list) and data:
        return data[0]
    return None


# ---------------------------------------------------------------------------
# dreamborn (best-effort; often CF-blocked)
# ---------------------------------------------------------------------------

def dreamborn_get(path: str) -> Any:
    url = f"{DREAMBORN}{path}"
    return _http_get_json(url, source="dreamborn")


def fetch_public_decks(max_results: int = 10) -> dict[str, Any]:
    errors: list[str] = []
    for path in (
        f"/api/decks?sort=popular&limit={max_results}",
        f"/api/v1/decks?sort=popular&limit={max_results}",
        f"/api/public/decks?sort=popular&limit={max_results}",
    ):
        try:
            data = dreamborn_get(path)
            return {"source": "dreamborn", "path": path, "data": data}
        except SourceError as e:
            errors.append(str(e))
    return {
        "source": "dreamborn",
        "ok": False,
        "error": "All dreamborn deck list endpoints failed (often Cloudflare 403).",
        "errors": errors,
        "fallback": {
            "browse": "https://dreamborn.ink/decks?sort=popular",
            "hint": "Open in a browser / computer-use agent and copy deck ids, then re-run: deck <id>",
        },
    }


def fetch_deck(deck_id: str) -> dict[str, Any]:
    errors: list[str] = []
    for path in (
        f"/api/decks/{urllib.parse.quote(deck_id)}",
        f"/api/v1/decks/{urllib.parse.quote(deck_id)}",
        f"/api/public/decks/{urllib.parse.quote(deck_id)}",
    ):
        try:
            data = dreamborn_get(path)
            return {
                "source": "dreamborn",
                "path": path,
                "deck": data,
                "decklist_text": _deck_to_text(data),
                "ui": f"https://dreamborn.ink/decks/{deck_id}",
            }
        except SourceError as e:
            errors.append(str(e))
    return {
        "source": "dreamborn",
        "ok": False,
        "deckId": deck_id,
        "error": "Could not fetch deck JSON (often Cloudflare 403).",
        "errors": errors,
        "ui": f"https://dreamborn.ink/decks/{deck_id}",
        "fallback": "Open the UI URL, export/copy the text list, then resolve cards via `card` / `bulk`.",
    }


def _deck_to_text(deck: Any) -> str:
    """Best-effort convert a deck JSON into dreamborn text lines."""
    if not isinstance(deck, dict):
        return ""
    cards = deck.get("cards") or deck.get("decklist") or deck.get("list") or []
    lines: list[str] = []
    if isinstance(cards, dict):
        # id -> qty map or name -> qty
        for k, v in cards.items():
            if isinstance(v, dict):
                qty = v.get("quantity") or v.get("count") or v.get("qty") or 1
                name = v.get("fullName") or v.get("name") or k
            else:
                qty, name = v, k
            lines.append(f"{qty} {name}")
    elif isinstance(cards, list):
        for c in cards:
            if not isinstance(c, dict):
                continue
            qty = c.get("quantity") or c.get("count") or c.get("qty") or 1
            name = c.get("fullName") or c.get("name") or c.get("cardName")
            title = c.get("title") or c.get("subtitle") or c.get("version")
            if name and title and " - " not in str(name):
                name = f"{name} - {title}"
            if name:
                lines.append(f"{qty} {name}")
    return "\n".join(lines)


def dreamborn_enrich_card(name: str, title: str | None) -> dict[str, Any] | None:
    """Try to find price / variant info; returns None if blocked or missing."""
    q = f"{name} - {title}" if title else name
    for path in (
        f"/api/cards?name={urllib.parse.quote(q)}",
        f"/api/v1/cards?search={urllib.parse.quote(q)}",
    ):
        try:
            data = dreamborn_get(path)
            return {"source": "dreamborn", "path": path, "data": data}
        except SourceError:
            continue
    return None


# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------

def cmd_bulk(args: argparse.Namespace) -> int:
    cards = fetch_bulk(prefer_local=args.local_bulk)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as f:
        json.dump(cards, f, ensure_ascii=False)
    _emit({
        "ok": True,
        "source": "local" if args.local_bulk else "lorcana-api|/local-fallback",
        "count": len(cards),
        "path": str(out),
        "sets": sorted({c.get("Set_ID") for c in cards if c.get("Set_ID")}),
    })
    return 0


def cmd_card(args: argparse.Namespace) -> int:
    name = args.name.strip()
    title = (args.title or "").strip() or None
    set_code = (args.set or "").strip().upper() or None
    query = f"{name} - {title}" if title else name

    matches: list[dict[str, Any]] = []
    notes: list[str] = []

    # Prefer contains search on full name
    try:
        clauses = [f"Name~{name}"]
        if title:
            clauses = [f"Name~{name} - {title}"]
        found = api_search(clauses)
        matches.extend(found)
    except SourceError as e:
        notes.append(str(e))

    if not matches:
        try:
            fuzzy = api_fuzzy(query)
            if fuzzy:
                matches.append(fuzzy)
        except SourceError as e:
            notes.append(str(e))

    if set_code:
        filtered = [c for c in matches if str(c.get("Set_ID", "")).upper() == set_code]
        if filtered:
            matches = filtered
        else:
            notes.append(f"No hit with Set_ID={set_code}; showing unfiltered matches.")

    # Multiple versions: list them when subtitle omitted or ambiguous
    normalized = [_norm_card(c, "lorcana-api") for c in matches]
    if not title and len(normalized) > 1:
        _emit({
            "ok": True,
            "ambiguous": True,
            "message": "Multiple versions share this name — pick a subtitle (--title) before deep analysis.",
            "versions": [
                {
                    "fullName": n["fullName"],
                    "setId": n["setId"],
                    "cost": n["cost"],
                    "rarity": n["rarity"],
                    "id": n["id"],
                }
                for n in normalized
            ],
            "notes": notes,
        })
        return 0

    primary = normalized[0] if normalized else None
    dreamborn = None
    try:
        dreamborn = dreamborn_enrich_card(name, title)
    except Exception as e:  # noqa: BLE001 — surface soft failure
        notes.append(f"[dreamborn] enrich failed: {e}")

    if primary is None and dreamborn is None:
        _emit({
            "ok": False,
            "error": f"Card not found in lorcana-api for {query!r}. Try web search / dreamborn UI for brand-new sets.",
            "notes": notes,
        })
        return 1

    _emit({
        "ok": True,
        "query": {"name": name, "title": title, "set": set_code},
        "card": primary,
        "alternates": normalized[1:] if primary else normalized,
        "dreamborn": dreamborn or {
            "ok": False,
            "error": "No dreamborn JSON (CF block or missing endpoint). Use UI/prices manually if needed.",
        },
        "notes": notes,
        "sources": {
            "bodyText": "lorcana-api" if primary and primary.get("bodyText") else None,
            "stats": "lorcana-api" if primary else None,
            "price": "dreamborn" if dreamborn else None,
        },
    })
    return 0


_SEARCH_KEY_MAP = {
    "color": "Color",
    "rarity": "Rarity",
    "type": "Type",
    "name": "Name",
    "set-code": "Set_ID",
    "set_code": "Set_ID",
    "set": "Set_ID",
    "set-num": "Set_Num",
    "cost": "Cost",
    "inkable": "Inkable",
    "franchise": "Franchise",
    "classifications": "Classifications",
}


def cmd_search(args: argparse.Namespace) -> int:
    clauses: list[str] = []
    for item in args.filters:
        if "=" not in item:
            raise SystemExit(f"filter must be key=value, got {item!r}")
        k, v = item.split("=", 1)
        field = _SEARCH_KEY_MAP.get(k.lower(), k)
        # name defaults to contains
        if field == "Name" and not re.search(r"[~<>]=?", v):
            clauses.append(f"Name~{v}")
        else:
            clauses.append(f"{field}={v}")
    try:
        rows = api_search(clauses)
    except SourceError as e:
        _emit({"ok": False, "error": str(e)})
        return 1
    _emit({
        "ok": True,
        "source": "lorcana-api",
        "clauses": clauses,
        "count": len(rows),
        "cards": [_norm_card(c, "lorcana-api") for c in rows],
    })
    return 0


def cmd_decks(args: argparse.Namespace) -> int:
    _emit(fetch_public_decks(max_results=args.max_results))
    return 0


def cmd_deck(args: argparse.Namespace) -> int:
    _emit(fetch_deck(args.deck_id))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Lorcana card/deck lookup (lorcana-api + dreamborn)")
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("card", help="Lookup one card; merges lorcana-api + dreamborn when possible")
    c.add_argument("name", help='Card name, e.g. "Elsa"')
    c.add_argument("--title", help='Subtitle / version, e.g. "Spirit of Winter"')
    c.add_argument("--set", help="Set code filter, e.g. TFC / FAB / WUN")
    c.set_defaults(func=cmd_card)

    s = sub.add_parser("search", help="Filter cards: color=Ruby rarity=Legendary set-code=WUN")
    s.add_argument("filters", nargs="+", help="key=value filters")
    s.set_defaults(func=cmd_search)

    b = sub.add_parser("bulk", help="Download full card pool to JSON")
    b.add_argument("--out", default=DEFAULT_BULK_OUT, help=f"output path (default {DEFAULT_BULK_OUT})")
    b.add_argument("--local-bulk", action="store_true", help="Prefer repo data/lorcana_bulk.raw.json")
    b.set_defaults(func=cmd_bulk)

    d = sub.add_parser("decks", help="List popular public decks (dreamborn)")
    d.add_argument("--max-results", type=int, default=10)
    d.set_defaults(func=cmd_decks)

    one = sub.add_parser("deck", help="Fetch one deck by id (dreamborn)")
    one.add_argument("deck_id")
    one.set_defaults(func=cmd_deck)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except SourceError as e:
        _emit({"ok": False, "error": str(e)})
        return 1


if __name__ == "__main__":
    sys.exit(main())
