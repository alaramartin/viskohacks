"""Shot list for the continuous walk.

Orbis has no camera control and no sense of position. The only lever inside a
live generation is `set_prompt`, which morphs in at the next ~1.8s chunk
(docs/reactor-findings.md, Q5/Q7). Sending a fresh prompt per waypoint — 14
changes on a 21-waypoint route, with the scene wording flip-flopping and turn
cues spread over several waypoints — made the render wander: walking sideways,
into a wall, doubling back (human review after the continuous-walk change).

So the route is planned once, as a short script:

    walk (one straight leg, one fixed prompt) → turn (one short cue) → walk → … → arrive

Every walk prompt says where "forward" is — the street stretching to the
vanishing point, which side the buildings and the road are on — and its scene
is chosen once for the whole leg. A turn cue lasts ~2 chunks, then the next
leg's "walking straight ahead" prompt takes over. Only crossings at the corner
being turned are mentioned.
"""

from collections import Counter

from conditions import CAMERA_ANCHOR, TURN_CUE_DEG, ConditionModel, _perpendicular
from geo import Block, RouteGeometry, first

SCREEN_SPEED_MPS = 4.5  # route metres per second of screen time — brisk, so ~500m fits a 2-minute demo
WALK_MIN_MS = 6_000
WALK_MAX_MS = 20_000  # an unchanged prompt held much longer drifts; long legs just go by faster
TURN_MS = 4_000  # ~2 Orbis chunks
ARRIVE_MS = 4_000
CORNER_CROSSING_M = 30
CENTRELINE_M = 3  # closer than this, the walked line *is* the street (no separate sidewalk mapped)


def _turn(before: Block, after: Block) -> str | None:
    delta = (after.heading - before.heading + 540) % 360 - 180  # + is clockwise, i.e. right
    return "right" if delta > TURN_CUE_DEG else "left" if delta < -TURN_CUE_DEG else None


def _mode(values: list[str]) -> str:
    return Counter(values).most_common(1)[0][0]


def _layout(model: ConditionModel, geom: RouteGeometry, block: Block) -> str:
    """Which side the buildings and the road are on, facing the direction of travel."""
    line = geom.slice(block.start, block.end)
    _, street_line = model._street_alongside(geom, block, line)
    if street_line is None:
        return "the path stretching straight ahead"
    offset = float(_perpendicular(line.mean(axis=0)[None, :], street_line)[0])  # left of centreline is +
    if abs(offset) < CENTRELINE_M:
        return "buildings along the sidewalk, parked cars along the curb"
    if offset > 0:
        return "buildings on the left, the street and parked cars on the right"
    return "buildings on the right, the street and parked cars on the left"


def build_shots(model: ConditionModel, geom: RouteGeometry, scenes: list[str], audios: list[str]) -> list[dict]:
    """`scenes` / `audios`: each waypoint's scene description and audio prompt, in waypoint order."""
    by_block: dict[str, list[int]] = {}
    for wp in geom.waypoints:
        by_block.setdefault(wp.block.block_id, []).append(wp.index)

    # Legs: runs of blocks with no turn between them (straight across an intersection
    # stays one leg).
    legs: list[list[Block]] = [[geom.blocks[0]]]
    turns: list[str] = []
    for before, after in zip(geom.blocks, geom.blocks[1:]):
        direction = _turn(before, after)
        if direction:
            legs.append([after])
            turns.append(direction)
        else:
            legs[-1].append(after)

    # A leg so short no waypoint landed on it (a corner jog) folds into the leg before.
    merged: list[tuple[list[Block], list[int]]] = []
    merged_turns: list[str] = []
    for k, leg in enumerate(legs):
        indices = [i for block in leg for i in by_block.get(block.block_id, [])]
        if not indices and merged:
            merged[-1][0].extend(leg)
            continue
        if merged:
            merged_turns.append(turns[k - 1])
        merged.append((leg, indices))

    shots: list[dict] = []

    def add(kind: str, prompt: str, audio: str, duration_ms: float, start: int, end: int) -> None:
        shots.append({
            "shot_id": f"s{len(shots)}",
            "kind": kind,
            "video_prompt": prompt,
            "audio_prompt": audio,
            "duration_ms": int(duration_ms),
            "waypoint_start": start,
            "waypoint_end": end,
        })

    previous: dict | None = None
    for k, (leg, indices) in enumerate(merged):
        longest = max(leg, key=lambda block: block.end - block.start)
        on = model._street_name(geom, longest, " on")
        scene = _mode([scenes[i] for i in indices])
        audio = _mode([audios[i] for i in indices])
        layout = _layout(model, geom, longest)

        if previous is not None:
            corner = leg[0].start
            crossing = any(
                first(span.data.get("footway")) == "crossing" and abs(span.start - corner) <= CORNER_CROSSING_M
                for span in geom.spans
            )
            lead = "crossing the street at the crosswalk, then turning" if crossing else "turning"
            onto = model._street_name(geom, longest, " onto")
            # The street being left is still what's on screen, so its scene carries the turn.
            add(
                "turn",
                f"{CAMERA_ANCHOR}, {lead} {merged_turns[k - 1]} at the intersection{onto}, {previous['scene']}",
                previous["audio"], TURN_MS, indices[0], indices[0],
            )

        length = sum(block.end - block.start for block in leg)
        add(
            "walk",
            f"{CAMERA_ANCHOR}, walking straight ahead down the sidewalk{on}, "
            f"the street stretching ahead toward the vanishing point, {layout}, {scene}",
            audio, min(WALK_MAX_MS, max(WALK_MIN_MS, length / SCREEN_SPEED_MPS * 1000)), indices[0], indices[-1],
        )
        previous = {"scene": scene, "audio": audio, "on": on, "layout": layout, "end": indices[-1]}

    assert previous is not None  # a route always has at least one waypoint
    add(
        "arrive",
        f"{CAMERA_ANCHOR}, walking straight ahead and slowing to a stop at the destination{previous['on']}, "
        f"{previous['layout']}, {previous['scene']}",
        previous["audio"], ARRIVE_MS, previous["end"], previous["end"],
    )
    return shots
