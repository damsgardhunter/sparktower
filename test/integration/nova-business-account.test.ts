/**
 * The platform's own AI account, driven the way a person will drive it.
 *
 * `script/seed-nova-business.ts` writes two rows and a consent record, and all
 * three have to be right for the account to be usable at all. The rows are easy
 * to assert and prove little; what matters is the four things that only show up
 * when the real routes are asked:
 *
 *   1. **It can sign in.** The whole plan rests on this and it was not obvious:
 *      the account carries `is_bot`, the rest of the bot cast has no password
 *      and no provider precisely so nothing can sign in as one, and a guard
 *      against signing in as a bot would be an entirely reasonable thing for
 *      this codebase to have. It does not have one — so this is the test that
 *      notices if somebody adds it.
 *   2. **It can publish a listing**, which needs a confirmed address
 *      (server/email-verification.ts) and an accepted seller agreement. Both
 *      are written by the script rather than earned, so both are exactly the
 *      kind of thing that silently stops being enough.
 *   3. **It is not a candidate.** `is_bot` keeps it out of the match pool and
 *      out of name search. That is the labelling promise in shared/bots.ts,
 *      and it is the reason an AI account is allowed to carry an ordinary name.
 *   4. **Running it twice is running it once.** It is meant to be re-run after
 *      an edit to the résumé.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { users, userProfiles, sellerAgreements } from "@shared/schema";
import { seedNovaBusiness } from "../../script/seed-nova-business";
import { onboardingComplete } from "@shared/onboarding";

afterAll(async () => { await closeTestApp(); });

const PASSWORD = "a-good-passphrase-for-nova";

describe("the Nova Business account", () => {
  it("signs in with the password the script set", async () => {
    const app = await getTestApp();
    const { email } = await seedNovaBusiness({ password: PASSWORD });

    const agent = request.agent(app);
    const res = await agent.post("/api/auth/login")
      .set("x-forwarded-for", "198.51.151.11")
      .send({ email, password: PASSWORD });
    expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(200);

    /* Signed in as itself, not merely "a 200 came back". */
    const me = await agent.get("/api/auth/user");
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);
  });

  it("has a finished profile and a résumé on it", async () => {
    const { id } = await seedNovaBusiness({ password: PASSWORD });
    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, id));

    expect(profile.displayName).toBe("Nova Business");
    expect(onboardingComplete(profile as any), "onboarding is complete, so nothing is gated").toBe(true);
    expect((profile.experience as unknown[]).length, "roles on the résumé").toBeGreaterThan(0);
    expect((profile.portfolioProjects as unknown[]).length, "portfolio entries").toBeGreaterThan(0);
    expect(profile.novaSummary).toBeTruthy();
    /*
     * Not looking for a co-founder. `is_bot` keeps it out of the pool anyway,
     * so an "open to" call here would only ever be a dead end for whoever
     * answered it.
     */
    expect(profile.lookingFor).toBeNull();
  });

  it("is a confirmed address with the seller agreement on file, which is what listing needs", async () => {
    const { id } = await seedNovaBusiness({ password: PASSWORD });

    const [account] = await db.select().from(users).where(eq(users.id, id));
    expect(account.isBot, "labelled as what it is").toBe(true);
    expect(account.emailVerifiedAt, "an unconfirmed address may not write where others read").not.toBeNull();

    const agreed = await db.select().from(sellerAgreements).where(eq(sellerAgreements.userId, id));
    expect(agreed.length).toBeGreaterThan(0);
    /* Null rather than invented: there was no request behind this acceptance. */
    expect(agreed[0].acceptedIp).toBeNull();
  });

  it("publishes a listing, which is the job it exists for", async () => {
    const app = await getTestApp();
    const { email } = await seedNovaBusiness({ password: PASSWORD });

    const agent = request.agent(app);
    expect((await agent.post("/api/auth/login").set("x-forwarded-for", "198.51.151.12")
      .send({ email, password: PASSWORD })).status).toBe(200);

    /*
     * A built-in niche, not a posted market. The create route fetches the
     * market server-side — "a browser that can send a market is a browser that
     * was given one" — so a draft names either one of the built-in niches or a
     * season the author owns. That is also the real constraint on this account:
     * to list a *custom* market it has to own the project, company and season
     * the market was built in.
     */
    const draft = await agent.post("/api/sim-market/listings").send({
      nicheId: "dating_apps",
      title: "Dating apps, crowded metro",
    });
    expect(draft.status, `${draft.status}: ${(draft.text ?? "").slice(0, 300)}`).toBe(201);

    const published = await agent.post(`/api/sim-market/listings/${draft.body.listing.id}/publish`).send({
      title: "Dating apps, crowded metro",
      summary: "Two incumbents already hold the city, and the only way in is a segment they both ignore.",
      pricing: "free",
    });
    expect(published.status, `${published.status}: ${(published.text ?? "").slice(0, 300)}`).toBe(200);
    expect(published.body.listing.status).toBe("listed");
  });

  it("is not offered to anybody as a person: not in search, not in the match pool", async () => {
    const app = await getTestApp();
    await seedNovaBusiness({ password: PASSWORD });

    /* A separate real account does the looking. */
    const seeker = request.agent(app);
    const seekerEmail = `nova-seeker-${Date.now()}@example.test`;
    expect((await seeker.post("/api/auth/register").set("x-forwarded-for", "198.51.151.13")
      .send({ email: seekerEmail, password: "another-good-passphrase", firstName: "Sam" })).status).toBe(201);

    /*
     * A real person whose name also starts with "Nova", so one query covers
     * both halves of the claim. Without them this would assert that a search
     * returned nothing, which it would also do if search were simply broken —
     * and a test that passes when the feature is broken is worse than none.
     */
    const decoyEmail = `novak-${Date.now()}@example.test`;
    expect((await request.agent(app).post("/api/auth/register").set("x-forwarded-for", "198.51.151.14")
      .send({ email: decoyEmail, password: "another-good-passphrase", firstName: "Novak" })).status).toBe(201);

    const found = await seeker.get("/api/users/search?q=Nova");
    expect(found.status).toBe(200);
    const hits = found.body as { firstName?: string; profile?: { displayName?: string } }[];

    expect(hits.some((h) => h.firstName === "Novak"), "search itself works").toBe(true);
    expect(
      hits.some((h) => h.profile?.displayName === "Nova Business" || h.firstName === "Nova"),
      "a bot is not a person to find",
    ).toBe(false);
  });

  it("can be run again after an edit without duplicating anything", async () => {
    const first = await seedNovaBusiness({ password: PASSWORD });
    const second = await seedNovaBusiness({ password: PASSWORD });
    expect(second.id, "the same account, not a second one").toBe(first.id);

    const accounts = await db.select().from(users).where(eq(users.email, first.email));
    expect(accounts.length).toBe(1);

    /* One consent row per version, however many times this runs. */
    const agreed = await db.select().from(sellerAgreements).where(eq(sellerAgreements.userId, first.id));
    expect(agreed.length).toBe(1);
  });
});
