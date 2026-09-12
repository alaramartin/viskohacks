/**
 * A route is walked one *block* at a time, not one waypoint at a time.
 *
 * Consecutive waypoints sharing a `block_id` are one Orbis session segment
 * (SHARED CONTRACT). With a single concurrent session (spike Q3) the walk is a
 * long-lived session that is `reset` + re-seeded at every block boundary
 * (Q6, ~2.3s) rather than reconnected (~11.8s).
 */

import type { Route, Waypoint } from "@/lib/contract";
import { distanceMeters } from "@/lib/geo";

/**
 * Conditioning is strong for ~10s and has drifted off the real geometry by ~25s
 * (spike Q1). Past that we would be showing an invented street, which is the
 * one thing this tool must not do — so a block gets the screen for 8–15s and
 * then we move on, whether or not its waypoints are exhausted.
 */
export const MIN_BLOCK_DWELL_MS = 8_000;
export const MAX_BLOCK_DWELL_MS = 15_000;
const DWELL_PER_WAYPOINT_MS = 4_000;

export type Block = {
  /** Position of this block in the route, 0-based. */
  index: number;
  blockId: string;
  waypoints: Waypoint[];
  /** The waypoint whose frame seeds the block — the first one with imagery. */
  seedWaypoint: Waypoint | null;
  imageAvailable: boolean;
  /** Ground distance covered by the block, in metres. */
  lengthMeters: number;
};

export function groupIntoBlocks(route: Route): Block[] {
  const blocks: Block[] = [];

  for (const waypoint of route.waypoints) {
    const current = blocks[blocks.length - 1];
    if (current && current.blockId === waypoint.block_id) {
      current.waypoints.push(waypoint);
    } else {
      blocks.push({
        index: blocks.length,
        blockId: waypoint.block_id,
        waypoints: [waypoint],
        seedWaypoint: null,
        imageAvailable: false,
        lengthMeters: 0,
      });
    }
  }

  for (const block of blocks) {
    block.seedWaypoint =
      block.waypoints.find((waypoint) => waypoint.image_available && waypoint.image_url) ??
      null;
    block.imageAvailable = block.seedWaypoint !== null;
    block.lengthMeters = block.waypoints.reduce(
      (total, waypoint, index) =>
        index === 0 ? 0 : total + distanceMeters(block.waypoints[index - 1], waypoint),
      0,
    );
  }

  return blocks;
}

/** How long this block holds the screen, clamped to the Q1 drift window. */
export function blockDwellMs(block: Block): number {
  const wanted = block.waypoints.length * DWELL_PER_WAYPOINT_MS;
  return Math.min(MAX_BLOCK_DWELL_MS, Math.max(MIN_BLOCK_DWELL_MS, wanted));
}

/** Rough wall-clock length of the whole walk, for the setup screen's estimate. */
export function routeDurationMs(blocks: Block[]): number {
  return blocks.reduce((total, block) => total + blockDwellMs(block), 0);
}
