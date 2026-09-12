"use client";

/**
 * Upper right: the route, the part already walked, and where the walk is now.
 * Plain SVG from `projectPoints` — north up, no map tiles, no dependency.
 */

import type { Route } from "@/lib/contract";
import { projectPoints } from "@/lib/geo";

export type MinimapProps = {
  route: Route | null;
  /** Index into `route.waypoints`. */
  waypointIndex: number;
};

const WIDTH = 280;
const HEIGHT = 170;

export function Minimap({ route, waypointIndex }: MinimapProps) {
  const points = projectPoints(route?.waypoints ?? [], WIDTH, HEIGHT, 14);
  const last = points.length - 1;
  const index = Math.min(Math.max(waypointIndex, 0), Math.max(last, 0));
  const line = (from: number, to: number) =>
    points
      .slice(from, to + 1)
      .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
      .join(" ");

  return (
    <section className="panel minimap">
      <h2>Route</h2>
      {points.length > 1 ? (
        <>
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={`Route map, waypoint ${index + 1} of ${points.length}`}
          >
            <polyline className="minimap-ahead" points={line(index, last)} />
            <polyline className="minimap-walked" points={line(0, index)} />
            <circle className="minimap-start" cx={points[0].x} cy={points[0].y} r={4} />
            <rect className="minimap-end" x={points[last].x - 4} y={points[last].y - 4} width={8} height={8} />
            <circle className="minimap-here" cx={points[index].x} cy={points[index].y} r={5.5} />
          </svg>
          <p className="stub-data">
            Waypoint {index + 1} of {points.length}
          </p>
        </>
      ) : (
        <p className="hint">The route appears here once it is computed.</p>
      )}
    </section>
  );
}
