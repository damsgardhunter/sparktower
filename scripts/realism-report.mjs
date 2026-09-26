/**
 * Does a season look like a business?
 *
 * Not whether it balances — the tests do that — but whether the numbers it
 * produces are the numbers a company produces. A simulation can be perfectly
 * self-consistent and still describe something nobody would recognise, and
 * the only way to catch that is to put its output next to what real firms
 * actually report.
 *
 *   npm run sim:realism
 *
 * The anchors at the bottom are deliberately wide. They are there to catch a
 * market that has wandered off, not to pin one down.
 */
import { buildWorld } from "../shared/simulation/season.ts";
import { resolveYear } from "../shared/simulation/resolve.ts";
import { NICHES } from "../shared/simulation/niches.ts";
import { ROLES } from "../shared/simulation/types.ts";
import { botDecision } from "../shared/simulation/bots.ts";

const pct = (x) => (x*100).toFixed(0) + "%";
const rows = [];
for (const niche of NICHES) {
  const stats = { gross: [], op: [], rpe: [], growth: [], leader: [], hhi: [], prices: [], salaryShare: [], swing: [] };
  for (let s = 0; s < 3; s++) {
    let world = { ...buildWorld({ seasonId:`r-${niche.id}-${s}`, niche, teams:[{id:"us",name:"Us",seats:[...ROLES]}] }), periodsPerYear:1 };
    let prev = {}, lastRev = null, lastProfit = null;
    for (let y = 1; y <= 14; y++) {
      const me = world.companies.find(c=>c.id==="us"); if(!me||me.bankruptSince) break;
      const d = { companyId:"us" };
      for (const r of ROLES) d[r] = botDecision({ventureId:"us",year:y,role:r,company:me,previous:prev[r],niche,rivals:world.companies.filter(c=>c.id!=="us"),skill:"survivor",periods:1});
      prev = d;
      const out = resolveYear({...world, year:y},[d]);
      world = out.world;
      const rep = out.reports.find(r=>r.companyId==="us");
      const p = rep?.pnl;
      if (p && p.revenue > 0) {
        stats.gross.push((p.revenue - p.costToServe) / p.revenue);
        stats.op.push((rep.profit ?? 0) / p.revenue);
        stats.salaryShare.push(p.salaries / p.revenue);
        const heads = Math.max(1, (d.coo?.headcount ?? 0) + 5);
        stats.rpe.push(p.revenue / heads);
        if (lastRev) stats.growth.push(p.revenue / lastRev - 1);
        if (lastProfit !== null && p.revenue > 0) stats.swing.push(Math.abs((rep.profit ?? 0) - lastProfit) / p.revenue);
        lastRev = p.revenue; lastProfit = rep.profit ?? 0;
      }
      // market structure
      const held = world.companies.map(c => Object.values(c.customers??{}).reduce((a,b)=>a+b,0));
      const total = held.reduce((a,b)=>a+b,0) || 1;
      const shares = held.map(h => h/total).sort((a,b)=>b-a);
      stats.leader.push(shares[0]);
      stats.hhi.push(shares.reduce((a,x)=>a+x*x,0));
      const ps = world.companies.filter(c=>c.price>0).map(c=>c.price);
      stats.prices.push(Math.max(...ps) / Math.max(1, Math.min(...ps)));
    }
  }
  const med = a => a.length ? [...a].sort((x,y)=>x-y)[Math.floor(a.length/2)] : 0;
  rows.push({ n: niche.name.slice(0,18), gross: med(stats.gross), op: med(stats.op), rpe: med(stats.rpe),
    growth: med(stats.growth), leader: med(stats.leader), hhi: med(stats.hhi), spread: med(stats.prices),
    sal: med(stats.salaryShare), swing: med(stats.swing) });
}
console.log("\nDoes it look like a business? (survivor play, median over 14 years x 3 seeds)\n");
console.log("market             gross%  op%  salary%   rev/head   yoy growth  leader  HHI  price spread  profit swing");
for (const r of rows) {
  console.log(r.n.padEnd(19) + pct(r.gross).padStart(6) + pct(r.op).padStart(6) + pct(r.sal).padStart(8)
    + ("£"+Math.round(r.rpe/1000)+"k").padStart(11) + pct(r.growth).padStart(12) + pct(r.leader).padStart(8)
    + r.hhi.toFixed(2).padStart(6) + (r.spread.toFixed(1)+"x").padStart(14) + pct(r.swing).padStart(14));
}
console.log(`
Real-world anchors: gross 20-80%, operating 5-25%, salaries 15-40% of revenue,
revenue/head £80-400k, growth 5-40%, leader share 15-40%, HHI 0.1-0.25,
price spread 1.5-3x, profit swing under 15% of revenue.`);
