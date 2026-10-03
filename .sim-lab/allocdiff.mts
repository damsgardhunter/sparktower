import { seedIncumbents } from "@shared/simulation/incumbents";
import { startingCompany } from "@shared/simulation/season";
import { allocate } from "@shared/simulation/market";
import { nicheById } from "@shared/simulation/niches";
import { ROLES } from "@shared/simulation/types";
const niche: any = nicheById("dating_apps")!;
const eco: any = { demand: 1, interestRate: 0.08, costIndex: 1, outlook: "steady" };
const mk = (over: any = {}) => ({ ...startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] as any }), cash: 12_000_000, price: 22, capacity: 400_000, ...over });
for (const [label, c] of [["plain", mk()], ["armed", mk({ brand: 14, quality: 47, capacity: 900_000 })]] as any) {
  const out: any = allocate([...seedIncumbents(niche), c] as any, niche, 1, eco, 1);
  const mine = Object.values(out.held.t ?? {}).reduce((s: number, n: any) => s + n, 0);
  console.log(`${label.padEnd(6)} raw allocate won ${Math.round(mine).toLocaleString()}`);
}
