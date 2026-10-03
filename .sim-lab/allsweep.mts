import { readFileSync } from "node:fs";
import { NICHES } from "@shared/simulation/niches";
import { season } from "./sweep.mts";
const customs = ["rotaread","kilnshare","tallyhold"].map((n) => JSON.parse(readFileSync(`.sim-lab/${n}.json`,"utf8")));
const SEEDS = ["a","d","h","m","q","t","w","y"];
let tb = 0, tk = 0;
for (const niche of [...(NICHES as any[]), ...customs]) {
  let beaten = 0, broke = 0, lo = Infinity, hi = 0;
  for (const seed of SEEDS) {
    const nothing = season(niche, seed, 0);
    let top: any = null;
    for (const rate of [0.02,0.06,0.12,0.25]) { const r = season(niche, seed, rate); if (!top || r.worth > top.worth) top = r; }
    if (top.worth <= nothing.worth) beaten++;
    if (top.bankrupt) broke++;
    lo = Math.min(lo, top.customers); hi = Math.max(hi, top.customers);
  }
  tb += beaten; tk += broke;
  console.log(`${niche.id.padEnd(18)} beaten ${beaten}/8 · bankrupt ${broke}/8 · customers ${lo.toLocaleString()}..${hi.toLocaleString()}`);
}
console.log(`TOTAL beaten ${tb} · bankrupt ${tk}`);
