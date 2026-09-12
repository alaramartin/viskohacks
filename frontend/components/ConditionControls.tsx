"use client";

/**
 * STUB — PERSON 1, PHASE 3.
 *
 * Below the minimap. Date and time pickers plus fog and crowd toggles.
 *
 * **These must stay usable while a walk is playing** — a viewer moving the time
 * from 7pm to 11pm and watching the running video get darker is the Phase 3
 * deliverable. So: no `disabled` while walking, and no confirm step.
 *
 * The shell's `onChange` (Person 2, `walk-home.tsx`) does the rest — it
 * debounces, refetches the same route for the new clock, and morphs the live
 * Orbis generation via `walk.applyConditions`. It does **not** stop the walk or
 * return to Setup. Call it with the full next settings object; call it as often
 * as you like.
 *
 * Two things worth knowing before wiring a slider to it:
 *   - Only the light may change, never the geometry. If `/api/routes` returns a
 *     different walk for the new settings the shell refuses the morph and says
 *     so (PLAN.md: "Conditions at a new time without new geometry").
 *   - The change reaches the screen at the next Orbis chunk, ~1.8s. Anything
 *     faster than that in the UI is your own optimism, not the render.
 *
 * `disabled` is still honoured if you want it for the brief screen; the walk
 * screen no longer passes it.
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
