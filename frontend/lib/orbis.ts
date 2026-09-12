/**
 * Orbis model configuration and message helpers.
 *
 * `-dynamic`, not `-stable`: spike Q5 measured stable's time-to-first-frame at
 * 3.1s and 25.0s across two identical runs, which is not survivable on a
 * two-minute demo clock, and dynamic morphs a mid-run `set_prompt` at the next
 * chunk boundary — that is how a condition changes at a waypoint boundary
 * inside a block without a cut (docs/reactor-findings.md).
 */

export const ORBIS_MODEL_NAME = "reactor/visko-orbis-dynamic";

export const ORBIS_API_URL = "https://api.reactor.inc";

export const ORBIS_TRACKS = [
  { name: "main_video", kind: "video", direction: "recvonly" },
  { name: "main_audio", kind: "audio", direction: "recvonly" },
] as const;

export const DOCUMENTED_RESOLUTIONS = ["1080p", "2k", "4k"];

/** Output resolution for the whole route. Set once; survives `reset` (Q6). */
export const ORBIS_RESOLUTION = "1080p";

/**
 * Seed frames are resized by Orbis *without* cropping, so anything that is not
 * the model's frame shape arrives distorted. Dynamic's seed target is 640×368
 * (docs/reactor-findings.md, Q5), so the night grade cover-crops to exactly
 * that before upload.
 */
export const SEED_WIDTH = 640;
export const SEED_HEIGHT = 368;

export type OrbisMessage = {
  type?: string;
  command?: string;
  reason?: string;
  available_resolutions?: string[];
  width?: number;
  height?: number;
  has_image?: boolean;
  image_conditioned?: boolean;
  started?: boolean;
  paused?: boolean;
};

export function unwrapOrbisMessage(raw: unknown): OrbisMessage {
  const envelope = raw as { type?: string; data?: Record<string, unknown> };
  if (envelope?.data && typeof envelope.data === "object") {
    return { ...envelope.data, type: envelope.type } as OrbisMessage;
  }
  return raw as OrbisMessage;
}

export async function requestReactorJwt(model = ORBIS_MODEL_NAME) {
  const response = await fetch("/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  const result = (await response.json()) as { jwt?: string; error?: string };
  if (!response.ok || !result.jwt) {
    throw new Error(result.error || "Could not create a Reactor token");
  }
  return result.jwt;
}
