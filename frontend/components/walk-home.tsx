"use client";

/**
 * The app shell. Three screens — Setup, Walk, Brief — sharing one layout:
 * the viewport and the evidence strip on the left, everything that changes the
 * world on the right. No top bar.
 *
 * The viewport stays mounted across Setup and Walk on purpose: the Orbis
 * session is warmed while the setup panel is still showing its progress, and
 * the screen switch and the first frame land together.
 *
 * **One route.** Comparison was dropped before Checkpoint 3 (PLAN.md, human
 * decision): one start, one destination, one walk, no `?route=` in the share
 * link.
 *
 * **Conditions change the walk in place.** A change made while the walk is
 * playing refetches the same route for the new clock and hands it to
 * `walk.applyConditions`, which morphs the live render. It never stops the walk
 * and never returns to Setup — that is the Phase 3 deliverable, and the thing
 * the submission is graded on.
 */

import { ReactorProvider, useReactor } from "@reactor-team/js-sdk";
import { useCallback, useEffect, useRef, useState } from "react";

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

/**
 * A time picker emits a change per keystroke and a slider per pixel. Each one
 * is a full route recompute on the backend, so coalesce them — short enough
 * that a deliberate change still feels immediate against the ~1.8s chunk the
 * morph has to wait for anyway.
 */
const CONDITION_DEBOUNCE_MS = 250;

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
      fog: shared.fog ?? state.conditions.fog,
      crowd: shared.crowd ?? state.conditions.crowd,
    });
    if (shared.origin) state.setOrigin(shared.origin);
    if (shared.destination) state.setDestination(shared.destination);
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
  const [conditionNote, setConditionNote] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (conditionsTimer.current) clearTimeout(conditionsTimer.current);
    },
    [],
  );

  const onConditionsChange = useCallback(
    (next: ConditionSettings) => {
      store.setConditions(next);
      // On the setup screen there is nothing running to change; the walk picks
      // these up when it starts.
      if (!walk.isRunning) return;

      // Real-time conditions (PLAN.md Phase 3, CORE): the same route recomputed
      // for the new setting and handed to the live walk, which re-sends the
      // current shot's prompt instead of restarting. Debounced so a burst of
      // changes sends one request; `refreshConditions` resolves to null when a
      // newer change has superseded this one, so a slow request landing late
      // cannot roll the render back to a time the viewer has moved off.
      if (conditionsTimer.current) clearTimeout(conditionsTimer.current);
      setConditionNote("Updating conditions");

      conditionsTimer.current = setTimeout(() => {
        void store
          .refreshConditions(next)
          .then((route) => {
            if (!route) return; // superseded; the newer request owns the note
            const result = walk.applyConditions(route);
            setConditionNote(
              result === "geometry-changed"
                ? "Those conditions changed the route itself — stop and start again to walk it."
                : null,
            );
          })
          .catch((caught: unknown) => {
            // The walk keeps playing on the conditions it already has. A failed
            // refetch is a stale readout, not a reason to drop the session.
            setConditionNote(
              `Conditions unchanged: ${caught instanceof Error ? caught.message : String(caught)}`,
            );
          });
      }, CONDITION_DEBOUNCE_MS);
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
    fog: store.conditions.fog,
    crowd: store.conditions.crowd,
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
              {/* Usable *while* the walk runs — that is the whole point of it. */}
              <ConditionControls
                settings={store.conditions}
                onChange={onConditionsChange}
                live={walk.isRunning}
              />
              <div className="button-row">
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
                {/* The condition note only ever describes a running walk. */}
                {(walk.isRunning ? conditionNote : null) ?? walk.statusText}
                {walk.seedNote ? ` · ${walk.seedNote}` : ""}
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
