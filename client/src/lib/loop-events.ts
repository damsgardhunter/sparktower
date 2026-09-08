import { LOOP_EVENTS, type LoopEventName } from "@shared/loop-events";

/**
 * Reporting the two loop events only the browser can see.
 *
 * A composer opening and a link being copied never reach the server any other
 * way, and without the first one time-to-post can't be computed at all.
 *
 * Fire-and-forget by design: nothing here returns a promise the caller is
 * expected to await, and a failure is swallowed. Someone's check-in must never
 * be slower, or fail, because a metric didn't send.
 */
export function trackLoopEvent(
  name: LoopEventName,
  payload: { projectId?: string; checkInId?: string; sessionId?: string } = {},
): void {
  try {
    const body = JSON.stringify({ name, ...payload });

    /*
     * `sendBeacon` survives the page being navigated away from — which is
     * exactly what happens when someone copies a link and leaves. It falls
     * back to fetch with keepalive where it isn't available.
     */
    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon(
        "/api/loop-events",
        new Blob([body], { type: "application/json" }),
      );
      if (ok) return;
    }
    void fetch("/api/loop-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      credentials: "include",
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* metrics are never worth an exception in a click handler */
  }
}

/**
 * A new composing session.
 *
 * Links "composer opened" to the check-in that came out of it, which is the
 * only way to know how long writing one actually took.
 */
export function newComposeSession(): string {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export { LOOP_EVENTS };
