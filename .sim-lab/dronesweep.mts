import { NICHES } from "@shared/simulation/niches";
import { season } from "./sweep.mts";
const niche: any = (NICHES as any[]).find((n) => n.id === "drone_delivery");
const SEEDS = ["a","d","h","m","q","t","w","y"];
let beaten = 0, broke = 0, lo = Infinity, hi = 0;
for (const seed of SEEDS) {
  const nothing = season(niche, seed, 0);
  let top: any = null;
  for (const rate of [0.02, 0.06, 0.12, 0.25]) { const r = season(niche, seed, rate); if (!top || r.worth > top.worth) top = r; }
  if (top.worth <= nothing.worth) beaten++;
  if (top.bankrupt) broke++;
  lo = Math.min(lo, top.customers); hi = Math.max(hi, top.customers);
}
console.log(`price ${niche.segments[0].referencePrice} unitCost ${niche.baseUnitCost}: beaten-by-nothing ${beaten}/8 · bankrupt ${broke}/8 · customers ${lo.toLocaleString()}..${hi.toLocaleString()}`);
