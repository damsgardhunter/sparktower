/**
 * What the marketplace earned, and what it is holding that isn't its own.
 *
 * Two gaps that turned out to be the same gap. `platform_cents` had been
 * written on every sale since the marketplace shipped and read by nothing, so
 * the one question an owner asks — what did we make — had no answer short of a
 * SQL client. And when a seller closed their account with money still on hold,
 * the payout sweep credited the balance of a tombstone: an account nobody can
 * sign into. The ledger said the seller was paid, the money was unreachable,
 * and nothing anywhere said the platform was sitting on it.
 *
 * So the report has five numbers rather than one, and the money with nobody to
 * receive it is a line of its own. It is not revenue — it is a question the
 * platform owes an answer to — and folding it into "platform" would be deciding
 * that question by arithmetic.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { passMfa } from "../helpers/mfa";
import { db } from "../../server/db";
import {
  users, projects, companies, companyMembers, simSeasons,
  simulationPurchases, sellerAgreements,
} from "@shared/schema";
import { walletOf } from "../../server/wallet";
import { releaseDueEarnings } from "../../server/simulation-market-compliance";
import { splitSale } from "@shared/simulation-market";
import { sellerOwed, SELLER_TERMS_VERSION } from "@shared/simulation-market-terms";

afterAll(async () => { await closeTestApp(); });

const PASSWORD = "a-good-passphrase-here";
let n = 0;

async function person(app: any, first: string, role?: "admin") {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.161.${(n % 200) + 20}`;
  const email = `rev-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: PASSWORD, firstName: first });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  await verifyEmail(app, email, ip);
  if (role) {
    await db.update(users).set({ platformRole: role }).where(eq(users.id, res.body.id));
    await passMfa(agent);
  }
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
    ownerId: seller.id, title: `Rev co ${++n}`, description: "A business a market was written for.",
    category: "saas", status: "active",
  } as any).returning();
  const [company] = await db.insert(companies).values({
    name: "Clinic Scheduler", slug: `rv-${Date.now()}-${n}`,
    projectId: project.id, createdBy: seller.id, createdAt: new Date(),
  } as any).returning();
  await db.insert(companyMembers).values({
    companyId: company.id, userId: seller.id, role: "owner", joinedAt: new Date(),
  });
  const [season] = await db.insert(simSeasons).values({
    nicheId: MARKET.id, name: "Vet rota — one", status: "forming", totalYears: 4,
    companyId: company.id, inviteCode: `RV${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
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
    pricing: "perSeat", seatPriceCents: priceCents,
  })).status).toBe(200);

  return { seller, listingId };
}

const buyFrom = async (app: any, listingId: string, seats: number) => {
  const buyer = await person(app, "Buyer");
  await buyer.agent.post("/api/dev/credit-wallet").send({ amountCents: 50_000 });
  const res = await buyer.agent.post(`/api/sim-market/listings/${listingId}/buy`)
    .send({ seats, idempotencyKey: `rev-${Date.now()}-${Math.random()}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  return { buyer, purchaseId: res.body.purchase.id as string };
};

describe("money owed to a seller who has gone", () => {
  it("is recorded as unclaimed rather than paid into an account nobody can reach", async () => {
    const app = await getTestApp();
    const PRICE = 500;
    const { seller, listingId } = await listedAt(app, PRICE);
    const { buyer, purchaseId } = await buyFrom(app, listingId, 2);

    /* Both seats used, so the sale is delivered and none of it is refundable. */
    for (let i = 0; i < 2; i++) {
      expect((await buyer.agent.post(`/api/sim-market/listings/${listingId}/play`).send({})).status).toBe(201);
    }

    /* The seller leaves before the hold elapses. */
    expect((await seller.agent.post("/api/account/delete")
      .send({ password: PASSWORD, keepPosts: true })).status).toBe(200);

    await db.update(simulationPurchases)
      .set({ releasableAt: new Date(Date.now() - 1000) })
      .where(eq(simulationPurchases.id, purchaseId));

    const before = (await walletOf(seller.id)).balanceCents;
    await releaseDueEarnings();

    const owed = splitSale(2 * PRICE).sellerCents;
    const [row] = await db.select().from(simulationPurchases)
      .where(eq(simulationPurchases.id, purchaseId));

    expect(row.unclaimedCents, "written down, as its own figure").toBe(owed);
    expect(row.releasedAt, "and off the sweep's list, so it is not rescanned forever").not.toBeNull();
    expect((await walletOf(seller.id)).balanceCents - before,
      "nothing was put into a balance nobody can sign in to spend").toBe(0);
  }, 120_000);

  it("pays a seller who is still here, which is the case this must not break", async () => {
    const app = await getTestApp();
    const PRICE = 500;
    const { seller, listingId } = await listedAt(app, PRICE);
    const { purchaseId } = await buyFrom(app, listingId, 2);

    await db.update(simulationPurchases)
      .set({ releasableAt: new Date(Date.now() - 1000) })
      .where(eq(simulationPurchases.id, purchaseId));

    const before = (await walletOf(seller.id)).balanceCents;
    await releaseDueEarnings();

    expect((await walletOf(seller.id)).balanceCents - before).toBe(splitSale(2 * PRICE).sellerCents);
    const [row] = await db.select().from(simulationPurchases)
      .where(eq(simulationPurchases.id, purchaseId));
    expect(row.unclaimedCents, "nothing unclaimed about it").toBe(0);
  }, 120_000);
});

describe("the platform's own revenue", () => {
  it("adds up: sellers plus platform is exactly what buyers kept", async () => {
    const app = await getTestApp();
    const PRICE = 700;
    const { listingId } = await listedAt(app, PRICE);

    /* One clean sale, and one partly refunded, which is where summing the stored split goes wrong. */
    await buyFrom(app, listingId, 3);
    const { buyer, purchaseId } = await buyFrom(app, listingId, 4);
    expect((await buyer.agent.post(`/api/sim-market/listings/${listingId}/play`).send({})).status).toBe(201);
    expect((await buyer.agent.post(`/api/sim-market/purchases/${purchaseId}/refund`).send({})).status).toBe(200);

    const admin = await person(app, "Operator", "admin");
    const report = await admin.agent.get("/api/admin/sim-market/revenue");
    expect(report.status, `${report.status}: ${(report.text ?? "").slice(0, 300)}`).toBe(200);

    const t = report.body.totals;
    expect(t.sales).toBe(2);
    expect(t.grossCents, "what buyers paid").toBe(3 * PRICE + 4 * PRICE);
    expect(t.refundedCents, "three of four seats back").toBe(3 * PRICE);
    expect(t.netCents).toBe(t.grossCents - t.refundedCents);

    /*
     * The property that makes the report reconcilable, and the reason platform
     * is a subtraction rather than a sum of `platform_cents`: that column is
     * the split at the moment of sale and knows nothing about the refund since.
     */
    expect(t.sellerCents + t.platformCents, "the two halves are the whole").toBe(t.netCents);

    /* And the seller's half is the same arithmetic the sweep pays out. */
    const rows = await db.select().from(simulationPurchases);
    const owed = rows.reduce((sum, r) => sum + sellerOwed(r), 0);
    expect(t.sellerCents, "the same number the payout sweep would send").toBe(owed);
  }, 150_000);

  it("keeps money with no seller left to pay out of revenue, and shows it", async () => {
    const app = await getTestApp();
    const PRICE = 500;
    const { seller, listingId } = await listedAt(app, PRICE);
    const { buyer, purchaseId } = await buyFrom(app, listingId, 1);
    expect((await buyer.agent.post(`/api/sim-market/listings/${listingId}/play`).send({})).status).toBe(201);

    expect((await seller.agent.post("/api/account/delete")
      .send({ password: PASSWORD, keepPosts: true })).status).toBe(200);
    await db.update(simulationPurchases)
      .set({ releasableAt: new Date(Date.now() - 1000) })
      .where(eq(simulationPurchases.id, purchaseId));
    await releaseDueEarnings();

    const admin = await person(app, "Operator", "admin");
    const t = (await admin.agent.get("/api/admin/sim-market/revenue")).body.totals;

    const owed = splitSale(PRICE).sellerCents;
    expect(t.unclaimedCents, "on its own line").toBe(owed);
    /*
     * Still counted as the seller's share, because that is whose it is. The
     * platform has it and has not earned it, and the report says both.
     */
    expect(t.sellerCents).toBe(owed);
    expect(t.platformCents, "what the platform actually earned").toBe(PRICE - owed);
  }, 150_000);

  it("is broken down by month, and held earnings are not counted as income", async () => {
    const app = await getTestApp();
    const PRICE = 500;
    const { listingId } = await listedAt(app, PRICE);
    await buyFrom(app, listingId, 2);

    const admin = await person(app, "Operator", "admin");
    const body = (await admin.agent.get("/api/admin/sim-market/revenue?months=3")).body;

    expect(body.months.length).toBe(1);
    expect(body.months[0].month).toMatch(/^\d{4}-\d{2}$/);
    expect(body.months[0].grossCents).toBe(2 * PRICE);

    /* Nothing is released yet, so all of the seller's share is still a liability. */
    expect(body.heldCents, "owed, not yet paid, and not income").toBe(splitSale(2 * PRICE).sellerCents);
  }, 150_000);

  it("is not readable by somebody who merely has an account", async () => {
    const app = await getTestApp();
    const nosy = await person(app, "Nosy");

    /* 404 rather than 403: don't confirm the report exists to somebody probing. */
    expect((await nosy.agent.get("/api/admin/sim-market/revenue")).status).toBe(404);
  }, 90_000);
});
