import { seedIncumbents } from "@shared/simulation/incumbents";
import { startingCompany } from "@shared/simulation/season";
import { allocate, appealFor } from "@shared/simulation/market";
import { nicheById } from "@shared/simulation/niches";
import { ROLES } from "@shared/simulation/types";
const niche: any = nicheById("dating_apps")!;
const eco: any = { demand: 1, interestRate: 0.08, costIndex: 1, outlook: "steady" };
const base: any = { ...startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] as any }), cash: 12_000_000, price: 22, capacity: 36288, quality: 35.72, brand: 19.45 };
console.log("quality  allocated   appeal per segment");
for (const q of [30, 35.72, 40, 44.72, 50, 60, 80]) {
  const me = { ...base, quality: q };
  const out: any = allocate([...seedIncumbents(niche), me] as any, niche, 1, eco, 1);
  const won = Object.values(out.held.t ?? {}).reduce((s: number, n: any) => s + n, 0);
  const ap = niche.segments.map((s: any) => appealFor(me, s, niche, eco).toFixed(3)).join(" ");
  console.log(`${String(q).padStart(7)} ${String(Math.round(won)).padStart(10)}   ${ap}`);
}
