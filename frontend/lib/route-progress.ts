/** Where the route goes next, for the viewport's direction arrow. */

import type { Route, Waypoint } from "@/lib/contract";
import { distanceMeters, relativeBearing } from "@/lib/geo";

/** Heading change that counts as a turn rather than a street bending. */
const TURN_DEGREES = 25;

export type NextTurn = {
  /** Waypoint where the heading changes, or the last waypoint of the route. */
  waypoint: Waypoint | null;
  metersAway: number;
  /** Degrees to rotate the arrow: 0 is straight ahead, +90 is a right turn. */
  turnDegrees: number;
  isDestination: boolean;
};

export function nextTurn(route: Route, fromIndex: number): NextTurn {
  const waypoints = route.waypoints;
  const current = waypoints[fromIndex];
  if (!current) {
    return { waypoint: null, metersAway: 0, turnDegrees: 0, isDestination: true };
  }

  let metersAway = 0;
  for (let index = fromIndex + 1; index < waypoints.length; index += 1) {
    metersAway += distanceMeters(waypoints[index - 1], waypoints[index]);
    const delta = relativeBearing(current.heading, waypoints[index].heading);
    if (Math.abs(delta) >= TURN_DEGREES) {
      return {
        waypoint: waypoints[index],
        metersAway,
        turnDegrees: delta,
        isDestination: false,
      };
    }
  }

  return {
    waypoint: waypoints[waypoints.length - 1] ?? null,
    metersAway,
    turnDegrees: 0,
    isDestination: true,
  };
}

/** Fraction of the route walked so far, 0–1. */
export function routeProgress(route: Route, index: number): number {
  if (route.waypoints.length < 2) return 0;
  return Math.min(1, Math.max(0, index / (route.waypoints.length - 1)));
}
