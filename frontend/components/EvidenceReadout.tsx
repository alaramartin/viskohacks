"use client";

/**
 * Horizontal strip beneath the viewport: the current waypoint's facts,
 * **verbatim**, in two columns, under a persistent "Modeled estimate" label.
 *
 * A fact whose value differs from the previous waypoint's gets a brief, quiet
 * highlight — motion in the periphery only when there is something to see, and
 * no flashing. That includes a live condition change: the walk swaps in the same
 * waypoint with new conditions, so the facts that moved light up.
 */

import type { Waypoint } from "@/lib/contract";

export type EvidenceReadoutProps = {
  waypoint: Waypoint | null;
  /** The waypoint we were on before this one, for change emphasis. */
  previousWaypoint?: Waypoint | null;
};

export function EvidenceReadout({ waypoint, previousWaypoint }: EvidenceReadoutProps) {
  const previous = new Map(
    (previousWaypoint?.condition.facts ?? []).map((fact) => [fact.label, fact.value]),
  );

  return (
    <section className="panel evidence-strip" aria-live="polite">
      <header className="evidence-header">
        <span className="evidence-title">Evidence</span>
        <span className="modeled-label">Modeled estimate</span>
      </header>

      {waypoint ? (
        <div className="evidence-facts">
          {waypoint.condition.facts.map((fact) => {
            const changed = previousWaypoint != null && previous.get(fact.label) !== fact.value;
            return (
              // Keyed on the value so the highlight restarts each time it changes.
              <p key={`${fact.label}:${fact.value}`} className={changed ? "fact-changed" : undefined}>
                <span className="fact-label">{fact.label}</span>
                <span className="fact-value">{fact.value}</span>
              </p>
            );
          })}
        </div>
      ) : (
        <p className="hint">The facts behind each block appear here during the walk.</p>
      )}
    </section>
  );
}
