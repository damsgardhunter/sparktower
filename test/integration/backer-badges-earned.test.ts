/**
 * The badge a backer ends up holding, for a pledge nothing minted one for.
 *
 * `recordBacking` creates the badge row in the same transaction as the pledge,
 * so "every settled backing has a badge" held by construction for as long as
 * Stripe's webhook was the only way a backing got written. It is not true of a
 * backing written any other way — the demo seeds, `seed-max-reputation`, a hand
 * repair, an import — and those backers were in the worst possible state: on the
 * wall wearing a level, with nothing on their profile and nothing in the picker,
 * because you cannot equip a badge that has no row.
 *
 * `ensureBackerBadges` closes that, and the interesting part is not the minting.
 * It is *where* it is allowed to run. The sibling endpoint that serves a
 * profile's pinned badges is public and unauthenticated, and ensuring on that
 * read would turn any stranger's page view into a write — so it mints only on
 * the owner's own request, and a backfill script covers profiles whose owner
 * has not signed in since.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import {
  backerBadges, projectBackerTiers, projectBackingCampaigns, projectBackings, projects,
} from "@shared/schema";
import { badgeLevelForAmount, FOUNDER_LEVEL, MAX_SHOWCASE_BADGES } from "@shared/backing";
import { backfill } from "../../script/backfill-backer-badges";
import { reconcileBackerBadge } from "../../server/backer-badges";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.195.${(n % 200) + 20}`;
  const email = `earned-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: first });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string, first };
}

async function campaign(ownerId: string, over: Record<string, unknown> = {}) {
  const [project] = await db.insert(projects).values({
    ownerId, title: `Earned ${++n}`, description: "Something being built.",
    category: "saas", status: "active", ...over,
  } as any).returning();
  await db.insert(projectBackingCampaigns).values({
    projectId: project.id, enabled: true, headline: "Back it", story: "Why.",
    goalCents: 100_000, startedAt: new Date(), reviewStatus: "approved",
  } as any);
  return project;
}

/**
 * A pledge written the way the seed scripts write one: straight into the table,
 * with no believer number, no tier and no badge. This is the state being fixed,
 * so the fixture has to be exactly as bare as the real thing.
 */
const seededBacking = (projectId: string, backerId: string, over: Record<string, unknown> = {}) =>
  db.insert(projectBackings).values({
    projectId, backerId, amountCents: 2_000, status: "released", ...over,
  } as any).returning();

const badgeRows = (userId: string) =>
  db.select().from(backerBadges).where(eq(backerBadges.userId, userId));

describe("a badge for a backing nothing minted one for", () => {
  it("appears in the owner's own picker, at the level the pledge earned", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Olive");
    const fan = await person(app, "Fred");
    const project = await campaign(owner.id);
    await seededBacking(project.id, fan.id, { amountCents: 2_000 });

    const res = await fan.agent.get("/api/me/badges");
    expect(res.status, (res.text ?? "").slice(0, 200)).toBe(200);
    expect(res.body).toHaveLength(1);
    /* $20 is silver, and it is derived the one way it is ever derived. */
    expect(res.body[0].level).toBe(badgeLevelForAmount(2_000).key);
    expect(res.body[0].level).toBe("silver");
    expect(res.body[0].projectId).toBe(project.id);
    expect(res.body[0].totalCents).toBe(2_000);
  });

  /* Equipped, not merely owned — the point of the exercise is it being on the profile. */
  it("is pinned to the profile, so it shows without anybody choosing it", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Omar");
    const fan = await person(app, "Gale");
    const project = await campaign(owner.id);
    await seededBacking(project.id, fan.id);

    expect((await fan.agent.get("/api/me/badges")).body[0].showcaseOrder).toBe(0);

    const shown = await request(app).get(`/api/users/${fan.id}/badges/backer`);
    expect(shown.status).toBe(200);
    expect(shown.body, "a visitor sees it too").toHaveLength(1);
    expect(shown.body[0].projectId).toBe(project.id);
  });

  /*
   * The level is the total across every pledge to that project, which is what
   * makes the badge "how far I went for this project" rather than "the biggest
   * single time I paid". Two $20 pledges is $40, which is gold.
   */
  it("adds a backer's pledges together before deciding the metal", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Opal");
    const fan = await person(app, "Hana");
    const project = await campaign(owner.id);
    await seededBacking(project.id, fan.id, { amountCents: 2_000 });
    await seededBacking(project.id, fan.id, { amountCents: 2_000 });

    const body = (await fan.agent.get("/api/me/badges")).body;
    expect(body, "one badge per project, not one per pledge").toHaveLength(1);
    expect(body[0].totalCents).toBe(4_000);
    expect(body[0].level).toBe("gold");
  });

  it("does not mint a second badge on a second look", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Otto");
    const fan = await person(app, "Jun");
    const project = await campaign(owner.id);
    await seededBacking(project.id, fan.id);

    await fan.agent.get("/api/me/badges");
    await fan.agent.get("/api/me/badges");
    expect(await badgeRows(fan.id)).toHaveLength(1);
  });

  /*
   * A pledge that never settled is not a backing. A badge for one would be a
   * reward on a profile for money that never arrived.
   */
  it("ignores a pledge that failed", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Oona");
    const fan = await person(app, "Kit");
    const project = await campaign(owner.id);
    await seededBacking(project.id, fan.id, { status: "failed" });

    expect((await fan.agent.get("/api/me/badges")).body).toHaveLength(0);
  });

  /*
   * A project you built outranks a project you backed when there are five
   * slots and more badges than that. The creator pass runs first for exactly
   * this reason, and the ordering is the only thing that expresses it.
   */
  it("gives a founder badge the earlier slot", async () => {
    const app = await getTestApp();
    const other = await person(app, "Osmo");
    const both = await person(app, "Lena");
    await campaign(both.id);                     // one she built
    const theirs = await campaign(other.id);     // one she backed
    await seededBacking(theirs.id, both.id);

    const body = (await both.agent.get("/api/me/badges")).body;
    const founder = body.find((b: any) => b.level === FOUNDER_LEVEL.key);
    const backer = body.find((b: any) => b.level !== FOUNDER_LEVEL.key);
    expect(founder, "she created a public project").toBeTruthy();
    expect(backer, "and backed somebody else's").toBeTruthy();
    expect(founder.showcaseOrder).toBe(0);
    expect(backer.showcaseOrder).toBe(1);
  });

  /*
   * A pinned slot is a public slot, and a stranger's view of this profile has
   * the private project filtered out of it — so pinning one would spend one of
   * five places on something almost nobody can see. The badge itself is still
   * hers.
   */
  it("mints but does not pin a badge for a private project", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Ivor");
    const fan = await person(app, "Mira");
    const secret = await campaign(owner.id, { isPrivate: true });
    await seededBacking(secret.id, fan.id);

    const body = (await fan.agent.get("/api/me/badges")).body;
    expect(body, "she still holds it").toHaveLength(1);
    expect(body[0].showcaseOrder, "but it is not on her profile").toBeNull();
  });

  it("stops pinning once the profile is full", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Ola");
    const fan = await person(app, "Nils");
    const made = [];
    for (let i = 0; i < MAX_SHOWCASE_BADGES + 2; i++) {
      const p = await campaign(owner.id);
      await seededBacking(p.id, fan.id);
      made.push(p.id);
    }

    const body = (await fan.agent.get("/api/me/badges")).body;
    expect(body).toHaveLength(made.length);
    const pinned = body.filter((b: any) => b.showcaseOrder != null);
    expect(pinned).toHaveLength(MAX_SHOWCASE_BADGES);
    expect(pinned.map((b: any) => b.showcaseOrder).sort((a: number, b: number) => a - b))
      .toEqual([0, 1, 2, 3, 4]);
  });
});

describe("where minting is allowed to happen", () => {
  /*
   * This endpoint takes no session and is read by anybody who opens a profile.
   * Ensuring here would make every stranger's page view do writes — a row
   * inserted, a pin updated — on a route that exists to answer a question.
   */
  it("writes nothing when a stranger reads somebody else's profile", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Umi");
    const fan = await person(app, "Pia");
    const nosy = await person(app, "Quill");
    const project = await campaign(owner.id);
    await seededBacking(project.id, fan.id);

    const anon = await request(app).get(`/api/users/${fan.id}/badges/backer`);
    expect(anon.status).toBe(200);
    expect(anon.body, "nothing is pinned, because nothing was minted").toHaveLength(0);
    const signedIn = await nosy.agent.get(`/api/users/${fan.id}/badges/backer`);
    expect(signedIn.body).toHaveLength(0);
    expect(await badgeRows(fan.id), "no row was created by either read").toHaveLength(0);

    /* And it is still waiting for her when she asks for it herself. */
    expect((await fan.agent.get("/api/me/badges")).body).toHaveLength(1);
  });
});

describe("the backfill, for a profile nobody has signed into", () => {
  it("mints the badges and hands out the believer numbers", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Vera");
    const fan = await person(app, "Rae");
    const project = await campaign(owner.id);
    await seededBacking(project.id, fan.id, { amountCents: 7_500 });

    expect(await backfill(false)).toBe(0);

    const [badge] = await badgeRows(fan.id);
    expect(badge, "she never signed in and has her badge anyway").toBeTruthy();
    expect(badge.level).toBe("platinum");
    expect(badge.showcaseOrder).toBe(0);

    const [backing] = await db.select().from(projectBackings)
      .where(eq(projectBackings.backerId, fan.id));
    expect(backing.believerNumber, "numbered, so the wall reads properly").toBe(1);
  });

  /*
   * The one thing on a wall somebody would notice twice. Numbering has to start
   * above whatever has already been handed out, not at 1, or a project with
   * both real and seeded backers gives two people the same number.
   */
  it("never hands a number to two backers of the same project", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Wren");
    const early = await person(app, "Sol");
    const seeded = await person(app, "Tove");
    const project = await campaign(owner.id);
    await seededBacking(project.id, early.id, { believerNumber: 1 });
    await seededBacking(project.id, seeded.id);

    await backfill(false);

    const numbers = (await db.select({ believerNumber: projectBackings.believerNumber })
      .from(projectBackings).where(eq(projectBackings.projectId, project.id)))
      .map((r) => r.believerNumber);
    expect(numbers).toHaveLength(2);
    expect(new Set(numbers).size, "two backers, two numbers").toBe(2);
    expect(numbers.sort()).toEqual([1, 2]);

    /* And the counter the live path reads has moved past both of them. */
    const [c] = await db.select().from(projectBackingCampaigns)
      .where(eq(projectBackingCampaigns.projectId, project.id));
    expect(c.believerCount).toBeGreaterThanOrEqual(2);
  });

  it("changes nothing on a second run", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Yann");
    const fan = await person(app, "Ulla");
    const project = await campaign(owner.id);
    await seededBacking(project.id, fan.id);

    await backfill(false);
    const first = await db.select().from(projectBackings).where(eq(projectBackings.backerId, fan.id));
    await backfill(false);
    const second = await db.select().from(projectBackings).where(eq(projectBackings.backerId, fan.id));

    expect(second.map((r) => r.believerNumber)).toEqual(first.map((r) => r.believerNumber));
    expect(await badgeRows(fan.id)).toHaveLength(1);
  });

  /*
   * A seeded pledge has no tier at all, so the wall read "Fred · Silver" with
   * nothing after it where every real pledge names what it bought. Resolved
   * through `tierForAmount`, which is what checkout uses, so a backfilled name
   * cannot disagree with the one the live path would have given.
   */
  it("names the rung each tierless pledge actually bought", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Ash");
    const fan = await person(app, "Wyn");
    const project = await campaign(owner.id);
    await db.insert(projectBackerTiers).values([
      { projectId: project.id, name: "The Sticker", amountCents: 500, sortOrder: 0 },
      { projectId: project.id, name: "The Shirt", amountCents: 3_500, sortOrder: 1 },
    ] as any);
    await seededBacking(project.id, fan.id, { amountCents: 4_000 });

    await backfill(false);

    const [backing] = await db.select().from(projectBackings)
      .where(eq(projectBackings.backerId, fan.id));
    /* $40 buys the $35 rung, which is what they would have been given. */
    expect(backing.tierNameAtBacking).toBe("The Shirt");
    expect(backing.tierId, "the id too, for the entitlements").toBeTruthy();
  });

  /* Nothing is invented. A project with no rungs has no answer to take. */
  it("leaves a pledge tierless when the project has no rungs", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Bo");
    const fan = await person(app, "Xia");
    const project = await campaign(owner.id);
    await seededBacking(project.id, fan.id);

    await backfill(false);

    const [backing] = await db.select().from(projectBackings)
      .where(eq(projectBackings.backerId, fan.id));
    expect(backing.tierNameAtBacking).toBeNull();
    expect(backing.tierId).toBeNull();
  });

  it("writes nothing at all on a dry run", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Zoe");
    const fan = await person(app, "Vik");
    const project = await campaign(owner.id);
    await seededBacking(project.id, fan.id);

    expect(await backfill(true)).toBe(0);
    expect(await badgeRows(fan.id)).toHaveLength(0);
    const [backing] = await db.select().from(projectBackings)
      .where(eq(projectBackings.backerId, fan.id));
    expect(backing.believerNumber).toBeNull();
  });

  /* A founder badge is not a pledge, and a pledge must not turn one into bronze. */
  it("leaves a creator's own founder badge alone", async () => {
    const app = await getTestApp();
    const builder = await person(app, "Aki");
    const project = await campaign(builder.id);
    await db.insert(backerBadges).values({
      userId: builder.id, projectId: project.id, level: FOUNDER_LEVEL.key, totalCents: 0,
    } as any);
    await seededBacking(project.id, builder.id, { amountCents: 500 });

    await backfill(false);

    const [badge] = await db.select().from(backerBadges)
      .where(and(eq(backerBadges.userId, builder.id), eq(backerBadges.projectId, project.id)));
    expect(badge.level).toBe(FOUNDER_LEVEL.key);
  });
});

/**
 * Money going back, and the badge going with it.
 *
 * Four separate paths move a backing to `refunded` — the backer closing their
 * account, the sweep for a campaign nobody approved, a refund issued from the
 * Stripe dashboard, and a chargeback the platform lost — and none of them
 * touched `backer_badges`. The old `upsertBackerBadge` returned early the
 * moment no settled pledge was left, so it could only ever upgrade a badge.
 * The pledge dropped off the wall, which filters to held and released, while
 * the badge stayed pinned to the profile at its level. The money went back and
 * the reward for it did not.
 *
 * Reconciling is tested directly rather than through those four routes: three
 * of them need Stripe to issue a real refund first, and what is worth holding
 * is the decision — what happens to a badge when the pledges behind it change —
 * rather than the plumbing that delivers the news.
 */
describe("a refund takes the badge with it", () => {
  it("removes the badge when nothing settled is left", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Bea");
    const fan = await person(app, "Cass");
    const project = await campaign(owner.id);
    const [backing] = await seededBacking(project.id, fan.id, { amountCents: 7_500 });

    expect((await fan.agent.get("/api/me/badges")).body[0].level).toBe("platinum");

    await db.update(projectBackings).set({ status: "refunded" } as any)
      .where(eq(projectBackings.id, backing.id));
    await reconcileBackerBadge(fan.id, project.id);

    expect(await badgeRows(fan.id), "paid back, so not a backer").toHaveLength(0);
    const shown = await request(app).get(`/api/users/${fan.id}/badges/backer`);
    expect(shown.body, "and gone from the profile").toHaveLength(0);
  });

  /*
   * A partial refund is not a deletion. The level is recomputed from what is
   * left, so two $20 pledges less one is silver again rather than gold.
   */
  it("drops the level back when only part of it went back", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Cy");
    const fan = await person(app, "Dara");
    const project = await campaign(owner.id);
    const [first] = await seededBacking(project.id, fan.id, { amountCents: 2_000 });
    await seededBacking(project.id, fan.id, { amountCents: 2_000 });

    expect((await fan.agent.get("/api/me/badges")).body[0].level, "$40 is gold").toBe("gold");

    await db.update(projectBackings).set({ status: "refunded" } as any)
      .where(eq(projectBackings.id, first.id));
    await reconcileBackerBadge(fan.id, project.id);

    const [badge] = await badgeRows(fan.id);
    expect(badge, "they are still a backer").toBeTruthy();
    expect(badge.level, "of the $20 that stayed").toBe("silver");
    expect(badge.totalCents).toBe(2_000);
  });

  /*
   * The metal is the whole point of the picture, so a level that moves
   * invalidates the artwork — the same rule an upgrade has always followed.
   */
  it("throws away artwork struck in the wrong metal", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Dov");
    const fan = await person(app, "Esme");
    const project = await campaign(owner.id);
    const [first] = await seededBacking(project.id, fan.id, { amountCents: 2_000 });
    await seededBacking(project.id, fan.id, { amountCents: 2_000 });
    await fan.agent.get("/api/me/badges");
    await db.update(backerBadges).set({ status: "ready", imageUrl: "/objects/badges/gold.png" } as any)
      .where(eq(backerBadges.userId, fan.id));

    await db.update(projectBackings).set({ status: "refunded" } as any)
      .where(eq(projectBackings.id, first.id));
    await reconcileBackerBadge(fan.id, project.id);

    const [badge] = await badgeRows(fan.id);
    expect(badge.level).toBe("silver");
    expect(badge.imageUrl, "a gold medal cannot stand in for a silver one").toBeNull();
    expect(badge.status).toBe("pending");
  });

  /* A founder badge is not a pledge, so no refund is its business either. */
  it("leaves a creator's founder badge standing", async () => {
    const app = await getTestApp();
    const builder = await person(app, "Fay");
    const project = await campaign(builder.id);
    await db.insert(backerBadges).values({
      userId: builder.id, projectId: project.id, level: FOUNDER_LEVEL.key, totalCents: 0,
      showcaseOrder: 0,
    } as any);
    const [backing] = await seededBacking(project.id, builder.id, { amountCents: 500 });

    await db.update(projectBackings).set({ status: "refunded" } as any)
      .where(eq(projectBackings.id, backing.id));
    await reconcileBackerBadge(builder.id, project.id);

    const [badge] = await badgeRows(builder.id);
    expect(badge, "they still built it").toBeTruthy();
    expect(badge.level).toBe(FOUNDER_LEVEL.key);
    expect(badge.showcaseOrder, "and it is still on their profile").toBe(0);
  });

  /*
   * And the freed slot is usable. Deleting a pinned badge leaves a hole in the
   * ordering, which is harmless — the order is only ever read sorted — but the
   * count is what decides whether there is room, so the next badge earned has
   * to find it.
   */
  it("frees the profile slot it was using", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Gus");
    const fan = await person(app, "Hale");
    const first = await campaign(owner.id);
    const [backing] = await seededBacking(first.id, fan.id);
    await fan.agent.get("/api/me/badges");
    expect((await badgeRows(fan.id))[0].showcaseOrder).toBe(0);

    await db.update(projectBackings).set({ status: "refunded" } as any)
      .where(eq(projectBackings.id, backing.id));
    await reconcileBackerBadge(fan.id, first.id);

    const second = await campaign(owner.id);
    await seededBacking(second.id, fan.id);
    const body = (await fan.agent.get("/api/me/badges")).body;
    expect(body).toHaveLength(1);
    expect(body[0].projectId).toBe(second.id);
    expect(body[0].showcaseOrder, "the next badge gets the place").not.toBeNull();
  });
});
