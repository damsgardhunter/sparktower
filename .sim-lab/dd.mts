import { buildWorld } from "@shared/simulation/season";
import { nicheById } from "@shared/simulation/niches";
import { botDecision } from "@shared/simulation/bots";
import { resolveYear } from "@shared/simulation/resolve";
import { ROLES } from "@shared/simulation/types";
for (const nid of ["drone_delivery", "project_saas"]) {
  const niche: any = nicheById(nid)!;
  const id = "b2";
  let world: any = buildWorld({ seasonId: "grow", niche, cadence: "quarterly", teams: [{ id, name: id, seats: [...ROLES], botRun: true }] });
  let previous: any;
  console.log(`\n=== ${nid} (bot ${id}) ===`);
  for (let p = 1; p <= 16; p++) {
    const me: any = world.companies.find((c: any) => c.id === id)!;
    const filed: any = { companyId: id };
    for (const r of ROLES) filed[r] = botDecision({ ventureId: id, year: p, role: r, company: me, previous: previous?.[r], niche, rivals: [], skill: "survivor" });
    const out = resolveYear({ ...world, year: p }, [filed], undefined, { withoutEvent: true });
    previous = filed; world = out.world;
    const after: any = world.companies.find((c: any) => c.id === id)!;
    const held = Object.values(after.customers ?? {}).reduce((s: number, n: any) => s + n, 0);
    const rep: any = out.reports.find((r: any) => r.companyId === id);
    if (p <= 8 || p === 16) console.log(`  p${String(p).padStart(2)} cash ${Math.round(after.cash).toLocaleString().padStart(11)} debt ${Math.round(after.debt).toLocaleString().padStart(10)} cap ${String(after.capacity).padStart(7)} held ${String(held).padStart(7)} rev ${Math.round(rep?.revenue ?? 0).toLocaleString().padStart(10)} profit ${Math.round(rep?.profit ?? 0).toLocaleString().padStart(11)}`);
  }
}
