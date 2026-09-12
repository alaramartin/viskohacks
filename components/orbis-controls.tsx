"use client";

import { FormEvent } from "react";

import type { OrbisSession } from "@/hooks/use-orbis-session";

export function OrbisControls({ session }: { session: OrbisSession }) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void session.startRun();
  };

  return (
    <form className="controls" onSubmit={submit}>
      <div className="button-row">
        {!session.connected ? (
          <button
            type="button"
            disabled={session.controlsBusy}
            onClick={session.connectSession}
          >
            Connect
          </button>
        ) : (
          <button
            type="button"
            disabled={session.controlsBusy}
            onClick={session.disconnectSession}
          >
            Disconnect
          </button>
        )}
        <button type="button" onClick={session.toggleMuted}>
          {session.muted ? "Enable sound" : "Mute"}
        </button>
      </div>

      <fieldset
        disabled={
          !session.connected || session.runStarted || session.controlsBusy
        }
      >
        <legend>Next run setup</legend>
        <p className="hint">
          Resolution choices are loaded from Reactor for the next run.
        </p>
        <div className="two-column">
          <label>
            Optional start image (16:9 recommended)
            <input
              type="file"
              accept="image/*"
              onChange={(event) =>
                session.selectImage(event.target.files?.[0] || null)
              }
            />
          </label>
          <label>
            Resolution for next run
            <select
              value={session.resolution}
              onChange={(event) => session.setResolution(event.target.value)}
            >
              <option value="">Model setting (2k default)</option>
              {session.availableResolutions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="selected-image">
          Orbis start image: {session.image?.name || "none (text-to-video)"}
          {session.imageStatus ? ` · ${session.imageStatus}` : ""}
        </p>
      </fieldset>

      <label>
        Prompt
        <textarea
          value={session.prompt}
          placeholder="Enter prompt here"
          onChange={(event) => session.setPrompt(event.target.value)}
        />
      </label>

      <div className="button-row">
        <button
          type="submit"
          disabled={
            !session.connected || session.runStarted || session.controlsBusy
          }
        >
          Start run
        </button>
        <button
          type="button"
          disabled={
            !session.connected || !session.runStarted || session.controlsBusy
          }
          onClick={session.steer}
        >
          Steer current run
        </button>
      </div>

      <div className="button-row secondary">
        <button
          type="button"
          disabled={
            !session.connected ||
            !session.runStarted ||
            session.paused ||
            session.controlsBusy
          }
          onClick={session.pause}
        >
          Pause
        </button>
        <button
          type="button"
          disabled={
            !session.connected ||
            !session.runStarted ||
            !session.paused ||
            session.controlsBusy
          }
          onClick={session.resume}
        >
          Resume
        </button>
        <button
          type="button"
          disabled={
            !session.connected || !session.runStarted || session.controlsBusy
          }
          onClick={session.reset}
        >
          Reset
        </button>
      </div>

      {session.error && <p className="error">{session.error}</p>}
      <aside>
        <strong>Recent model events</strong>
        <code>
          {session.events.length ? session.events.join(" · ") : "No events yet"}
        </code>
      </aside>
    </form>
  );
}
