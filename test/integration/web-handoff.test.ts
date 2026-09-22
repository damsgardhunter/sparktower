/**
 * From the app into the website, signed in: server/web-handoff.ts.
 *
 * The claims: a link signs its browser in and lands on the page it named;
 * it works once and for a minute; it will only ever land on this site; and a
 * closed account's link signs nobody in.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { users, webHandoffTokens } from "@shared/schema";
import { safeNext } from "../../server/web-handoff";

afterAll(closeTestApp);

let n = 0;
async function person(app: any) {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.190.${(n % 200) + 20}`;
  const email = `handoff-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `H${n}` });
  expect(res.status, res.text).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

describe("a link from the app into the website", () => {
  it("signs a fresh browser in, once, on the page it named", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const made = await me.agent.post("/api/auth/mobile/web-handoff").send({ next: "/companies/abc?tab=talent" });
    expect(made.status, made.text).toBe(200);
    expect(made.body.path).toMatch(/^\/api\/auth\/web-handoff\?token=/);

    const browser = request.agent(app);
    const opened = await browser.get(made.body.path);
    expect(opened.status).toBe(302);
    expect(opened.headers.location).toBe("/companies/abc?tab=talent");
    const who = await browser.get("/api/auth/user");
    expect(who.status).toBe(200);
    expect(who.body.id).toBe(me.id);

    // Twice is once: a link seen in a history or a log signs nobody else in.
    const stranger = request.agent(app);
    const again = await stranger.get(made.body.path);
    expect(again.headers.location).toBe("/?handoff=expired");
    expect((await stranger.get("/api/auth/user")).status).toBe(401);
  }, 60_000);

  it("stops working after a minute", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const made = await me.agent.post("/api/auth/mobile/web-handoff").send({ next: "/talent" });
    await db.update(webHandoffTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(webHandoffTokens.userId, me.id));
    const browser = request.agent(app);
    expect((await browser.get(made.body.path)).headers.location).toBe("/?handoff=expired");
    expect((await browser.get("/api/auth/user")).status).toBe(401);
  }, 60_000);

  it("only ever lands on this site", async () => {
    const app = await getTestApp();
    const me = await person(app);
    for (const next of ["//evil.example/x", "https://evil.example", "/\\evil.example", "javascript:alert(1)", "/javascript:alert(1)", "talent", ""]) {
      const res = await me.agent.post("/api/auth/mobile/web-handoff").send({ next });
      expect(res.status, next).toBe(400);
    }
    expect(safeNext("/challenges/x")).toBe("/challenges/x");
  }, 60_000);

  it("needs you signed in to make one, and a closed account's link signs nobody in", async () => {
    const app = await getTestApp();
    expect((await request(app).post("/api/auth/mobile/web-handoff").send({ next: "/" })).status).toBe(401);

    const me = await person(app);
    const made = await me.agent.post("/api/auth/mobile/web-handoff").send({ next: "/talent" });
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, me.id));
    const browser = request.agent(app);
    await browser.get(made.body.path);
    expect((await browser.get("/api/auth/user")).status).toBe(401);
  }, 60_000);
});
