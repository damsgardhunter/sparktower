/**
 * Runs in every worker, around every test.
 *
 * Empties the database before each test rather than after. Cleaning up
 * afterwards leaves a failing test's rows behind for inspection, and — more
 * usefully — means a test never inherits state from whatever ran before it,
 * including a run that crashed halfway through and never got to its cleanup.
 *
 * Only for the integration suite. The unit tests are pure functions with no
 * database anywhere near them, and truncating a table before each one would
 * make them slower, and worse, make them fail when Postgres isn't running —
 * at which point they aren't unit tests any more.
 */
import http from "node:http";
import { beforeEach } from "vitest";
import { truncateAll } from "./database";
import { pinnedServerFor } from "../helpers/loopback";

/*
 * Every request the tests send reaches this app, and nothing else.
 *
 * This is the "404 with an empty body from a route that certainly exists"
 * that test/helpers/app.ts spent a long comment failing to explain. Supertest
 * turns the app into a fresh server for *each request*, calls `listen(0)` with
 * no host — which on macOS binds the IPv6 wildcard `::` — and then connects to
 * `127.0.0.1` on the port it got. The kernel does not stop a wildcard bind
 * from taking a port that another process already holds on 127.0.0.1
 * specifically, and when both exist the specific one wins. So now and then a
 * request walked into somebody else's server — a dev server, another session's
 * test run, anything on the machine listening on loopback — which knew nothing
 * of our routes and answered 404 with no body.
 *
 * That is why it only ever happened in long runs (hundreds of fresh ports per
 * file, each a chance), moved from test to test, never reproduced on its own,
 * and got worse when more was running on the machine. And why the checks that
 * the app was fully built never fired: it was. The request never reached it.
 * Reproduced directly: a server on 127.0.0.1:P answering 404, then
 * `listen(P)` with no host succeeds beside it, and a request to 127.0.0.1:P
 * gets the stranger's empty 404.
 *
 * The fix is to stop supertest making servers for the test app at all.
 * `getTestApp` binds one server on 127.0.0.1 before any test runs — where a
 * second bind on the same address *is* refused, so the port is ours alone —
 * and supertest, which wraps a function by calling `http.createServer(app)`,
 * is handed that already-listening server instead. Seeing it listening, it
 * uses its port and never calls `listen` itself.
 *
 * Not done by making `listen(0)` pass a host, which was the first attempt:
 * supertest reads the port synchronously right after `listen(0)`, and naming
 * a host makes Node's bind asynchronous, so every request would have failed.
 */
const createServer = http.createServer;
(http as any).createServer = function pinnedCreateServer(...args: any[]) {
  const pinned = typeof args[0] === "function" ? pinnedServerFor(args[0]) : undefined;
  return pinned ?? (createServer as any).apply(http, args);
};

const url = process.env.DATABASE_URL;

beforeEach(async (ctx) => {
  const file = ctx.task?.file?.filepath ?? "";
  // Default to truncating when the path can't be determined: a stray row is a
  // confusing test failure, a skipped truncation is a mysterious one.
  if (file.includes(`${"/"}test${"/"}unit${"/"}`)) return;

  if (!url) throw new Error("DATABASE_URL is unset in the test worker");
  await truncateAll(url);
});
