/**
 * TypeScript mirror of `shared/waypoint.schema.json` (the SHARED CONTRACT in
 * PLAN.md). Person 1's backend produces this shape; the render layer consumes
 * it and never reinterprets `facts` — they are displayed verbatim.
 *
 * Keep this file in step with the schema. If the schema changes, both people
 * have to agree first.
 */

export type Fact = {
  label: string;
  value: string;
};

/**
 * Structured lighting from Person 1's backend (Phase 2), so the night grade can
 * put a glow where a lamp actually is. The backend always sends it; it stays
 * optional here so the grade degrades to the generic look without it.
 */
export type Lighting = {
  /** OSM `lit` tag on the block. */
  lit?: "yes" | "no" | "unknown";
  /** Mapped lamps on the whole block (Mapillary detections + OSM). */
  lamp_count?: number;
  /** Which sides of the street centreline the block's lamps are on. */
  side?: "both" | "one" | "none";
  /** Metres ahead of this waypoint, along the route, to each lamp still ahead on the block. Ascending. */
  lamp_offsets_m?: number[];
  /** Same order as `lamp_offsets_m`: metres right (+) or left (−) of the street centreline. */
  lamp_lateral_m?: number[];
  /** 311 streetlight-out reports near the block in the 90 days before the requested time. */
  outages?: number;
};

export type Condition = {
  /** Passed straight to Orbis `set_prompt`. */
  video_prompt: string;
  /** Passed straight to Orbis `set_audio_prompt`. */
  audio_prompt: string;
  /** Rendered verbatim in the evidence readout. Person 1 owns the wording. */
  facts: Fact[];
  lighting?: Lighting;
};

export type Waypoint = {
  index: number;
  lat: number;
  lng: number;
  /** Bearing in degrees to the next waypoint (0 = north, clockwise). */
  heading: number;
  /**
   * Stable id for the street segment between two intersections. Consecutive
   * waypoints sharing it belong to one Orbis block.
   */
  block_id: string;
  /** e.g. `/api/imagery/<block_id>/<heading>`; null when no imagery exists. */
  image_url: string | null;
  image_available: boolean;
  condition: Condition;
};

/**
 * One step of the walk's script. The continuous Orbis generation plays shots in
 * order and changes its prompt only at shot boundaries: one steady prompt per
 * straight leg, one short cue per turn.
 */
export type Shot = {
  shot_id: string;
  kind: "walk" | "turn" | "arrive";
  video_prompt: string;
  audio_prompt: string;
  duration_ms: number;
  /** First waypoint index the shot covers. */
  waypoint_start: number;
  /** Last waypoint index the shot covers, inclusive. */
  waypoint_end: number;
};

export type Route = {
  route_id: string;
  waypoints: Waypoint[];
  /** Always sent by the backend; absent in the old fixture. */
  shots?: Shot[];
};

export type RoutesResponse = {
  routes: Route[];
};

export type LatLng = {
  lat: number;
  lng: number;
};

/** First fact whose label matches, or undefined. Matching is case-insensitive. */
export function findFact(
  facts: Fact[],
  pattern: RegExp | string,
): Fact | undefined {
  const test =
    typeof pattern === "string"
      ? new RegExp(pattern, "i")
      : new RegExp(pattern.source, pattern.flags.includes("i") ? pattern.flags : `${pattern.flags}i`);
  return facts.find((fact) => test.test(fact.label));
}

/** True when two fact lists differ — drives the readout's change emphasis. */
export function factsDiffer(a: Fact[], b: Fact[]): boolean {
  if (a.length !== b.length) return true;
  return a.some(
    (fact, index) =>
      fact.label !== b[index].label || fact.value !== b[index].value,
  );
}
