"use client";

/**
 * The shareable artifact: the walked route, its conditions at the chosen time,
 * and a share link. The link encodes origin, destination and datetime — there is
 * no database, opening it regenerates the preview (`lib/share.ts`).
 *
 * Facts only, summed along the route. No score, no verdict.
 */

import { useState } from "react";

import type { ConditionSettings } from "@/components/ConditionControls";
import type { Route, Waypoint } from "@/lib/contract";
import { distanceMeters, formatDistance } from "@/lib/geo";

export type RouteBriefProps = {
  route: Route | null;
  origin: string;
  destination: string;
  /** ISO 8601 local datetime. */
  datetime: string;
  conditions: ConditionSettings;
  shareUrl: string;
};

function factValue(waypoint: Waypoint | undefined, label: string): string {
  return waypoint?.condition.facts.find((fact) => fact.label === label)?.value ?? "—";
}

export function RouteBrief({ route, origin, destination, datetime, conditions, shareUrl }: RouteBriefProps) {
  const [copied, setCopied] = useState(false);

  const waypoints = route?.waypoints ?? [];
  const first = waypoints[0];
  const length = waypoints.reduce(
    (total, waypoint, index) => (index === 0 ? 0 : total + distanceMeters(waypoints[index - 1], waypoint)),
    0,
  );
  // One representative waypoint per block, so block-level numbers aren't counted per waypoint.
  const blocks = [...new Map(waypoints.map((waypoint) => [waypoint.block_id, waypoint])).values()];
  const lamps = blocks.reduce((total, waypoint) => total + (waypoint.condition.lighting?.lamp_count ?? 0), 0);
  const outages = blocks.reduce((total, waypoint) => total + (waypoint.condition.lighting?.outages ?? 0), 0);
  const imaged = blocks.filter((waypoint) => waypoint.image_available).length;
  const [date, time = ""] = datetime.split("T");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="panel route-brief">
      <h2>Route brief</h2>
      <p className="brief-route">
        {origin} → {destination}
      </p>
      <p className="hint">
        {date} at {time.slice(0, 5)}
        {conditions.fog ? " · fog (set by you)" : ""}
        {conditions.crowd ? " · crowd (set by you)" : ""}
      </p>

      {route ? (
        <dl className="brief-facts">
          <div>
            <dt>Distance</dt>
            <dd>
              {formatDistance(length)} · {blocks.length} blocks
            </dd>
          </div>
          <div>
            <dt>Dark since</dt>
            <dd>{factValue(first, "Dark since")}</dd>
          </div>
          <div>
            <dt>Streetlights</dt>
            <dd>{lamps} mapped along the route</dd>
          </div>
          <div>
            <dt>Reported outages</dt>
            <dd>{outages} near the route (311, 90 days)</dd>
          </div>
          <div>
            <dt>Weather</dt>
            <dd>{factValue(first, "Weather")}</dd>
          </div>
          <div>
            <dt>Street imagery</dt>
            <dd>
              {imaged} of {blocks.length} blocks
            </dd>
          </div>
        </dl>
      ) : (
        <p className="hint">Walk a route to generate its brief.</p>
      )}

      <p className="modeled-label">Modeled estimates · no score, no verdict</p>
      <div className="share-row">
        <input readOnly value={shareUrl} aria-label="Share link" onFocus={(event) => event.currentTarget.select()} />
        <button type="button" onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </section>
  );
}
