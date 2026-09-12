"""Offline data prep. Nothing here runs at request time.

    python scripts/fetch_data.py graph      # OSM walk graph   -> data/sf_walk.graphml
    python scripts/fetch_data.py osm        # OSM POIs + lamps -> data/sf_pois.json, data/osm_lamps.json
    python scripts/fetch_data.py mapillary  # Mapillary lamps  -> data/mapillary_lamps.json
    python scripts/fetch_data.py 311        # DataSF 311 streetlight cases -> data/311_streetlights.json
    python scripts/fetch_data.py all
"""

import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

import httpx
from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parent.parent
DATA = BACKEND / "data"
PLACE = "San Francisco, California, USA"
# lng_min, lat_min, lng_max, lat_max — SF mainland
SF_BBOX = (-122.52, 37.70, -122.35, 37.84)

load_dotenv(BACKEND.parent / ".env.local")
load_dotenv(BACKEND.parent / ".env")

EXTRA_WAY_TAGS = ["lit", "sidewalk", "sidewalk:both", "sidewalk:left", "sidewalk:right", "surface", "footway"]


def fetch_graph() -> None:
    import osmnx as ox

    ox.settings.useful_tags_way = list(ox.settings.useful_tags_way) + EXTRA_WAY_TAGS
    graph = ox.graph_from_place(PLACE, network_type="walk")
    ox.save_graphml(graph, DATA / "sf_walk.graphml")
    print(f"graph: {len(graph.nodes)} nodes, {len(graph.edges)} edges")


def fetch_osm() -> None:
    import osmnx as ox

    tags = {"amenity": True, "shop": True, "leisure": ["fitness_centre", "sports_centre"], "tourism": ["hotel", "hostel"]}
    pois = ox.features_from_place(PLACE, tags)
    out = []
    for _, row in pois.iterrows():
        point = row.geometry.centroid
        kind = next((f"{k}={row[k]}" for k in ("amenity", "shop", "leisure", "tourism") if k in row and isinstance(row[k], str)), None)
        hours = row.get("opening_hours")
        out.append({
            "lat": round(point.y, 6),
            "lng": round(point.x, 6),
            "kind": kind,
            "name": row["name"] if isinstance(row.get("name"), str) else None,
            "opening_hours": hours if isinstance(hours, str) else None,
        })
    (DATA / "sf_pois.json").write_text(json.dumps(out))
    print(f"pois: {len(out)} ({sum(p['opening_hours'] is not None for p in out)} with opening_hours)")

    lamps = ox.features_from_place(PLACE, {"highway": "street_lamp"})
    lamp_out = [{"lat": round(g.y, 6), "lng": round(g.x, 6)} for g in lamps.geometry if g.geom_type == "Point"]
    (DATA / "osm_lamps.json").write_text(json.dumps(lamp_out))
    print(f"osm lamps: {len(lamp_out)}")


def fetch_mapillary() -> None:
    token = os.environ["MAPILLARY_ACCESS_TOKEN"]
    step = 0.01
    lng_min, lat_min, lng_max, lat_max = SF_BBOX
    tiles = []
    lat = lat_min
    while lat < lat_max:
        lng = lng_min
        while lng < lng_max:
            tiles.append((lng, lat, lng + step, lat + step))
            lng += step
        lat += step

    def tile(bbox):
        r = httpx.get(
            "https://graph.mapillary.com/map_features",
            headers={"Authorization": f"OAuth {token}"},
            params={
                "fields": "id,geometry",
                "object_values": "object--street-light",
                "bbox": ",".join(f"{v:.5f}" for v in bbox),
                "limit": 2000,
            },
            timeout=60,
        )
        r.raise_for_status()
        return r.json().get("data", [])

    seen = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for features in pool.map(tile, tiles):
            for f in features:
                lng, lat = f["geometry"]["coordinates"]
                seen[f["id"]] = {"lat": round(lat, 6), "lng": round(lng, 6)}
    (DATA / "mapillary_lamps.json").write_text(json.dumps(list(seen.values())))
    print(f"mapillary lamps: {len(seen)} from {len(tiles)} tiles")


def fetch_311() -> None:
    since = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%dT00:00:00")
    r = httpx.get(
        "https://data.sf.gov/resource/vw6y-z8j6.json",
        params={
            "$select": "service_request_id,requested_datetime,closed_date,status_description,service_subtype,address,point",
            "$where": f"service_name='Streetlights' AND requested_datetime >= '{since}'",
            "$order": "requested_datetime DESC",
            "$limit": 50000,
        },
        timeout=120,
        follow_redirects=True,
    )
    r.raise_for_status()
    rows = [row for row in r.json() if "point" in row]
    (DATA / "311_streetlights.json").write_text(json.dumps(rows))
    print(f"311 streetlight cases since {since[:10]}: {len(rows)}")


STEPS = {"graph": fetch_graph, "osm": fetch_osm, "mapillary": fetch_mapillary, "311": fetch_311}

if __name__ == "__main__":
    DATA.mkdir(exist_ok=True)
    names = sys.argv[1:] or ["all"]
    for name in (list(STEPS) if names == ["all"] else names):
        STEPS[name]()
