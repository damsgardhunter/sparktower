/**
 * Selling a simulation to a stranger, and the money that moves when you do.
 *
 * The parts that have to be right every time and are invisible when they are
 * not: that a draft promises nothing, that nobody sells without having agreed
 * to the terms in force, that the author is not paid until the buyer's window
 * has closed, and that a refund comes out of money nobody has spent.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { simulationListings, simulationPurchases, simSeasons, simVentures, companies, projects, contentReports } from "@shared/schema";
import { eq } from "drizzle-orm";
import { walletOf } from "../../server/wallet";
import { releaseDueEarnings } from "../../server/simulation-market-compliance";
import { SELLER_TERMS_VERSION, REFUND_WINDOW_DAYS } from "@shared/simulation-market-terms";
import { PLATFORM_SHARE_PERCENT, splitSale } from "@shared/simulation-market";
import { REPORT_REASON_DETAILS } from "@shared/moderation";
import { NICHES } from "@shared/simulation/niches";

afterAll(async () => { await closeTestApp(); });

let address = 10;
async function signUp(app: any, name: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `203.0.119.${address++}`)
    .send({ email: `sim-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`, password: "Testpass123!", firstName: name });
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBeLessThan(300);
  await verifyEmail(app, res.body.email, `203.0.120.${address++}`);
  const me = await agent.get("/api/auth/user");
  return { agent, id: me.body.id as string };
}

/**
 * A market the engine will accept, built from a catalogue one.
 *
 * Hand-rolling a market for a fixture means hand-rolling something
 * `buildCustomMarket` will refuse — it wants regions, a workforce and a voice
 * as well as segments and rivals, and a fixture that fails validation tests the
 * validator rather than the marketplace. Renamed so nothing here depends on
 * which catalogue market happens to be first.
 */
const MARKET = {
  ...JSON.parse(JSON.stringify(NICHES[0])),
  id: "veterinary-scheduling",
  name: "Veterinary scheduling",
  premise: "Practices book by phone and lose a fifth of their slots to no-shows.",
};

/**
 * A market this person owns, the way the product makes one.
 *
 * A listing can only be made from a season the author's own project produced,
 * and the ownership path is season → company → project → owner. Building the
 * fixture that way rather than posting a market is the point: the browser
 * never handles one, so a test that posts a market is testing a route that no
 * longer exists.
 */
async function ownedMarket(userId: string, title = "Veterinary scheduling") {
  const [project] = await db.insert(projects).values({
    title, description: "Scheduling for veterinary practices.",
    ownerId: userId, category: "saas", goal: "ship_mvp", subcategory: "saas",
  }).returning();
  const [company] = await db.insert(companies).values({
    name: title, slug: `${title.toLowerCase().replace(/\W+/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    /* Ownership runs through the project, not the company — see the sources query. */
    /* `created_at` has no default on this table, so a fixture must set it. */
    projectId: project.id, createdBy: userId, createdAt: new Date(),
  }).returning();
  const [season] = await db.insert(simSeasons).values({
    nicheId: MARKET.id, name: title, companyId: company.id,
    customMarket: MARKET, origin: "nova", cadence: "yearly", botSkill: "survivor",
  }).returning();
  return { projectId: project.id, seasonId: season.id };
}

const draft = async (agent: any, userId: string, over: Record<string, unknown> = {}) => {
  const { seasonId } = await ownedMarket(userId);
  return agent.post("/api/sim-market/listings").send({ fromSeasonId: seasonId, ...over });
};

const acceptTerms = (agent: any) =>
  agent.post("/api/sim-market/seller-terms").send({ version: SELLER_TERMS_VERSION });

describe("listing a simulation", () => {
  it("drafts privately, and a draft promises nothing", async () => {
    const app = await getTestApp();
    const { agent, id } = await signUp(app, "Author");
    const made = await draft(agent, id);
    expect(made.status, JSON.stringify(made.body).slice(0, 300)).toBe(201);
    expect(made.body.listing.status).toBe("draft");

    /* Not on the marketplace, and not visible to anybody else. */
    const { agent: stranger } = await signUp(app, "Stranger");
    const browse = await stranger.get("/api/sim-market/listings");
    expect(browse.body.listings.map((l: any) => l.id)).not.toContain(made.body.listing.id);
    expect((await stranger.get(`/api/sim-market/listings/${made.body.listing.id}`)).status).toBe(404);
  });

  it("will not publish without the seller agreement in force", async () => {
    const app = await getTestApp();
    const { agent, id } = await signUp(app, "Unsigned");
    const made = await draft(agent, id);
    const published = await agent.post(`/api/sim-market/listings/${made.body.listing.id}/publish`)
      .send({ title: "Veterinary scheduling", summary: "Two incumbents hold most of it and the way in is narrow.", pricing: "free" });
    expect(published.status, "published without agreeing to anything").toBe(428);
    expect(published.body.needsTerms).toBe(SELLER_TERMS_VERSION);
  });

  it("refuses an acceptance of terms the browser never showed", async () => {
    /*
     * A consent record must never be able to say somebody agreed to text they
     * were not given. A stale tab holding version 1 cannot accept version 2.
     */
    const app = await getTestApp();
    const { agent } = await signUp(app, "Stale");
    const stale = await agent.post("/api/sim-market/seller-terms").send({ version: SELLER_TERMS_VERSION - 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.version).toBe(SELLER_TERMS_VERSION);
  });

  it("publishes once the agreement is accepted, and appears on the marketplace", async () => {
    const app = await getTestApp();
    const { agent, id } = await signUp(app, "Seller");
    await acceptTerms(agent);
    const made = await draft(agent, id);
    const published = await agent.post(`/api/sim-market/listings/${made.body.listing.id}/publish`)
      .send({ title: "Veterinary scheduling", summary: "Two incumbents hold most of it and the way in is narrow.", pricing: "perSeat", seatPriceCents: 300 });
    expect(published.status, JSON.stringify(published.body).slice(0, 300)).toBe(200);

    const { agent: browser } = await signUp(app, "Browser");
    const list = await browser.get("/api/sim-market/listings");
    expect(list.body.listings.map((l: any) => l.id)).toContain(made.body.listing.id);
    /* And the rules come from the server, so no screen invents a price range. */
    expect(list.body.rules.platformSharePercent).toBe(PLATFORM_SHARE_PERCENT);
  });

  it("never sends the market itself to a browser", async () => {
    /*
     * The market is the product. Anything that can read it can copy a paid
     * listing and publish it as its own.
     */
    const app = await getTestApp();
    const { agent, id } = await signUp(app, "Guarded");
    await acceptTerms(agent);
    const made = await draft(agent, id);
    await agent.post(`/api/sim-market/listings/${made.body.listing.id}/publish`)
      .send({ title: "Veterinary scheduling", summary: "Two incumbents hold most of it and the way in is narrow.", pricing: "free" });

    const { agent: buyer } = await signUp(app, "Peeker");
    const page = await buyer.get(`/api/sim-market/listings/${made.body.listing.id}`);
    /* A rival's name only exists inside the market, so finding one means it leaked. */
    const rival = (MARKET.incumbents as any[])[0].name;
    expect(JSON.stringify(page.body), `${rival} leaked out of the market`).not.toContain(rival);
    expect(page.body.listing.customMarket).toBeUndefined();
  });
});

describe("buying seats", () => {
  async function listed(app: any, priceCents = 300) {
    const { agent, id } = await signUp(app, "Vendor");
    await acceptTerms(agent);
    const made = await draft(agent, id);
    await agent.post(`/api/sim-market/listings/${made.body.listing.id}/publish`).send({
      title: "Veterinary scheduling",
      summary: "Two incumbents hold most of it and the way in is narrow.",
      pricing: priceCents > 0 ? "perSeat" : "free",
      seatPriceCents: priceCents,
    });
    return { sellerAgent: agent, sellerId: id, listingId: made.body.listing.id as string };
  }

  it("charges seats × price and records both sides of the split", async () => {
    const app = await getTestApp();
    const { listingId, sellerId } = await listed(app, 300);
    const { agent: buyer, id: buyerId } = await signUp(app, "Buyer");
    await buyer.post("/api/dev/credit-wallet").send({ amountCents: 5000 });

    const before = (await walletOf(buyerId)).balanceCents;
    const bought = await buyer.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 6 });
    expect(bought.status, JSON.stringify(bought.body).slice(0, 200)).toBe(201);
    expect((await walletOf(buyerId)).balanceCents).toBe(before - 1800);

    const [row] = await db.select().from(simulationPurchases).where(eq(simulationPurchases.id, bought.body.purchase.id));
    const split = splitSale(1800);
    expect(row.sellerCents).toBe(split.sellerCents);
    expect(row.platformCents).toBe(split.platformCents);
    expect(row.sellerCents + row.platformCents, "the split must account for every penny").toBe(1800);
    expect(row.sellerId).toBe(sellerId);
  });

  it("does not pay the author until the buyer's window has closed", async () => {
    /*
     * The flaw this is here for: crediting at the moment of sale is money
     * already gone when the refund arrives, and the platform then either takes
     * it back out of an empty balance or absorbs it.
     */
    const app = await getTestApp();
    const { listingId, sellerId } = await listed(app, 300);
    const { agent: buyer } = await signUp(app, "Early");
    await buyer.post("/api/dev/credit-wallet").send({ amountCents: 5000 });

    const sellerBefore = (await walletOf(sellerId)).balanceCents;
    await buyer.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 2 });
    expect((await walletOf(sellerId)).balanceCents, "the author was paid immediately").toBe(sellerBefore);

    /* And the sweep leaves it alone while it is still held. */
    await releaseDueEarnings();
    expect((await walletOf(sellerId)).balanceCents).toBe(sellerBefore);
  });

  it("pays the author once the hold has passed, and only once", async () => {
    const app = await getTestApp();
    const { listingId, sellerId } = await listed(app, 300);
    const { agent: buyer } = await signUp(app, "Patient");
    await buyer.post("/api/dev/credit-wallet").send({ amountCents: 5000 });
    const bought = await buyer.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 2 });

    /* Wind the hold back rather than waiting a fortnight. */
    await db.update(simulationPurchases)
      .set({ releasableAt: new Date(Date.now() - 1000) })
      .where(eq(simulationPurchases.id, bought.body.purchase.id));

    const before = (await walletOf(sellerId)).balanceCents;
    await releaseDueEarnings();
    const paid = (await walletOf(sellerId)).balanceCents;
    expect(paid).toBe(before + splitSale(600).sellerCents);

    /* A second sweep, or two instances racing, must not pay twice. */
    await releaseDueEarnings();
    expect((await walletOf(sellerId)).balanceCents).toBe(paid);
  });

  it("takes nothing for a free listing but still records the play", async () => {
    const app = await getTestApp();
    const { listingId } = await listed(app, 0);
    const { agent: buyer, id: buyerId } = await signUp(app, "Free");
    const before = (await walletOf(buyerId)).balanceCents;
    const got = await buyer.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 4 });
    expect(got.status).toBe(201);
    expect((await walletOf(buyerId)).balanceCents).toBe(before);

    const [listing] = await db.select().from(simulationListings).where(eq(simulationListings.id, listingId));
    expect(listing.seatsSold, "a free play still counts as a play").toBe(4);
  });

  it("refuses when the money is not there, and takes nothing", async () => {
    const app = await getTestApp();
    const { listingId } = await listed(app, 5000);
    const { agent: buyer, id: buyerId } = await signUp(app, "Broke");
    await buyer.post("/api/dev/credit-wallet").send({ amountCents: 100 });
    const before = (await walletOf(buyerId)).balanceCents;

    const refused = await buyer.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 10 });
    expect(refused.status).toBe(402);
    expect((await walletOf(buyerId)).balanceCents).toBe(before);
    expect(await db.select().from(simulationPurchases).where(eq(simulationPurchases.listingId, listingId))).toHaveLength(0);
  });
});

describe("starting a season", () => {
  async function listed(app: any, priceCents = 300) {
    const { agent, id } = await signUp(app, "Writer");
    await acceptTerms(agent);
    const made = await draft(agent, id);
    await agent.post(`/api/sim-market/listings/${made.body.listing.id}/publish`).send({
      title: "Veterinary scheduling",
      summary: "Two incumbents hold most of it and the way in is narrow.",
      pricing: priceCents > 0 ? "perSeat" : "free",
      seatPriceCents: priceCents,
    });
    return { authorAgent: agent, authorId: id, listingId: made.body.listing.id as string };
  }

  it("spends a seat and hands back a join code", async () => {
    const app = await getTestApp();
    const { listingId } = await listed(app, 300);
    const { agent: buyer } = await signUp(app, "Host");
    await buyer.post("/api/dev/credit-wallet").send({ amountCents: 5000 });
    const bought = await buyer.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 2 });

    const started = await buyer.post(`/api/sim-market/listings/${listingId}/play`).send({ name: "Northbound" });
    expect(started.status, JSON.stringify(started.body).slice(0, 300)).toBe(201);
    expect(started.body.inviteCode).toBeTruthy();
    expect(started.body.seatSpent).toBe(true);

    const [row] = await db.select().from(simulationPurchases).where(eq(simulationPurchases.id, bought.body.purchase.id));
    expect(row.seatsLeft, "a season was started and no seat was spent").toBe(1);
  });

  it("counts the play on the listing, which is what a card shows", async () => {
    const app = await getTestApp();
    const { listingId } = await listed(app, 0);
    const { agent: buyer } = await signUp(app, "Player");
    await buyer.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 1 });
    await buyer.post(`/api/sim-market/listings/${listingId}/play`).send({});

    const [listing] = await db.select().from(simulationListings).where(eq(simulationListings.id, listingId));
    expect(listing.seasonsStarted).toBe(1);
  });

  it("refuses when there are no seats left", async () => {
    const app = await getTestApp();
    const { listingId } = await listed(app, 300);
    const { agent: buyer } = await signUp(app, "Spent");
    await buyer.post("/api/dev/credit-wallet").send({ amountCents: 5000 });
    await buyer.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 1 });
    await buyer.post(`/api/sim-market/listings/${listingId}/play`).send({});

    const refused = await buyer.post(`/api/sim-market/listings/${listingId}/play`).send({});
    expect(refused.status).toBe(402);
  });

  it("lets the author play their own without owning seats", async () => {
    /* Making them buy from themselves would take a cut of a sale that did not happen. */
    const app = await getTestApp();
    const { authorAgent, listingId } = await listed(app, 300);
    const started = await authorAgent.post(`/api/sim-market/listings/${listingId}/play`).send({});
    expect(started.status).toBe(201);
    expect(started.body.seatSpent).toBe(false);
  });

  it("closes the refund window for the seat it spent", async () => {
    /*
     * Spending the seat and ending its refund right are the same act: the
     * thing bought has been delivered. A buyer who played everything is owed
     * nothing; one who played some is owed for the rest.
     */
    const app = await getTestApp();
    const { listingId } = await listed(app, 300);
    const { agent: buyer, id: buyerId } = await signUp(app, "Partly");
    await buyer.post("/api/dev/credit-wallet").send({ amountCents: 5000 });
    const bought = await buyer.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 2 });
    await buyer.post(`/api/sim-market/listings/${listingId}/play`).send({});

    const before = (await walletOf(buyerId)).balanceCents;
    const refunded = await buyer.post(`/api/sim-market/purchases/${bought.body.purchase.id}/refund`).send({});
    expect(refunded.status).toBe(200);
    expect(refunded.body.seats, "only the unplayed seat is refundable").toBe(1);
    expect((await walletOf(buyerId)).balanceCents).toBe(before + 300);
  });
});

describe("getting back to what you bought", () => {
  /*
   * The gap this covers was the marketplace's worst: pressing play spent a
   * seat, created a season and returned its join link exactly once. Close the
   * tab before following it and the season was gone — starting a season does
   * not seat you in it, so `/api/sim/ventures` could not see it, and the
   * listing counted `seasonsStarted` without recording which ones. Somebody
   * paid, lost a seat, and had nothing.
   */
  async function soldAndStarted(app: any, priceCents = 300) {
    const { agent: authorAgent, id: authorId } = await signUp(app, "Seller");
    await acceptTerms(authorAgent);
    const made = await draft(authorAgent, authorId);
    const listingId = made.body.listing.id as string;
    await authorAgent.post(`/api/sim-market/listings/${listingId}/publish`).send({
      title: "Veterinary scheduling",
      summary: "Two incumbents hold most of it and the way in is narrow.",
      pricing: priceCents > 0 ? "perSeat" : "free",
      seatPriceCents: priceCents,
    });

    const { agent: buyer, id: buyerId } = await signUp(app, "Buyer");
    if (priceCents > 0) await buyer.post("/api/dev/credit-wallet").send({ amountCents: 5000 });
    const bought = await buyer.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 3 });
    expect(bought.status, JSON.stringify(bought.body).slice(0, 200)).toBe(201);

    const started = await buyer.post(`/api/sim-market/listings/${listingId}/play`).send({ name: "Northbound" });
    expect(started.status, JSON.stringify(started.body).slice(0, 300)).toBe(201);
    return { buyer, buyerId, authorAgent, listingId, purchaseId: bought.body.purchase.id as string, started };
  }

  it("lists the season on the purchase, so closing the tab costs nothing", async () => {
    const app = await getTestApp();
    const { buyer, listingId, purchaseId, started } = await soldAndStarted(app);

    const mine = await buyer.get("/api/sim-market/me");
    expect(mine.status).toBe(200);
    const purchase = mine.body.purchases.find((p: any) => p.id === purchaseId);
    expect(purchase, "the purchase is not in the buyer's own list").toBeTruthy();
    expect(purchase.seasons, "a season was started and the purchase does not know about it").toHaveLength(1);
    expect(purchase.seasons[0].seasonId).toBe(started.body.seasonId);
    expect(purchase.seasons[0].listingId).toBe(listingId);
  });

  it("carries the join link, which was the one thing the response gave away for good", async () => {
    const app = await getTestApp();
    const { buyer, started } = await soldAndStarted(app);

    const mine = await buyer.get("/api/sim-market/me");
    const [season] = mine.body.purchases.flatMap((p: any) => p.seasons);
    expect(season.joinUrl, "no way back into the season").toBeTruthy();
    expect(season.joinUrl).toBe(started.body.joinUrl);
    expect(season.inviteCode).toBe(started.body.inviteCode);
  });

  it("says what the season is and how far through it is", async () => {
    /* A list of names with no progress on it is a list of identical rows. */
    const app = await getTestApp();
    const { buyer } = await soldAndStarted(app);

    const mine = await buyer.get("/api/sim-market/me");
    const [season] = mine.body.purchases.flatMap((p: any) => p.seasons);
    expect(season.name).toBe("Northbound");
    expect(season.status).toBe("forming");
    expect(season.year).toBe(1);
    expect(season.totalYears).toBeGreaterThan(1);
  });

  it("counts the games there are to go back to", async () => {
    const app = await getTestApp();
    const { buyer } = await soldAndStarted(app);

    const mine = await buyer.get("/api/sim-market/me");
    expect(mine.body.totals.running).toBe(1);
    expect(mine.body.totals.seatsLeft, "three bought, one played").toBe(2);
  });

  it("offers the listing page the season before it offers another seat", async () => {
    const app = await getTestApp();
    const { buyer, listingId, started } = await soldAndStarted(app);

    const page = await buyer.get(`/api/sim-market/listings/${listingId}`);
    expect(page.status).toBe(200);
    expect(page.body.youOwn.seasons, "the detail page cannot see the season you are in").toHaveLength(1);
    expect(page.body.youOwn.seasons[0].seasonId).toBe(started.body.seasonId);
    expect(page.body.youOwn.seats).toBe(2);
  });

  it("keeps the author's own seasons too, which cost no seat", async () => {
    const app = await getTestApp();
    const { authorAgent, listingId } = await soldAndStarted(app);
    const started = await authorAgent.post(`/api/sim-market/listings/${listingId}/play`).send({ name: "My own run" });
    expect(started.status).toBe(201);

    const mine = await authorAgent.get("/api/sim-market/me");
    const listing = mine.body.listings.find((l: any) => l.id === listingId);
    expect(listing.seasons, "the author's own run is not recorded against the listing").toHaveLength(1);
    expect(listing.seasons[0].purchaseId, "the author bought nothing, so there is no purchase").toBeNull();
    expect(mine.body.totals.running).toBe(1);
  });

  it("shows one buyer nothing of another buyer's seasons", async () => {
    const app = await getTestApp();
    const { listingId } = await soldAndStarted(app, 0);
    const { agent: other } = await signUp(app, "Other");
    await other.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 1 });

    const page = await other.get(`/api/sim-market/listings/${listingId}`);
    expect(page.body.youOwn.seasons, "somebody else's season is showing on this page").toHaveLength(0);
    const mine = await other.get("/api/sim-market/me");
    expect(mine.body.totals.running).toBe(0);
  });

  it("saves the other chairs when the season is started for a team", async () => {
    /*
     * Nova fills a waiting room a minute after it opens, which is right for
     * one person playing alone and wrong for a table: a buyer who took seats
     * for their team and started first would come back to find Nova playing
     * three of them.
     */
    const app = await getTestApp();
    const { buyer, listingId } = await soldAndStarted(app, 0);
    const team = await buyer.post(`/api/sim-market/listings/${listingId}/play`).send({ withTeam: true });
    expect(team.status).toBe(201);

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, team.body.seasonId));
    expect(season.botFill, "Nova will take the seats this buyer paid to save").toBe(false);
  });

  it("fills the room for somebody playing on their own", async () => {
    const app = await getTestApp();
    const { started } = await soldAndStarted(app, 0);
    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, started.body.seasonId));
    expect(season.botFill, "one person who pressed play is owed a game, not a lobby").toBe(true);
  });
});

describe("what a stranger with the link can see", () => {
  /*
   * The page at `/try/:id` renders before there is an account, so its read has
   * to answer to a client with no session at all — not an agent that happens
   * to be signed out, a bare request. If this needs a cookie then the link
   * asks for the signup before it says what it is offering, which is the
   * friction the whole flow exists to remove.
   */
  async function published(app: any) {
    const { agent, id } = await signUp(app, "Author");
    await acceptTerms(agent);
    const made = await draft(agent, id);
    const listingId = made.body.listing.id as string;
    await agent.post(`/api/sim-market/listings/${listingId}/publish`).send({
      title: "Veterinary scheduling",
      summary: "Two incumbents hold most of it and the way in is narrow.",
      pricing: "free",
    });
    return { listingId, agent, authorId: id };
  }

  it("reads the listing with no session", async () => {
    const app = await getTestApp();
    const { listingId } = await published(app);

    /* `request(app)` rather than an agent: no cookie jar, nothing to send. */
    const seen = await request(app).get(`/api/sim-market/listings/${listingId}/preview`);
    expect(seen.status, `a stranger gets ${seen.status}: ${JSON.stringify(seen.body).slice(0, 160)}`).toBe(200);
    expect(seen.body.listing.title).toBe("Veterinary scheduling");
    expect(seen.body.listing.totalYears).toBeGreaterThan(0);
  });

  it("still never hands over the market itself", async () => {
    /*
     * The market is the product. Being public must not make it cheaper to
     * steal.
     *
     * Asserted on the shape rather than by searching the JSON for words. The
     * first version grepped for "incumbents" and failed on the listing's own
     * description — `writeListingCopy` writes "Share held by incumbents: 65%"
     * into prose a buyer is meant to read. A substring cannot tell a leak from
     * a sentence about one.
     */
    const app = await getTestApp();
    const { listingId } = await published(app);
    const seen = await request(app).get(`/api/sim-market/listings/${listingId}/preview`);
    expect(seen.status).toBe(200);
    expect(seen.body.listing.customMarket, "the market itself came back").toBeUndefined();
    expect(seen.body.listing.segments).toBeUndefined();
    expect(seen.body.listing.incumbents).toBeUndefined();
    expect(seen.body.listing.nicheId).toBeUndefined();
    /* Nor anywhere else in the envelope: only the listing and the two known keys. */
    expect(Object.keys(seen.body).sort()).toEqual(["isAuthor", "listing", "youOwn"]);
  });

  it("shows a stranger nothing of a draft, including its author", async () => {
    const app = await getTestApp();
    const { agent, authorId } = await published(app);
    const second = await draft(agent, authorId);

    const seen = await request(app).get(`/api/sim-market/listings/${second.body.listing.id}/preview`);
    expect(seen.status, "an unpublished draft is readable by anybody with the id").toBe(404);
  });

  it("tells them nothing about anybody's purchases", async () => {
    const app = await getTestApp();
    const { listingId } = await published(app);
    const seen = await request(app).get(`/api/sim-market/listings/${listingId}/preview`);
    expect(seen.body.youOwn).toEqual({ seats: 0, purchases: 0, seasons: [] });
    expect(seen.body.isAuthor).toBe(false);
  });

  it("refuses to start one without an account", async () => {
    /* Reading is public; playing is not — a season belongs to somebody. */
    const app = await getTestApp();
    const { listingId } = await published(app);
    const tried = await request(app).post(`/api/sim-market/listings/${listingId}/try`).send({});
    expect(tried.status).toBeGreaterThanOrEqual(400);
  });
});

describe("one tap into a playable year", () => {
  /*
   * The experience this is for: a link sent to one person who is thinking
   * about starting a business. No waiting room, no seat to claim, no company
   * to name, no colleagues. They open it and they are in year one.
   */
  async function listed(app: any, pricing: "free" | "perSeat" = "free") {
    const { agent, id } = await signUp(app, "Sender");
    await acceptTerms(agent);
    const made = await draft(agent, id);
    const listingId = made.body.listing.id as string;
    const published = await agent.post(`/api/sim-market/listings/${listingId}/publish`).send({
      title: "Veterinary scheduling",
      summary: "Two incumbents hold most of it and the way in is narrow.",
      pricing,
      ...(pricing === "perSeat" ? { seatPriceCents: 300 } : {}),
    });
    expect(published.status, JSON.stringify(published.body).slice(0, 200)).toBe(200);
    return { authorAgent: agent, listingId };
  }

  it("seats them and starts the year in one call", async () => {
    const app = await getTestApp();
    const { listingId } = await listed(app);
    const { agent: guest } = await signUp(app, "Guest");

    const tried = await guest.post(`/api/sim-market/listings/${listingId}/try`).send({});
    expect(tried.status, JSON.stringify(tried.body).slice(0, 300)).toBe(201);
    expect(tried.body.ventureId, "nowhere to send them").toBeTruthy();
    expect(tried.body.deskPath).toBe(`/simulation/${tried.body.ventureId}`);
    expect(tried.body.running, "they would land on a waiting screen").toBe(true);
  });

  it("lands on a desk that is actually playable, not a lobby", async () => {
    /*
     * The whole claim. A desk that answers 409 "this season isn't running" is
     * the waiting screen with extra steps.
     */
    const app = await getTestApp();
    const { listingId } = await listed(app);
    const { agent: guest } = await signUp(app, "Guest2");
    const tried = await guest.post(`/api/sim-market/listings/${listingId}/try`).send({});
    expect(tried.status).toBe(201);

    const desk = await guest.get(`/api/sim/ventures/${tried.body.ventureId}/desk`);
    expect(desk.status, JSON.stringify(desk.body).slice(0, 200)).toBe(200);
    expect(desk.body.phase, "still in a lobby").toBe("running");
    expect(desk.body.yourRole, "no desk to decide at").toBeTruthy();
    expect(desk.body.year).toBe(1);
  });

  it("gives them a market with rivals in it", async () => {
    /* A season with one company in it teaches the wrong lesson about every decision. */
    const app = await getTestApp();
    const { listingId } = await listed(app);
    const { agent: guest } = await signUp(app, "Guest3");
    const tried = await guest.post(`/api/sim-market/listings/${listingId}/try`).send({});

    const rooms = await db.select().from(simVentures).where(eq(simVentures.seasonId, tried.body.seasonId));
    expect(rooms.length, "nobody to compete with").toBeGreaterThan(1);
  });

  it("is a table of one, so nothing waits for anybody", async () => {
    const app = await getTestApp();
    const { listingId } = await listed(app);
    const { agent: guest } = await signUp(app, "Guest4");
    const tried = await guest.post(`/api/sim-market/listings/${listingId}/try`).send({});

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, tried.body.seasonId));
    expect(season.seatCount).toBe(1);
    /* No empty chairs, so nothing for Nova to fill in front of them. */
    expect(season.botFill).toBe(false);
  });

  it("records the start, so they can get back to it", async () => {
    const app = await getTestApp();
    const { listingId } = await listed(app);
    const { agent: guest } = await signUp(app, "Guest5");
    const tried = await guest.post(`/api/sim-market/listings/${listingId}/try`).send({});

    const mine = await guest.get("/api/sim-market/me");
    expect(mine.body.totals.running, "a season nobody can find again").toBe(1);
  });

  it("takes nothing for a free listing, and a seat for a paid one", async () => {
    const app = await getTestApp();
    const { listingId } = await listed(app, "perSeat");
    const { agent: buyer } = await signUp(app, "Payer");
    await buyer.post("/api/dev/credit-wallet").send({ amountCents: 5000 });
    const bought = await buyer.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 2 });

    const tried = await buyer.post(`/api/sim-market/listings/${listingId}/try`).send({});
    expect(tried.status, JSON.stringify(tried.body).slice(0, 200)).toBe(201);
    expect(tried.body.seatSpent).toBe(true);
    const [row] = await db.select().from(simulationPurchases).where(eq(simulationPurchases.id, bought.body.purchase.id));
    expect(row.seatsLeft).toBe(1);
  });

  it("refuses a paid listing to somebody holding no seats, and starts nothing", async () => {
    const app = await getTestApp();
    const { listingId } = await listed(app, "perSeat");
    const { agent: stranger } = await signUp(app, "Stranger");

    const tried = await stranger.post(`/api/sim-market/listings/${listingId}/try`).send({});
    expect(tried.status).toBe(402);
    const mine = await stranger.get("/api/sim-market/me");
    expect(mine.body.totals.running).toBe(0);
  });

  it("lets the author try their own without owning a seat", async () => {
    const app = await getTestApp();
    const { authorAgent, listingId } = await listed(app, "perSeat");
    const tried = await authorAgent.post(`/api/sim-market/listings/${listingId}/try`).send({});
    expect(tried.status, JSON.stringify(tried.body).slice(0, 200)).toBe(201);
    expect(tried.body.seatSpent).toBe(false);
  });
});

describe("the join link a purchase hands back", () => {
  /*
   * The end of the line for everything else in this file. A sale that cannot
   * be played is not a sale, and the whole flow — buy, spend a seat, start a
   * season, get a link — ends at a page reached by that link.
   */
  it("opens, rather than telling the buyer their link isn't valid", async () => {
    const app = await getTestApp();
    const { agent: authorAgent, id: authorId } = await signUp(app, "Writer");
    await acceptTerms(authorAgent);
    const made = await draft(authorAgent, authorId);
    const listingId = made.body.listing.id as string;
    await authorAgent.post(`/api/sim-market/listings/${listingId}/publish`).send({
      title: "Veterinary scheduling",
      summary: "Two incumbents hold most of it and the way in is narrow.",
      pricing: "free",
    });

    const { agent: buyer } = await signUp(app, "Buyer");
    await buyer.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 1 });
    const started = await buyer.post(`/api/sim-market/listings/${listingId}/play`).send({});
    expect(started.status, JSON.stringify(started.body).slice(0, 300)).toBe(201);
    expect(started.body.inviteCode).toBeTruthy();

    /* Exactly what the page behind `joinUrl` asks the server. */
    const page = await buyer.get(`/api/sim/join-code/${started.body.inviteCode}`);
    expect(page.status, `the link the buyer was given answers ${page.status}: ${JSON.stringify(page.body).slice(0, 200)}`).toBe(200);
    expect(page.body.seasonId).toBe(started.body.seasonId);
  });

  it("lets the buyer actually take a seat with it", async () => {
    const app = await getTestApp();
    const { agent: authorAgent, id: authorId } = await signUp(app, "Writer2");
    await acceptTerms(authorAgent);
    const made = await draft(authorAgent, authorId);
    const listingId = made.body.listing.id as string;
    await authorAgent.post(`/api/sim-market/listings/${listingId}/publish`).send({
      title: "Veterinary scheduling",
      summary: "Two incumbents hold most of it and the way in is narrow.",
      pricing: "free",
    });

    const { agent: buyer } = await signUp(app, "Buyer2");
    await buyer.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 1 });
    const started = await buyer.post(`/api/sim-market/listings/${listingId}/play`).send({});
    expect(started.status).toBe(201);

    const joined = await buyer.post("/api/sim/join-code").send({ code: started.body.inviteCode });
    expect(joined.status, `joining answered ${joined.status}: ${JSON.stringify(joined.body).slice(0, 200)}`).toBeLessThan(300);
    expect(joined.body.ventureId, "no table to sit at").toBeTruthy();
  });
});

describe("refunds", () => {
  it("gives back the unused seats, priced at what was actually paid", async () => {
    const app = await getTestApp();
    const { agent: seller, id: sellerId } = await signUp(app, "Priced");
    await acceptTerms(seller);
    const made = await draft(seller, sellerId);
    await seller.post(`/api/sim-market/listings/${made.body.listing.id}/publish`)
      .send({ title: "Veterinary scheduling", summary: "Two incumbents hold most of it and the way in is narrow.", pricing: "perSeat", seatPriceCents: 300 });

    const { agent: buyer, id: buyerId } = await signUp(app, "Changed");
    await buyer.post("/api/dev/credit-wallet").send({ amountCents: 5000 });
    const bought = await buyer.post(`/api/sim-market/listings/${made.body.listing.id}/buy`).send({ seats: 6 });

    /* Four seats used on seasons; two still unspent. */
    await db.update(simulationPurchases).set({ seatsLeft: 2 }).where(eq(simulationPurchases.id, bought.body.purchase.id));

    const before = (await walletOf(buyerId)).balanceCents;
    const refunded = await buyer.post(`/api/sim-market/purchases/${bought.body.purchase.id}/refund`).send({});
    expect(refunded.status, JSON.stringify(refunded.body)).toBe(200);
    expect(refunded.body.seats).toBe(2);
    expect(refunded.body.refundedCents, "two seats at what they cost").toBe(600);
    expect((await walletOf(buyerId)).balanceCents).toBe(before + 600);
  });

  it("refuses once every seat has been used, because it has been delivered", async () => {
    const app = await getTestApp();
    const { agent: seller, id: sellerId } = await signUp(app, "Delivered");
    await acceptTerms(seller);
    const made = await draft(seller, sellerId);
    await seller.post(`/api/sim-market/listings/${made.body.listing.id}/publish`)
      .send({ title: "Veterinary scheduling", summary: "Two incumbents hold most of it and the way in is narrow.", pricing: "perSeat", seatPriceCents: 300 });

    const { agent: buyer } = await signUp(app, "Played");
    await buyer.post("/api/dev/credit-wallet").send({ amountCents: 5000 });
    const bought = await buyer.post(`/api/sim-market/listings/${made.body.listing.id}/buy`).send({ seats: 2 });
    await db.update(simulationPurchases).set({ seatsLeft: 0 }).where(eq(simulationPurchases.id, bought.body.purchase.id));

    const refused = await buyer.post(`/api/sim-market/purchases/${bought.body.purchase.id}/refund`).send({});
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/used to start a season/i);
  });

  it("refuses after the window has passed", async () => {
    const app = await getTestApp();
    const { agent: seller, id: sellerId } = await signUp(app, "Late");
    await acceptTerms(seller);
    const made = await draft(seller, sellerId);
    await seller.post(`/api/sim-market/listings/${made.body.listing.id}/publish`)
      .send({ title: "Veterinary scheduling", summary: "Two incumbents hold most of it and the way in is narrow.", pricing: "perSeat", seatPriceCents: 300 });

    const { agent: buyer } = await signUp(app, "Slow");
    await buyer.post("/api/dev/credit-wallet").send({ amountCents: 5000 });
    const bought = await buyer.post(`/api/sim-market/listings/${made.body.listing.id}/buy`).send({ seats: 2 });

    const old = new Date(Date.now() - (REFUND_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);
    await db.update(simulationPurchases).set({ createdAt: old }).where(eq(simulationPurchases.id, bought.body.purchase.id));

    const refused = await buyer.post(`/api/sim-market/purchases/${bought.body.purchase.id}/refund`).send({});
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(new RegExp(`${REFUND_WINDOW_DAYS} days`));
  });

  it("belongs to the buyer and nobody else", async () => {
    const app = await getTestApp();
    const { agent: seller, id: sellerId } = await signUp(app, "Owner");
    await acceptTerms(seller);
    const made = await draft(seller, sellerId);
    await seller.post(`/api/sim-market/listings/${made.body.listing.id}/publish`)
      .send({ title: "Veterinary scheduling", summary: "Two incumbents hold most of it and the way in is narrow.", pricing: "free" });

    const { agent: buyer } = await signUp(app, "Mine");
    const bought = await buyer.post(`/api/sim-market/listings/${made.body.listing.id}/buy`).send({ seats: 1 });
    const { agent: stranger } = await signUp(app, "Theirs");
    expect((await stranger.post(`/api/sim-market/purchases/${bought.body.purchase.id}/refund`).send({})).status).toBe(404);
  });
});

describe("reporting a listing", () => {
  async function published(app: any) {
    const { agent, id } = await signUp(app, "Accused");
    await acceptTerms(agent);
    const made = await draft(agent, id);
    await agent.post(`/api/sim-market/listings/${made.body.listing.id}/publish`).send({
      title: "Veterinary scheduling",
      summary: "Two incumbents hold most of it and the way in is narrow.",
      pricing: "free",
    });
    return { authorId: id, listingId: made.body.listing.id as string };
  }

  it("files against the listing, and the reviewer sees what was published", async () => {
    /*
     * A report that files but shows a reviewer nothing is worse than no button
     * at all. Before this target had a case in `snapshotOf`, it fell through
     * to the user-profile branch and read the listing id as a user id — the
     * report arrived and the queue showed an empty profile.
     */
    const app = await getTestApp();
    const { listingId } = await published(app);
    const { agent: reporter } = await signUp(app, "Noticer");

    const filed = await reporter.post("/api/reports").send({
      targetType: "simulation_listing",
      targetId: listingId,
      /*
       * `detail` is a second structured choice rather than free text — the
       * queue sorts on it — so a report has to name one of the options its
       * reason offers.
       */
      reason: "misleading",
      detail: REPORT_REASON_DETAILS.misleading[0].id,
      note: "This is copied from somebody else's market.",
    });
    expect(filed.status, JSON.stringify(filed.body).slice(0, 200)).toBeLessThan(300);

    const [report] = await db.select().from(contentReports)
      .where(eq(contentReports.targetId, listingId));
    expect(report, "the report was not stored against the listing").toBeTruthy();
    expect(report.targetType).toBe("simulation_listing");
    /*
     * The snapshot is the words the author published, which is what is being
     * judged — and it is taken at report time, because the author can edit or
     * unlist the moment the report lands.
     */
    expect(report.snapshot ?? "", "the reviewer would see nothing").toContain("Veterinary scheduling");
    expect(report.targetOwnerId, "the report must point at the author").toBeTruthy();
  });

  it("takes it off the marketplace when a reviewer acts, without touching seasons", async () => {
    const app = await getTestApp();
    const { listingId } = await published(app);

    /* A buyer who already has seats keeps them — they paid for something. */
    const { agent: buyer } = await signUp(app, "Paid");
    await buyer.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 2 });

    await db.update(simulationListings)
      .set({ takenDownAt: new Date(), takenDownReason: "Copied market", status: "unlisted" })
      .where(eq(simulationListings.id, listingId));

    const { agent: browser } = await signUp(app, "Looking");
    const list = await browser.get("/api/sim-market/listings");
    expect(list.body.listings.map((l: any) => l.id)).not.toContain(listingId);

    /* And the seats they bought still start a season. */
    const started = await buyer.post(`/api/sim-market/listings/${listingId}/play`).send({});
    expect(started.status, "a takedown took away something somebody paid for").toBe(201);
  });

  it("cannot be quietly republished by its author", async () => {
    const app = await getTestApp();
    const { authorId, listingId } = await published(app);
    await db.update(simulationListings)
      .set({ takenDownAt: new Date(), takenDownReason: "Copied market", status: "unlisted" })
      .where(eq(simulationListings.id, listingId));

    /* The author's own switch must not clear a reviewer's decision. */
    const { agent } = await signUp(app, "Rejected");
    void authorId;
    const retry = await agent.post(`/api/sim-market/listings/${listingId}/publish`).send({ pricing: "free" });
    expect([403, 404]).toContain(retry.status);
  });
});
