/**
 * Orbis talks back asynchronously; the command sequence has to wait on specific
 * messages (`image_accepted`, `state.has_image`, `conditions_ready`,
 * `generation_started`, `generation_reset`). This is the bus that turns those
 * into awaitable promises.
 *
 * Register the waiter *before* sending the command — several of these arrive
 * inside the same tick as the command reply.
 */

import { unwrapOrbisMessage, type OrbisMessage } from "@/lib/orbis";

/** Pseudo-signal: a `state` message carrying `has_image: true`. */
export const HAS_IMAGE = "state.has_image";

type Waiter = {
  resolve: (message: OrbisMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class OrbisSignals {
  private waiters = new Map<string, Set<Waiter>>();
  private lastError: string | null = null;

  /** Feed every app-scope message in here. */
  handle(raw: unknown) {
    const message = unwrapOrbisMessage(raw);
    if (!message?.type) return;

    if (message.type === "command_error") {
      this.lastError = `${message.command ?? "command"}: ${message.reason ?? "rejected"}`;
    }
    if (message.type === "state" && message.has_image === true) {
      this.fire(HAS_IMAGE, message);
    }
    this.fire(message.type, message);
  }

  private fire(signal: string, message: OrbisMessage) {
    const waiters = this.waiters.get(signal);
    if (!waiters) return;
    this.waiters.delete(signal);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  }

  wait(signal: string, timeoutMs = 20_000): Promise<OrbisMessage> {
    return new Promise<OrbisMessage>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.get(signal)?.delete(waiter);
          reject(
            new Error(
              `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for Orbis "${signal}".` +
                (this.lastError ? ` Last error: ${this.lastError}` : ""),
            ),
          );
        }, timeoutMs),
      };
      const existing = this.waiters.get(signal);
      if (existing) existing.add(waiter);
      else this.waiters.set(signal, new Set([waiter]));
    });
  }

  /** Fail every outstanding wait — used when a walk is cancelled or torn down. */
  abort(reason: string) {
    for (const waiters of this.waiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(reason));
      }
    }
    this.waiters.clear();
  }
}
