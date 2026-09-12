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
computes **one walking route** and generates a continuous nighttime
walk-through of it, starting from real street-level imagery of those exact
blocks, with conditions derived from open environmental data. Conditions
(time, fog, crowd) can be changed live while the walk plays. Output is a
shareable route brief.

**Decided before Checkpoint 3 (both people): no route comparison.** The
original plan computed two candidate routes and compared them side by side.
Dropped: too complicated for the timeframe, and the account allows only one
concurrent Orbis session, so two live walks can't exist. The UI takes a start
and a destination and walks that one route. Everything below about "route B",
"both routes" or "compare" is superseded.

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
2. **No cuts, no crossfades during a walk.** Revised after Checkpoint 2 by the
   human: the walk is one continuous generation from start to destination,
   steered by prompts, like footage from a head-mounted camera. (Originally:
   "cuts stay hard".)
3. **No safety score.** Facts only; the user does the synthesis.
4. **Say where the render isn't grounded in imagery.** Revised with rule 2:
   the continuous walk can't stop for an "unavailable" card, so the evidence
   readout must state when the current block has no street-level imagery.
   (Originally: "segments without imagery render as visibly unavailable".)
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

All Phase 2 code is on `person1`, not yet merged: `backend/geo.py` (graph, geocode,
routes, blocks, waypoints), `conditions.py` (facts, prompts, lighting),
`imagery.py`, `hours.py`, `scripts/fetch_data.py` (all offline data prep).
`backend/README.md` documents setup, data refresh and how each part works.
Verified: `pytest` 12/12; `/api/routes` schema-valid for Tenderloin
(Eddy & Jones → Golden Gate & Hyde), Ferry Building → Civic Center and
16th & Valencia → 24th & Mission. First request in a new area ~12–15s (tile
downloads), repeats ~0.1s; startup ~10s.

- [x] **Cache the SF walking graph.** `osmnx.graph_from_place("San Francisco,
California", network_type="walk")`, save to `backend/data/sf_walk.graphml`.
      Load from disk on startup — never hit Overpass at request time. This
      download is slow; do it first and commit the cache file if under 100MB
      (otherwise gitignore it and document the command).
  - done, 80MB, committed. Took ~1 min, not slow. **osmnx drops `lit` and
    `sidewalk` by default** — re-downloaded with them added to
    `useful_tags_way` (`scripts/fetch_data.py graph`).
- [x] **Geocode + two routes.** Geocode origin/destination strings to nodes.
      Compute route A as shortest path by length. Compute route B as a
      genuinely different path — penalize edges used by A and re-run, so the
      two routes diverge meaningfully rather than differing by one block.
  - done, changed: B triples the cost of every edge **within 30m of A**, not
    only A's edges — SF sidewalks are separate footways, so penalizing A's
    edges alone just moved B to the other side of the same street. Ferry
    Building → Civic Center: 4% of B's waypoints within 30m of A. Nominatim
    can't geocode `X St & Y St`, so intersections resolve offline from the
    graph's street names; place names use Nominatim (cached); `lat,lng` also
    accepted. Outside SF / no path → 422.
  - **Superseded before Checkpoint 3:** route comparison is dropped, and only
    route A is walked. Route B is still computed and served until the "One
    route only" task in Phase 3 removes it.
- [x] **Waypoint sampling.** Walk each route's edges and emit waypoints every
      ~25m. `heading` is the bearing to the next waypoint. `block_id` is the
      OSM way id — consecutive waypoints on the same way share it.
  - done, changed `block_id`: a bare OSM way id doesn't work here. Sidewalk
    ways split at every crosswalk (a cut every few metres), and long streets
    are one way (a block far past the ~25s drift). Blocks now split at turns
    >40°, street renames, intersections after 120m, and every 200m; crosswalk
    jogs <50m fold into the next block. Format `w<way id>-n<start node>`
    (still a string, same contract). Typical block 90–150m, 4–7 waypoints.
    **All waypoints in a block share one `image_url`** at the block's heading
    — one seed per block, which is what the session manager needs.
- [x] **Sun position.** Use `astral` to compute civil twilight for the
      requested date at SF's lat/lng. Derive whether it's dark, and the "Dark
      since HH:MMpm" fact. Exact, offline, no API.
  - done. Handles after-midnight (dark since the previous day's dusk). Naive
    datetimes are SF local time. In daylight the fact reads
    `Not yet (dark at 7:48pm)` and prompts say "at dusk"/"in daylight".
- [x] **OSM edge attributes.** Pull `lit`, `highway`, `lanes`, `sidewalk`,
      `width` from the cached graph per edge. Map to facts.
  - done, sparse data: `lit` on ~24% of edges, `sidewalk` ~13%, `lanes` 10%,
    `width` ~0% (dropped). Routes mostly walk mapped sidewalks with no road
    tags, so road/lit/sidewalk facts come from the nearest street within 25m.
    Missing tags read `Not tagged`, never guessed.
- [x] **POI density as footfall proxy.** Count OSM POIs within ~50m of each
      waypoint. Filter by `opening_hours` where present to get "open at this
      hour". Fall back to total count when hours are missing — and say so in
      the fact wording (`"3 nearby (hours unknown)"`).
  - done. 24.6k POIs, only 3.8k with hours. Benches, parking, bike racks
    etc. are excluded (not footfall). Wording: `2 of 5 open at 11pm, 3 more
    with hours unknown` / `4 nearby (hours unknown)` / `None nearby`.
    Small `opening_hours` parser in `hours.py`; unparseable → unknown.
- [x] **DataSF enrichment.** Download the streetlight inventory and 311
      streetlight-outage extracts from DataSF to `backend/data/`. Spatially
      join to edges. Produce the outage fact. **Cache to disk — do not call
      their API at request time.**
  - done, changed: **SF doesn't publish a streetlight inventory on DataSF.**
    The catalog, now at `data.sf.gov`, has none; the "Streetlight
    Poles/Fixtures" hits were other cities. Lamp positions come from
    **Mapillary `map_features`** (95.7k detections citywide, clustered at 8m
    because one lamp is often mapped several times) plus 1.6k OSM
    `street_lamp` nodes. 311: dataset `vw6y-z8j6`, `service_name =
    Streetlights`, last 365 days (5.2k cases). Fact = `light`-subtype
    reports within 30m of the block in the 90 days before the requested
    time: `None in 90 days to Sep 2026 (311)`. All cached files are committed.
- [x] **Prompt composition.** Build `video_prompt` and `audio_prompt` from the
      composed condition. Keep them concrete and physical: lighting, road
      width, parked cars, pedestrian presence, weather, wetness. Do **not**
      write anything about threat, danger, crime, or people behaving
      menacingly — that is out of scope and will trip content filters.
      Include weather from Open-Meteo for the requested date/time.
  - done. Road class, lamp layout, one out, fog (code/visibility), rain/wet,
    parked cars, open storefronts → pedestrians; audio from road class, rain,
    wind, open businesses. Caveat: weather is **one SF point**, so
    neighbourhood fog differences aren't captured. It's a live call (forecast
    covers −90…+15 days, archive otherwise), cached 1h in memory. If it
    fails, the fact says `Unavailable` and the prompt leaves weather out.
- [x] **Imagery.** Implement `GET /api/imagery/<block_id>/<heading>`.
      Primary source: **Mapillary** (free, CC BY-SA, no ToS problem) if
      coverage on the target neighborhood is adequate. Fallback: Google Street
      View Static API (10k/mo free, needs a Cloud billing account + card). Use the Street View
      **Metadata** endpoint (free, unlimited) to check coverage and set
      `image_available`. Cache fetched images to `backend/data/imagery/`.
  - done, Mapillary. Candidates come from Mapillary's **z14 coverage vector
    tiles** (cached to disk): the `/images` bbox search 500s ("reduce the
    amount of data") everywhere on Market St, even at 10m. Picks the image
    nearest the walked line (≤18m across, ≤30m behind), newer preferred.
    Coverage: Tenderloin test routes 8/8 blocks, Ferry Building → Civic
    Center 37/42, Mission 2/2 routes returned. **No Google fallback** —
    decided after Phase 2 (too much setup for a one-day hackathon). Blocks
    without Mapillary are `image_available: false`, and the demo picks
    routes that avoid them. `/api/routes`
    pre-warms every block's frame in the background, so Person 2's first
    fetch is a cache hit (a cold pano download is ~5–20s).
- [x] **Crop panoramas to 16:9 at the waypoint heading.** Most Mapillary
      coverage on our blocks is 360° panos. Orbis wants a 16:9 frame (854×480
      stable / 640×368 dynamic) and resizes a non-16:9 image **without
      cropping**, which distorts it. Equirectangular crop math is validated in
      the spike — a ~90° window centred on the waypoint heading.
  - done, 854×480. A proper rectilinear reprojection, not a strip slice, so
    straight lines stay straight. Uses Mapillary's SfM `computed_compass_angle`;
    the raw camera compass is 0 or off by 20–40° on many panos. Checked by eye
    on 20+ frames: they look down the street. **Known:** an occasional frame
    still faces a storefront (bad compass on that capture). Non-pano photos
    must face within 35° of the heading and are centre-cropped. The spike's
    crop script wasn't committed, so this is new code.
- [x] **Structured lighting in the contract (Person 2 needs it to render
      night accurately).** NEW, after the Person 2 spike. You already collect
      the lighting data — OSM `lit`, the DataSF streetlight inventory, 311
      outages — but the contract carries it only as **prose**, in `facts` and
      `video_prompt`. Person 2's day→night conversion needs **numbers**, or
      every block gets the same generic amber wash regardless of what is
      actually there. Proposal, to agree before either of us builds on it: add
      a `condition.lighting` object alongside `facts`, e.g.
      `{ lit: "yes"|"no"|"unknown", lamp_count: 6, side: "both"|"one"|"none",
      lamp_offsets_m: [12, 40, 68], outages: 2 }`. `lamp_offsets_m` — distance
      along the block from the waypoint — is the one that matters most: it
      turns a generic glow into a lamp in the right place, and a gap into a
      genuinely dark stretch, which is the whole point of the tool.
      **Mapillary has real per-lamp positions**, which the plan did not
      account for: `map_features` with `object_values=object--street-light`
      returned **35 mapped lamps** with coordinates in a ~250m box around the
      Tenderloin test block (verified — `docs/spike/lighting_probe.py`). Free,
      per-lamp rather than per-segment, and a cross-check on DataSF.
      **Do not** use Mapillary `captured_at` to look for existing night
      imagery: every frame tested near the block was daylight (mean luma
      0.33–0.54) whatever hour its timestamp claimed, including ones stamped
      22:25 and 04:06 local. Timestamps are not trustworthy for time of day.
      Use `astral` for darkness, as already planned.
  - done, **final — Person 1 owns this field** (the human's decision). Every
    waypoint carries `condition.lighting = { lit, lamp_count, side,
    lamp_offsets_m, lamp_lateral_m, outages }`. It's in the schema, and optional
    there only so the grade can degrade gracefully.
    - `lamp_offsets_m`: integer metres ahead of this waypoint along the route,
      one per lamp still ahead on the block, ascending.
    - **`lamp_lateral_m`** (added to the proposal): same order, metres right
      (+) or left (−) of the **street centreline**. The Mapillary seed camera is
      usually in the roadway, so this places pools where the lamps really are
      instead of guessing ±4.5m.
    - `side`: which sides of the centreline the lamps are on. First measured
      against the walked sidewalk, which was wrong: both curbs' lamps are on the
      same side of a pedestrian.
    - `lit`: the OSM tag.

    Lamps come from the street beside the block (nearest parallel street edge).
    They must be within 20m of its centreline and not past either end of the
    block, which drops lamps at the corner or up the cross street.
    Measured over three route pairs (71 blocks): median |lateral| 10m, ~9 lamps
    per 100m, 66 both / 2 one / 3 none. The fixture carries example values
    (laterals invented, ±6m). Caveat: Mapillary lamp positions carry a few
    metres of error, and density depends on capture coverage. Treat offsets
    and gaps as the signal, not exact counts.

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

**CORE — real-time condition changes during a walk.** Added after Checkpoint
2 review. This is what the submission is graded on: Orbis's real-time
interaction. While a walk is playing, the viewer changes a condition in the
sidebar (e.g. time 7pm → 11pm) and the *running* video changes to match,
without restarting the walk. Darkness, lamps, fog, foot traffic and audio all
change. It sits on top of a smooth start-to-destination walk (Checkpoint 2
fixes), not instead of it. Person 2 owns applying it to the live session (see
Person 2 Phase 3); Person 1 owns the data and the controls:

- [ ] **Conditions at a new time without new geometry.** Re-requesting
      `/api/routes` with only `datetime` (or fog/crowd) changed must return
      identical routes: same `block_id`s, waypoint indices, `image_url`s.
      Only `condition` changes. Warm response well under 1s. Add a test that
      locks geometry across two datetimes.
- [ ] **Numeric ambient light in the contract.** Today darkness is a
      yes/no plus prose. The grade needs a dial to move smoothly from 7pm
      (dusk) to 11pm (night), so add e.g. `condition.ambient = { phase:
      "day"|"dusk"|"night", sun_altitude_deg, darkness: 0..1 }` from
      `astral`. Agree the shape with Person 2 first.
- [ ] **Fog and crowd overrides.** `fog` and `crowd` query parameters on
      `/api/routes` that override the modeled weather and foot-traffic
      wording in `video_prompt` / `audio_prompt` / `facts`. Overridden
      facts must say so (e.g. "Fog (set by you)"), so they aren't mistaken
      for data.
- [ ] **`ConditionControls.tsx` drives the live walk** (replaces the
      refetch-only behaviour below). Time slider/picker plus fog and crowd
      toggles, usable **while a walk is running**. Debounce, fetch
      conditions for the new setting, and hand them to the walk controller
      without stopping it (`walk.applyConditions(route)` already exists in
      `use-orbis-walk.ts`). One route only.
- [ ] **One route only.** Route comparison is dropped (see WHAT WE ARE
      BUILDING). `/api/routes` returns just the shortest route as
      `routes[0]`, `route_id: "A"`, still an array so the contract shape
      holds. Stop computing route B: it roughly halves the cold request's
      imagery lookups. Update `shared/fixture-routes.json` and the tests to
      one route.

- [ ] **`EvidenceReadout.tsx`** — horizontal strip beneath the viewport.
      Renders `condition.facts` for the current waypoint verbatim, in two
      columns, with "Modeled estimate" as a persistent label. Updates on every
      waypoint change.
- [ ] **Fact-change emphasis.** When moving to a waypoint whose facts differ
      from the previous one, briefly emphasize the changed fields. Motion in
      the periphery earns attention only when there's something to see. Keep
      it subtle — no flashing.
- [ ] **`Minimap.tsx`** — upper right. Draw the route, with the part
      already walked distinguished and the current position marked. Leaflet
      or a plain SVG projection of the waypoint coordinates; SVG is fine and
      has fewer dependencies. (Was "both routes"; comparison dropped.)
- [ ] ~~**`ConditionControls.tsx`** — refetches routes and applies to both
      routes at once.~~ Superseded by "`ConditionControls.tsx` drives the
      live walk" above: one route, changed live without stopping.
- [ ] **`RouteBrief.tsx`** — the shareable artifact. The walked route, its
      conditions at the chosen time, and a share link. Encode
      origin/destination/datetime in the URL query string — no database, the
      link just regenerates the preview. (Was "both routes, which was picked,
      chosen-route"; comparison dropped.)

### 🛑 CHECKPOINT 3 — full demo runthrough

Print this to your human and stop:

> **Person 1 ready for Checkpoint 3.**
>
> All data-display components are filled: evidence readout, minimap, live
> condition controls, route brief. The backend serves one route.
>
> **Merge with Person 2 into `main`** and do a full demo runthrough together:
> setup screen → continuous walk of the route → change the time (e.g. 7pm →
> 11pm) mid-walk and watch the render change → generate and open a share link.
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

You own: the Reactor/Orbis integration, session management, the viewport, and
the app shell. (The compare view was dropped before Checkpoint 3.) You do not
touch the backend or the geo pipeline. You develop against `shared/fixture-routes.json` until Checkpoint 2.

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
    second connect with 429. **This is fixed — Reactor staff were clear the
    quota will not be raised, so treat 1 as permanent. Prefetch is dead and
    compare mode cannot be two live sessions.** Also: no REST endpoint exists
    to list or kill a session, so a crashed client blocks the only slot —
    always `disconnect()` in a `finally`, and mint the JWT **once** per
    session (a resolver that re-mints per request 403s).
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

- [x] **App shell.** Next.js (App Router) + TS in `frontend/`, built on
      the starter (replace `app/page.tsx` / `components/orbis-demo.tsx`
      rather than adding a parallel app). Three screens:
      **Setup** (origin, destination, date, time — nothing else),
      **Walk**, **Brief**. Layout for Walk: viewport upper left; a slot for
      `EvidenceReadout` as a horizontal strip beneath it; slots for `Minimap`
      and `ConditionControls` stacked in the right column; compare and share
      buttons below those. **No top bar** — the right column is the only place
      the world changes, the left column the only place you see it.
  - done. `app/page.tsx` -> `components/walk-home.tsx`. Setup and Walk share one
    layout and **the viewport stays mounted across both** — that is what lets the
    session warm while setup is still on screen. Brief is a separate screen.
    Starter demo deleted (`orbis-demo`, `orbis-controls`, `orbis-player`,
    `use-orbis-session`) along with the whole Nano Banana example and `dog.png`,
    per the plan's own note not to build on it. App state is `zustand`
    (`lib/store.ts`); contract types are `lib/contract.ts`.
- [x] **Create empty stub components** for Person 1 to fill:
      `EvidenceReadout.tsx`, `Minimap.tsx`, `ConditionControls.tsx`,
      `RouteBrief.tsx`. Each takes typed props from the shared contract and
      renders a placeholder. Commit these early so Person 1 isn't blocked at
      Phase 3.
  - done. `EvidenceReadout.tsx`, `Minimap.tsx`, `ConditionControls.tsx`,
    `RouteBrief.tsx` in `frontend/components/`, PascalCase as named here, each
    with typed props and a visible placeholder. Helpers left for them:
    `factsDiffer` (change emphasis), `projectPoints` (SVG minimap),
    `buildShareUrl` (the share link the shell reads back on load).
    `ConditionSettings` is exported from `ConditionControls.tsx` — Person 1 owns
    that file, so the shape is theirs to change.
- [x] **Token endpoint.** Already exists at `frontend/app/api/token/route.ts`
      from the starter. Adjust `max_sessions` per the Q3 finding. Never ship
      the Reactor API key to the browser.
  - done in Phase 1. Takes optional `{model, maxSessions}`; defaults to
    `max_sessions: 1` per Q3. Key stays server-side.
- [x] **Session manager** in `frontend/lib/orbis/` (hooks may live in
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
  - done, as specified. `lib/orbis/session.ts` (command sequences), `signals.ts`
    (awaitable messages), `blocks.ts` (grouping + dwell), driven by
    `hooks/use-orbis-walk.ts`. JWT minted once via the cached promise; always
    `disconnect()` in `finally`, plus on unmount. **One correction to the
    starter's sequence:** `sendCommand` resolves to `undefined` for `set_seed`,
    `set_resolution`, `start` and `reset` — only `set_image` answers
    (`image_accepted`), so treating a missing reply as failure breaks the run at
    the first command.
- [x] **Pin the seed** to one value for the whole route via `set_seed`, so
      weather and lighting realization don't diverge wildly between blocks.
      Confirmed safe: `set_seed` and `set_resolution` survive `reset`, so set
      them once at connect and they hold for every block.
  - done. The seed is derived from the route id so a rerun of the demo looks the
    same; set once at connect alongside `set_resolution`, survives every reset.
- [x] **Hold-until-ready.** Never display an unready segment. Hold the
      current live render and switch when the next block is ready. **Never cut
      to a raw Street View photo** — a daytime JPEG before a night render
      contradicts the premise. **No crossfade** — hard cut when the next block
      arrives. Measured gaps to cover: **~12–16s at route start**, **~7–8s at
      each block boundary** (~2.3s of commands + ~5–6s to first frame).
  - done. The last live frame is frozen onto a canvas over the video before the
    reset, and the cut happens when real frames resume — detected from the
    pixels, because `generation_started` fires ~6s early. Measured in the app:
    **15.7s cold, 8.3s at a block boundary**. No crossfade, no photo, ever.
- [x] **Keep block dwell to ~8–15s.** Conditioning drifts off the real
      geometry by ~25s (Q1), after which we are showing an invented street.
      Advance to the next block before that, even if waypoints remain.
  - done. `blockDwellMs` clamps to 8–15s (4s per waypoint), timed from the cut
    rather than from `start`.
- [x] **Day → night conversion of every seed frame. OWNED BY PERSON 2.** NEW,
      after the spike (Q1) — the single step the premise depends on. Orbis
      takes its lighting from the seed and ignores a night prompt, so a
      daytime frame produces sustained daytime video of the right block, which
      breaks non-negotiable rule #1. Convert the frame from `/api/imagery/...`
      to night **before** `set_image`, in the browser or in a Next route —
      never show it either way, it is an intermediate. Port
      `docs/spike/nightgrade.py` (numpy + Pillow; no API, no key). Two things
      it already taught us: target a graded mean luma of **~0.06** (at ~0.04
      Orbis loses the block entirely), and the sky mask must catch **overcast**
      skies (bright + desaturated), not only blue ones.
  - done. `lib/orbis/nightgrade.ts` ports the Python to canvas, cover-cropping to
    Orbis's 640x368 seed frame first. **Improvement on the spike:** exposure is
    now *solved for* the target mean luma instead of being a constant, so a
    bright frame and a dim one both land at ~0.06 — that is exactly the failure
    that lost block B. Measured across the fixture: 0.051-0.064.
- [x] **Drive the grade from Person 1's lighting data, not a fixed look.**
      Once `condition.lighting` lands (see Person 1 Phase 2), place the glow
      from `lamp_offsets_m` / `side` and darken unlit stretches rather than
      washing every block in the same amber. A block tagged `lit: "no"` with
      2 outages must come out visibly darker than one with 6 working lamps —
      otherwise the render says nothing the facts strip doesn't already say.
      Until that field exists, key off the prose in `facts` and say plainly in
      `docs/reactor-findings.md` that the look is generic.
  - done as far as the data allows, and **the look is generic** — said plainly in
    `docs/reactor-findings.md`. `lib/orbis/lighting.ts` reads
    `condition.lighting` when it exists and otherwise parses the streetlight and
    outage facts, using them for exposure and glow strength only: nothing tagged
    -> ~0.045 mean luma with the glow at 35%, six working lamps -> ~0.068 at full
    strength. No lamp is *placed* anywhere, because we do not know where any lamp
    is. The placement code (`paintLampPools`, a pinhole projection from
    `lamp_offsets_m` + `side`) is written and switched off until Person 1 ships
    the field.
  - **Person 1, at the Checkpoint 2 merge:** the field has shipped, so pools
    now paint from real data. Person 1 made one small edit in
    `lib/orbis/lighting.ts`: `fromStructured` carries `lamp_lateral_m`, and
    `gradeParamsFor` uses it for `lateralM`. It falls back to the old ±4.5m
    alternation only when laterals are missing. Nothing else under
    `lib/orbis/` was touched. The "look is generic" note in
    `docs/reactor-findings.md` is now out of date for real routes; Person 2
    should re-check it by eye.
- [x] **Unavailable segments.** When `image_available` is false, render an
      explicit unavailable state. Do not generate a street from text alone to
      fill the gap.
  - done and verified on fixture route B (block `w8918502`): an explicit
    "Segment unavailable" card, generation reset behind it, nothing invented. The
    card stays up through the *next* block's seeding too — putting the last frame
    from before the gap back on screen would read as having walked it.
- [x] **Absorb first-load cost into the Setup screen.** Warm the first block's
      session while the user is still on setup, so the walk starts
      immediately. One deliberate wait where a wait is expected.
  - done, then tightened after Checkpoint 2 review: the session now starts
    connecting on the walker's **first touch of the form**, not on submit, and
    the first seed frame is fetched and graded while it connects. Neither needs
    anything from the form. **Cold start 15.7s -> 9.0s**; the remaining ~5.8s is
    Orbis priming and is not ours to remove (`native` resolution was measured and
    does not help — see `docs/reactor-findings.md`). The setup panel is a
    progress readout while it works, and the screen flips to Walk on the first
    frame.
- [x] **Autoplay flythrough.** Walk the route end to end automatically,
      advancing block by block. **This is the primary deliverable.** It must
      work standalone with no interaction.
  - done. Verified end to end on both fixture routes, 4 blocks each, no
    interaction. `?route=B` on the root URL walks route B — that is the share
    link format, and it is how to reach route B for testing.
- [x] **Audio on by default, mute toggle only.** Pass `audio_prompt` through.
      No other audio UI.
  - **Carried over from Checkpoint 1, still unverified.** The spike confirmed
    the `main_audio` track is negotiated and delivered on every run and that
    `set_audio_prompt` is accepted, but it ran headless — nobody has listened
    to the output yet. **Verify by ear at Checkpoint 2**: does the audio match
    the block (traffic, wind, footsteps) or is it generic noise? If it is
    generic, try `""` for picture-driven audio instead of our caption.
  - wired: `set_audio_prompt` is sent per block from the waypoint's
    `audio_prompt`, audio defaults to on, and the only control is a mute toggle
    on the viewport. **Still unheard** — the verification runs were headless and
    headless Chrome fell back to muted playback. Listen at Checkpoint 2.
- [x] **Viewport overlays.** Route direction arrow at the correct screen
      bearing with distance to next turn. One persistent condition line in a
      corner (the full readout is Person 1's strip below).
  - done. Direction arrow rotated to the relative bearing of the next turn with
    the distance to it, and one condition line built from the first two facts,
    labelled "Modeled estimate".

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
> **Carried over from Checkpoint 1 — check by ear:** the audio has never been
> listened to, only confirmed to arrive. Unmute and say whether it matches the
> block or is generic noise.
>
> Waiting for your confirmation that this passed.

## Phase 3 — Real-time conditions (CORE)

**CORE — real-time condition changes during a walk.** Added after Checkpoint
2 review; this is what the submission is graded on. While a walk plays, a
change from `ConditionControls` (time, fog, crowd) must visibly change the
*running* video within a couple of seconds, without restarting the walk or
cutting to "preparing". Layer it on the smooth continuous walk from the
Checkpoint 2 fixes.

- [ ] **Spike: what actually changes a live render?** Q1 found the seed's
      lighting beats the prompt. So measure: (a) does a mid-run `set_prompt`
      alone visibly change darkness/fog/crowd within ~2 chunks, and (b) does
      a mid-run `set_image` with a re-graded seed (no `reset`) change it
      faster or more strongly? Record numbers in `docs/reactor-findings.md`.
- [ ] **Apply condition changes to the live session.** Accept new conditions
      from the walk controller mid-block. `set_prompt` / `set_audio_prompt`
      morph right away. Re-grade the current and upcoming seeds from
      `condition.ambient` + `condition.lighting`, and re-condition the
      current block through whichever path the spike proved. No reset, no
      hold card for a condition change.
- [ ] **Grade driven by ambient light, with a floor.** `nightgrade.ts`
      takes `darkness` 0..1, so dusk → night is a continuous change, never
      black. Keep a minimum light floor for the darkest block.

- [ ] **Remove comparison from the UI.** Route comparison is dropped (see
      WHAT WE ARE BUILDING). Remove the "Compare routes" button, the
      `?route=B` share-link path and `activeRouteId` switching. The shell walks
      `routes[0]`.
- ~~**Compare mode / Compare is a mode / Concurrency check.**~~ **DROPPED
  before Checkpoint 3** (human decision, both people): too complicated for
  the timeframe, and with one concurrent Orbis session (Q3) two live walks
  can't exist anyway.

### 🛑 CHECKPOINT 3 — full demo runthrough

Print this to your human and stop:

> **Person 2 ready for Checkpoint 3.**
>
> Live condition changes reach the running walk without restarting it.
>
> **Merge with Person 1 into `main`** and do a full demo runthrough together:
> setup screen → continuous walk of the route → change the time (e.g. 7pm →
> 11pm) mid-walk and watch the render change → generate and open a share link.
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
  - **SKIPPED PERMANENTLY. Q3 = 1 concurrent session** and Reactor staff
    confirmed the quota will not be raised. Do not revisit.
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
- [x] ~~Set up a Google Cloud billing account + Maps API key as fallback~~
  - dropped: no Google fallback for the hackathon; fallback code removed.
- [x] Download DataSF streetlight + 311 extracts
  - 311 done (`backend/data/311_streetlights.json`). SF has no streetlight
    inventory on DataSF; lamp positions come from Mapillary + OSM instead.
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

- [x] Checkpoint 1 — contract handshake — **PASSED**, confirmed by the human.
      Both sections of Phase 1 are complete and merged to `main`.
  - Person 1: done (schema, fixture, FastAPI serving the fixture, on `main`).
  - Person 2: done (Reactor spike Q1–Q5 plus Q6, `docs/reactor-findings.md`,
    on `main`). Headline: image conditioning works well, but **seeds must be
    night-graded first** or Orbis renders daytime; and **only 1 concurrent
    session** exists, which kills prefetch and live compare.
  - Handshake **verified**: backend venv built, `pytest` 4/4, `/api/routes`
    200 and schema-valid (2 routes × 12 waypoints × 4 blocks, route B block
    `w8918502` correctly no-imagery), `/api/imagery` 200 JPEG + 404, CORS
    allows `:3000`. Frontend typecheck and `next build` both clean.
  - Decisions taken at this checkpoint:
    - **Day→night conversion is Person 2's**, in the render layer.
    - **Person 1 adds structured `condition.lighting`** so the night render is
      driven by real lamp data rather than a fixed amber look. Contract change
      — agree the shape before building on it.
    - **Concurrency stays at 1.** Reactor staff confirmed it will not be
      raised; prefetch is dropped for good and compare must be pre-generated.
    - **Audio still unheard** — deferred to Checkpoint 2 to check by ear.
  - **Carried into Phase 2, not blocking this checkpoint:** Person 1 has not
    yet agreed the `condition.lighting` shape. Person 2 can build the whole
    session manager and autoplay without it — the night grade just stays
    generic until it lands. Settle it before Person 1 starts their Phase 2
    prompt composition, since both read the same lighting data.
  - **Resolved:** the human assigned `condition.lighting` to Person 1, and it
    shipped in Person 1's Phase 2 with `lamp_lateral_m` added. See Person 1
    Phase 2.
- [ ] Checkpoint 2 — end-to-end integration — **attempted 2026-09-12, NOT
      passed.** Both branches are merged to `main` and the pipeline runs
      end to end in Chrome:
  - **Working:** real routes and facts reach the UI; autoplay walks every
    block to "End of route"; one continuous generation per block; hold then
    hard cut; `condition.lighting` reaches the grade ("lighting from
    structured"); a block with no imagery shows "Segment unavailable".
  - **Failed (human review), must fix before Checkpoint 2 passes:**
    - [ ] **The walk doesn't walk.** It lingers near the start of each block,
      shows "next block preparing", then cuts ahead to linger near the start
      of the next one. Wanted: drift down the block as if walking the
      sidewalk, with the next block loaded behind the scenes and no obvious
      cut. Cause: by design, each block is `reset` → seed from the block's
      first frame → 8–15s dwell → ~7s frozen hold → repeat. With one session
      nothing can preload in parallel.
      - **Spike result (Q7, `docs/reactor-findings.md`):** a live generation
        cannot be re-seeded. `set_image` mid-run, `set_image` + `set_prompt`,
        and `pause` → `set_image` → `resume` are all accepted, then ignored.
        New real imagery only lands after `reset`, i.e. a ~7s gap and a cut.
      - **HUMAN DECISION (supersedes the block-by-block design): no cuts.**
        "It's literally a video generation model." The walk is **one
        continuous generation for the whole route**, as if someone walked it
        with a head-mounted camera. Real imagery seeds the start. From then on
        `set_prompt` morphs steer the walk: "walking forward along the
        sidewalk", "turning right at the corner onto Hyde Street", "crossing
        the street at the crosswalk". Slowing the walking pace is fine, within
        reason.
      - Consequences, to confirm while building:
        - `reset` is no longer used mid-walk. The hold card and hard cuts go.
        - Past the first block the render is steered by text, not grounded in
          imagery. Block drift (Q1) becomes accepted behaviour.
        - A block without imagery no longer needs an "unavailable" card
          (rule 4 below is revised).
        - Motion cues come from route geometry (turns, crossings, street
          names), so **Person 1** adds them to each waypoint's `video_prompt`.
          The walk controller morphs to the next waypoint's prompt on a timer.
        - **Spike (`docs/spike/runs/continuous-walk-script`):** one generation
          ran **2+ minutes** (65 chunks, no stop, no errors) through 14
          scripted morphs. It **does follow motion cues**: frames round a curb
          on "turn right" and step down a curb on "cross". Two problems:
          - the camera sinks toward ground level after ~20s;
          - colour drifts to a green cast, with a blurry breakdown around 90s.

          A re-run with anchor wording (head-height camera, natural colour,
          warm amber light) **failed to start: 429, the single session slot was
          still held** by the previous run. Not re-run yet.
        - **Built** (`547924b`, `use-orbis-walk.ts` rewrite): the backend puts
          a motion cue in every `video_prompt` ("crossing the street at the
          crosswalk, then turning left onto Leavenworth Street"), plus a
          "Street imagery" fact. The walk seeds once, then morphs every 6s
          (`WAYPOINT_DWELL_MS`). `applyConditions(route)` swaps in recomputed
          conditions and morphs immediately, ready for Phase 3's live
          controls. Typecheck clean; **not yet watched in the browser**.
    - [ ] **Lighting looks wrong.** Sometimes too dark to see anything, and
      often "a block with a dark blue filter on the top half". Cause,
      reproduced offline on real seeds: `nightgrade.ts`'s sky mask
      (`(blue>0.03 || sat<0.2) && luma>0.42 && row<0.62`) flags 24–52% of
      every frame. That includes pale asphalt, glass and white facades, all
      replaced with flat navy and a hard edge at 62% height. Graded targets of
      0.045–0.068 also render at ~0.03 in Orbis on some blocks.
      Fix direction:
      - Sky must be connected to the top edge, no hard row cut-off, and a
        gradient rather than flat navy.
      - Minimum light floor for even the darkest block (the human's
        suggestion): raise the target luma floor and re-test where Orbis
        starts rendering daytime.
      - Owner: Person 2 (`lib/orbis/nightgrade.ts`, `lighting.ts`) unless
        the human reassigns.
    - [ ] **Person 1 backend nits:** the Mapillary capture-car rig is visible
      at the bottom of some seeds (tilt the pano crop up or prefer rig-free
      images); "Road: No road alongside" shows beside obvious roads (street
      search radius too small).
      - Root cause found later, and bigger than the search radius: osmnx's
        `walk` network **omits streets whose sidewalks are mapped
        separately** (`sidewalk=separate`), which covers most of downtown.
        Jones St and Valencia St were not in our graph at all, so waypoints
        on their sidewalks had no road facts, no street name, no centreline
        for lamp sides, and a "narrow pedestrian path" scene. Fix: a second
        cached graph of drivable streets (`data/sf_streets.graphml`,
        `fetch_data.py streets`) feeds the street index. Routing still uses
        the walk graph.
  - Not yet checked: audio by ear.
- [ ] Checkpoint 3 — full demo runthrough
  - **Scope change (human decision, before Checkpoint 3): no route
    comparison.** One start, one destination, one route walked. Reasons: too
    complicated for the timeframe, and only one concurrent Orbis session.
    PLAN updated for both people: Person 1 "One route only" and Person 2
    "Remove comparison from the UI" tasks added; compare tasks dropped.
- [ ] Final submission — branch pushed to Visko-Platform/orbis-hackathon-starter
