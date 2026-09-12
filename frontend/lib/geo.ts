/** Small spherical-geometry helpers. No dependencies, SF-scale accuracy. */

import type { LatLng } from "@/lib/contract";

const EARTH_RADIUS_M = 6_371_000;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

export function distanceMeters(from: LatLng, to: LatLng): number {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLat = lat2 - lat1;
  const dLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing from → to, in degrees clockwise from north. */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLng = toRadians(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/** Signed difference target − reference, normalised to (−180, 180]. */
export function relativeBearing(reference: number, target: number): number {
  const delta = ((target - reference + 540) % 360) - 180;
  return delta === -180 ? 180 : delta;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 5) * 5} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export type ProjectedPoint = { x: number; y: number };

/**
 * Equirectangular projection of a set of coordinates into a width×height box,
 * preserving aspect ratio at SF's latitude. Enough for a minimap; not a map
 * projection anyone should navigate by.
 */
export function projectPoints(
  points: LatLng[],
  width: number,
  height: number,
  padding = 8,
): ProjectedPoint[] {
  if (points.length === 0) return [];

  const midLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const scaleX = Math.cos(toRadians(midLat));
  const xs = points.map((p) => p.lng * scaleX);
  const ys = points.map((p) => -p.lat);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spanX = maxX - minX || 1e-9;
  const spanY = maxY - minY || 1e-9;
  const usableW = Math.max(1, width - padding * 2);
  const usableH = Math.max(1, height - padding * 2);
  const scale = Math.min(usableW / spanX, usableH / spanY);

  const offsetX = padding + (usableW - spanX * scale) / 2;
  const offsetY = padding + (usableH - spanY * scale) / 2;

  return points.map((point, index) => ({
    x: offsetX + (xs[index] - minX) * scale,
    y: offsetY + (ys[index] - minY) * scale,
  }));
}
