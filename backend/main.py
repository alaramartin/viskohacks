"""WALK HOME backend.

GET /api/routes    — two candidate walking routes from the cached SF graph,
                     sampled into waypoints with a condition model per waypoint.
GET /api/imagery   — 16:9 seed frame for a block at a heading (Mapillary),
                     404 without coverage.

Response shape follows shared/waypoint.schema.json.
"""

import logging
import os
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime
from functools import cache
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / ".env.local")
load_dotenv(REPO_ROOT / ".env")

from conditions import SF_TZ, ConditionModel, compose_prompt  # noqa: E402
from geo import BLOCK_ID_RE, DATA, GeoError, StreetGraph  # noqa: E402
from imagery import Imagery  # noqa: E402

logging.basicConfig(level=logging.INFO)


@cache
def services() -> tuple[StreetGraph, ConditionModel, Imagery]:
    graph = StreetGraph()
    return graph, ConditionModel(graph), Imagery(DATA / "imagery")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    services()  # load the graph and data files before the first request
    yield


app = FastAPI(title="WALK HOME backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["GET"],
    allow_headers=["*"],
)

pool = ThreadPoolExecutor(max_workers=8)
# Separate so a request's coverage lookups never queue behind another request's pano downloads.
prewarm_pool = ThreadPoolExecutor(max_workers=4)


@app.get("/api/routes")
def get_routes(
    origin: str = Query(..., min_length=1),
    destination: str = Query(..., min_length=1),
    datetime_: str = Query(..., alias="datetime"),
) -> dict:
    try:
        when = datetime.fromisoformat(datetime_)
    except ValueError:
        raise HTTPException(status_code=422, detail="datetime must be ISO 8601")
    # Naive datetimes are San Francisco local time.
    local = when.replace(tzinfo=SF_TZ) if when.tzinfo is None else when.astimezone(SF_TZ)

    graph, model, imagery = services()
    try:
        start = graph.nearest_node(*graph.geocode(origin))
        end = graph.nearest_node(*graph.geocode(destination))
        node_routes = graph.two_routes(start, end)
    except GeoError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    geoms = [graph.route_geometry(nodes) for nodes in node_routes]
    sun = model.sun_state(local)
    weather = model.weather(local)

    blocks = {b.block_id: b for g in geoms for b in g.blocks}
    coverage = dict(zip(blocks, pool.map(
        lambda b: imagery.coverage(*graph.seed_point(b.start_node, b.heading), b.heading),
        blocks.values(),
    )))

    # Warm the frame cache so the first /api/imagery hit per block isn't a pano download.
    for b in blocks.values():
        if coverage[b.block_id] is not None:
            prewarm_pool.submit(imagery.frame, f"{b.block_id}_{b.heading}", *graph.seed_point(b.start_node, b.heading), b.heading)

    routes = []
    for route_id, geom in zip("AB", geoms):
        lighting = {b.block_id: model.block_lighting(geom, b, local) for b in geom.blocks}
        waypoints = []
        held_scene = None
        streets = {b.block_id: model.block_street(geom, b) for b in geom.blocks}
        for wp in geom.waypoints:
            available = coverage[wp.block.block_id] is not None
            motion, motion_kind = model.motion_cue(geom, wp)
            condition = model.waypoint_condition(
                wp, lighting[wp.block.block_id], sun, weather, local,
                motion=motion, imagery=coverage[wp.block.block_id], block_street=streets[wp.block.block_id],
            )
            scene = condition.pop("scene")
            if motion_kind in ("approach", "turn") and held_scene:
                # Keep describing the street being left until the turn is done: a new
                # street's scene stacked on a turn cue made Orbis stop and re-imagine.
                condition["video_prompt"] = compose_prompt(motion, held_scene)
            else:
                held_scene = scene
            waypoints.append({
                "index": wp.index,
                "lat": wp.lat,
                "lng": wp.lng,
                "heading": wp.heading,
                "block_id": wp.block.block_id,
                "image_url": f"/api/imagery/{wp.block.block_id}/{wp.block.heading}" if available else None,
                "image_available": available,
                "condition": condition,
            })
        routes.append({"route_id": route_id, "waypoints": waypoints})
    return {"routes": routes}


@app.get("/api/imagery/{block_id}/{heading}")
def get_imagery(block_id: str, heading: int) -> Response:
    match = BLOCK_ID_RE.match(block_id)
    if not match or not 0 <= heading < 360:
        raise HTTPException(status_code=404, detail="Unknown block")
    graph, _, imagery = services()
    node = int(match["node"])
    if node not in graph.G.nodes:
        raise HTTPException(status_code=404, detail="Unknown block")
    frame = imagery.frame(f"{block_id}_{heading}", *graph.seed_point(node, heading), heading)
    if frame is None:
        raise HTTPException(status_code=404, detail="No imagery coverage")
    return Response(content=frame, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})
