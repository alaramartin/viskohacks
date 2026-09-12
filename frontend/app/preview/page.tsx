"use client";

/**
 * DEV-ONLY harness for Person 1's Phase 3 components, without an Orbis session.
 *
 * The Walk and Brief screens only appear after a walk's first frame, and Orbis
 * was rate-limited hackathon-wide, so this page renders EvidenceReadout,
 * Minimap, ConditionControls and RouteBrief against a real `/api/routes`
 * response. Step through waypoints, and change conditions the same way the shell
 * does mid-walk: debounce → `store.refreshConditions` → swap in the route if the
 * geometry matches (what `walk.applyConditions` checks). `window.__preview`
 * exposes state to a browser driver. Renders nothing useful in production.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ConditionControls, type ConditionSettings } from "@/components/ConditionControls";
import { EvidenceReadout } from "@/components/EvidenceReadout";
import { Minimap } from "@/components/Minimap";
import { RouteBrief } from "@/components/RouteBrief";
import type { Route, Waypoint } from "@/lib/contract";
import { buildShareUrl } from "@/lib/share";
import { useWalkStore } from "@/lib/store";

type LogEntry = { at: string; event: string };

function sameGeometry(a: Route, b: Route): boolean {
  return (
    a.waypoints.length === b.waypoints.length &&
    a.waypoints.every((waypoint, index) => waypoint.block_id === b.waypoints[index].block_id)
  );
}

export default function PreviewPage() {
  const store = useWalkStore();
  const [route, setRoute] = useState<Route | null>(null);
  const [index, setIndex] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const note = useCallback((event: string) => {
    setLog((current) => [...current, { at: new Date().toISOString().slice(11, 19), event }]);
  }, []);

  useEffect(() => {
    const state = useWalkStore.getState();
    state.setConditions({ date: "2026-09-12", time: "23:00", fog: false, crowd: false });
    state
      .loadRoutes()
      .then((loaded) => {
        setRoute(loaded);
        note(`loaded ${loaded.waypoints.length} waypoints, ${loaded.shots?.length ?? 0} shots`);
      })
      .catch((caught) => setError(String(caught)));
  }, [note]);

  // Same previous-waypoint bookkeeping as the shell, so change emphasis behaves the same.
  const waypoint: Waypoint | null = route?.waypoints[index] ?? null;
  const current = useRef<Waypoint | null>(null);
  const previous = useRef<Waypoint | null>(null);
  if (current.current !== waypoint) {
    previous.current = current.current;
    current.current = waypoint;
  }

  const onConditionsChange = useCallback(
    (next: ConditionSettings) => {
      store.setConditions(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void store
          .refreshConditions(next)
          .then((fresh) => {
            if (!fresh) return note("superseded by a newer change");
            setRoute((existing) => {
              if (existing && !sameGeometry(existing, fresh)) {
                note("REJECTED: geometry changed");
                return existing;
              }
              const ambient = fresh.waypoints[0]?.condition.ambient;
              note(`applied ${next.time} fog=${next.fog} crowd=${next.crowd} darkness=${ambient?.darkness}`);
              return fresh;
            });
          })
          .catch((caught) => note(`refresh failed: ${String(caught)}`));
      }, 400);
    },
    [note, store],
  );

  useEffect(() => {
    (window as unknown as { __preview?: unknown }).__preview = {
      index,
      waypointCount: route?.waypoints.length ?? 0,
      conditions: store.conditions,
      facts: waypoint?.condition.facts ?? [],
      ambient: waypoint?.condition.ambient ?? null,
      log,
      error,
    };
  }, [error, index, log, route, store.conditions, waypoint]);

  if (process.env.NODE_ENV === "production") {
    return <main className="walk-home">Preview is dev-only.</main>;
  }

  const last = (route?.waypoints.length ?? 1) - 1;
  const shareUrl = buildShareUrl({
    origin: store.origin,
    destination: store.destination,
    datetime: store.datetime(),
  });

  return (
    <main className="walk-home">
      <div className="shell-grid">
        <div className="shell-left">
          <div className="panel">
            <h2>Component preview (dev only)</h2>
            <p className="hint">
              {error ?? (route ? `Waypoint ${index + 1} of ${last + 1}` : "Loading route…")}
            </p>
            <div className="button-row">
              <button type="button" id="preview-prev" onClick={() => setIndex((i) => Math.max(0, i - 1))}>
                Previous waypoint
              </button>
              <button type="button" id="preview-next" onClick={() => setIndex((i) => Math.min(last, i + 1))}>
                Next waypoint
              </button>
            </div>
            <pre id="preview-log" className="stub-data">
              {log.map((entry) => `${entry.at} ${entry.event}`).join("\n")}
            </pre>
          </div>
          <EvidenceReadout waypoint={waypoint} previousWaypoint={previous.current} />
        </div>
        <div className="shell-right">
          <Minimap route={route} waypointIndex={index} />
          <ConditionControls settings={store.conditions} onChange={onConditionsChange} live />
        </div>
      </div>
      <RouteBrief
        route={route}
        origin={store.origin}
        destination={store.destination}
        datetime={store.datetime()}
        conditions={store.conditions}
        shareUrl={shareUrl}
      />
    </main>
  );
}
