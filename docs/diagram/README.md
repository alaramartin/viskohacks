# Slide diagram

One picture of how a walk gets made, sized for a slide: **2560×1440 (16:9)**.

- `walk-home-light.png` — for light decks
- `walk-home-dark.png` — for dark decks

Same diagram, two colourways. Drop either straight onto a slide; both carry their
own background, so they don't depend on the deck's.

## Regenerating

`diagram.html` is the source. It renders at exactly 1600×900 and is screenshotted
at 1.6× for the 2560×1440 export:

```bash
CH="/c/Program Files/Google/Chrome/Application/chrome.exe"   # or your Chrome path
"$CH" --headless=new --disable-gpu --window-size=1600,900 \
      --force-device-scale-factor=1.6 --hide-scrollbars --virtual-time-budget=9000 \
      --screenshot=walk-home-light.png "file:///$PWD/diagram.html?light"
"$CH" --headless=new --disable-gpu --window-size=1600,900 \
      --force-device-scale-factor=1.6 --hide-scrollbars --virtual-time-budget=9000 \
      --screenshot=walk-home-dark.png  "file:///$PWD/diagram.html?dark"
```

The `?light` / `?dark` query picks the colourway, so pass a real `file://` URL —
Chrome treats a bare `diagram.html?dark` as a filename and 404s.

Fonts come from Google Fonts, so the first render needs a network connection.

## Keeping it honest

Every figure in the diagram is measured, and most of them move if the code does:

| Claim | Source |
|---|---|
| cold start ≈9.0s | `PLAN.md`, Person 2 Phase 2 |
| one concurrent session | `docs/reactor-findings.md` Q3 |
| prompt morphs on a ~1.8s chunk | Q5 |
| live generation can't be re-seeded | Q7 |
| shot list: 6–20s legs, 4s turn cue | `backend/shots.py` |
| nine facts per waypoint | `backend/conditions.py` |

The fuller write-up, with the darkness-dial chart and the Q1–Q7 table, is the
published pipeline page rather than this single frame.
