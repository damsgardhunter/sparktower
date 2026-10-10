/**
 * Put some simulations on the marketplace, locally, to click through.
 *
 * Run: NODE_ENV=development npx tsx --env-file=.env script/seed-marketplace.ts
 *
 * Seven listings from `script/lib/startup-specs.ts` — the same seven the
 * balance report measures, so what you browse here is what those numbers are
 * about. A mix of free and per-seat, because the two take different paths
 * through the buy flow and the free one is the one worth sending to somebody.
 *
 * ## It writes to the local database only
 *
 * `DATABASE_URL` in `.env` is the local Postgres on 5433.
 * `EXTERNAL_DATABASE_URL` is production on Render, and nothing here goes near
 * it — this script imports `server/db`, which reads `DATABASE_URL`, and it
 * refuses to run against anything that is not a loopback address. A seeding
 * script that could reach production is a seeding script that eventually does.
 *
 * Idempotent by title: run it twice and you still have seven.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../server/db";
import { simulationListings, sellerAgreements, users } from "@shared/schema";
import { buildCustomMarket, marketShares } from "../shared/simulation/custom-market";

import { SELLER_TERMS_VERSION } from "@shared/simulation-market-terms";
import { STARTUP_SPECS } from "./lib/startup-specs";

const url = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url)) {
  console.error("Refusing to run: DATABASE_URL is not a local address.");
  console.error(`  got: ${url.replace(/:\/\/[^@]*@/, "://***@")}`);
  process.exit(1);
}

/** What each one costs, so both paths through the buy flow have something on them. */
const PRICING: Record<string, { pricing: "free" | "perSeat"; seatPriceCents: number }> = {
  "vet software": { pricing: "free", seatPriceCents: 0 },
  "youtube channel": { pricing: "free", seatPriceCents: 0 },
  "coffee roastery": { pricing: "free", seatPriceCents: 0 },
  "indie game studio": { pricing: "perSeat", seatPriceCents: 300 },
  "carbon consultancy": { pricing: "perSeat", seatPriceCents: 1200 },
  "launch hardware": { pricing: "perSeat", seatPriceCents: 2500 },
  "fitness app": { pricing: "free", seatPriceCents: 0 },
};

const CADENCE: Record<string, "yearly" | "quarterly" | "monthly"> = {
  "coffee roastery": "quarterly",
  "youtube channel": "monthly",
};

async function main() {
  const [owner] = await db.select({ id: users.id, email: users.email }).from(users)
    .where(eq(users.email, "damsgardhunter@gmail.com"));
  if (!owner) {
    console.error("No account for damsgardhunter@gmail.com in the local database.");
    process.exit(1);
  }
  console.log(`Listing as ${owner.email}\n`);

  /* The seller terms, so publishing and the profile page do not nag. */
  const [agreed] = await db.select().from(sellerAgreements)
    .where(and(eq(sellerAgreements.userId, owner.id), eq(sellerAgreements.version, SELLER_TERMS_VERSION)));
  if (!agreed) {
    await db.insert(sellerAgreements).values({
      userId: owner.id, version: SELLER_TERMS_VERSION, acceptedIp: "127.0.0.1",
    });
    console.log(`Accepted seller terms v${SELLER_TERMS_VERSION}\n`);
  }

  for (const spec of STARTUP_SPECS) {
    const niche = buildCustomMarket(spec.spec, `seed-${spec.label.replace(/\s+/g, "-")}`, { fresh: true });
    if (!niche) { console.log(`  skip  ${spec.label} — buildCustomMarket refused it`); continue; }

    const title = niche.name;
    const [existing] = await db.select({ id: simulationListings.id }).from(simulationListings)
      .where(and(eq(simulationListings.authorId, owner.id), eq(simulationListings.title, title)));
    if (existing) { console.log(`  have  ${title}`); continue; }

    const price = PRICING[spec.label] ?? { pricing: "free" as const, seatPriceCents: 0 };
    const held = Math.round(marketShares({ incumbents: niche.incumbents ?? [] })
      .rivals.reduce((n, r) => n + r.share, 0) * 100);

    /*
     * The description a buyer reads. Written here rather than by
     * `writeListingCopy`, which is a model call — this is a seeding script and
     * should cost nothing to run.
     */
    const description = [
      niche.premise,
      "",
      `Who buys: ${niche.segments.map((s) => `${s.name.toLowerCase()} (${s.size.toLocaleString()}, around £${s.referencePrice.toLocaleString()} each)`).join("; ")}.`,
      `Already there: ${(niche.incumbents ?? []).map((i) => i.name).join(" and ")} — ${held}% of it between them.`,
      `Serving one ${niche.voice.customer} costs about £${niche.baseUnitCost.toLocaleString()}.`,
      "",
      spec.note.charAt(0).toUpperCase() + spec.note.slice(1) + ".",
    ].join("\n");

    const [made] = await db.insert(simulationListings).values({
      authorId: owner.id,
      title,
      summary: niche.premise.slice(0, 200),
      description,
      tags: [niche.voice.customers, niche.voice.unit].filter(Boolean).slice(0, 4),
      customMarket: niche,
      nicheId: niche.id,
      cadence: CADENCE[spec.label] ?? "yearly",
      botSkill: spec.label === "launch hardware" ? "survivor" : "filler",
      totalYears: 14,
      pricing: price.pricing,
      seatPriceCents: price.seatPriceCents,
      status: "listed",
      publishedAt: new Date(),
    }).returning({ id: simulationListings.id });

    console.log(`  listed  ${title.padEnd(32)} ${price.pricing === "free" ? "free" : `£${(price.seatPriceCents / 100).toFixed(2)}/seat`}`);
    console.log(`          /simulations/market/${made.id}`);
    console.log(`          /try/${made.id}   ← the link to send somebody`);
  }

  const all = await db.select({ id: simulationListings.id, title: simulationListings.title })
    .from(simulationListings).where(eq(simulationListings.status, "listed"));
  console.log(`\n${all.length} listed. Browse at /simulations/market\n`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
