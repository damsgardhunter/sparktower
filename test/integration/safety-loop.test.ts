/**
 * The admin safety loop, end to end on the server:
 *
 *   a limit refuses someone (and that's kept) → the daily review loads
 *   reports, refusals and loop numbers together and raises alerts → an action
 *   is taken → its impact is measured either side of it → the review is
 *   recorded, and the next one starts from there.
 *
 * Time is laid down in the database (`now() - interval …`), the same clock the
 * windows are computed on, so the before/after arithmetic is exact.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { activityEvents, contentReports, moderationLog, rateLimitHits, users } from "@shared/schema";
import { RATE_LIMITS } from "@shared/moderation";
import { SAFETY_CHECKLIST_IDS, SAFETY_EVENTS } from "@shared/safety";
import { flushRefusalCounts } from "../../server/moderation";
import { passMfa } from "../helpers/mfa";

afterAll(async () => { await closeTestApp(); });

let address = 120;
async function person(app: any, name: string, email?: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.100.${address++}`)
    .send({ email: email ?? `sl-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`, password: "Testpass123!", firstName: name });
  expect(res.status).toBe(201);
  await verifyEmail(app, res.body.email, `198.51.104.${address}`);
  return { agent, id: res.body.id as string };
}

async function reviewer(app: any) {
  const who = await person(app, "Rev");
  await db.update(users).set({ platformRole: "reviewer" }).where(eq(users.id, who.id));
  // Review tools need a second factor on the session (server/mfa.ts).
  await passMfa(who.agent);
  return who;
}

const ago = (hours: number) => sql.raw(`now() - interval '${hours * 60} minutes'`);

async function waitFor<T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  for (let i = 0; i < 60; i++) {
    const v = await read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  return read();
}

describe("a refused request", () => {
  it("is kept for the review, bucketed per minute with an exact count", async () => {
    const app = await getTestApp();
    const spammer = await person(app, "Spam");
    const { max } = RATE_LIMITS.connect;
    await db.insert(rateLimitHits).values(Array.from({ length: max }, () => ({ userId: spammer.id, action: "connect", createdAt: sql`now()` })) as any);

    for (let i = 0; i < 3; i++) {
      expect((await spammer.agent.post("/api/connections/request").send({ userId: "anyone" })).status).toBe(429);
    }
    flushRefusalCounts();

    const rows = await waitFor(
      () => db.select().from(activityEvents).where(eq(activityEvents.userId, spammer.id)),
      (r) => r.filter((x) => x.name === SAFETY_EVENTS.limitRefused).reduce((n, x) => n + Number((x.props as any).count ?? 1), 0) >= 3,
    );
    const refusals = rows.filter((r) => r.name === SAFETY_EVENTS.limitRefused);
    // One row at once, and the rest of the minute added up in a second (a third if the minute turned mid-test).
    expect(refusals.length).toBeGreaterThanOrEqual(2);
    expect(refusals.length).toBeLessThanOrEqual(3);
    expect(refusals.reduce((n, r) => n + Number((r.props as any).count), 0)).toBe(3);
    expect(refusals[0].props).toMatchObject({ action: "connect", kind: "volume" });
  });
});

describe("the daily review", () => {
  it("is reviewer-only", async () => {
    const app = await getTestApp();
    const plain = await person(app, "Plain");
    for (const url of ["/api/admin/safety/review", "/api/admin/safety/status"]) {
      expect([403, 404]).toContain((await plain.agent.get(url)).status);
    }
    expect([403, 404]).toContain((await plain.agent.post("/api/admin/safety/review").send({ checked: SAFETY_CHECKLIST_IDS })).status);
  });

  it("loads reports, refusals and actions together, measures an action's impact, and records the pass", async () => {
    const app = await getTestApp();
    const rev = await reviewer(app);
    const [troll, reporter, reporter2] = [await person(app, "Troll"), await person(app, "Rep"), await person(app, "Rep2")];

    // Reports against the troll: two in the day before the action, one after. One is still open from 30h ago.
    await db.insert(contentReports).values([
      { reporterId: reporter.id, targetType: "feed_post", targetId: "p-old", targetOwnerId: troll.id, reason: "spam", status: "open", createdAt: ago(30) },
      { reporterId: reporter2.id, targetType: "feed_post", targetId: "p-1", targetOwnerId: troll.id, reason: "spam", status: "actioned", createdAt: ago(10) },
      { reporterId: reporter.id, targetType: "feed_post", targetId: "p-2", targetOwnerId: troll.id, reason: "harassment", status: "actioned", createdAt: ago(2) },
    ] as any);

    // The troll posted eight times the day before, and not at all since.
    const post = (hours: number) => ({
      name: "api.write", userId: troll.id, visitorId: "v-troll", sessionId: "s-troll", path: "/api/feed", pattern: "/api/feed",
      method: "POST", status: 200, createdAt: ago(hours),
    });
    await db.insert(activityEvents).values([...Array(8)].map((_, i) => post(7 + i)) as any);

    // The message limit spiked: 7 refusals now, 1 in the window before.
    const refusal = (hours: number, count: number) => ({
      name: SAFETY_EVENTS.limitRefused, userId: troll.id, visitorId: "v-troll", sessionId: "s-troll",
      path: "/api/messages/x", pattern: "/api/messages/x", method: "POST", status: 429, props: { action: "message", kind: "volume", count }, createdAt: ago(hours),
    });
    await db.insert(activityEvents).values([refusal(8, 4), refusal(7, 3), refusal(30, 1)] as any);

    // The action: a ban, six hours ago — appended to the log directly, as the queue would.
    const [entry] = await db.insert(moderationLog).values({
      action: "suspend", actorId: rev.id, targetUserId: troll.id, targetType: "user", targetId: troll.id,
      reasonCode: "spam", createdAt: ago(6),
    } as any).returning();

    const impact = await rev.agent.get(`/api/admin/safety/impact/${entry.id}`);
    expect(impact.status).toBe(200);
    expect(impact.body.status).toBe("watching");
    const m = Object.fromEntries(impact.body.metrics.map((x: any) => [x.key, x]));
    // Before [30h..6h): the 10h report; the 30h one is outside the window. After [6h..now): the 2h report, a pace of 4/day.
    expect(m.reports_against_user).toMatchObject({ before: 1, after: 1, afterPace: 4, direction: "up" });
    // Eight posts before, none after.
    expect(m.user_content).toMatchObject({ before: 8, after: 0, afterPace: 0, direction: "down", changePercent: -100 });
    // Seven refusals before the action (8h and 7h ago); none after.
    expect(m.user_refusals).toMatchObject({ before: 7, after: 0 });
    expect(impact.body.headline).toBe("Posts, comments and messages by this account: 8 → 0 per 24h");
    expect(Object.keys(m)).toEqual(expect.arrayContaining(["site_reports", "site_refusals", "site_content"]));

    const review = await rev.agent.get("/api/admin/safety/review");
    expect(review.status).toBe(200);
    expect(review.body.windowHours).toBe(24);
    expect(review.body.reports).toMatchObject({ open: 1, newInWindow: 2, newBefore: 1 });
    expect(review.body.reports.oldestOpenHours).toBeGreaterThanOrEqual(29);
    expect(review.body.limits.find((l: any) => l.action === "message")).toMatchObject({ refused: 7, refusedBefore: 1, spike: true });
    expect(review.body.content).toMatchObject({ inWindow: 8, before: 0 });
    expect(review.body.actions.map((a: any) => a.logId)).toContain(entry.id);
    const alertIds = review.body.alerts.map((a: any) => a.id);
    expect(alertIds[0]).toBe("stale-reports");
    expect(alertIds).toEqual(expect.arrayContaining(["limit-spike-message", "review-due"]));
    expect((await rev.agent.get("/api/admin/safety/status")).body).toMatchObject({ reviewDue: true });

    // A review isn't done until every item is confirmed.
    const partial = await rev.agent.post("/api/admin/safety/review").send({ checked: ["reports"] });
    expect(partial.status).toBe(400);
    expect(partial.body.missing).toEqual(SAFETY_CHECKLIST_IDS.filter((id) => id !== "reports"));

    const done = await rev.agent.post("/api/admin/safety/review").send({ checked: SAFETY_CHECKLIST_IDS, note: "Banned the spammer; message limit fine." });
    expect(done.status).toBe(200);
    const [logged] = await db.select().from(moderationLog).where(eq(moderationLog.action, "safety_review_completed"));
    expect(logged.details).toMatchObject({ note: "Banned the spammer; message limit fine.", saw: { openReports: 1, spikes: ["message"] } });
    expect((logged.details as any).saw.actionsReviewed).toContain(entry.id);

    // The next pass starts from this one.
    const next = (await rev.agent.get("/api/admin/safety/review")).body;
    expect(next.reviewDue).toBe(false);
    expect(next.lastReview).toMatchObject({ note: "Banned the spammer; message limit fine." });
    expect(next.alerts.map((a: any) => a.id)).not.toContain("review-due");
    // The review itself isn't an action to measure.
    expect(next.actions.map((a: any) => a.action)).not.toContain("safety_review_completed");
    expect((await rev.agent.get("/api/admin/safety/status")).body).toMatchObject({ reviewDue: false });
  });

  it("measures a surface switch by that surface's writes", async () => {
    const app = await getTestApp();
    const rev = await reviewer(app);
    const write = (hours: number) => ({
      name: "api.write", visitorId: "v-s", sessionId: "s-s", path: "/api/feed", pattern: "/api/feed", method: "POST", status: 200, createdAt: ago(hours),
    });
    await db.insert(activityEvents).values([write(5), write(4), write(3)] as any);
    const [entry] = await db.insert(moderationLog).values({
      action: "surface_toggled", actorId: rev.id, targetType: "surface", targetId: "feed", details: { enabled: false }, createdAt: ago(2),
    } as any).returning();

    const impact = (await rev.agent.get(`/api/admin/safety/impact/${entry.id}`)).body;
    const writes = impact.metrics.find((x: any) => x.key === "surface_writes");
    expect(writes).toMatchObject({ label: "Writes on Feed", before: 3, after: 0, goodWhen: "down" });
    expect((await rev.agent.get("/api/admin/safety/impact/not-a-log-entry")).status).toBe(404);
  });
});
