/**
 * Page views, from the only place that knows about them.
 *
 * Routing happens in the browser, so the server never sees a page change — it
 * sees one document request and then a series of API calls that don't say what
 * anyone is looking at. This closes that half of the picture.
 *
 * Everything is best-effort by design. A blocked request, a dead network, a
 * browser refusing `sendBeacon` — none of it may ever surface to the person
 * using the site. Analytics is the least important thing on the page.
 *
 * What is sent: the path, the referrer, the document title, and how long the
 * previous page was open. No form contents, no clicks, no keystrokes.
 */
import { ACTIVITY_EVENTS, CLIENT_FLUSH_MS, MAX_BATCH_EVENTS } from "@shared/analytics";

interface QueuedEvent {
  name: string;
  path: string;
  referrer?: string;
  title?: string;
  msOnPage?: number;
}

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let lastPath: string | null = null;
let enteredAt = 0;

/**
 * Sends what's queued and clears it.
 *
 * `keepalive` is what lets the last batch survive the page being closed, which
 * is exactly when the most interesting event — how long they stayed — is
 * generated. `sendBeacon` is preferred where it exists for the same reason.
 */
function flush(final = false) {
  if (timer) { clearTimeout(timer); timer = null; }
  if (queue.length === 0) return;

  const events = queue.slice(0, MAX_BATCH_EVENTS);
  queue = queue.slice(MAX_BATCH_EVENTS);
  const body = JSON.stringify({ events });

  try {
    if (final && typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      credentials: "include",
      keepalive: true,
    }).catch(() => { /* never surfaces */ });
  } catch {
    /* never surfaces */
  }
}

function enqueue(event: QueuedEvent) {
  queue.push(event);
  if (queue.length >= MAX_BATCH_EVENTS) return flush();
  if (!timer) timer = setTimeout(() => flush(), CLIENT_FLUSH_MS);
}

/**
 * Records a page change.
 *
 * Guards against being called twice for the same path — wouter re-renders on
 * state changes that aren't navigations, and a doubled page view turns a
 * two-page visit into a four-page one in the numbers.
 */
export function trackPageView(path: string) {
  if (path === lastPath) return;

  const now = Date.now();
  const msOnPage = lastPath && enteredAt ? now - enteredAt : undefined;
  const previous = lastPath;

  lastPath = path;
  enteredAt = now;

  enqueue({
    name: ACTIVITY_EVENTS.pageView,
    path,
    // The page they came from is more useful than the external referrer, which
    // is only ever set on the first page of a visit.
    referrer: previous ?? (typeof document !== "undefined" ? document.referrer || undefined : undefined),
    title: typeof document !== "undefined" ? document.title : undefined,
    msOnPage,
  });
}

let installed = false;

/** Wires the flush-on-leave handlers. Safe to call more than once. */
export function installAnalytics() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  /*
   * `pagehide` rather than `unload`: `unload` is unreliable on mobile Safari
   * and blocks the back/forward cache everywhere else. `visibilitychange` to
   * hidden covers switching tabs and locking the phone, which is where most
   * sessions actually end.
   */
  window.addEventListener("pagehide", () => {
    if (lastPath && enteredAt) {
      enqueue({
        name: ACTIVITY_EVENTS.pageView,
        path: lastPath,
        title: typeof document !== "undefined" ? document.title : undefined,
        msOnPage: Date.now() - enteredAt,
      });
      // Already counted; don't send the duration twice if the page comes back.
      enteredAt = 0;
    }
    flush(true);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
}
