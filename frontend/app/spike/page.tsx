"use client";

import { Reactor, type ReactorMessage } from "@reactor-team/js-sdk";
import { useCallback, useEffect, useRef, useState } from "react";

import { ORBIS_TRACKS, unwrapOrbisMessage } from "@/lib/orbis";

/**
 * Phase 1 Reactor spike harness (Person 2). Throwaway — it exists to answer
 * Q1–Q5 in docs/reactor-findings.md and is deleted once Checkpoint 1 is signed
 * off. It drives the imperative `Reactor` class rather than `ReactorProvider`
 * so a run can be timed precisely and several sessions can be opened at once.
 *
 * Everything is driven from the query string so a headless browser can run it:
 *
 *   /spike?auto=1&run=q1-seeded&model=stable&seed=tenderloin.jpg&prompt=...
 *   /spike?auto=1&run=q1-control&model=stable&prompt=...          (no seed)
 *   /spike?auto=1&run=q3&mode=concurrency&sessions=4
 *
 * Frames and the timing log land in docs/spike/runs/<run>/ via
 * /api/spike/capture. `window.__spike` reports progress to the driver.
 */

const MODELS: Record<string, string> = {
  stable: "reactor/visko-orbis-stable",
  dynamic: "reactor/visko-orbis-dynamic",
};

const DEFAULT_PROMPT =
  "narrow one-way city street at night, amber sodium streetlights, wet asphalt reflecting light, cars parked along both curbs, multi-story apartment buildings with fire escapes, no pedestrians";
const DEFAULT_AUDIO_PROMPT =
  "quiet city street at night, distant traffic, faint wind";

type Mark = { label: string; atMs: number; sinceStartMs: number };
type LogLine = { atMs: number; type: string; detail?: string };

type SpikeReport = {
  run: string;
  model: string;
  modelName: string;
  seedImage: string | null;
  prompt: string;
  audioPrompt: string;
  noiseSeed: number | null;
  resolution: string;
  mode: string;
  marks: Mark[];
  log: LogLine[];
  connectionTimings: unknown;
  imageAccepted: { width?: number; height?: number } | null;
  imageConditioned: boolean | null;
  availableResolutions: string[];
  chunkCompleteCount: number;
  chunkIntervalsMs: number[];
  capturedFrames: string[];
  concurrency: { index: number; ok: boolean; readyMs?: number; error?: string }[];
  errors: string[];
  finishedAt: string;
};

function useQuery() {
  const [params, setParams] = useState<URLSearchParams | null>(null);
  useEffect(() => {
    setParams(new URLSearchParams(window.location.search));
  }, []);
  return params;
}

async function postCapture(body: Record<string, unknown>) {
  await fetch("/api/spike/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export default function SpikePage() {
  const params = useQuery();
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startedRef = useRef(false);

  const say = useCallback((text: string) => {
    setLines((current) => [...current, text]);
    // eslint-disable-next-line no-console
    console.log(`[spike] ${text}`);
  }, []);

  const run = useCallback(
    async (query: URLSearchParams) => {
      const t0 = performance.now();
      const runId = query.get("run") || `run-${Date.now()}`;
      const modelKey = query.get("model") || "stable";
      const modelName = MODELS[modelKey] ?? modelKey;
      const seedImage = query.get("seed");
      const prompt = query.get("prompt") || DEFAULT_PROMPT;
      const audioPrompt = query.get("audio") ?? DEFAULT_AUDIO_PROMPT;
      const noiseSeedRaw = query.get("noise");
      const noiseSeed = noiseSeedRaw === null ? null : Number(noiseSeedRaw);
      const resolution = query.get("resolution") || "1080p";
      const mode = query.get("mode") || "run";
      const sessions = Number(query.get("sessions") || "1");
      const captureAt = (query.get("captureAt") || "2,6,12,20")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value >= 0)
        .sort((a, b) => a - b);
      const holdMs = Number(query.get("hold") || "0");
      // Checkpoint 2 follow-up: with `seeds=a,b,c&midrun=1`, blocks after the
      // first are re-seeded with `set_image` while the generation keeps
      // running — no `reset`, no `start`. Does Orbis pick the new frame up at a
      // chunk boundary (continuous walk, no hold), or ignore it?
      // `midrun=image` (or 1): set_image only. `midrun=prompt`: set_image then a
      // changed set_prompt, in case the image is only read when conditions
      // change. `midrun=pause`: pause → set_image → resume.
      const midrunMode = query.get("midrun");
      const midrun = midrunMode !== null;

      const report: SpikeReport = {
        run: runId,
        model: modelKey,
        modelName,
        seedImage,
        prompt,
        audioPrompt,
        noiseSeed,
        resolution,
        mode,
        marks: [],
        log: [],
        connectionTimings: null,
        imageAccepted: null,
        imageConditioned: null,
        availableResolutions: [],
        chunkCompleteCount: 0,
        chunkIntervalsMs: [],
        capturedFrames: [],
        concurrency: [],
        errors: [],
        finishedAt: "",
      };

      const mark = (label: string) => {
        const atMs = performance.now();
        report.marks.push({
          label,
          atMs: Math.round(atMs),
          sinceStartMs: Math.round(atMs - t0),
        });
        say(`${label} @ +${Math.round(atMs - t0)}ms`);
      };

      const getJwt = async () => {
        const response = await fetch("/api/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: modelName,
            maxSessions: Math.max(sessions, 1),
          }),
        });
        const result = (await response.json()) as { jwt?: string; error?: string };
        if (!response.ok || !result.jwt) {
          throw new Error(result.error || "token request failed");
        }
        return result.jwt;
      };

      const finish = async () => {
        report.finishedAt = new Date().toISOString();
        await postCapture({
          run: runId,
          name: "report",
          text: JSON.stringify(report, null, 2),
        });
        (window as unknown as { __spike?: unknown }).__spike = {
          state: "done",
          report,
        };
        setDone(true);
        say("DONE");
      };

      (window as unknown as { __spike?: unknown }).__spike = {
        state: "running",
        report,
      };

      // ---- Q3: how many sessions will Reactor actually run at once? --------
      if (mode === "concurrency") {
        say(`minting a token scoped to max_sessions=${sessions}`);
        let jwt: string;
        try {
          jwt = await getJwt();
        } catch (caught) {
          report.errors.push(`token: ${String(caught)}`);
          await finish();
          return;
        }
        mark("token_minted");

        const instances: Reactor[] = [];
        // Sequential, not Promise.all: a limit should show up as the Nth
        // connect failing, and parallel connects would make it ambiguous
        // which one was refused.
        for (let index = 0; index < sessions; index += 1) {
          const reactor = new Reactor({
            modelName,
            apiUrl: "https://api.reactor.inc",
            modelTracks: [...ORBIS_TRACKS],
            jwt,
          });
          instances.push(reactor);
          const startedAt = performance.now();
          try {
            await reactor.connect();
            report.concurrency.push({
              index,
              ok: true,
              readyMs: Math.round(performance.now() - startedAt),
            });
            say(`session ${index + 1}/${sessions}: ready`);
          } catch (caught) {
            const message =
              caught instanceof Error ? caught.message : String(caught);
            report.concurrency.push({ index, ok: false, error: message });
            say(`session ${index + 1}/${sessions}: FAILED — ${message}`);
          }
        }

        // Hold them open briefly — a limit enforced lazily shows up here.
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        for (const reactor of instances) {
          try {
            await reactor.disconnect();
          } catch {
            /* teardown noise is not a finding */
          }
        }
        await finish();
        return;
      }

      // ---- Q6: can one session be re-seeded per block? --------------------
      // With one concurrent session (Q3) we cannot warm block N+1 while block
      // N plays, so the walk is only viable if `reset` → `set_image` →
      // `set_prompt` → `start` inside the SAME session is much cheaper than a
      // fresh connect. `seeds=a.jpg,b.jpg,c.jpg` runs one block per seed.
      const relaySeeds = (query.get("seeds") || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      // Mint ONCE and pass the string. A `jwt` resolver is called before every
      // authenticated request, so a resolver that mints a fresh token each
      // time makes the second request arrive with a token that does not own
      // the session created by the first — Reactor answers 403 "this token is
      // session-scoped and is not authorized for this resource".
      let sessionJwt: string;
      try {
        sessionJwt = await getJwt();
      } catch (caught) {
        report.errors.push(`token: ${String(caught)}`);
        await finish();
        return;
      }
      mark("token_minted");

      const reactor = new Reactor({
        modelName,
        apiUrl: "https://api.reactor.inc",
        modelTracks: [...ORBIS_TRACKS],
        jwt: sessionJwt,
        logLevel: "warn",
      });

      let lastChunkAt = 0;
      const waiters = new Map<string, () => void>();
      const waitFor = (type: string, timeoutMs = 60_000) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            waiters.delete(type);
            reject(new Error(`timed out waiting for ${type}`));
          }, timeoutMs);
          waiters.set(type, () => {
            clearTimeout(timer);
            waiters.delete(type);
            resolve();
          });
        });

      reactor.on("message", (raw: ReactorMessage) => {
        const message = unwrapOrbisMessage(raw);
        const type = message.type || "unknown";
        report.log.push({
          atMs: Math.round(performance.now() - t0),
          type,
          detail: JSON.stringify(message).slice(0, 400),
        });

        if (type === "chunk_complete") {
          report.chunkCompleteCount += 1;
          const now = performance.now();
          if (lastChunkAt) {
            report.chunkIntervalsMs.push(Math.round(now - lastChunkAt));
          }
          lastChunkAt = now;
        }
        if (type === "image_accepted") {
          report.imageAccepted = { width: message.width, height: message.height };
        }
        if (type === "generation_started") {
          report.imageConditioned = message.image_conditioned ?? null;
        }
        if (type === "state" && message.available_resolutions) {
          report.availableResolutions = message.available_resolutions.map(String);
        }
        if (type === "state" && message.has_image === true) {
          waiters.get("state.has_image")?.();
        }
        waiters.get(type)?.();
      });

      reactor.on("error", (error) => {
        report.errors.push(`${error.code}: ${error.message}`);
        say(`ERROR ${error.code}: ${error.message}`);
      });

      let firstFrameMarked = false;
      reactor.on("trackReceived", (name, _track, stream) => {
        say(`track received: ${name}`);
        if (name !== "main_video" || !videoRef.current) return;
        const video = videoRef.current;
        video.srcObject = stream;
        void video.play().catch(() => {
          /* headless autoplay is muted, so this should not happen */
        });
        type FrameCallbackVideo = HTMLVideoElement & {
          requestVideoFrameCallback?: (callback: () => void) => void;
        };
        const frameVideo = video as FrameCallbackVideo;
        frameVideo.requestVideoFrameCallback?.(() => {
          if (firstFrameMarked) return;
          firstFrameMarked = true;
          mark("first_video_frame");
        });
      });

      const capture = async (label: string) => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || !video.videoWidth) {
          say(`capture ${label}: no video yet`);
          return;
        }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d")?.drawImage(video, 0, 0);
        await postCapture({
          run: runId,
          name: label,
          dataUrl: canvas.toDataURL("image/png"),
        });
        report.capturedFrames.push(label);
        say(`captured ${label} (${video.videoWidth}x${video.videoHeight})`);
      };

      const applySeed = async (name: string, label: string) => {
        const response = await fetch(
          `/api/spike/seed?name=${encodeURIComponent(name)}`,
        );
        if (!response.ok) throw new Error(`seed image ${name} not found`);
        const blob = await response.blob();
        const file = new File([blob], name, { type: blob.type });
        mark(`${label}_seed_fetched`);

        const uploaded = await reactor.uploadFile(file, { name });
        mark(`${label}_seed_uploaded`);

        const hasImage = waitFor("state.has_image");
        const reply = unwrapOrbisMessage(
          await reactor.sendCommand("set_image", { image: uploaded }),
        );
        if (reply?.type !== "image_accepted") {
          hasImage.catch(() => {});
          throw new Error(
            `set_image returned ${reply?.type ?? "nothing"}: ${reply?.reason ?? ""}`,
          );
        }
        mark(`${label}_image_accepted`);
        await hasImage;
        mark(`${label}_state_has_image`);
      };

      const startBlock = async (label: string, blockPrompt: string) => {
        const conditionsReady = waitFor("conditions_ready");
        await reactor.sendCommand("set_prompt", { prompt: blockPrompt });
        mark(`${label}_prompt_sent`);
        await conditionsReady;
        mark(`${label}_conditions_ready`);

        const generationStarted = waitFor("generation_started");
        await reactor.sendCommand("start", {});
        mark(`${label}_start_sent`);
        await generationStarted;
        mark(`${label}_generation_started`);
      };

      try {
        mark("connect_start");
        await reactor.connect();
        mark("status_ready");
        report.connectionTimings = reactor.getConnectionTimings() ?? null;

        if (noiseSeed !== null && Number.isFinite(noiseSeed)) {
          await reactor.sendCommand("set_seed", { seed: noiseSeed });
          mark("noise_seed_set");
        }
        await reactor.sendCommand("set_resolution", { resolution });
        mark("resolution_set");
        if (audioPrompt) {
          await reactor.sendCommand("set_audio_prompt", { prompt: audioPrompt });
          mark("audio_prompt_set");
        }

        if (relaySeeds.length > 0) {
          // One session, one block per seed. The gap between
          // `blockN_reset_sent` and `blockN_generation_started` is the number
          // that decides whether autoplay is possible on a single session.
          for (let index = 0; index < relaySeeds.length; index += 1) {
            const label = `block${index}`;
            if (index > 0 && midrun) {
              await capture(`${label}-before`);
              if (midrunMode === "pause") {
                await reactor.sendCommand("pause", {});
                mark(`${label}_pause_sent`);
              }
            } else if (index > 0) {
              const wasReset = waitFor("generation_reset");
              await reactor.sendCommand("reset", {});
              mark(`${label}_reset_sent`);
              await wasReset;
              mark(`${label}_reset_done`);
            }
            await applySeed(relaySeeds[index], label);
            if (index > 0 && midrun) {
              mark(`${label}_midrun_seeded`);
              if (midrunMode === "prompt") {
                await reactor.sendCommand("set_prompt", { prompt: `${prompt}, block ${index}` });
                mark(`${label}_prompt_nudged`);
              } else if (midrunMode === "pause") {
                await reactor.sendCommand("resume", {});
                mark(`${label}_resume_sent`);
              }
            } else {
              await startBlock(label, prompt);
            }

            const blockStartedAt = performance.now();
            for (const second of captureAt) {
              const waitMs = blockStartedAt + second * 1000 - performance.now();
              if (waitMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, waitMs));
              }
              await capture(`${label}-t${String(second).padStart(3, "0")}s`);
            }
          }
        } else {
          if (seedImage) {
            mark("seed_fetch_start");
            await applySeed(seedImage, "block0");
          }
          await startBlock("block0", prompt);

          const startedAt = performance.now();
          for (const second of captureAt) {
            const waitMs = startedAt + second * 1000 - performance.now();
            if (waitMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, waitMs));
            }
            await capture(`t${String(second).padStart(3, "0")}s`);
          }

          // Continuous-walk test (human decision after Checkpoint 2: no cuts).
          // `prompts=a|b|c&every=7` morphs through a scripted walk — "turning
          // right at the corner", "crossing the street" — in ONE generation,
          // capturing a frame just before each next morph. Answers: does a
          // generation keep going for minutes, and does it follow motion cues?
          const script = (query.get("prompts") || "")
            .split("|")
            .map((value) => value.trim())
            .filter(Boolean);
          const everyMs = Number(query.get("every") || "7") * 1000;
          for (let index = 0; index < script.length; index += 1) {
            await reactor.sendCommand("set_prompt", { prompt: script[index] });
            mark(`prompt${index}_sent`);
            await new Promise((resolve) => setTimeout(resolve, everyMs));
            await capture(`p${String(index).padStart(2, "0")}`);
          }
        }

        if (holdMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, holdMs));
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        report.errors.push(message);
        say(`FAILED: ${message}`);
      } finally {
        try {
          await reactor.disconnect();
        } catch {
          /* teardown noise is not a finding */
        }
        await finish();
      }
    },
    [say],
  );

  useEffect(() => {
    if (!params || startedRef.current) return;
    if (params.get("auto") !== "1") return;
    startedRef.current = true;
    void run(params);
  }, [params, run]);

  return (
    <main style={{ padding: 16, fontFamily: "ui-monospace, monospace" }}>
      <h1 style={{ fontSize: 16 }}>Orbis spike harness</h1>
      <p style={{ fontSize: 12, opacity: 0.7 }}>
        Phase 1 throwaway. Add <code>&auto=1</code> to run on load.
      </p>
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        style={{ width: 480, background: "#111", aspectRatio: "16 / 9" }}
      />
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <pre
        id="spike-log"
        style={{ fontSize: 12, whiteSpace: "pre-wrap", lineHeight: 1.5 }}
      >
        {lines.join("\n")}
      </pre>
      <div id="spike-done">{done ? "DONE" : ""}</div>
    </main>
  );
}
