/**
 * The walk's script. The backend plans it (`backend/shots.py`): one steady
 * prompt per straight leg, one short cue per turn, then arrive. A route without
 * `shots` (the old fixture) falls back to one shot per waypoint.
 */

import type { Route, Shot } from "@/lib/contract";
import { WAYPOINT_DWELL_MS } from "@/lib/orbis/blocks";

export function shotsOf(route: Route): Shot[] {
  if (route.shots?.length) return route.shots;
  return route.waypoints.map((waypoint, index) => ({
    shot_id: `w${index}`,
    kind: index === route.waypoints.length - 1 ? "arrive" : "walk",
    video_prompt: waypoint.condition.video_prompt,
    audio_prompt: waypoint.condition.audio_prompt,
    duration_ms: WAYPOINT_DWELL_MS,
    waypoint_start: index,
    waypoint_end: index,
  }));
}

/** Wall-clock length of the walk once frames are on screen. */
export function scriptDurationMs(route: Route): number {
  return shotsOf(route).reduce((total, shot) => total + shot.duration_ms, 0);
}
