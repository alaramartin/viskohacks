/**
 * The Orbis command sequence, generalised from the starter's
 * `use-orbis-session.ts` into the shape the walk needs.
 *
 * ONE LONG-LIVED SESSION PER ROUTE. Only one concurrent session exists (spike
 * Q3, and Reactor staff confirmed it will not be raised), and a `reset` +
 * re-seed inside a live session costs ~2.3s against ~11.8s for a fresh connect
 * (Q6). So: connect once, pin seed and resolution, then per block
 * `reset` → `set_image` → `set_prompt` → `start`.
 *
 * Two rules from Q3 that the caller must hold up, because they cost us the only
 * session slot three times during the spike:
 *   - always `disconnect()` in a `finally`;
 *   - mint the JWT once and pass the string (a resolver that re-mints per
 *     request 403s "this token is session-scoped").
 */

import { unwrapOrbisMessage, type OrbisMessage } from "@/lib/orbis";
import { HAS_IMAGE, OrbisSignals } from "@/lib/orbis/signals";

type FileRefLike = unknown;

export type OrbisContext = {
  sendCommand: (
    command: string,
    data?: Record<string, unknown>,
  ) => Promise<unknown>;
  uploadFile: (file: File | Blob, options?: { name?: string }) => Promise<FileRefLike>;
  signals: OrbisSignals;
};

function assertAccepted(raw: unknown, command: string, expected?: string): OrbisMessage {
  // Only some commands answer synchronously — `set_seed`, `set_resolution`,
  // `start` and `reset` resolve to undefined and report through the message
  // stream instead. A missing reply is only a failure when we asked for a
  // specific one (`set_image` → `image_accepted`).
  const message = unwrapOrbisMessage(raw);
  if (!message) {
    if (!expected) return {};
    throw new Error(`Orbis did not answer ${command}.`);
  }
  if (message.type === "command_error") {
    throw new Error(`${command}: ${message.reason ?? "rejected"}`);
  }
  if (expected && message.type !== expected) {
    throw new Error(
      `Expected ${expected} from ${command}, received ${message.type ?? "an unknown reply"}.`,
    );
  }
  return message;
}

/**
 * Route-wide settings. `set_seed` and `set_resolution` survive `reset` (Q6), so
 * pinning the noise seed here keeps weather and lighting realisation from
 * diverging wildly between blocks of the same walk.
 */
export async function pinRouteSession(
  context: OrbisContext,
  options: { seed: number; resolution: string },
) {
  assertAccepted(
    await context.sendCommand("set_seed", { seed: options.seed }),
    "set_seed",
  );
  assertAccepted(
    await context.sendCommand("set_resolution", { resolution: options.resolution }),
    "set_resolution",
  );
}

/** Stop the current generation and wait for Orbis to confirm it is clear. */
export async function resetGeneration(context: OrbisContext) {
  const wasReset = context.signals.wait("generation_reset", 15_000);
  await context.sendCommand("reset", {});
  await wasReset;
}

export type SeedBlockOptions = {
  /** The night-graded frame. Never the raw daytime one. */
  image: File;
  videoPrompt: string;
  audioPrompt: string;
};

export type SeedBlockResult = {
  /** What Orbis reports about whether it actually used our frame. */
  imageConditioned: boolean | null;
  width?: number;
  height?: number;
};

/**
 * Seed one block and start generating. Returns once `generation_started`
 * arrives — which is ~5–6s before the first *visible* frame, so the caller
 * still has to hold the previous render until real frames land.
 */
export async function seedBlock(
  context: OrbisContext,
  options: SeedBlockOptions,
): Promise<SeedBlockResult> {
  const uploaded = await context.uploadFile(options.image, {
    name: options.image.name,
  });

  const hasImage = context.signals.wait(HAS_IMAGE, 20_000);
  const accepted = assertAccepted(
    await context.sendCommand("set_image", { image: uploaded }),
    "set_image",
    "image_accepted",
  );
  await hasImage;

  if (options.audioPrompt) {
    assertAccepted(
      await context.sendCommand("set_audio_prompt", { prompt: options.audioPrompt }),
      "set_audio_prompt",
    );
  }

  const conditionsReady = context.signals.wait("conditions_ready", 20_000);
  assertAccepted(
    await context.sendCommand("set_prompt", { prompt: options.videoPrompt }),
    "set_prompt",
  );
  await conditionsReady;

  const started = context.signals.wait("generation_started", 30_000);
  assertAccepted(await context.sendCommand("start", {}), "start");
  const startedMessage = await started;

  return {
    imageConditioned: startedMessage.image_conditioned ?? null,
    width: accepted.width,
    height: accepted.height,
  };
}

/**
 * Change conditions inside a live block. `-dynamic` morphs at the next chunk
 * boundary (~1.8s) instead of cutting, which is how a condition changes at a
 * waypoint boundary without breaking the "hard cuts only at block boundaries"
 * rule (Q5).
 */
export async function morphPrompt(context: OrbisContext, prompt: string) {
  assertAccepted(await context.sendCommand("set_prompt", { prompt }), "set_prompt");
}
