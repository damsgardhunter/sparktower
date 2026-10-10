/**
 * What happens to a sale when one of the two people closes their account.
 *
 * A sale is a record of money moving between two people, and each of them needs
 * it: the buyer's receipt and refund right, the seller's income and their tax
 * return, the platform's own books. Neither party can be allowed to erase the
 * other's half by leaving.
 *
 * It worked the other way round. `simulation_purchases` was listed as the
 * leaving person's own data on the grounds that the database would cascade it
 * away regardless — a premise that was simply false, because closing an account
 * writes a tombstone and never deletes the `users` row. So the rows were not
 * being taken by the schema; they were being taken by the DELETE that list
 * drives. A buyer leaving destroyed the seller's record of the sale, and if the
 * fourteen-day hold had not elapsed the seller was never paid for something
 * they had delivered. A seller leaving destroyed every buyer's record of
 * everything they had ever bought, because purchases cascade from the listing.
 *
 * `project_backings` had been kept for exactly this reason since it was
 * written. These are the same tests for the same rule.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import {
  users, projects, companies, companyMembers, simSeasons,
  simulationListings, simulationPurchases, sellerAgreements, notifications,
} from "@shared/schema";
import { walletOf } from "../../server/wallet";
import { releaseDueEarnings } from "../../server/simulation-market-compliance";
import { splitSale } from "@shared/simulation-market";
import { SELLER_TERMS_VERSION } from "@shared/simulation-market-terms";

afterAll(async () => { await closeTestApp(); });

const PASSWORD = "a-good-passphrase-here";
let n = 0;

async function person(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.191.${(n % 200) + 20}`;
  const email = `close-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: PASSWORD, firstName: first });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string, email };
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

async function listedAt(app: any, priceCents: number) {
  const seller = await person(app, "Vendor");
  await db.insert(sellerAgreements).values({ userId: seller.id, version: SELLER_TERMS_VERSION } as any);

  const [project] = await db.insert(projects).values({
    ownerId: seller.id, title: `Close co ${++n}`, description: "A business a market was written for.",
    category: "saas", status: "active",
  } as any).returning();
  const [company] = await db.insert(companies).values({
    name: "Clinic Scheduler", slug: `cl-${Date.now()}-${n}`,
    projectId: project.id, createdBy: seller.id, createdAt: new Date(),
  } as any).returning();
  await db.insert(companyMembers).values({
    companyId: company.id, userId: seller.id, role: "owner", joinedAt: new Date(),
  });
  const [season] = await db.insert(simSeasons).values({
    nicheId: MARKET.id, name: "Vet rota — one", status: "forming", totalYears: 4,
    companyId: company.id, inviteCode: `CL${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    createdAt: new Date(), scope: "home", botTeams: 0, origin: "nova", cadence: "quarterly",
    customMarket: MARKET,
  } as any).returning();

  const made = await seller.agent.post("/api/sim-market/listings")
    .send({ fromSeasonId: season.id, title: "Veterinary scheduling" });
  expect(made.status, `${made.status}: ${(made.text ?? "").slice(0, 300)}`).toBe(201);
  const listingId = made.body.listing.id as string;
  expect((await seller.agent.post(`/api/sim-market/listings/${listingId}/publish`).send({
    title: "Veterinary scheduling",
    summary: "Two established rivals hold most of it and the way in is narrow.",
    pricing: "perSeat",
    seatPriceCents: priceCents,
  })).status).toBe(200);

  return { seller, listingId };
}

const close = (who: { agent: any }) =>
  who.agent.post("/api/account/delete").send({ password: PASSWORD, keepPosts: true });

describe("a buyer who closes their account", () => {
  it("leaves the seller's record of the sale, and the seller still gets paid", async () => {
    const app = await getTestApp();
    const PRICE = 500;
    const { seller, listingId } = await listedAt(app, PRICE);

    const buyer = await person(app, "Leaving");
    await buyer.agent.post("/api/dev/credit-wallet").send({ amountCents: 10_000 });
    const bought = await buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 2 });
    expect(bought.status).toBe(201);
    const purchaseId = bought.body.purchase.id as string;

    /* Both seats used, so the sale is delivered in full and nothing is refundable. */
    for (let i = 0; i < 2; i++) {
      expect((await buyer.agent.post(`/api/sim-market/listings/${listingId}/play`).send({})).status).toBe(201);
    }

    const closed = await close(buyer);
    expect(closed.status, `${closed.status}: ${(closed.text ?? "").slice(0, 300)}`).toBe(200);

    /*
     * The row is still there, pointing at the tombstone. It is the seller's
     * income record and the platform's books; the buyer took a copy with them
     * in their export.
     */
    const [row] = await db.select().from(simulationPurchases)
      .where(eq(simulationPurchases.id, purchaseId));
    expect(row, "the seller's record of the sale survives the buyer leaving").toBeTruthy();
    expect(row.paidCents).toBe(2 * PRICE);

    /* And the money still arrives, which it could not do without the row. */
    await db.update(simulationPurchases)
      .set({ releasableAt: new Date(Date.now() - 1000) })
      .where(eq(simulationPurchases.id, purchaseId));

    const before = (await walletOf(seller.id)).balanceCents;
    await releaseDueEarnings();
    expect((await walletOf(seller.id)).balanceCents - before,
      "paid for a sale that was delivered before the buyer left").toBe(splitSale(2 * PRICE).sellerCents);
  }, 120_000);
});

describe("a seller who closes their account", () => {
  it("gives buyers back the seats nobody will stand behind, and keeps the record", async () => {
    const app = await getTestApp();
    const PRICE = 500;
    const { seller, listingId } = await listedAt(app, PRICE);

    const buyer = await person(app, "Holding");
    await buyer.agent.post("/api/dev/credit-wallet").send({ amountCents: 10_000 });
    const bought = await buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`).send({ seats: 4 });
    expect(bought.status).toBe(201);
    const purchaseId = bought.body.purchase.id as string;

    /* One played, three never will be — their author is about to leave. */
    expect((await buyer.agent.post(`/api/sim-market/listings/${listingId}/play`).send({})).status).toBe(201);

    /*
     * Well outside the buyer's own fourteen days, because that window is for
     * changing their mind and this is the other side of the bargain walking
     * away.
     */
    await db.update(simulationPurchases)
      .set({ createdAt: new Date(Date.now() - 200 * 86_400_000) })
      .where(eq(simulationPurchases.id, purchaseId));

    const walletBefore = (await walletOf(buyer.id)).balanceCents;
    const closed = await close(seller);
    expect(closed.status, `${closed.status}: ${(closed.text ?? "").slice(0, 300)}`).toBe(200);
    expect(closed.body.seatsRefunded, "the purchase with seats left on it").toBe(1);

    /* Three seats back, at what was paid for them. */
    expect((await walletOf(buyer.id)).balanceCents - walletBefore).toBe(3 * PRICE);

    /*
     * And they are told why. The buyer asked for none of this, so an unexplained
     * credit is the failure the backing code names in as many words: it is how
     * a person decides a product took their money. The marketplace shipped with
     * no notices at all, and this is the one that moves money without being
     * asked.
     */
    await expect.poll(async () => {
      const bell = await db.select().from(notifications)
        .where(eq(notifications.recipientId, buyer.id));
      return bell.filter((n) => n.kind === "seats_refunded").length;
    }, { timeout: 10_000 }).toBe(1);

    /* The record survives: it is the buyer's receipt and the platform's books. */
    const [row] = await db.select().from(simulationPurchases)
      .where(eq(simulationPurchases.id, purchaseId));
    expect(row, "the buyer's record of what they bought survives the seller leaving").toBeTruthy();
    expect(row.seatsLeft).toBe(0);
    expect(row.refundedCents).toBe(3 * PRICE);

    /* So does the listing, which is what says *what* they bought. */
    const [listing] = await db.select().from(simulationListings)
      .where(eq(simulationListings.id, listingId));
    expect(listing, "a receipt that cannot say what it was for is not a receipt").toBeTruthy();
    expect(listing.status, "and it is off sale").toBe("unlisted");

    /*
     * The seat that was played is still a sale, and the seller is still owed
     * for it — but there is nobody left to pay.
     *
     * This asserted a credit until the sweep learned to check. Paying a closed
     * account puts the money in a balance nobody can sign in to spend, so the
     * ledger said the seller was paid while the money sat unreachable. It is
     * recorded as unclaimed instead: the same amount, on its own line in the
     * revenue report, with the question of whose it eventually is left open
     * rather than answered by an unreachable credit.
     */
    await db.update(simulationPurchases)
      .set({ releasableAt: new Date(Date.now() - 1000) })
      .where(eq(simulationPurchases.id, purchaseId));
    const sellerBefore = (await walletOf(seller.id)).balanceCents;
    await releaseDueEarnings();

    expect((await walletOf(seller.id)).balanceCents - sellerBefore,
      "nothing is credited to an account that cannot be signed into").toBe(0);
    const [settled] = await db.select().from(simulationPurchases)
      .where(eq(simulationPurchases.id, purchaseId));
    expect(settled.unclaimedCents, "the seat that was played is still owed, and recorded as owed")
      .toBe(splitSale(1 * PRICE).sellerCents);
  }, 120_000);

  it("keeps the consent record behind the sales it made", async () => {
    const app = await getTestApp();
    const { seller } = await listedAt(app, 500);

    expect((await close(seller)).status).toBe(200);

    /*
     * "They agreed to the terms" is the question a dispute opens with, and a
     * record one side can delete by leaving cannot answer it.
     */
    const agreed = await db.select().from(sellerAgreements)
      .where(and(eq(sellerAgreements.userId, seller.id), eq(sellerAgreements.version, SELLER_TERMS_VERSION)));
    expect(agreed, "the seller agreement outlives the seller").toHaveLength(1);

    /* And the account really is closed, so this is not a test of nothing. */
    const [row] = await db.select().from(users).where(eq(users.id, seller.id));
    expect(row.deletedAt).not.toBeNull();
  }, 120_000);
});
