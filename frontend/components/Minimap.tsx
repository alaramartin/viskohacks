"use client";

/**
 * STUB — PERSON 1, PHASE 3.
 *
 * Upper right. Both routes drawn, the active one highlighted, current position
 * marked. `projectPoints` in `lib/geo.ts` turns waypoint coordinates into SVG
 * coordinates if you want the no-dependency version.
 */

import type { Route } from "@/lib/contract";

export type MinimapProps = {
  routes: Route[];
  activeRouteId: string | null;
  /** Index into the active route's `waypoints`. */
  waypointIndex: number;
};

export function Minimap({ routes, activeRouteId, waypointIndex }: MinimapProps) {
  const active = routes.find((route) => route.route_id === activeRouteId);

  return (
    <section className="panel minimap">
      <h2>Route</h2>
      <p className="stub-note">Minimap — Person 1, Phase 3</p>
      <p className="stub-data">
        {routes.length} route{routes.length === 1 ? "" : "s"}
        {active
          ? ` · on ${active.route_id}, waypoint ${waypointIndex + 1} of ${active.waypoints.length}`
          : ""}
      </p>
    </section>
  );
}
