/**
 * The first integration test: the app boots and answers.
 *
 * Deliberately thin, because what it proves is the harness rather than any
 * feature. Getting here means route registration completed against a real
 * database, the middleware stack assembled in the right order, and supertest
 * can drive the app — which is everything the next test needs and none of it
 * is obvious until something has actually done it.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";

afterAll(async () => {
  await closeTestApp();
});

describe("server boots", () => {
  it("answers the health probe", async () => {
    const app = await getTestApp();
    await request(app).get("/_health").expect(200);
  });

  it("serves the API, and refuses an unauthenticated read", async () => {
    const app = await getTestApp();

    // 401 rather than 404 is the useful assertion: it proves the API routes
    // are mounted and the auth middleware ran, where a 404 would look
    // identical to the app never having registered anything at all.
    const res = await request(app).get("/api/auth/user");
    expect(res.status).toBe(401);
  });

  it("talks to the test database, not the development one", async () => {
    const { pool } = await import("../../server/db");
    const { rows } = await pool.query<{ db: string }>("SELECT current_database() AS db");

    expect(rows[0].db).toMatch(/_test$/);
  });
});
