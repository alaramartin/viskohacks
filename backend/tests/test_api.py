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
    assert [route["route_id"] for route in routes["routes"]] == ["A"]  # one route; comparison dropped


def test_waypoints_are_spaced_and_grouped_into_blocks(routes):
    for route in routes["routes"]:
        waypoints = route["waypoints"]
        assert len(waypoints) >= 10
        assert [wp["index"] for wp in waypoints] == list(range(len(waypoints)))
        block_runs = [wp["block_id"] for i, wp in enumerate(waypoints) if i == 0 or waypoints[i - 1]["block_id"] != wp["block_id"]]
        assert len(block_runs) == len(set(block_runs)), "a block_id must be one consecutive run"
        assert 2 <= len(block_runs) < len(waypoints)


def geometry(route):
    return [(wp["index"], wp["block_id"], wp["image_url"], wp["lat"], wp["lng"]) for wp in route["waypoints"]]


def test_new_conditions_keep_the_geometry(client, routes):
    """Real-time controls swap in the same route for a new time or override; only `condition` may change."""
    base = routes["routes"][0]
    for extra in ({"datetime": "2026-09-12T19:40:00"}, {"fog": "true"}, {"crowd": "true"}):
        other = client.get("/api/routes", params={**PARAMS, **extra}).json()["routes"][0]
        assert geometry(other) == geometry(base), extra


def test_ambient_darkness_tracks_the_clock(client, routes):
    night = routes["routes"][0]["waypoints"][0]["condition"]["ambient"]
    assert night["phase"] == "night" and night["darkness"] == 1
    early = client.get("/api/routes", params={**PARAMS, "datetime": "2026-09-12T18:00:00"}).json()
    day = early["routes"][0]["waypoints"][0]["condition"]["ambient"]
    assert day["phase"] == "day" and day["darkness"] == 0 and day["sun_altitude_deg"] > 0
    dusk = client.get("/api/routes", params={**PARAMS, "datetime": "2026-09-12T19:50:00"}).json()
    assert 0 < dusk["routes"][0]["waypoints"][0]["condition"]["ambient"]["darkness"] < 1


def test_fog_and_crowd_overrides_are_labelled(client, routes):
    plain = routes["routes"][0]["waypoints"][0]["condition"]
    forced = client.get("/api/routes", params={**PARAMS, "fog": "true", "crowd": "true"}).json()
    forced = forced["routes"][0]["waypoints"][0]["condition"]
    facts = {f["label"]: f["value"] for f in forced["facts"]}
    plain_facts = {f["label"]: f["value"] for f in plain["facts"]}
    assert "set by you" in facts["Weather"] and facts["Foot traffic"].endswith("(set by you)")
    assert "fog" in forced["video_prompt"] and "people walking" in forced["video_prompt"]
    assert "Foot traffic" not in plain_facts
    assert facts["Open businesses"] == plain_facts["Open businesses"], "an override never rewrites a data fact"


def test_night_facts(routes):
    facts = {f["label"]: f["value"] for f in routes["routes"][0]["waypoints"][0]["condition"]["facts"]}
    assert facts["Dark since"].endswith("pm")
    assert "night" in routes["routes"][0]["waypoints"][0]["condition"]["video_prompt"]


def test_shot_list_is_a_steady_script(routes):
    route = routes["routes"][0]
    shots, waypoints = route["shots"], route["waypoints"]
    kinds = [s["kind"] for s in shots]
    assert kinds[0] == "walk" and kinds[-1] == "arrive"
    assert "turn" in kinds  # the Tenderloin test route turns at corners
    for before, after in zip(kinds, kinds[1:]):
        assert before != "turn" or after == "walk", "a turn is always followed by a straight leg"

    walks = [s for s in shots if s["kind"] == "walk"]
    covered = [i for s in walks for i in range(s["waypoint_start"], s["waypoint_end"] + 1)]
    assert covered == list(range(len(waypoints))), "walk shots partition the waypoints in order"
    assert len(shots) <= len(waypoints) // 2, "far fewer prompt changes than waypoints"

    for s in walks:
        assert "walking straight ahead" in s["video_prompt"] and "vanishing point" in s["video_prompt"]
        assert 6_000 <= s["duration_ms"] <= 20_000
        for i in range(s["waypoint_start"], s["waypoint_end"] + 1):
            assert waypoints[i]["condition"]["video_prompt"] == s["video_prompt"]
    assert all("turning" in s["video_prompt"] for s in shots if s["kind"] == "turn")
    assert not any("panning" in s["video_prompt"] for s in shots)
    for wp in waypoints:
        assert any(f["label"] == "Street imagery" for f in wp["condition"]["facts"])


def test_shot_structure_is_stable_across_times(client, routes):
    """Real-time conditions swap in the same route at a new time; the script's shape must not move."""
    late = routes["routes"][0]["shots"]
    early = client.get("/api/routes", params={**PARAMS, "datetime": "2026-09-12T19:00:00"}).json()["routes"][0]["shots"]
    assert [(s["kind"], s["waypoint_start"], s["waypoint_end"]) for s in early] == [
        (s["kind"], s["waypoint_start"], s["waypoint_end"]) for s in late
    ]


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
