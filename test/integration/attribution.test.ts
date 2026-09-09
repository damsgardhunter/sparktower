/**
 * A tagged link, followed all the way through: landing page → cookie →
 * registration → the user row → the owner's dashboard query.
 *
 * Each piece is exercised elsewhere; this is the one that proves they connect,
 * because the failure that matters is a link that is captured and then never
 * shows up anywhere a person looks.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { users } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
const newEmail = (tag: string) => `attr-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;

/** Lands on a tagged link like a browser would, then registers in the same jar. */
async function signUpVia(app: any, landing: string, referer: string | undefined, email: string) {
  const agent = request.agent(app);
  const land = agent.get(landing).set("Accept", "text/html");
  if (referer) land.set("Referer", referer);
  await land;
  // They read around first; the tag has to survive that.
  await agent.get("/pricing").set("Accept", "text/html");
  const res = await agent.post("/api/auth/register").send({ email, password, firstName: "A", lastName: "B" });
  expect(res.status).toBe(201);
  return { agent, userId: res.body.id as string };
}

describe("signup attribution, end to end", () => {
  it("lands on the user row and in the owner's dashboard", async () => {
    const app = await getTestApp();

    const tw = await signUpVia(app, "/?utm_source=twitter&utm_medium=social&utm_campaign=launch", undefined, newEmail("tw"));
    const ph = await signUpVia(app, "/?ref=producthunt", undefined, newEmail("ph"));
    const hn = await signUpVia(app, "/", "https://news.ycombinator.com/item?id=1", newEmail("hn"));
    const direct = await signUpVia(app, "/", undefined, newEmail("direct"));

    // Stored, first-touch, on each row.
    const row = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];
    expect(await row(tw.userId)).toMatchObject({ signupSource: "twitter", signupMedium: "social", signupCampaign: "launch" });
    expect(await row(ph.userId)).toMatchObject({ signupSource: "producthunt", signupMedium: "campaign" });
    expect(await row(hn.userId)).toMatchObject({ signupSource: "news.ycombinator.com", signupMedium: "referral" });
    expect(await row(direct.userId)).toMatchObject({ signupSource: "direct", signupMedium: "direct" });
    expect((await row(tw.userId)).signupLandingPath).toContain("utm_source=twitter");

    // And the owner sees it. The owner is whoever PLATFORM_OWNER_EMAIL names —
    // pinned to owner@test.local by the test config.
    // The owner arrives like anyone else — landing page first — so they count
    // as "direct". A registration with no landing page at all (an API call,
    // a script) has no cookie to read and is stored as null: "unknown", which
    // is the truth, and deliberately not folded into "direct".
    const owner = (await signUpVia(app, "/", undefined, "owner@test.local")).agent;
    const summary = await owner.get("/api/admin/analytics/summary?days=7");
    expect(summary.status).toBe(200);
    const bySource = Object.fromEntries(summary.body.signupSources.map((r: any) => [r.source, r]));
    expect(bySource.twitter).toMatchObject({ signups: 1, campaign: "launch", medium: "social" });
    expect(bySource.producthunt.signups).toBe(1);
    expect(bySource["news.ycombinator.com"].signups).toBe(1);
    // "direct" counts the untagged signup and the owner's own.
    expect(bySource.direct.signups).toBe(2);
  });

  it("records a signup with no landing page as unknown, not direct", async () => {
    const app = await getTestApp();
    const bare = await request(app).post("/api/auth/register")
      .send({ email: newEmail("api"), password, firstName: "A", lastName: "B" });
    expect(bare.status).toBe(201);
    const [row] = await db.select().from(users).where(eq(users.id, bare.body.id));
    expect(row.signupSource).toBeNull();
  });

  it("keeps the dashboard away from anyone but the owner", async () => {
    const app = await getTestApp();
    const someone = await signUpVia(app, "/?utm_source=x", undefined, newEmail("nobody"));
    expect((await someone.agent.get("/api/admin/analytics/summary")).status).toBe(404);
  });
});
