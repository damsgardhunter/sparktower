/**
 * Getting into the reviewer's queue, which is what payouts wait on.
 *
 * `POST /api/projects/:id/backing/submit-review` had no test. It is the door
 * between a campaign and somebody's money: a reviewer approves what is in this
 * queue, and approval is what lets pledges be released. Three of its four
 * refusals are the interesting part, and each one fails in a direction that
 * costs somebody real money if it stops holding:
 *
 *   - **no Stripe account, no queue.** A project with nowhere to send money
 *     must not be reviewable, because the alternative is an approved campaign
 *     taking pledges it cannot pay out — money held with no destination.
 *   - **already approved is a 409, not a reset.** If this downgraded an
 *     approved campaign to `pending`, a creator could knock their own project
 *     out of payable state, and a reviewer's decision would be erasable by the
 *     person it was made about.
 *   - **owner only.** Not a member, not a reviewer, not a stranger: putting
 *     somebody else's project in front of a reviewer is not a neighbour's
 *     business.
 *
 * And one thing it must *allow*: a rejected campaign resubmitting, with the
 * old reviewer notes cleared, because otherwise a rejection is permanent and
 * the only fix is a support request.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { users, projectBackingCampaigns } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, tag: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `sr-${tag}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.192.${(n % 200) + 20}`)
    .send({ email, password: "a-good-passphrase-here", firstName: `S${n}` });
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  return { agent, id: res.body.id as string };
}

async function aProject(agent: any) {
  const res = await agent.post("/api/projects").send({
    title: "Funded", description: "A project used to check the door into the payout review queue.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
  });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return res.body.id as string;
}

/** The creator has somewhere to be paid. */
const withPayoutAccount = (userId: string) =>
  db.update(users).set({ stripeConnectAccountId: `acct_${userId.slice(0, 12)}` } as any).where(eq(users.id, userId));

const campaignOf = async (projectId: string) =>
  (await db.select().from(projectBackingCampaigns).where(eq(projectBackingCampaigns.projectId, projectId)))[0];

const submit = (agent: any, projectId: string) =>
  agent.post(`/api/projects/${projectId}/backing/submit-review`).send({});

describe("asking for a payout review", () => {
  it("puts the campaign in the queue once there is somewhere to send the money", async () => {
    const app = await getTestApp();
    const creator = await person(app, "ok");
    const projectId = await aProject(creator.agent);
    await withPayoutAccount(creator.id);

    const res = await submit(creator.agent, projectId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.reviewStatus).toBe("pending");

    const row = await campaignOf(projectId);
    expect(row.reviewStatus).toBe("pending");
    expect(row.submittedForReviewAt, "stamped, so the queue can be ordered").toBeTruthy();
  }, 180_000);

  /*
   * The money one. An approved campaign with no payout destination is a
   * campaign that can take pledges it cannot pay out, so the refusal has to
   * leave the status alone as well as answering 422.
   */
  it("refuses a project with nowhere to send the money, and does not queue it anyway", async () => {
    const app = await getTestApp();
    const creator = await person(app, "nostripe");
    const projectId = await aProject(creator.agent);

    const res = await submit(creator.agent, projectId);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(String(res.body.message)).toMatch(/stripe/i);

    const row = await campaignOf(projectId);
    expect(row?.reviewStatus, "not in the queue").not.toBe("pending");
    expect(row?.submittedForReviewAt, "and not stamped as if it were").toBeFalsy();
  }, 180_000);

  it("is the owner's to ask for, and nobody else's", async () => {
    const app = await getTestApp();
    const creator = await person(app, "own");
    const stranger = await person(app, "str");
    const projectId = await aProject(creator.agent);
    await withPayoutAccount(creator.id);
    await withPayoutAccount(stranger.id);

    const res = await submit(stranger.agent, projectId);
    expect(res.status).toBe(403);
    const row = await campaignOf(projectId);
    expect(row?.reviewStatus, "a stranger did not queue somebody else's project").not.toBe("pending");

    const signedOut = await request(app).post(`/api/projects/${projectId}/backing/submit-review`)
      .set("x-forwarded-for", "198.51.192.250").send({});
    expect(signedOut.status).toBe(401);
  }, 180_000);

  /*
   * A reviewer's approval is not the creator's to undo. Were this a 200 that
   * set `pending`, the creator could take their own approved project out of
   * payable state — and a decision made about somebody would be erasable by
   * them.
   */
  it("will not knock an approved campaign back into the queue", async () => {
    const app = await getTestApp();
    const creator = await person(app, "appr");
    const projectId = await aProject(creator.agent);
    await withPayoutAccount(creator.id);

    await submit(creator.agent, projectId);
    await db.update(projectBackingCampaigns)
      .set({ reviewStatus: "approved", reviewedAt: new Date() } as any)
      .where(eq(projectBackingCampaigns.projectId, projectId));

    const again = await submit(creator.agent, projectId);
    expect(again.status).toBe(409);
    expect((await campaignOf(projectId)).reviewStatus, "still approved").toBe("approved");
  }, 180_000);

  /*
   * The thing it must allow. A rejection that could not be answered would
   * make every fixable problem a support request, and the reviewer's old
   * notes must not follow the campaign back into the queue as if they still
   * described it.
   */
  it("lets a rejected campaign come back, without the old notes attached", async () => {
    const app = await getTestApp();
    const creator = await person(app, "rej");
    const projectId = await aProject(creator.agent);
    await withPayoutAccount(creator.id);
    await submit(creator.agent, projectId);

    await db.update(projectBackingCampaigns)
      .set({ reviewStatus: "rejected", reviewNotes: "The rewards page was empty.", reviewedAt: new Date() } as any)
      .where(eq(projectBackingCampaigns.projectId, projectId));

    const res = await submit(creator.agent, projectId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await campaignOf(projectId);
    expect(row.reviewStatus).toBe("pending");
    expect(row.reviewNotes, "last time's reasons do not describe this time's submission").toBeNull();
  }, 180_000);
});
