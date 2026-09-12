# WALK HOME — PLAN.md

Live Models Hackathon · Visko / Reactor / Nebius · San Francisco (https://luma.com/gh4256ju)

---

## READ THIS FIRST

You are a coding agent (Claude Code / Cursor). Your human will tell you **"I'm
Person 1"** or **"I'm Person 2"**. Jump to that person's section and do only
that section, top to bottom. Everything you need is inside your section — you
do not need to read the other person's section.

**THE GOLDEN RULE — stop at every 🛑 CHECKPOINT.** Do not keep coding past a
checkpoint. Instead, print the checkpoint's instructions to your human (who to
merge with, exact commands, expected output), then wait for the human to say it
passed before starting the next phase. Checkpoints are how two people stay in
sync. Blowing past one breaks integration.

When the human confirms the work up to a checkpoint is sound, **record it in
this PLAN.md** — tick the boxes, add your notes, and update any part of the
plan that changed. This is so the human can `/clear` the chat and resume from
where they left off.

**Commit after every completed task**, not just at checkpoints. One task, one
commit, conventional message (`feat(geo): compute two candidate routes`).

**Task bookkeeping.** Each task is a `- [ ]` checkbox. When you finish it,
change it to `- [x]` and write a one-line note underneath saying how it went —
`done`, or `changed X because Y`, or `blocked on Z`. Be honest about
deviations; the other person reads this file.

**Branches.** Person 1 works on `person1`, Person 2 works on `person2`. Merge
both into `main` at each checkpoint. Never commit directly to `main` outside a
checkpoint.

**Hardcoding.** Avoid hardcoding values unless absolutely necessarily (i.e. something is required of another person and for the meantime, you use hardcoded values). If there is anything required of the human (like API keys, links, etc) tell them. If anything is hardcoded/temporary/placeholder, make that clear to the human and tell us next steps for how to get the real values.

---

## WHAT WE ARE BUILDING

Input two locations (origin, destination) plus a date and time. The system
computes **two candidate walking routes** and generates a continuous
nighttime walk-through of each — grounded in real street-level imagery of
those exact blocks, with conditions derived from open environmental data.
Output is a shareable route brief.

**It is a familiarization tool.** You see the underpass before you're standing
in it.

**It is NOT** a safety score, NOT crime prediction, NOT a verdict. There is no
number, no color-coded route, no green/amber/red anywhere in the UI. No crime
data enters the pipeline. All rendered conditions are labeled as modeled
estimates.

Scope is **San Francisco only**.

### Non-negotiable product rules

Do not violate these even if they seem to make something easier:

1. **Never display a raw daytime photo as the answer.** A Street View JPEG
   flashing before the night render contradicts the entire premise. When a
   segment isn't ready, hold the current live render.
2. **No crossfades.** Cuts stay hard. This was decided deliberately.
3. **No safety score.** Facts only; the user does the synthesis.
4. **Segments without imagery render as visibly unavailable.** Never invented.
5. **Autoplay is the primary deliverable.** Arrow-key navigation is a stretch
   goal (Phase 4). Do not start it before Phase 4.

---

## SHARED CONTRACT

Both people build against this. **Do not change it without telling the other
person.** It lives at `shared/waypoint.schema.json` and is committed by
Person 1 in Phase 1.

A route is an ordered list of Waypoints.

```json
{
    "route_id": "A",
    "waypoints": [
        {
            "index": 0,
            "lat": 37.7955,
            "lng": -122.3937,
            "heading": 214.5,
            "block_id": "w12345",
            "image_url": "/api/imagery/w12345/214",
            "image_available": true,
            "condition": {
                "video_prompt": "narrow two-lane street at night, no streetlights, wet asphalt, no pedestrians, parked cars along the curb",
                "audio_prompt": "quiet empty street at night, distant traffic, faint wind",
                "facts": [
                    { "label": "Dark since", "value": "7:42pm" },
                    { "label": "Streetlights", "value": "None tagged" },
                    {
                        "label": "Reported outages",
                        "value": "2 (311, Aug 2026)"
                    },
                    { "label": "Open businesses", "value": "0 at 11pm" },
                    { "label": "Sidewalk", "value": "Both sides" },
                    { "label": "Road", "value": "Two lanes, no median" }
                ]
            }
        }
    ]
}
```

Field notes:

- `block_id` — stable id for the street segment between two intersections.
  **Consecutive waypoints sharing a `block_id` belong to one Orbis session.**
  This is the key to smoothness: sessions are seeded per _block_, not per node.
- `image_available: false` → `image_url` is `null` and the renderer must show
  the unavailable state.
- `condition.facts` is rendered verbatim in the evidence readout. Person 1
  owns the wording; Person 2 does not reinterpret it.
- `video_prompt` and `audio_prompt` are passed straight to Orbis.

### API contract

Person 1's backend serves, Person 2's frontend consumes:

```
GET /api/routes?origin=<str>&destination=<str>&datetime=<ISO8601>
→ 200 { "routes": [ {route_id:"A", waypoints:[...]}, {route_id:"B", waypoints:[...]} ] }

GET /api/imagery/<block_id>/<heading>
→ 200 image/jpeg
→ 404 if no coverage
```

---

## STACK

- `backend/` — Python 3.11, FastAPI, `osmnx`, `astral`, `httpx`
- `frontend/` — **Next.js (App Router) + React + TypeScript**,
  `@reactor-team/js-sdk`, `zustand`. This is the
  [orbis-hackathon-starter](https://github.com/Visko-Platform/orbis-hackathon-starter),
  **not** a fresh Vite app. Runs on port 3000 (`npm run dev`).
- `shared/` — the schema + a fixture file
- Repo root has `.env.example` for backend keys; real keys go in `.env`
  (gitignored). The frontend keeps the starter's `frontend/.env.example` →
  `frontend/.env.local` (`REACTOR_API_KEY`, `GEMINI_API_KEY`).

https://www.reactor.inc/models/visko-orbis-stable/api is the API reference

### Starting from the starter repo

The repo was created from the Orbis starter with its files at the **repo root**
(`app/`, `components/`, `hooks/`, `lib/`, `package.json`, …) plus this PLAN.md.
Person 1's first Phase 1 task moves it into `frontend/`. What the starter
already gives us:

- `app/api/token/route.ts` — server-side Reactor JWT minting (Person 2's token
  endpoint task is mostly done). Note it requests
  `constraints: { max_sessions: 1 }` — relevant to Q3.
- `hooks/use-orbis-session.ts` — a working command sequence:
  `uploadFile` → `set_image` (wait for `image_accepted` + `state.has_image`)
  → `set_resolution` → `set_prompt` (wait for `conditions_ready`) → `start`.
  **The seed-image command is `set_image`, not `set_conditioning`.**
  `generation_started.image_conditioned` reports whether the image was used.
- `components/orbis-player.tsx`, `components/orbis-controls.tsx`,
  `lib/orbis.ts` — player, controls, model config and message helpers.
- Nano Banana (Gemini image edit) example — not part of our product; leave it
  or delete it, but don't build on it.

Frontend ↔ backend: Next.js already owns `/api/*` on port 3000 for its own
routes (token). The FastAPI backend serves `/api/routes` and `/api/imagery` on
port 8000. The frontend reaches it either through a Next `rewrites()` entry in
`next.config.ts` proxying those two paths to `http://localhost:8000`, or via a
`NEXT_PUBLIC_API_BASE` env var. Backend CORS must allow `http://localhost:3000`.

---

# PERSON 1 — GEO + DATA LAYER

You own: the street graph, routing, the condition model, imagery fetching,
and the three data-display components (evidence readout, minimap, route
brief). You do not touch Orbis or the viewport.

## Phase 1 — Repo, contract, fixture

Person 2 is blocked on your fixture. Do this fast and commit it early.

- [x] Restructure the repo. `main` already exists on GitHub with the starter
      at the root. `git mv` the starter (`app/`, `components/`, `hooks/`,
      `lib/`, `dog.png`, `next.config.ts`, `next-env.d.ts`, `package.json`,
      `package-lock.json`, `tsconfig.json`, `.env.example`, `README.md`) into
      `frontend/`. Create `backend/` and `shared/`, a root `.env.example`,
      and extend `.gitignore` (`.env`, Python caches, `.venv/`,
      `backend/data/imagery/`). Confirm `cd frontend && npm install && npm run dev`
      still works. Push to `main` right away (Person 2 builds inside
      `frontend/`), then branch `person1`.
  - done. `npm run typecheck` clean, `next dev` serves 200 from `frontend/`.
    Next 16 auto-generated `frontend/AGENTS.md`/`CLAUDE.md` (Next 16 API notes) —
    committed, worth reading. Root `.env.example` has `MAPILLARY_ACCESS_TOKEN`,
    `GOOGLE_MAPS_API_KEY`, `CORS_ORIGINS` (keys only needed in Phase 2).
    Backend venv is Python 3.11 via `uv` (see `backend/README.md`).
- [x] Write `shared/waypoint.schema.json` exactly as specified in SHARED
      CONTRACT above. Commit and push to `main` immediately — Person 2 needs
      it.
  - done. JSON Schema 2020-12 of the full `/api/routes` response. Enforces
    `image_url: null` iff `image_available: false`. No fields added.
- [x] Write `shared/fixture-routes.json`: two hardcoded routes, ~12 waypoints
      each, spanning 4–5 distinct `block_id`s, at least one waypoint with
      `image_available: false`. Use real SF coordinates in the Tenderloin or
      SoMa. Realistic `video_prompt` / `audio_prompt` / `facts`. Commit and
      push to `main`.
  - done, with caveats. Both routes go Eddy & Jones → Golden Gate & Hyde (Tenderloin),
    12 waypoints, 4 blocks each. A: Eddy west, then Hyde south. B: Jones south,
    then Golden Gate west. Block `w8918502` (B, idx 3–4) has no imagery.
    PLACEHOLDER: coordinates are approximated on the rotated street grid (not
    snapped to OSM), `block_id`s are made up, and facts are invented but plausible.
    Waypoints on the unavailable block still carry a generic non-empty prompt.
    Phase 2 swaps all of this for real data.
- [x] Scaffold FastAPI in `backend/` with both endpoints from the API
      contract, returning the fixture verbatim. `uvicorn` on port 8000, CORS
      open to localhost. `GET /api/routes` should work end-to-end against
      hardcoded data before you touch OSM.
  - done. `backend/main.py`. `/api/routes` validates `datetime` (422 if it isn't ISO)
    but otherwise ignores query params. `/api/imagery` returns a labeled grey
    PLACEHOLDER JPEG for covered blocks and 404 for others. CORS allows any
    localhost/127.0.0.1 port plus `CORS_ORIGINS`. `pytest` checks the response
    against the schema (4 tests pass).

### 🛑 CHECKPOINT 1 — contract handshake

Print this to your human and stop:

> **Person 1 ready for Checkpoint 1.**
>
> I've pushed `shared/waypoint.schema.json`, `shared/fixture-routes.json`, and
> a FastAPI backend serving the fixture to `main`.
>
> **Merge with Person 2.** Person 2 should have finished the Reactor spike and
> answered the five venue questions in Phase 1 of their section.
>
> Run:
>
> ```
> cd backend && uvicorn main:app --reload
> curl "http://localhost:8000/api/routes?origin=Ferry+Building&destination=Civic+Center&datetime=2026-09-12T23:00:00"
> ```
>
> Expected: JSON with two routes, ~12 waypoints each, matching the schema.
>
> **Ask Person 2 for their spike answers before I continue.** Specifically:
> does Orbis actually condition on a Street View seed image via `set_image`? If NO, the imagery
> pipeline below changes scope and we must re-plan together.
>
> Waiting for your confirmation that this passed.

## Phase 2 — Real geo pipeline

Only start after Checkpoint 1 passes. Replace the fixture with real data,
keeping the response shape byte-identical.

- [ ] **Cache the SF walking graph.** `osmnx.graph_from_place("San Francisco,
California", network_type="walk")`, save to `backend/data/sf_walk.graphml`.
      Load from disk on startup — never hit Overpass at request time. This
      download is slow; do it first and commit the cache file if under 100MB
      (otherwise gitignore it and document the command).
- [ ] **Geocode + two routes.** Geocode origin/destination strings to nodes.
      Compute route A as shortest path by length. Compute route B as a
      genuinely different path — penalize edges used by A and re-run, so the
      two routes diverge meaningfully rather than differing by one block.
- [ ] **Waypoint sampling.** Walk each route's edges and emit waypoints every
      ~25m. `heading` is the bearing to the next waypoint. `block_id` is the
      OSM way id — consecutive waypoints on the same way share it.
- [ ] **Sun position.** Use `astral` to compute civil twilight for the
      requested date at SF's lat/lng. Derive whether it's dark, and the "Dark
      since HH:MMpm" fact. Exact, offline, no API.
- [ ] **OSM edge attributes.** Pull `lit`, `highway`, `lanes`, `sidewalk`,
      `width` from the cached graph per edge. Map to facts.
- [ ] **POI density as footfall proxy.** Count OSM POIs within ~50m of each
      waypoint. Filter by `opening_hours` where present to get "open at this
      hour". Fall back to total count when hours are missing — and say so in
      the fact wording (`"3 nearby (hours unknown)"`).
- [ ] **DataSF enrichment.** Download the streetlight inventory and 311
      streetlight-outage extracts from DataSF to `backend/data/`. Spatially
      join to edges. Produce the outage fact. **Cache to disk — do not call
      their API at request time.**
- [ ] **Prompt composition.** Build `video_prompt` and `audio_prompt` from the
      composed condition. Keep them concrete and physical: lighting, road
      width, parked cars, pedestrian presence, weather, wetness. Do **not**
      write anything about threat, danger, crime, or people behaving
      menacingly — that is out of scope and will trip content filters.
      Include weather from Open-Meteo for the requested date/time.
- [ ] **Imagery.** Implement `GET /api/imagery/<block_id>/<heading>`.
      Primary source: **Mapillary** (free, CC BY-SA, no ToS problem) if
      coverage on the target neighborhood is adequate. Fallback: Google Street
      View Static API (10k/mo free, needs a Cloud billing account + card). Use the Street View
      **Metadata** endpoint (free, unlimited) to check coverage and set
      `image_available`. Cache fetched images to `backend/data/imagery/`.
- [ ] **Day → night conversion of every seed frame.** NEW, added after the
      Person 2 spike (Q1) — **agree ownership at Checkpoint 1 before building
      it.** Orbis takes its lighting from the seed image and ignores a night
      prompt: a daytime frame produces sustained daytime video of the right
      block, which breaks non-negotiable rule #1. The endpoint must therefore
      serve *night* frames, so the frontend never holds a daytime pixel.
      Reference implementation to fold in: `docs/spike/nightgrade.py` (numpy +
      Pillow, offline, no key). Two things it taught us: target a graded mean
      luma of **~0.06** (at ~0.04 Orbis loses the block entirely), and the sky
      mask must catch **overcast** skies (bright + desaturated), not only blue
      ones. Also crop panoramas to 16:9 at the waypoint heading **before**
      grading — Orbis wants 854×480 (stable) / 640×368 (dynamic) and resizes
      non-16:9 without cropping, which distorts.

### 🛑 CHECKPOINT 2 — end-to-end integration

Print this to your human and stop:

> **Person 1 ready for Checkpoint 2.**
>
> The backend now serves real routes from the cached SF graph, with real
> condition data and real imagery. Response shape is unchanged from the
> fixture.
>
> **Merge with Person 2 into `main`.** Person 2 should have the app shell,
> Orbis session management, and autoplay working against the fixture.
>
> Run:
>
> ```
> cd backend && uvicorn main:app --reload
> cd frontend && npm run dev
> ```
>
> Then in the browser: enter two SF addresses and 11:00pm, submit.
>
> Expected: both routes compute, the autoplay flythrough runs on route A with
> real imagery seeding each block, and the evidence readout shows real facts
> per segment.
>
> Check specifically: do consecutive waypoints on the same `block_id` render
> as one continuous session rather than cutting every 25m?
>
> Waiting for your confirmation that this passed.

## Phase 3 — Data display components

Person 2's shell exposes empty component slots in `frontend/components/`. Fill
them. Do not touch `Viewport.tsx`, anything under `frontend/lib/orbis/`, or
`frontend/hooks/use-orbis-*`. These are client components (`"use client"`).

- [ ] **`EvidenceReadout.tsx`** — horizontal strip beneath the viewport.
      Renders `condition.facts` for the current waypoint verbatim, in two
      columns, with "Modeled estimate" as a persistent label. Updates on every
      waypoint change.
- [ ] **Fact-change emphasis.** When moving to a waypoint whose facts differ
      from the previous one, briefly emphasize the changed fields. Motion in
      the periphery earns attention only when there's something to see. Keep
      it subtle — no flashing.
- [ ] **`Minimap.tsx`** — upper right. Draw both routes, the active route
      highlighted, current position marked. Leaflet or a plain SVG projection
      of the waypoint coordinates; SVG is fine and has fewer dependencies.
- [ ] **`ConditionControls.tsx`** — below the minimap. Date and time pickers,
      plus fog and crowd toggles. Changing any of these refetches routes and
      **applies to both routes at once** (shared condition clock) so the
      comparison stays controlled.
- [ ] **`RouteBrief.tsx`** — the shareable artifact. Both routes, conditions
      at the chosen time, which was picked, and a share link. Encode
      origin/destination/datetime/chosen-route in the URL query string —
      no database, the link just regenerates the preview.

### 🛑 CHECKPOINT 3 — full demo runthrough

Print this to your human and stop:

> **Person 1 ready for Checkpoint 3.**
>
> All data-display components are filled: evidence readout, minimap, condition
> controls, route brief.
>
> **Merge with Person 2 into `main`** and do a full demo runthrough together:
> setup screen → autoplay walk on route A → compare both routes → generate and
> open a share link.
>
> Time the whole thing. It needs to land in under two minutes.
>
> Waiting for your confirmation that this passed.

## Phase 4 — Stretch and demo prep

Only after Checkpoint 3. Person 2 is building arrow-key navigation; stay out
of their files.

- [ ] Write the demo script. Autoplay first, then hand a judge the arrow keys
      if Person 2 landed them. Autoplay will look better — lead with it.
- [ ] Pick and hard-verify two demo routes by hand. Make sure both have good
      imagery coverage and visibly different conditions.
- [ ] If time: additional DataSF layers (tree canopy for sightline occlusion,
      sidewalk width).

---

# PERSON 2 — RENDER LAYER

You own: the Reactor/Orbis integration, session management, the viewport, the
app shell, and the compare view. You do not touch the backend or the geo
pipeline. You develop against `shared/fixture-routes.json` until Checkpoint 2.

## Phase 1 — Reactor spike (do this before anything else)

Five unknowns determine the whole architecture. Answer them in a throwaway
script before writing any real code. Write your findings into
`docs/reactor-findings.md` and commit it.

Known from the docs:

- Mint a session-scoped JWT server-side: `POST https://api.reactor.inc/tokens`
- Connect from the browser with `@reactor-team/js-sdk`,
  `new Reactor({ modelName: 'reactor/visko-orbis-stable' })`
- Commands available: `set_prompt`, `start`, `set_resolution` (1080p/2k/4k),
  `set_seed`, `set_audio_enabled`, `set_audio_prompt`, `set_image`, `pause`,
  `resume`, `reset`
- The starter (`frontend/hooks/use-orbis-session.ts`) already runs
  `uploadFile` → `set_image` → `set_prompt` → `start` end to end, and the
  token route (`frontend/app/api/token/route.ts`) already mints JWTs. Spike
  on top of it rather than writing a separate throwaway script.
- `set_audio_prompt` takes a sound description, or `""` for picture-driven audio
- Chunk cadence ≈1.8s — prompt changes land at the next chunk boundary
- Orbis has **no camera controls**; all movement comes from re-seeding

Tasks:

- [x] **Q1 (critical): does Orbis condition meaningfully on a Street View
      seed image via `set_image`?** The starter shows Orbis accepts a start
      image (`image_accepted`, `generation_started.image_conditioned: true`).
      What's still unknown is whether a *daytime Street View JPEG* plus a night
      prompt comes out recognizably as *that block* at night. Test it with a
      real SF Street View / Mapillary frame. Everything rests on this. If NO,
      stop and tell your human immediately — the product degrades to a generic
      night street and the team must re-plan.
  - **YES on conditioning, but with a required new step.** Orbis doesn't just
    start from the seed, it *continues* it — mural, tree line, parked cars and
    street geometry all persist. **But a daytime seed produces daytime video
    and the night prompt loses.** Fix: night-grade the seed before `set_image`
    (`docs/spike/nightgrade.py`, offline, no API key). Then we get night *and*
    the real block. Two knobs: graded seed mean luma ~0.06 (at 0.04 the block
    is lost), and the sky mask must catch overcast, not just blue. Conditioning
    drifts off the real geometry after ~25s, so a block should hold ~8–15s.
    Full write-up + frames: `docs/reactor-findings.md`.
- [x] **Q2: which lane serves Orbis — WebRTC live session, or REST
      submit/poll?** Determines whether you hold sessions or queue jobs.
  - **WebRTC live session.** No REST inference lane exists; the SDK is
    browser-only. We hold sessions.
- [x] **Q3: how many concurrent sessions do the credits and API allow?**
      Prefetch (Phase 4) assumes 3–4 in flight. If it's 1, prefetch is dead.
      The starter's token route hardcodes `max_sessions: 1` — try raising it
      and see whether Reactor accepts it.
  - **1 per model.** Raising the token's `max_sessions` is accepted and then
    ignored — the account's `concurrent_sessions_per_model` quota refuses the
    second connect with 429. **Prefetch is dead; compare mode can't be two
    live sessions.** Also: no REST endpoint exists to list or kill a session,
    so a crashed client blocks the only slot — always `disconnect()` in a
    `finally`, and mint the JWT **once** per session (a resolver that re-mints
    per request 403s). Ask Reactor staff to raise the quota.
- [x] **Q4: session initialization latency**, as distinct from the ~1.8s chunk
      cadence. Time it. Sets the budget for everything.
  - **~12–16s cold to first visible frame** (~7–11s connect, then ~5–6s from
    `generation_started` — the first chunk emits no frames). **Re-seeding
    inside a live session is only ~2.3s.** Budget from `generation_started`,
    never from `start`.
- [x] **Q5: is `visko-orbis-dynamic` better for this than `-stable`?** Try one
      segment on each and note the difference.
  - **`-dynamic`.** Stable's time-to-first-frame varied 3.1s vs 25.0s across
    two identical runs — unacceptable on a two-minute demo clock. Dynamic is
    consistent at ~5–6s and adds mid-run prompt morphing at chunk boundaries,
    which lets conditions change at waypoint boundaries inside a block without
    a cut. `frontend/lib/orbis.ts` `ORBIS_MODEL_NAME` still needs switching.
- [x] **Q6 (not in the original plan, but it decides the architecture): can one
      session be re-seeded per block?** With one concurrent session, autoplay
      only works if a block change isn't a new connection.
  - **Yes.** `reset` → `set_image` → `set_prompt` → `start` inside the same
    live session takes **~2.3s** vs ~11.8s for a cold connect, and the re-seed
    genuinely takes (verified by re-seeding block A after two resets and
    getting block A back). `set_seed` and `set_resolution` survive `reset`, so
    the route-wide pinned seed holds. **So: one long-lived session per route,
    `reset`+re-seed at each block boundary — not one session per block.**

### 🛑 CHECKPOINT 1 — contract handshake

Print this to your human and stop:

> **Person 2 ready for Checkpoint 1.**
>
> Reactor spike done. Findings are in `docs/reactor-findings.md`:
>
> - Street View seed image via `set_image` works: [YES / NO]
> - Lane: [WebRTC / REST]
> - Concurrent sessions: [N]
> - Init latency: [Xs]
> - Better model: [stable / dynamic]
>
> **Merge with Person 1.** Person 1 should have pushed
> `shared/waypoint.schema.json`, `shared/fixture-routes.json`, and a FastAPI
> backend serving the fixture.
>
> Run:
>
> ```
> cd backend && uvicorn main:app --reload
> curl "http://localhost:8000/api/routes?origin=Ferry+Building&destination=Civic+Center&datetime=2026-09-12T23:00:00"
> ```
>
> Expected: JSON with two routes matching the schema.
>
> **Tell Person 1 the answer to Q1 before either of us continues.** If it's
> NO, we re-plan together.
>
> Waiting for your confirmation that this passed.

## Phase 2 — Shell, sessions, autoplay

Only start after Checkpoint 1. Build entirely against the fixture; do not
depend on Person 1's real pipeline.

- [ ] **App shell.** Next.js (App Router) + TS in `frontend/`, built on
      the starter (replace `app/page.tsx` / `components/orbis-demo.tsx`
      rather than adding a parallel app). Three screens:
      **Setup** (origin, destination, date, time — nothing else),
      **Walk**, **Brief**. Layout for Walk: viewport upper left; a slot for
      `EvidenceReadout` as a horizontal strip beneath it; slots for `Minimap`
      and `ConditionControls` stacked in the right column; compare and share
      buttons below those. **No top bar** — the right column is the only place
      the world changes, the left column the only place you see it.
- [ ] **Create empty stub components** for Person 1 to fill:
      `EvidenceReadout.tsx`, `Minimap.tsx`, `ConditionControls.tsx`,
      `RouteBrief.tsx`. Each takes typed props from the shared contract and
      renders a placeholder. Commit these early so Person 1 isn't blocked at
      Phase 3.
- [x] **Token endpoint.** Already exists at `frontend/app/api/token/route.ts`
      from the starter. Adjust `max_sessions` per the Q3 finding. Never ship
      the Reactor API key to the browser.
  - done in Phase 1. Takes optional `{model, maxSessions}`; defaults to
    `max_sessions: 1` per Q3. Key stays server-side.
- [ ] **Session manager** in `frontend/lib/orbis/` (hooks may live in
      `frontend/hooks/`). Generalize the starter's `use-orbis-session.ts`.
      Group the waypoint list by `block_id`. **ONE LONG-LIVED SESSION PER
      ROUTE** — revised from "one session per block" after Q3/Q6: only one
      concurrent session exists, and `reset`+re-seed costs ~2.3s against
      ~11.8s for a fresh connect. So: connect once, `set_seed`,
      `set_resolution`, `set_audio_prompt`; then per block `reset` →
      fetch seed from `/api/imagery/...` → `uploadFile` → `set_image` →
      `set_prompt` → `start`. Wait on the same readiness signals the starter
      uses (`image_accepted`, `state.has_image`, `conditions_ready`), and wait
      on `generation_reset` before re-seeding. **Mint the JWT once and pass
      the string** — a resolver that re-mints per request 403s. Always
      `disconnect()` in a `finally`: a leaked session blocks the only slot.
- [ ] **Pin the seed** to one value for the whole route via `set_seed`, so
      weather and lighting realization don't diverge wildly between blocks.
      Confirmed safe: `set_seed` and `set_resolution` survive `reset`, so set
      them once at connect and they hold for every block.
- [ ] **Hold-until-ready.** Never display an unready segment. Hold the
      current live render and switch when the next block is ready. **Never cut
      to a raw Street View photo** — a daytime JPEG before a night render
      contradicts the premise. **No crossfade** — hard cut when the next block
      arrives. Measured gaps to cover: **~12–16s at route start**, **~7–8s at
      each block boundary** (~2.3s of commands + ~5–6s to first frame).
- [ ] **Keep block dwell to ~8–15s.** Conditioning drifts off the real
      geometry by ~25s (Q1), after which we are showing an invented street.
      Advance to the next block before that, even if waypoints remain.
- [ ] **Unavailable segments.** When `image_available` is false, render an
      explicit unavailable state. Do not generate a street from text alone to
      fill the gap.
- [ ] **Absorb first-load cost into the Setup screen.** Warm the first block's
      session while the user is still on setup, so the walk starts
      immediately. One deliberate wait where a wait is expected.
- [ ] **Autoplay flythrough.** Walk the route end to end automatically,
      advancing block by block. **This is the primary deliverable.** It must
      work standalone with no interaction.
- [ ] **Audio on by default, mute toggle only.** Pass `audio_prompt` through.
      No other audio UI.
- [ ] **Viewport overlays.** Route direction arrow at the correct screen
      bearing with distance to next turn. One persistent condition line in a
      corner (the full readout is Person 1's strip below).

### 🛑 CHECKPOINT 2 — end-to-end integration

Print this to your human and stop:

> **Person 2 ready for Checkpoint 2.**
>
> Shell, token minting, block-level session management, hold-until-ready, and
> the autoplay flythrough all work against the fixture.
>
> **Merge with Person 1 into `main`.** Person 1 should have the real geo
> pipeline serving real routes, conditions, and imagery in the same shape as
> the fixture.
>
> Run:
>
> ```
> cd backend && uvicorn main:app --reload
> cd frontend && npm run dev
> ```
>
> Then in the browser: enter two SF addresses and 11:00pm, submit.
>
> Expected: both routes compute, autoplay runs on route A with real imagery
> seeding each block, no daytime frames ever visible, hard cuts only at block
> boundaries.
>
> Check specifically: does a block with `image_available: false` show the
> unavailable state rather than an invented street?
>
> Waiting for your confirmation that this passed.

## Phase 3 — Compare view

- [ ] **Compare mode.** Two viewports side by side, route A and route B, under
      one shared condition clock — a condition change applies to both at once
      so it's a controlled counterfactual, not two loose videos.
- [ ] **Compare is a mode, not the default.** Entered deliberately via a
      toggle. The single-route walk stays the default because side-by-side
      halves the viewport.
- [ ] **Concurrency check.** Compare mode needs two live sessions. If Q3 said
      one session at a time, run the two routes sequentially and stitch, or
      pre-generate both before entering compare.
  - **Q3 said 1.** Two live viewports are impossible. Plan for pre-generating
    route B (or both) via `requestClip()`/`requestRecording()` and playing the
    recordings side by side, or sequence the two routes on the one session.

### 🛑 CHECKPOINT 3 — full demo runthrough

Print this to your human and stop:

> **Person 2 ready for Checkpoint 3.**
>
> Compare view works with a shared condition clock.
>
> **Merge with Person 1 into `main`** and do a full demo runthrough together:
> setup screen → autoplay walk on route A → compare both routes → generate and
> open a share link.
>
> Time the whole thing. It needs to land in under two minutes.
>
> Waiting for your confirmation that this passed.

## Phase 4 — Arrow-key navigation (STRETCH — only after Checkpoint 3)

Do not start this before Checkpoint 3 passes. Autoplay is the deliverable;
this is upside.

- [ ] **Wide-FOV render + crop.** Generate at a wider field of view than you
      display. Left/right rotate the crop window **within a render you already
      have**, so turning is a real pan through one continuous world instead of
      a cut to a newly-dreamed one. Biggest smoothness win available and it
      costs almost nothing.
- [ ] **Arrow-key movement.** Up advances along an edge in the facing
      direction. Left/right rotate heading at the current node (crop-pan, no
      new session). Movement is only legal along an edge that exists in the
      graph.
- [ ] **Off-route is a state, never an error.** Route line dims, return arrow
      stays live, show node count back to the path. Never block the input,
      never auto-correct. Wandering is the point — what's one street over is
      exactly what someone wants to know.
- [ ] **Prefetch.** One step of lookahead, priority order: route-ahead first,
      then rotations, then off-route edges. Branching factor is small (one
      forward edge, two or three headings, and you never need the direction
      you came from). Only one step — two moves out is a dozen states and
      you'll evict faster than you generate. **Requires 3–4 concurrent
      sessions (Q3). If Q3 said 1, skip this task.**
  - **SKIPPED. Q3 = 1 concurrent session.** Revisit only if Reactor raises the
    account's `concurrent_sessions_per_model` quota.
- [ ] If time: voice input for **conditions only** ("heavier fog", "more foot
      traffic"). Never for movement — spatial input stays on the arrow keys.

---

**Prefer Mapillary** if SF coverage on the demo neighborhood is adequate: free,
CC BY-SA, no restriction on this use. If coverage is too thin, use Google and
state the caveat plainly rather than hiding it. Have the provenance answer
ready — a judge may ask.

---

# PREP CHECKLIST (before the event)

- [ ] Pull and cache the SF walking graph with `osmnx` — this is slow
- [x] Check Mapillary coverage on the target neighborhood
  - Token works (root `.env.local` or `.env`; backend loads both). Tenderloin
    fixture waypoints: 20 of 24 have imagery within ~20m. Capture dates are
    2018–2025, mostly 2021–2025. Most images are **360° panoramas**, so Phase 2
    must crop the pano to the waypoint heading before seeding Orbis. The
    ordinary sample photo (Aug 2025) is sharp, daytime, road-level. Gaps: fixture
    coords are approximate, so re-check against OSM-snapped waypoints in Phase 2.
    Google key not needed unless real routes show thin coverage.
- [ ] Set up a Google Cloud billing account + Maps API key as fallback
- [ ] Download DataSF streetlight + 311 extracts
- [ ] Both people read SHARED CONTRACT and agree on it

All data prep is offline-cacheable. The only live dependency at the event is
Reactor.

---

# FINAL SUBMISSION — push to the starter repo

**Do this last, only after both people confirm everything is done** (all
checkpoints passed, Phase 4 finished or abandoned, both branches merged into
`main`). Either person can run it. Before running it, ask the human for the
final product and team names.

The hackathon wants our work as a branch named `ProductName-TeamName` on
https://github.com/Visko-Platform/orbis-hackathon-starter. We built in our own
repo (`alaramartin/viskohacks`) instead. Our first commit `2a7599d` has the same
files as their `main` at `f84c47e`, plus `PLAN.md`. So we rebuild that commit on
top of their `main` and replay our history onto it:

```sh
git checkout main && git pull
git remote add visko https://github.com/Visko-Platform/orbis-hackathon-starter.git
git fetch visko main

# Same files as our import commit, but its parent is their main
BASE=$(git commit-tree 2a7599d^{tree} -p visko/main -m "chore: add PLAN.md")

# Replay every commit after the import onto it (keeps messages, authors, dates)
git rebase --onto $BASE 2a7599d main

git push visko main:refs/heads/ProductName-TeamName
```

Notes:

- The rebase rewrites commit hashes. Do it once, at the very end, so nobody
  has local work on top of the old hashes. Don't force-push the rewritten
  `main` back to `origin` unless both people agree.
- If our history contains merge commits, add `--rebase-merges` to the rebase.
  If the rebase fails, a fallback is to push unchanged:
  `git push visko main:refs/heads/ProductName-TeamName`. GitHub will then show
  the branch as having no history in common with their `main`.
- **Check push access early, not at the deadline.** Test with
  `git push visko main:refs/heads/access-test` then
  `git push visko --delete access-test`. If access is denied, ask the
  organizers, or fork the repo and push the branch to the fork.

---

# CHECKPOINT LOG

Update this as you go so the human can `/clear` and resume.

- [ ] Checkpoint 1 — contract handshake
  - Person 1: done (schema, fixture, FastAPI serving the fixture, on `main`).
  - Person 2: done (Reactor spike Q1–Q5 plus Q6, `docs/reactor-findings.md`,
    on `main`). Headline: image conditioning works well, but **seeds must be
    night-graded first** or Orbis renders daytime; and **only 1 concurrent
    session** exists, which kills prefetch and live compare.
  - Awaiting the joint runthrough + the three open questions in
    `docs/reactor-findings.md`.
- [ ] Checkpoint 2 — end-to-end integration
- [ ] Checkpoint 3 — full demo runthrough
- [ ] Final submission — branch pushed to Visko-Platform/orbis-hackathon-starter
