/**
 * What a person is owed, and whether it can reach them.
 *
 * The thing worth holding here is not the arithmetic — it is the separation.
 * Money collected and held pending somebody else's approval must never be
 * reported as money the person has. A backing sitting in escrow and a prize
 * they have won are both "money with your name near it" and only one of them
 * is theirs, and a page that adds them into one total is how somebody plans
 * around funds that may be refunded to the backer next week.
 *
 * Also held: that the page is reachable by somebody with no project at all,
 * which was the original gap. Payout setup used to live inside a project's
 * backing tab, so a challenge winner had no way to give us a bank account.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { projects, projectBackings, challengePrizes, companyChallenges, companies, users, novaLedger } from "@shared/schema";
import { creatorPayoutCents } from "@shared/backing";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any) {
  n += 1;
  const agent = request.agent(app);
  const ip = `203.0.118.${(n % 200) + 20}`;
  const email = `earner-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: "Ern" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await verifyEmail(app, email, ip);
  process.env.RATE_LIMIT_EXEMPT_EMAILS = [process.env.RATE_LIMIT_EXEMPT_EMAILS, email].filter(Boolean).join(",");
  return { agent, id: res.body.id as string };
}

async function projectFor(ownerId: string) {
  const id = randomUUID();
  await db.insert(projects).values({
    id, ownerId, title: "A thing worth backing", description: "x", category: "SaaS",
    createdAt: new Date(), updatedAt: new Date(),
  } as any);
  return id;
}

async function backing(
  projectId: string, backerId: string, amountCents: number, status: string,
  stripeTransferId: string | null = null,
) {
  await db.insert(projectBackings).values({
    id: randomUUID(), projectId, backerId, amountCents, status, stripeTransferId,
    releasedAt: status === "released" ? new Date() : null,
    createdAt: new Date(),
  } as any);
}

/** A company posts a challenge with a prize; `awardedTo` is who won it. */
async function prize(awardedTo: string | null, amountCents: number, state: string) {
  const companyId = randomUUID();
  await db.insert(companies).values({
    id: companyId, name: "Backer Ltd", slug: `backer-${companyId.slice(0, 8)}`, createdAt: new Date(),
  } as any);
  const challengeId = randomUUID();
  await db.insert(companyChallenges).values({
    id: challengeId, companyId, title: "Fix our onboarding", brief: "x",
    deadline: new Date(Date.now() + 7 * 864e5), createdAt: new Date(),
  } as any);
  await db.insert(challengePrizes).values({
    challengeId, companyId, amountCents, feeCents: 0, state, awardedTo,
    awardedAt: new Date(), createdAt: new Date(),
  } as any);
  return challengeId;
}

const read = async (agent: any) => {
  const res = await agent.get("/api/earnings");
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};

describe("earnings", () => {
  it("shows nothing, and no bank account, to somebody who has just arrived", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const got = await read(me.agent);
    expect(got.lines).toEqual([]);
    expect(got.toBalanceCents).toBe(0);
    expect(got.toBankCents).toBe(0);
    expect(got.heldCents).toBe(0);
    expect(got.bank.connected).toBe(false);
  });

  /* Nobody starts out able to receive a bank transfer, so nobody starts out pointed at one. */
  it("starts everybody pointed at their balance", async () => {
    const app = await getTestApp();
    const me = await person(app);
    expect((await read(me.agent)).payoutTarget).toBe("balance");
  });

  /*
   * The rule the backing payout tests caught me getting wrong.
   *
   * An absent choice is not a choice of the balance. Somebody who went through
   * Stripe's identity checks to connect an account wants to be paid into it,
   * and a column defaulting to "balance" would have redirected every one of
   * them in silence the moment this shipped.
   */
  it("points a connected account at the bank until told otherwise", async () => {
    const app = await getTestApp();
    const me = await person(app);
    await db.update(users)
      .set({ stripeConnectAccountId: "acct_prefers_bank", payoutTarget: null })
      .where(eq(users.id, me.id));
    expect((await read(me.agent)).payoutTarget).toBe("bank");
  });

  /* And an explicit choice still wins over having an account. */
  it("honours somebody who asked for their balance despite having an account", async () => {
    const app = await getTestApp();
    const me = await person(app);
    await db.update(users)
      .set({ stripeConnectAccountId: "acct_prefers_balance", payoutTarget: "balance" })
      .where(eq(users.id, me.id));
    expect((await read(me.agent)).payoutTarget).toBe("balance");
  });

  /*
   * The one that matters most. Held money is collected but not approved;
   * counting it as the person's would be a lie told in the largest type on
   * the page.
   */
  it("keeps held backings out of what is theirs", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const them = await person(app);
    const p = await projectFor(me.id);
    await backing(p, them.id, 5000, "held");

    const got = await read(me.agent);
    expect(got.heldCents).toBe(creatorPayoutCents(5000));
    expect(got.toBalanceCents).toBe(0);
    expect(got.toBankCents).toBe(0);
    expect(got.lines[0].state).toBe("held");
  });

  /*
   * The platform takes a cut on release, so the gross pledge is never what
   * the creator gets. Reporting it would promise money that cannot arrive.
   */
  it("reports what the creator actually receives, not the pledge", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const them = await person(app);
    const p = await projectFor(me.id);
    await backing(p, them.id, 10_000, "held");

    const got = await read(me.agent);
    expect(creatorPayoutCents(10_000)).toBeLessThan(10_000);
    expect(got.heldCents).toBe(creatorPayoutCents(10_000));
    expect(got.lines[0].amountCents).toBe(creatorPayoutCents(10_000));
  });

  /* A released pledge with a transfer id went to a bank; without one it landed here. */
  it("tells a bank transfer apart from a balance settlement", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const them = await person(app);
    const p = await projectFor(me.id);
    await backing(p, them.id, 2500, "released", "tr_test_123");
    await backing(p, them.id, 4000, "released", null);

    const got = await read(me.agent);
    expect(got.toBankCents).toBe(creatorPayoutCents(2500));
    expect(got.toBalanceCents).toBe(creatorPayoutCents(4000));
    expect(got.heldCents).toBe(0);
  });

  it("ignores backings that never became money", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const them = await person(app);
    const p = await projectFor(me.id);
    for (const status of ["pending", "refunded", "failed"]) {
      await backing(p, them.id, 9999, status);
    }
    const got = await read(me.agent);
    expect(got.lines).toEqual([]);
  });

  /*
   * A won prize is already in the balance — releasePrize credits the winner in
   * the same transaction that takes it out of escrow. Reporting it as money
   * still to come would have people waiting for what they had already been
   * paid.
   */
  it("shows a won prize as money already in the balance", async () => {
    const app = await getTestApp();
    const me = await person(app);
    await prize(me.id, 100_00, "awarded");

    const got = await read(me.agent);
    expect(got.toBalanceCents).toBe(100_00);
    expect(got.heldCents).toBe(0);
    expect(got.lines).toHaveLength(1);
    expect(got.lines[0].kind).toBe("prize");
    expect(got.lines[0].state).toBe("balance");
    expect(got.lines[0].what).toMatch(/Fix our onboarding/);
  });

  it("does not show a prize somebody else won", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const them = await person(app);
    await prize(them.id, 100_00, "awarded");
    expect((await read(me.agent)).lines).toEqual([]);
  });

  it("does not show a prize that has not been awarded", async () => {
    const app = await getTestApp();
    const me = await person(app);
    await prize(null, 100_00, "held");
    expect((await read(me.agent)).lines).toEqual([]);
  });

  it("keeps the three destinations apart when all three exist", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const them = await person(app);
    const p = await projectFor(me.id);
    await backing(p, them.id, 1000, "released", "tr_x");
    await backing(p, them.id, 300, "held");
    await prize(me.id, 700, "awarded");

    const got = await read(me.agent);
    expect(got.toBankCents).toBe(creatorPayoutCents(1000));
    expect(got.heldCents).toBe(creatorPayoutCents(300));
    expect(got.toBalanceCents).toBe(700);
    expect(got.lines).toHaveLength(3);
  });

  it("is not readable by a stranger", async () => {
    const app = await getTestApp();
    const res = await request(app).get("/api/earnings");
    expect(res.status).toBe(401);
  });
});

/*
 * Choosing a destination that cannot receive money is the dead end this
 * replaced, arrived at from the other direction — so it is refused rather
 * than accepted and discovered weeks later.
 */
describe("where earnings go", () => {
  it("refuses to point at a bank that isn't connected", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const res = await me.agent.patch("/api/earnings/target").send({ target: "bank" });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/connect/i);
    expect((await read(me.agent)).payoutTarget).toBe("balance");
  });

  it("refuses a destination that is neither", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const res = await me.agent.patch("/api/earnings/target").send({ target: "paypal" });
    expect(res.status).toBe(400);
  });

  it("lets somebody point back at their balance", async () => {
    const app = await getTestApp();
    const me = await person(app);
    await db.update(users).set({ payoutTarget: "bank" }).where(eq(users.id, me.id));
    const res = await me.agent.patch("/api/earnings/target").send({ target: "balance" });
    expect(res.status).toBe(200);
    expect(res.body.payoutTarget).toBe("balance");
  });
});

/*
 * The credit itself. A release that is retried — a timeout, a replayed
 * request, a reviewer pressing twice — must pay somebody once, and the unique
 * source key on the ledger is what makes that true rather than a hope.
 */
describe("earnings credited to a balance", () => {
  it("pays once, however many times it is asked", async () => {
    const app = await getTestApp();
    await app;
    const me = await person(app);
    const { creditEarnings } = await import("../../server/wallet");

    const first = await creditEarnings(me.id, 2500, `backing:${randomUUID()}-once`, "Backing on a thing");
    expect(first.credited).toBe(true);

    const key = `backing:${randomUUID()}`;
    const a = await creditEarnings(me.id, 4000, key, "Backing on a thing");
    const b = await creditEarnings(me.id, 4000, key, "Backing on a thing");
    expect(a.credited).toBe(true);
    expect(b.credited).toBe(false);
    expect(b.balanceCents).toBe(a.balanceCents);

    const [row] = await db.select({ balanceCents: users.balanceCents }).from(users).where(eq(users.id, me.id));
    expect(row.balanceCents).toBe(2500 + 4000);

    const lines = await db.select().from(novaLedger).where(eq(novaLedger.userId, me.id));
    expect(lines.filter((l) => l.sourceKey === key)).toHaveLength(1);
    expect(lines.every((l) => l.kind === "earnings")).toBe(true);
  });

  it("refuses to credit nothing", async () => {
    const app = await getTestApp();
    await app;
    const me = await person(app);
    const { creditEarnings } = await import("../../server/wallet");
    const res = await creditEarnings(me.id, 0, `backing:${randomUUID()}`, "nothing");
    expect(res.credited).toBe(false);
  });
});
