# Reactor / Orbis spike findings

Person 2, Phase 1. Every number here was measured against the live Reactor API
on 2026-09-12, not read off the docs. The harness is `frontend/app/spike/`,
driven headless. Curated frames are in `docs/spike/evidence/`; the raw timing
logs are in `docs/spike/runs/*/report.txt` (the full-size PNG dumps are ~40MB
and gitignored).

**Headline: the product premise works, but only with one extra step that is not
in PLAN.md — the seed image must be converted to night before it reaches Orbis.**
A daytime Street View frame produces a daytime video no matter what the prompt
says.

---

## Answers

| # | Question | Answer |
|---|---|---|
| Q1 | Does Orbis condition on a Street View seed via `set_image`? | **YES, strongly — but the seed must be night-graded first.** Raw daytime seed → daytime video, prompt ignored. |
| Q2 | WebRTC live session or REST submit/poll? | **WebRTC live session.** There is no REST inference lane. |
| Q3 | Concurrent sessions? | **1 per model.** Account quota, and it overrides the token's `max_sessions`. |
| Q4 | Session init latency? | **~12–16s** cold to first picture (dynamic). Re-seeding inside a live session: **~2.3s**. |
| Q5 | `-stable` or `-dynamic`? | **`-dynamic`.** Far more consistent time-to-first-frame, plus mid-run prompt morphing. |

---

## Q1 — image conditioning (critical)

### Conditioning itself is excellent

Seeded with a real Mapillary frame of a Golden Gate Ave block, Orbis does not
merely "start from" the image — it *continues* it. The mural, the blue
storefront, the tree line, the SUV with the spare-tyre cover and the street
geometry all persist, and the camera walks forward down that street.

This is exactly what the product needs. It is a much stronger result than
"accepts a start image".

### But the seed's lighting beats the prompt

With a **daytime** seed and an explicit night prompt
(`"...street at night, amber sodium streetlights, wet asphalt..."`), the output
is **full daylight — blue sky, hard sun shadows** — and stays that way for the
whole run. The prompt's lighting terms lose to the image.

![daytime seed renders daytime](spike/evidence/02-daytime-seed-renders-daytime.jpg)

`evidence/02` — blue sky, midday, from an explicit night prompt. `evidence/03`
shows it is still midday 25s in.

This directly threatens non-negotiable rule #1. The rule was written about
*flashing* a daytime JPEG; the real failure mode is worse — Orbis will happily
**generate sustained daytime video** of the right block.

For contrast, with **no seed at all** the same night prompt gives a convincing
night street (`evidence/01`) — it is just a
generic one, not that block. So the two halves of the premise were in direct
tension until the fix below.

### The fix: night-grade the seed before `set_image`

Converting the seed to night offline, then seeding with *that*, gives night
video **and** the real block:

`docs/spike/seeds/golden-gate-ave-west.jpg` → `...-night.jpg` is the grade, and
seeding with it gives:

![night-graded seed keeps the block](spike/evidence/04-nightgraded-seed-block-a.jpg)

`evidence/04` — night, same mural, same tree line, same parked SUV.

Reference implementation: `docs/spike/nightgrade.py` (numpy + Pillow, offline,
milliseconds, no API key). It replaces the sky, applies a sodium-vapour cast,
keeps highlights as light sources, and adds a wet-road sheen. Geometry is
untouched, which is the whole point.

**Two tuning facts, both learned the hard way:**

1. **Exposure decides whether the block survives.** A graded seed at mean luma
   **0.043 lost the block** (`evidence/06`); the same frame regraded
   to **0.061 reproduced it** — hotel sign, laundromat sign, fire escapes,
   downhill view (`evidence/07`). Target ~0.06; too dark
   and there is no structure left to condition on.
2. **The sky mask must handle overcast.** A blue-dominance test alone misses
   SF's grey skies and leaves a bright cloud mass that hijacks the render.
   Detect "bright and desaturated" as well.

`nightgrade.py` is a hand-rolled grade and it is the weakest link here. The
starter already ships a Gemini image-edit route (`frontend/app/api/nano-banana/`)
which would do a proper night *relight* rather than a levels crush. It needs a
`GEMINI_API_KEY`, which we do not have. **Decision needed at Checkpoint 1** —
see Open questions.

### Fidelity decays with time-in-block

Conditioning is strong for roughly the first ~10s and has drifted off the real
geometry by ~25s (`evidence/05` is still night, but is no
longer that block; `evidence/08` likewise).

This *validates* the plan's block-level session design and puts a number on it:
**a block should hold the screen for ~8–15s, not longer.** Past that we are
showing an invented street, which breaks the "familiarisation tool" promise.

---

## Q2 — lane

**WebRTC live session only.** `@reactor-team/js-sdk` is browser-only (wasm +
`RTCPeerConnection`); the model page states no REST inference lane exists.
`requestClip()` / `requestRecording()` return recordings of a live session —
they are not a submit/poll API. So we hold sessions, we do not queue jobs.

Commands confirmed live: `set_image`, `set_prompt`, `set_audio_prompt`,
`set_seed`, `set_resolution`, `start`, `pause`, `resume`, `reset`.

---

## Q3 — concurrency: **1**

```
429 {"error":"quota_exceeded","limit":1,"current":1,
     "quota_type":"concurrent_sessions_per_model",
     "model":"reactor/visko-orbis-dynamic"}
```

Minting a token with `max_sessions: 3` is **accepted**, and then the second
`connect()` is refused anyway — the account quota is the real limit, not the
token's scope. Session 1 ready, sessions 2 and 3 refused
(`docs/spike/runs/q3-concurrency/report.txt`).

The quota is **per model**, so one `-stable` plus one `-dynamic` session is
possible — not useful for compare mode, which needs two sessions of the same
model.

Reactor's public docs advertise 5 concurrent per account; this key gets 1.
**Worth asking Visko/Reactor staff at the venue to raise it** — it is the single
constraint doing the most damage to the plan.

### Consequences for PLAN.md

- **Phase 4 prefetch is dead.** The plan already says "if Q3 said 1, skip this
  task". It said 1.
- **Phase 3 compare mode cannot run two live viewports.** Route B must be
  pre-generated, or the two routes run sequentially and get stitched.
- **Autoplay cannot warm block N+1 while block N plays** — which is what Q6
  below is about.

### Operational trap

There is **no REST endpoint to list or kill sessions** (`/sessions`,
`/v1/sessions`, `/api/sessions` all 404 with the API key). A crashed client
leaves its session holding the only slot, and every subsequent connect gets 429
until it ages out. This bit us three times during the spike.

Two rules follow, and both matter on demo day:

1. **Always `disconnect()` in a `finally`.** A tab closed mid-session blocks the
   next run.
2. **Mint the JWT once per session and pass the string.** Passing a *resolver*
   that mints a fresh token per call — which is the natural reading of the SDK's
   `jwt: () => fetchToken()` — makes the second HTTP call arrive with a token
   that does not own the session the first one created:

```
403 this token is session-scoped and is not authorized for this resource
```

The starter avoids this by caching the promise (`jwtPromise.current ??= ...`).
The session manager must keep doing that.

---

## Q4 — latency budget

Measured on `-dynamic`, medians across runs in `docs/spike/runs/`:

| Step | Time |
|---|---|
| `POST /api/token` | ~0.4–0.8s |
| `connect()` → status `ready` | ~7–11s |
| fetch seed + `uploadFile` + `set_image` → `state.has_image` | ~1.5–2.5s |
| `set_prompt` → `conditions_ready` | ~0.5s (immediate) |
| `start` → `generation_started` | ~0.1s |
| `generation_started` → **first visible frame** | **~5–6s** |
| **Cold total → first picture** | **~12–16s** |
| **Re-seed inside a live session → `generation_started`** | **~2.3s** |

The first chunk emits zero frames while the upscaler primes, so "started" and
"visible" are ~6s apart. Budget from `generation_started`, never from `start`.

**~12–16s is why the plan's "absorb first-load cost into the Setup screen" task
matters.** It is not a nicety; it is the difference between a demo that opens on
a black rectangle and one that opens on a street.

---

## Q5 — `-dynamic`, clearly

Same seed, same prompt, same noise seed, both models:

| | `-stable` | `-dynamic` |
|---|---|---|
| `generation_started` → first frame | **3.1s and 25.0s** across two runs | ~5–6s, consistent |
| Image quality | slightly richer, more photoreal | very good |
| Mid-run `set_prompt` morphing | no | **yes, at chunk boundary (~1.8s)** |
| Native resolution | 1080p / 2k / 4k | native 640×368 + 1080p / 2k / 4k |
| `set_image` target | 16:9, ~854×480 | 16:9, 640×368 |

Stable's time-to-first-frame varied by **8x between two identical runs** (3.1s
vs 25.0s). On a two-minute demo clock that is an unacceptable risk, and it is
the deciding factor — stable's marginally nicer picture does not pay for it.

Dynamic's mid-run prompt morphing is a real bonus: it lets conditions change at
*waypoint* boundaries inside one block session without a cut, which fits the
"no crossfades, hard cuts only at block boundaries" rule rather than fighting it.

---

## Q6 (not asked, but it decides the architecture)

**Can one session be re-seeded per block?** With only one concurrent session,
autoplay is only possible if switching blocks does *not* mean a new connection.

It does not. `reset` → `set_image` → `set_prompt` → `start`, **inside the same
live session**, works:

```
block1_reset_sent  @21047ms → block1_generation_started @23279ms   (2.23s)
block2_reset_sent  @32402ms → block2_generation_started @34717ms   (2.32s)
```

versus ~11.8s for a cold connect. And the re-seed genuinely takes: block2 was
re-seeded with block A's frame after two resets and reproduced block A exactly
(`evidence/09`).

`set_seed` and `set_resolution` **persist across `reset`**, so the route-wide
pinned seed survives every block change — the Phase 2 "pin the seed" task works
as written.

**So the session manager is: one long-lived session per route, `reset`+re-seed
at each block boundary.** Not one session per block. Budget ~2.3s of command
time plus ~5–6s to first picture per transition, and hold the previous render
across it.

---

## What this changes in PLAN.md

1. **New required step in the imagery path: day → night conversion of every seed
   frame before `set_image`.** Not in the plan. Blocks the whole premise.
2. **Phase 2 session manager:** one session per *route*, `reset`+re-seed per
   block — not one session per block.
3. **Phase 2 hold-until-ready:** the hold is ~7–8s at each block boundary, and
   ~12–16s at route start. Both need covering.
4. **Block dwell time ~8–15s** before conditioning drifts off the real geometry.
5. **Phase 3 compare:** cannot be two live sessions. Pre-generate or sequence.
6. **Phase 4 prefetch: skip**, per the plan's own instruction.
7. Mapillary panos need cropping to 16:9 at the waypoint heading before use —
   the crop math is validated in `docs/spike/nightgrade.py`'s sibling survey
   script and reproduced in Phase 2 by Person 1.

## Open questions for Checkpoint 1

1. **Who owns day→night conversion, and with what?** It sits exactly on the
   Person 1 / Person 2 boundary: it is part of the imagery pipeline (Person 1)
   but was found by, and currently lives in, the render spike (Person 2).
   My recommendation: Person 1 folds `docs/spike/nightgrade.py` into
   `GET /api/imagery/...` so the endpoint serves night frames directly and the
   frontend never holds a daytime pixel. That also satisfies rule #1 by
   construction.
2. **Do we get a `GEMINI_API_KEY`?** If yes, Nano Banana relighting is very
   likely better than the hand-rolled grade, and the starter already wires it.
   If no, the grade works — it just needs its exposure watched.
3. **Can Visko/Reactor raise `concurrent_sessions_per_model` above 1?** Worth
   asking in person. It would revive prefetch and live compare.

## Reproducing

```
cd frontend && npm run dev
# then, headless (any Chrome):
/spike?auto=1&run=<name>&model=dynamic&seed=block-a-night.jpg&captureAt=8,15
/spike?auto=1&run=<name>&mode=concurrency&sessions=3
/spike?auto=1&run=<name>&seeds=block-a-night.jpg,block-b-night.jpg   # relay
```

Frames and a JSON report land in `docs/spike/runs/<name>/`. The spike routes
under `frontend/app/api/spike/` and `frontend/app/spike/` are **dev-only**
(they refuse to run when `NODE_ENV=production`) and should be deleted before
anything ships.
