"use client";

/**
 * STUB — PERSON 1, PHASE 3.
 *
 * The shareable artifact: both routes, the conditions at the chosen time, which
 * route was picked, and a share link. `buildShareUrl` in `lib/share.ts` encodes
 * origin/destination/datetime/route into the query string — no database, the
 * link just regenerates the preview, and the shell reads those params back on
 * load.
 */

import type { Route } from "@/lib/contract";

export type RouteBriefProps = {
  routes: Route[];
  chosenRouteId: string | null;
  origin: string;
  destination: string;
  /** ISO 8601 local datetime. */
  datetime: string;
  shareUrl: string;
};

export function RouteBrief({
  routes,
  chosenRouteId,
  origin,
  destination,
  datetime,
  shareUrl,
}: RouteBriefProps) {
  return (
    <section className="panel route-brief">
      <h2>Route brief</h2>
      <p className="stub-note">RouteBrief — Person 1, Phase 3</p>
      <p className="stub-data">
        {origin} → {destination} · {datetime.replace("T", " ")}
      </p>
      <p className="stub-data">
        {routes.map((route) => route.route_id).join(" and ")} computed
        {chosenRouteId ? ` · walked ${chosenRouteId}` : ""}
      </p>
      <p className="stub-data share-url">{shareUrl}</p>
    </section>
  );
}
