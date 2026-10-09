/**
 * Sending a simulation to one person, without putting it on sale.
 *
 * The marketplace had two visibilities and no middle: `listed`, which means the
 * public index, a search and a `/try/:id` page open to strangers — or the
 * author's own secret. Neither is the shape the thing was built to carry. A
 * market written around one real business names its segments, its regions and
 * the competitors already holding share, so publishing it in order to reach one
 * person hands a study of a named company to everybody, its rivals included.
 *
 * So these cover the two halves that make a share link worth having:
 *
 *   - **It reaches.** Someone holding the link can see what they were sent
 *     without an account, and start a playable year with one, paying nothing.
 *   - **It does not leak.** The listing stays out of the index, out of the
 *     public preview, and the market itself never goes to any client. The
 *     author's note about who the link was for stays the author's.
 *
 * And the three ways a link stops working, because a link that cannot be taken
 * back is the reason this is a row in a table rather than a signed token.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import {
  users, projects, companies, companyMembers, simSeasons,
  simulationListings, simulationShareLinks, simulationShareUses, sellerAgreements,
} from "@shared/schema";
import { SELLER_TERMS_VERSION } from "@shared/simulation-market-terms";

afterAll(async () => { await closeTestApp(); });

let n = 0;

async function person(app: any, first: string, opts: { verify?: boolean } = {}) {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.171.${(n % 200) + 20}`;
  const email = `share-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: first });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  if (opts.verify !== false) await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string, email, first };
}

const MARKET = {
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
    { id: "a", name: "Alphavet", posture: "fortress", startingShare: 0.3, quality: 65, brand: 60, service: 55, priceIndex: 1.1, persona: { tagline: "", boss: "", character: "", known: "", knock: "Slow", voice: "" } },
    { id: "b", name: "Betavet", posture: "coaster", startingShare: 0.2, quality: 50, brand: 45, service: 40, priceIndex: 0.9, persona: { tagline: "", boss: "", character: "", known: "", knock: "Dated", voice: "" } },
  ],
};

/** A seller with a draft listing carrying a custom market. Never published. */
async function sellerWithDraft(app: any) {
  const seller = await person(app, "Sella");
  await db.insert(sellerAgreements).values({ userId: seller.id, version: SELLER_TERMS_VERSION } as any);

  const [project] = await db.insert(projects).values({
    ownerId: seller.id, title: `Share co ${++n}`, description: "A business a market was written for.",
    category: "saas", status: "active",
  } as any).returning();
  const [company] = await db.insert(companies).values({
    name: "Clinic Scheduler", slug: `share-cs-${Date.now()}-${n}`,
    projectId: project.id, createdBy: seller.id, createdAt: new Date(),
  } as any).returning();
  await db.insert(companyMembers).values({
    companyId: company.id, userId: seller.id, role: "owner", joinedAt: new Date(),
  });
  const [season] = await db.insert(simSeasons).values({
    nicheId: MARKET.id, name: "Vet rota — one", status: "forming", totalYears: 4,
    companyId: company.id, inviteCode: `SH${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    createdAt: new Date(), scope: "home", botTeams: 0, origin: "nova", cadence: "quarterly",
    customMarket: MARKET,
  } as any).returning();

  const draft = await seller.agent.post("/api/sim-market/listings")
    .send({ fromSeasonId: season.id, title: "Vet rota software" });
  expect(draft.status, `${draft.status}: ${(draft.text ?? "").slice(0, 300)}`).toBe(201);

  return { seller, listingId: draft.body.listing.id as string };
}

describe("a link that sends a simulation to somebody", () => {
  it("lets them see it and play it without an account first, and without paying", async () => {
    const app = await getTestApp();
    const { seller, listingId } = await sellerWithDraft(app);

    const minted = await seller.agent.post(`/api/sim-market/listings/${listingId}/shares`)
      .send({ note: "Fareway Fools", uses: 2 });
    expect(minted.status, `${minted.status}: ${(minted.text ?? "").slice(0, 300)}`).toBe(201);
    const { token, url, usesLeft, state } = minted.body.share;
    expect(state).toBe("open");
    expect(usesLeft).toBe(2);
    expect(url).toBe(`/s/${token}`);

    /*
     * Signed out, which is the state the person it was sent to is in. They get
     * what it is and who wrote it — the questions somebody is entitled to ask
     * before signing up for anything.
     */
    const anonymous = await request(app).get(`/api/sim-market/shares/${token}`);
    expect(anonymous.status).toBe(200);
    expect(anonymous.body.listing.title).toBe("Vet rota software");
    expect(anonymous.body.share.usesLeft).toBe(2);

    /* The market is the product: it reaches no client, signed in or out. */
    expect(anonymous.body.listing.customMarket).toBeUndefined();
    expect(JSON.stringify(anonymous.body)).not.toContain("Alphavet");
    /* And the note is a note to self about who the link was for. */
    expect(JSON.stringify(anonymous.body)).not.toContain("Fareway Fools");

    /* Then they sign in and are dropped straight into a running year. */
    const recipient = await person(app, "Reese");
    const played = await recipient.agent.post(`/api/sim-market/shares/${token}/try`).send({});
    expect(played.status, `${played.status}: ${(played.text ?? "").slice(0, 300)}`).toBe(201);
    expect(played.body.deskPath).toBe(`/simulation/${played.body.ventureId}`);
    expect(played.body.seatSpent, "nothing was spent by anybody").toBe(false);

    /* Recorded against the link, so the author can see it was opened. */
    const [link] = await db.select().from(simulationShareLinks)
      .where(eq(simulationShareLinks.token, token));
    expect(link.usesSpent).toBe(1);
    const uses = await db.select().from(simulationShareUses)
      .where(eq(simulationShareUses.linkId, link.id));
    expect(uses).toHaveLength(1);
    expect(uses[0].claimedBy).toBe(recipient.id);
  }, 60_000);

  it("does not make the listing public", async () => {
    const app = await getTestApp();
    const { seller, listingId } = await sellerWithDraft(app);
    await seller.agent.post(`/api/sim-market/listings/${listingId}/shares`).send({}).expect(201);

    const stranger = await person(app, "Nosy");

    /* Not in the index — that reads `listed` only, and this was never listed. */
    const index = await stranger.agent.get("/api/sim-market/listings?q=Vet%20rota");
    expect(index.status).toBe(200);
    expect(index.body.listings.map((l: any) => l.id)).not.toContain(listingId);

    /* Not on the public page either, which is for listed things. */
    expect((await request(app).get(`/api/sim-market/listings/${listingId}/preview`)).status).toBe(404);

    /* And a stranger without the link cannot reach it by id: a draft is the author's. */
    expect((await stranger.agent.get(`/api/sim-market/listings/${listingId}`)).status).toBe(404);
    /* Nor start one the long way round. */
    expect((await stranger.agent.post(`/api/sim-market/listings/${listingId}/try`).send({})).status).toBe(404);
  });

  it("runs out after the uses it was given", async () => {
    const app = await getTestApp();
    const { seller, listingId } = await sellerWithDraft(app);
    const minted = await seller.agent.post(`/api/sim-market/listings/${listingId}/shares`)
      .send({ uses: 1 }).expect(201);
    const { token } = minted.body.share;

    const first = await person(app, "Firstly");
    expect((await first.agent.post(`/api/sim-market/shares/${token}/try`).send({})).status).toBe(201);

    /*
     * 410 and not 404: "this was yours and is finished" is what makes somebody
     * ask for another link instead of assuming they were sent a bad address.
     */
    const second = await person(app, "Secondly");
    const again = await second.agent.post(`/api/sim-market/shares/${token}/try`).send({});
    expect(again.status).toBe(410);
    expect(again.body.state).toBe("spent");

    /* The page says the same, rather than pretending nothing was ever there. */
    const page = await request(app).get(`/api/sim-market/shares/${token}`);
    expect(page.status).toBe(410);
    expect(page.body.share.state).toBe("spent");
    expect(page.body.listing.title, "still says what it was").toBe("Vet rota software");
  }, 60_000);

  it("can be taken back, and the season already started is left alone", async () => {
    const app = await getTestApp();
    const { seller, listingId } = await sellerWithDraft(app);
    const minted = await seller.agent.post(`/api/sim-market/listings/${listingId}/shares`)
      .send({ uses: 5 }).expect(201);
    const { id: shareId, token } = minted.body.share;

    const early = await person(app, "Early");
    const played = await early.agent.post(`/api/sim-market/shares/${token}/try`).send({});
    expect(played.status).toBe(201);

    const revoked = await seller.agent.post(`/api/sim-market/shares/${shareId}/revoke`).send({});
    expect(revoked.status).toBe(200);
    expect(revoked.body.share.state).toBe("revoked");

    const late = await person(app, "Late");
    const refused = await late.agent.post(`/api/sim-market/shares/${token}/try`).send({});
    expect(refused.status).toBe(410);
    expect(refused.body.state).toBe("revoked");

    /*
     * Revoking a link is not taking a game away from somebody. The season they
     * started is still theirs, and still running.
     */
    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, played.body.seasonId));
    expect(season, "the season outlives the link").toBeTruthy();
  }, 60_000);

  it("stops working when it expires", async () => {
    const app = await getTestApp();
    const { seller, listingId } = await sellerWithDraft(app);
    const minted = await seller.agent.post(`/api/sim-market/listings/${listingId}/shares`)
      .send({ uses: 3, expiresInDays: 7 }).expect(201);
    const { token } = minted.body.share;
    expect(minted.body.share.expiresAt).toBeTruthy();

    /* Wound back rather than waited for. */
    await db.update(simulationShareLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(simulationShareLinks.token, token));

    const late = await person(app, "Tardy");
    const refused = await late.agent.post(`/api/sim-market/shares/${token}/try`).send({});
    expect(refused.status).toBe(410);
    expect(refused.body.state).toBe("expired");
  });

  it("is the author's to mint, and nobody else's", async () => {
    const app = await getTestApp();
    const { listingId } = await sellerWithDraft(app);
    const other = await person(app, "Other");

    /* 404 rather than 403: whose listing this is, is not the asker's business. */
    expect((await other.agent.post(`/api/sim-market/listings/${listingId}/shares`).send({})).status).toBe(404);
  });

  it("cannot be minted by an account that has not confirmed its address", async () => {
    const app = await getTestApp();
    const unconfirmed = await person(app, "Unconfirmed", { verify: false });
    await db.insert(sellerAgreements).values({ userId: unconfirmed.id, version: SELLER_TERMS_VERSION } as any);

    const [listing] = await db.insert(simulationListings).values({
      authorId: unconfirmed.id, title: "Unconfirmed co", nicheId: "dating_apps", status: "draft",
    } as any).returning();

    /*
     * The same gate as publishing. A share link puts the author's words on a
     * page open to anyone holding the URL and works on a draft, so without this
     * it would be the one way to put a listing in front of strangers that is
     * not gated.
     */
    const minted = await unconfirmed.agent.post(`/api/sim-market/listings/${listing.id}/shares`).send({});
    expect(minted.status).toBe(403);
    expect(minted.body.code).toBe("email_unverified");
  });

  it("refuses more uses than one link may carry, rather than quietly capping it", async () => {
    const app = await getTestApp();
    const { seller, listingId } = await sellerWithDraft(app);

    const tooMany = await seller.agent.post(`/api/sim-market/listings/${listingId}/shares`)
      .send({ uses: 5_000 });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.problems[0].field).toBe("uses");
  });

  it("shows the author their links, who opened them, and the token to send", async () => {
    const app = await getTestApp();
    const { seller, listingId } = await sellerWithDraft(app);
    const minted = await seller.agent.post(`/api/sim-market/listings/${listingId}/shares`)
      .send({ note: "For Dana", uses: 2 }).expect(201);

    const opener = await person(app, "Dana");
    expect((await opener.agent.post(`/api/sim-market/shares/${minted.body.share.token}/try`).send({})).status).toBe(201);

    const list = await seller.agent.get(`/api/sim-market/listings/${listingId}/shares`);
    expect(list.status).toBe(200);
    expect(list.body.shares).toHaveLength(1);

    const [share] = list.body.shares;
    expect(share.note, "their own note, back to them").toBe("For Dana");
    expect(share.token, "the token, to the one party who can mint another").toBeTruthy();
    expect(share.usesLeft).toBe(1);
    expect(share.opened).toHaveLength(1);
    expect(share.opened[0].name).toBe("Dana");

    /* And not to anybody else. */
    const other = await person(app, "Other");
    expect((await other.agent.get(`/api/sim-market/listings/${listingId}/shares`)).status).toBe(404);
  }, 60_000);

  it("stops working if the platform bans whoever sent it", async () => {
    const app = await getTestApp();
    const { seller, listingId } = await sellerWithDraft(app);
    const minted = await seller.agent.post(`/api/sim-market/listings/${listingId}/shares`)
      .send({ uses: 5 }).expect(201);
    const { token } = minted.body.share;

    await db.update(users)
      .set({ suspendedAt: new Date(), suspendedReason: "Sent something they shouldn't have" })
      .where(eq(users.id, seller.id));

    /*
     * Nobody paid for this, so nobody is being deprived of a purchase — which
     * is what made the opposite call right for a buyer holding seats on a
     * taken-down listing. The site simply stops handing out a banned account's
     * work.
     */
    const recipient = await person(app, "Recipient");
    const refused = await recipient.agent.post(`/api/sim-market/shares/${token}/try`).send({});
    expect(refused.status).toBe(404);
  }, 60_000);

  it("puts nothing in anybody's earnings, because nothing was sold", async () => {
    const app = await getTestApp();
    const { seller, listingId } = await sellerWithDraft(app);
    const minted = await seller.agent.post(`/api/sim-market/listings/${listingId}/shares`).send({}).expect(201);

    const recipient = await person(app, "Gifted");
    expect((await recipient.agent.post(`/api/sim-market/shares/${minted.body.share.token}/try`).send({})).status).toBe(201);

    /*
     * The reason a share is its own table rather than a zero-priced purchase: a
     * gift recorded as a sale is how an earnings report comes to include sales
     * that never happened.
     */
    const earnings = await seller.agent.get("/api/sim-market/earnings");
    expect(earnings.status).toBe(200);
    expect(JSON.stringify(earnings.body)).not.toContain(listingId);

    const mine = await seller.agent.get("/api/sim-market/me");
    expect(mine.status).toBe(200);
    expect(mine.body.totals.earnedCents).toBe(0);
  }, 60_000);
});
