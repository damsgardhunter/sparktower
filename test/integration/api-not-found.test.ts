/**
 * An API path nothing answers says so: a JSON 404, never the web app's page
 * with a 200 — so a retired endpoint (check-ins, the feedback queue, games)
 * can't look like it still works.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";

afterAll(async () => { await closeTestApp(); });

describe("unknown API paths", () => {
  it("answer 404 in JSON, including the retired ones", async () => {
    const app = await getTestApp();
    for (const [method, path] of [
      ["get", "/api/definitely-not-a-route"],
      ["get", "/api/check-ins/queue/needs-feedback"],
      ["get", "/api/me/check-in-status"],
      ["post", "/api/loop-events"],
      ["get", "/api/games/leaderboard/typing"],
      ["get", "/api/admin/loop-metrics"],
    ] as const) {
      const res = await (request(app) as any)[method](path);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(res.headers["content-type"]).toMatch(/json/);
    }
    // A real route still answers.
    expect((await request(app).get("/api/contests")).status).toBe(200);
  });
});
