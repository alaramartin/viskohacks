"""End-to-end against the real pipeline. Needs the cached files in backend/data/
and network for Mapillary + Open-Meteo. Uses intersections, which resolve
offline from the graph (no Nominatim)."""

import json
from pathlib import Path

import jsonschema
import pytest
from fastapi.testclient import TestClient

from main import app

SCHEMA = json.loads((Path(__file__).resolve().parents[2] / "shared" / "waypoint.schema.json").read_text())
PARAMS = {"origin": "Eddy St & Jones St", "destination": "Golden Gate Ave & Hyde St", "datetime": "2026-09-12T23:00:00"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def routes(client):
    r = client.get("/api/routes", params=PARAMS)
    assert r.status_code == 200, r.text
    return r.json()


def test_routes_match_schema(routes):
    jsonschema.validate(routes, SCHEMA)
    assert [route["route_id"] for route in routes["routes"]] == ["A", "B"]


def test_waypoints_are_spaced_and_grouped_into_blocks(routes):
    for route in routes["routes"]:
        waypoints = route["waypoints"]
        assert len(waypoints) >= 10
        assert [wp["index"] for wp in waypoints] == list(range(len(waypoints)))
        block_runs = [wp["block_id"] for i, wp in enumerate(waypoints) if i == 0 or waypoints[i - 1]["block_id"] != wp["block_id"]]
        assert len(block_runs) == len(set(block_runs)), "a block_id must be one consecutive run"
        assert 2 <= len(block_runs) < len(waypoints)


def test_routes_differ(routes):
    a, b = ([wp["block_id"] for wp in r["waypoints"]] for r in routes["routes"])
    assert set(a) != set(b)


def test_night_facts(routes):
    facts = {f["label"]: f["value"] for f in routes["routes"][0]["waypoints"][0]["condition"]["facts"]}
    assert facts["Dark since"].endswith("pm")
    assert "night" in routes["routes"][0]["waypoints"][0]["condition"]["video_prompt"]


def test_prompts_carry_motion_and_imagery_fact(routes):
    waypoints = routes["routes"][0]["waypoints"]
    assert waypoints[0]["condition"]["video_prompt"].startswith("first-person view at eye level, starting to walk")
    assert "coming to a stop" in waypoints[-1]["condition"]["video_prompt"]
    assert any("turning" in wp["condition"]["video_prompt"] for wp in waypoints)
    for wp in waypoints:
        assert any(f["label"] == "Street imagery" for f in wp["condition"]["facts"])


def test_lighting_is_consistent(routes):
    for route in routes["routes"]:
        for wp in route["waypoints"]:
            light = wp["condition"]["lighting"]
            assert len(light["lamp_offsets_m"]) == len(light["lamp_lateral_m"])
            assert light["lamp_offsets_m"] == sorted(light["lamp_offsets_m"])
            assert len(light["lamp_offsets_m"]) <= light["lamp_count"]
            assert (light["side"] == "none") == (light["lamp_count"] == 0)


def test_routes_rejects_bad_input(client):
    assert client.get("/api/routes", params={**PARAMS, "datetime": "tonight"}).status_code == 422
    assert client.get("/api/routes", params={**PARAMS, "origin": "40.7128,-74.0060"}).status_code == 422


def test_imagery(client, routes):
    waypoints = [wp for route in routes["routes"] for wp in route["waypoints"]]
    available = next(wp for wp in waypoints if wp["image_available"])
    r = client.get(available["image_url"])
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    assert client.get("/api/imagery/not-a-block/90").status_code == 404
    assert client.get("/api/imagery/w1-n1/90").status_code == 404


def test_cors_allows_frontend(client):
    r = client.get("/api/imagery/not-a-block/90", headers={"Origin": "http://localhost:3000"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"
