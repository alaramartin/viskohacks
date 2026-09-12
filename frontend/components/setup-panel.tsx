"use client";

/**
 * Setup: origin, destination, date, time. Nothing else.
 *
 * Once submitted this panel becomes the progress readout and stays on screen
 * until the first real frame arrives. That is deliberate: a session costs
 * ~12–16s cold (spike Q4), and the only good place to spend it is where a wait
 * is expected. The walk then opens on a street rather than a black rectangle.
 */

import type { FormEvent } from "react";

import type { ConditionSettings } from "@/components/ConditionControls";

export type SetupPanelProps = {
  origin: string;
  destination: string;
  conditions: ConditionSettings;
  onOriginChange: (value: string) => void;
  onDestinationChange: (value: string) => void;
  onConditionsChange: (next: ConditionSettings) => void;
  onSubmit: () => void;
  /**
   * Fired the first time the walker touches the form. Opening the Orbis session
   * takes ~7s and needs nothing from these fields, so it starts here rather
   * than on submit.
   */
  onInteract: () => void;
  busy: boolean;
  statusText: string;
  error: string | null;
};

export function SetupPanel({
  origin,
  destination,
  conditions,
  onOriginChange,
  onDestinationChange,
  onConditionsChange,
  onSubmit,
  onInteract,
  busy,
  statusText,
  error,
}: SetupPanelProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) onSubmit();
  };

  if (busy) {
    return (
      <section className="panel setup-panel">
        <h2>Preparing</h2>
        <p className="setup-progress">{statusText || "Working"}</p>
        <p className="hint">
          Opening the Orbis session and rendering the first block takes about
          fifteen seconds. It happens here so the walk starts the moment you see
          it.
        </p>
        {error ? <p className="error">{error}</p> : null}
      </section>
    );
  }

  return (
    <form
      className="panel setup-panel"
      onSubmit={submit}
      onFocusCapture={onInteract}
      onChangeCapture={onInteract}
    >
      <h2>Walk home</h2>
      <p className="hint">
        A walking route across San Francisco, rendered at night from
        street-level imagery of those exact blocks. A familiarisation tool — no
        score, no verdict.
      </p>

      <label>
        From
        <input
          value={origin}
          onChange={(event) => onOriginChange(event.target.value)}
          placeholder="Eddy St & Jones St"
          required
        />
      </label>

      <label>
        To
        <input
          value={destination}
          onChange={(event) => onDestinationChange(event.target.value)}
          placeholder="Golden Gate Ave & Hyde St"
          required
        />
      </label>

      <div className="two-column">
        <label>
          Date
          <input
            type="date"
            value={conditions.date}
            onChange={(event) =>
              onConditionsChange({ ...conditions, date: event.target.value })
            }
            required
          />
        </label>
        <label>
          Time
          <input
            type="time"
            value={conditions.time}
            onChange={(event) =>
              onConditionsChange({ ...conditions, time: event.target.value })
            }
            required
          />
        </label>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <button type="submit">Walk it</button>
    </form>
  );
}
