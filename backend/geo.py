"""Street graph, geocoding, two candidate routes, block segmentation, waypoints.

Distances use a local equirectangular projection around SF (metres). Over the
~12km extent of the city the error is well under 1%.
"""

import json
import math
import re
import threading
from bisect import bisect_right
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path

import networkx as nx
import numpy as np
import osmnx as ox
from sklearn.neighbors import KDTree

DATA = Path(__file__).resolve().parent / "data"
GRAPH_PATH = DATA / "sf_walk.graphml"
GEOCODE_CACHE = DATA / "geocode_cache.json"

LAT0, LNG0 = 37.7749, -122.4194
M_PER_DEG_LAT = 111_132.0
M_PER_DEG_LNG = 111_320.0 * math.cos(math.radians(LAT0))
SF_BOUNDS = (37.70, -122.52, 37.84, -122.35)  # lat_min, lng_min, lat_max, lng_max

WAYPOINT_SPACING_M = 25
MAX_SNAP_M = 300
TURN_SPLIT_DEG = 40
BLOCK_MIN_M = 50  # shorter blocks (crosswalk jogs) are folded into the next one
BLOCK_MAX_M = 200  # Orbis drifts off the seed after ~25s; one block = one dwell
RENAME_SPLIT_M = 40
CORNER_SPLIT_M = 120
ROUTE_B_PENALTY = 3.0
ROUTE_B_BUFFER_M = 30
SEED_OFFSET_M = 12  # imagery is looked up this far into the block


class GeoError(ValueError):
    """User-facing input problem (bad place name, outside SF, no path)."""


def to_xy(lat: float, lng: float) -> tuple[float, float]:
    return (lng - LNG0) * M_PER_DEG_LNG, (lat - LAT0) * M_PER_DEG_LAT


def to_ll(x: float, y: float) -> tuple[float, float]:
    return LAT0 + y / M_PER_DEG_LAT, LNG0 + x / M_PER_DEG_LNG


def bearing(x0: float, y0: float, x1: float, y1: float) -> float:
    return math.degrees(math.atan2(x1 - x0, y1 - y0)) % 360


def angle_diff(a: float, b: float) -> float:
    d = abs(a - b) % 360
    return min(d, 360 - d)


STREET_SUFFIXES = {
    "st": "street", "ave": "avenue", "av": "avenue", "blvd": "boulevard", "dr": "drive", "rd": "road",
    "pl": "place", "ln": "lane", "ter": "terrace", "ct": "court", "hwy": "highway", "sq": "square", "aly": "alley",
}


def normalize_street(name: str) -> str:
    words = re.sub(r"[^a-z0-9 ]", " ", name.lower()).split()
    return " ".join(STREET_SUFFIXES.get(w, w) for w in words)


def first(value):
    return value[0] if isinstance(value, list) else value


@dataclass
class Span:
    """One graph edge as walked along the route, in route distance."""

    start: float
    end: float
    u: int
    v: int
    data: dict
    bearing_in: float
    bearing_out: float


@dataclass
class Block:
    block_id: str
    start: float
    end: float
    heading: float
    start_node: int
    spans: list[Span]


@dataclass
class Waypoint:
    index: int
    lat: float
    lng: float
    heading: float
    s: float
    block: Block
    span: Span


class RouteGeometry:
    def __init__(self, xy: np.ndarray, spans: list[Span]):
        self.xy = xy
        steps = np.hypot(*np.diff(xy, axis=0).T)
        self.cum = np.concatenate([[0.0], np.cumsum(steps)])
        self.length = float(self.cum[-1])
        self.spans = spans
        self.blocks: list[Block] = []
        self.waypoints: list[Waypoint] = []

    def point_at(self, s: float) -> tuple[float, float]:
        s = min(max(s, 0.0), self.length)
        j = int(np.clip(np.searchsorted(self.cum, s, side="right") - 1, 0, len(self.cum) - 2))
        seg = self.cum[j + 1] - self.cum[j]
        t = (s - self.cum[j]) / seg if seg > 0 else 0.0
        p = self.xy[j] + t * (self.xy[j + 1] - self.xy[j])
        return float(p[0]), float(p[1])

    def slice(self, s0: float, s1: float) -> np.ndarray:
        inner = self.xy[(self.cum > s0) & (self.cum < s1)]
        return np.vstack([self.point_at(s0), inner, self.point_at(s1)])

    def bearing_between(self, s0: float, s1: float) -> float:
        return bearing(*self.point_at(s0), *self.point_at(s1))


class StreetGraph:
    def __init__(self, path: Path = GRAPH_PATH):
        if not path.exists():
            raise FileNotFoundError(f"{path} missing — run `python scripts/fetch_data.py graph`")
        self.G = ox.load_graphml(path)
        self.node_ids = np.array(list(self.G.nodes))
        self.node_xy = np.array([to_xy(self.G.nodes[n]["y"], self.G.nodes[n]["x"]) for n in self.node_ids])
        self.node_tree = KDTree(self.node_xy)

        self.edge_uv = [(u, v) for u, v in self.G.edges(keys=False)]
        self.edge_mid_xy = np.array([(self.node_xy_of(u) + self.node_xy_of(v)) / 2 for u, v in self.edge_uv])

        self.street_nodes: dict[str, set[int]] = {}
        for u, v, data in self.G.edges(data=True):
            names = data.get("name")
            for name in names if isinstance(names, list) else [names]:
                if isinstance(name, str):
                    self.street_nodes.setdefault(normalize_street(name), set()).update((u, v))

        self._geocode_lock = threading.Lock()
        self._geocode_cache = json.loads(GEOCODE_CACHE.read_text()) if GEOCODE_CACHE.exists() else {}

    def node_xy_of(self, node: int) -> np.ndarray:
        return np.array(to_xy(self.G.nodes[node]["y"], self.G.nodes[node]["x"]))

    # --- geocoding -------------------------------------------------------

    def geocode(self, query: str) -> tuple[float, float]:
        match = re.fullmatch(r"\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*", query)
        if match:
            lat, lng = float(match[1]), float(match[2])
        elif (corner := self.intersection(query)) is not None:
            lat, lng = corner
        else:
            key = query.strip().lower()
            with self._geocode_lock:
                cached = self._geocode_cache.get(key)
            if cached is None:
                full = query if "san francisco" in key else f"{query}, San Francisco, CA"
                try:
                    cached = list(ox.geocode(full))  # Nominatim; cached to disk after the first hit
                except Exception as exc:
                    raise GeoError(f"Could not find {query!r} in San Francisco") from exc
                with self._geocode_lock:
                    self._geocode_cache[key] = cached
                    GEOCODE_CACHE.write_text(json.dumps(self._geocode_cache, indent=1))
            lat, lng = cached
        lat_min, lng_min, lat_max, lng_max = SF_BOUNDS
        if not (lat_min <= lat <= lat_max and lng_min <= lng <= lng_max):
            raise GeoError(f"{query!r} is outside San Francisco")
        return lat, lng

    def intersection(self, query: str) -> tuple[float, float] | None:
        """"Eddy St & Jones St" → where those streets meet, straight from the graph (Nominatim can't do corners)."""
        parts = re.split(r"\s*(?:&|\band\b|/|@)\s*", re.sub(r",\s*san francisco.*$", "", query, flags=re.I))
        if len(parts) != 2:
            return None
        a, b = (self.street_nodes.get(normalize_street(p)) for p in parts)
        if not a or not b:
            return None
        common = a & b
        if not common:
            # Divided streets and sidewalk graphs: nearest pair of nodes within 40m.
            nodes_b = list(b)
            tree = KDTree([self.node_xy_of(n) for n in nodes_b])
            nodes_a = list(a)
            dist, idx = tree.query([self.node_xy_of(n) for n in nodes_a], k=1)
            i = int(dist[:, 0].argmin())
            if dist[i, 0] > 40:
                return None
            common = {nodes_a[i]}
        xy = np.mean([self.node_xy_of(n) for n in common], axis=0)
        return to_ll(*xy)

    def nearest_node(self, lat: float, lng: float) -> int:
        dist, idx = self.node_tree.query([to_xy(lat, lng)], k=1)
        if dist[0][0] > MAX_SNAP_M:
            raise GeoError("No walkable street within 300m of that location")
        return int(self.node_ids[idx[0][0]])

    # --- routing ---------------------------------------------------------

    def two_routes(self, origin: int, destination: int) -> tuple[list[int], list[int]]:
        if origin == destination:
            raise GeoError("Origin and destination are the same place")
        try:
            route_a = nx.shortest_path(self.G, origin, destination, weight="length")
        except nx.NetworkXNoPath as exc:
            raise GeoError("No walking path between those locations") from exc

        # Penalize every edge within a buffer of route A — not just A's own
        # edges — or B just walks the opposite sidewalk of the same street.
        geom_a = self.route_geometry(route_a, with_waypoints=False)
        samples = np.array([geom_a.point_at(s) for s in np.arange(0, geom_a.length + 10, 10)])
        near = KDTree(samples).query_radius(self.edge_mid_xy, r=ROUTE_B_BUFFER_M, count_only=True) > 0
        penalized = {uv for uv, hit in zip(self.edge_uv, near) if hit}

        def weight(u, v, edges):
            length = min(e["length"] for e in edges.values())
            return length * ROUTE_B_PENALTY if (u, v) in penalized else length

        route_b = nx.shortest_path(self.G, origin, destination, weight=weight)
        return route_a, route_b

    def shortest_route(self, origin: int, destination: int) -> list[int]:
        """The one route the walk uses — route comparison was dropped before Checkpoint 3."""
        if origin == destination:
            raise GeoError("Origin and destination are the same place")
        try:
            return nx.shortest_path(self.G, origin, destination, weight="length")
        except nx.NetworkXNoPath as exc:
            raise GeoError("No walking path between those locations") from exc

    # --- geometry --------------------------------------------------------

    def edge_xy(self, u: int, v: int, data: dict) -> list[tuple[float, float]]:
        geom = data.get("geometry")
        if geom is None:
            coords = [(self.G.nodes[u]["x"], self.G.nodes[u]["y"]), (self.G.nodes[v]["x"], self.G.nodes[v]["y"])]
        else:
            coords = list(geom.coords)
            ux, uy = self.G.nodes[u]["x"], self.G.nodes[u]["y"]
            if (coords[0][0] - ux) ** 2 + (coords[0][1] - uy) ** 2 > (coords[-1][0] - ux) ** 2 + (coords[-1][1] - uy) ** 2:
                coords.reverse()
        return [to_xy(lat, lng) for lng, lat in coords]

    def route_geometry(self, nodes: list[int], with_waypoints: bool = True) -> RouteGeometry:
        points: list[tuple[float, float]] = []
        raw = []
        for u, v in pairwise(nodes):
            edges = self.G[u][v]
            data = edges[min(edges, key=lambda k: edges[k]["length"])]
            seg = self.edge_xy(u, v, data)
            start_idx = max(len(points) - 1, 0)
            points.extend(seg[1:] if points else seg)
            raw.append((start_idx, len(points) - 1, u, v, data))

        geom = RouteGeometry(np.array(points), [])
        for i0, i1, u, v, data in raw:
            s0, s1 = float(geom.cum[i0]), float(geom.cum[i1])
            geom.spans.append(Span(
                s0, s1, u, v, data,
                bearing_in=geom.bearing_between(s0, min(s0 + 10, s1)),
                bearing_out=geom.bearing_between(max(s1 - 10, s0), s1),
            ))
        if with_waypoints:
            geom.blocks = self._blocks(geom)
            geom.waypoints = self._waypoints(geom)
        return geom

    def _blocks(self, geom: RouteGeometry) -> list[Block]:
        spans = geom.spans
        groups = [[spans[0]]]
        for prev, span in pairwise(spans):
            current = groups[-1]
            length = span.start - current[0].start
            turned = angle_diff(prev.bearing_out, span.bearing_in) > TURN_SPLIT_DEG
            prev_name, name = first(prev.data.get("name")), first(span.data.get("name"))
            renamed = bool(prev_name and name and prev_name != name)
            corner = int(self.G.nodes[span.u].get("street_count", 0)) >= 3
            if (
                turned
                or length >= BLOCK_MAX_M
                or (renamed and length >= RENAME_SPLIT_M)
                or (corner and length >= CORNER_SPLIT_M)
            ):
                groups.append([span])
            else:
                current.append(span)

        merged: list[list[Span]] = []
        for group in groups:
            if merged and merged[-1][-1].end - merged[-1][0].start < BLOCK_MIN_M:
                merged[-1].extend(group)
            else:
                merged.append(list(group))
        if len(merged) > 1 and merged[-1][-1].end - merged[-1][0].start < BLOCK_MIN_M:
            merged[-2].extend(merged.pop())

        blocks = []
        for group in merged:
            # Blocks often open with a crosswalk jog; the longest edge is the street itself.
            # Its start node + heading is also what /api/imagery rebuilds the seed point from.
            longest = max(group, key=lambda sp: sp.end - sp.start)
            heading = geom.bearing_between(longest.start, longest.end)
            way = first(longest.data.get("osmid"))
            blocks.append(Block(
                f"w{way}-n{longest.u}", group[0].start, group[-1].end, round(heading) % 360, longest.u, group
            ))
        return blocks

    def _waypoints(self, geom: RouteGeometry) -> list[Waypoint]:
        stops = list(np.arange(0.0, geom.length, WAYPOINT_SPACING_M))
        if not stops or geom.length - stops[-1] > WAYPOINT_SPACING_M * 0.4:
            stops.append(geom.length)
        block_starts = [b.start for b in geom.blocks]
        span_starts = [sp.start for sp in geom.spans]

        waypoints = []
        heading = geom.blocks[0].heading
        for i, s in enumerate(stops):
            x, y = geom.point_at(s)
            if i + 1 < len(stops) and stops[i + 1] - s > 1:
                heading = geom.bearing_between(s, stops[i + 1])
            lat, lng = to_ll(x, y)
            block = geom.blocks[max(bisect_right(block_starts, s) - 1, 0)]
            span = geom.spans[max(bisect_right(span_starts, s) - 1, 0)]
            waypoints.append(Waypoint(i, round(lat, 6), round(lng, 6), round(heading, 1) % 360, float(s), block, span))
        return waypoints

    # --- imagery lookup point ---------------------------------------------

    def seed_point(self, node: int, heading: float) -> tuple[float, float]:
        x, y = self.node_xy_of(node)
        rad = math.radians(heading)
        return to_ll(x + SEED_OFFSET_M * math.sin(rad), y + SEED_OFFSET_M * math.cos(rad))


BLOCK_ID_RE = re.compile(r"^w\d+-n(?P<node>\d+)$")
