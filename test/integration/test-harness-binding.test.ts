/**
 * The test servers listen where the tests connect.
 *
 * Supertest connects to 127.0.0.1. Left to itself it listened on `::`, and a
 * port that some other process held on 127.0.0.1 would take the connection —
 * the empty-bodied 404s that moved from test to test for months. See
 * test/setup/each-test.ts.
 */
import { describe, it, expect } from "vitest";
import http from "node:http";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { pinnedServerFor } from "../helpers/loopback";
import { afterAll } from "vitest";

afterAll(async () => { await closeTestApp(); });

describe("where the test app is reached", () => {
  it("is one server, on loopback, that supertest uses instead of making its own", async () => {
    const app = await getTestApp();
    const server = pinnedServerFor(app);
    expect(server, "the test app has a pinned server").toBeTruthy();
    expect((server!.address() as any).address).toBe("127.0.0.1");

    // Supertest wraps a function with http.createServer — it gets the pinned one.
    expect(http.createServer(app as any)).toBe(server);
    // Anything else is untouched.
    expect(http.createServer(() => {})).not.toBe(server);
  });

  it("answers from the app, request after request, without new ports", async () => {
    const app = await getTestApp();
    const port = (pinnedServerFor(app)!.address() as any).port;
    for (let i = 0; i < 20; i++) {
      const res = await request(app).get("/api/surfaces");
      expect(res.status, `request ${i}`).toBe(200);
      expect(res.body).toHaveProperty("enabled");
    }
    // Still the same server afterwards: supertest did not close it.
    expect((pinnedServerFor(app)!.address() as any)?.port).toBe(port);
  });

  it("holds its port on 127.0.0.1, so nothing else can be handed it there", async () => {
    /*
     * The collision that caused the flake, the other way round: a wildcard
     * bind could share a port somebody held on 127.0.0.1. A specific bind on
     * the same address is refused, so the pinned port is ours alone.
     */
    const app = await getTestApp();
    const port = (pinnedServerFor(app)!.address() as any).port;
    const intruder = http.createServer(() => {});
    const outcome = await new Promise<string>((ok) => {
      intruder.once("error", (e: any) => ok(e.code));
      intruder.listen(port, "127.0.0.1", () => ok("bound"));
    });
    intruder.close();
    expect(outcome).toBe("EADDRINUSE");
  });
});
