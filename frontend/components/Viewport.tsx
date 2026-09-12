"use client";

/**
 * The viewport: the only place you see the world.
 *
 * Owns the <video> the Orbis tracks play into, the hold canvas laid over it,
 * and the overlays. PERSON 2 OWNS THIS FILE — Person 1's data components live
 * beside it, not in it.
 *
 * What is on screen is always one of: the live render, the frozen last frame of
 * the previous block (while the next one is being seeded), an explicit
 * unavailable state, or a preparing state. Never a raw Street View photo.
 */

import { useReactor } from "@reactor-team/js-sdk";
import { useEffect, useRef } from "react";

import type { WalkController } from "@/hooks/use-orbis-walk";
import { nextTurn } from "@/lib/route-progress";
import { formatDistance } from "@/lib/geo";

type ViewportProps = {
  walk: WalkController;
};

export function Viewport({ walk }: ViewportProps) {
  const tracks = useReactor((state) => state.tracks);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const holdRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    walk.gate.attach(videoRef.current, holdRef.current);
  }, [walk.gate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const wanted = [tracks.main_video, tracks.main_audio].filter(Boolean);
    if (wanted.length === 0) {
      video.srcObject = null;
      return;
    }
    video.srcObject = new MediaStream(wanted);
    void video.play().catch(() => {
      // Audio is on by default, which some browsers refuse without a gesture.
      // Fall back to muted playback rather than to no picture at all.
      walk.setMuted(true);
      video.muted = true;
      void video.play().catch(() => {});
    });
  }, [tracks, walk]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = walk.muted;
  }, [walk.muted]);

  const waypoint = walk.waypoint;
  const turn = walk.route ? nextTurn(walk.route, walk.waypointIndex) : null;
  const conditionLine = waypoint
    ? waypoint.condition.facts
        .slice(0, 2)
        .map((fact) => `${fact.label} ${fact.value}`)
        .join("   ·   ")
    : "";

  const cover = coverFor(walk);

  return (
    <div className="viewport">
      <video ref={videoRef} playsInline autoPlay muted={walk.muted} />
      <canvas ref={holdRef} className="viewport-hold" />

      {walk.phase === "walking" && turn ? (
        <div className="viewport-overlays">
          <div className="viewport-direction">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <g transform={`rotate(${turn.turnDegrees} 20 20)`}>
                <path
                  d="M20 4 L30 26 L20 21 L10 26 Z"
                  fill="currentColor"
                  stroke="none"
                />
              </g>
            </svg>
            <span>
              {turn.isDestination ? "Destination" : "Turn"}{" "}
              {formatDistance(turn.metersAway)}
            </span>
          </div>
          {conditionLine ? (
            <p className="viewport-condition">
              {conditionLine}
              <span className="viewport-modeled">Modeled estimate</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {cover ? (
        <div className={`viewport-cover viewport-cover-${cover.kind}`}>
          <p className="viewport-cover-title">{cover.title}</p>
          {cover.detail ? <p className="viewport-cover-detail">{cover.detail}</p> : null}
        </div>
      ) : null}

      {walk.phase === "holding" && walk.gate.isFrozen ? (
        <span className="viewport-holding">Holding · next block preparing</span>
      ) : null}

      <button
        type="button"
        className="viewport-mute"
        onClick={walk.toggleMuted}
        aria-pressed={walk.muted}
      >
        {walk.muted ? "Unmute" : "Mute"}
      </button>
    </div>
  );
}

type Cover = { kind: string; title: string; detail?: string };

function coverFor(walk: WalkController): Cover | null {
  switch (walk.phase) {
    case "idle":
      return {
        kind: "idle",
        title: "Enter a route to begin",
        detail: "The walk is rendered at night as one continuous shot, starting from street-level imagery.",
      };
    case "connecting":
    case "preparing":
      return {
        kind: "preparing",
        title: "Preparing your walk",
        detail: walk.statusText,
      };
    case "unavailable":
      // Rule #4. No street is invented to fill the gap.
      return {
        kind: "unavailable",
        title: "Segment unavailable",
        detail:
          walk.unavailableReason ??
          "No street-level imagery covers this block, so nothing is rendered for it.",
      };
    case "finished":
      return { kind: "finished", title: "End of route", detail: walk.statusText };
    case "error":
      return { kind: "error", title: "The walk stopped", detail: walk.error ?? "" };
    default:
      // "holding" deliberately has no cover: the frozen previous frame stays up.
      return null;
  }
}
