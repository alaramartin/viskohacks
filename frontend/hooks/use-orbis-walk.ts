"use client";

/**
 * The autoplay walk — the primary deliverable.
 *
 * ONE CONTINUOUS GENERATION FOR THE WHOLE ROUTE. Human decision after the
 * Checkpoint 2 review: no cuts, no "next block preparing" holds — the walk
 * should look like footage from a camera someone wore along the route.
 *
 * Why it has to be built this way (docs/reactor-findings.md, Q7): a live
 * generation cannot be re-seeded. `set_image` mid-run — alone, with a prompt
 * change, or between `pause`/`resume` — is accepted and ignored; new imagery
 * only lands after `reset`, which is a ~7s gap and a cut. What does change a
 * live render is `set_prompt`, which `-dynamic` morphs in at the next ~1.8s
 * chunk (Q5). So:
 *
 *   connect → pin seed/resolution → night-grade the first imaged block's frame
 *   → `set_image` → `set_prompt` → `start` → then play the route's shot list
 *   (`route.shots`, planned by `backend/shots.py`): one steady "walking
 *   straight ahead down Jones Street, the street stretching toward the
 *   vanishing point, buildings on the right…" prompt per straight leg, a ~4s
 *   "turning right at the intersection onto Turk Street" cue per corner, then
 *   arrive. The prompt changes only at shot boundaries.
 *
 * Real imagery grounds the start; after that the render is steered by text.
 * The evidence readout's "Street imagery" fact says so per block (rule 4).
 *
 * `applyConditions(route)` swaps in the same route recomputed for new
 * conditions (time, fog, crowd) and morphs the live render immediately — the
 * hook for Phase 3's real-time controls.
 */

import { useReactor, useReactorMessage } from "@reactor-team/js-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchSeedImage, imageryUrl } from "@/lib/api";
import type { Route } from "@/lib/contract";
import { ORBIS_RESOLUTION } from "@/lib/orbis";
import { groupIntoBlocks, type Block } from "@/lib/orbis/blocks";
import { shotsOf } from "@/lib/orbis/shots";
import { describeAmbient, estimateAmbient } from "@/lib/orbis/ambient";
import { estimateLighting, gradeParamsFor } from "@/lib/orbis/lighting";
import { nightGradeSeed } from "@/lib/orbis/nightgrade";
import {
  morphAudioPrompt,
  morphPrompt,
  pinRouteSession,
  resetGeneration,
  seedBlock,
  type OrbisContext,
} from "@/lib/orbis/session";
import { OrbisSignals } from "@/lib/orbis/signals";
import { VideoGate } from "@/lib/orbis/video-gate";
import { WalkTrace } from "@/lib/orbis/walk-trace";

/** Giving-up point for the new street's first frames after a corner. */
const CORNER_TIMEOUT_MS = 20_000;

type ReactorIntrospection = { getSchema?: () => unknown; getCapabilities?: () => unknown };

/** Cold start is ~12–16s (Q4); this is the giving-up point. */
const FIRST_FRAME_TIMEOUT_MS = 30_000;
/** Let the last "coming to a stop" morph play out before closing the session. */
const ARRIVAL_LINGER_MS = 4_000;
/**
 * 429 `concurrent_sessions_per_model` right after a walk: the old session is
 * still being released. Retry slowly and only a few times — every connect
 * attempt counts against Reactor's separate `sessions_per_minute` limit (10).
 * A 3s retry loop hit that limit in ~30s in browser testing and turned a short
 * wait into a lockout.
 */
const SESSION_BUSY_RETRY_MS = 15_000;
const SESSION_BUSY_MAX_ATTEMPTS = 4;
/** A warmed-up session with no walk started is closed after this. */
const WARM_IDLE_MS = 90_000;

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/** The one session slot is taken (someone else's walk, or ours still closing). */
function isSlotBusy(caught: unknown): boolean {
  return /concurrent_sessions_per_model/i.test(errorText(caught));
}

/** Too many session creations in the last minute. Retrying only makes it worse. */
function isRateLimited(caught: unknown): boolean {
  return /sessions_per_minute/i.test(errorText(caught));
}

export type WalkPhase =
  | "idle"
  | "connecting"
  | "preparing"
  | "holding"
  | "walking"
  | "unavailable"
  | "finished"
  | "error";

export type WalkSnapshot = {
  phase: WalkPhase;
  statusText: string;
  error: string | null;
  route: Route | null;
  blocks: Block[];
  blockIndex: number;
  waypointIndex: number;
  /** Kept for the viewport's cover; the continuous walk never shows it. */
  unavailableReason: string | null;
  /** Diagnostics about the seed we fed Orbis — handy when the start looks wrong. */
  seedNote: string | null;
  imageConditioned: boolean | null;
};

const INITIAL: WalkSnapshot = {
  phase: "idle",
  statusText: "",
  error: null,
  route: null,
  blocks: [],
  blockIndex: 0,
  waypointIndex: 0,
  unavailableReason: null,
  seedNote: null,
  imageConditioned: null,
};

class WalkCancelled extends Error {}

/**
 * What `applyConditions` did. `geometry-changed` means the backend returned a
 * different walk for the new settings, which is a restart, not a morph.
 */
export type ApplyConditionsResult = "applied" | "geometry-changed" | "not-running";

type RunHandle = {
  cancelled: boolean;
  /** Bumped by applyConditions so the walk loop re-sends the current prompt at once. */
  conditionsVersion: number;
};

/** Deterministic noise seed per route, so a rerun of the demo looks the same. */
function seedFromString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 1_000_000;
}

/** Same geometry, possibly new conditions — anything else is a different route. */
function sameGeometry(a: Route, b: Route): boolean {
  return (
    a.route_id === b.route_id &&
    a.waypoints.length === b.waypoints.length &&
    shotsOf(a).length === shotsOf(b).length &&
    a.waypoints.every((waypoint, index) => waypoint.block_id === b.waypoints[index].block_id)
  );
}

export type UseOrbisWalkOptions = {
  /** Fired the first time real frames reach the screen. */
  onFirstFrame?: () => void;
};

export function useOrbisWalk(options: UseOrbisWalkOptions = {}) {
  const { status, connect, disconnect, sendCommand, uploadFile, reactor } = useReactor(
    (state) => ({
      status: state.status,
      connect: state.connect,
      disconnect: state.disconnect,
      sendCommand: state.sendCommand,
      uploadFile: state.uploadFile,
      // Dev trace only: the model's own command schema.
      reactor: (state as unknown as { internal?: { reactor?: ReactorIntrospection } }).internal?.reactor,
    }),
  );

  const [snapshot, setSnapshot] = useState<WalkSnapshot>(INITIAL);
  const [muted, setMuted] = useState(false);

  const signals = useMemo(() => new OrbisSignals(), []);
  const gate = useMemo(() => new VideoGate(), []);
  const trace = useMemo(() => new WalkTrace(), []);
  const runRef = useRef<RunHandle | null>(null);
  const routeRef = useRef<Route | null>(null);
  const statusRef = useRef(status);
  const connecting = useRef<Promise<void> | null>(null);
  const onFirstFrame = useRef(options.onFirstFrame);

  onFirstFrame.current = options.onFirstFrame;
  statusRef.current = status;

  useReactorMessage((message) => {
    signals.handle(message);
    if (trace.enabled) {
      const type = (message as { type?: string; data?: { type?: string } })?.data?.type
        ?? (message as { type?: string })?.type;
      if (!/chunk/i.test(String(type))) trace.log("message", message);
    }
  });

  const patch = useCallback((next: Partial<WalkSnapshot>) => {
    setSnapshot((current) => ({ ...current, ...next }));
  }, []);

  const retryingRef = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A dead session cannot be reused, so the next warm-up has to mint a new one —
  // except mid-retry, where a failed attempt also reads as "disconnected".
  useEffect(() => {
    if (status === "disconnected" && !retryingRef.current) connecting.current = null;
  }, [status]);

  /**
   * Connect at most once, and let a second caller wait on the first attempt
   * rather than opening a second session — the account has exactly one slot.
   *
   * A 429 (`concurrent_sessions_per_model`) right after a walk is usually the
   * previous session still being released server-side, so wait and retry for
   * up to a minute instead of failing the walk. Seen in human testing: Stop
   * walk, then the setup panel's warm-up reconnected immediately and got 429.
   */
  const ensureConnected = useCallback(
    async (waitForSlot: boolean) => {
      if (statusRef.current === "ready") return;
      connecting.current ??= (async () => {
        retryingRef.current = true;
        try {
          for (let attempt = 1; ; attempt += 1) {
            try {
              await connect();
              return;
            } catch (caught) {
              if (isRateLimited(caught)) {
                throw new Error(
                  "Reactor allows 10 new sessions a minute and that limit was just hit. Wait a minute, then try again.",
                );
              }
              // Only a real walk waits for the slot; a warm-up that finds it busy just
              // gives up quietly rather than spending the per-minute session budget.
              if (!waitForSlot || !isSlotBusy(caught) || attempt >= SESSION_BUSY_MAX_ATTEMPTS) {
                if (isSlotBusy(caught)) {
                  throw new Error(
                    "Another Orbis session is still using the account's only slot — someone else's walk, or one still closing. Try again in a minute.",
                  );
                }
                throw caught;
              }
              patch({ statusText: "Waiting for the previous Orbis session to close" });
              await disconnect().catch(() => {});
              await new Promise((resolve) => setTimeout(resolve, SESSION_BUSY_RETRY_MS));
            }
          }
        } finally {
          retryingRef.current = false;
        }
      })().catch((caught) => {
        connecting.current = null;
        throw caught;
      });
      await connecting.current;
    },
    [connect, disconnect, patch],
  );

  /**
   * Start connecting the moment someone touches the setup panel (~7s saved).
   * A warm session nobody walks is closed again after a while — otherwise it
   * holds the account's only slot for everyone.
   */
  const warmUp = useCallback(() => {
    if (runRef.current) return;
    void ensureConnected(false)
      .then(() => {
        if (idleTimer.current) clearTimeout(idleTimer.current);
        idleTimer.current = setTimeout(() => {
          if (!runRef.current) void disconnect().catch(() => {});
        }, WARM_IDLE_MS);
      })
      .catch(() => {});
  }, [disconnect, ensureConnected]);

  const context = useMemo<OrbisContext>(
    () => ({
      sendCommand: (command, data) => {
        trace.log("command", {
          command,
          data: data && JSON.parse(JSON.stringify(data, (_key, value) => (value instanceof Blob ? "<file>" : value))),
        });
        return sendCommand(command, data ?? {});
      },
      uploadFile: (file, fileOptions) => uploadFile(file, fileOptions),
      signals,
    }),
    [sendCommand, signals, trace, uploadFile],
  );

  const sleep = useCallback(async (ms: number, run: RunHandle, wakeOnConditions = false) => {
    const until = Date.now() + ms;
    const version = run.conditionsVersion;
    while (Date.now() < until) {
      if (run.cancelled) throw new WalkCancelled();
      if (wakeOnConditions && run.conditionsVersion !== version) return;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(150, Math.max(0, until - Date.now()))),
      );
    }
    if (run.cancelled) throw new WalkCancelled();
  }, []);

  /**
   * Fetch a block's seed frame and convert it to the light at the requested
   * time. Needs no session.
   *
   * `lighting` says where the light comes from, `ambient` how much of it there
   * is; the grade needs both. At 7pm the same block comes back as dusk, at 11pm
   * as night, and neither as black.
   */
  const prepareSeed = useCallback(async (block: Block) => {
    const seedWaypoint = block.seedWaypoint;
    const seedUrl = seedWaypoint ? imageryUrl(seedWaypoint) : null;
    if (!seedWaypoint || !seedUrl) throw new Error("No imagery for this block.");
    const frame = await fetchSeedImage(seedUrl);
    const lighting = estimateLighting(seedWaypoint.condition);
    const ambient = estimateAmbient(seedWaypoint.condition);
    const graded = await nightGradeSeed(frame, gradeParamsFor(lighting, ambient.darkness));
    return { graded, lighting, ambient };
  }, []);

  /**
   * Play the route's shot list inside the one live generation. The prompt
   * changes only at a shot boundary — one steady prompt per straight leg, one
   * short cue per turn — because a new prompt every waypoint made the render
   * wander (sideways, into walls, doubling back). A condition change re-sends
   * the current shot's prompt at once. The evidence strip and minimap advance
   * through the shot's waypoints as it plays.
   */
  const walkRoute = useCallback(
    async (run: RunHandle, blocks: Block[]) => {
      const initial = routeRef.current;
      if (!initial) return;
      const blockOf = new Map<string, number>(blocks.map((block) => [block.blockId, block.index]));
      const shotCount = shotsOf(initial).length;
      // The first shot's prompt went in with `start`.
      let sentVideo: string | null = shotsOf(initial)[0]?.video_prompt ?? null;
      let sentAudio: string | null = shotsOf(initial)[0]?.audio_prompt ?? null;
      let shownIndex = -1;
      // Grade every block's real frame up front, so a corner doesn't wait on it.
      // Graded for the conditions at walk start; re-graded at the corner if they changed.
      const prepared = new Map<string, Promise<File | null>>();
      for (const block of blocks) {
        if (!block.imageAvailable) continue;
        prepared.set(block.blockId, prepareSeed(block).then((result) => result.graded.file, () => null));
      }
      const preparedVersion = run.conditionsVersion;

      for (let s = 0; s < shotCount; s += 1) {
        const startedAt = Date.now();
        let version = -1;
        {
          const shot = shotsOf(routeRef.current ?? initial)[s];
          const route = routeRef.current ?? initial;
          const blockId = route.waypoints[shot.waypoint_start].block_id;
          // CORNER TRANSITION. Orbis follows neither a turn prompt nor a mid-run
          // set_image (docs/reactor-findings.md, "Walk trace"), so the corner is a
          // reset onto the next street's real frame, covered by a head-turn pan.
          if (shot.kind === "turn" && prepared.has(blockId)) {
            let file: File | null = null;
            if (run.conditionsVersion === preparedVersion) {
              file = await prepared.get(blockId) ?? null;
            } else {
              const current = groupIntoBlocks(route).find((block) => block.blockId === blockId);
              file = current ? await prepareSeed(current).then((r) => r.graded.file, () => null) : null;
            }
            if (file) {
              const side = /turning (left|right)/.exec(shot.video_prompt)?.[1] === "left" ? "left" : "right";
              const nextWalk = shotsOf(route)[s + 1] ?? shot;
              trace.log("corner_transition", { index: s, side, block_id: blockId });
              patch({ waypointIndex: shot.waypoint_start, blockIndex: blockOf.get(blockId) ?? 0 });
              const stopPan = gate.turnTransition(file, side);
              try {
                await resetGeneration(context);
                if (run.cancelled) throw new WalkCancelled();
                await seedBlock(context, {
                  image: file,
                  videoPrompt: nextWalk.video_prompt,
                  audioPrompt: nextWalk.audio_prompt,
                });
                sentVideo = nextWalk.video_prompt;
                sentAudio = nextWalk.audio_prompt;
                const outcome = await gate.waitForLiveFrames({
                  timeoutMs: CORNER_TIMEOUT_MS,
                  isCancelled: () => run.cancelled,
                });
                if (outcome === "cancelled") throw new WalkCancelled();
              } finally {
                stopPan();
                gate.release();
              }
              trace.log("corner_live", { index: s });
              continue;
            }
          }
          trace.log("shot_start", {
            index: s,
            kind: shot.kind,
            duration_ms: shot.duration_ms,
            waypoint_start: shot.waypoint_start,
            waypoint_end: shot.waypoint_end,
            video_prompt: shot.video_prompt,
          });
        }
        for (;;) {
          if (run.cancelled) throw new WalkCancelled();
          const route = routeRef.current ?? initial;
          const shot = shotsOf(route)[s];
          const elapsed = Date.now() - startedAt;
          if (elapsed >= shot.duration_ms) break;

          if (version !== run.conditionsVersion) {
            version = run.conditionsVersion;
            patch({ route });
            if (shot.video_prompt && shot.video_prompt !== sentVideo) {
              await morphPrompt(context, shot.video_prompt);
              sentVideo = shot.video_prompt;
            }
            if (shot.audio_prompt && shot.audio_prompt !== sentAudio) {
              // Audio morphing mid-run is unverified; never let it stop the walk.
              await morphAudioPrompt(context, shot.audio_prompt).catch(() => {});
              sentAudio = shot.audio_prompt;
            }
          }

          const progress = Math.min(1, elapsed / shot.duration_ms);
          const index = Math.round(
            shot.waypoint_start + progress * (shot.waypoint_end - shot.waypoint_start),
          );
          if (index !== shownIndex) {
            shownIndex = index;
            trace.log("waypoint", {
              index,
              lat: route.waypoints[index].lat,
              lng: route.waypoints[index].lng,
              heading: route.waypoints[index].heading,
              block_id: route.waypoints[index].block_id,
            });
            patch({
              waypointIndex: index,
              blockIndex: blockOf.get(route.waypoints[index].block_id) ?? 0,
            });
          }
          await sleep(Math.min(400, Math.max(0, shot.duration_ms - elapsed)), run, true);
        }
      }
    },
    [context, gate, patch, prepareSeed, sleep, trace],
  );

  const stop = useCallback(() => {
    const run = runRef.current;
    if (!run) return;
    run.cancelled = true;
    signals.abort("Walk stopped.");
    // Free the slot now rather than when the loop next notices; the walk's own
    // `finally` disconnect afterwards is a no-op.
    void disconnect().catch(() => {});
  }, [disconnect, signals]);

  /**
   * Real-time conditions — the Phase 3 deliverable. The same route recomputed
   * for a new time, fog or crowd setting, applied to the *running* generation:
   * no `reset`, no reconnect, no hold card, no "preparing".
   *
   * Prompt only, and that is not a shortcut. Q7 measured all three ways of
   * changing the imagery mid-generation (`set_image`, `set_image` + prompt,
   * `pause`/`set_image`/`resume`): Orbis accepts each and ignores each — new
   * imagery lands only after `reset`, which is the ~7s cut this whole walk is
   * built to avoid. `set_prompt` is the one lever that reaches a live render,
   * and `-dynamic` morphs it in at the next ~1.8s chunk (Q5).
   *
   * So the seed keeps the geometry it started with and the light changes by
   * text. The walk loop picks the bump up within ~150ms and re-sends the
   * current shot's prompt straight away, rather than waiting for the next shot
   * boundary — the change has to be visible while the viewer is still looking
   * at the control they moved.
   */
  const applyConditions = useCallback((next: Route): ApplyConditionsResult => {
    const run = runRef.current;
    const current = routeRef.current;
    if (!run || !current) return "not-running";
    // Conditions may only change the light, never the walk. A different shape
    // means the backend recomputed the geometry too, and morphing a prompt for
    // a route we are not walking would describe a street that isn't there.
    if (!sameGeometry(current, next)) return "geometry-changed";
    routeRef.current = next;
    run.conditionsVersion += 1;
    return "applied";
  }, []);

  const start = useCallback(
    async (routeSource: Route | Promise<Route>) => {
      if (runRef.current) return;
      const run: RunHandle = { cancelled: false, conditionsVersion: 0 };
      runRef.current = run;
      if (idleTimer.current) clearTimeout(idleTimer.current);
      setSnapshot({ ...INITIAL, phase: "connecting", statusText: "Connecting to Orbis" });

      try {
        // Opening the session, computing the routes and preparing the seed
        // frame don't depend on each other; stacked, they are the cold start.
        const connected = ensureConnected(true);
        connected.catch(() => {});
        const route = await Promise.resolve(routeSource);
        if (run.cancelled) throw new WalkCancelled();
        routeRef.current = route;
        trace.begin({ route });

        const blocks = groupIntoBlocks(route);
        patch({ route, blocks });
        // The walk is seeded once, from the first block that has imagery. A
        // route with none anywhere can't be grounded at all.
        const seedBlockInfo = blocks.find((block) => block.imageAvailable) ?? null;
        if (!seedBlockInfo) {
          throw new Error("No street-level imagery anywhere on this route, so there is nothing to ground the walk in.");
        }
        const prepared = prepareSeed(seedBlockInfo);
        prepared.catch(() => {});

        await connected;
        if (run.cancelled) throw new WalkCancelled();
        trace.log("model_schema", { schema: reactor?.getSchema?.(), capabilities: reactor?.getCapabilities?.() });

        await pinRouteSession(context, {
          // Pinned so weather and lighting realisation stay stable for the walk.
          seed: seedFromString(`${route.route_id}:${route.waypoints.length}`),
          resolution: ORBIS_RESOLUTION,
        });

        patch({ phase: "preparing", statusText: "Grading the first block for the time of day" });
        // The daytime frame is converted before it reaches Orbis and is never
        // displayed either way — it is an intermediate, not an answer.
        const { graded, lighting, ambient } = await prepared;
        if (run.cancelled) throw new WalkCancelled();
        patch({
          seedNote: `seed mean luma ${graded.meanLuma.toFixed(3)} · ${describeAmbient(ambient)} · lighting from ${lighting.source}`,
          statusText: "Starting the walk",
        });

        const firstShot = shotsOf(route)[0];
        const seeded = await seedBlock(context, {
          image: graded.file,
          videoPrompt: firstShot.video_prompt,
          audioPrompt: firstShot.audio_prompt,
        });
        patch({ imageConditioned: seeded.imageConditioned });

        const outcome = await gate.waitForLiveFrames({
          timeoutMs: FIRST_FRAME_TIMEOUT_MS,
          isCancelled: () => run.cancelled,
        });
        if (outcome === "cancelled") throw new WalkCancelled();

        gate.release();
        trace.log("first_frame");
        trace.startFrames(document.querySelector<HTMLVideoElement>("video"));
        patch({ phase: "walking", statusText: "Walking" });
        onFirstFrame.current?.();

        await walkRoute(run, blocks);
        await sleep(ARRIVAL_LINGER_MS, run);
        // Keep the arrival on screen under the "End of route" card.
        gate.freeze();
        patch({ phase: "finished", statusText: "End of route" });
      } catch (caught) {
        if (!(caught instanceof WalkCancelled)) {
          patch({
            phase: "error",
            error: caught instanceof Error ? caught.message : String(caught),
            statusText: "",
          });
        } else {
          gate.release();
          patch({ phase: "idle", statusText: "" });
        }
      } finally {
        // Q3: a leaked session holds the account's only slot until it ages out,
        // and there is no REST endpoint to kill it. Always disconnect.
        signals.abort("Session closed.");
        void trace.end();
        try {
          await disconnect();
        } catch {
          /* teardown noise is not worth surfacing */
        }
        runRef.current = null;
      }
    },
    [context, disconnect, ensureConnected, gate, patch, prepareSeed, reactor, signals, sleep, trace, walkRoute],
  );

  // Same rule on unmount: a closed tab must not take the slot with it.
  useEffect(
    () => () => {
      const run = runRef.current;
      if (run) run.cancelled = true;
      signals.abort("Component unmounted.");
      if (idleTimer.current) clearTimeout(idleTimer.current);
      void disconnect().catch(() => {});
    },
    [disconnect, signals],
  );

  // A reload or tab close doesn't unmount React, so it never reached the cleanup
  // above and leaked the session until Reactor timed it out. Best effort.
  useEffect(() => {
    const onPageHide = () => {
      const run = runRef.current;
      if (run) run.cancelled = true;
      void disconnect().catch(() => {});
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [disconnect]);

  const waypoint = snapshot.route?.waypoints[snapshot.waypointIndex] ?? null;
  const block = snapshot.blocks[snapshot.blockIndex] ?? null;

  return {
    ...snapshot,
    status,
    waypoint,
    block,
    blockCount: snapshot.blocks.length,
    muted,
    toggleMuted: () => setMuted((current) => !current),
    setMuted,
    gate,
    start,
    stop,
    warmUp,
    applyConditions,
    isRunning: snapshot.phase !== "idle" && snapshot.phase !== "error" && snapshot.phase !== "finished",
  };
}

export type WalkController = ReturnType<typeof useOrbisWalk>;
