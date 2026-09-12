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
 * PROPOSED, NOT YET IN THE SCHEMA. Person 1's Phase 2 adds `condition.lighting`
 * so the night grade can put a glow where a lamp actually is instead of washing
 * every block in the same amber (PLAN.md, Person 1 Phase 2 / Person 2 Phase 2).
 * Optional here on purpose: everything works without it, just generically.
 */
export type Lighting = {
  lit?: "yes" | "no" | "unknown";
  lamp_count?: number;
  side?: "both" | "one" | "none";
  /** Distance in metres along the block from the waypoint to each lamp. */
  lamp_offsets_m?: number[];
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

export type Route = {
  route_id: string;
  waypoints: Waypoint[];
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
