import { NICHES } from "@shared/simulation/niches";
import { PLANS, season } from "./strategies.mts";
const SEEDS = ["a","d","h","m","q","t","w","y"];
const ALLP = ["grower","growerBigPlant","nothing"];
const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return (s[3] + s[4]) / 2; };
for (const id of ["restaurant_chain"]) {
  const niche: any = (NICHES as any[]).find((n) => n.id === id);
  console.log(`\n=== ${id} (median over 8 seeds, events on) ===`);
  console.log("plan       end revenue/qtr   end cash      debt    last profit   value today");
  for (const p of ALLP) {
    const rs = SEEDS.map((s) => season(niche, s, p, true) as any);
    console.log(`${p.padEnd(10)} ${Math.round(med(rs.map(r=>r.revenue))).toLocaleString().padStart(13)} ${Math.round(med(rs.map(r=>r.cash))).toLocaleString().padStart(12)} ${Math.round(med(rs.map(r=>r.debt))).toLocaleString().padStart(9)} ${Math.round(med(rs.map(r=>r.profit))).toLocaleString().padStart(12)} ${Math.round(med(rs.map(r=>r.worth))).toLocaleString().padStart(12)}`);
  }
}
