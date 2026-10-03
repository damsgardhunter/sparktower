import { buildWorld, economyFor, decisionsForYear } from "@shared/simulation/season";
import { nicheById } from "@shared/simulation/niches";
import { resolveYear } from "@shared/simulation/resolve";

import { ROLES } from "@shared/simulation/types";
import { marketPotential } from "@shared/simulation/world";
const niche: any = nicheById("dating_apps")!;
const ids = ["t0","t1","t2","t3","t4"];
let world: any = buildWorld({ seasonId: "crowd", niche, teams: ids.map((id) => ({ id, name: id, seats: [...ROLES] as any })) });
console.log("economy y1 demand", economyFor("crowd", 1).demand);
let reports: any[] = [];
const previous = new Map<string, any>();
for (let year = 1; year <= 14; year++) {
  const decisions: any[] = [];
  for (const id of ids) {
    const company = world.companies.find((c: any) => c.id === id)!;
    const { decisions: theirs } = decisionsForYear({ company, niche, submitted: {}, previous: previous.get(id) } as any);
    decisions.push({ ...theirs, companyId: id });
  }
  const out = resolveYear({ ...world, year }, decisions, economyFor("crowd", year));
  world = out.world; reports = out.reports;
}
const bar = marketPotential(niche) * 0.04;
console.log("bar (4% of market potential):", Math.round(bar).toLocaleString());
for (const r of reports.filter((x: any) => ids.includes(x.companyId)).sort((a: any, b: any) => b.founderValue - a.founderValue)) {
  console.log(`  ${r.companyId} founderValue ${Math.round(r.founderValue).toLocaleString().padStart(14)} · customers ${String(r.customers).padStart(7)} · bankrupt ${r.bankrupt}`);
}
