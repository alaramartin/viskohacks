"use client";

/**
 * App state shared across the three screens. The walk itself (session, phase,
 * current waypoint) lives in `use-orbis-walk`; this is everything around it.
 */

import { create } from "zustand";

import { fetchRoutes, toIsoDateTime } from "@/lib/api";
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
  activeRouteId: string | null;
  routesError: string | null;
  loadingRoutes: boolean;

  setScreen: (screen: Screen) => void;
  setOrigin: (origin: string) => void;
  setDestination: (destination: string) => void;
  setConditions: (conditions: ConditionSettings) => void;
  setActiveRouteId: (routeId: string) => void;
  /** ISO 8601 local datetime for the current condition clock. */
  datetime: () => string;
  /** Fetches both routes and returns the one to walk. Throws on failure. */
  loadRoutes: () => Promise<Route>;
};

export const useWalkStore = create<WalkStore>((set, get) => ({
  screen: "setup",
  origin: DEFAULT_ORIGIN,
  destination: DEFAULT_DESTINATION,
  // `date` is filled in on mount, client-side — a server-rendered "today" and a
  // client-rendered one would not always agree.
  conditions: { date: "", time: "23:00", fog: false, crowd: false },
  routes: [],
  activeRouteId: null,
  routesError: null,
  loadingRoutes: false,

  setScreen: (screen) => set({ screen }),
  setOrigin: (origin) => set({ origin }),
  setDestination: (destination) => set({ destination }),
  setConditions: (conditions) => set({ conditions }),
  setActiveRouteId: (activeRouteId) => set({ activeRouteId }),

  datetime: () => {
    const { conditions } = get();
    return toIsoDateTime(conditions.date, conditions.time);
  },

  loadRoutes: async () => {
    const { origin, destination, activeRouteId } = get();
    set({ loadingRoutes: true, routesError: null });
    try {
      const routes = await fetchRoutes({
        origin,
        destination,
        datetime: get().datetime(),
      });
      const chosen =
        routes.find((route) => route.route_id === activeRouteId) ?? routes[0];
      set({
        routes,
        activeRouteId: chosen.route_id,
        loadingRoutes: false,
      });
      return chosen;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      set({ loadingRoutes: false, routesError: message });
      throw caught;
    }
  },
}));
