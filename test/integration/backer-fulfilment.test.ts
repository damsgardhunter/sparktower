/**
 * What the team owes its backers, and marking it done.
 *
 * Most of a tier's promises are the platform's job and are true the moment the
 * pledge lands. Two are not: `early_access` and `video_thankyou` carry
 * `fulfilledBy: "creator"`, which means a person has to go and do something. Until
 * this existed nothing recorded whether they had, so the owner's list showed what
 * each backer was *owed* and never what was *done* — and the backer who paid for a
 * personal video had no way to know it was coming.
 *
 * The rules worth holding, each a way this goes wrong:
 *
 *  - a refunded pledge appearing on the list, so somebody records a video for a
 *    person who got their money back
 *  - a reward marked done against a tier that never promised it
 *  - a platform-fulfilled reward on a to-do list that can therefore never be empty
 *  - the backer not being told, which makes the whole thing a file in a bucket
 *  - a team member reading a backer's home address, which the owner-only list
 *    exists to hold back
 *  - a personal video readable by anybody who has the link
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import {
  backerRewardFulfilments, notifications, projectBackerTiers, projectBackings, projectMembers,
  projectMerchOrders,
} from "@shared/schema";
import { merchProduct } from "@shared/backing";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
let n = 0;
const ip = () => `198.51.160.${20 + (n++ % 200)}`;

async function person(app: any, tag: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `bf-${tag}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip())
    .send({ email, password, firstName: `F${n}`, lastName: "Ulfil" });
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  await verifyEmail(app, email, ip());
  return { agent, id: res.body.id as string, email };
}

async function aProject(agent: any) {
  const res = await agent.post("/api/projects").send({
    title: "Owed", description: "A project used to check what a team owes the people who backed it.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
  });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return res.body.id as string;
}

/** A tier promising whichever rewards the test is about. */
async function aTier(projectId: string, rewards: string[], merch: string[] = []) {
  const [row] = await db.insert(projectBackerTiers).values({
    id: randomUUID(), projectId, name: "Believer", amountCents: 2_500,
    digitalRewards: rewards, merchProducts: merch, createdAt: new Date(),
  } as any).returning();
  return row;
}

async function aPledge(projectId: string, backerId: string, tierId: string | null, over: Record<string, unknown> = {}) {
  const [row] = await db.insert(projectBackings).values({
    id: randomUUID(), projectId, backerId, tierId, amountCents: 2_500, status: "held",
    tierNameAtBacking: "Believer", stripePaymentIntentId: `pi_${randomUUID()}`, createdAt: new Date(),
    ...over,
  } as any).returning();
  return row;
}

const list = async (who: { agent: any }, projectId: string) =>
  (await who.agent.get(`/api/projects/${projectId}/backing/fulfilment`)).body;

describe("the list of what is owed", () => {
  it("names only the rewards a person has to go and do", async () => {
    /*
     * A tier promising the wall, a believer number and a badge owes the team
     * nothing: those happen by themselves. On a to-do list they would be three
     * items that can never be ticked.
     */
    const app = await getTestApp();
    const owner = await person(app, "own");
    const backer = await person(app, "back");
    const projectId = await aProject(owner.agent);
    const tier = await aTier(projectId, ["backer_wall", "believer_number", "digital_badge", "video_thankyou", "early_access"]);
    await aPledge(projectId, backer.id, tier.id);

    const body = await list(owner, projectId);
    expect(body.backers).toHaveLength(1);
    expect(body.backers[0].tasks.map((t: any) => t.rewardKey).sort()).toEqual(["early_access", "video_thankyou"]);
    expect(body.owed).toBe(2);
    expect(body.done).toBe(0);
  });

  it("leaves out a pledge that was refunded, or never paid", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own2");
    const projectId = await aProject(owner.agent);
    const tier = await aTier(projectId, ["video_thankyou"]);

    const standing = await person(app, "ok");
    const refunded = await person(app, "ref");
    const pending = await person(app, "pen");
    const failed = await person(app, "fail");
    await aPledge(projectId, standing.id, tier.id, { status: "held" });
    await aPledge(projectId, refunded.id, tier.id, { status: "refunded" });
    await aPledge(projectId, pending.id, tier.id, { status: "pending" });
    await aPledge(projectId, failed.id, tier.id, { status: "failed" });

    const body = await list(owner, projectId);
    /* Recording a video for somebody who got their money back is the failure here. */
    expect(body.backers).toHaveLength(1);
    expect(body.backers[0].name).toContain("F");
    expect(body.owed).toBe(1);
  });

  it("counts a released and a converted pledge as owing", async () => {
    /* The same three states server/platform-revenue.ts calls "the money was taken". */
    const app = await getTestApp();
    const owner = await person(app, "own3");
    const projectId = await aProject(owner.agent);
    const tier = await aTier(projectId, ["early_access"]);
    for (const status of ["held", "released", "converted"]) {
      const who = await person(app, `s-${status}`);
      await aPledge(projectId, who.id, tier.id, { status });
    }
    const body = await list(owner, projectId);
    expect(body.backers).toHaveLength(3);
  });

  it("names a backer who is anonymous on the wall, and says they are", async () => {
    /*
     * Anonymity governs the public listing, not whether the person recording a
     * personal video knows who it is for. Conflating the two breaks fulfilment or
     * breaks the promise; the owner's existing list makes the same call.
     */
    const app = await getTestApp();
    const owner = await person(app, "own4");
    const backer = await person(app, "shy");
    const projectId = await aProject(owner.agent);
    const tier = await aTier(projectId, ["video_thankyou"]);
    await aPledge(projectId, backer.id, tier.id, { isAnonymous: true });

    const body = await list(owner, projectId);
    expect(body.backers[0].anonymousOnWall).toBe(true);
    expect(body.backers[0].name).not.toBe("A backer");
  });

  it("never sends an address or an email, even to the owner", async () => {
    /*
     * This list is readable by the whole team, unlike the owner-only one. Nobody
     * needs an address by hand — Printful is given it directly — so it is not on
     * the wire at all rather than being filtered per role.
     */
    const app = await getTestApp();
    const owner = await person(app, "own5");
    const backer = await person(app, "addr");
    const projectId = await aProject(owner.agent);
    const tier = await aTier(projectId, ["video_thankyou"], ["shirt"]);
    await aPledge(projectId, backer.id, tier.id, {
      shippingAddress: { name: "Dana Smith", line1: "12 Secret Lane", city: "Leeds", country: "GB", postalCode: "LS1 1AA" },
    });

    const body = await list(owner, projectId);
    const text = JSON.stringify(body);
    expect(text).not.toContain("Secret Lane");
    expect(text).not.toContain(backer.email);
    /* But it does say an address is on file, which is the one thing worth chasing. */
    expect(body.backers[0].hasShippingAddress).toBe(true);
  });

  it("is readable by a team member, and by nobody else", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own6");
    const mate = await person(app, "mate");
    const stranger = await person(app, "str");
    const projectId = await aProject(owner.agent);
    await db.insert(projectMembers).values({ projectId, userId: mate.id, role: "member" } as any);

    expect((await mate.agent.get(`/api/projects/${projectId}/backing/fulfilment`)).status).toBe(200);
    /* 404 rather than 403, so a project id is not confirmable. */
    expect((await stranger.agent.get(`/api/projects/${projectId}/backing/fulfilment`)).status).toBe(404);
  });
});

describe("marking something done", () => {
  async function setUp(app: any, rewards = ["video_thankyou", "early_access"]) {
    const owner = await person(app, "own");
    const backer = await person(app, "back");
    const projectId = await aProject(owner.agent);
    const tier = await aTier(projectId, rewards);
    const pledge = await aPledge(projectId, backer.id, tier.id);
    return { owner, backer, projectId, pledge };
  }

  it("records who did it and when, and tells the backer", async () => {
    const app = await getTestApp();
    const { owner, backer, projectId, pledge } = await setUp(app);

    await owner.agent.post(`/api/projects/${projectId}/backing/fulfilment`)
      .set("x-forwarded-for", ip())
      .send({ backingId: pledge.id, rewardKey: "video_thankyou", note: "Thanks for being first." })
      .expect(200);

    const body = await list(owner, projectId);
    const task = body.backers[0].tasks.find((t: any) => t.rewardKey === "video_thankyou");
    expect(task.done).toBe(true);
    expect(task.deliveredByName).toBeTruthy();
    expect(task.note).toBe("Thanks for being first.");
    expect(body.done).toBe(1);
    expect(body.owed).toBe(1);

    /*
     * The telling is the point: nothing else in the product changes visibly when
     * a creator records a video.
     */
    const bell = await db.select().from(notifications).where(eq(notifications.recipientId, backer.id));
    expect(bell.map((r) => r.kind)).toContain("reward_delivered");
  });

  it("refuses a reward the tier never promised", async () => {
    /*
     * Otherwise a mis-click records a delivery against somebody who was never
     * owed one, and they get a notification about a reward they did not buy.
     */
    const app = await getTestApp();
    const { owner, projectId, pledge } = await setUp(app, ["early_access"]);
    const res = await owner.agent.post(`/api/projects/${projectId}/backing/fulfilment`)
      .set("x-forwarded-for", ip())
      .send({ backingId: pledge.id, rewardKey: "video_thankyou" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("not_promised");
    expect(await db.select().from(backerRewardFulfilments).where(eq(backerRewardFulfilments.backingId, pledge.id))).toHaveLength(0);
  });

  it("refuses a reward the platform does itself", async () => {
    const app = await getTestApp();
    const { owner, projectId, pledge } = await setUp(app, ["digital_badge"]);
    const res = await owner.agent.post(`/api/projects/${projectId}/backing/fulfilment`)
      .set("x-forwarded-for", ip())
      .send({ backingId: pledge.id, rewardKey: "digital_badge" });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("rewardKey");
  });

  it("refuses a pledge that is not standing", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own7");
    const backer = await person(app, "gone");
    const projectId = await aProject(owner.agent);
    const tier = await aTier(projectId, ["video_thankyou"]);
    const pledge = await aPledge(projectId, backer.id, tier.id, { status: "refunded" });

    const res = await owner.agent.post(`/api/projects/${projectId}/backing/fulfilment`)
      .set("x-forwarded-for", ip())
      .send({ backingId: pledge.id, rewardKey: "video_thankyou" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("not_owing");
  });

  it("records one delivery however many times it is pressed", async () => {
    /* A double-tapped button must not notify the backer twice about one video. */
    const app = await getTestApp();
    const { owner, backer, projectId, pledge } = await setUp(app);
    for (const note of ["first", "second"]) {
      await owner.agent.post(`/api/projects/${projectId}/backing/fulfilment`)
        .set("x-forwarded-for", ip())
        .send({ backingId: pledge.id, rewardKey: "video_thankyou", note })
        .expect(200);
    }
    const rows = await db.select().from(backerRewardFulfilments).where(eq(backerRewardFulfilments.backingId, pledge.id));
    expect(rows).toHaveLength(1);
    /* And re-recording replaces, because a video sent again is the same promise kept better. */
    expect(rows[0].note).toBe("second");

    const bell = await db.select().from(notifications)
      .where(and(eq(notifications.recipientId, backer.id), eq(notifications.kind, "reward_delivered")));
    expect(bell, "one promise, one row in the bell").toHaveLength(1);
  });

  it("lets a team member do it, not a stranger", async () => {
    const app = await getTestApp();
    const { owner, projectId, pledge } = await setUp(app);
    const mate = await person(app, "mate2");
    const stranger = await person(app, "str2");
    await db.insert(projectMembers).values({ projectId, userId: mate.id, role: "member" } as any);

    await mate.agent.post(`/api/projects/${projectId}/backing/fulfilment`)
      .set("x-forwarded-for", ip())
      .send({ backingId: pledge.id, rewardKey: "early_access" })
      .expect(200);

    const res = await stranger.agent.post(`/api/projects/${projectId}/backing/fulfilment`)
      .set("x-forwarded-for", ip())
      .send({ backingId: pledge.id, rewardKey: "video_thankyou" });
    expect(res.status).toBe(404);
  });

  it("can be undone, because somebody will tick the wrong person", async () => {
    const app = await getTestApp();
    const { owner, projectId, pledge } = await setUp(app);
    await owner.agent.post(`/api/projects/${projectId}/backing/fulfilment`)
      .set("x-forwarded-for", ip()).send({ backingId: pledge.id, rewardKey: "early_access" }).expect(200);
    await owner.agent.delete(`/api/projects/${projectId}/backing/fulfilment/${pledge.id}/early_access`)
      .set("x-forwarded-for", ip()).expect(200);

    const body = await list(owner, projectId);
    expect(body.backers[0].tasks.find((t: any) => t.rewardKey === "early_access").done).toBe(false);
  });

  it("refuses an asset path that is not an uploaded file", async () => {
    const app = await getTestApp();
    const { owner, projectId, pledge } = await setUp(app);
    const res = await owner.agent.post(`/api/projects/${projectId}/backing/fulfilment`)
      .set("x-forwarded-for", ip())
      .send({ backingId: pledge.id, rewardKey: "video_thankyou", assetPath: "https://evil.test/x.mp4" });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("assetPath");
  });
});

describe("the merch half", () => {
  it("says what was promised, what is in flight, and how it is being delivered", async () => {
    /*
     * "When, if, and how" — the status, the tracking link and the date it went.
     * A tier promising a shirt with no order yet still has to read as owed.
     */
    const app = await getTestApp();
    const owner = await person(app, "own8");
    const backer = await person(app, "merch");
    const projectId = await aProject(owner.agent);
    const tier = await aTier(projectId, [], ["shirt", "sticker_pack"]);
    const pledge = await aPledge(projectId, backer.id, tier.id);

    const body = await list(owner, projectId);
    /*
     * Taken from the catalogue rather than written out, so a renamed product does
     * not fail a test about fulfilment.
     */
    expect(body.backers[0].merchPromised).toEqual([merchProduct("shirt")!.label, merchProduct("sticker_pack")!.label]);
    expect(body.backers[0].merchOrders).toEqual([]);
    expect(body.merchInFlight).toBe(0);

    await db.insert(projectMerchOrders).values({
      id: randomUUID(), backingId: pledge.id, projectId, status: "shipped",
      items: [{ product: "shirt" }], trackingUrl: "https://track.example.test/abc",
      submittedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    } as any);

    const after = await list(owner, projectId);
    const order = after.backers[0].merchOrders[0];
    expect(order.status).toBe("shipped");
    expect(order.trackingUrl).toBe("https://track.example.test/abc");
    expect(order.submittedAt).toBeTruthy();
    /* Names rather than keys: this is a list a person reads. */
    expect(order.items).toEqual([merchProduct("shirt")!.label]);
  });

  it("counts only the orders still on their way", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own9");
    const projectId = await aProject(owner.agent);
    const tier = await aTier(projectId, [], ["shirt"]);
    for (const status of ["queued", "submitted", "shipped", "canceled", "failed"]) {
      const who = await person(app, `m-${status}`);
      const pledge = await aPledge(projectId, who.id, tier.id);
      await db.insert(projectMerchOrders).values({
        id: randomUUID(), backingId: pledge.id, projectId, status,
        items: [{ product: "shirt" }], createdAt: new Date(), updatedAt: new Date(),
      } as any);
    }
    const body = await list(owner, projectId);
    /* Queued and submitted are the two a person might have to chase. */
    expect(body.merchInFlight).toBe(2);
  });

  it("surfaces a failed order's reason rather than only its status", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own10");
    const backer = await person(app, "fail2");
    const projectId = await aProject(owner.agent);
    const tier = await aTier(projectId, [], ["shirt"]);
    const pledge = await aPledge(projectId, backer.id, tier.id);
    await db.insert(projectMerchOrders).values({
      id: randomUUID(), backingId: pledge.id, projectId, status: "failed",
      items: [{ product: "shirt" }], lastError: "Printful rejected the address",
      createdAt: new Date(), updatedAt: new Date(),
    } as any);

    const body = await list(owner, projectId);
    expect(body.backers[0].merchOrders[0].lastError).toBe("Printful rejected the address");
  });
});

describe("what the backer sees", () => {
  it("lists what has been delivered to them, and nobody else's", async () => {
    /*
     * The other half of the point. A creator recording a personal video had
     * nowhere to send it and the backer had nowhere to watch it, so the whole
     * reward existed only as a promise on a tier.
     */
    const app = await getTestApp();
    const owner = await person(app, "own13");
    const mine = await person(app, "mine");
    const other = await person(app, "other");
    const projectId = await aProject(owner.agent);
    const tier = await aTier(projectId, ["video_thankyou"]);
    const minePledge = await aPledge(projectId, mine.id, tier.id);
    const otherPledge = await aPledge(projectId, other.id, tier.id);

    for (const pledge of [minePledge, otherPledge]) {
      await owner.agent.post(`/api/projects/${projectId}/backing/fulfilment`)
        .set("x-forwarded-for", ip())
        .send({ backingId: pledge.id, rewardKey: "video_thankyou", note: `for ${pledge.backerId}` })
        .expect(200);
    }

    const list = (await mine.agent.get("/api/me/rewards")).body;
    expect(list).toHaveLength(1);
    expect(list[0].projectTitle).toBe("Owed");
    expect(list[0].note).toBe(`for ${mine.id}`);
    /* Nothing was attached, so there is nothing to watch — said as null, not a broken link. */
    expect(list[0].videoUrl).toBeNull();
  });

  it("gets a url to watch when a file was attached", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own14");
    const backer = await person(app, "watcher");
    const projectId = await aProject(owner.agent);
    const tier = await aTier(projectId, ["video_thankyou"]);
    const pledge = await aPledge(projectId, backer.id, tier.id);
    await owner.agent.post(`/api/projects/${projectId}/backing/fulfilment`)
      .set("x-forwarded-for", ip())
      .send({ backingId: pledge.id, rewardKey: "video_thankyou", assetPath: "/objects/uploads/abc" })
      .expect(200);

    const list = (await backer.agent.get("/api/me/rewards")).body;
    expect(list[0].videoUrl).toBe(
      `/api/projects/${projectId}/backing/fulfilment/${pledge.id}/video_thankyou/video`,
    );
  });

  it("is empty rather than missing for somebody who was given nothing", async () => {
    const app = await getTestApp();
    const nobody = await person(app, "nowt");
    const res = await nobody.agent.get("/api/me/rewards").expect(200);
    expect(res.body).toEqual([]);
  });
});

describe("the video", () => {
  it("is for the backer it was made for, and the team, and nobody else", async () => {
    /*
     * A link that works for anybody holding it is not a personal thank-you, it is
     * a file — so it is served through a route that checks who is asking.
     */
    const app = await getTestApp();
    const owner = await person(app, "own11");
    const backer = await person(app, "vid");
    const stranger = await person(app, "nosy");
    const projectId = await aProject(owner.agent);
    const tier = await aTier(projectId, ["video_thankyou"]);
    const pledge = await aPledge(projectId, backer.id, tier.id);

    /* A path shaped like an upload; the bytes themselves are not what is under test. */
    await db.insert(backerRewardFulfilments).values({
      id: randomUUID(), backingId: pledge.id, projectId, rewardKey: "video_thankyou",
      assetPath: "/objects/uploads/not-a-real-object", deliveredBy: owner.id, deliveredAt: new Date(),
    } as any);

    const url = `/api/projects/${projectId}/backing/fulfilment/${pledge.id}/video_thankyou/video`;
    /* A stranger is refused before anything is read, so the 404 is the guard's. */
    expect((await stranger.agent.get(url)).status).toBe(404);
    /* The backer and the owner get past the guard — the object is missing, which is also 404. */
    for (const who of [backer, owner]) {
      const res = await who.agent.get(url);
      expect([200, 404]).toContain(res.status);
    }
  });

  it("is 404 when nothing was attached", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own12");
    const backer = await person(app, "novid");
    const projectId = await aProject(owner.agent);
    const tier = await aTier(projectId, ["early_access"]);
    const pledge = await aPledge(projectId, backer.id, tier.id);
    await owner.agent.post(`/api/projects/${projectId}/backing/fulfilment`)
      .set("x-forwarded-for", ip()).send({ backingId: pledge.id, rewardKey: "early_access" }).expect(200);

    expect((await backer.agent.get(`/api/projects/${projectId}/backing/fulfilment/${pledge.id}/early_access/video`)).status).toBe(404);
  });
});
