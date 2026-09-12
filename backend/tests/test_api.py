import json
from pathlib import Path

import jsonschema
from fastapi.testclient import TestClient

from main import app

SCHEMA = json.loads((Path(__file__).resolve().parents[2] / "shared" / "waypoint.schema.json").read_text())
client = TestClient(app)
PARAMS = {"origin": "Ferry Building", "destination": "Civic Center", "datetime": "2026-09-12T23:00:00"}


def test_routes_match_schema():
    r = client.get("/api/routes", params=PARAMS)
    assert r.status_code == 200
    body = r.json()
    jsonschema.validate(body, SCHEMA)
    assert [route["route_id"] for route in body["routes"]] == ["A", "B"]


def test_routes_rejects_bad_datetime():
    r = client.get("/api/routes", params={**PARAMS, "datetime": "tonight"})
    assert r.status_code == 422


def test_imagery_available_and_missing():
    waypoints = [wp for route in client.get("/api/routes", params=PARAMS).json()["routes"] for wp in route["waypoints"]]
    available = next(wp for wp in waypoints if wp["image_available"])
    missing = next(wp for wp in waypoints if not wp["image_available"])

    r = client.get(available["image_url"])
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"

    assert client.get(f"/api/imagery/{missing['block_id']}/{round(missing['heading'])}").status_code == 404


def test_cors_allows_frontend():
    r = client.get("/api/routes", params=PARAMS, headers={"Origin": "http://localhost:3000"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"
