"use client";

/**
 * STUB — PERSON 1, PHASE 3.
 *
 * Horizontal strip beneath the viewport. Renders `condition.facts` for the
 * current waypoint **verbatim**, in two columns, with "Modeled estimate" as a
 * persistent label, and briefly emphasises fields that changed since the
 * previous waypoint.
 *
 * The props below are the contract; the placeholder body is yours to replace.
 * `factsDiffer` in `lib/contract.ts` is there for the change emphasis.
 */

import type { Waypoint } from "@/lib/contract";

export type EvidenceReadoutProps = {
  waypoint: Waypoint | null;
  /** The waypoint we were on before this one, for change emphasis. */
  previousWaypoint?: Waypoint | null;
};

export function EvidenceReadout({ waypoint }: EvidenceReadoutProps) {
  if (!waypoint) {
    return (
      <section className="panel evidence-strip">
        <p className="stub-note">EvidenceReadout — Person 1, Phase 3</p>
      </section>
    );
  }

  return (
    <section className="panel evidence-strip">
      <div className="evidence-facts">
        {waypoint.condition.facts.map((fact) => (
          <p key={fact.label}>
            <span className="fact-label">{fact.label}</span>
            <span className="fact-value">{fact.value}</span>
          </p>
        ))}
      </div>
      <p className="stub-note">
        Modeled estimate · EvidenceReadout placeholder (Person 1, Phase 3)
      </p>
    </section>
  );
}
