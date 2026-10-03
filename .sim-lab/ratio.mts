import { readFileSync } from "node:fs";
import { NICHES } from "@shared/simulation/niches";
import { officerCost } from "@shared/simulation/decisions";
import { marketScale } from "@shared/simulation/world";
import { TRULY_OPEN_SHARE, openShareOf } from "@shared/simulation/incumbents";
const customs = ["rotaread","kilnshare","tallyhold"].map((n) => JSON.parse(readFileSync(`.sim-lab/${n}.json`,"utf8")));
console.log("market             scale  biggest-seg price  contrib  payroll/yr  breakEven  homeReach  BE/reach");
for (const niche of [...(NICHES as any[]), ...customs]) {
  const biggest = [...niche.segments].sort((a: any,b: any)=>b.size-a.size)[0];
  const contribution = Math.max(1, biggest.referencePrice - niche.baseUnitCost);
  const scale = marketScale(niche);
  const payroll = officerCost({ officers: 1, scale } as any);
  const be = payroll / contribution;
  const people = niche.segments.reduce((s: number,x: any)=>s+x.size,0);
  const topW = Math.max(...niche.cities.map((c: any)=>c.weight));
  const reach = people * topW * openShareOf(niche);
  const ratio = be / Math.max(1, reach);
  const flag = ratio > 0.05 ? "  <-- break-even beyond reach" : "";
  console.log(`${niche.id.padEnd(18)} ${scale.toFixed(3)} ${String(biggest.referencePrice).padStart(14)} ${contribution.toFixed(1).padStart(8)} ${Math.round(payroll).toLocaleString().padStart(11)} ${Math.round(be).toLocaleString().padStart(10)} ${Math.round(reach).toLocaleString().padStart(10)} ${(ratio*100).toFixed(1).padStart(8)}%${flag}`);
}
