/**
 * Day → night conversion of every seed frame, in the browser, before
 * `set_image`. **This is the step the whole premise depends on.**
 *
 * Orbis takes its lighting from the seed and the night prompt loses: a daytime
 * Street View frame produces sustained *daytime* video of the right block
 * (docs/reactor-findings.md, Q1), which breaks non-negotiable rule #1 far more
 * thoroughly than flashing a JPEG would. Grading the seed first gives night
 * *and* the real block — same mural, same tree line, same parked cars.
 *
 * This is a port of `docs/spike/nightgrade.py` (numpy + Pillow) to canvas. No
 * API, no key, a few milliseconds. Geometry is untouched, which is the point —
 * the block still has to be recognisable. The graded frame is an intermediate
 * and is never displayed.
 *
 * Two things the spike taught us, both encoded below:
 *   1. Exposure decides whether the block survives. Mean luma 0.043 lost it;
 *      0.061 reproduced it. So exposure is *solved for* a target, not fixed —
 *      which also stops a bright frame and a dim frame grading differently.
 *   2. The sky mask must catch overcast (bright + desaturated), not only blue.
 *      A blueness test alone leaves SF's grey sky hijacking the render.
 */

import { SEED_HEIGHT, SEED_WIDTH } from "@/lib/orbis";
import type { GradeParams, LampPool } from "@/lib/orbis/lighting";

const SODIUM = [1.25, 0.82, 0.45] as const;
const LAMP = [1.0, 0.72, 0.36] as const;
const SKY = [8 / 255, 11 / 255, 24 / 255] as const;
const SKY_HAZE = [0.1, 0.07, 0.05] as const;
/** Added to every pixel before the sky, so no block grades to pure black. */
const AMBIENT_FLOOR = 0.012;
const BASE_EXPOSURE = 0.2;
const HIGHLIGHT_KNEE = 0.72;
const LUMA = [0.2126, 0.7152, 0.0722] as const;

export type NightGradeResult = {
  file: File;
  /** Mean luma of the graded frame — the number Q1 says to watch. */
  meanLuma: number;
  exposure: number;
};

function meanLumaOf(rgb: Float32Array): number {
  let total = 0;
  for (let i = 0; i < rgb.length; i += 3) {
    total += rgb[i] * LUMA[0] + rgb[i + 1] * LUMA[1] + rgb[i + 2] * LUMA[2];
  }
  return total / (rgb.length / 3);
}

/** Three box passes ≈ a gaussian, and cheap enough to not care. */
function blur(channel: Float32Array, width: number, height: number, radius: number) {
  if (radius < 1) return channel;
  let source: Float32Array<ArrayBufferLike> = channel;
  let target: Float32Array<ArrayBufferLike> = new Float32Array(channel.length);
  for (let pass = 0; pass < 3; pass += 1) {
    // horizontal
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let count = 0;
        for (let k = -radius; k <= radius; k += 1) {
          const sx = x + k;
          if (sx < 0 || sx >= width) continue;
          sum += source[row + sx];
          count += 1;
        }
        target[row + x] = sum / count;
      }
    }
    [source, target] = [target, source];
    // vertical
    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < height; y += 1) {
        let sum = 0;
        let count = 0;
        for (let k = -radius; k <= radius; k += 1) {
          const sy = y + k;
          if (sy < 0 || sy >= height) continue;
          sum += source[sy * width + x];
          count += 1;
        }
        target[y * width + x] = sum / count;
      }
    }
    [source, target] = [target, source];
  }
  return source;
}

type Precomputed = {
  rgb: Float32Array;
  skyMask: Float32Array;
  highlight: Float32Array;
  glow: Float32Array;
  width: number;
  height: number;
};

/** One box pass (no repeats) — enough for a local mean/variance. */
function boxOnce(channel: Float32Array, width: number, height: number, radius: number) {
  const horizontal = new Float32Array(channel.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let k = Math.max(0, x - radius); k <= Math.min(width - 1, x + radius); k += 1) {
        sum += channel[row + k];
        count += 1;
      }
      horizontal[row + x] = sum / count;
    }
  }
  const out = new Float32Array(channel.length);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let sum = 0;
      let count = 0;
      for (let k = Math.max(0, y - radius); k <= Math.min(height - 1, y + radius); k += 1) {
        sum += horizontal[k * width + x];
        count += 1;
      }
      out[y * width + x] = sum / count;
    }
  }
  return out;
}

/**
 * Sky = smooth, sky-coloured pixels **connected to the top edge**.
 *
 * The first version flagged any bright desaturated pixel in the top 62% of the
 * frame. On real Mapillary seeds that was 24–52% of the image — pale asphalt,
 * glass and white facades — all painted flat navy with a hard horizontal edge,
 * which read as "a dark blue filter over the top half". Texture and
 * connectivity are what separate sky from a pale wall.
 */
function findSky(rgb: Float32Array, luma: Float32Array, width: number, height: number) {
  const pixels = width * height;
  const squared = new Float32Array(pixels);
  for (let p = 0; p < pixels; p += 1) squared[p] = luma[p] * luma[p];
  const mean = boxOnce(luma, width, height, 3);
  const meanSquared = boxOnce(squared, width, height, 3);

  const candidate = new Uint8Array(pixels);
  for (let p = 0; p < pixels; p += 1) {
    const r = rgb[p * 3];
    const g = rgb[p * 3 + 1];
    const b = rgb[p * 3 + 2];
    const l = luma[p];
    const smooth = Math.sqrt(Math.max(0, meanSquared[p] - mean[p] * mean[p])) < 0.035;
    const blueSky = b - (r + g) / 2 > 0.04 && l > 0.35;
    // Overcast (most of SF): very bright and nearly colourless.
    const greySky = Math.max(r, g, b) - Math.min(r, g, b) < 0.1 && l > 0.62;
    candidate[p] = smooth && (blueSky || greySky) ? 1 : 0;
  }

  const sky = new Float32Array(pixels);
  const queue = new Int32Array(pixels);
  let head = 0;
  let tail = 0;
  for (let x = 0; x < width; x += 1) {
    if (candidate[x]) {
      sky[x] = 1;
      queue[tail++] = x;
    }
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    const neighbours = [p - width, p + width, x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1];
    for (const n of neighbours) {
      if (n < 0 || n >= pixels || sky[n] || !candidate[n]) continue;
      sky[n] = 1;
      queue[tail++] = n;
    }
  }
  return sky;
}

function precompute(rgb: Float32Array, width: number, height: number): Precomputed {
  const pixels = width * height;
  const luma = new Float32Array(pixels);
  for (let p = 0; p < pixels; p += 1) {
    luma[p] = rgb[p * 3] * LUMA[0] + rgb[p * 3 + 1] * LUMA[1] + rgb[p * 3 + 2] * LUMA[2];
  }

  const skyMask = blur(
    findSky(rgb, luma, width, height),
    width,
    height,
    Math.max(1, Math.round(width * 0.006)),
  );

  // Highlights exclude the sky, so a bright overcast sky cannot turn into glow.
  const highlight = new Float32Array(pixels);
  for (let p = 0; p < pixels; p += 1) {
    const h = Math.min(1, Math.max(0, (luma[p] - HIGHLIGHT_KNEE) / (1 - HIGHLIGHT_KNEE)));
    highlight[p] = h * (1 - skyMask[p]);
  }
  const glow = blur(
    Float32Array.from(highlight),
    width,
    height,
    Math.max(2, Math.round(width * 0.015)),
  );

  return { rgb, skyMask, highlight, glow, width, height };
}

function grade(pre: Precomputed, exposure: number, params: GradeParams): Float32Array {
  const { rgb, skyMask, highlight, glow, width, height } = pre;
  const out = new Float32Array(rgb.length);
  const lampGain = params.lampGain;

  for (let p = 0; p < width * height; p += 1) {
    const row = Math.floor(p / width) / height;
    const column = (p % width) / width;

    // Wet asphalt: the lower-centre road picks up a vertical smear of lamp
    // colour, which sells "night street" harder than darkness does.
    const road = Math.min(1, Math.max(0, (row - 0.62) / 0.38));
    const centred = column * 2 - 1;
    const sheen = Math.exp(-(centred * centred) / 0.1) * road * params.sheen;

    // Night sky: deep navy overhead, a faint sodium haze toward the horizon —
    // a gradient, so the sky edge doesn't read as a flat painted band.
    const haze = row * row;

    for (let channel = 0; channel < 3; channel += 1) {
      const index = p * 3 + channel;
      // Night exposure with a gentle toe, plus a small ambient lift so even an
      // unlit block never renders pure black.
      let value = Math.pow(Math.min(1, Math.max(0, rgb[index])), 1.3) * exposure;
      value = value * SODIUM[channel] + AMBIENT_FLOOR * SODIUM[channel];
      // Keep the brightest things bright — windows, signs and the glow at the
      // end of the street become the light sources.
      value +=
        (glow[p] * 0.55 + highlight[p] * 0.3) * LAMP[channel] * lampGain;
      // Sky last, so the glow cannot bleed a daylit sky back in.
      const sky = SKY[channel] + haze * SKY_HAZE[channel];
      value = value * (1 - skyMask[p]) + sky * skyMask[p];
      value += sheen * LAMP[channel];
      out[index] = value;
    }
  }

  return out;
}

/**
 * Paint a pool of light where a lamp actually is. Only ever called with real
 * per-lamp positions (`condition.lighting.lamp_offsets_m`); with no data there
 * are no pools, and the block just gets the generic grade.
 *
 * The projection is a plain pinhole: a ~70° horizontal FOV, camera at 1.6m,
 * lamp head at 8m, so a lamp 15m ahead sits high and wide and one 70m ahead
 * sits small and near the vanishing point.
 */
function paintLampPools(
  rgb: Float32Array,
  width: number,
  height: number,
  pools: LampPool[],
) {
  if (pools.length === 0) return;
  const focal = width / 1.4;
  const horizon = height * 0.46;
  const cameraHeightM = 1.6;
  const lampHeightM = 8;

  for (const pool of pools) {
    if (pool.distanceM < 5) continue;
    const x = width / 2 + (focal * pool.lateralM) / pool.distanceM;
    const y = horizon - (focal * (lampHeightM - cameraHeightM)) / pool.distanceM;
    if (x < -width || x > width * 2 || y < -height) continue;

    const radius = Math.max(6, (focal * 3) / pool.distanceM);
    const intensity = 0.5 * Math.min(1, 25 / pool.distanceM);
    const minX = Math.max(0, Math.floor(x - radius));
    const maxX = Math.min(width - 1, Math.ceil(x + radius));
    const minY = Math.max(0, Math.floor(y - radius));
    const maxY = Math.min(height - 1, Math.ceil(y + radius));

    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        const dx = px - x;
        const dy = py - y;
        const falloff = Math.exp(-(dx * dx + dy * dy) / (2 * (radius / 2) ** 2));
        if (falloff < 0.01) continue;
        const index = (py * width + px) * 3;
        for (let channel = 0; channel < 3; channel += 1) {
          rgb[index + channel] += falloff * intensity * LAMP[channel];
        }
      }
    }
  }
}

function drawCoverCropped(bitmap: ImageBitmap, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not open a 2D canvas for the night grade.");

  // Cover-crop rather than squash: Orbis resizes a non-16:9 seed without
  // cropping, and a distorted seed conditions a distorted street.
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  context.drawImage(
    bitmap,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  return { canvas, context };
}

export async function nightGradeSeed(
  blob: Blob,
  params: GradeParams,
): Promise<NightGradeResult> {
  const bitmap = await createImageBitmap(blob);
  const { canvas, context } = drawCoverCropped(bitmap, SEED_WIDTH, SEED_HEIGHT);
  bitmap.close();

  const image = context.getImageData(0, 0, SEED_WIDTH, SEED_HEIGHT);
  const pixels = SEED_WIDTH * SEED_HEIGHT;
  const rgb = new Float32Array(pixels * 3);
  for (let p = 0; p < pixels; p += 1) {
    rgb[p * 3] = image.data[p * 4] / 255;
    rgb[p * 3 + 1] = image.data[p * 4 + 1] / 255;
    rgb[p * 3 + 2] = image.data[p * 4 + 2] / 255;
  }

  const pre = precompute(rgb, SEED_WIDTH, SEED_HEIGHT);

  // Solve for the exposure that lands on the target mean luma. The grade is
  // close to linear in exposure apart from the additive glow, so two or three
  // passes converge, and a dim source frame no longer grades darker than a
  // bright one — which is exactly how the spike lost block B.
  let exposure = BASE_EXPOSURE;
  let graded = grade(pre, exposure, params);
  let mean = meanLumaOf(graded);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (Math.abs(mean - params.targetLuma) < 0.003 || mean <= 0) break;
    exposure = Math.min(0.9, Math.max(0.02, exposure * (params.targetLuma / mean)));
    graded = grade(pre, exposure, params);
    mean = meanLumaOf(graded);
  }

  paintLampPools(graded, SEED_WIDTH, SEED_HEIGHT, params.pools);

  for (let p = 0; p < pixels; p += 1) {
    image.data[p * 4] = Math.min(255, Math.max(0, graded[p * 3] * 255));
    image.data[p * 4 + 1] = Math.min(255, Math.max(0, graded[p * 3 + 1] * 255));
    image.data[p * 4 + 2] = Math.min(255, Math.max(0, graded[p * 3 + 2] * 255));
    image.data[p * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);

  const output = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.93),
  );
  if (!output) throw new Error("Night grade produced no image.");

  return {
    file: new File([output], "seed-night.jpg", { type: "image/jpeg" }),
    meanLuma: meanLumaOf(graded),
    exposure,
  };
}
