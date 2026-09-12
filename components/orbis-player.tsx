"use client";

import { ReactorView } from "@reactor-team/js-sdk";

type OrbisPlayerProps = {
  connected: boolean;
  muted: boolean;
  runStarted: boolean;
  status: string;
};

export function OrbisPlayer({
  connected,
  muted,
  runStarted,
  status,
}: OrbisPlayerProps) {
  return (
    <div className="player">
      {runStarted ? (
        <ReactorView
          track="main_video"
          audioTrack="main_audio"
          muted={muted}
          videoObjectFit="contain"
        />
      ) : (
        <div className="player-placeholder">
          {connected ? "Configure and start a run" : "Connect to Orbis Stable"}
        </div>
      )}
      <span className={`status status-${status}`}>{status}</span>
    </div>
  );
}
