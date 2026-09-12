"use client";

/**
 * Below the minimap. Date, time, fog and crowd — usable **while a walk is
 * running** (PLAN.md Phase 3, CORE). The shell debounces a change, refetches the
 * same route for the new conditions and hands it to the live walk, which
 * re-sends the current shot's prompt, so the running video changes without a
 * restart.
 *
 * Fog and crowd are the viewer's overrides: they steer the render, and the facts
 * they touch say "set by you", so nobody mistakes them for data.
 */

export type ConditionSettings = {
  /** yyyy-mm-dd */
  date: string;
  /** HH:mm, 24h */
  time: string;
  fog: boolean;
  crowd: boolean;
};

export type ConditionControlsProps = {
  settings: ConditionSettings;
  onChange: (next: ConditionSettings) => void;
  disabled?: boolean;
  /** A walk is running, so changes apply to it as it plays. */
  live?: boolean;
};

/** The whole day in 4-hour steps, so a live change can go night → day and back. */
const TIME_PRESETS = [
  { label: "12am", time: "00:00" },
  { label: "4am", time: "04:00" },
  { label: "8am", time: "08:00" },
  { label: "12pm", time: "12:00" },
  { label: "4pm", time: "16:00" },
  { label: "8pm", time: "20:00" },
];

export function ConditionControls({ settings, onChange, disabled, live }: ConditionControlsProps) {
  const update = (patch: Partial<ConditionSettings>) => onChange({ ...settings, ...patch });

  return (
    <section className="panel condition-controls">
      <h2>Conditions</h2>
      <p className="hint">
        {live ? "Changes apply to the walk as it plays." : "Applied when the walk starts."}
      </p>

      <div className="two-column">
        <label>
          Date
          <input
            type="date"
            value={settings.date}
            disabled={disabled}
            onChange={(event) => event.target.value && update({ date: event.target.value })}
          />
        </label>
        <label>
          Time
          <input
            type="time"
            step={900}
            value={settings.time}
            disabled={disabled}
            onChange={(event) => event.target.value && update({ time: event.target.value })}
          />
        </label>
      </div>

      <div className="preset-row" role="group" aria-label="Time of day">
        {TIME_PRESETS.map((preset) => (
          <button
            key={preset.time}
            type="button"
            className="chip"
            aria-pressed={settings.time === preset.time}
            disabled={disabled}
            onClick={() => update({ time: preset.time })}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="preset-row" role="group" aria-label="Your overrides">
        <button
          type="button"
          className="chip"
          aria-pressed={settings.fog}
          disabled={disabled}
          onClick={() => update({ fog: !settings.fog })}
        >
          Fog
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={settings.crowd}
          disabled={disabled}
          onClick={() => update({ crowd: !settings.crowd })}
        >
          Crowd
        </button>
      </div>
      <p className="hint">Fog and crowd are your settings, not data — the facts they change say so.</p>
    </section>
  );
}
