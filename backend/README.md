# WALK HOME backend

FastAPI on port 8000. Serves `GET /api/routes` and `GET /api/imagery/<block_id>/<heading>`
per the contract in `PLAN.md` / `shared/waypoint.schema.json`.

**Phase 1 status:** `/api/routes` returns `shared/fixture-routes.json` verbatim
(origin/destination/datetime are validated but ignored). `/api/imagery` returns a
labeled grey PLACEHOLDER JPEG for blocks with coverage and 404 otherwise.

## Setup

```sh
cd backend
uv venv --python 3.11 .venv          # or: python3.11 -m venv .venv
source .venv/bin/activate
uv pip install -r requirements.txt   # or: pip install -r requirements.txt
cp ../.env.example ../.env           # keys are only needed from Phase 2
```

## Run

```sh
uvicorn main:app --reload --port 8000
curl "http://localhost:8000/api/routes?origin=Ferry+Building&destination=Civic+Center&datetime=2026-09-12T23:00:00"
```

## Test

```sh
pytest
```
