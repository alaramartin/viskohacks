# WALK HOME — frontend

Next.js (App Router) + TypeScript, built on the Orbis hackathon starter. This is
the render layer: Reactor/Orbis session management, the viewport, the app shell
and the autoplay walk. The geo pipeline and the data-display components are the
backend's and Person 1's (see `../PLAN.md`).

## Run locally

```bash
cp .env.example .env.local     # add REACTOR_API_KEY
npm install
npm run dev                    # http://localhost:3000
```

The backend must be running too — `cd ../backend && uvicorn main:app --port 8000`.
`next.config.ts` proxies `/api/routes` and `/api/imagery/*` to it. Set
`BACKEND_ORIGIN` if it is not on `localhost:8000`.

`REACTOR_API_KEY` stays server-side; the browser only ever receives a
short-lived, session-scoped JWT from `/api/token`.

## How a walk runs

**One continuous generation for the whole route** — no cuts, no "next block
preparing". Human decision after the Checkpoint 2 review: it should look like
footage from a camera someone wore along the route.

1. Setup screen submits → the route is fetched and the Orbis session connects at
   the same time.
2. One **long-lived session** for the walk. Only one concurrent session exists
   (spike Q3), so there is never a second one to fall back on — hence
   `disconnect()` in every `finally`.
3. Seeded once, from the first block that has imagery: fetch the frame from
   `/api/imagery/...`, **grade it to the requested light in the browser**,
   `set_image` → `set_audio_prompt` → `set_prompt` → `start`.
4. The viewport is held until real frames arrive; a raw daytime photo is never
   shown.
5. From there the walk is steered by text — the route's **shot list**
   (`backend/shots.py`): one steady prompt per straight leg, one short cue per
   turn, then arrive. `-dynamic` morphs a prompt in at the next ~1.8s chunk (Q5),
   so the prompt changes at shot boundaries without a cut.

Why text and not new imagery: a live generation **cannot be re-seeded**.
`set_image` mid-run — alone, with a prompt change, or between `pause`/`resume` —
is accepted and ignored (Q7). New imagery lands only after `reset`, which costs
~7s and a visible cut.

## Conditions change the walk in place

Moving the time from 7pm to 11pm, or toggling fog or crowd, changes the
*running* video without restarting it. That is the Phase 3 deliverable.

- `ConditionControls` (Person 1) calls the shell's `onChange` with the full next
  settings, as often as it likes.
- The shell debounces, refetches the **same** route for the new clock, and calls
  `walk.applyConditions(route)`. It never stops the walk or returns to Setup.
- Only the light may change, never the geometry. A route that comes back a
  different shape is refused with a message rather than morphed.
- The change reaches the screen at the next Orbis chunk, ~1.8s.
- Ambient light is a dial, not a switch: `condition.ambient.darkness` (0..1)
  scales the whole seed grade in `lib/orbis/nightgrade.ts`, with a floor in
  `lighting.ts` so the dark end stays visible. Without that field the grade
  assumes full night, exactly as it did before.

## Project files

- `app/page.tsx` → `components/walk-home.tsx` — the shell and the three screens.
- `components/Viewport.tsx` — video, hold canvas, overlays. Person 2's.
- `components/EvidenceReadout.tsx`, `Minimap.tsx`, `ConditionControls.tsx`,
  `RouteBrief.tsx` — **stubs for Person 1, Phase 3.**
- `hooks/use-orbis-walk.ts` — the autoplay state machine.
- `lib/orbis/` — model config, block grouping, the shot list, the seed grade
  (`nightgrade.ts`) and what it is allowed to believe (`lighting.ts` for where
  the light is, `ambient.ts` for how much of it there is), command sequences,
  signals, the hold gate. Person 2's.
- `lib/contract.ts` — TypeScript mirror of `shared/waypoint.schema.json`.
- `lib/api.ts`, `lib/geo.ts`, `lib/route-progress.ts`, `lib/share.ts`,
  `lib/store.ts` — client, geometry, share links, app state.
- `app/spike/`, `app/api/spike/` — the Phase 1 spike harness. Dev-only; delete
  before anything ships.

`?origin=…&destination=…&datetime=…&fog=true&crowd=true` on the root URL prefills
setup — that is the share link format. There is no `route` parameter: comparison
was dropped before Checkpoint 3 and there is one route.

## Model reference

- [Visko Orbis Dynamic API](https://www.reactor.inc/models/visko-orbis-dynamic/api)
  — we are on `-dynamic`, see `docs/reactor-findings.md` Q5.
- [Visko Orbis Stable API](https://www.reactor.inc/models/visko-orbis-stable/api)
