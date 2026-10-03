import { readFileSync } from "node:fs";
import { NICHES } from "@shared/simulation/niches";
import { openShareFor, pricedForABusiness } from "@shared/simulation/custom-market";
import { PLANS, season } from "./strategies.mts";
const asToday = (raw: any) => {
  const openShare = typeof raw.openShare === "number" ? raw.openShare : openShareFor(raw);
  return { ...raw, openShare, segments: pricedForABusiness({ segments: raw.segments, cities: raw.cities, baseUnitCost: raw.baseUnitCost, openShare }) };
};
const CUSTOM = ["cairnwait","quorumcast","kilnshare","rotaread","tideturn"];
const ALL = [...(NICHES as any[]).map((n) => ({ id: n.id, niche: n })), ...CUSTOM.map((f) => ({ id: f, niche: asToday(JSON.parse(readFileSync(`.sim-lab/${f}.json`,"utf8"))) }))];
const SEEDS = ["a","d","h","m","q","t","w","y"];
const REAL = Object.keys(PLANS).filter((p) => p !== "nothing");
console.log("market            spread | " + REAL.map((p) => p.slice(0,7).padEnd(8)).join("") + " (profitable seeds of 8, * = a bankruptcy)");
for (const { id, niche } of ALL) {
  const prices = niche.segments.map((s: any) => s.referencePrice);
  const spread = Math.max(...prices) / Math.min(...prices);
  const cells: string[] = [];
  for (const p of REAL) {
    let prof = 0, broke = 0;
    for (const seed of SEEDS) { const r: any = season(niche, seed, p, true); if (r.prof > 0) prof++; if (r.bankrupt) broke++; }
    cells.push(`${prof}${broke ? "*" : " "}      `);
  }
  console.log(`${id.padEnd(17)} ${spread.toFixed(1).padStart(5)}x | ${cells.join("")}`);
}
