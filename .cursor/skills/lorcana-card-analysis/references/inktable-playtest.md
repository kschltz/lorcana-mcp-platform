# Ink Table playtest (inktable.net/lor)

Free in-browser Lorcana playtest vs AI. No account. Import dreamborn/pixelborn text lists.

Use this when the user asks you to **play / test / A-B** a deck yourself (not only suggest the URL).

## Manual path (user plays)

1. Open https://inktable.net/lor
2. Import → paste decklist text (`4 Name - Subtitle` lines)
3. Start AI match; note lore, key turns, mulligan feels

Always offer this link when delivering a finished list.

## Automated path (agent plays) — Playwright

Matches take on the order of **~30 minutes**. Prefer a long-lived session (tmux / IPython kernel). Record final score and takeaways per version. Record video when the user asks.

### Setup

```bash
# once per environment
pip install playwright
playwright install chromium
```

Block ads/trackers via route abort (keeps the board responsive):

```python
from playwright.sync_api import sync_playwright

BLOCK = ("doubleclick", "googlesyndication", "adservice", "facebook", "hotjar", "analytics")

def attach_blockers(page):
    def _block(route):
        url = route.request.url.lower()
        if any(b in url for b in BLOCK):
            return route.abort()
        return route.continue_()
    page.route("**/*", _block)
```

### Import + start

```python
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(record_video_dir="/tmp/inktable-videos" if RECORD else None)
    page = context.new_page()
    attach_blockers(page)
    page.goto("https://inktable.net/lor", wait_until="domcontentloaded")
    # UI labels drift — prefer role/text locators, then CSS fallbacks
    page.get_by_role("button", name=re.compile("import", re.I)).click()
    page.locator("textarea").fill(DECKLIST_TEXT)
    page.get_by_role("button", name=re.compile("import|confirm|load", re.I)).click()
    page.get_by_role("button", name=re.compile("play|start|vs.? ?ai", re.I)).click()
```

### Playing the game

Ink Table is click-driven (not a public game API):

1. Poll the action log / visible buttons each turn.
2. Prefer: ink (if available) → play on-curve → quest → favorable challenge → pass.
3. Resolve choice modals by clicking option buttons; never leave a modal open.
4. Stop on win/loss banner or lore ≥ 20 for either player.
5. Write a short report: seed/version, winner, approx turns, what flooded/bricked, cards that over/underperformed.

### A/B testing

Run the same protocol for each list (same number of games if possible). Compare win rate, average turns, and qualitative notes — do not invent stats.

### Pitfalls

- Cloudflare / cookie banners: dismiss before import.
- Locator text changes: re-inspect with `page.content()` / accessibility snapshot rather than hard-coding stale selectors.
- Do not hammer clicks; wait for network idle or a visible “your turn” affordance between actions.
- If automation cannot complete, fall back to delivering the list + manual inktable link and say what blocked you.
