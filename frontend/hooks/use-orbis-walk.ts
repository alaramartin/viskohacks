"use client";

/**
 * The autoplay flythrough — the primary deliverable.
 *
 * One long-lived Orbis session per route (spike Q3/Q6). Per block:
 *   freeze the picture → `reset` → fetch the seed frame → night-grade it →
 *   `set_image` → `set_prompt` → `start` → hold until real frames resume →
 *   hard cut → walk the block's waypoints, morphing the prompt between them.
 *
 * It runs end to end with no interaction. The only controls are mute and stop.
 */

import { useReactor, useReactorMessage } from "@reactor-team/js-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchSeedImage, imageryUrl } from "@/lib/api";
import type { Route, Waypoint } from "@/lib/contract";
import { ORBIS_RESOLUTION } from "@/lib/orbis";
import { blockDwellMs, groupIntoBlocks, type Block } from "@/lib/orbis/blocks";
import { estimateLighting, gradeParamsFor } from "@/lib/orbis/lighting";
import { nightGradeSeed } from "@/lib/orbis/nightgrade";
import {
  morphPrompt,
  pinRouteSession,
  resetGeneration,
  seedBlock,
  type OrbisContext,
} from "@/lib/orbis/session";
import { OrbisSignals } from "@/lib/orbis/signals";
import { VideoGate } from "@/lib/orbis/video-gate";

/** Cold start is ~12–16s and a block change ~7–8s (Q4); this is the giving-up point. */
const FIRST_FRAME_TIMEOUT_MS = 30_000;

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
  /** Why this segment is unavailable, when it is. */
  unavailableReason: string | null;
  /** Diagnostics about the seed we fed Orbis — handy when a block looks wrong. */
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

type RunHandle = { cancelled: boolean };

/** Deterministic noise seed per route, so a rerun of the demo looks the same. */
function seedFromString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 1_000_000;
}

export type UseOrbisWalkOptions = {
  /** Fired the first time a block's real frames reach the screen. */
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
  const statusRef = useRef(status);
  const firstFrameRef = useRef(false);
  const onFirstFrame = useRef(options.onFirstFrame);

  onFirstFrame.current = options.onFirstFrame;
  statusRef.current = status;

  useReactorMessage((message) => signals.handle(message));

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

  const sleep = useCallback(async (ms: number, run: RunHandle) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (run.cancelled) throw new WalkCancelled();
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(200, Math.max(0, until - Date.now()))),
      );
    }
    if (run.cancelled) throw new WalkCancelled();
  }, []);

  /**
   * Advance through the block's waypoints while it holds the screen. Inside a
   * block the prompt *morphs* (dynamic applies it at the next chunk boundary)
   * rather than cutting — cuts happen only at block boundaries.
   */
  const walkWaypoints = useCallback(
    async (
      block: Block,
      route: Route,
      run: RunHandle,
      dwellMs: number,
      initialPrompt: string | null,
    ) => {
      const perWaypoint = dwellMs / block.waypoints.length;
      let lastPrompt = initialPrompt;

      for (const waypoint of block.waypoints) {
        if (run.cancelled) throw new WalkCancelled();
        patch({ waypointIndex: route.waypoints.indexOf(waypoint) });

        const prompt = waypoint.condition.video_prompt;
        if (initialPrompt !== null && prompt && prompt !== lastPrompt) {
          await morphPrompt(context, prompt);
          lastPrompt = prompt;
        }
        await sleep(perWaypoint, run);
      }
    },
    [context, patch, sleep],
  );

  const walkBlock = useCallback(
    async (
      block: Block,
      blocks: Block[],
      route: Route,
      run: RunHandle,
      /** True when the block we just walked had no imagery. */
      afterUnavailable: boolean,
    ): Promise<boolean> => {
      const label = `Block ${block.index + 1} of ${blocks.length}`;
      const positionOf = (waypoint: Waypoint) => route.waypoints.indexOf(waypoint);

      patch({
        blockIndex: block.index,
        waypointIndex: positionOf(block.waypoints[0]),
      });

      // Coming out of an unavailable segment there is no live frame to hold, so
      // its card stays up until the next block cuts in. Putting the last frame
      // from *before* the gap back on screen would read as having walked it.
      const holdPhase: WalkPhase = afterUnavailable ? "unavailable" : "holding";
      if (!afterUnavailable) patch({ unavailableReason: null });

      if (block.index > 0) {
        // Freeze while the outgoing block is still on screen — after the reset
        // there is nothing left to copy.
        gate.freeze();
        patch({ phase: holdPhase, statusText: `${label} — preparing` });
        await resetGeneration(context);
      }

      const dwellMs = blockDwellMs(block);

      const showUnavailable = async (reason: string) => {
        // Rule #4: a segment without imagery renders as visibly unavailable.
        // Never generated from text alone to paper over the gap.
        gate.release();
        patch({ phase: "unavailable", unavailableReason: reason, statusText: label });
        await walkWaypoints(block, route, run, dwellMs, null);
      };

      if (!block.imageAvailable || !block.seedWaypoint) {
        await showUnavailable("No street-level imagery covers this block.");
        return true;
      }

      const seedUrl = imageryUrl(block.seedWaypoint);
      if (!seedUrl) {
        await showUnavailable("No street-level imagery covers this block.");
        return true;
      }

      try {
        patch({
          phase: block.index === 0 ? "preparing" : holdPhase,
          statusText: `${label} — fetching imagery`,
        });
        const frame = await fetchSeedImage(seedUrl);
        if (run.cancelled) throw new WalkCancelled();

        // The daytime frame is converted before it reaches Orbis and is never
        // displayed either way — it is an intermediate, not an answer.
        const lighting = estimateLighting(block.seedWaypoint.condition);
        patch({ statusText: `${label} — converting the seed frame to night` });
        const graded = await nightGradeSeed(frame, gradeParamsFor(lighting));
        if (run.cancelled) throw new WalkCancelled();
        patch({
          seedNote: `seed mean luma ${graded.meanLuma.toFixed(3)} · lighting from ${lighting.source}`,
        });

        patch({ statusText: `${label} — seeding Orbis` });
        const seeded = await seedBlock(context, {
          image: graded.file,
          videoPrompt: block.waypoints[0].condition.video_prompt,
          audioPrompt: block.waypoints[0].condition.audio_prompt,
        });
        patch({ imageConditioned: seeded.imageConditioned });

        patch({ statusText: `${label} — waiting for the first frame` });
        const outcome = await gate.waitForLiveFrames({
          timeoutMs: FIRST_FRAME_TIMEOUT_MS,
          isCancelled: () => run.cancelled,
        });
        if (outcome === "cancelled") throw new WalkCancelled();
      } catch (caught) {
        if (caught instanceof WalkCancelled) throw caught;
        if (statusRef.current !== "ready") throw caught;
        // One bad block should not end the walk: show it as unavailable and
        // carry on to the next one.
        await showUnavailable(
          caught instanceof Error ? caught.message : String(caught),
        );
        return true;
      }

      // Hard cut. No crossfade.
      gate.release();
      patch({ phase: "walking", statusText: label, unavailableReason: null });
      if (!firstFrameRef.current) {
        firstFrameRef.current = true;
        onFirstFrame.current?.();
      }

      await walkWaypoints(
        block,
        route,
        run,
        dwellMs,
        block.waypoints[0].condition.video_prompt,
      );
      return false;
    },
    [context, gate, patch, walkWaypoints],
  );

  const stop = useCallback(() => {
    const run = runRef.current;
    if (!run) return;
    run.cancelled = true;
    signals.abort("Walk stopped.");
  }, [signals]);

  const start = useCallback(
    async (routeSource: Route | Promise<Route>) => {
      if (runRef.current) return;
      const run: RunHandle = { cancelled: false };
      runRef.current = run;
      firstFrameRef.current = false;
      setSnapshot({ ...INITIAL, phase: "connecting", statusText: "Connecting to Orbis" });

      try {
        if (statusRef.current !== "ready") await connect();
        if (run.cancelled) throw new WalkCancelled();

        const route = await Promise.resolve(routeSource);
        if (run.cancelled) throw new WalkCancelled();

        await pinRouteSession(context, {
          // Pinned for the whole route so weather and lighting realisation do
          // not diverge between blocks. Survives `reset` (Q6).
          seed: seedFromString(`${route.route_id}:${route.waypoints.length}`),
          resolution: ORBIS_RESOLUTION,
        });

        const blocks = groupIntoBlocks(route);
        patch({ route, blocks });

        let afterUnavailable = false;
        for (const block of blocks) {
          if (run.cancelled) throw new WalkCancelled();
          afterUnavailable = await walkBlock(
            block,
            blocks,
            route,
            run,
            afterUnavailable,
          );
        }

        patch({ phase: "finished", statusText: "End of route" });
      } catch (caught) {
        if (!(caught instanceof WalkCancelled)) {
          patch({
            phase: "error",
            error: caught instanceof Error ? caught.message : String(caught),
            statusText: "",
          });
        } else {
          patch({ phase: "idle", statusText: "" });
        }
      } finally {
        // Q3: a leaked session holds the account's only slot until it ages out,
        // and there is no REST endpoint to kill it. Always disconnect.
        signals.abort("Session closed.");
        gate.release();
        try {
          await disconnect();
        } catch {
          /* teardown noise is not worth surfacing */
        }
        runRef.current = null;
      }
    },
    [connect, context, disconnect, gate, patch, signals, walkBlock],
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
    isRunning: snapshot.phase !== "idle" && snapshot.phase !== "error",
  };
}

export type WalkController = ReturnType<typeof useOrbisWalk>;
