import { readFileSync } from "node:fs";
import { NICHES } from "@shared/simulation/niches";
import { openShareFor, pricedForABusiness } from "@shared/simulation/custom-market";
import { PLANS, season } from "./strategies.mts";
const asToday = (raw: any) => {
  const openShare = typeof raw.openShare === "number" ? raw.openShare : openShareFor(raw);
  return { ...raw, openShare, segments: pricedForABusiness({ segments: raw.segments, cities: raw.cities, baseUnitCost: raw.baseUnitCost, openShare }) };
};
const ALL = [...(NICHES as any[]).map((n) => ({ id: n.id, niche: n })),
  ...["cairnwait","quorumcast","kilnshare","rotaread","tideturn"].map((f) => ({ id: f, niche: asToday(JSON.parse(readFileSync(`.sim-lab/${f}.json`,"utf8"))) }))];
const SEEDS = ["a","d","h","m","q","t","w","y"];
const ALLP = Object.keys(PLANS);
const med = (v: number[]) => { const s=[...v].sort((a,b)=>a-b); return (s[3]+s[4])/2; };
const data: Record<string, { p: string; worth: number; profit: number }[]> = {};
for (const { id, niche } of ALL) {
  data[id] = ALLP.map((p) => {
    const rs = SEEDS.map((s) => season(niche, s, p, true) as any);
    return { p, worth: med(rs.map(r=>r.worth)), profit: med(rs.map(r=>r.profit)) };
  });
}
/* A violation: a plan clearly making money ranked below one clearly losing it. */
const violations = (f: (r: any) => number) => {
  let bad = 0, pairs = 0;
  for (const id of Object.keys(data)) {
    const rows = data[id];
    for (const a of rows) for (const b of rows) {
      if (a.p === b.p) continue;
      if (a.profit > 0 && b.profit < 0 && Math.abs(a.profit) > 1 && Math.abs(b.profit) > 1) {
        pairs++;
        if (f(a) < f(b)) bad++;
      }
    }
  }
  return { bad, pairs };
};
const FORMULAS: Record<string, (r: any) => number> = {
  "today: sales x1.2": (r) => r.worth,
  "sales x1.2 + earnings x4": (r) => r.worth + r.profit * 4 * 4,
  "sales x1.2 + earnings x8": (r) => r.worth + r.profit * 4 * 8,
  "sales x0.6 + earnings x8": (r) => r.worth * 0.5 + r.profit * 4 * 8,
  "max(sales x1.2, earnings x10)": (r) => Math.max(r.worth, r.profit * 4 * 10),
};
console.log("formula                        profitable-ranked-below-loss-making");
for (const [name, f] of Object.entries(FORMULAS)) {
  const { bad, pairs } = violations(f);
  console.log(`${name.padEnd(30)} ${bad}/${pairs}  (${((bad/pairs)*100).toFixed(0)}%)`);
}
