import { readFileSync } from "node:fs";
import { openShareFor, pricedForABusiness } from "@shared/simulation/custom-market";
import { PLANS, season } from "./strategies.mts";
const asToday = (raw: any) => {
  const openShare = typeof raw.openShare === "number" ? raw.openShare : openShareFor(raw);
  return { ...raw, openShare, segments: pricedForABusiness({ segments: raw.segments, cities: raw.cities, baseUnitCost: raw.baseUnitCost, openShare }) };
};
const SEEDS = ["a","d","h","m","q","t","w","y"];
const REAL = Object.keys(PLANS).filter((p) => p !== "nothing");
for (const n of ["quorumcast","hearthmap"]) {
  const niche = asToday(JSON.parse(readFileSync(`.sim-lab/${n}.json`,"utf8")));
  const rows: string[] = [];
  for (const seed of SEEDS) {
    let best = 0, bestPlan = "";
    for (const p of REAL) { const r: any = season(niche, seed, p, true); if (r.prof > best) { best = r.prof; bestPlan = p; } }
    rows.push(`${seed}:${best}${best ? `(${bestPlan.slice(0,4)})` : ""}`);
  }
  console.log(`${n.padEnd(11)} best profitable quarters per seed: ${rows.join(" ")}`);
}
