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
  /** `route_id` of the route the walker picked, if any. */
  route?: string;
};

export function buildShareUrl(params: ShareParams, origin?: string): string {
  const base =
    origin ?? (typeof window === "undefined" ? "" : window.location.origin);
  const query = new URLSearchParams({
    origin: params.origin,
    destination: params.destination,
    datetime: params.datetime,
  });
  if (params.route) query.set("route", params.route);
  return `${base}/?${query.toString()}`;
}

export function readShareParams(search: string): Partial<ShareParams> {
  const query = new URLSearchParams(search);
  const result: Partial<ShareParams> = {};
  const origin = query.get("origin");
  const destination = query.get("destination");
  const datetime = query.get("datetime");
  const route = query.get("route");
  if (origin) result.origin = origin;
  if (destination) result.destination = destination;
  if (datetime) result.datetime = datetime;
  if (route) result.route = route;
  return result;
}
