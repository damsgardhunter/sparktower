import { readFileSync } from "node:fs";
import { openShareFor, pricedForABusiness } from "@shared/simulation/custom-market";
import { play } from "./customviable.mts";
const NAMES = ["rotaread"];
const SEEDS = ["a","d","h","m","q","t","w","y"];
const RATES = [0, 0.005, 0.01, 0.03, 0.06, 0.12];
const fixed = (raw: any) => {
  const openShare = openShareFor(raw);
  return { ...raw, openShare, segments: pricedForABusiness({ segments: raw.segments, cities: raw.cities, baseUnitCost: raw.baseUnitCost, openShare }) };
};
console.log("market        open   price-lift | winnable · profitable · bankrupt · beaten-by-nothing");
const { NICHES } = await import("@shared/simulation/niches");
const ALL: any[] = [...NAMES.map((n) => ({ id: n, raw: JSON.parse(readFileSync(`.sim-lab/${n}.json`, "utf8")), cust: true })), ...(NICHES as any[]).map((k: any) => ({ id: k.id, raw: k, cust: false }))];
for (const e of ALL) {
  const n = e.id; const raw = e.raw;
  const niche = e.cust ? fixed(raw) : raw;
  const lift = (niche.segments[0].referencePrice / raw.segments[0].referencePrice);
  const os = niche.openShare ?? 0.1;
  let winnable = 0, profitable = 0, broke = 0, beaten = 0;
  for (const seed of SEEDS) {
    const nothing = play(niche, seed, 0);
    let anyProfit = 0, best: any = null;
    for (const rate of RATES) { const r = play(niche, seed, rate); anyProfit = Math.max(anyProfit, r.prof); if (!best || r.worth > best.worth) best = r; }
    if (best.cust > 0) winnable++;
    if (anyProfit > 0) profitable++;
    if (best.bankrupt) broke++;
    if (best.worth <= nothing.worth) beaten++;
  }
  const bad = (winnable < 8 || profitable === 0 || broke > 0 || beaten > 0) ? "  <-- " : "";
  console.log(`${n.padEnd(16)} ${os.toFixed(3)}  x${lift.toFixed(1).padStart(6)} | ${winnable}/8 · ${profitable}/8 · ${broke}/8 · ${beaten}/8${bad}`);
}
