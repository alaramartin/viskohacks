/**
 * What the night grade is allowed to believe about a block's lighting.
 *
 * The honest version of this reads `condition.lighting` — lamp offsets along
 * the block, which side, how many are out — which Person 1's Phase 2 now sends.
 * Without it we key off the prose in `facts` instead, and the look is
 * **generic**: darkness scales with the lamp count and outages, but no lamp is
 * placed anywhere, because we do not know where any lamp is and inventing one
 * would be making the render say something the data does not.
 *
 * How bright the scene is overall is a separate question with separate data —
 * see `ambient.ts`.
 */

import type { Condition, Lighting } from "@/lib/contract";
import { findFact } from "@/lib/contract";

export type LightingEstimate = {
  lit: "yes" | "no" | "unknown";
  lampCount: number | null;
  side: "both" | "one" | "none" | "unknown";
  outages: number;
  /** Distance in metres ahead of the camera for each mapped lamp. */
  lampOffsetsM: number[];
  /** Metres right (+) / left (−) of the street centreline per lamp, or null when unknown. */
  lampLateralM: number[] | null;
  /** Where the numbers came from — surfaced so nobody mistakes prose for data. */
  source: "structured" | "facts" | "none";
};

const EMPTY: LightingEstimate = {
  lit: "unknown",
  lampCount: null,
  side: "unknown",
  outages: 0,
  lampOffsetsM: [],
  lampLateralM: null,
  source: "none",
};

function fromStructured(lighting: Lighting): LightingEstimate {
  const offsets = lighting.lamp_offsets_m ?? [];
  const laterals = lighting.lamp_lateral_m ?? [];
  const ahead = offsets
    .map((offset, index) => ({ offset, lateral: laterals[index] }))
    .filter(({ offset }) => offset > 0);
  return {
    lit: lighting.lit ?? "unknown",
    lampCount: typeof lighting.lamp_count === "number" ? lighting.lamp_count : null,
    side: lighting.side ?? "unknown",
    outages: typeof lighting.outages === "number" ? lighting.outages : 0,
    lampOffsetsM: ahead.map(({ offset }) => offset),
    lampLateralM:
      laterals.length === offsets.length ? ahead.map(({ lateral }) => lateral) : null,
    source: "structured",
  };
}

/**
 * Parse the two facts Person 1 writes about lighting. Deliberately forgiving:
 * anything it cannot read stays "unknown" rather than becoming a wrong number.
 * Examples it handles: "6 tagged, both sides", "None tagged", "2 (311, Aug 2026)".
 */
function fromFacts(condition: Condition): LightingEstimate {
  const lamps = findFact(condition.facts, /streetlight/);
  const outageFact = findFact(condition.facts, /outage/);
  if (!lamps && !outageFact) return EMPTY;

  const estimate: LightingEstimate = { ...EMPTY, source: "facts" };

  if (lamps) {
    const value = lamps.value.toLowerCase();
    const count = value.match(/(\d+)/);
    if (/none|no\b|0\b/.test(value) && !count) {
      estimate.lit = "no";
      estimate.lampCount = 0;
    } else if (count) {
      estimate.lampCount = Number(count[1]);
      estimate.lit = estimate.lampCount > 0 ? "yes" : "no";
    }
    if (/both/.test(value)) estimate.side = "both";
    else if (/one side|single/.test(value)) estimate.side = "one";
    else if (/none/.test(value)) estimate.side = "none";
  }

  if (outageFact) {
    const outages = outageFact.value.match(/(\d+)/);
    if (outages) estimate.outages = Number(outages[1]);
  }

  return estimate;
}

export function estimateLighting(condition: Condition): LightingEstimate {
  if (condition.lighting) return fromStructured(condition.lighting);
  return fromFacts(condition);
}

/** A lamp the grade will paint, expressed in metres relative to the camera. */
export type LampPool = {
  /** Metres ahead along the street. */
  distanceM: number;
  /** Metres left (−) or right (+) of the camera. */
  lateralM: number;
};

export type GradeParams = {
  /**
   * Mean luma the graded seed is exposed to. ~0.06 is the measured sweet spot:
   * at 0.043 Orbis lost the block entirely, at 0.061 it reproduced it
   * (docs/reactor-findings.md, Q1).
   */
  targetLuma: number;
  /** Multiplier on the sodium glow pulled out of the frame's own highlights. */
  lampGain: number;
  /** Wet-asphalt sheen strength. */
  sheen: number;
  /** Lamps to paint, empty unless we have real positions. */
  pools: LampPool[];
  /**
   * 0 = leave the frame in daylight, 1 = the full night conversion. Everything
   * the grade does — sodium cast, navy sky, lamp glow, exposure — scales along
   * this, so dusk is a real midpoint and not a switch.
   */
  darkness: number;
};

const LAMP_LATERAL_M = 4.5;
/** Darkest a seed is ever graded. Below ~0.043 Orbis loses the block (Q1); ~0.06 rendered too dark to see. */
export const MIN_TARGET_LUMA = 0.085;
/**
 * Where the dial lands at `darkness` 0 — roughly the mean luma of the daytime
 * Mapillary crops themselves, i.e. "don't darken this frame at all".
 */
export const DAY_TARGET_LUMA = 0.4;

/**
 * Interpolate exposure in log space. Luma reads as ratios, not differences, so
 * a linear blend from 0.40 to 0.095 spends almost the whole dial in the bright
 * half and then falls off a cliff. Geometric keeps dusk (0.5) at ~0.19 — about
 * half daylight and about twice night, which is what dusk looks like.
 */
function mixLuma(day: number, night: number, darkness: number): number {
  return Math.exp(Math.log(day) * (1 - darkness) + Math.log(night) * darkness);
}

/**
 * Turn a lighting estimate into grade knobs. A block with no working lamps must
 * come out visibly darker than one with six, or the render says nothing the
 * facts strip has not already said.
 *
 * `darkness` (0..1, from `estimateAmbient`) then scales the whole night look.
 * Lamp-driven contrast is computed at full night first and faded in with it:
 * at noon a working streetlight changes nothing you could see, so it should not
 * change the render either.
 */
export function gradeParamsFor(
  lighting: LightingEstimate,
  darkness = 1,
): GradeParams {
  const dial = Math.min(1, Math.max(0, darkness));
  const working =
    lighting.lampCount === null
      ? null
      : Math.max(0, lighting.lampCount - lighting.outages);

  // Floor raised after Checkpoint 2 review: seeds graded to 0.045–0.068 came
  // back from Orbis at ~0.03 on some blocks — too dark to see anything. The
  // darkest block now grades to MIN_TARGET_LUMA; lit blocks sit above it.
  let nightLuma = 0.095;
  let lampGain = 1;

  if (lighting.lit === "no" || working === 0) {
    // Nothing tagged and nothing working: the only light is spill from windows
    // and whatever is at the end of the street.
    nightLuma = MIN_TARGET_LUMA;
    lampGain = 0.35;
  } else if (working !== null) {
    // 1 lamp → dim, 6+ → the reference look.
    const density = Math.min(1, working / 6);
    nightLuma = MIN_TARGET_LUMA + 0.025 * density;
    lampGain = 0.55 + 0.55 * density;
  } else if (lighting.outages > 0) {
    nightLuma = 0.09;
    lampGain = 0.8;
  }

  // The floor is what stops a dusk→night slider from bottoming out in black,
  // so it holds at every darkness, not just at 1.
  const targetLuma = Math.max(MIN_TARGET_LUMA, mixLuma(DAY_TARGET_LUMA, nightLuma, dial));

  // Real curb positions when the backend sends them; the Mapillary seed camera
  // is usually in the roadway, close to the centreline they are measured from.
  const pools: LampPool[] = lighting.lampOffsetsM.map((distanceM, index) => ({
    distanceM,
    lateralM: lighting.lampLateralM
      ? lighting.lampLateralM[index]
      : lighting.side === "both"
        ? index % 2 === 0
          ? -LAMP_LATERAL_M
          : LAMP_LATERAL_M
        : LAMP_LATERAL_M,
  }));

  const litGain = lampGain * dial;
  return { targetLuma, lampGain: litGain, sheen: 0.16 * litGain, pools, darkness: dial };
}
