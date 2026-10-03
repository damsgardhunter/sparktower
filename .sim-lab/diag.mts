import { readFileSync } from "node:fs";
import { openShareFor, pricedForABusiness } from "@shared/simulation/custom-market";
import { marketScale, marketPotential } from "@shared/simulation/world";
import { officerCost } from "@shared/simulation/decisions";
const asToday = (raw: any) => {
  const openShare = typeof raw.openShare === "number" ? raw.openShare : openShareFor(raw);
  return { ...raw, openShare, segments: pricedForABusiness({ segments: raw.segments, cities: raw.cities, baseUnitCost: raw.baseUnitCost, openShare }) };
};
for (const n of ["hedgerow","quorumcast","hearthmap","cairnwait"]) {
  const k = asToday(JSON.parse(readFileSync(`.sim-lab/${n}.json`,"utf8")));
  const people = k.segments.reduce((s: number,x: any)=>s+x.size,0);
  const big = [...k.segments].sort((a: any,b: any)=>b.size-a.size)[0];
  const contrib = Math.max(1, big.referencePrice - k.baseUnitCost);
  const pay = officerCost({ officers: 1, scale: marketScale(k) } as any);
  const topW = Math.max(...k.cities.map((c: any)=>c.weight));
  const reach = people * topW * k.openShare;
  console.log(`${n.padEnd(11)} people ${String(people).padStart(6)} · potential ${Math.round(marketPotential(k)).toLocaleString().padStart(11)}/yr · unitCost ${k.baseUnitCost} · biggest price ${big.referencePrice} (size ${big.size}) · contrib ${contrib} · payroll ${Math.round(pay).toLocaleString()} · BE ${Math.round(pay/contrib)} · reach ${Math.round(reach)} · reach/BE ${(reach/(pay/contrib)).toFixed(0)} · regions ${k.cities.length} topW ${topW.toFixed(2)}`);
}
