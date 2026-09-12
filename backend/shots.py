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
vanishing point — and its scene is chosen once for the whole leg. A turn cue
lasts ~2 chunks, then the next leg's "straight ahead" prompt takes over.

The prompts describe the camera where the seed actually puts it: **in the
middle of the street**. Every seed is a car-mounted Mapillary capture, so the
first frame is in the roadway. The first shot-list run said "down the
sidewalk, the street and parked cars on the left" and "crossing at the
crosswalk", and at the turn and the stop Orbis steered toward the curb — into a
parked car, then into the buildings (docs/spike/evidence/16-…). Straight legs
held their direction throughout.
"""

from collections import Counter

from conditions import CAMERA_ANCHOR, TURN_CUE_DEG, ConditionModel
from geo import Block, RouteGeometry

SCREEN_SPEED_MPS = 4.5  # route metres per second of screen time — brisk, so ~500m fits a 2-minute demo
WALK_MIN_MS = 6_000
WALK_MAX_MS = 20_000  # an unchanged prompt held much longer drifts; long legs just go by faster
# A prompt change shows at the next ~1.8s chunk but takes ~10s to settle (reactor-findings Q7).
# At 4s the next leg's "straight ahead" took over mid-turn and the camera drifted across the
# street instead of rounding the corner.
TURN_MS = 9_000
ARRIVE_MS = 4_000
# Symmetric on purpose: naming one side for the cars pulled the camera toward that curb.
# "No moving traffic" replaces the old "empty street", which also emptied the sidewalks and
# cancelled the crowd override.
STREET_LAYOUT = "parked cars along both curbs, buildings lining both sides of the street, no moving traffic"


def _turn(before: Block, after: Block) -> str | None:
    delta = (after.heading - before.heading + 540) % 360 - 180  # + is clockwise, i.e. right
    return "right" if delta > TURN_CUE_DEG else "left" if delta < -TURN_CUE_DEG else None


def _mode(values: list[str]) -> str:
    return Counter(values).most_common(1)[0][0]


def build_shots(
    model: ConditionModel, geom: RouteGeometry, scenes: list[str], audios: list[str], light: str
) -> list[dict]:
    """`scenes` / `audios`: each waypoint's scene description and audio prompt, in waypoint order.
    `light`: the route-wide time-of-day phrase (`ConditionModel.light_prompt`), said second in
    every prompt so a change of the clock outweighs the seed's light.

    Order inside a prompt is camera → light → motion → scene → layout: what must change the
    render when the viewer moves a control comes first."""
    lead = f"{CAMERA_ANCHOR}, walking steadily forward and looking straight ahead, {light}"
    # No "looking straight ahead" while turning: it told the camera not to turn.
    turn_lead = f"{CAMERA_ANCHOR}, walking steadily forward, {light}"
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

        if previous is not None:
            onto = model._street_name(geom, longest, " onto")
            # The street being left is still what's on screen, so its scene carries the turn.
            # The turn is the whole point of this prompt, so it is said twice and concretely:
            # what a head-mounted camera sees while rounding a corner. "Clear road ahead": a
            # turn is when the camera meets cross traffic.
            side = merged_turns[k - 1]
            add(
                "turn",
                f"{turn_lead}, reaching the intersection and turning {side} around the corner{onto}, "
                f"the view swinging a quarter turn to the {side} as the corner building slides past "
                f"and the new street opens up straight ahead, still walking forward, clear road ahead, "
                f"{previous['scene']}",
                previous["audio"], TURN_MS, indices[0], indices[0],
            )

        length = sum(block.end - block.start for block in leg)
        add(
            "walk",
            f"{lead}, walking straight ahead down the middle of the street{on}, "
            f"the street stretching ahead toward the vanishing point, {scene}, {STREET_LAYOUT}",
            audio, min(WALK_MAX_MS, max(WALK_MIN_MS, length / SCREEN_SPEED_MPS * 1000)), indices[0], indices[-1],
        )
        previous = {"scene": scene, "audio": audio, "on": on, "end": indices[-1]}

    assert previous is not None  # a route always has at least one waypoint
    add(
        "arrive",
        f"{lead}, walking straight ahead down the middle of the street{previous['on']} "
        f"and slowing to a gentle stop, the street stretching ahead, {previous['scene']}, {STREET_LAYOUT}",
        previous["audio"], ARRIVE_MS, previous["end"], previous["end"],
    )
    return shots
