# Slide diagrams

How a walk gets made, sized for a slide: **2560×1440 (16:9)**. Everything here
comes in a light and a dark colourway, and both carry their own background, so
they don't depend on the deck's.

## The flowchart — use this one

- `walk-home-flow-light.png`
- `walk-home-flow-dark.png`

Five boxes and a loop. Minimal by design: the only illustration is the
day → night pair above the step it explains, and amber is spent on one thing —
the feedback loop, and the box it deliberately routes around.

The loop is the part worth talking to. It leaves the walk, re-costs the route,
and returns straight to the running generation — **skipping the seed step**,
because a live generation cannot be re-seeded. The line that bypasses the box is
the architecture.

Source: `flow.html`.

## The detailed version

- `walk-home-light.png`
- `walk-home-dark.png`

The same five stages, but with the data sources, command sequence, a fact strip
and the measured constraint spelled out. Better as a leave-behind or a backup
slide than as something to talk over.

Source: `diagram.html`.

## Regenerating

Both sources render at exactly 1600×900 and are screenshotted at 1.6× for the
2560×1440 export:

```bash
CH="/c/Program Files/Google/Chrome/Application/chrome.exe"   # or your Chrome path
for mode in light dark; do
  "$CH" --headless=new --disable-gpu --window-size=1600,900 \
        --force-device-scale-factor=1.6 --hide-scrollbars --virtual-time-budget=9000 \
        --screenshot="walk-home-flow-$mode.png" "file:///$PWD/flow.html?$mode"
done
```

Swap `flow.html` for `diagram.html` (and the output name) for the detailed one.

Two things that will bite otherwise: the `?light` / `?dark` query picks the
colourway, so pass a real `file://` URL — Chrome treats a bare `flow.html?dark`
as a filename and 404s. And the fonts come from Google Fonts, so the first
render needs a network connection.

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
