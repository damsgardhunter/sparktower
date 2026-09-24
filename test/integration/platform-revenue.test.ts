/**
 * The platform's own cash position.
 *
 * The property worth holding is the identity the page is built on:
 *
 *     ours = collected − sent out − owed
 *
 * If that stops being true, the top line on the owner's page is wrong in a way
 * nothing else would catch — it would simply read a plausible number. So these
 * check the identity directly, and check the two ways it is easiest to break:
 * counting credit moving around as though it were a fresh card charge, and
 * forgetting that held pledges are still the backer's money.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { users, projects, projectBackings, novaLedger } from "@shared/schema";
import { creatorPayoutCents } from "@shared/backing";
import { platformRevenue } from "../../server/platform-revenue";

afterAll(async () => { await closeTestApp(); });

/*
 * These figures are sums over the whole database, so anything another test
 * left behind would drift them. Cleared first, and only the money tables.
 */
beforeEach(async () => {
  await db.delete(projectBackings);
  await db.delete(novaLedger);
  await db.update(users).set({ balanceCents: 0 });
});

let n = 0;
async function person(app: any) {
  n += 1;
  const agent = request.agent(app);
  const ip = `203.0.119.${(n % 200) + 20}`;
  const email = `rev-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: "Rev" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await verifyEmail(app, email, ip);
  process.env.RATE_LIMIT_EXEMPT_EMAILS = [process.env.RATE_LIMIT_EXEMPT_EMAILS, email].filter(Boolean).join(",");
  return { agent, id: res.body.id as string };
}

async function projectFor(ownerId: string) {
  const id = randomUUID();
  await db.insert(projects).values({
    id, ownerId, title: "Revenue fixture", description: "x", category: "SaaS", createdAt: new Date(),
  } as any);
  return id;
}

const backing = (projectId: string, backerId: string, amountCents: number, status: string, transfer: string | null = null) =>
  db.insert(projectBackings).values({
    id: randomUUID(), projectId, backerId, amountCents, status,
    stripeTransferId: transfer, releasedAt: status === "released" ? new Date() : null,
    createdAt: new Date(),
  } as any);

const topUp = (userId: string, cents: number) =>
  db.insert(novaLedger).values({
    userId, kind: "topup", amountCents: cents, balanceAfter: cents,
    stripeSessionId: `cs_${randomUUID()}`, note: "Added to your balance",
  } as any);

const holds = (r: Awaited<ReturnType<typeof platformRevenue>>) =>
  r.oursCents === r.collected.totalCents - r.sentOutCents - r.owed.totalCents;

describe("the platform's cash position", () => {
  it("is all zero on an empty database", async () => {
    await getTestApp();
    const r = await platformRevenue();
    expect(r.collected.totalCents).toBe(0);
    expect(r.owed.totalCents).toBe(0);
    expect(r.oursCents).toBe(0);
    expect(holds(r)).toBe(true);
  });

  /* A top-up nobody has spent is entirely a liability: we hold their money. */
  it("treats an unspent top-up as owed, not earned", async () => {
    const app = await getTestApp();
    const me = await person(app);
    await topUp(me.id, 5000);
    await db.update(users).set({ balanceCents: 5000 }).where(eq(users.id, me.id));

    const r = await platformRevenue();
    expect(r.collected.topUpsCents).toBe(5000);
    expect(r.owed.balancesCents).toBe(5000);
    expect(r.oursCents).toBe(0);
    expect(holds(r)).toBe(true);
  });

  /* Spent on Nova, the same money becomes ours — the balance is gone. */
  it("counts a top-up as ours once it has been spent", async () => {
    const app = await getTestApp();
    const me = await person(app);
    await topUp(me.id, 5000);
    await db.update(users).set({ balanceCents: 0 }).where(eq(users.id, me.id));

    const r = await platformRevenue();
    expect(r.collected.topUpsCents).toBe(5000);
    expect(r.owed.balancesCents).toBe(0);
    expect(r.oursCents).toBe(5000);
    expect(holds(r)).toBe(true);
  });

  /* A pledge in escrow is the backer's until somebody approves it. */
  it("treats a held pledge as owed in full", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const them = await person(app);
    await backing(await projectFor(me.id), them.id, 10_000, "held");

    const r = await platformRevenue();
    expect(r.collected.pledgesCents).toBe(10_000);
    expect(r.owed.escrowCents).toBe(10_000);
    expect(r.oursCents).toBe(0);
    expect(holds(r)).toBe(true);
  });

  /* Released to a bank: the creator's share leaves, our fee stays. */
  it("keeps only the fee once a pledge goes out to a bank", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const them = await person(app);
    await backing(await projectFor(me.id), them.id, 10_000, "released", "tr_test");

    const r = await platformRevenue();
    expect(r.sentOutCents).toBe(creatorPayoutCents(10_000));
    expect(r.owed.totalCents).toBe(0);
    expect(r.oursCents).toBe(10_000 - creatorPayoutCents(10_000));
    expect(holds(r)).toBe(true);
  });

  /*
   * Released into the creator's balance instead: nothing left the building, so
   * the creator's share is a balance we owe rather than cash we sent.
   */
  it("moves escrow into a balance when a pledge settles here", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const them = await person(app);
    await backing(await projectFor(me.id), them.id, 10_000, "released", null);
    await db.update(users).set({ balanceCents: creatorPayoutCents(10_000) }).where(eq(users.id, me.id));

    const r = await platformRevenue();
    expect(r.sentOutCents).toBe(0);
    expect(r.owed.balancesCents).toBe(creatorPayoutCents(10_000));
    expect(r.oursCents).toBe(10_000 - creatorPayoutCents(10_000));
    expect(holds(r)).toBe(true);
  });

  /*
   * The easiest way to overstate revenue: counting credit that only moved
   * between accounts. A prize is funded from a balance, so the platform took
   * no new money and the total collected must not budge.
   */
  it("does not count credit moving between people as new money", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const them = await person(app);
    await topUp(me.id, 20_000);

    const before = await platformRevenue();
    // The poster's balance goes down, the winner's goes up. No card involved.
    await db.update(users).set({ balanceCents: 5_000 }).where(eq(users.id, me.id));
    await db.update(users).set({ balanceCents: 15_000 }).where(eq(users.id, them.id));
    await db.insert(novaLedger).values({
      userId: them.id, kind: "refund", outcome: "challenge",
      amountCents: 15_000, balanceAfter: 15_000, note: "Challenge prize",
    } as any);

    const after = await platformRevenue();
    expect(after.collected.totalCents).toBe(before.collected.totalCents);
    expect(after.owed.balancesCents).toBe(20_000);
    expect(after.oursCents).toBe(0);
    expect(holds(after)).toBe(true);
  });

  /* Pledges that never cleared are not money we hold. */
  it("ignores pledges that never cleared", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const them = await person(app);
    const p = await projectFor(me.id);
    for (const status of ["pending", "failed", "refunded"]) {
      await backing(p, them.id, 9_999, status);
    }
    const r = await platformRevenue();
    expect(r.collected.pledgesCents).toBe(0);
    expect(holds(r)).toBe(true);
  });
});

describe("the revenue endpoint", () => {
  it("is not readable by a stranger", async () => {
    const app = await getTestApp();
    const res = await request(app).get("/api/admin/revenue");
    expect(res.status).toBe(401);
  });

  /* 404, not 403: an ordinary user shouldn't learn the page exists. */
  it("says 404 to an ordinary signed-in user", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const res = await me.agent.get("/api/admin/revenue");
    expect(res.status).toBe(404);
  });
});
