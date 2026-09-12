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
 *   → `set_image` → `set_prompt` → `start` → then, on a steady clock, morph to
 *   each waypoint's `video_prompt`, which carries the backend's motion cue
 *   ("crossing the street at the crosswalk, then turning left onto
 *   Leavenworth Street") and that spot's conditions.
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
import { WAYPOINT_DWELL_MS, groupIntoBlocks, type Block } from "@/lib/orbis/blocks";
import { estimateLighting, gradeParamsFor } from "@/lib/orbis/lighting";
import { nightGradeSeed } from "@/lib/orbis/nightgrade";
import {
  morphAudioPrompt,
  morphPrompt,
  pinRouteSession,
  seedBlock,
  type OrbisContext,
} from "@/lib/orbis/session";
import { OrbisSignals } from "@/lib/orbis/signals";
import { VideoGate } from "@/lib/orbis/video-gate";

/** Cold start is ~12–16s (Q4); this is the giving-up point. */
const FIRST_FRAME_TIMEOUT_MS = 30_000;
/** Let the last "coming to a stop" morph play out before closing the session. */
const ARRIVAL_LINGER_MS = 4_000;

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
    a.waypoints.every((waypoint, index) => waypoint.block_id === b.waypoints[index].block_id)
  );
}

export type UseOrbisWalkOptions = {
  /** Fired the first time real frames reach the screen. */
  onFirstFrame?: () => void;
};

export function useOrbisWalk(options: UseOrbisWalkOptions = {}) {
  const { status, connect, disconnect, sendCommand, uploadFile } = useReactor(
    (state) => ({
      status: state.status,
      connect: state.connect,
      disconnect: state.disconnect,
      sendCommand: state.sendCommand,
      uploadFile: state.uploadFile,
    }),
  );

  const [snapshot, setSnapshot] = useState<WalkSnapshot>(INITIAL);
  const [muted, setMuted] = useState(false);

  const signals = useMemo(() => new OrbisSignals(), []);
  const gate = useMemo(() => new VideoGate(), []);
  const runRef = useRef<RunHandle | null>(null);
  const routeRef = useRef<Route | null>(null);
  const statusRef = useRef(status);
  const connecting = useRef<Promise<void> | null>(null);
  const onFirstFrame = useRef(options.onFirstFrame);

  onFirstFrame.current = options.onFirstFrame;
  statusRef.current = status;

  useReactorMessage((message) => signals.handle(message));

  // A dead session cannot be reused, so the next warm-up has to mint a new one.
  useEffect(() => {
    if (status === "disconnected") connecting.current = null;
  }, [status]);

  /**
   * Connect at most once, and let a second caller wait on the first attempt
   * rather than opening a second session — the account has exactly one slot.
   */
  const ensureConnected = useCallback(async () => {
    if (statusRef.current === "ready") return;
    connecting.current ??= connect().catch((caught) => {
      connecting.current = null;
      throw caught;
    });
    await connecting.current;
  }, [connect]);

  /** Start connecting the moment someone touches the setup panel (~7s saved). */
  const warmUp = useCallback(() => {
    if (runRef.current) return;
    void ensureConnected().catch(() => {});
  }, [ensureConnected]);

  const patch = useCallback((next: Partial<WalkSnapshot>) => {
    setSnapshot((current) => ({ ...current, ...next }));
  }, []);

  const context = useMemo<OrbisContext>(
    () => ({
      sendCommand: (command, data) => sendCommand(command, data ?? {}),
      uploadFile: (file, fileOptions) => uploadFile(file, fileOptions),
      signals,
    }),
    [sendCommand, signals, uploadFile],
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

  /** Fetch a block's seed frame and convert it to night. Needs no session. */
  const prepareSeed = useCallback(async (block: Block) => {
    const seedWaypoint = block.seedWaypoint;
    const seedUrl = seedWaypoint ? imageryUrl(seedWaypoint) : null;
    if (!seedWaypoint || !seedUrl) throw new Error("No imagery for this block.");
    const frame = await fetchSeedImage(seedUrl);
    const lighting = estimateLighting(seedWaypoint.condition);
    const graded = await nightGradeSeed(frame, gradeParamsFor(lighting));
    return { graded, lighting };
  }, []);

  /**
   * Walk every waypoint on a steady clock inside the one live generation.
   * Prompts morph (no cuts); a condition change re-sends the current
   * waypoint's prompt straight away instead of waiting for the next one.
   */
  const walkRoute = useCallback(
    async (run: RunHandle, blocks: Block[]) => {
      const initial = routeRef.current;
      if (!initial) return;
      let sentVideo: string | null = initial.waypoints[0]?.condition.video_prompt ?? null;
      let sentAudio: string | null = initial.waypoints[0]?.condition.audio_prompt ?? null;
      const blockOf = new Map<string, number>(blocks.map((block) => [block.blockId, block.index]));

      for (let index = 0; index < initial.waypoints.length; index += 1) {
        let version = -1;
        const deadline = Date.now() + WAYPOINT_DWELL_MS;
        while (Date.now() < deadline) {
          if (run.cancelled) throw new WalkCancelled();
          if (version !== run.conditionsVersion) {
            version = run.conditionsVersion;
            const waypoint = (routeRef.current ?? initial).waypoints[index];
            patch({
              route: routeRef.current,
              waypointIndex: index,
              blockIndex: blockOf.get(waypoint.block_id) ?? 0,
            });
            const { video_prompt: video, audio_prompt: audio } = waypoint.condition;
            if (video && video !== sentVideo) {
              await morphPrompt(context, video);
              sentVideo = video;
            }
            if (audio && audio !== sentAudio) {
              // Audio morphing mid-run is unverified; never let it stop the walk.
              await morphAudioPrompt(context, audio).catch(() => {});
              sentAudio = audio;
            }
          }
          await sleep(Math.max(0, deadline - Date.now()), run, true);
        }
      }
    },
    [context, patch, sleep],
  );

  const stop = useCallback(() => {
    const run = runRef.current;
    if (!run) return;
    run.cancelled = true;
    signals.abort("Walk stopped.");
  }, [signals]);

  /**
   * Real-time conditions: the same route recomputed for a new time, fog or
   * crowd setting. Applied to the live render within ~2s via prompt morphs.
   * Returns false (and changes nothing) if the geometry differs.
   */
  const applyConditions = useCallback(
    (next: Route) => {
      const run = runRef.current;
      const current = routeRef.current;
      if (!run || !current || !sameGeometry(current, next)) return false;
      routeRef.current = next;
      run.conditionsVersion += 1;
      return true;
    },
    [],
  );

  const start = useCallback(
    async (routeSource: Route | Promise<Route>) => {
      if (runRef.current) return;
      const run: RunHandle = { cancelled: false, conditionsVersion: 0 };
      runRef.current = run;
      setSnapshot({ ...INITIAL, phase: "connecting", statusText: "Connecting to Orbis" });

      try {
        // Opening the session, computing the routes and preparing the seed
        // frame don't depend on each other; stacked, they are the cold start.
        const connected = ensureConnected();
        connected.catch(() => {});
        const route = await Promise.resolve(routeSource);
        if (run.cancelled) throw new WalkCancelled();
        routeRef.current = route;

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

        await pinRouteSession(context, {
          // Pinned so weather and lighting realisation stay stable for the walk.
          seed: seedFromString(`${route.route_id}:${route.waypoints.length}`),
          resolution: ORBIS_RESOLUTION,
        });

        patch({ phase: "preparing", statusText: "Converting the first block to night" });
        // The daytime frame is converted before it reaches Orbis and is never
        // displayed either way — it is an intermediate, not an answer.
        const { graded, lighting } = await prepared;
        if (run.cancelled) throw new WalkCancelled();
        patch({
          seedNote: `seed mean luma ${graded.meanLuma.toFixed(3)} · lighting from ${lighting.source}`,
          statusText: "Starting the walk",
        });

        const first = route.waypoints[0];
        const seeded = await seedBlock(context, {
          image: graded.file,
          videoPrompt: first.condition.video_prompt,
          audioPrompt: first.condition.audio_prompt,
        });
        patch({ imageConditioned: seeded.imageConditioned });

        const outcome = await gate.waitForLiveFrames({
          timeoutMs: FIRST_FRAME_TIMEOUT_MS,
          isCancelled: () => run.cancelled,
        });
        if (outcome === "cancelled") throw new WalkCancelled();

        gate.release();
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
        try {
          await disconnect();
        } catch {
          /* teardown noise is not worth surfacing */
        }
        runRef.current = null;
      }
    },
    [context, disconnect, ensureConnected, gate, patch, prepareSeed, signals, sleep, walkRoute],
  );

  // Same rule on unmount: a closed tab must not take the slot with it.
  useEffect(
    () => () => {
      const run = runRef.current;
      if (run) run.cancelled = true;
      signals.abort("Component unmounted.");
      void disconnect().catch(() => {});
    },
    [disconnect, signals],
  );

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
