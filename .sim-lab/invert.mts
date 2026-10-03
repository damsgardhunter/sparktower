import { startingCompany } from "@shared/simulation/season";
import { allocate, appealFor } from "@shared/simulation/market";
import { nicheById } from "@shared/simulation/niches";
import { seedIncumbents } from "@shared/simulation/incumbents";
import { ROLES } from "@shared/simulation/types";
const niche: any = nicheById("dating_apps")!;
const eco: any = { demand: 1, interestRate: 0.08, costIndex: 1, outlook: "steady" };
/* The four rivals exactly as resolveYear has them at allocate time. */
const seeded = seedIncumbents(niche);
const tune: any = {
  inc_ember: { capacity: 2129514, quality: 63.0, brand: 83.7, service: 55.1, price: 47.20 },
  inc_pairwise: { capacity: 2157246, quality: 60.5, brand: 70.9, service: 45.2, price: 31.20 },
  inc_spark: { capacity: 1500986, quality: 44.1, brand: 69.6, service: 38.6, price: 38.40 },
  inc_lantern: { capacity: 833604, quality: 82.1, brand: 56.2, service: 68.3, price: 52.80 },
};
const rivals = seeded.map((c: any) => ({ ...c, ...(tune[c.id] ?? {}) }));
const base: any = { ...startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] as any }), cash: 12_000_000, price: 22, capacity: 36288, brand: 19.45, service: 45.8 };
console.log("unitCost  allocated    per-segment won        appeal");
for (const q of [6.0, 5.9, 5.8, 5.7, 5.58, 5.4, 5.0, 4.0]) {
  const me = { ...base, quality: 35.72, unitCost: q };
  const out: any = allocate([...rivals, me] as any, niche, 1, eco, 1);
  const per = niche.segments.map((s: any) => Math.round(out.held.t?.[s.id] ?? 0)).join("/");
  const ap = niche.segments.map((s: any) => appealFor(me, s, niche, eco).toFixed(3)).join(" ");
  const won = Object.values(out.held.t ?? {}).reduce((s: number, n: any) => s + n, 0);
  console.log(`${String(q).padStart(7)} ${String(Math.round(won)).padStart(10)}    ${per.padEnd(22)} ${ap}`);
}
