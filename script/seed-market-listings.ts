/**
 * Test simulations in the marketplace, so the thing can be practised on.
 *
 * An empty marketplace cannot be exercised. Every path through it — browse,
 * sort, buy, refund, play, share, take down, pay out — needs something listed
 * first, and until now the only way to get one was to run a season, write a
 * market with Nova at ten dollars a go, and publish it by hand. So the money
 * paths in the product that handles money were the hardest ones to try.
 *
 * These are listed by Nova Business (`script/seed-nova-business.ts`), which is
 * what that account exists for, and they are built from the **built-in niches**
 * rather than from Nova-written markets. That is the important choice: a
 * built-in niche is a real, balanced, playable market that ships in the repo
 * (`shared/simulation/niches.ts`), so a seeded listing plays exactly as a sold
 * one does and costs nothing to make.
 *
 * ## Pricing
 *
 * A spread, on purpose: free, cheap, and dear. Free exercises the
 * nothing-to-pay branch, which is a different path through `buy` and `/try`
 * than a charge is; the paid ones exercise the split, the hold and the refund.
 * One is left as a draft, because "a draft promises nothing" is a rule with its
 * own behaviour and the only way to check it is to have one.
 *
 * Idempotent by title: run it again and it updates rather than duplicating, so
 * it is safe in a loop or after an edit.
 *
 *   DATABASE_URL=… npx tsx script/seed-market-listings.ts
 *   DATABASE_URL=… npx tsx script/seed-market-listings.ts --apply
 */
import { pathToFileURL } from "node:url";
import { and, eq } from "drizzle-orm";
import { db } from "../server/db";
import { users, userProfiles, simulationListings, sellerAgreements } from "@shared/schema";
import { NICHES } from "@shared/simulation/niches";
import { SELLER_TERMS_VERSION } from "@shared/simulation-market-terms";
import { SEAT_PRICE_MIN_CENTS } from "@shared/simulation-market";

const apply = process.argv.includes("--apply");
const allowRemote = process.argv.includes("--allow-remote");

/** The account these are listed by. See script/seed-nova-business.ts. */
const SELLER_EMAIL = "nova-business@bots.sparktower.invalid";

/**
 * What to list, and why each one is here.
 *
 * Deliberately not one of everything: seven listings is enough to fill a page,
 * sort it, and have something to buy at each price point, and few enough that
 * a person can hold the whole set in their head while testing.
 */
const PLAN: { niche: string; pricing: "free" | "perSeat"; seatPriceCents: number; status: "listed" | "draft"; why: string }[] = [
  { niche: "restaurant_chain", pricing: "free", seatPriceCents: 0, status: "listed", why: "free, so the no-charge branch of buy and /try is reachable" },
  { niche: "podcasts", pricing: "free", seatPriceCents: 0, status: "listed", why: "a second free one, so 'free only' filters return more than one row" },
  { niche: "project_saas", pricing: "perSeat", seatPriceCents: SEAT_PRICE_MIN_CENTS, status: "listed", why: "the cheapest a seat may be — the floor is its own edge" },
  { niche: "construction", pricing: "perSeat", seatPriceCents: 500, status: "listed", why: "an ordinary price, for the split, the hold and a partial refund" },
  { niche: "drone_delivery", pricing: "perSeat", seatPriceCents: 1200, status: "listed", why: "dearer, so price sorting has something to sort" },
  { niche: "mmos", pricing: "perSeat", seatPriceCents: 2500, status: "listed", why: "dearest, and enough that a wallet can be short of it" },
  { niche: "dating_apps", pricing: "perSeat", seatPriceCents: 800, status: "draft", why: "a draft promises nothing — the rule needs one to be checked against" },
];

function assertIntentional(url: string): void {
  const host = new URL(url).hostname;
  const local = ["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"];
  if (local.includes(host) || allowRemote) return;
  throw new Error(
    `${host} does not look like a local database.\n`
    + "These are test listings and they will be visible to anybody browsing the marketplace. "
    + "Add --allow-remote if that is really what you want.",
  );
}

/**
 * The copy, from the niche's own premise.
 *
 * Written from what ships rather than invented, so a seeded listing reads like
 * the market it actually is — and so nobody has to guess whether a strange
 * result came from the listing or from the market behind it.
 */
const copyFor = (niche: { id: string; name: string; premise?: string }) => ({
  title: niche.name,
  summary: (niche.premise ?? `A ${niche.name.toLowerCase()} market with rivals already seated.`).slice(0, 400),
  description:
    `${niche.premise ?? ""}\n\n`
    + `Fourteen years, a quarter at a time, against rivals that play to win. A test listing: `
    + `it is the built-in ${niche.name.toLowerCase()} market, listed so the marketplace has `
    + `something in it to try.`,
  tags: ["test", niche.id],
});

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL.");
  assertIntentional(url);
  console.log(`database: ${new URL(url).hostname}${new URL(url).pathname}`);

  const [seller] = await db.select({ id: users.id }).from(users).where(eq(users.email, SELLER_EMAIL));
  if (!seller) {
    console.error(
      `No ${SELLER_EMAIL} on this database.\n`
      + "Run script/seed-nova-business.ts first — these are listed by that account, which is what it is for.",
    );
    return 1;
  }

  const byId = new Map(NICHES.map((n: any) => [n.id, n]));
  const missing = PLAN.filter((p) => !byId.has(p.niche)).map((p) => p.niche);
  if (missing.length) {
    console.error(`These niches are not in shared/simulation/niches.ts any more: ${missing.join(", ")}`);
    return 1;
  }

  for (const step of PLAN) {
    const niche: any = byId.get(step.niche);
    const price = step.pricing === "free" ? "free" : `$${(step.seatPriceCents / 100).toFixed(2)}/seat`;
    console.log(`  · ${niche.name} — ${price}, ${step.status} (${step.why})`);
  }

  if (!apply) {
    console.log(`\n${PLAN.length} listing(s). Dry run — rerun with --apply.\n`);
    return 0;
  }

  console.log("\napplying…");

  /* Listing anything needs the agreement in force, the same as it does for a person. */
  const agreed = await db.select().from(sellerAgreements)
    .where(and(eq(sellerAgreements.userId, seller.id), eq(sellerAgreements.version, SELLER_TERMS_VERSION)));
  if (!agreed.length) {
    await db.insert(sellerAgreements).values({ userId: seller.id, version: SELLER_TERMS_VERSION, acceptedIp: null } as any);
    console.log("  recorded the seller agreement for the account");
  }

  let made = 0;
  let updated = 0;
  for (const step of PLAN) {
    const niche: any = byId.get(step.niche);
    const copy = copyFor(niche);

    /*
     * Keyed on author and title rather than on a seeded-row marker: the thing
     * that must not happen twice is two listings of the same market by the same
     * account, and that is exactly what this reads.
     */
    const [existing] = await db.select({ id: simulationListings.id })
      .from(simulationListings)
      .where(and(eq(simulationListings.authorId, seller.id), eq(simulationListings.title, copy.title)));

    const values = {
      authorId: seller.id,
      ...copy,
      /*
       * `nicheId`, and no `customMarket`. The market is the built-in one, read
       * by id when a season starts — so there is no copy of it on the listing
       * to go stale when the niche is rebalanced in the repo.
       */
      nicheId: niche.id,
      cadence: "quarterly" as const,
      botSkill: "survivor" as const,
      totalYears: 14,
      pricing: step.pricing,
      seatPriceCents: step.pricing === "free" ? 0 : step.seatPriceCents,
      status: step.status,
      publishedAt: step.status === "listed" ? new Date() : null,
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(simulationListings).set(values as any).where(eq(simulationListings.id, existing.id));
      updated += 1;
    } else {
      await db.insert(simulationListings).values(values as any);
      made += 1;
    }
  }

  const [profile] = await db.select({ name: userProfiles.displayName })
    .from(userProfiles).where(eq(userProfiles.userId, seller.id));

  console.log(`\n${made} new, ${updated} updated, listed by ${profile?.name ?? SELLER_EMAIL}.`);
  console.log("  marketplace  /simulations/market");
  console.log(
    "\nThe free ones are playable immediately. The paid ones need a balance:\n"
    + "  POST /api/dev/credit-wallet { amountCents } — development only.\n",
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
