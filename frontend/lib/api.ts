/**
 * Client for Person 1's FastAPI backend.
 *
 * Paths stay relative (`/api/routes`, `/api/imagery/...`) and `next.config.ts`
 * proxies them to the backend on :8000. Same-origin is not a detail: the night
 * grade reads the seed frame back out of a <canvas>, and a cross-origin image
 * would taint it. `NEXT_PUBLIC_API_BASE` exists as an escape hatch for running
 * the two on different hosts — set it only if you have CORS sorted, and expect
 * the grade to fail on a tainted canvas.
 */

import type { Route, RoutesResponse, Waypoint } from "@/lib/contract";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export type RouteQuery = {
  origin: string;
  destination: string;
  /** ISO 8601, e.g. 2026-09-12T23:00:00 */
  datetime: string;
  /** Viewer overrides; the backend labels the affected facts as set by the viewer. */
  fog?: boolean;
  crowd?: boolean;
};

/** `"2026-09-12"` + `"23:00"` → `"2026-09-12T23:00:00"`. Local time, no zone. */
export function toIsoDateTime(date: string, time: string): string {
  const safeTime = time.length === 5 ? `${time}:00` : time;
  return `${date}T${safeTime}`;
}

export async function fetchRoutes(
  query: RouteQuery,
  signal?: AbortSignal,
): Promise<Route[]> {
  const params = new URLSearchParams({
    origin: query.origin,
    destination: query.destination,
    datetime: query.datetime,
  });
  if (query.fog) params.set("fog", "true");
  if (query.crowd) params.set("crowd", "true");
  const response = await fetch(`${API_BASE}/api/routes?${params}`, {
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      `Route request failed (${response.status}). Is the backend running on :8000?`,
    );
  }
  const payload = (await response.json()) as RoutesResponse;
  if (!payload?.routes?.length) throw new Error("The backend returned no routes.");
  return payload.routes;
}

/** Absolute URL of a waypoint's seed frame, or null when there is no coverage. */
export function imageryUrl(waypoint: Waypoint): string | null {
  if (!waypoint.image_available || !waypoint.image_url) return null;
  return `${API_BASE}${waypoint.image_url}`;
}

export async function fetchSeedImage(
  url: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(url, { signal, cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`No imagery at ${url} (${response.status}).`);
  }
  return response.blob();
}
