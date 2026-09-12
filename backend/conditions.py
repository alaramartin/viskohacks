"""Condition model per waypoint: darkness, weather, OSM street tags, nearby
businesses, mapped streetlights, and 311 outage reports.

Every input except Open-Meteo weather is a cached file in backend/data/
(see scripts/fetch_data.py). Nothing here scores or rates a route — it only
states what the data says.
"""

import json
import logging
import threading
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import numpy as np
from astral import LocationInfo
from astral.sun import sun as astral_sun
from sklearn.neighbors import KDTree

from geo import DATA, LAT0, LNG0, Block, RouteGeometry, StreetGraph, Waypoint, angle_diff, bearing, first, to_xy
from hours import is_open

log = logging.getLogger("conditions")

SF_TZ = ZoneInfo("America/Los_Angeles")
SF_OBSERVER = LocationInfo("San Francisco", "USA", "America/Los_Angeles", LAT0, LNG0).observer

POI_RADIUS_M = 50
LAMP_LATERAL_M = 25  # from the walked sidewalk: reaches the far curb of a wide street, not the next street over
LAMP_DEDUPE_M = 6  # an OSM lamp this close to a Mapillary one is the same lamp
LAMP_CLUSTER_M = 8  # SF lamps are ~25-35m apart along a block; closer detections are duplicates
OUTAGE_RADIUS_M = 30
OUTAGE_WINDOW_DAYS = 90
STREET_SEARCH_M = 40  # mapped sidewalks can sit 25m+ from a wide street's centreline
STREET_PARALLEL_DEG = 30
STREET_HALF_WIDTH_M = 20  # curb lamps sit within this of the centreline even on Market St
WEATHER_TTL_S = 3600
MOTION_LOOKAHEAD_M = 30  # cue a turn or crossing this far before it happens
TURN_CUE_DEG = 35

STREET_TYPES = {
    "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service",
    "trunk_link", "primary_link", "secondary_link", "tertiary_link",
}
# Street furniture and infrastructure — present regardless of whether anyone is around.
NOT_FOOTFALL = {
    "bench", "waste_basket", "bicycle_parking", "parking", "parking_space", "parking_entrance", "post_box",
    "vending_machine", "drinking_water", "charging_station", "recycling", "telephone", "toilets", "fountain",
    "clock", "motorcycle_parking", "shelter", "bicycle_rental", "car_sharing", "grit_bin", "waste_disposal",
    "loading_dock", "parcel_locker", "bicycle_repair_station", "atm", "public_bookcase", "dog_toilet",
    "compressed_air", "letter_box", "ticket_validator", "street_lamp", "water_point", "trolley_bay",
}
LANES_WORDS = {1: "one lane", 2: "two lanes", 3: "three lanes", 4: "four lanes", 5: "five lanes", 6: "six lanes"}
WEATHER_WORDS = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
    80: "Rain showers", 81: "Rain showers", 82: "Heavy showers", 95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm",
}


def clock(dt: datetime) -> str:
    hour = dt.hour % 12 or 12
    suffix = "am" if dt.hour < 12 else "pm"
    return f"{hour}{suffix}" if dt.minute == 0 else f"{hour}:{dt.minute:02d}{suffix}"


def _load(name: str, step: str):
    path = DATA / name
    if not path.exists():
        raise FileNotFoundError(f"{path} missing — run `python scripts/fetch_data.py {step}`")
    return json.loads(path.read_text())


def _cluster(points: list[tuple[float, float]], radius: float) -> list[tuple[float, float]]:
    """Mapillary often maps one lamp several times from different sequences; merge detections within radius."""
    xy = np.array(points)
    tree = KDTree(xy)
    taken = np.zeros(len(xy), dtype=bool)
    out = []
    for i in range(len(xy)):
        if taken[i]:
            continue
        group = [j for j in tree.query_radius(xy[i : i + 1], r=radius)[0] if not taken[j]]
        taken[group] = True
        cx, cy = xy[group].mean(axis=0)
        out.append((float(cx), float(cy)))
    return out


def _perpendicular(points: np.ndarray, line: np.ndarray) -> np.ndarray:
    """Signed distance (left +) from the infinite line through each point's nearest segment.
    Unclamped, so a lamp just past the end of a short street edge still gets its curb offset."""
    a, b = line[:-1], line[1:]
    ab = b - a
    seg_len = np.maximum(np.hypot(ab[:, 0], ab[:, 1]), 1e-9)
    ap = points[:, None, :] - a[None, :, :]
    t = np.clip((ap * ab[None]).sum(-1) / seg_len[None] ** 2, 0, 1)
    dist = np.hypot(*(ap - t[..., None] * ab[None]).transpose(2, 0, 1))
    j = dist.argmin(axis=1)
    rows = np.arange(len(points))
    return (ab[j, 0] * ap[rows, j, 1] - ab[j, 1] * ap[rows, j, 0]) / seg_len[j]


def _project(points: np.ndarray, line: np.ndarray, line_start: float) -> tuple[np.ndarray, np.ndarray]:
    """Distance along `line` (offset by line_start) and signed lateral distance (left +) per point."""
    a, b = line[:-1], line[1:]
    ab = b - a
    seg_len = np.hypot(ab[:, 0], ab[:, 1])
    l2 = np.maximum(seg_len**2, 1e-9)
    ap = points[:, None, :] - a[None, :, :]
    t = np.clip((ap * ab[None]).sum(-1) / l2[None], 0, 1)
    closest = a[None] + t[..., None] * ab[None]
    dist = np.hypot(*(points[:, None, :] - closest).transpose(2, 0, 1))
    j = dist.argmin(axis=1)
    rows = np.arange(len(points))
    cum = np.concatenate([[0.0], np.cumsum(seg_len)])
    along = line_start + cum[j] + t[rows, j] * seg_len[j]
    cross = ab[j, 0] * ap[rows, j, 1] - ab[j, 1] * ap[rows, j, 0]
    return along, np.sign(cross) * dist[rows, j]


class ConditionModel:
    def __init__(self, graph: StreetGraph):
        self.graph = graph

        pois = _load("sf_pois.json", "osm")
        self.pois = [p for p in pois if p["kind"] and p["kind"].split("=", 1)[1] not in NOT_FOOTFALL]
        self.poi_tree = KDTree([to_xy(p["lat"], p["lng"]) for p in self.pois])

        lamps = _cluster([to_xy(p["lat"], p["lng"]) for p in _load("mapillary_lamps.json", "mapillary")], LAMP_CLUSTER_M)
        mly_tree = KDTree(lamps)
        for p in _load("osm_lamps.json", "osm"):
            xy = to_xy(p["lat"], p["lng"])
            if mly_tree.query_radius([xy], r=LAMP_DEDUPE_M, count_only=True)[0] == 0:
                lamps.append(xy)
        self.lamp_xy = np.array(lamps)
        self.lamp_tree = KDTree(self.lamp_xy)

        cases = [
            c for c in _load("311_streetlights.json", "311")
            if c.get("service_subtype") == "light" and "point" in c
        ]
        self.outage_xy = np.array([to_xy(float(c["point"]["latitude"]), float(c["point"]["longitude"])) for c in cases])
        self.outage_time = np.array([np.datetime64(c["requested_datetime"][:19]) for c in cases])
        self.outage_tree = KDTree(self.outage_xy)
        self.outage_data_end = self.outage_time.max().astype(datetime)

        self._build_street_index()
        self._weather: dict[str, tuple[float, dict | None]] = {}
        self._weather_lock = threading.Lock()

    def _build_street_index(self) -> None:
        points, owners, self.street_edges, self.street_uv = [], [], [], []
        for u, v, data in self.graph.G.edges(data=True):
            if u > v or first(data.get("highway")) not in STREET_TYPES:
                continue
            self.street_uv.append((u, v))
            xy = np.array(self.graph.edge_xy(u, v, data))
            steps = np.hypot(*np.diff(xy, axis=0).T)
            cum = np.concatenate([[0.0], np.cumsum(steps)])
            for s in np.arange(0, cum[-1] + 1e-6, 10):
                j = min(np.searchsorted(cum, s, side="right") - 1, len(xy) - 2)
                t = (s - cum[j]) / steps[j] if steps[j] > 0 else 0
                points.append(xy[j] + t * (xy[j + 1] - xy[j]))
                owners.append(len(self.street_edges))
            self.street_edges.append(data)
        self.street_owner = np.array(owners)
        self.street_tree = KDTree(np.array(points))

    # --- global conditions -----------------------------------------------

    def sun_state(self, local: datetime) -> dict:
        today = astral_sun(SF_OBSERVER, date=local.date(), tzinfo=SF_TZ)
        if local >= today["dusk"]:
            return {"dark": True, "dark_since": today["dusk"], "phase": "night"}
        if local < today["dawn"]:
            yesterday = astral_sun(SF_OBSERVER, date=local.date() - timedelta(days=1), tzinfo=SF_TZ)
            return {"dark": True, "dark_since": yesterday["dusk"], "phase": "night"}
        if local >= today["sunset"]:
            phase = "dusk"
        elif local < today["sunrise"]:
            phase = "dawn"
        else:
            phase = "day"
        return {"dark": False, "dusk": today["dusk"], "phase": phase}

    def weather(self, local: datetime) -> dict | None:
        day = local.date()
        with self._weather_lock:
            cached = self._weather.get(day.isoformat())
        if cached and time.time() - cached[0] < WEATHER_TTL_S:
            hourly = cached[1]
        else:
            today = datetime.now(SF_TZ).date()
            in_forecast = today - timedelta(days=90) <= day <= today + timedelta(days=15)
            url = "https://api.open-meteo.com/v1/forecast" if in_forecast else "https://archive-api.open-meteo.com/v1/archive"
            params = {
                "latitude": LAT0, "longitude": LNG0, "timezone": "America/Los_Angeles",
                "hourly": "temperature_2m,precipitation,weather_code,visibility,wind_speed_10m",
                "start_date": day.isoformat(), "end_date": day.isoformat(),
            }
            try:
                r = httpx.get(url, params=params, timeout=10)
                r.raise_for_status()
                hourly = r.json()["hourly"]
            except (httpx.HTTPError, KeyError, ValueError) as exc:
                log.warning("Open-Meteo unavailable for %s: %s", day, exc)
                hourly = None
            with self._weather_lock:
                self._weather[day.isoformat()] = (time.time(), hourly)
        if not hourly:
            return None
        try:
            i = hourly["time"].index(local.strftime("%Y-%m-%dT%H:00"))
        except ValueError:
            return None
        values = {k: v[i] for k, v in hourly.items() if k != "time"}
        return values if values.get("weather_code") is not None else None

    # --- per block -------------------------------------------------------

    def block_lighting(self, geom: RouteGeometry, block: Block, local: datetime) -> dict:
        line = geom.slice(block.start, block.end)
        centre = line.mean(axis=0)
        reach = np.hypot(*(line - centre).T).max() + LAMP_LATERAL_M

        street_i, street_line = self._street_alongside(geom, block, line)
        lamps = []
        idx = self.lamp_tree.query_radius([centre], r=reach)[0]
        if len(idx):
            points = self.lamp_xy[idx]
            along, walk_dist = _project(points, line, block.start)
            walk_perp = _perpendicular(points, line)
            # Clamped distance well above the perpendicular one means the lamp is past an
            # end of the block — at the intersection or up the cross street.
            inside = (np.abs(walk_dist) <= LAMP_LATERAL_M) & (np.abs(walk_dist) - np.abs(walk_perp) < 2)
            if street_line is not None:
                # Side is relative to the street's centreline, not the walked sidewalk:
                # lamps at both curbs are on the same side of someone on the sidewalk.
                lateral = _perpendicular(points, street_line)
                inside &= np.abs(lateral) <= STREET_HALF_WIDTH_M
            else:
                lateral = walk_perp
            # (metres along the route, metres right of the centreline — left is negative)
            lamps = sorted(zip(along[inside].tolist(), (-lateral[inside]).tolist()))

        window_end = min(local.replace(tzinfo=None), self.outage_data_end)
        window_start = window_end - timedelta(days=OUTAGE_WINDOW_DAYS)
        outages = 0
        idx = self.outage_tree.query_radius([centre], r=reach - LAMP_LATERAL_M + OUTAGE_RADIUS_M)[0]
        if len(idx):
            _, lateral = _project(self.outage_xy[idx], line, block.start)
            times = self.outage_time[idx]
            outages = int(((np.abs(lateral) <= OUTAGE_RADIUS_M)
                           & (times >= np.datetime64(window_start)) & (times <= np.datetime64(window_end))).sum())

        tags = [first(sp.data.get("lit")) for sp in block.spans]
        if street_i is not None:
            tags.append(first(self.street_edges[street_i].get("lit")))
        yes = sum(t in ("yes", "24/7", "automatic") for t in tags)
        no = sum(t == "no" for t in tags)
        lit = "yes" if yes and yes >= no else "no" if no else "unknown"

        sides = {right >= 0 for _, right in lamps}
        return {
            "lit": lit,
            "lamps": lamps,
            "side": "none" if not lamps else "both" if len(sides) > 1 else "one",
            "outages": outages,
            "window_end": window_end,
        }

    def _street_alongside(self, geom: RouteGeometry, block: Block, line: np.ndarray) -> tuple[int | None, np.ndarray | None]:
        """The street the block runs beside: nearest street edge within reach that is roughly
        parallel to the block (the nearest one outright is often the cross street). Its
        polyline is oriented along the walking direction."""
        mid = geom.point_at((block.start + block.end) / 2)
        idx = self.street_tree.query_radius([mid], r=STREET_SEARCH_M, return_distance=True, sort_results=True)[0][0]
        fallback = None
        for i in dict.fromkeys(int(self.street_owner[j]) for j in idx):
            u, v = self.street_uv[i]
            street_line = np.array(self.graph.edge_xy(u, v, self.street_edges[i]))
            if angle_diff(bearing(*street_line[0], *street_line[-1]) % 180, block.heading % 180) > STREET_PARALLEL_DEG:
                continue
            if np.dot(street_line[-1] - street_line[0], line[-1] - line[0]) < 0:
                street_line = street_line[::-1]
            if first(self.street_edges[i].get("highway")) != "service":
                return i, street_line
            fallback = fallback or (i, street_line)
        return fallback or (None, None)

    def _nearest_street_idx(self, x: float, y: float) -> int | None:
        idx, _ = self.street_tree.query_radius([(x, y)], r=STREET_SEARCH_M, return_distance=True, sort_results=True)
        candidates = [int(self.street_owner[i]) for i in idx[0]]
        named = [e for e in candidates if first(self.street_edges[e].get("highway")) != "service"]
        return (named or candidates or [None])[0]

    def nearest_street(self, x: float, y: float) -> dict | None:
        i = self._nearest_street_idx(x, y)
        return None if i is None else self.street_edges[i]

    # --- per waypoint ----------------------------------------------------

    # --- motion (continuous walk) -------------------------------------------

    def motion_cue(self, geom: RouteGeometry, wp: Waypoint) -> str:
        """What the walker is doing here, from route geometry. The walk is one continuous
        Orbis generation steered by prompt morphs (no cuts), so turns and crossings
        have to be spelled out in `video_prompt` ahead of time."""
        if wp.index == 0:
            return f"starting to walk forward along the sidewalk{self._street_name(geom, wp.block, ' on')}"
        if wp.index == len(geom.waypoints) - 1:
            return "slowing down and coming to a stop at the destination"

        ahead = wp.s + MOTION_LOOKAHEAD_M
        crossing = any(
            first(span.data.get("footway")) == "crossing" and span.end > wp.s and wp.s - 5 <= span.start <= ahead
            for span in geom.spans
        )

        # At a corner you usually cross *and* turn, so check the turn first and fold the
        # crossing into the same cue rather than letting it hide the turn.
        blocks = geom.blocks
        i = blocks.index(wp.block)
        if i + 1 < len(blocks) and blocks[i + 1].start - wp.s <= MOTION_LOOKAHEAD_M:
            nxt = blocks[i + 1]
            turn = (nxt.heading - wp.block.heading + 540) % 360 - 180  # + is clockwise, i.e. right
            onto = self._street_name(geom, nxt, " onto")
            cross = "crossing the street at the crosswalk, then " if crossing else "approaching the corner and "
            if turn > TURN_CUE_DEG:
                return f"{cross}turning right{onto}"
            if turn < -TURN_CUE_DEG:
                return f"{cross}turning left{onto}"
            return "crossing the street at the crosswalk and continuing straight ahead" if crossing else (
                "continuing straight ahead across the intersection"
            )
        if crossing:
            return "stepping off the curb and crossing the street at the crosswalk"
        return f"walking forward along the sidewalk{self._street_name(geom, wp.block, ' on')}"

    def _street_name(self, geom: RouteGeometry, block: Block, prefix: str) -> str:
        name = next((first(sp.data.get("name")) for sp in block.spans if first(sp.data.get("name"))), None)
        if not name:
            # Mapped sidewalks carry no name; use the street the block runs beside
            # (the nearest street outright is often the cross street).
            street_i, _ = self._street_alongside(geom, block, geom.slice(block.start, block.end))
            name = first(self.street_edges[street_i].get("name")) if street_i is not None else None
        return f"{prefix} {name}" if isinstance(name, str) else ""

    def waypoint_condition(
        self,
        wp: Waypoint,
        light: dict,
        sun: dict,
        weather: dict | None,
        local: datetime,
        motion: str = "",
        imagery: dict | None = None,
    ) -> dict:
        x, y = to_xy(wp.lat, wp.lng)
        own = wp.span.data
        own_type, footway = first(own.get("highway")), first(own.get("footway"))
        street = own if own_type in STREET_TYPES else self.nearest_street(x, y)

        nearby = [self.pois[i] for i in self.poi_tree.query_radius([(x, y)], r=POI_RADIUS_M)[0]]
        states = [is_open(p["opening_hours"], local) for p in nearby]
        open_now = sum(s is True for s in states)
        unknown = sum(s is None for s in states)

        ahead = [(s, right) for s, right in light["lamps"] if wp.s <= s <= wp.block.end]
        lighting = {
            "lit": light["lit"],
            "lamp_count": len(light["lamps"]),
            "side": light["side"],
            "lamp_offsets_m": [round(s - wp.s) for s, _ in ahead],
            "lamp_lateral_m": [round(right, 1) for _, right in ahead],
            "outages": light["outages"],
        }

        facts = [
            {"label": "Dark since", "value": clock(sun["dark_since"]) if sun["dark"] else f"Not yet (dark at {clock(sun['dusk'])})"},
            {"label": "Streetlights", "value": self._lamp_fact(lighting)},
            {"label": "Lit tag (OSM)", "value": {"yes": "Tagged lit", "no": "Tagged unlit"}.get(light["lit"], "Not tagged")},
            {"label": "Reported outages", "value": self._outage_fact(light)},
            {"label": "Open businesses", "value": self._business_fact(len(nearby), open_now, unknown, local)},
            {"label": "Sidewalk", "value": self._sidewalk_fact(own_type, footway, street)},
            {"label": "Road", "value": self._road_fact(street)},
            {"label": "Weather", "value": self._weather_fact(weather)},
            {"label": "Street imagery", "value": self._imagery_fact(imagery)},
        ]
        scene = self._video_prompt(street, lighting, sun, weather, len(nearby), open_now, own_type, footway)
        return {
            "video_prompt": f"first-person view at eye level, {motion}, {scene}" if motion else scene,
            "audio_prompt": self._audio_prompt(street, weather, open_now, sun),
            "facts": facts,
            "lighting": lighting,
        }

    # --- fact wording ----------------------------------------------------

    @staticmethod
    def _lamp_fact(lighting: dict) -> str:
        n = lighting["lamp_count"]
        if n == 0:
            return "None mapped on this block"
        side = {"both": "both sides", "one": "one side"}[lighting["side"]]
        return f"{n} mapped on this block, {side}"

    @staticmethod
    def _outage_fact(light: dict) -> str:
        n = light["outages"]
        month = light["window_end"].strftime("%b %Y")
        return f"{n if n else 'None'} in {OUTAGE_WINDOW_DAYS} days to {month} (311)"

    @staticmethod
    def _business_fact(total: int, open_now: int, unknown: int, local: datetime) -> str:
        if total == 0:
            return "None nearby"
        known = total - unknown
        if known == 0:
            return f"{total} nearby (hours unknown)"
        text = f"{open_now} of {known} open at {clock(local)}"
        return f"{text}, {unknown} more with hours unknown" if unknown else text

    @staticmethod
    def _sidewalk_fact(own_type: str | None, footway: str | None, street: dict | None) -> str:
        if footway == "sidewalk":
            return "Mapped sidewalk"
        if footway == "crossing":
            return "Crosswalk"
        if own_type in ("footway", "path", "pedestrian", "steps") and street is None:
            return "Footpath, away from road" if own_type != "steps" else "Steps"
        tag = first(street.get("sidewalk")) if street else None
        return {"both": "Both sides", "left": "One side", "right": "One side", "no": "None", "separate": "Mapped separately"}.get(tag, "Not tagged")

    @staticmethod
    def _road_fact(street: dict | None) -> str:
        if street is None:
            return "No road alongside"
        kind = first(street.get("highway")) or "road"
        name = {"residential": "Residential", "service": "Alley / service road", "living_street": "Shared street",
                "tertiary": "Collector street", "secondary": "Arterial street", "primary": "Major arterial",
                "trunk": "Highway"}.get(kind.replace("_link", ""), kind.replace("_", " ").capitalize())
        parts = [name]
        try:
            lanes = int(first(street.get("lanes")))
            parts.append(LANES_WORDS.get(lanes, f"{lanes} lanes"))
        except (TypeError, ValueError):
            pass
        if str(first(street.get("oneway"))) in ("True", "yes"):
            parts.append("one-way")
        return ", ".join(parts)

    @staticmethod
    def _imagery_fact(imagery: dict | None) -> str:
        # Rule 4 (revised): the continuous walk can't stop for an "unavailable" card,
        # so say plainly when the render here isn't grounded in a photo.
        if imagery is None:
            return "None here — render not grounded in a photo"
        captured = imagery.get("captured_at")
        when = datetime.fromtimestamp(captured / 1000, SF_TZ).strftime("%b %Y") if captured else "date unknown"
        return f"Mapillary photo, {when}"

    @staticmethod
    def _weather_fact(weather: dict | None) -> str:
        if weather is None:
            return "Unavailable"
        words = WEATHER_WORDS.get(weather["weather_code"], "Unknown")
        temp = weather.get("temperature_2m")
        return f"{words}, {round(temp)}°C" if temp is not None else words

    # --- prompts ----------------------------------------------------------

    @staticmethod
    def _video_prompt(street, lighting, sun, weather, nearby, open_now, own_type, footway) -> str:
        kind = (first(street.get("highway")) or "") if street else ""
        if street is None:
            road = "narrow pedestrian path between buildings" if own_type != "steps" else "outdoor stairway"
        elif kind.startswith(("primary", "secondary", "trunk")):
            road = "wide multi-lane city street"
        elif kind.startswith("tertiary"):
            road = "two-lane city street"
        elif kind == "service":
            road = "narrow alley"
        else:
            road = "narrow residential street"

        when = {"night": "at night", "dusk": "at dusk", "dawn": "at dawn", "day": "in daylight"}[sun["phase"]]
        parts = [f"{road} {when}, seen from the sidewalk"]

        if sun["phase"] in ("night", "dusk", "dawn"):
            n, side = lighting["lamp_count"], lighting["side"]
            if n == 0:
                parts.append("no streetlights, very dark, faint light from windows" if lighting["lit"] != "yes" else "dim scattered street lighting")
            elif side == "both" and n >= 4:
                parts.append("streetlights on both sides casting even pools of light")
            else:
                parts.append("sparse streetlights on one side, dark stretches between pools of light")
            if lighting["outages"]:
                parts.append("one streetlight out")

        code = weather["weather_code"] if weather else None
        visibility = weather.get("visibility") if weather else None
        if code in (45, 48) or (visibility is not None and visibility < 1000):
            parts.append("thick fog")
        elif visibility is not None and visibility < 5000:
            parts.append("light fog in the air")
        if weather and (weather.get("precipitation") or 0) > 0.1:
            parts.append("rain, wet asphalt reflecting the lights")
        else:
            parts.append("dry pavement")

        if kind in ("residential", "tertiary", "secondary", "unclassified", "living_street"):
            parts.append("cars parked along the curb")
        if open_now >= 4:
            parts.append("lit storefronts, people walking on the sidewalk")
        elif open_now >= 1:
            parts.append("a lit storefront, a couple of pedestrians")
        elif nearby:
            parts.append("storefronts closed with shutters down, no pedestrians")
        else:
            parts.append("no pedestrians")
        return ", ".join(parts)

    @staticmethod
    def _audio_prompt(street, weather, open_now, sun) -> str:
        kind = (first(street.get("highway")) or "") if street else ""
        if kind.startswith(("primary", "secondary", "trunk")):
            parts = ["steady traffic passing"]
        elif kind.startswith("tertiary"):
            parts = ["occasional cars passing"]
        elif street is None:
            parts = ["distant city hum"]
        else:
            parts = ["quiet street, distant traffic"]
        if weather and (weather.get("precipitation") or 0) > 0.1:
            parts.append("rain pattering on pavement")
        if weather and (weather.get("wind_speed_10m") or 0) > 25:
            parts.append("gusty wind")
        if open_now >= 4:
            parts.append("voices and music from open businesses")
        parts.append("footsteps on pavement")
        return f"{'city street at night' if sun['dark'] else 'city street'}, " + ", ".join(parts)
