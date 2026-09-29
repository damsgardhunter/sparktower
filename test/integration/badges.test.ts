/**
 * Badges that can actually be earned.
 *
 * The feature shipped complete except for the one thing that made it a
 * feature: there were no badges. `createBadge` had no caller, no migration
 * inserted a row, and the single award site looked one up *by name*, found
 * nothing and returned without a word. Every screen worked; nobody could ever
 * hold a badge, and nothing anywhere said so.
 *
 * So: the catalog exists after boot, a milestone actually awards one, and
 * awarding twice is a no-op rather than a duplicate row — it used to be a
 * select followed by an insert, which is a race two milestones landing
 * together would lose.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { badges, userBadges } from "@shared/schema";
import { BADGE, BADGE_CATALOG } from "@shared/badges";
import { storage } from "../../server/storage";
import { award } from "../../server/badges";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function member(app: any) {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.220.${(n % 200) + 20}`;
  const email = `badge-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `Bg${n}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

describe("the badge catalog", () => {
  it("is in the database once the app has started", async () => {
    await getTestApp();
    const rows = await db.select().from(badges);
    const ids = new Set(rows.map((r) => r.id));
    for (const badge of BADGE_CATALOG) {
      expect(ids.has(badge.id), `no badge "${badge.id}" — nobody can earn it`).toBe(true);
    }
    // Seeded by stable id, so a second boot updates rather than duplicating.
    expect(rows.filter((r) => r.id === BADGE.firstProject)).toHaveLength(1);
  }, 120_000);
});

describe("earning one", () => {
  it("is awarded at a milestone that already happened", async () => {
    const app = await getTestApp();
    const me = await member(app);

    const before = await me.agent.get(`/api/users/${me.id}/badges`);
    expect(before.status).toBe(200);
    expect(before.body.some((b: any) => b.badgeId === BADGE.profileComplete)).toBe(false);

    const done = await me.agent.post("/api/profile/complete-onboarding").send({ displayName: "Badger" });
    expect(done.status).toBe(200);

    const after = await me.agent.get(`/api/users/${me.id}/badges`);
    const earned = after.body.find((b: any) => b.badgeId === BADGE.profileComplete);
    expect(earned, "finishing a profile must actually award the badge").toBeTruthy();
    // The join is what the profile panel renders, so the catalog row has to be there.
    expect(earned.badge.name).toBe("Fully Introduced");
  }, 120_000);

  /*
   * Creating a project, which is the award nothing was watching.
   *
   * `awardBadge` returns null for an id that is not in the catalog, logs
   * "Skipping unknown badge" and carries on — deliberately, so a decoration
   * cannot fail the request it decorates. The cost of that kindness is that a
   * missing catalog is invisible: every award in every test quietly did
   * nothing and every test still passed. The e2e database ran that way for
   * real, with zero rows in `badges`, because the server seeds the catalog as
   * it boots and the global setup truncated it straight afterwards.
   *
   * So this checks an award end to end through a route somebody actually
   * takes, rather than checking the catalog and the award mechanism apart
   * from each other and believing the pair works.
   */
  it("gives a founder their badge for creating a project", async () => {
    const app = await getTestApp();
    const me = await member(app);

    const project = await me.agent.post("/api/projects").send({
      title: "Badged On Creation", description: "A project that earns its founder a badge.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    });
    expect(project.status, JSON.stringify(project.body).slice(0, 200)).toBe(200);

    const mine = await me.agent.get(`/api/users/${me.id}/badges`);
    const earned = mine.body.find((b: any) => b.badgeId === BADGE.firstProject);
    expect(earned, "creating a project must actually award the badge, not skip it").toBeTruthy();
    expect(earned.badge, "the catalog row has to be there for the profile to render it").toBeTruthy();
  }, 120_000);

  it("survives two awards landing at once", async () => {
    const app = await getTestApp();
    const me = await member(app);

    /*
     * The old select-then-insert would have both of these read "not awarded"
     * and both write. A duplicate badge cannot be undone from any screen.
     */
    await Promise.all([
      storage.awardBadge(me.id, BADGE.aiExplorer),
      storage.awardBadge(me.id, BADGE.aiExplorer),
      storage.awardBadge(me.id, BADGE.aiExplorer),
    ]);

    const held = await db.select().from(userBadges)
      .where(and(eq(userBadges.userId, me.id), eq(userBadges.badgeId, BADGE.aiExplorer)));
    expect(held, "you can hold a badge once").toHaveLength(1);
  }, 120_000);

  it("refuses to fail silently when a site names a badge that isn't in the catalog", async () => {
    await getTestApp();
    const me = { id: "nobody" };
    // The exact shape of the original bug: a name nothing matches. Outside
    // production this is a bug in the repository, not a runtime condition.
    await expect(award(me.id, "not-a-real-badge" as any)).rejects.toThrow(/BADGE_CATALOG/);
  }, 120_000);
});

describe("what there is to earn", () => {
  /*
   * The panel is built from the catalog in code, not from the badges table:
   * the table still holds rows from features that were removed (a typing
   * race, a signal game), and offering somebody a badge nothing can award is
   * worse than offering none.
   */
  it("lists only badges something actually awards, each with how to earn it", async () => {
    const app = await getTestApp();
    const res = await request(app).get("/api/badges/catalog");
    expect(res.status).toBe(200);
    expect(res.body.map((b: any) => b.id).sort()).toEqual(BADGE_CATALOG.map((b) => b.id).sort());
    for (const b of res.body) {
      expect(b.howTo, `${b.id} needs to say how it's earned`).toBeTruthy();
      expect(b.name).toBeTruthy();
    }
    // The retired rows are in the table and must not be offered to anyone.
    const stored = await db.select().from(badges);
    expect(stored.length).toBeGreaterThanOrEqual(res.body.length);
  });
});

describe("the badges people had already earned", () => {
  /*
   * Awards fire at the milestone, which does nothing for the people who
   * passed that milestone while the feature was dead — which was everybody.
   * On the day it came alive, every member had shipped projects and finished
   * their profile and had an empty panel saying otherwise. The rule is stated
   * as a query and re-run on boot so the page matches what people did, and so
   * a future broken award site heals on the next deploy instead of leaving a
   * hole nobody can see.
   */
  it("gives them out on boot, and gives nobody one twice", async () => {
    const app = await getTestApp();
    const me = await member(app);

    // Onboarded and shipped a project — but with their awards taken away, as
    // though both had happened while nothing was awarding anything.
    await me.agent.post("/api/profile/complete-onboarding").send({ displayName: "Backfill Tester" });
    const project = await me.agent.post("/api/projects").send({
      title: "Earned it earlier", description: "A project that existed before badges did.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    });
    expect([200, 201], JSON.stringify(project.body)).toContain(project.status);
    await db.delete(userBadges).where(eq(userBadges.userId, me.id));

    const { backfillEarnedBadges } = await import("../../server/badges");
    await backfillEarnedBadges();

    const earned = await db.select().from(userBadges).where(eq(userBadges.userId, me.id));
    expect(earned.map((b) => b.badgeId).sort()).toEqual([BADGE.firstProject, BADGE.profileComplete].sort());

    // Again, because it runs on every boot: the same badges, not doubles of them.
    await backfillEarnedBadges();
    const again = await db.select().from(userBadges).where(eq(userBadges.userId, me.id));
    expect(again).toHaveLength(earned.length);
  });

  it("leaves a closed account out of it", async () => {
    const app = await getTestApp();
    const gone = await member(app);
    await gone.agent.post("/api/profile/complete-onboarding").send({ displayName: "Gone" });
    await db.delete(userBadges).where(eq(userBadges.userId, gone.id));
    const { users } = await import("@shared/schema");
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, gone.id));

    const { backfillEarnedBadges } = await import("../../server/badges");
    await backfillEarnedBadges();
    expect(await db.select().from(userBadges).where(eq(userBadges.userId, gone.id))).toHaveLength(0);
  });
});
