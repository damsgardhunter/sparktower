/**
 * What the site stops keeping.
 *
 * Spent credentials and finished ledger rows are records about a person that
 * no code will read again: a used sign-up link, a revoked device token, a
 * payment event Stripe will never redeliver, an invite that was accepted a
 * month ago. Each is cleared on its own clock. What must survive is here too —
 * live tokens, failed payment events, pending invites — because a sweep that
 * takes one row too many is worse than one that runs late.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { emailVerificationTokens, mobileRefreshTokens, projectInvites, projects, stripeEvents, users } from "@shared/schema";
import { sweepFinishedRecords } from "../../server/retention";
import request from "supertest";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any) {
  n += 1;
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.107.${10 + n}`)
    .send({ email: `retention-${Date.now()}-${n}@example.test`, password: "Testpass123!", firstName: "Keeper" });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string };
}
const ago = (days: number) => sql`now() - make_interval(days => ${days})`;

describe("clearing out what has stopped meaning anything", () => {
  it("takes spent credentials, finished invites and settled payment events — and nothing still in use", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const project = (await owner.agent.post("/api/projects").send({ title: "Kept", description: "A project whose finished invites are cleared but whose pending ones stay.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;

    // Sign-up links: one spent long ago, one still live.
    const [spentLink] = await db.insert(emailVerificationTokens).values({ userId: owner.id, tokenHash: `spent-${Date.now()}`, email: "a@example.test", expiresAt: new Date(Date.now() + 86_400_000), usedAt: new Date() }).returning();
    const [liveLink] = await db.insert(emailVerificationTokens).values({ userId: owner.id, tokenHash: `live-${Date.now()}`, email: "b@example.test", expiresAt: new Date(Date.now() + 86_400_000) }).returning();
    await db.update(emailVerificationTokens).set({ usedAt: ago(30) as any }).where(eq(emailVerificationTokens.id, spentLink.id));

    // Device tokens: one revoked a month ago, one live.
    const [deadToken] = await db.insert(mobileRefreshTokens).values({ userId: owner.id, tokenHash: `dead-${Date.now()}`, expiresAt: new Date(Date.now() + 86_400_000) }).returning();
    const [liveToken] = await db.insert(mobileRefreshTokens).values({ userId: owner.id, tokenHash: `alive-${Date.now()}`, expiresAt: new Date(Date.now() + 86_400_000) }).returning();
    await db.update(mobileRefreshTokens).set({ revokedAt: ago(60) as any }).where(eq(mobileRefreshTokens.id, deadToken.id));

    // Payment events: an old processed one goes; an old failed one is evidence and stays; a recent one stays.
    const old = `evt_old_${Date.now()}`, failed = `evt_failed_${Date.now()}`, recent = `evt_recent_${Date.now()}`;
    await db.insert(stripeEvents).values([
      { id: old, type: "checkout.session.completed", status: "processed", processedAt: new Date() },
      { id: failed, type: "invoice.paid", status: "failed", error: "handler blew up" },
      { id: recent, type: "checkout.session.completed", status: "processed", processedAt: new Date() },
    ]);
    await db.update(stripeEvents).set({ processedAt: ago(200) as any, receivedAt: ago(200) as any }).where(eq(stripeEvents.id, old));
    await db.update(stripeEvents).set({ receivedAt: ago(200) as any }).where(eq(stripeEvents.id, failed));

    // Invites: one accepted long ago, one still pending.
    const [oldInvite] = await db.insert(projectInvites).values({ projectId: project.id, role: "Engineer", tokenHash: `inv-old-${Date.now()}`, expiresAt: new Date(Date.now() + 86_400_000), createdById: owner.id, acceptedAt: new Date() }).returning();
    const [pendingInvite] = await db.insert(projectInvites).values({ projectId: project.id, role: "Designer", tokenHash: `inv-live-${Date.now()}`, expiresAt: new Date(Date.now() + 86_400_000), createdById: owner.id }).returning();
    await db.update(projectInvites).set({ createdAt: ago(90) as any }).where(eq(projectInvites.id, oldInvite.id));

    const swept = await sweepFinishedRecords();
    expect(swept.verificationTokens).toBeGreaterThanOrEqual(1);
    expect(swept.refreshTokens).toBeGreaterThanOrEqual(1);
    expect(swept.stripeEvents).toBeGreaterThanOrEqual(1);
    expect(swept.invites).toBeGreaterThanOrEqual(1);

    const gone = async (table: any, id: string) => (await db.select().from(table).where(eq(table.id, id))).length === 0;
    expect(await gone(emailVerificationTokens, spentLink.id)).toBe(true);
    expect(await gone(mobileRefreshTokens, deadToken.id)).toBe(true);
    expect(await gone(stripeEvents, old)).toBe(true);
    expect(await gone(projectInvites, oldInvite.id)).toBe(true);

    // Still in use, still here.
    expect(await gone(emailVerificationTokens, liveLink.id)).toBe(false);
    expect(await gone(mobileRefreshTokens, liveToken.id)).toBe(false);
    expect(await gone(stripeEvents, failed)).toBe(false);
    expect(await gone(stripeEvents, recent)).toBe(false);
    expect(await gone(projectInvites, pendingInvite.id)).toBe(false);

    // The people and projects they belonged to are untouched: this clears records, not accounts.
    expect((await db.select().from(users).where(eq(users.id, owner.id)))).toHaveLength(1);
    expect((await db.select().from(projects).where(eq(projects.id, project.id)))).toHaveLength(1);
  });

  it("is safe to run on an empty database and safe to run twice", async () => {
    await getTestApp();
    const first = await sweepFinishedRecords();
    const second = await sweepFinishedRecords();
    expect(Object.values(second).every((n) => n === 0)).toBe(true);
    expect(Object.keys(first).sort()).toEqual(["invites", "refreshTokens", "stripeEvents", "verificationTokens"]);
  });
});
