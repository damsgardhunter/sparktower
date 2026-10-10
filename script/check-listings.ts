/**
 * Are the listed simulations actually playable?
 *
 * Run: NODE_ENV=development npx tsx --env-file=.env script/check-listings.ts
 *
 * A listing stores its market as JSON and `/play` rebuilds it with
 * `buildCustomMarket(stored, id)` — without `fresh`, so the prices it was
 * published with are kept. If that rebuild returns null the listing is
 * unplayable and the buy flow will have taken the money first.
 */
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { simulationListings } from "@shared/schema";
import { buildCustomMarket } from "../shared/simulation/custom-market";
import { winnabilityOf } from "../shared/simulation/winnable";
import { servesPerHead } from "../shared/simulation/workforce";

const rows = await db.select().from(simulationListings).where(eq(simulationListings.status, "listed"));
console.log(`\n${rows.length} listed\n`);
for (const r of rows) {
  const niche = r.customMarket ? buildCustomMarket(r.customMarket, `listing-${r.id}`) : null;
  const ok = !r.customMarket || !!niche;
  let verdict = "no market";
  if (niche) {
    const w = winnabilityOf(niche);
    const serves = servesPerHead(niche);
    verdict = `${w.ok ? "winnable" : `UNWINNABLE: ${w.problems[0]?.slice(0, 40)}`}  ·  one worker serves ${Number.isFinite(serves) ? serves.toLocaleString() : "∞"}`;
  }
  console.log(`${ok ? " ok " : "FAIL"}  ${r.title.padEnd(32)} ${(r.pricing === "free" ? "free" : `£${(r.seatPriceCents / 100).toFixed(2)}/seat`).padEnd(12)} ${verdict}`);
}
console.log("");
process.exit(0);
