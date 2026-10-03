import { NICHES } from "@shared/simulation/niches";
import { PLANS, season } from "./strategies.mts";
const SEEDS = ["a","d","h","m","q","t","w","y"];
const ALLP = Object.keys(PLANS);
const med = (v: number[]) => { const s=[...v].sort((a,b)=>a-b); return (s[3]+s[4])/2; };
for (const id of ["drone_delivery","restaurant_chain","project_saas"]) {
  const niche: any = (NICHES as any[]).find((n) => n.id === id);
  const rows = ALLP.map((p) => {
    const rs = SEEDS.map((s) => season(niche, s, p, true) as any);
    return { p, worth: med(rs.map(r=>r.worth)), profit: med(rs.map(r=>r.profit)), rev: med(rs.map(r=>r.revenue)) };
  }).sort((a,b)=>b.worth-a.worth);
  console.log(`\n=== ${id} (median of 8 seeds, events on) ===`);
  for (const r of rows) console.log(`  ${r.p.padEnd(15)} worth ${Math.round(r.worth).toLocaleString().padStart(11)} · revenue/qtr ${Math.round(r.rev).toLocaleString().padStart(9)} · profit ${Math.round(r.profit).toLocaleString().padStart(10)}`);
}
