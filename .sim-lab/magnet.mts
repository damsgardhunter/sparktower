import { readFileSync } from "node:fs";
import { NICHES } from "@shared/simulation/niches";
import { openShareFor, pricedForABusiness } from "@shared/simulation/custom-market";
import { season } from "./strategies.mts";
const asToday = (raw: any) => {
  const openShare = typeof raw.openShare === "number" ? raw.openShare : openShareFor(raw);
  return { ...raw, openShare, segments: pricedForABusiness({ segments: raw.segments, cities: raw.cities, baseUnitCost: raw.baseUnitCost, openShare }) };
};
const ALL = [...(NICHES as any[]).map((n) => ({ id: n.id, niche: n })), ...["cairnwait","kilnshare"].map((f) => ({ id: f, niche: asToday(JSON.parse(readFileSync(`.sim-lab/${f}.json`,"utf8"))) }))];
const SEEDS = ["a","d","h","m","q","t","w","y"];
const med = (v: number[]) => { const s = [...v].sort((a,b)=>a-b); return (s[3]+s[4])/2; };
let worst = 0;
for (const { id, niche } of ALL) {
  const cut = med(SEEDS.map((s) => (season(niche, s, "grower", true) as any).worth));
  const keep = med(SEEDS.map((s) => (season(niche, s, "growerBigPlant", true) as any).worth));
  const ratio = keep / Math.max(1, cut);
  worst = Math.max(worst, ratio);
  console.log(`${id.padEnd(17)} cutting the plant ${Math.round(cut).toLocaleString().padStart(11)} · keeping it ${Math.round(keep).toLocaleString().padStart(11)} · empty room is worth ${ratio.toFixed(2)}x`);
}
console.log(`worst: ${worst.toFixed(2)}x`);
