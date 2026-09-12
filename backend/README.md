# WALK HOME backend

FastAPI on port 8000. Serves `GET /api/routes` and `GET /api/imagery/<block_id>/<heading>`
per the contract in `PLAN.md` / `shared/waypoint.schema.json`.

## Setup

```sh
cd backend
uv venv --python 3.11 .venv          # or: python3.11 -m venv .venv
source .venv/bin/activate
uv pip install -r requirements.txt   # or: pip install -r requirements.txt
```

Keys live in the repo-root `.env.local` or `.env` (both are loaded):

- `MAPILLARY_ACCESS_TOKEN` — **required** for imagery. There is no Google fallback (decided for
  the hackathon): blocks without Mapillary coverage come back `image_available: false`.

## Data

All inputs are cached in `backend/data/` and committed, so a fresh clone needs no
download. To refresh them (none of this runs at request time):

```sh
python scripts/fetch_data.py graph      # OSM walk graph, with lit/sidewalk tags (~1 min, ~80MB)
python scripts/fetch_data.py osm        # OSM POIs (opening_hours) + street_lamp nodes
python scripts/fetch_data.py mapillary  # Mapillary street-light detections for SF (~5 min)
python scripts/fetch_data.py 311        # DataSF 311 "Streetlights" cases, last 365 days
```

Request-time lookups, all cached to disk and gitignored:

- `data/imagery/` — Mapillary z14 coverage tiles, per-block coverage decisions, 16:9 frames.
- `data/geocode_cache.json` — Nominatim results for place names. `X St & Y St` intersections
  resolve offline from the graph.
- Open-Meteo weather — one call per requested day, kept in memory for an hour.

## Run

```sh
uvicorn main:app --reload --port 8000
curl "http://localhost:8000/api/routes?origin=Eddy+St+%26+Jones+St&destination=Golden+Gate+Ave+%26+Hyde+St&datetime=2026-09-12T23:00:00"
```

Startup takes ~10s (graph + spatial indexes). The first request for a new area
downloads Mapillary tiles (a few seconds each downtown); repeats are fast.
`/api/routes` pre-warms each block's frame in the background.

`origin` / `destination` accept an intersection (`Eddy St & Jones St`), a place or
address (Nominatim), or `lat,lng`. Naive `datetime` is San Francisco local time.

## How it works

- **Routes** (`geo.py`): A = shortest by length. B = shortest after tripling the cost of
  every edge within 30m of A (not just A's own edges — otherwise B walks the opposite
  sidewalk of the same street).
- **Blocks**: the route is split at turns >40°, street-name changes, intersections after
  120m, and every 200m (Orbis drifts off the seed after ~25s). Crosswalk jogs under 50m
  fold into the next block. `block_id` = `w<OSM way of the block's longest edge>-n<its start node>`;
  the imagery endpoint rebuilds the seed point from that node and the heading.
- **Waypoints** every 25m; `heading` is the bearing to the next one. `image_url` uses the
  block's heading, so every waypoint in a block shares one seed frame.
- **Imagery** (`imagery.py`): nearest Mapillary image along the walked line (within 18m
  across, 30m behind), newer preferred. Panos are reprojected to a 90° 854×480 view at the
  heading using Mapillary's computed compass.
- **Conditions** (`conditions.py`): `astral` civil dusk, Open-Meteo, OSM tags on the walked
  edge or the street beside a mapped sidewalk, POIs within 50m (street furniture excluded)
  with `opening_hours` evaluated, lamps within 20m of the block, 311 light-out reports
  within 30m in the 90 days before the requested time.

## Test

```sh
pytest   # test_api.py needs network (Mapillary, Open-Meteo)
```
