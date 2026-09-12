"use client";

/**
 * The app shell. Three screens — Setup, Walk, Brief — sharing one layout:
 * the viewport and the evidence strip on the left, everything that changes the
 * world on the right. No top bar.
 *
 * The viewport stays mounted across Setup and Walk on purpose: the Orbis
 * session is warmed while the setup panel is still showing its progress, and
 * the screen switch and the first frame land together.
 */

import { ReactorProvider, useReactor } from "@reactor-team/js-sdk";
import { useCallback, useEffect, useRef } from "react";

import { ConditionControls, type ConditionSettings } from "@/components/ConditionControls";
import { EvidenceReadout } from "@/components/EvidenceReadout";
import { Minimap } from "@/components/Minimap";
import { RouteBrief } from "@/components/RouteBrief";
import { SetupPanel } from "@/components/setup-panel";
import { Viewport } from "@/components/Viewport";
import { useOrbisWalk } from "@/hooks/use-orbis-walk";
import type { Waypoint } from "@/lib/contract";
import {
  ORBIS_API_URL,
  ORBIS_MODEL_NAME,
  ORBIS_TRACKS,
  requestReactorJwt,
} from "@/lib/orbis";
import { buildShareUrl, readShareParams } from "@/lib/share";
import { useWalkStore } from "@/lib/store";

const MODEL_TRACKS = [...ORBIS_TRACKS];

export function WalkHome() {
  // Mint the JWT once per session and pass the same string every time: a
  // resolver that re-mints per request makes the second call arrive with a
  // token that does not own the session, and Reactor answers 403 (spike Q3).
  const jwtPromise = useRef<Promise<string> | null>(null);
  const getJwt = useCallback(() => {
    jwtPromise.current ??= requestReactorJwt();
    return jwtPromise.current;
  }, []);
  const clearJwt = useCallback(() => {
    jwtPromise.current = null;
  }, []);

  return (
    <ReactorProvider
      apiUrl={ORBIS_API_URL}
      modelName={ORBIS_MODEL_NAME}
      modelTracks={MODEL_TRACKS}
      connectOptions={{ autoConnect: false }}
      jwtToken={getJwt}
    >
      <WalkShell onDisconnected={clearJwt} />
    </ReactorProvider>
  );
}

function WalkShell({ onDisconnected }: { onDisconnected: () => void }) {
  const store = useWalkStore();
  const status = useReactor((state) => state.status);

  const setScreen = store.setScreen;
  const walk = useOrbisWalk({
    onFirstFrame: useCallback(() => setScreen("walk"), [setScreen]),
  });

  // A session-scoped token dies with its session; the next walk needs a new one.
  const previousStatus = useRef(status);
  useEffect(() => {
    if (status === "disconnected" && previousStatus.current !== "disconnected") {
      onDisconnected();
    }
    previousStatus.current = status;
  }, [onDisconnected, status]);

  // Today's date, and anything carried in a share link.
  useEffect(() => {
    const shared = readShareParams(window.location.search);
    const state = useWalkStore.getState();
    const [sharedDate, sharedTime] = (shared.datetime ?? "").split("T");
    state.setConditions({
      ...state.conditions,
      date: sharedDate || new Date().toISOString().slice(0, 10),
      time: sharedTime ? sharedTime.slice(0, 5) : state.conditions.time,
    });
    if (shared.origin) state.setOrigin(shared.origin);
    if (shared.destination) state.setDestination(shared.destination);
    if (shared.route) state.setActiveRouteId(shared.route);
  }, []);

  // What the evidence readout compares against for its change emphasis.
  const currentWaypoint = useRef<Waypoint | null>(null);
  const previousWaypoint = useRef<Waypoint | null>(null);
  if (currentWaypoint.current !== walk.waypoint) {
    previousWaypoint.current = currentWaypoint.current;
    currentWaypoint.current = walk.waypoint;
  }

  const startWalk = useCallback(async () => {
    // Connect and fetch the routes at the same time: connecting is ~7–11s and
    // does not need the routes, so the two waits overlap instead of stacking.
    const routePromise = store.loadRoutes();
    routePromise.catch(() => {
      /* surfaced through the store and the walk's error state */
    });
    await walk.start(routePromise);
  }, [store, walk]);

  const conditionsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onConditionsChange = useCallback(
    (next: ConditionSettings) => {
      store.setConditions(next);
      if (!walk.isRunning) return;
      // Real-time conditions (PLAN.md Phase 3, CORE): the same route recomputed for
      // the new setting and handed to the live walk, which re-sends the current
      // shot's prompt instead of restarting. Debounced so a burst of changes sends
      // one request; a failed refresh leaves the walk on its current conditions.
      if (conditionsTimer.current) clearTimeout(conditionsTimer.current);
      conditionsTimer.current = setTimeout(() => {
        void store
          .refreshConditions(next)
          .then((route) => {
            if (route) walk.applyConditions(route);
          })
          .catch(() => {});
      }, 400);
    },
    [store, walk],
  );

  const openBrief = useCallback(() => {
    walk.stop();
    store.setScreen("brief");
  }, [store, walk]);

  const busy = store.loadingRoutes || (walk.isRunning && store.screen === "setup");
  const shareUrl = buildShareUrl({
    origin: store.origin,
    destination: store.destination,
    datetime: store.datetime(),
  });

  if (store.screen === "brief") {
    return (
      <main className="walk-home">
        <RouteBrief
          route={walk.route ?? store.routes[0] ?? null}
          origin={store.origin}
          destination={store.destination}
          datetime={store.datetime()}
          conditions={store.conditions}
          shareUrl={shareUrl}
        />
        <div className="button-row">
          <button type="button" onClick={() => store.setScreen("setup")}>
            Back to setup
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="walk-home">
      <div className="shell-grid">
        <div className="shell-left">
          <Viewport walk={walk} />
          <EvidenceReadout
            waypoint={walk.waypoint}
            previousWaypoint={previousWaypoint.current}
          />
        </div>

        <div className="shell-right">
          {store.screen === "setup" ? (
            <SetupPanel
              origin={store.origin}
              destination={store.destination}
              conditions={store.conditions}
              onOriginChange={store.setOrigin}
              onDestinationChange={store.setDestination}
              onConditionsChange={store.setConditions}
              onSubmit={startWalk}
              onInteract={walk.warmUp}
              busy={busy}
              statusText={walk.statusText || (store.loadingRoutes ? "Computing routes" : "")}
              error={walk.error ?? store.routesError}
            />
          ) : (
            <>
              <Minimap
                route={walk.route ?? store.routes[0] ?? null}
                waypointIndex={walk.waypointIndex}
              />
              <ConditionControls
                settings={store.conditions}
                onChange={onConditionsChange}
                live={walk.isRunning}
              />
              <div className="button-row">
                <button type="button" disabled title="Compare view lands in Phase 3">
                  Compare routes
                </button>
                <button type="button" onClick={openBrief}>
                  Share brief
                </button>
              </div>
              <div className="button-row secondary">
                <button
                  type="button"
                  onClick={() => {
                    walk.stop();
                    store.setScreen("setup");
                  }}
                >
                  Stop walk
                </button>
              </div>
              <p className="walk-status">
                {walk.statusText}
                {walk.seedNote ? ` · ${walk.seedNote}` : ""}
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
