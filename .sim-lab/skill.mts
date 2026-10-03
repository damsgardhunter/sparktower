import { NICHES, nicheById } from "@shared/simulation/niches";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { botDecision } from "@shared/simulation/bots";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const MARKETS = ["dating_apps","podcasts","mmos","project_saas"];
const run = (id: string, skill: "survivor"|"filler", seed: string) => {
  const niche: any = nicheById(id)!;
  let world: World = buildWorld({ seasonId: seed, niche, teams: [{ id: "us", name: "Us", seats: [...ROLES] }] });
  let previous: any; let last: any;
  for (let p = 1; p <= 14; p++) {
    const me: any = world.companies.find((c: any)=>c.id==="us")!;
    const filed: any = { companyId: "us" };
    for (const r of ROLES) filed[r] = botDecision({ ventureId: "us", year: p, role: r, company: me, previous: previous?.[r], niche, rivals: world.companies.filter((c)=>c.id!=="us"), skill });
    const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], economyFor(seed, p, 1));
    last = out.reports.find((x: any)=>x.companyId==="us"); previous = filed; world = out.world;
  }
  return { cash: last.cash, value: last.value, cust: last.customers };
};
for (const id of MARKETS) {
  for (const skill of ["survivor","filler"] as const) {
    const rs = [0,1,2,3,4,5,6,7,8,9,10,11].map((i) => run(id, skill, `skill-${id}-${i}`));
    const mean = (f: (r: any)=>number) => Math.round(rs.reduce((a,r)=>a+f(r),0)/rs.length);
    console.log(`${id.padEnd(16)} ${skill.padEnd(9)} cash>6m ${rs.filter(r=>r.cash>6_000_000).length}/12 · mean cash ${mean(r=>r.cash).toLocaleString().padStart(12)} · mean value ${mean(r=>r.value).toLocaleString().padStart(12)}`);
  }
}
