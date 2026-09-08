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
import { loadSurfaceFlags } from "../../server/surfaces";

let cached: { app: Express; server: Server } | null = null;

/**
 * Builds the app once per worker and reuses it.
 *
 * Route registration opens database connections and reads feature flags; doing
 * that per test would dominate the runtime and prove nothing that doing it once
 * doesn't. State that must not leak between tests lives in the database, and
 * that is truncated before each one.
 */
export async function getTestApp(): Promise<Express> {
  if (cached) return cached.app;

  const server = createServer();
  const app = await createApp({ httpServer: server, logRequests: false });

  /*
   * Kill switches decide whether whole route prefixes answer at all, so the
   * flags have to be loaded or every gated endpoint 404s and the failure looks
   * like a routing bug.
   */
  await loadSurfaceFlags();

  cached = { app, server };
  return app;
}

/** Releases the http server the app was registered against. */
export async function closeTestApp(): Promise<void> {
  if (!cached) return;
  const { server } = cached;
  cached = null;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
