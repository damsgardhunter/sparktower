/**
 * A backer changing their mind about being named.
 *
 * `PATCH /api/backings/:id/privacy` was one of seventeen write routes no test
 * named, and it is the one that decides whether somebody's name is on a public
 * page. Anonymity has to be reversible — people decide a week later that they
 * would rather not be listed — and the whole point of the flag is that it
 * means something, so the two halves both need holding:
 *
 *   - the public wall (`GET /api/users/:userId/backings`) excludes anonymous
 *     pledges, and excludes them *nowhere else*, which is what makes the
 *     choice real;
 *   - the creator's roster (`GET /api/projects/:id/backing/backers`) keeps
 *     showing them, by name, because anonymity governs the public listing and
 *     not whether the person you paid can post you a shirt. Getting this
 *     backwards either breaks fulfilment or breaks the promise.
 *
 * The pledge rows are inserted directly. The payment path that normally makes
 * them is Stripe's, and it is covered by `stripe-webhook.test.ts` and
 * `backing-money.test.ts`; what is under test here is who may change the flag
 * and what changes when they do.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { projectBackings } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
let n = 0;
async function person(app: any, tag: string) {
  const agent = request.agent(app);
  n += 1;
  const email = `bp-${tag}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.101.${(n % 200) + 20}`)
    .send({ email, password, firstName: `B${n}`, lastName: "Acker" });
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  return { agent, id: res.body.id as string, email };
}

async function aProject(agent: any) {
  const res = await agent.post("/api/projects").send({
    title: "Backed", description: "A project used to check what a backer's anonymity actually changes.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
  });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return res.body.id as string;
}

async function aPledge(projectId: string, backerId: string, isAnonymous = false) {
  const [row] = await db.insert(projectBackings).values({
    id: randomUUID(), projectId, backerId, amountCents: 2_500, status: "held",
    believerNumber: 1, isAnonymous, tierNameAtBacking: "Believer",
    stripePaymentIntentId: `pi_${randomUUID()}`, createdAt: new Date(),
  } as any).returning();
  return row;
}

const flagOf = async (id: string) =>
  (await db.select().from(projectBackings).where(eq(projectBackings.id, id)))[0]?.isAnonymous;

describe("a backer's choice to be named", () => {
  it("drops off the public wall when they go anonymous, and comes back when they don't", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own");
    const backer = await person(app, "back");
    const projectId = await aProject(owner.agent);
    const pledge = await aPledge(projectId, backer.id);

    const wall = async () => (await request(app).get(`/api/users/${backer.id}/backings`)).body as any[];
    expect((await wall()).map((r) => r.projectId), "listed while they are happy to be named").toContain(projectId);

    const hide = await backer.agent.patch(`/api/backings/${pledge.id}/privacy`).send({ isAnonymous: true });
    expect(hide.status, JSON.stringify(hide.body)).toBe(200);
    expect(await flagOf(pledge.id)).toBe(true);
    expect((await wall()).map((r) => r.projectId), "and gone from the wall once they are not").not.toContain(projectId);

    const show = await backer.agent.patch(`/api/backings/${pledge.id}/privacy`).send({ isAnonymous: false });
    expect(show.status).toBe(200);
    expect((await wall()).map((r) => r.projectId), "reversible, which is the point").toContain(projectId);
  }, 120_000);

  /*
   * The half that is easy to get backwards. An anonymous backer is anonymous
   * on the wall and nowhere else — the creator owes them a shirt.
   */
  it("stays on the creator's roster, by name, after going anonymous", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own2");
    const backer = await person(app, "back2");
    const projectId = await aProject(owner.agent);
    const pledge = await aPledge(projectId, backer.id);

    await backer.agent.patch(`/api/backings/${pledge.id}/privacy`).send({ isAnonymous: true });

    const roster = await owner.agent.get(`/api/projects/${projectId}/backing/backers`);
    expect(roster.status, JSON.stringify(roster.body)).toBe(200);
    const mine = (roster.body as any[]).find((r) => r.id === pledge.id);
    expect(mine, "the creator can still see the pledge").toBeTruthy();
    expect(mine.anonymousOnWall, "flagged, so the UI cannot muddle the two").toBe(true);
    expect(mine.email, "and still addressable — there is a shirt to post").toBe(backer.email);
    expect(mine.name).toContain("Acker");
  }, 120_000);

  it("is not something another account can change", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own3");
    const backer = await person(app, "back3");
    const stranger = await person(app, "str3");
    const projectId = await aProject(owner.agent);
    const pledge = await aPledge(projectId, backer.id, true);

    const byStranger = await stranger.agent.patch(`/api/backings/${pledge.id}/privacy`).send({ isAnonymous: false });
    expect(byStranger.status).toBe(403);
    expect(await flagOf(pledge.id), "their anonymity survived somebody else asking").toBe(true);

    /* The project's owner is not an exception: it is the backer's choice. */
    const byOwner = await owner.agent.patch(`/api/backings/${pledge.id}/privacy`).send({ isAnonymous: false });
    expect(byOwner.status).toBe(403);
    expect(await flagOf(pledge.id)).toBe(true);
  }, 120_000);

  it("refuses a pledge that doesn't exist, and a caller who isn't signed in", async () => {
    const app = await getTestApp();
    const backer = await person(app, "back4");
    expect((await backer.agent.patch(`/api/backings/${randomUUID()}/privacy`).send({ isAnonymous: true })).status).toBe(404);

    const owner = await person(app, "own4");
    const projectId = await aProject(owner.agent);
    const pledge = await aPledge(projectId, backer.id, true);
    const signedOut = await request(app).patch(`/api/backings/${pledge.id}/privacy`)
      .set("x-forwarded-for", "198.51.101.240").send({ isAnonymous: false });
    expect(signedOut.status).toBe(401);
    expect(await flagOf(pledge.id)).toBe(true);
  }, 120_000);

  /*
   * The one that was wrong.
   *
   * The handler read `Boolean(req.body.isAnonymous)`, so a request that did not
   * mention the field at all — an empty body, a client that sent the wrong key,
   * a retry that lost it — evaluated to `false` and published the name of
   * somebody who had chosen not to be listed. A privacy control that fails open
   * is the wrong way round: not saying "publish me" is not the same as saying
   * it, and the failure is silent and on a public page.
   */
  it("does not publish a name because the request forgot to say anything", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own5");
    const backer = await person(app, "back5");
    const projectId = await aProject(owner.agent);
    const pledge = await aPledge(projectId, backer.id, true);

    for (const body of [{}, { anonymous: false }, { isAnonymous: "no" }, { isAnonymous: null }]) {
      const res = await backer.agent.patch(`/api/backings/${pledge.id}/privacy`).send(body);
      expect(res.status, `${JSON.stringify(body)} should be refused, not read as "publish me"`).toBe(400);
      expect(await flagOf(pledge.id), `${JSON.stringify(body)} un-hid a backer`).toBe(true);
    }

    /* And the request that does say so is still honoured. */
    const proper = await backer.agent.patch(`/api/backings/${pledge.id}/privacy`).send({ isAnonymous: false });
    expect(proper.status).toBe(200);
    expect(await flagOf(pledge.id)).toBe(false);
  }, 120_000);
});
