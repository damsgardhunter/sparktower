/**
 * The app under test, wired the way production wires it.
 *
 * Built through `createApp` from server/app.ts — the same function
 * `server/index.ts` calls — so a test exercises the real middleware stack in
 * the real order. Nothing here re-implements any of it.
 *
 * Never listens on a port. Supertest is given the Express handler directly and
 * binds an ephemeral port per request, so test files can run in parallel
 * without racing each other for a fixed one.
 */
import { createServer, type Server } from "http";
import type { Express } from "express";
import { createApp } from "../../server/app";
import { loadSurfaceFlags, stopSurfaceFlagRefresh } from "../../server/surfaces";

let cached: { app: Express; server: Server } | null = null;
/** The build in progress, so two callers cannot start two of them. */
let building: Promise<Express> | null = null;

/**
 * How many route layers a fully-built app has, near enough.
 *
 * Not a count to keep up to date — a floor, well below the real number, whose
 * only job is to tell a half-built app from a whole one.
 */
const FEWEST_PLAUSIBLE_LAYERS = 50;

/**
 * Whether a path is actually routable on this app.
 *
 * Walks the router stack, including routers mounted under a prefix, and asks
 * each layer's matcher about the path. Express 4 and 5 disagree about where
 * the stack lives and what a layer looks like, so this is deliberately
 * forgiving: anything it cannot interpret is treated as "present", because a
 * check that cannot see is not entitled to an opinion.
 */
function registered(stack: any[], path: string): boolean {
  for (const layer of stack) {
    try {
      if (layer?.regexp?.fast_slash) {
        if (Array.isArray(layer?.handle?.stack) && registered(layer.handle.stack, path)) return true;
        continue;
      }
      if (typeof layer?.match === "function" && layer.match(path)) return true;
      if (layer?.regexp instanceof RegExp && layer.regexp.test(path)) {
        if (layer?.route) return true;
        if (Array.isArray(layer?.handle?.stack)) {
          const rest = path.replace(new RegExp(`^${layer.path ?? ""}`), "") || "/";
          if (registered(layer.handle.stack, rest)) return true;
        }
      }
    } catch {
      // A layer this cannot interrogate is not evidence of absence.
      return true;
    }
  }
  return false;
}

/**
 * Builds the app once per worker and reuses it.
 *
 * Route registration opens database connections and reads feature flags; doing
 * that per test would dominate the runtime and prove nothing that doing it once
 * doesn't. State that must not leak between tests lives in the database, and
 * that is truncated before each one.
 *
 * ## Why this checks its own work
 *
 * A long run of several integration files occasionally produced a 404 with an
 * empty body from a route that certainly exists — `POST /api/auth/register`,
 * which is not behind a kill switch and cannot be turned off. A 404 with no
 * body is Express saying nothing matched, so for that request the route was
 * not on the app. It never reproduced with one file, only in long runs, and it
 * moved from test to test.
 *
 * The cause is still unidentified, and guessing at it in silence is how a
 * flake survives for months. What is fixed here is the *diagnosis*: an app
 * that comes back without a plausible number of routes now throws while it is
 * being built, naming what it found, instead of being cached and producing a
 * mystery 404 in whichever test happens to run next. If the build is fine and
 * the 404 still appears, that rules the build out and says so.
 */
export async function getTestApp(): Promise<Express> {
  if (cached) return cached.app;
  // Two callers arriving together must not each build one.
  if (building) return building;

  building = (async () => {
    const server = createServer();
    const app = await createApp({ httpServer: server, logRequests: process.env.TEST_LOG_REQUESTS === "1" });

    /*
     * Kill switches decide whether whole route prefixes answer at all, so the
     * flags have to be loaded or every gated endpoint 404s and the failure
     * looks like a routing bug.
     */
    await loadSurfaceFlags();

    /*
     * Express 5 renamed the internal router from `_router` to `router`, and a
     * probe that only knew the old name reported zero layers for a perfectly
     * healthy app. Both names are read, and an app that exposes neither is
     * left alone rather than failed — a check that cannot see anything must
     * not claim what it sees is wrong.
     */
    const stack = (app as any)?.router?.stack ?? (app as any)?._router?.stack;
    const layers = Array.isArray(stack) ? stack.length : null;
    if (layers !== null && layers < FEWEST_PLAUSIBLE_LAYERS) {
      throw new Error(
        `The test app finished building with only ${layers} route layers, which means registration did not complete. ` +
        `Every request against it would 404 with an empty body. Failing here rather than caching it.`,
      );
    }

    /*
     * And check a route that must exist, not just that there are many.
     *
     * The layer count never fired, and the thing it was meant to catch kept
     * happening: `POST /api/auth/register` answering with Express's own
     * "Cannot POST" page, which is what Express says when nothing matched.
     * A count cannot tell a hundred middleware layers from a hundred
     * middleware layers plus the routes, so this asks for the route itself.
     *
     * Registration is awaited inside `createApp`, so an app that reaches here
     * without it is a genuine puzzle — and one worth failing loudly at the
     * moment it is built rather than in whichever test happens to run next.
     */
    if (Array.isArray(stack) && !registered(stack, "/api/auth/register")) {
      throw new Error(
        `The test app was built without POST /api/auth/register, though it has ${layers} layers. ` +
        `Requests to it would answer with Express's own 404 page. Refusing to cache this app.`,
      );
    }

    cached = { app, server };
    return app;
  })();

  try {
    return await building;
  } finally {
    building = null;
  }
}

/**
 * Releases the http server and the flag refresher. The database pool is
 * deliberately left alone: server/db.ts is one module instance across the
 * whole run, so ending it here would take it away from every file after this
 * one.
 */
export async function closeTestApp(): Promise<void> {
  building = null;
  if (!cached) return;
  const { server } = cached;
  cached = null;
  stopSurfaceFlagRefresh();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
