/**
 * The backer wall: who is on it, what badge they wear, and what it must not say.
 *
 * The wall moved from a scrolling box inside the pledge panel to the project's
 * own tab, where it replaced Media — the people who paid for a project being more
 * interesting to a visitor than its screenshots, and the names having been the
 * one thing on that panel nobody could reach without opening the form that asks
 * for money. A tab is read by strangers, so what it carries is now worth pinning
 * down rather than assuming.
 *
 * Three properties, and the third is the one that would be easy to lose:
 *
 *   - **The badge is there**, from the minted row where one exists and otherwise
 *     from the level the pledge clears, because badges are drawn asynchronously
 *     and somebody who paid a minute ago has earned gold with no row yet.
 *   - **Anonymity still works.** The name and picture go; the badge and the tier
 *     stay, because anonymity hides who somebody is, not that somebody at that
 *     level backed the project.
 *   - **The amount never leaves the server.** It is read to derive the level and
 *     is not in the response. This wall has never shown what anybody paid, and
 *     the level is a four-wide bucket rather than a figure.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import {
  backerBadges, projectBackingCampaigns, projectBackings, projects, users,
} from "@shared/schema";
import { badgeLevelForAmount } from "@shared/backing";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.193.${(n % 200) + 20}`;
  const email = `wall-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: first });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string, first };
}

/** A project taking backing, which is what the public endpoint requires. */
async function campaign(ownerId: string) {
  const [project] = await db.insert(projects).values({
    ownerId, title: `Wall ${++n}`, description: "Something being built.", category: "saas", status: "active",
  } as any).returning();
  await db.insert(projectBackingCampaigns).values({
    projectId: project.id, enabled: true, headline: "Back it", story: "Why.",
    goalCents: 100_000, startedAt: new Date(), reviewStatus: "approved",
  } as any);
  return project;
}

async function back(projectId: string, backerId: string, over: Record<string, unknown> = {}) {
  const [row] = await db.insert(projectBackings).values({
    projectId, backerId, amountCents: 3_500, status: "released",
    believerNumber: ++n, tierNameAtBacking: "The Shirt", isAnonymous: false, ...over,
  } as any).returning();
  return row;
}

const wallOf = async (app: any, projectId: string) => {
  const res = await request(app).get(`/api/projects/${projectId}/backing/public`);
  expect(res.status, (res.text ?? "").slice(0, 200)).toBe(200);
  return res.body.wall as any[];
};

describe("the backer wall", () => {
  it("names each backer, their number and their tier", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Olive");
    const fan = await person(app, "Fred");
    const project = await campaign(owner.id);
    const row = await back(project.id, fan.id);

    const [entry] = await wallOf(app, project.id);
    expect(entry.name).toBe("Fred");
    expect(entry.believerNumber).toBe(row.believerNumber);
    expect(entry.tierName).toBe("The Shirt");
  });

  /* $35 is gold. Derived, because no badge row has been minted for this backing. */
  it("wears the badge the pledge earns, before one has been drawn", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Omar");
    const fan = await person(app, "Gale");
    const project = await campaign(owner.id);
    await back(project.id, fan.id, { amountCents: 3_500 });

    const [entry] = await wallOf(app, project.id);
    expect(entry.badgeLevel).toBe(badgeLevelForAmount(3_500).key);
    expect(entry.badgeLevel).toBe("gold");
    expect(entry.badgeReady, "nothing has been drawn yet, and the wall says so").toBe(false);
  });

  /*
   * And the minted badge outranks the amount. They agree today; they would not if
   * a backer were upgraded, or if the level thresholds ever moved under a badge
   * somebody already wears.
   */
  it("prefers the badge actually minted over the one the amount implies", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Opal");
    const fan = await person(app, "Hana");
    const project = await campaign(owner.id);
    await back(project.id, fan.id, { amountCents: 500 });
    await db.insert(backerBadges).values({
      userId: fan.id, projectId: project.id, level: "platinum", status: "ready",
    } as any);

    const [entry] = await wallOf(app, project.id);
    expect(entry.badgeLevel, "the row wins, not the $5").toBe("platinum");
    expect(entry.badgeReady).toBe(true);
  });

  it("hides an anonymous backer's name and picture, and keeps their badge", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Otto");
    const shy = await person(app, "Quinn");
    const project = await campaign(owner.id);
    await db.update(users).set({ profileImageUrl: "https://example.test/face.png" } as any)
      .where(eq(users.id, shy.id));
    await back(project.id, shy.id, { isAnonymous: true, amountCents: 7_500 });

    const [entry] = await wallOf(app, project.id);
    expect(entry.name).toBe("Anonymous");
    expect(entry.image, "no picture either").toBeNull();
    expect(JSON.stringify(entry), "their name must not survive anywhere in the row").not.toContain("Quinn");
    /* Anonymity hides who, not that somebody at that level is on the wall. */
    expect(entry.badgeLevel).toBe("platinum");
    expect(entry.tierName, "the tier has always been shown anonymously").toBeTruthy();
  });

  /*
   * The amount is read to derive the level and must not be in the response. The
   * wall has never shown what anybody paid, and the badge level is deliberately a
   * four-wide bucket rather than a figure.
   */
  it("never says what anybody paid", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Oona");
    const fan = await person(app, "Remy");
    const project = await campaign(owner.id);
    await back(project.id, fan.id, { amountCents: 4_321, tipCents: 765 });

    const [entry] = await wallOf(app, project.id);
    for (const leak of ["amountCents", "tipCents", "amount", "tip"]) {
      expect(entry, `${leak} must not be on a wall entry`).not.toHaveProperty(leak);
    }
    expect(JSON.stringify(entry)).not.toContain("4321");
    expect(JSON.stringify(entry)).not.toContain("765");
  });

  /* A pledge that never settled is not a backer, so it is not on the wall. */
  it("lists only backings that went through", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Osmo");
    const paid = await person(app, "Sandy");
    const failed = await person(app, "Tariq");
    const project = await campaign(owner.id);
    await back(project.id, paid.id, { status: "released" });
    await back(project.id, failed.id, { status: "failed" });

    const names = (await wallOf(app, project.id)).map((w) => w.name);
    expect(names).toContain("Sandy");
    expect(names).not.toContain("Tariq");
  });
});
