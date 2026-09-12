"use client";

/**
 * STUB — PERSON 1, PHASE 3.
 *
 * Below the minimap. Date and time pickers plus fog and crowd toggles. Changing
 * any of them refetches routes and applies to **both** routes at once (one
 * shared condition clock), so the comparison stays controlled.
 *
 * The shell passes the current settings and an `onChange` that does the refetch
 * and restarts the walk — call it with the full next settings object.
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
};

export function ConditionControls({ settings }: ConditionControlsProps) {
  return (
    <section className="panel condition-controls">
      <h2>Conditions</h2>
      <p className="stub-note">ConditionControls — Person 1, Phase 3</p>
      <p className="stub-data">
        {settings.date} · {settings.time}
        {settings.fog ? " · fog" : ""}
        {settings.crowd ? " · crowd" : ""}
      </p>
    </section>
  );
}
