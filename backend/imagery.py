"""Seed imagery from Mapillary (CC BY-SA). No Google fallback: blocks without
Mapillary coverage are served as unavailable.

Mapillary candidates come from its z14 coverage vector tiles, cached to
data/imagery/tiles/ — the /images bbox search 500s ("reduce the amount of
data") on dense streets like Market St. Coverage decisions and processed 16:9
frames are cached under data/imagery/ too. Panoramas are reprojected to a
rectilinear ~90° view centred on the requested heading, because Orbis resizes
non-16:9 frames without cropping.
"""

import io
import json
import logging
import math
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

import httpx
import mapbox_vector_tile
import numpy as np
from PIL import Image

from geo import LAT0, LNG0, M_PER_DEG_LAT, M_PER_DEG_LNG, angle_diff, to_xy

log = logging.getLogger("imagery")

OUT_W, OUT_H = 854, 480  # 16:9, Orbis stable's native frame
HFOV_DEG = 90
# Car-mounted Mapillary panos show the roof rig in the bottom ~15% of a level
# view, and Orbis faithfully reproduces it. Looking up slightly crops it out.
PANO_PITCH_DEG = 9
SEARCH_RADIUS_M = 40
MAX_PERSPECTIVE_ANGLE = 35  # a non-pano photo must face within this of the heading
MAX_ACROSS_M = 18  # mapped sidewalk to far lane on a wide SF street
MAX_BEHIND_M = 30  # a frame from just behind still looks down the same block
AGE_PENALTY_M_PER_YEAR = 2  # a year older costs as much as 2m further along the street

TILE_ZOOM = 14
TILE_URL = "https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}"


def crop_equirect(
    pano: Image.Image, yaw_deg: float, hfov_deg: float = HFOV_DEG, size=(OUT_W, OUT_H), pitch_deg: float = 0.0
) -> Image.Image:
    """Rectilinear view of an equirectangular pano. yaw 0 = the pano's centre column; pitch + looks up."""
    w, h = size
    src = np.asarray(pano.convert("RGB"), dtype=np.float32)
    ph, pw = src.shape[:2]
    f = (w / 2) / math.tan(math.radians(hfov_deg) / 2)
    x, y = np.meshgrid(np.arange(w) - (w - 1) / 2, (h - 1) / 2 - np.arange(h))
    pitch = math.radians(pitch_deg)
    z = np.full_like(x, f, dtype=np.float64)
    y, z = y * math.cos(pitch) + z * math.sin(pitch), -y * math.sin(pitch) + z * math.cos(pitch)
    lon = np.arctan2(x, z) + math.radians(yaw_deg)
    lat = np.arctan2(y, np.hypot(x, z))
    u = ((lon / (2 * math.pi) + 0.5) % 1.0) * pw - 0.5
    v = np.clip((0.5 - lat / math.pi) * ph - 0.5, 0, ph - 1)

    u0, v0 = np.floor(u).astype(int), np.floor(v).astype(int)
    du, dv = (u - u0)[..., None], (v - v0)[..., None]
    u0, u1 = u0 % pw, (u0 + 1) % pw
    v1 = np.minimum(v0 + 1, ph - 1)
    top = src[v0, u0] * (1 - du) + src[v0, u1] * du
    bottom = src[v1, u0] * (1 - du) + src[v1, u1] * du
    out = top * (1 - dv) + bottom * dv
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def fit_16_9(img: Image.Image, size=(OUT_W, OUT_H)) -> Image.Image:
    w, h = img.size
    target = size[0] / size[1]
    if w / h > target:
        nw = round(h * target)
        box = ((w - nw) // 2, 0, (w - nw) // 2 + nw, h)
    else:
        nh = round(w / target)
        box = (0, (h - nh) // 2, w, (h - nh) // 2 + nh)
    return img.convert("RGB").crop(box).resize(size, Image.LANCZOS)


def tile_of(lat: float, lng: float, z: int = TILE_ZOOM) -> tuple[int, int]:
    n = 2**z
    return int((lng + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)


def decode_image_tile(content: bytes, tx: int, ty: int, z: int = TILE_ZOOM) -> dict[str, np.ndarray]:
    layer = mapbox_vector_tile.decode(content, default_options={"y_coord_down": True}).get("image")
    features = layer["features"] if layer else []
    extent = layer.get("extent", 4096) if layer else 4096
    n = 2**z
    px = np.array([f["geometry"]["coordinates"][0] for f in features], dtype=np.float64)
    py = np.array([f["geometry"]["coordinates"][1] for f in features], dtype=np.float64)
    lng = (tx + px / extent) / n * 360 - 180
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (ty + py / extent) / n))))
    props = [f["properties"] for f in features]
    return {
        "id": np.array([int(p["id"]) for p in props], dtype=np.int64),
        "x": (lng - LNG0) * M_PER_DEG_LNG,
        "y": (lat - LAT0) * M_PER_DEG_LAT,
        "compass": np.array([p.get("compass_angle", np.nan) for p in props], dtype=np.float64),
        "pano": np.array([bool(p.get("is_pano")) for p in props], dtype=bool),
        "captured_at": np.array([int(p.get("captured_at", 0)) for p in props], dtype=np.int64),
    }


class Imagery:
    def __init__(self, cache_dir: Path):
        self.dir = cache_dir
        (self.dir / "tiles").mkdir(parents=True, exist_ok=True)
        self.coverage_path = self.dir / "coverage.json"
        self._coverage = json.loads(self.coverage_path.read_text()) if self.coverage_path.exists() else {}
        self._lock = threading.Lock()
        self._tiles: dict[tuple[int, int], dict[str, np.ndarray]] = {}
        self._tile_locks: dict[tuple[int, int], threading.Lock] = {}
        self.client = httpx.Client(timeout=120, follow_redirects=True)
        self.mapillary_token = os.getenv("MAPILLARY_ACCESS_TOKEN")

    # --- coverage --------------------------------------------------------

    def coverage(self, lat: float, lng: float, heading: int) -> dict | None:
        """Best source for this spot and heading, or None. Only definite answers are cached."""
        key = f"{lat:.5f},{lng:.5f},{heading}"
        with self._lock:
            if key in self._coverage:
                return self._coverage[key]
        try:
            meta = self._mapillary(lat, lng, heading)
        except httpx.HTTPError as exc:
            log.warning("Mapillary lookup failed at %s: %s", key, exc)
            return None  # don't cache a transient failure as "no coverage"
        with self._lock:
            self._coverage[key] = meta
            self.coverage_path.write_text(json.dumps(self._coverage))
        return meta

    def _tile(self, tx: int, ty: int) -> dict[str, np.ndarray]:
        with self._lock:
            lock = self._tile_locks.setdefault((tx, ty), threading.Lock())
        with lock:
            if (tx, ty) in self._tiles:
                return self._tiles[(tx, ty)]
            path = self.dir / "tiles" / f"{TILE_ZOOM}_{tx}_{ty}.npz"
            if path.exists():
                arrays = dict(np.load(path))
            else:
                r = self.client.get(TILE_URL.format(z=TILE_ZOOM, x=tx, y=ty), params={"access_token": self.mapillary_token})
                r.raise_for_status()
                arrays = decode_image_tile(r.content, tx, ty)
                np.savez_compressed(path, **arrays)
            self._tiles[(tx, ty)] = arrays
            return arrays

    def _mapillary(self, lat: float, lng: float, heading: int) -> dict | None:
        if not self.mapillary_token:
            return None
        x0, y0 = to_xy(lat, lng)
        dlat, dlng = SEARCH_RADIUS_M / M_PER_DEG_LAT, SEARCH_RADIUS_M / M_PER_DEG_LNG
        tiles = {tile_of(lat + sy * dlat, lng + sx * dlng) for sx in (-1, 1) for sy in (-1, 1)}
        hx, hy = math.sin(math.radians(heading)), math.cos(math.radians(heading))
        now_ms = datetime.now(timezone.utc).timestamp() * 1000

        best, best_score = None, math.inf
        for t in tiles:
            arr = self._tile(*t)
            near = np.flatnonzero((np.abs(arr["x"] - x0) <= SEARCH_RADIUS_M) & (np.abs(arr["y"] - y0) <= SEARCH_RADIUS_M))
            for i in near:
                compass = float(arr["compass"][i])
                if math.isnan(compass):
                    continue
                dx, dy = arr["x"][i] - x0, arr["y"][i] - y0
                # Along/across the walked line: an image off to the side is usually on the
                # cross street, and looking down `heading` from there shows a building face.
                along, across = dx * hx + dy * hy, abs(dx * hy - dy * hx)
                if math.hypot(dx, dy) > SEARCH_RADIUS_M or across > MAX_ACROSS_M or along < -MAX_BEHIND_M:
                    continue
                age_years = (now_ms - arr["captured_at"][i]) / (365.25 * 86400 * 1000)
                score = 2 * across + abs(along) * 0.5 + AGE_PENALTY_M_PER_YEAR * age_years
                pano = bool(arr["pano"][i])
                if not pano:
                    off = angle_diff(compass, heading)
                    if off > MAX_PERSPECTIVE_ANGLE:
                        continue
                    score += off * 0.5
                if score < best_score:
                    best_score = score
                    best = {
                        "source": "mapillary",
                        "id": str(arr["id"][i]),
                        "is_pano": pano,
                        "compass": compass,
                        "captured_at": int(arr["captured_at"][i]),
                        "distance_m": round(math.hypot(dx, dy), 1),
                    }
        return best

    # --- frames ----------------------------------------------------------

    def frame(self, cache_name: str, lat: float, lng: float, heading: int) -> bytes | None:
        path = self.dir / f"{cache_name}.jpg"
        if path.exists():
            return path.read_bytes()
        meta = self.coverage(lat, lng, heading)
        if meta is None:
            return None
        img = self._mapillary_frame(meta, heading)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        path.write_bytes(buf.getvalue())
        return buf.getvalue()

    def _mapillary_frame(self, meta: dict, heading: int) -> Image.Image:
        # Thumbnail URLs expire, so resolve a fresh one. The SfM-corrected compass
        # isn't in the tiles and is noticeably better than the camera's own.
        r = self.client.get(
            f"https://graph.mapillary.com/{meta['id']}",
            headers={"Authorization": f"OAuth {self.mapillary_token}"},
            params={"fields": "computed_compass_angle,thumb_original_url,thumb_2048_url"},
        )
        r.raise_for_status()
        info = r.json()
        url = info.get("thumb_original_url") if meta["is_pano"] else None
        img = Image.open(io.BytesIO(self.client.get(url or info["thumb_2048_url"]).raise_for_status().content))
        if meta["is_pano"]:
            return crop_equirect(img, heading - info.get("computed_compass_angle", meta["compass"]), pitch_deg=PANO_PITCH_DEG)
        return fit_16_9(img)
