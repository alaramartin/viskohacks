"use client";

/**
 * App state shared across the three screens. The walk itself (session, phase,
 * current waypoint) lives in `use-orbis-walk`; this is everything around it.
 *
 * **One route.** Route comparison was dropped before Checkpoint 3 (PLAN.md,
 * human decision): one start, one destination, one walk. The backend still
 * returns an array, and the shell walks `routes[0]`.
 */

import { create } from "zustand";

import { fetchRoutes, toIsoDateTime, type RouteQuery } from "@/lib/api";
import type { ConditionSettings } from "@/components/ConditionControls";
import type { Route } from "@/lib/contract";

export type Screen = "setup" | "walk" | "brief";

export const DEFAULT_ORIGIN = "Eddy St & Jones St, San Francisco";
export const DEFAULT_DESTINATION = "Golden Gate Ave & Hyde St, San Francisco";

type WalkStore = {
  screen: Screen;
  origin: string;
  destination: string;
  conditions: ConditionSettings;
  routes: Route[];
  routesError: string | null;
  loadingRoutes: boolean;

  setScreen: (screen: Screen) => void;
  setOrigin: (origin: string) => void;
  setDestination: (destination: string) => void;
  setConditions: (conditions: ConditionSettings) => void;
  /** ISO 8601 local datetime for the current condition clock. */
  datetime: () => string;
  /** Fetches the route to walk. Throws on failure. */
  loadRoutes: () => Promise<Route>;
  /**
   * The same route recomputed for a new condition clock, for a change made
   * *during* a walk. Deliberately does not touch `loadingRoutes`: the walk is
   * still playing and nothing here may put the shell into a loading state.
   */
  routeForConditions: (conditions: ConditionSettings) => Promise<Route>;
};

function queryFor(
  origin: string,
  destination: string,
  conditions: ConditionSettings,
): RouteQuery {
  return {
    origin,
    destination,
    datetime: toIsoDateTime(conditions.date, conditions.time),
    fog: conditions.fog,
    crowd: conditions.crowd,
  };
}

export const useWalkStore = create<WalkStore>((set, get) => ({
  screen: "setup",
  origin: DEFAULT_ORIGIN,
  destination: DEFAULT_DESTINATION,
  // `date` is filled in on mount, client-side — a server-rendered "today" and a
  // client-rendered one would not always agree.
  conditions: { date: "", time: "23:00", fog: false, crowd: false },
  routes: [],
  routesError: null,
  loadingRoutes: false,

  setScreen: (screen) => set({ screen }),
  setOrigin: (origin) => set({ origin }),
  setDestination: (destination) => set({ destination }),
  setConditions: (conditions) => set({ conditions }),

  datetime: () => {
    const { conditions } = get();
    return toIsoDateTime(conditions.date, conditions.time);
  },

  loadRoutes: async () => {
    const { origin, destination, conditions } = get();
    set({ loadingRoutes: true, routesError: null });
    try {
      const routes = await fetchRoutes(queryFor(origin, destination, conditions));
      set({ routes, loadingRoutes: false });
      return routes[0];
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      set({ loadingRoutes: false, routesError: message });
      throw caught;
    }
  },

  routeForConditions: async (conditions) => {
    const { origin, destination } = get();
    const routes = await fetchRoutes(queryFor(origin, destination, conditions));
    // Keep the minimap and the brief on the same route object the walk is
    // reading, so the evidence on screen agrees with the render.
    set({ routes });
    return routes[0];
  },
}));
