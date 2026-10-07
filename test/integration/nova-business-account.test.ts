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
import {
  users, userProfiles, sellerAgreements, projects, companies, companyMembers, simSeasons,
} from "@shared/schema";
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

/**
 * The listing path this account actually exists for.
 *
 * The test above lists a built-in niche, which is the easy half. A *custom*
 * market — one written for a particular business, which is what gets sold here —
 * can only be listed from a season the author owns, because the create route
 * fetches the market server-side rather than accepting one from the browser:
 * "a browser that can send a market is a browser that was given one". So the
 * chain is project → company → season → listing, all under this account, and
 * every link is a place the listing can 404 for a reason that looks like
 * something else.
 */
describe("Nova Business listing a market it wrote", () => {
  /** The chain, written straight into the database: this test is about the listing. */
  async function seasonOwnedBy(ownerId: string) {
    const [project] = await db.insert(projects).values({
      ownerId, title: `Nova market ${Date.now()}`,
      description: "A business a custom market was written for.",
      category: "saas", status: "active",
    } as any).returning();

    const [company] = await db.insert(companies).values({
      name: "Clinic Scheduler", slug: `nova-cs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      projectId: project.id, createdBy: ownerId, createdAt: new Date(),
    } as any).returning();
    await db.insert(companyMembers).values({
      companyId: company.id, userId: ownerId, role: "owner", joinedAt: new Date(),
    });

    const market = {
      id: "vet_rota", name: "Vet rota software", premise: "Scheduling for clinics.",
      baseUnitCost: 20, innovationPace: 1,
      voice: {
        customer: "clinic", customers: "clinics", unit: "licence", per: "a month", capacity: "seats",
        place: "region", places: "regions", quality: "polish", brand: "name",
      },
      segments: [
        { id: "single", name: "Single-site", description: "One vet.", size: 9_000, growth: 0.04, priceSensitivity: 0.6, qualityFocus: 0.5, brandFocus: 0.3, serviceFocus: 0.7, loyalty: 0.4, referencePrice: 90 },
        { id: "groups", name: "Groups", description: "Five sites.", size: 3_000, growth: 0.07, priceSensitivity: 0.4, qualityFocus: 0.7, brandFocus: 0.5, serviceFocus: 0.6, loyalty: 0.6, referencePrice: 220 },
      ],
      cities: [
        { id: "n", name: "North", weight: 0.4, entryCost: 14_000, note: "" },
        { id: "s", name: "South", weight: 0.35, entryCost: 16_000, note: "" },
        { id: "e", name: "East", weight: 0.25, entryCost: 11_000, note: "" },
      ],
      incumbents: [
        { id: "a", name: "Alpha", posture: "fortress", startingShare: 0.3, quality: 65, brand: 60, service: 55, priceIndex: 1.1, persona: { tagline: "", boss: "", character: "", known: "", knock: "Slow", voice: "" } },
        { id: "b", name: "Beta", posture: "coaster", startingShare: 0.2, quality: 50, brand: 45, service: 40, priceIndex: 0.9, persona: { tagline: "", boss: "", character: "", known: "", knock: "Dated", voice: "" } },
      ],
    };

    const [season] = await db.insert(simSeasons).values({
      nicheId: market.id, name: "Vet rota — season one", status: "forming",
      totalYears: 4, companyId: company.id,
      inviteCode: `NB${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      createdAt: new Date(), scope: "home", botTeams: 0, origin: "nova", cadence: "quarterly",
      customMarket: market,
    } as any).returning();

    return { project, season, market };
  }

  it("lists a custom market from its own season, and sells it per seat", async () => {
    const app = await getTestApp();
    const { id, email } = await seedNovaBusiness({ password: PASSWORD });
    const { season, market } = await seasonOwnedBy(id);

    const agent = request.agent(app);
    expect((await agent.post("/api/auth/login").set("x-forwarded-for", "198.51.151.15")
      .send({ email, password: PASSWORD })).status).toBe(200);

    const draft = await agent.post("/api/sim-market/listings")
      .send({ fromSeasonId: season.id, title: "Vet rota software" });
    expect(draft.status, `${draft.status}: ${(draft.text ?? "").slice(0, 300)}`).toBe(201);

    const published = await agent.post(`/api/sim-market/listings/${draft.body.listing.id}/publish`).send({
      title: "Vet rota software",
      summary: "Two incumbents hold the region and neither of them is any good at groups.",
      pricing: "perSeat",
      seatPriceCents: 500,
    });
    expect(published.status, `${published.status}: ${(published.text ?? "").slice(0, 300)}`).toBe(200);
    expect(published.body.listing.status).toBe("listed");
    expect(published.body.listing.seatPriceCents).toBe(500);

    /*
     * The market itself never leaves the server, signed in or not, because the
     * market is the product. Worth asserting on the author's own reply: this is
     * the one request where sending it would look harmless.
     */
    expect(published.body.listing.customMarket, "the market is not shipped to any client").toBeUndefined();
    expect(JSON.stringify(published.body)).not.toContain(market.incumbents[0].name);
  }, 60_000);

  it("will not list a market belonging to somebody else's project", async () => {
    const app = await getTestApp();
    const { email } = await seedNovaBusiness({ password: PASSWORD });

    /* A season under a different owner entirely. */
    const [stranger] = await db.insert(users).values({
      email: `nova-stranger-${Date.now()}@example.test`, firstName: "Stranger",
    } as any).returning();
    const { season } = await seasonOwnedBy(stranger.id);

    const agent = request.agent(app);
    expect((await agent.post("/api/auth/login").set("x-forwarded-for", "198.51.151.16")
      .send({ email, password: PASSWORD })).status).toBe(200);

    const draft = await agent.post("/api/sim-market/listings").send({ fromSeasonId: season.id });
    /* 404 rather than 403: whose season this is, is not the asker's business. */
    expect(draft.status).toBe(404);
  });
});
