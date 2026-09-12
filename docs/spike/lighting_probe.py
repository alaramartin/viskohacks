"""Does Mapillary expose anything that grounds the night render in real
lighting? Probes two things near the Tenderloin test block:

  1. map_features detections for street lights (are lamps mapped as points?)
  2. capture-time distribution of the imagery (are any frames already night?)
"""

import datetime
import json
import urllib.parse
import urllib.request
from collections import Counter

ROOT = r"C:\Documents\hackatho\viskohacks"
LAT, LNG = 37.7828961, -122.4135521
D = 0.0012


def token():
    for line in open(ROOT + r"\.env", encoding="utf8"):
        if line.startswith("MAPILLARY_ACCESS_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("no token")


TOKEN = token()
BBOX = f"{LNG - D},{LAT - D},{LNG + D},{LAT + D}"


def get(url):
    request = urllib.request.Request(url, headers={"Authorization": f"OAuth {TOKEN}"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()[:300]


print("=== 1. map_features: street lights as mapped points ===")
for values in ("object--street-light", "object--banner", None):
    params = {"fields": "id,object_value,geometry,first_seen_at", "bbox": BBOX, "limit": 50}
    if values:
        params["object_values"] = values
    status, body = get(
        f"https://graph.mapillary.com/map_features?{urllib.parse.urlencode(params)}"
    )
    label = values or "(all object values)"
    if status != 200:
        print(f"  {label}: HTTP {status} {body}")
        continue
    items = body.get("data", [])
    print(f"  {label}: {len(items)} features")
    if not values:
        print("    ", Counter(i.get("object_value") for i in items).most_common(12))
    else:
        for item in items[:5]:
            coords = item.get("geometry", {}).get("coordinates")
            print(f"     {item.get('object_value')} at {coords} seen {item.get('first_seen_at')}")

print()
print("=== 2. capture time of day (UTC-7 = SF local) ===")
params = {"fields": "id,captured_at,is_pano", "bbox": BBOX, "limit": 100}
status, body = get(f"https://graph.mapillary.com/images?{urllib.parse.urlencode(params)}")
items = body.get("data", []) if status == 200 else []
hours = Counter()
for item in items:
    ms = item.get("captured_at")
    if not ms:
        continue
    local = datetime.datetime.utcfromtimestamp(ms / 1000) - datetime.timedelta(hours=7)
    hours[local.hour] += 1
print(f"  {len(items)} images; local capture hour histogram:")
for hour in sorted(hours):
    print(f"    {hour:02d}:00  {'#' * hours[hour]} ({hours[hour]})")
night = sum(count for hour, count in hours.items() if hour >= 20 or hour <= 5)
print(f"  frames captured 20:00-05:59 local: {night} / {len(items)}")
