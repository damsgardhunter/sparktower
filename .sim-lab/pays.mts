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
console.log("market            best plan by end value (median over 8 seeds)      lean's rank");
for (const { id, niche } of ALL) {
  const med: Record<string, number> = {};
  for (const p of [...REAL, "nothing"]) {
    const vals = SEEDS.map((s) => (season(niche, s, p, true) as any).worth).sort((a, b) => a - b);
    med[p] = (vals[3] + vals[4]) / 2;
  }
  const order = Object.entries(med).sort((a, b) => b[1] - a[1]);
  const rank = order.findIndex(([p]) => p === "lean") + 1;
  const nothingRank = order.findIndex(([p]) => p === "nothing") + 1;
  console.log(`${id.padEnd(17)} ${order.slice(0,3).map(([p, v]) => `${p} ${Math.round(v).toLocaleString()}`).join(" > ").padEnd(52)} ${rank}/7  (doing nothing ranks ${nothingRank}/7)`);
}
