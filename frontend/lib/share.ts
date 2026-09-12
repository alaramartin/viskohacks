/**
 * Share links carry the whole brief in the query string — no database, the link
 * just regenerates the preview (PLAN.md, Person 1 Phase 3 `RouteBrief`).
 * Person 1's `RouteBrief.tsx` should use `buildShareUrl`; the shell reads the
 * same params back on load.
 */

export type ShareParams = {
  origin: string;
  destination: string;
  /** ISO 8601 local datetime. */
  datetime: string;
  /** Viewer overrides of the modeled conditions, so a shared link reproduces the walk. */
  fog?: boolean;
  crowd?: boolean;
};

export function buildShareUrl(params: ShareParams, origin?: string): string {
  const base =
    origin ?? (typeof window === "undefined" ? "" : window.location.origin);
  const query = new URLSearchParams({
    origin: params.origin,
    destination: params.destination,
    datetime: params.datetime,
  });
  // There is no `route` parameter any more: comparison was dropped before
  // Checkpoint 3 and there is only one route to link to.
  if (params.fog) query.set("fog", "true");
  if (params.crowd) query.set("crowd", "true");
  return `${base}/?${query.toString()}`;
}

export function readShareParams(search: string): Partial<ShareParams> {
  const query = new URLSearchParams(search);
  const result: Partial<ShareParams> = {};
  const origin = query.get("origin");
  const destination = query.get("destination");
  const datetime = query.get("datetime");
  if (origin) result.origin = origin;
  if (destination) result.destination = destination;
  if (datetime) result.datetime = datetime;
  if (query.get("fog") === "true") result.fog = true;
  if (query.get("crowd") === "true") result.crowd = true;
  return result;
}
