/**
 * The one server each test app is reached through. See test/setup/each-test.ts
 * for why supertest must not make its own.
 */
import type { Server } from "node:http";

const pinned = new WeakMap<object, Server>();

/** Marks `server`, already listening on loopback, as the way to reach `app`. */
export function pinServer(app: object, server: Server): void {
  pinned.set(app, server);
}

export function pinnedServerFor(app: object): Server | undefined {
  return pinned.get(app);
}
