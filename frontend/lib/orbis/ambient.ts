/**
 * How dark the seed grade is allowed to believe it is.
 *
 * Sibling of `lighting.ts`: that one answers "where is the light coming from",
 * this one answers "how much of it is there at all". They are separate because
 * they come from different data — lamps from Mapillary/OSM/311, ambient from
 * `astral` — and because a change of the condition clock moves this one alone.
 *
 * Same honesty rule as `estimateLighting`: prefer the structured field, fall
 * back to the prose, and say which happened. Anything unreadable stays at the
 * assumed value rather than becoming a wrong number.
 */

import type { Ambient, Condition } from "@/lib/contract";
import { findFact } from "@/lib/contract";

export type AmbientEstimate = {
  phase: Ambient["phase"];
  /** 0 = full daylight, 1 = fully dark. The grade's one continuous dial. */
  darkness: number;
  sunAltitudeDeg: number | null;
  /** Where the number came from, so nobody mistakes a guess for data. */
  source: "structured" | "facts" | "assumed";
};

/**
 * What the walk assumes with no ambient data at all. 1 — the look every run
 * before this file existed, and the only value that cannot make a night walk
 * (the product) come out wrong.
 */
const ASSUMED_DARKNESS = 1;

/**
 * Used only for the "it is not dark yet" case of the prose fallback. The fact
 * distinguishes dark from not-dark and nothing finer, so this is a coarse
 * stand-in that keeps a pre-dusk walk off the deep-night grade. It is not a
 * measurement, and `source: "facts"` says so.
 */
const NOT_DARK_YET_DARKNESS = 0.55;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function fromStructured(ambient: Ambient): AmbientEstimate {
  return {
    phase: ambient.phase,
    darkness: clamp01(ambient.darkness),
    sunAltitudeDeg:
      typeof ambient.sun_altitude_deg === "number" ? ambient.sun_altitude_deg : null,
    source: "structured",
  };
}

/**
 * Person 1's "Dark since" fact reads either as a clock time ("11:42pm") when it
 * is dark, or "Not yet (dark at 8:15pm)" when it is not. That is a boolean, so
 * this can only ever produce two values.
 */
function fromFacts(condition: Condition): AmbientEstimate | null {
  const dark = findFact(condition.facts, /dark since/);
  if (!dark) return null;
  const notYet = /not yet/i.test(dark.value);
  return {
    phase: notYet ? "dusk" : "night",
    darkness: notYet ? NOT_DARK_YET_DARKNESS : 1,
    sunAltitudeDeg: null,
    source: "facts",
  };
}

export function estimateAmbient(condition: Condition): AmbientEstimate {
  if (condition.ambient) return fromStructured(condition.ambient);
  return (
    fromFacts(condition) ?? {
      phase: "night",
      darkness: ASSUMED_DARKNESS,
      sunAltitudeDeg: null,
      source: "assumed",
    }
  );
}

/** One short line for the walk's diagnostics readout. */
export function describeAmbient(ambient: AmbientEstimate): string {
  return `darkness ${ambient.darkness.toFixed(2)} (${ambient.phase}, ${ambient.source})`;
}
