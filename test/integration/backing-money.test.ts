/**
 * Money going out of backing: to the creator on release, back to the backer
 * when the window lapses. Neither path had a test.
 *
 * Two ways the platform could pay for one pledge twice, both closed here:
 *
 *   - Release relied on Stripe's idempotency key to avoid a second transfer,
 *     and that key only lasts 24 hours. A transfer that succeeded but wasn't
 *     recorded left the pledge "held" — reported to the reviewer as failed —
 *     and a retry the next day sent the money again.
 *   - Release and the refund sweep each read "held" and then acted, with
 *     nothing between them: a pledge could be refunded to its backer and paid
 *     to the creator.
 *
 * Stripe is a fake that remembers every transfer and refund, and can forget
 * idempotency keys the way Stripe does after a day.
 */
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";

type Transfer = { id: string; amount: number; destination: string; transfer_group: string; metadata: Record<string, string>; reversed: boolean };
const S = {
  transfers: [] as Transfer[],
  refunds: [] as { payment_intent: string }[],
  keys: new Map<string, Transfer>(),
  creates: 0,
};

vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: async () => ({
    transfers: {
      list: async ({ transfer_group }: { transfer_group: string }) => ({
        data: S.transfers.filter((t) => t.transfer_group === transfer_group),
        has_more: false,
      }),
      create: async (params: Omit<Transfer, "id" | "reversed">, opts?: { idempotencyKey?: string }) => {
        // Stripe's idempotency: the same key within a day returns the same transfer.
        if (opts?.idempotencyKey && S.keys.has(opts.idempotencyKey)) return S.keys.get(opts.idempotencyKey)!;
        S.creates += 1;
        const t = { ...params, id: `tr_${S.creates}`, reversed: false };
        S.transfers.push(t);
        if (opts?.idempotencyKey) S.keys.set(opts.idempotencyKey, t);
        return t;
      },
    },
    refunds: {
      create: async ({ payment_intent }: { payment_intent: string }) => {
        S.refunds.push({ payment_intent });
        return { id: `re_${S.refunds.length}` };
      },
    },
  }),
  getStripeSync: async () => ({}),
}));

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { passMfa } = await import("../helpers/mfa");
const { db } = await import("../../server/db");
const { users, projects, projectBackings, projectBackingCampaigns, projectMembers, notifications } = await import("@shared/schema");
const { devOutbox } = await import("../../server/email");
const { eq } = await import("drizzle-orm");
const { runRefundSweep } = await import("../../server/backing-jobs");

afterAll(async () => { await closeTestApp(); });
beforeEach(() => { S.transfers = []; S.refunds = []; S.keys.clear(); S.creates = 0; });

let n = 0;
async function account(role?: "reviewer") {
  const app = await getTestApp();
  n += 1;
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.180.${20 + n}`)
    .send({ email: `backing-${Date.now()}-${n}@example.test`, password: "Testpass123!", firstName: `B${n}` });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  if (role) await db.update(users).set({ platformRole: role }).where(eq(users.id, res.body.id));
  return { agent, id: res.body.id as string };
}

/** A project with a campaign in the given review state, and `count` held pledges on it. */
async function campaign(review: "approved" | "pending" | "rejected", count: number, refundDue?: Date) {
  const creator = await account();
  await db.update(users).set({ stripeConnectAccountId: "acct_creator" }).where(eq(users.id, creator.id));
  const [project] = await db.insert(projects).values({ title: "Backed thing", description: "Something people pay toward.", category: "saas", ownerId: creator.id } as any).returning();
  await db.insert(projectBackingCampaigns).values({ projectId: project.id, reviewStatus: review } as any);
  const backer = await account();
  const pledges = [];
  for (let i = 0; i < count; i++) {
    const [b] = await db.insert(projectBackings).values({
      projectId: project.id, backerId: backer.id, amountCents: 2500, status: "held",
      stripePaymentIntentId: `pi_${project.id.slice(0, 6)}_${i}`,
      refundDueAt: refundDue ?? null, unclaimedPreference: "refund",
    } as any).returning();
    pledges.push(b);
  }
  return { projectId: project.id, pledges };
}

const status = async (id: string) => (await db.select().from(projectBackings).where(eq(projectBackings.id, id)))[0];

describe("releasing held funds to a creator", () => {
  it("pays each held pledge once, and a second release pays nothing", async () => {
    const reviewer = await account("reviewer");
    await passMfa(reviewer.agent);
    const { projectId, pledges } = await campaign("approved", 2);

    const first = await reviewer.agent.post(`/api/admin/backing/${projectId}/release`).send({});
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.released).toBe(2);
    expect(S.creates).toBe(2);
    for (const p of pledges) expect((await status(p.id)).status).toBe("released");

    const again = await reviewer.agent.post(`/api/admin/backing/${projectId}/release`).send({});
    expect(again.body.released).toBe(0);
    expect(S.creates, "nothing sent the second time").toBe(2);
  });

  it("records a transfer that went out but wasn't recorded, instead of sending it again days later", async () => {
    const reviewer = await account("reviewer");
    await passMfa(reviewer.agent);
    const { projectId, pledges } = await campaign("approved", 1);
    const pledge = pledges[0];

    // Yesterday's release: the money reached the creator, and our write didn't land.
    S.transfers.push({ id: "tr_already_sent", amount: 2250, destination: "acct_creator", transfer_group: `backing_${projectId}`, metadata: { backingId: pledge.id, projectId }, reversed: false });
    // And a day on, Stripe no longer remembers the idempotency key.
    S.keys.clear();

    const res = await reviewer.agent.post(`/api/admin/backing/${projectId}/release`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(S.creates, "the creator is not paid a second time").toBe(0);
    const after = await status(pledge.id);
    expect(after.status).toBe("released");
    expect(after.stripeTransferId).toBe("tr_already_sent");
  });

  it("won't pay out a pledge under a chargeback", async () => {
    const reviewer = await account("reviewer");
    await passMfa(reviewer.agent);
    const { projectId, pledges } = await campaign("approved", 2);
    await db.update(projectBackings).set({ disputedAt: new Date() }).where(eq(projectBackings.id, pledges[0].id));

    const res = await reviewer.agent.post(`/api/admin/backing/${projectId}/release`).send({});
    expect(res.body.released).toBe(1);
    expect(S.transfers.map((t) => t.metadata.backingId)).toEqual([pledges[1].id]);
    expect((await status(pledges[0].id)).status).toBe("held");
  });

  it("won't pay out a pledge that was already refunded", async () => {
    const reviewer = await account("reviewer");
    await passMfa(reviewer.agent);
    const { projectId, pledges } = await campaign("approved", 1);
    await db.update(projectBackings).set({ status: "refunded" }).where(eq(projectBackings.id, pledges[0].id));

    const res = await reviewer.agent.post(`/api/admin/backing/${projectId}/release`).send({});
    expect(res.body.released).toBe(0);
    expect(S.creates).toBe(0);
  });
});

describe("the refund sweep", () => {
  it("refunds a lapsed pledge on an unapproved project exactly once, across passes", async () => {
    const { pledges } = await campaign("pending", 1, new Date(Date.now() - 60_000));
    await runRefundSweep();
    await runRefundSweep();
    expect(S.refunds.map((r) => r.payment_intent)).toEqual([pledges[0].stripePaymentIntentId]);
    expect((await status(pledges[0].id)).status).toBe("refunded");
  });

  it("leaves an approved project's pledges for the creator, even past the window", async () => {
    const { pledges } = await campaign("approved", 1, new Date(Date.now() - 60_000));
    await runRefundSweep();
    expect(S.refunds).toEqual([]);
    expect((await status(pledges[0].id)).status).toBe("held");
  });

  it("won't refund a pledge under a chargeback: the bank already has that money", async () => {
    const { pledges } = await campaign("pending", 1, new Date(Date.now() - 60_000));
    await db.update(projectBackings).set({ disputedAt: new Date() }).where(eq(projectBackings.id, pledges[0].id));
    await runRefundSweep();
    expect(S.refunds).toEqual([]);
    expect((await status(pledges[0].id)).status).toBe("held");
  });

  it("isn't starved by an approved project's backlog, and gets through more than one batch", async () => {
    /*
     * It read fifty held pledges in no order and dropped approved projects'
     * afterwards. Fifty or more approved ones filled every read, and nobody
     * else was ever refunded. Older than anything else here, so they come
     * first in the order this used to (not) have.
     */
    const longAgo = new Date(Date.now() - 400 * 86_400_000);
    const approved = await campaign("approved", 60, longAgo);
    const lapsed = await campaign("pending", 55, new Date(Date.now() - 60_000));

    await runRefundSweep();
    for (const p of lapsed.pledges) expect((await status(p.id)).status, "every lapsed pledge, past the first batch too").toBe("refunded");
    for (const p of approved.pledges.slice(0, 3)) expect((await status(p.id)).status).toBe("held");
    expect(S.refunds.filter((r) => approved.pledges.some((p) => p.stripePaymentIntentId === r.payment_intent))).toEqual([]);
  }, 60_000);

  it("won't refund a pledge that has been paid out", async () => {
    const { pledges } = await campaign("pending", 1, new Date(Date.now() - 60_000));
    await db.update(projectBackings).set({ status: "released" }).where(eq(projectBackings.id, pledges[0].id));
    await runRefundSweep();
    expect(S.refunds).toEqual([]);
  });
});

describe("a campaign a reviewer rejected", () => {
  /*
   * Rejecting only changed the review status; the campaign stayed switched
   * on. So a project reviewers had turned down went on charging new backers,
   * and everyone who had already pledged waited the full ninety-day window.
   */
  it("stops taking money, and stops offering to", async () => {
    const { projectId } = await campaign("rejected", 0);
    await db.update(projectBackingCampaigns).set({ enabled: true }).where(eq(projectBackingCampaigns.projectId, projectId));
    const backer = await account();

    const checkout = await backer.agent.post(`/api/projects/${projectId}/backing/checkout`).send({ amountCents: 2500 });
    expect(checkout.status).toBe(404);
    expect((await backer.agent.get(`/api/projects/${projectId}/backing/public`)).status, "no 'back this' button either").toBe(404);
  });

  it("refunds the backers now, not in ninety days", async () => {
    const reviewer = await account("reviewer");
    await passMfa(reviewer.agent);
    // Pledged while the project was pending; the refund window is months away.
    const { projectId, pledges } = await campaign("pending", 2, new Date(Date.now() + 90 * 86_400_000));

    const res = await reviewer.agent.post(`/api/admin/backing/${projectId}/decision`).send({ decision: "rejected", notes: "Not a real product." });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.refundsQueued).toBe(2);

    await expect.poll(() => S.refunds.length, { timeout: 10_000 }).toBe(2);
    for (const p of pledges) expect((await status(p.id)).status).toBe("refunded");
  });
});

describe("telling people what happened to their money", () => {
  /*
   * Backing ran end to end in silence: a backer heard nothing when a project
   * was rejected and nothing when the refund went through, and a creator
   * heard nothing about a pledge or a decision. A refund appearing in a bank
   * statement weeks later, unexplained, is how a person decides a product
   * took their money.
   */
  const notices = async (userId: string) => {
    const rows = await db.select().from(notifications).where(eq(notifications.recipientId, userId));
    return rows.map((r) => r.kind);
  };
  const posted = (to: string | null, tag: string) => devOutbox().some((m) => m.tag === tag && (!to || m.to === to));

  it("tells the backers and the creator when a campaign is turned down and the money goes back", async () => {
    const reviewer = await account("reviewer");
    await passMfa(reviewer.agent);
    const { projectId, pledges } = await campaign("pending", 1, new Date(Date.now() + 90 * 86_400_000));
    const [pledge] = pledges;
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));

    const res = await reviewer.agent.post(`/api/admin/backing/${projectId}/decision`).send({ decision: "rejected", notes: "Not a real product." });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    await expect.poll(() => notices(pledge.backerId), { timeout: 10_000 }).toContain("pledge_refunding");
    expect(await notices(project.ownerId), "the creator hears the decision").toContain("campaign_decision");
    expect(posted(null, "pledge_refunding"), "and by email, for whoever isn't coming back today").toBe(true);

    // And again when the refund actually lands, so the statement entry has a name.
    await expect.poll(() => notices(pledge.backerId), { timeout: 10_000 }).toContain("pledge_refunded");
  });

  it("tells each backer when their money goes to the project, and the creator when a pledge arrives", async () => {
    const reviewer = await account("reviewer");
    await passMfa(reviewer.agent);
    const { projectId, pledges } = await campaign("approved", 1);
    const [pledge] = pledges;

    const res = await reviewer.agent.post(`/api/admin/backing/${projectId}/release`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await expect.poll(() => notices(pledge.backerId), { timeout: 10_000 }).toContain("pledge_released");
    expect(posted(null, "pledge_released")).toBe(true);
  });
});

describe("a reviewer with a stake in the project", () => {
  /*
   * The reviewer role was all approval and release asked for, so a reviewer
   * could approve their own project and pay its pledges to themselves.
   */
  it("can't approve or release their own project, or one they're on", async () => {
    const reviewer = await account("reviewer");
    await passMfa(reviewer.agent);
    const own = await campaign("pending", 1);
    await db.update(projects).set({ ownerId: reviewer.id }).where(eq(projects.id, own.projectId));
    await db.update(users).set({ stripeConnectAccountId: "acct_reviewer" }).where(eq(users.id, reviewer.id));

    const decide = await reviewer.agent.post(`/api/admin/backing/${own.projectId}/decision`).send({ decision: "approved" });
    expect(decide.status).toBe(403);
    expect(decide.body.code).toBe("reviewer_conflict");
    const [still] = await db.select().from(projectBackingCampaigns).where(eq(projectBackingCampaigns.projectId, own.projectId));
    expect(still.reviewStatus).toBe("pending");

    // Approved by someone else — releasing is still not theirs to do.
    await db.update(projectBackingCampaigns).set({ reviewStatus: "approved" }).where(eq(projectBackingCampaigns.projectId, own.projectId));
    const release = await reviewer.agent.post(`/api/admin/backing/${own.projectId}/release`).send({});
    expect(release.status).toBe(403);
    expect(S.creates).toBe(0);

    // A teammate's project: the same.
    const team = await campaign("approved", 1);
    await db.insert(projectMembers).values({ projectId: team.projectId, userId: reviewer.id, role: "member" } as any);
    expect((await reviewer.agent.post(`/api/admin/backing/${team.projectId}/release`).send({})).status).toBe(403);
    expect((await reviewer.agent.post(`/api/admin/backing/${team.projectId}/decision`).send({ decision: "rejected" })).status).toBe(403);
    expect(S.creates).toBe(0);
    expect((await status(team.pledges[0].id)).status).toBe("held");

    // Another reviewer can.
    const other = await account("reviewer");
    await passMfa(other.agent);
    expect((await other.agent.post(`/api/admin/backing/${team.projectId}/release`).send({})).body.released).toBe(1);
  });
});

describe("a creator who can't be paid", () => {
  it("takes no pledges while suspended", async () => {
    const { projectId } = await campaign("approved", 0);
    await db.update(projectBackingCampaigns).set({ enabled: true }).where(eq(projectBackingCampaigns.projectId, projectId));
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    await db.update(users).set({ suspendedAt: new Date(), suspendedReason: "fraud" }).where(eq(users.id, project.ownerId));

    const backer = await account();
    expect((await backer.agent.post(`/api/projects/${projectId}/backing/checkout`).send({ amountCents: 2500 })).status).toBe(404);
  });
});
