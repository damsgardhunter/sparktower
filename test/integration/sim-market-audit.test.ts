/**
 * A buyer who refunds the seats they did not use, and the seller who sold the
 * ones they did.
 *
 * This is the ordinary case for the thing being sold. Seats are bought for a
 * table — "five of us are doing this" — and tables shrink: two people play, the
 * other three never do, and the buyer asks for those three back inside the
 * window. `refundableSeats` is built for exactly that and returns the unused
 * seats rather than the purchase.
 *
 * So two seats were delivered, kept, and played. The question these ask is what
 * the seller is paid for them.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { passMfa } from "../helpers/mfa";
import { db } from "../../server/db";
import {
  users, projects, companies, companyMembers, simSeasons, simulationListings,
  simulationListingPlayers, simulationPurchases, sellerAgreements,
  notifications, userFollows,
} from "@shared/schema";
import { walletOf } from "../../server/wallet";
import { releaseDueEarnings } from "../../server/simulation-market-compliance";
import { splitSale } from "@shared/simulation-market";
import { SELLER_TERMS_VERSION, BUYER_TERMS_VERSION } from "@shared/simulation-market-terms";

afterAll(async () => { await closeTestApp(); });

let n = 0;

async function person(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.181.${(n % 200) + 20}`;
  const email = `refund-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: first });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
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
    { id: "a", name: "Alphaco", posture: "fortress", startingShare: 0.3, quality: 65, brand: 60, service: 55, priceIndex: 1.1, persona: { tagline: "", boss: "", character: "", known: "", knock: "Slow", voice: "" } },
    { id: "b", name: "Betaco", posture: "coaster", startingShare: 0.2, quality: 50, brand: 45, service: 40, priceIndex: 0.9, persona: { tagline: "", boss: "", character: "", known: "", knock: "Dated", voice: "" } },
  ],
};

/** A seller with a listing on sale at `priceCents` a seat. */
/** A listing by a seller who already exists, so a second one can be published. */
async function listedAtBy(app: any, seller: { id: string; agent: any }, priceCents: number) {
  void app;

  const [project] = await db.insert(projects).values({
    ownerId: seller.id, title: `Refund co ${++n}`, description: "A business a market was written for.",
    category: "saas", status: "active",
  } as any).returning();
  const [company] = await db.insert(companies).values({
    name: "Clinic Scheduler", slug: `rf-${Date.now()}-${n}`,
    projectId: project.id, createdBy: seller.id, createdAt: new Date(),
  } as any).returning();
  await db.insert(companyMembers).values({
    companyId: company.id, userId: seller.id, role: "owner", joinedAt: new Date(),
  });
  const [season] = await db.insert(simSeasons).values({
    nicheId: MARKET.id, name: "Vet rota — one", status: "forming", totalYears: 4,
    companyId: company.id, inviteCode: `RF${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    createdAt: new Date(), scope: "home", botTeams: 0, origin: "nova", cadence: "quarterly",
    customMarket: MARKET,
  } as any).returning();

  const made = await seller.agent.post("/api/sim-market/listings")
    .send({ fromSeasonId: season.id, title: "Veterinary scheduling" });
  expect(made.status, `${made.status}: ${(made.text ?? "").slice(0, 300)}`).toBe(201);

  const listingId = made.body.listing.id as string;
  const published = await seller.agent.post(`/api/sim-market/listings/${listingId}/publish`).send({
    title: "Veterinary scheduling",
    summary: "Two established rivals hold most of it and the way in is narrow.",
    pricing: "perSeat",
    seatPriceCents: priceCents,
  });
  expect(published.status, `${published.status}: ${(published.text ?? "").slice(0, 300)}`).toBe(200);

  return { seller, listingId };
}

/** The same, with a seller made for the occasion — what most of these want. */
async function listedAt(app: any, priceCents: number) {
  const seller = await person(app, "Vendor");
  await db.insert(sellerAgreements).values({ userId: seller.id, version: SELLER_TERMS_VERSION } as any);
  return listedAtBy(app, seller, priceCents);
}

describe("a partly refunded purchase", () => {
  it("pays the seller for the seats that were delivered and kept", async () => {
    const app = await getTestApp();
    const PRICE = 500;
    const { seller, listingId } = await listedAt(app, PRICE);

    const buyer = await person(app, "Buyer");
    await buyer.agent.post("/api/dev/credit-wallet").send({ amountCents: 10_000 });

    /* Five seats for a table of five. */
    const bought = await buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 5 });
    expect(bought.status, `${bought.status}: ${(bought.text ?? "").slice(0, 300)}`).toBe(201);
    const purchaseId = bought.body.purchase.id as string;
    expect(bought.body.purchase.paidCents).toBe(5 * PRICE);

    /* Two of them turn up and play. Those seats are delivered. */
    for (let i = 0; i < 2; i++) {
      const played = await buyer.agent.post(`/api/sim-market/listings/${listingId}/play`).send({});
      expect(played.status, `${played.status}: ${(played.text ?? "").slice(0, 200)}`).toBe(201);
    }

    /* The other three never do, so the buyer asks for those back. */
    const refunded = await buyer.agent.post(`/api/sim-market/purchases/${purchaseId}/refund`).send({});
    expect(refunded.status, `${refunded.status}: ${(refunded.text ?? "").slice(0, 300)}`).toBe(200);
    expect(refunded.body.seats, "the three unused ones").toBe(3);
    expect(refunded.body.refundedCents).toBe(3 * PRICE);

    /* Wind the hold back rather than waiting a fortnight. */
    await db.update(simulationPurchases)
      .set({ releasableAt: new Date(Date.now() - 1000) })
      .where(eq(simulationPurchases.id, purchaseId));

    const before = (await walletOf(seller.id)).balanceCents;
    await releaseDueEarnings();
    const after = (await walletOf(seller.id)).balanceCents;

    /*
     * Two seats at five hundred were bought, used and not refunded. The seller
     * is owed the split of those, and nothing for the three that went back.
     */
    const owed = splitSale(2 * PRICE).sellerCents;
    expect(after - before, `the seller is owed ${owed} for the two seats that were played`).toBe(owed);
  }, 90_000);

  it("tells the seller the same number the sweep will pay", async () => {
    const app = await getTestApp();
    const PRICE = 500;
    const { seller, listingId } = await listedAt(app, PRICE);

    const buyer = await person(app, "Buyer");
    await buyer.agent.post("/api/dev/credit-wallet").send({ amountCents: 10_000 });
    const bought = await buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 5 });
    const purchaseId = bought.body.purchase.id as string;

    await buyer.agent.post(`/api/sim-market/listings/${listingId}/play`).send({}).expect(201);
    await buyer.agent.post(`/api/sim-market/purchases/${purchaseId}/refund`).send({}).expect(200);

    /*
     * Four seats refunded, one played. Three places report on this sale — the
     * earnings statement, the seller's library, and the sweep that actually
     * moves the money — and a seller comparing them has to see one number.
     */
    const owed = splitSale(1 * PRICE).sellerCents;

    const earnings = await seller.agent.get("/api/sim-market/earnings");
    expect(earnings.status).toBe(200);
    const year = earnings.body.years[0];
    expect(year.netCents, "the earnings statement, after refunds").toBe(owed);

    const mine = await seller.agent.get("/api/sim-market/me");
    expect(mine.status).toBe(200);
    expect(mine.body.totals.earnedCents, "the seller's own library").toBe(owed);
  }, 90_000);
});

/**
 * A seller the platform has just banned.
 *
 * `public-edges.test.ts` writes the rule down for projects: "suspension blocks
 * writes, and before this change that was all it did — everything the account
 * had already published went on being advertised by the site that had just
 * banned them." The marketplace is the same rule with money on it, so it is
 * worse: a listing that goes on selling takes payment for a seller nobody
 * wants on the platform.
 *
 * What is deliberately *not* taken away is what somebody already paid for. The
 * buyer did nothing wrong, and a seat they bought is theirs to use.
 */
describe("a suspended seller's listings", () => {
  it("come off the marketplace, and stop taking money", async () => {
    const app = await getTestApp();
    const { seller, listingId } = await listedAt(app, 500);

    const shopper = await person(app, "Shopper");
    await shopper.agent.post("/api/dev/credit-wallet").send({ amountCents: 10_000 });

    const inIndex = async () => {
      const res = await shopper.agent.get("/api/sim-market/listings?q=Veterinary");
      expect(res.status).toBe(200);
      return (res.body.listings as { id: string }[]).some((l) => l.id === listingId);
    };
    expect(await inIndex(), "listed before the suspension").toBe(true);

    await db.update(users)
      .set({ suspendedAt: new Date(), suspendedReason: "Sold something they shouldn't have" })
      .where(eq(users.id, seller.id));

    expect(await inIndex(), "a banned seller's listing is not advertised").toBe(false);

    const bought = await shopper.agent.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 1 });
    expect(bought.status, "and it takes no more money").toBe(404);
  }, 90_000);

  it("leaves what somebody already bought alone", async () => {
    const app = await getTestApp();
    const { seller, listingId } = await listedAt(app, 500);

    const buyer = await person(app, "Paid");
    await buyer.agent.post("/api/dev/credit-wallet").send({ amountCents: 10_000 });
    expect((await buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 2 })).status).toBe(201);

    await db.update(users)
      .set({ suspendedAt: new Date(), suspendedReason: "Nothing to do with this buyer" })
      .where(eq(users.id, seller.id));

    /*
     * The buyer paid for two seats before any of this and did nothing wrong.
     * Taking the product away would punish them for the seller's behaviour.
     */
    const played = await buyer.agent.post(`/api/sim-market/listings/${listingId}/play`).send({});
    expect(played.status, `${played.status}: ${(played.text ?? "").slice(0, 200)}`).toBe(201);
  }, 90_000);
});

/**
 * A listing a reviewer has taken down.
 *
 * Two rules that pull in opposite directions, and both are right.
 *
 * A buyer keeps what they paid for. `sim-marketplace.test.ts` states it
 * plainly — "a takedown took away something somebody paid for" — and a report
 * is often acted on long after the refund window has closed, so taking the
 * seats back would punish the one person who did nothing.
 *
 * The author does not. Publishing a taken-down listing is refused, and so is
 * minting a share link for one, but `/play` checked neither the status nor the
 * takedown — so the author could go on starting seasons from the thing a
 * reviewer had just removed from them.
 */
describe("a listing taken down by a reviewer", () => {
  it("stops its author starting seasons, and leaves its buyers alone", async () => {
    const app = await getTestApp();
    const { seller, listingId } = await listedAt(app, 500);

    const buyer = await person(app, "Holder");
    await buyer.agent.post("/api/dev/credit-wallet").send({ amountCents: 10_000 });
    expect((await buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 3 })).status).toBe(201);

    /* Playable before, so the refusal afterwards is the takedown and not the setup. */
    expect((await buyer.agent.post(`/api/sim-market/listings/${listingId}/play`).send({})).status).toBe(201);

    /* What `POST /api/admin/sim-market/listings/:id/takedown` writes. */
    await db.update(simulationListings)
      .set({ takenDownAt: new Date(), takenDownReason: "other", status: "unlisted" })
      .where(eq(simulationListings.id, listingId));

    /* The buyer paid for three seats and has two left; those are still theirs. */
    const buyerAgain = await buyer.agent.post(`/api/sim-market/listings/${listingId}/play`).send({});
    expect(buyerAgain.status, "a takedown must not take away something somebody paid for").toBe(201);

    /*
     * The author is the one the decision was about. A takedown the person who
     * wrote the thing can play around is not a takedown.
     */
    const author = await seller.agent.post(`/api/sim-market/listings/${listingId}/play`).send({});
    expect(author.status, "the author does not keep playing what was removed from them").toBe(403);
  }, 90_000);
});

/**
 * Consent, with a version on it.
 *
 * "They agreed to the terms" is worth nothing without "which terms", and the
 * only form of that question anybody ever asks is years later. The seller side
 * had this from the start. The buyer side had the text on screen and recorded
 * nothing at all, so a refund dispute over the fourteen-day window had no
 * record of what the buyer had been shown.
 */
describe("what the buyer agreed to", () => {
  it("is recorded on the purchase, with the version in force", async () => {
    const app = await getTestApp();
    const { listingId } = await listedAt(app, 500);

    const buyer = await person(app, "Consenting");
    await buyer.agent.post("/api/dev/credit-wallet").send({ amountCents: 10_000 });

    /* The page reads the terms, and the version comes with them. */
    const shown = await buyer.agent.get("/api/sim-market/buyer-terms");
    expect(shown.status).toBe(200);
    expect(shown.body.version).toBe(BUYER_TERMS_VERSION);
    expect(shown.body.disclosure.length, "and the text that was displayed").toBeGreaterThan(0);

    const bought = await buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`)
      .send({ seats: 1, acceptedTermsVersion: shown.body.version });
    expect(bought.status, `${bought.status}: ${(bought.text ?? "").slice(0, 200)}`).toBe(201);

    const [row] = await db.select().from(simulationPurchases)
      .where(eq(simulationPurchases.id, bought.body.purchase.id));
    expect(row.buyerTermsVersion, "what this sale happened under").toBe(BUYER_TERMS_VERSION);
  }, 90_000);

  it("refuses a tab that is showing terms nobody uses any more", async () => {
    const app = await getTestApp();
    const { listingId } = await listedAt(app, 500);

    const buyer = await person(app, "Stale");
    await buyer.agent.post("/api/dev/credit-wallet").send({ amountCents: 10_000 });

    /*
     * A page loaded before a bump. Nothing else can catch this: the server
     * would happily record the current version as accepted by somebody who was
     * reading the old one.
     */
    const stale = await buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`)
      .send({ seats: 1, acceptedTermsVersion: BUYER_TERMS_VERSION - 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.version, "and it says which version to read").toBe(BUYER_TERMS_VERSION);

    /* Nothing was charged and nothing was written. */
    const rows = await db.select().from(simulationPurchases)
      .where(eq(simulationPurchases.listingId, listingId));
    expect(rows).toHaveLength(0);
  }, 90_000);

  it("still records the version for a caller that does not send one", async () => {
    const app = await getTestApp();
    const { listingId } = await listedAt(app, 500);

    const buyer = await person(app, "Quiet");
    await buyer.agent.post("/api/dev/credit-wallet").send({ amountCents: 10_000 });

    /*
     * Deliberately permitted. A caller that sends nothing is not claiming to
     * have displayed anything, and the disclosure is rendered beside the pay
     * button either way — so the version in force is still the truthful record.
     */
    const bought = await buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 1 });
    expect(bought.status).toBe(201);

    const [row] = await db.select().from(simulationPurchases)
      .where(eq(simulationPurchases.id, bought.body.purchase.id));
    expect(row.buyerTermsVersion).toBe(BUYER_TERMS_VERSION);
  }, 90_000);
});

/**
 * A terms bump, on the seller's side.
 *
 * The behaviour here is a decision rather than an accident, and the constant's
 * own doc states it: a seller on an old version "is asked again before they may
 * publish — not blocked from what they have already listed, because
 * retroactively unpublishing somebody's work over a wording change is its own
 * kind of wrong."
 *
 * It had no test, which for a rule that cuts against the obvious reading is
 * where it gets changed by somebody who thinks they are fixing a bug. Simulated
 * by moving the stored acceptance back a version, which is what a bump looks
 * like from the code's point of view.
 */
describe("bumping the seller terms", () => {
  it("asks for the new version before publishing again, and leaves live listings selling", async () => {
    const app = await getTestApp();
    const { seller, listingId } = await listedAt(app, 500);

    /* As if the version in force had moved on past what they accepted. */
    await db.update(sellerAgreements)
      .set({ version: SELLER_TERMS_VERSION - 1 })
      .where(eq(sellerAgreements.userId, seller.id));

    const republish = await seller.agent.post(`/api/sim-market/listings/${listingId}/publish`).send({
      title: "Veterinary scheduling",
      summary: "Two established rivals hold most of it and the way in is narrow.",
      pricing: "perSeat",
      seatPriceCents: 500,
    });
    expect(republish.status, "they are asked again").toBe(428);
    expect(republish.body.needsTerms).toBe(SELLER_TERMS_VERSION);

    /* And the listing they already had up goes on selling. */
    const buyer = await person(app, "Unaffected");
    await buyer.agent.post("/api/dev/credit-wallet").send({ amountCents: 10_000 });
    const bought = await buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 1 });
    expect(bought.status, "a wording change does not unpublish somebody's work").toBe(201);

    /* Accepting the new version lets them publish again. */
    await db.insert(sellerAgreements).values({ userId: seller.id, version: SELLER_TERMS_VERSION } as any);
    const again = await seller.agent.post(`/api/sim-market/listings/${listingId}/publish`).send({
      title: "Veterinary scheduling",
      summary: "Two established rivals hold most of it and the way in is narrow.",
      pricing: "perSeat",
      seatPriceCents: 500,
    });
    expect(again.status).toBe(200);
  }, 90_000);
});

/**
 * The same purchase arriving twice.
 *
 * Buying spends money and then writes a row, and nothing stopped one attempt
 * arriving twice — a double-tapped button, a connection the browser retried, an
 * impatient reload. Each arrival was a complete purchase and each was charged.
 * The only thing between a customer and a double bill was the button being
 * disabled fast enough, which is not a guarantee, and is no guarantee at all on
 * a slow connection where the wait is longest and the second tap most likely.
 */
describe("buying the same thing twice by accident", () => {
  it("charges once, and says the second one was already done", async () => {
    const app = await getTestApp();
    const PRICE = 500;
    const { listingId } = await listedAt(app, PRICE);

    const buyer = await person(app, "Impatient");
    await buyer.agent.post("/api/dev/credit-wallet").send({ amountCents: 10_000 });
    const before = (await walletOf(buyer.id)).balanceCents;

    const key = `attempt-${Date.now()}`;
    const first = await buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`)
      .send({ seats: 2, idempotencyKey: key });
    expect(first.status).toBe(201);

    /* The same tap again. */
    const second = await buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`)
      .send({ seats: 2, idempotencyKey: key });
    expect(second.status, "answered, not refused — the purchase did happen").toBe(200);
    expect(second.body.repeated, "and said so, so nobody is told they paid twice").toBe(true);
    expect(second.body.purchase.id, "the same purchase").toBe(first.body.purchase.id);

    /* Charged for two seats, once. */
    expect(before - (await walletOf(buyer.id)).balanceCents).toBe(2 * PRICE);
    const rows = await db.select().from(simulationPurchases)
      .where(eq(simulationPurchases.listingId, listingId));
    expect(rows, "one purchase, not two").toHaveLength(1);
  }, 90_000);

  it("settles two that arrive at once, and refunds the one that lost", async () => {
    const app = await getTestApp();
    const PRICE = 500;
    const { listingId } = await listedAt(app, PRICE);

    const buyer = await person(app, "Racing");
    await buyer.agent.post("/api/dev/credit-wallet").send({ amountCents: 10_000 });
    const before = (await walletOf(buyer.id)).balanceCents;

    /*
     * Both past the read before either has written, which is the case a
     * read-then-write cannot settle on its own — the unique index does, and the
     * loser's money goes back.
     */
    const key = `race-${Date.now()}`;
    const [a, b] = await Promise.all([
      buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 1, idempotencyKey: key }),
      buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 1, idempotencyKey: key }),
    ]);

    expect([a.status, b.status].sort(), "one created it, one recognised it").toEqual([200, 201]);
    expect(a.body.purchase.id).toBe(b.body.purchase.id);

    const rows = await db.select().from(simulationPurchases)
      .where(eq(simulationPurchases.listingId, listingId));
    expect(rows, "one purchase").toHaveLength(1);
    expect(before - (await walletOf(buyer.id)).balanceCents, "charged for one seat, once").toBe(PRICE);
  }, 90_000);

  it("treats a deliberate second purchase as a second purchase", async () => {
    const app = await getTestApp();
    const PRICE = 500;
    const { listingId } = await listedAt(app, PRICE);

    const buyer = await person(app, "Deliberate");
    await buyer.agent.post("/api/dev/credit-wallet").send({ amountCents: 10_000 });
    const before = (await walletOf(buyer.id)).balanceCents;

    /* Somebody coming back for more seats is not retrying, and sends a new key. */
    expect((await buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`)
      .send({ seats: 1, idempotencyKey: `one-${Date.now()}` })).status).toBe(201);
    expect((await buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`)
      .send({ seats: 1, idempotencyKey: `two-${Date.now()}` })).status).toBe(201);

    expect(before - (await walletOf(buyer.id)).balanceCents).toBe(2 * PRICE);
    const rows = await db.select().from(simulationPurchases)
      .where(eq(simulationPurchases.listingId, listingId));
    expect(rows, "two purchases, because they were two").toHaveLength(2);
  }, 90_000);

  it("still works for a caller that sends no key at all", async () => {
    const app = await getTestApp();
    const { listingId } = await listedAt(app, 500);
    const buyer = await person(app, "Keyless");
    await buyer.agent.post("/api/dev/credit-wallet").send({ amountCents: 10_000 });

    /* Nullable on purpose: a caller that sends nothing is not retrying. */
    expect((await buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 1 })).status).toBe(201);
    expect((await buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 1 })).status).toBe(201);
  }, 90_000);
});

/**
 * The number on the card, and what the ranking runs on.
 *
 * "Played" was `seasonsStarted` — an event count. One buyer with ten seats
 * replaying them read as ten plays, and the `popular` sort ran on the same
 * column, so volume outranked choice: a listing one person replayed ten times
 * beat a listing ten people had each chosen once. It also meant the public
 * number went up for anybody willing to keep pressing a button they had already
 * paid for.
 *
 * It now counts different people. That is the question a stranger is asking,
 * and moving it takes distinct accounts rather than clicks.
 */
describe("how popular a listing looks", () => {
  it("counts people, not replays", async () => {
    const app = await getTestApp();
    const { listingId } = await listedAt(app, 500);

    const buyer = await person(app, "Serial");
    await buyer.agent.post("/api/dev/credit-wallet").send({ amountCents: 10_000 });
    expect((await buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`)
      .send({ seats: 4, idempotencyKey: `seats-${Date.now()}` })).status).toBe(201);

    /* One person, four seasons. */
    for (let i = 0; i < 4; i++) {
      expect((await buyer.agent.post(`/api/sim-market/listings/${listingId}/play`).send({})).status).toBe(201);
    }

    const [row] = await db.select().from(simulationListings).where(eq(simulationListings.id, listingId));
    expect(row.seasonsStarted, "four seasons were started, and that is true").toBe(4);
    expect(row.players, "by one person, which is what the card says").toBe(1);

    /* And the set behind it holds one row, which is what keeps the two in step. */
    const played = await db.select().from(simulationListingPlayers)
      .where(eq(simulationListingPlayers.listingId, listingId));
    expect(played).toHaveLength(1);
    expect(played[0].userId).toBe(buyer.id);
  }, 120_000);

  it("counts a second person once, however they arrive", async () => {
    const app = await getTestApp();
    const { seller, listingId } = await listedAt(app, 500);

    const first = await person(app, "Firstly");
    await first.agent.post("/api/dev/credit-wallet").send({ amountCents: 10_000 });
    await first.agent.post(`/api/sim-market/listings/${listingId}/buy`)
      .send({ seats: 1, idempotencyKey: `a-${Date.now()}` });
    expect((await first.agent.post(`/api/sim-market/listings/${listingId}/play`).send({})).status).toBe(201);

    /* The same person again, this time through a link the author sent them. */
    const minted = await seller.agent.post(`/api/sim-market/listings/${listingId}/shares`)
      .send({ uses: 2 });
    expect(minted.status).toBe(201);
    expect((await first.agent.post(`/api/sim-market/shares/${minted.body.share.token}/try`).send({})).status).toBe(201);

    const [afterSame] = await db.select().from(simulationListings).where(eq(simulationListings.id, listingId));
    expect(afterSame.players, "the same person, by another route, is still one person").toBe(1);

    /* Somebody genuinely new. */
    const second = await person(app, "Secondly");
    expect((await second.agent.post(`/api/sim-market/shares/${minted.body.share.token}/try`).send({})).status).toBe(201);

    const [afterNew] = await db.select().from(simulationListings).where(eq(simulationListings.id, listingId));
    expect(afterNew.players, "and a new person is two").toBe(2);
  }, 120_000);

  it("does not count the author pressing play on their own", async () => {
    const app = await getTestApp();
    const { seller, listingId } = await listedAt(app, 500);

    for (let i = 0; i < 3; i++) {
      expect((await seller.agent.post(`/api/sim-market/listings/${listingId}/play`).send({})).status).toBe(201);
    }

    const [row] = await db.select().from(simulationListings).where(eq(simulationListings.id, listingId));
    expect(row.players, "the author choosing their own listing is not evidence").toBe(0);
    expect(row.seasonsStarted, "and nor is it a play").toBe(0);
  }, 120_000);

  it("ranks by people, so a replayed listing does not outrank a chosen one", async () => {
    const app = await getTestApp();
    const replayed = await listedAt(app, 500);
    const chosen = await listedAt(app, 500);

    /* One buyer, three seasons on the first listing. */
    const serial = await person(app, "Serial");
    await serial.agent.post("/api/dev/credit-wallet").send({ amountCents: 10_000 });
    await serial.agent.post(`/api/sim-market/listings/${replayed.listingId}/buy`)
      .send({ seats: 3, idempotencyKey: `r-${Date.now()}` });
    for (let i = 0; i < 3; i++) {
      await serial.agent.post(`/api/sim-market/listings/${replayed.listingId}/play`).send({});
    }

    /* Two different people, one season each, on the second. */
    for (const name of ["Ann", "Ben"]) {
      const who = await person(app, name);
      await who.agent.post("/api/dev/credit-wallet").send({ amountCents: 10_000 });
      await who.agent.post(`/api/sim-market/listings/${chosen.listingId}/buy`)
        .send({ seats: 1, idempotencyKey: `c-${name}-${Date.now()}` });
      expect((await who.agent.post(`/api/sim-market/listings/${chosen.listingId}/play`).send({})).status).toBe(201);
    }

    const browsing = await person(app, "Browsing");
    const list = await browsing.agent.get("/api/sim-market/listings?sort=popular");
    expect(list.status).toBe(200);

    const order = (list.body.listings as { id: string }[]).map((l) => l.id);
    const chosenAt = order.indexOf(chosen.listingId);
    const replayedAt = order.indexOf(replayed.listingId);
    expect(chosenAt, "both are listed").toBeGreaterThanOrEqual(0);
    expect(replayedAt).toBeGreaterThanOrEqual(0);
    expect(chosenAt, "two people who chose it beat one who replayed it three times")
      .toBeLessThan(replayedAt);
  }, 180_000);
});

/**
 * What the two sides of a sale are told.
 *
 * The marketplace shipped with no notices at all. A seller found out they had
 * sold something by going and looking; found out they had been paid by watching
 * a number in a corner; and found out a reviewer had removed their listing by
 * trying to use it. The backing side has had the equivalent since it was
 * written, and its comment says why: these are the events somebody has no other
 * way to learn.
 */
const kindsFor = async (userId: string) =>
  (await db.select().from(notifications).where(eq(notifications.recipientId, userId))).map((n) => n.kind);

describe("what the marketplace tells people", () => {
  it("tells the people who follow a builder when they list something new", async () => {
    const app = await getTestApp();

    const fan = await person(app, "Fan");
    const { seller, listingId } = await listedAt(app, 500);
    void listingId;

    /* Following the person, not a project: a listing belongs to its author. */
    await db.insert(userFollows).values({ followerId: fan.id, followeeId: seller.id } as any);

    /* A second listing, published while the follow is in place. */
    const second = await listedAtBy(app, seller, 500);
    expect(second.listingId, "a second listing, published while the follow is in place").toBeTruthy();

    await expect.poll(async () => (await kindsFor(fan.id)).filter((k) => k === "listing_published").length,
      { timeout: 10_000 }).toBe(1);
  }, 150_000);

  it("does not announce a relist, only the first time it goes up", async () => {
    const app = await getTestApp();
    const fan = await person(app, "Quiet");
    const { seller, listingId } = await listedAt(app, 500);
    await db.insert(userFollows).values({ followerId: fan.id, followeeId: seller.id } as any);

    /*
     * `publish` is also how a listing is edited and relisted. Announcing a
     * price change to everybody's bell is how a feature becomes noise.
     */
    expect((await seller.agent.post(`/api/sim-market/listings/${listingId}/publish`).send({
      title: "Veterinary scheduling", summary: "Two established rivals hold most of it and the way in is narrow.",
      pricing: "perSeat", seatPriceCents: 700,
    })).status).toBe(200);

    /* Give a fan-out that should not happen time to not happen. */
    await new Promise((r) => setTimeout(r, 1200));
    expect((await kindsFor(fan.id)).filter((k) => k === "listing_published")).toHaveLength(0);
  }, 150_000);

  it("tells the seller somebody bought, and later that the money is theirs", async () => {
    const app = await getTestApp();
    const PRICE = 500;
    const { seller, listingId } = await listedAt(app, PRICE);

    const buyer = await person(app, "Customer");
    await buyer.agent.post("/api/dev/credit-wallet").send({ amountCents: 10_000 });
    const bought = await buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`)
      .send({ seats: 2, idempotencyKey: `sold-${Date.now()}` });
    expect(bought.status).toBe(201);

    await expect.poll(async () => (await kindsFor(seller.id)).includes("listing_sold"),
      { timeout: 10_000 }).toBe(true);

    /* And the payout, which was previously a number changing with nothing to explain it. */
    await db.update(simulationPurchases)
      .set({ releasableAt: new Date(Date.now() - 1000) })
      .where(eq(simulationPurchases.id, bought.body.purchase.id));
    await releaseDueEarnings();

    await expect.poll(async () => (await kindsFor(seller.id)).includes("listing_earnings_released"),
      { timeout: 10_000 }).toBe(true);
  }, 150_000);

  it("tells the author when a reviewer takes their listing down, with the reason", async () => {
    const app = await getTestApp();
    const { seller, listingId } = await listedAt(app, 500);

    const reviewer = await person(app, "Reviewer");
    await db.update(users).set({ platformRole: "reviewer" }).where(eq(users.id, reviewer.id));
    await passMfa(reviewer.agent);

    const reason = "Copies a market somebody else wrote";
    const down = await reviewer.agent.post(`/api/admin/sim-market/${listingId}/takedown`).send({ reason });
    expect(down.status, `${down.status}: ${(down.text ?? "").slice(0, 200)}`).toBe(200);

    await expect.poll(async () => (await kindsFor(seller.id)).includes("listing_taken_down"),
      { timeout: 10_000 }).toBe(true);

    /*
     * The reason travels with it. A takedown somebody cannot understand is one
     * they can neither answer nor avoid repeating.
     */
    const rows = await db.select().from(notifications).where(eq(notifications.recipientId, seller.id));
    const notice = rows.find((n) => n.kind === "listing_taken_down");
    expect(notice?.excerpt).toContain("Copies a market");
  }, 150_000);
});
