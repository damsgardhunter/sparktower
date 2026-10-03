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
const ALLP = [...Object.keys(PLANS).filter((p) => p !== "nothing"), "nothing"];
/* Candidate scores. `worth` is what the engine returns today. */
/* `worth` today is sales x 1.2 + assets - debt. Annual figures: a period is a quarter here. */
const FORMULAS: Record<string, (r: any) => number> = {
  today: (r) => r.worth,
  "max(sales x1.2, earnings x8)": (r) => Math.max(r.worth, r.profit * 4 * 8 - r.debt),
  "sales x1.2 + earnings x4": (r) => Math.max(0, r.worth + r.profit * 4 * 4),
  "sales x1.2 + earnings x8": (r) => Math.max(0, r.worth + r.profit * 4 * 8),
  "sales x0.8 + earnings x8": (r) => Math.max(0, r.worth * (0.8/1.2) + r.profit * 4 * 8),
};
const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return (s[3] + s[4]) / 2; };
console.log("formula                 | where filing nothing ranks (of 8), per market");
const cache: Record<string, Record<string, any[]>> = {};
for (const { id, niche } of ALL) { cache[id] = {}; for (const p of ALLP) cache[id][p] = SEEDS.map((s) => season(niche, s, p, true)); }
for (const [name, f] of Object.entries(FORMULAS)) {
  const ranks: string[] = [];
  for (const { id } of ALL) {
    const scores = ALLP.map((p) => ({ p, v: med(cache[id][p].map(f)) })).sort((a, b) => b.v - a.v);
    ranks.push(`${id.slice(0,4)}:${scores.findIndex((x) => x.p === "nothing") + 1}/${ALLP.length}`);
  }
  console.log(`${name.padEnd(23)} | ${ranks.join(" ")}`);
}
