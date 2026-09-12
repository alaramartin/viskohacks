"""WALK HOME backend.

Phase 1: serves shared/fixture-routes.json verbatim. Phase 2 replaces the
fixture with the real geo pipeline while keeping the response shape identical.
"""

import io
import json
import os
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_PATH = REPO_ROOT / "shared" / "fixture-routes.json"

load_dotenv(REPO_ROOT / ".env.local")
load_dotenv(REPO_ROOT / ".env")

app = FastAPI(title="WALK HOME backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["GET"],
    allow_headers=["*"],
)


def load_fixture() -> dict:
    with FIXTURE_PATH.open() as f:
        return json.load(f)


@app.get("/api/routes")
def get_routes(
    origin: str = Query(..., min_length=1),
    destination: str = Query(..., min_length=1),
    datetime_: str = Query(..., alias="datetime"),
) -> dict:
    try:
        datetime.fromisoformat(datetime_)
    except ValueError:
        raise HTTPException(status_code=422, detail="datetime must be ISO 8601")
    # FIXTURE: origin/destination/datetime are ignored until Phase 2.
    return load_fixture()


def placeholder_jpeg(block_id: str, heading: str) -> bytes:
    # FIXTURE: labeled grey placeholder until Phase 2 fetches real imagery.
    img = Image.new("RGB", (1280, 720), (90, 90, 90))
    ImageDraw.Draw(img).text((40, 40), f"PLACEHOLDER IMAGERY  block={block_id}  heading={heading}", fill=(230, 230, 230))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


@app.get("/api/imagery/{block_id}/{heading}")
def get_imagery(block_id: str, heading: str) -> Response:
    covered = {
        wp["block_id"]
        for route in load_fixture()["routes"]
        for wp in route["waypoints"]
        if wp["image_available"]
    }
    if block_id not in covered:
        raise HTTPException(status_code=404, detail="No imagery coverage")
    return Response(content=placeholder_jpeg(block_id, heading), media_type="image/jpeg")
