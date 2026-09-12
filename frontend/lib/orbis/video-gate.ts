/**
 * Hold-until-ready, and the hard cut at the end of it.
 *
 * Non-negotiable rules #1 and #2: never display an unready segment, never show
 * a raw daytime photo, and never crossfade. There is a real gap to cover —
 * ~12–16s at route start and ~7–8s at every block boundary (~2.3s of commands
 * plus ~5–6s before the new generation emits its first visible frame, spike
 * Q4/Q6). What we show across it is the **last live frame of the previous
 * block**, frozen onto a canvas laid over the video, and the cut happens the
 * instant real frames resume.
 *
 * "Real frames resume" cannot be taken from `generation_started` — that fires
 * about six seconds early. So we watch the pixels: live generated video both
 * moves and is not black.
 */

const SAMPLE_WIDTH = 32;
const SAMPLE_HEIGHT = 18;
const SAMPLE_INTERVAL_MS = 120;
/** Mean-luma floor below which a frame is "black", not content. */
const BLACK_LEVEL = 0.02;
/** Mean per-pixel change between samples that counts as motion. */
const MOTION_LEVEL = 0.008;

export type LiveFrameOutcome = "live" | "timeout" | "cancelled";

export class VideoGate {
  private video: HTMLVideoElement | null = null;
  private hold: HTMLCanvasElement | null = null;
  private sampler: HTMLCanvasElement | null = null;
  private baseline: Float32Array | null = null;
  private frozen = false;

  attach(video: HTMLVideoElement | null, hold: HTMLCanvasElement | null) {
    this.video = video;
    this.hold = hold;
    if (hold) hold.style.display = this.frozen ? "block" : "none";
  }

  get isFrozen() {
    return this.frozen;
  }

  /**
   * Freeze the current picture. Called before `reset`, while the outgoing block
   * is still on screen — after the reset there is nothing left to copy.
   *
   * Returns false when there was no live frame to capture (route start, or the
   * block before this one was unavailable). The caller must then cover the
   * viewport some other way: showing whatever the canvas still held would put a
   * stale block back on screen as if we had walked it.
   */
  freeze(): boolean {
    this.frozen = true;
    const video = this.video;
    const hold = this.hold;
    if (!hold) return false;

    if (!video || video.videoWidth === 0) {
      this.baseline = null;
      hold.style.display = "none";
      return false;
    }

    hold.width = video.videoWidth;
    hold.height = video.videoHeight;
    hold.getContext("2d")?.drawImage(video, 0, 0);
    this.baseline = this.sample();
    hold.style.display = "block";
    return true;
  }

  /** Hard cut to the live render. No fade — that was decided deliberately. */
  release() {
    this.frozen = false;
    this.baseline = null;
    if (this.hold) this.hold.style.display = "none";
  }

  private sample(): Float32Array | null {
    const video = this.video;
    if (!video || video.videoWidth === 0) return null;
    if (!this.sampler) {
      this.sampler = document.createElement("canvas");
      this.sampler.width = SAMPLE_WIDTH;
      this.sampler.height = SAMPLE_HEIGHT;
    }
    const context = this.sampler.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const { data } = context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const luma = new Float32Array(SAMPLE_WIDTH * SAMPLE_HEIGHT);
    for (let p = 0; p < luma.length; p += 1) {
      luma[p] =
        (data[p * 4] * 0.2126 + data[p * 4 + 1] * 0.7152 + data[p * 4 + 2] * 0.0722) /
        255;
    }
    return luma;
  }

  private static meanAbsDiff(a: Float32Array, b: Float32Array): number {
    let total = 0;
    for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i]);
    return total / a.length;
  }

  private static mean(values: Float32Array): number {
    let total = 0;
    for (let i = 0; i < values.length; i += 1) total += values[i];
    return total / values.length;
  }

  /**
   * Resolve once the video is genuinely showing the new block: a sample that is
   * not black and differs from the frame we are holding. Motion alone is too
   * strict a test — a slow night street can change by less than the threshold
   * between samples, which held the first cut of a walk ~7s longer than it
   * needed to. On timeout we cut anyway: a stale still held forever is worse
   * than a late cut.
   */
  waitForLiveFrames(options: {
    timeoutMs: number;
    isCancelled?: () => boolean;
  }): Promise<LiveFrameOutcome> {
    return new Promise<LiveFrameOutcome>((resolve) => {
      const startedAt = Date.now();
      let previous: Float32Array | null = null;
      let liveSamples = 0;

      const timer = setInterval(() => {
        if (options.isCancelled?.()) {
          clearInterval(timer);
          resolve("cancelled");
          return;
        }
        if (Date.now() - startedAt > options.timeoutMs) {
          clearInterval(timer);
          resolve("timeout");
          return;
        }

        const current = this.sample();
        if (!current) return;

        const isContent = VideoGate.mean(current) > BLACK_LEVEL;
        // With a frame held, "new" means different from it — the track can keep
        // repeating the last decoded frame after a reset. With nothing held
        // (route start, or after an unavailable block) any content is new.
        const isNew =
          this.baseline === null ||
          VideoGate.meanAbsDiff(this.baseline, current) > MOTION_LEVEL ||
          (previous !== null && VideoGate.meanAbsDiff(previous, current) > MOTION_LEVEL);
        previous = current;

        if (isContent && isNew) {
          liveSamples += 1;
          // Two in a row, so a single decode blip cannot trigger the cut.
          if (liveSamples >= 2) {
            clearInterval(timer);
            resolve("live");
          }
        } else {
          liveSamples = 0;
        }
      }, SAMPLE_INTERVAL_MS);
    });
  }
}
