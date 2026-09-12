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

1. Setup screen submits → routes are fetched and the Orbis session connects at
   the same time.
2. One **long-lived session per route**. Only one concurrent session exists
   (spike Q3), and a re-seed costs ~2.3s against ~11.8s for a fresh connect
   (Q6), so every block change is `reset` + re-seed, never a reconnect.
3. Per block: fetch the seed frame from `/api/imagery/...`, **night-grade it in
   the browser**, `set_image` → `set_audio_prompt` → `set_prompt` → `start`.
4. The previous block's last frame is frozen over the viewport until real frames
   resume, then a hard cut. No crossfade, and a raw daytime photo is never shown.
5. Waypoints inside a block morph the prompt at the next chunk boundary rather
   than cutting. A block holds the screen 8–15s, before conditioning drifts off
   the real geometry (~25s, Q1).

## Project files

- `app/page.tsx` → `components/walk-home.tsx` — the shell and the three screens.
- `components/Viewport.tsx` — video, hold canvas, overlays. Person 2's.
- `components/EvidenceReadout.tsx`, `Minimap.tsx`, `ConditionControls.tsx`,
  `RouteBrief.tsx` — **stubs for Person 1, Phase 3.**
- `hooks/use-orbis-walk.ts` — the autoplay state machine.
- `lib/orbis/` — model config, block grouping, night grade, command sequences,
  signals, the hold gate. Person 2's.
- `lib/contract.ts` — TypeScript mirror of `shared/waypoint.schema.json`.
- `lib/api.ts`, `lib/geo.ts`, `lib/route-progress.ts`, `lib/share.ts`,
  `lib/store.ts` — client, geometry, share links, app state.
- `app/spike/`, `app/api/spike/` — the Phase 1 spike harness. Dev-only; delete
  before anything ships.

`?origin=…&destination=…&datetime=…&route=B` on the root URL prefills setup and
picks the route — that is the share link format, and it is how you reach route B
for testing.

## Model reference

- [Visko Orbis Dynamic API](https://www.reactor.inc/models/visko-orbis-dynamic/api)
  — we are on `-dynamic`, see `docs/reactor-findings.md` Q5.
- [Visko Orbis Stable API](https://www.reactor.inc/models/visko-orbis-stable/api)
