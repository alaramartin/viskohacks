/**
 * Dev-only walk trace. Enabled with `?trace=<run-name>` on the app URL.
 *
 * Records every command sent to Orbis (with its payload and the time since the
 * walk started), every non-chunk message back, which shot and waypoint the
 * script is on, the model's own command schema, and a frame from the viewport
 * every FRAME_EVERY_MS. Everything lands in `docs/spike/runs/<run>/` through the
 * spike capture route, so a run can be laid out as a timeline afterwards:
 * "this prompt went in at 34.2s, and this is what was on screen".
 *
 * Built to answer "is the model being steered badly, or not steered at all"
 * after human review found the walk does not follow the route.
 */

const FRAME_EVERY_MS = 1_500;
const FLUSH_EVERY_MS = 10_000;
const FRAME_WIDTH = 480;
const FRAME_HEIGHT = 270;

export type TraceEvent = {
  /** ms since the trace started. */
  t: number;
  kind: string;
  detail?: unknown;
};

async function post(run: string, body: Record<string, unknown>) {
  await fetch("/api/spike/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run, ...body }),
  }).catch(() => {});
}

export class WalkTrace {
  readonly run: string | null;
  private t0 = 0;
  private events: TraceEvent[] = [];
  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private frames = 0;

  constructor() {
    this.run =
      typeof window === "undefined" || process.env.NODE_ENV === "production"
        ? null
        : new URLSearchParams(window.location.search).get("trace");
  }

  get enabled() {
    return Boolean(this.run);
  }

  begin(detail?: unknown) {
    if (!this.run) return;
    this.t0 = performance.now();
    this.events = [];
    this.frames = 0;
    this.log("trace_begin", detail);
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_EVERY_MS);
  }

  log(kind: string, detail?: unknown) {
    if (!this.run) return;
    this.events.push({ t: Math.round(performance.now() - this.t0), kind, detail });
  }

  /** Start grabbing frames from the viewport's <video>. */
  startFrames(video: HTMLVideoElement | null) {
    if (!this.run || !video || this.frameTimer) return;
    this.canvas ??= document.createElement("canvas");
    this.canvas.width = FRAME_WIDTH;
    this.canvas.height = FRAME_HEIGHT;
    this.frameTimer = setInterval(() => {
      if (!this.run || !this.canvas || video.videoWidth === 0) return;
      const context = this.canvas.getContext("2d");
      if (!context) return;
      context.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
      const t = Math.round(performance.now() - this.t0);
      const name = `frame-${String(t).padStart(6, "0")}`;
      this.frames += 1;
      this.log("frame", { name });
      void post(this.run, { name, dataUrl: this.canvas.toDataURL("image/jpeg", 0.8) });
    }, FRAME_EVERY_MS);
  }

  async end(detail?: unknown) {
    if (!this.run) return;
    this.log("trace_end", { ...(detail as object), frames: this.frames });
    if (this.frameTimer) clearInterval(this.frameTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.frameTimer = null;
    this.flushTimer = null;
    await this.flush();
  }

  private async flush() {
    if (!this.run) return;
    await post(this.run, { name: "trace", text: JSON.stringify(this.events, null, 1) });
  }
}
