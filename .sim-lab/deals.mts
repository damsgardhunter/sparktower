import { dealsFor } from "@shared/simulation/world";
import { nicheById } from "@shared/simulation/niches";
import { seedIncumbents } from "@shared/simulation/incumbents";
const niche: any = nicheById("dating_apps")!;
const incumbents = seedIncumbents(niche);
let buyoutOnly = 0, none = 0, total = 0;
const examples: string[] = [];
for (let s = 0; s < 400; s++) {
  const company: any = { id: "v", customers: { swipers: 1200 }, capacity: 40000 };
  const offers = dealsFor({ seasonId: `s${s}`, year: 5, company, niche, incumbents, worth: 5_000_000 });
  total++;
  if (!offers.length) none++;
  else if (!offers.some((o: any) => o.kind !== "buyout")) { buyoutOnly++; if (examples.length < 3) examples.push(`s${s}: ${offers.map((o: any) => o.kind).join(",")}`); }
}
console.log(`of ${total} year-5 draws: ${buyoutOnly} were buyout-only (${((buyoutOnly/total)*100).toFixed(1)}%), ${none} had no offer at all`);
console.log("examples:", examples.join(" | "));
