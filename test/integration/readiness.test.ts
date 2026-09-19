/**
 * Telling a working deployment from one that only looks like one.
 *
 * The first deploy of this app to a real host came up, printed "Your service is
 * live 🎉", answered /_health with a 200 — and failed every single query with
 * ECONNREFUSED 127.0.0.1:5433, because its DATABASE_URL was still the one from
 * somebody's laptop. Nothing about the deployment said so.
 *
 * /_health stays shallow on purpose: it's what the platform polls, and the only
 * thing a platform can do about a "no" is restart the process, which turns an
 * unreachable database into a crash loop. /_ready is the one that asks.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { pool } from "../../server/db";

afterAll(async () => { await closeTestApp(); });

describe("the two health questions", () => {
  it("answers /_health without touching the database", async () => {
    const app = await getTestApp();
    // Even if every query would fail, this one must not: it asks whether the
    // process is alive, and the process is alive.
    const spy = vi.spyOn(pool, "query").mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5433") as never);
    try {
      expect((await request(app).get("/_health")).status).toBe(200);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("says ready when the database answers", async () => {
    const app = await getTestApp();
    const res = await request(app).get("/_ready");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ ready: true, database: "ok" });
    expect(typeof res.body.ms).toBe("number");
  });

  it("counts the migrations, because reachable is not the same as usable", async () => {
    /*
     * A build whose schema is ahead of its database answers SELECT 1 perfectly
     * and then 500s on every route that reads an account — with an error naming
     * a column rather than the migrations nobody ran. That happened: two
     * pending migrations, and a hundred-column SELECT to work back from.
     */
    const app = await getTestApp();
    const res = await request(app).get("/_ready");
    /*
     * Said coarsely on purpose. The route is public and unauthenticated — a
     * deploy check that needs a credential is one nobody runs — so "three
     * migrations short" would tell a stranger the deployment is mid-broken and
     * roughly where. The count goes to the log instead; see below.
     */
    expect(res.body.migrations).toBe("ok");
    expect(JSON.stringify(res.body)).not.toMatch(/pending|expected|applied/);
  });

  it("says 503 without telling the caller which address it tried", async () => {
    /*
     * The address is the answer nine times out of ten — a localhost here means
     * the deployment carries a development connection string — and it is also
     * an internal hostname and port, which is not a public fact about a
     * publicly readable endpoint. So it goes to the log, where the operator
     * already is, and not into the body.
     */
    const app = await getTestApp();
    const logged: string[] = [];
    const log = vi.spyOn(console, "error").mockImplementation((...args: any[]) => { logged.push(args.join(" ")); });
    const spy = vi.spyOn(pool, "query")
      .mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5433") as never);
    try {
      const res = await request(app).get("/_ready");
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ ready: false, database: "unreachable" });
      expect(JSON.stringify(res.body), "no address in the answer").not.toContain("5433");
      expect(logged.join("\n"), "but the operator still gets it").toContain("127.0.0.1:5433");
    } finally {
      spy.mockRestore();
      log.mockRestore();
    }
  });

  it("scrubs a connection string out of the reason it logs, credentials and all", async () => {
    const app = await getTestApp();
    const logged: string[] = [];
    const log = vi.spyOn(console, "error").mockImplementation((...args: any[]) => { logged.push(args.join(" ")); });
    const spy = vi.spyOn(pool, "query")
      .mockRejectedValue(new Error("could not connect to postgresql://admin:hunter2@db.example.test/prod") as never);
    try {
      const res = await request(app).get("/_ready");
      expect(res.status).toBe(503);
      const line = logged.join("\n");
      expect(line).not.toContain("hunter2");
      expect(line).toContain("<connection-string>");
    } finally {
      spy.mockRestore();
      log.mockRestore();
    }
  });
});

describe("what a 500 tells the caller", () => {
  it("in production, says nothing about the query that failed", async () => {
    const app = await getTestApp();
    const was = process.env.NODE_ENV;
    const spy = vi.spyOn(pool, "query").mockRejectedValue(
      // What the live site actually sent to anonymous callers: the whole statement.
      new Error('Failed query: select "id", "title", "description" from "contests" where "status" = $1') as never,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      process.env.NODE_ENV = "production";
      const res = await request(app).get("/_ready");
      expect(res.status).toBe(503);

      // /_ready reports its own failure deliberately; the generic handler is the one under test.
      const failing = await request(app).get("/api/contests");
      expect(failing.status, "the mocked query failure should reach the error handler").toBeGreaterThanOrEqual(500);
      expect(JSON.stringify(failing.body)).not.toContain("select ");
      expect(JSON.stringify(failing.body)).not.toContain("contests");
      expect(failing.body.code).toBe("internal_error");
      // Eight characters somebody can quote, and the log line to find it by.
      expect(failing.body.reference).toMatch(/^[0-9a-f]{8}$/);
    } finally {
      process.env.NODE_ENV = was;
      spy.mockRestore();
      vi.restoreAllMocks();
    }
  });
});
