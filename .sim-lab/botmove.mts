import { buildWorld } from "@shared/simulation/season";
import { NICHES, nicheById } from "@shared/simulation/niches";
import { botDecision } from "@shared/simulation/bots";
import { resolveYear } from "@shared/simulation/resolve";
import { ROLES } from "@shared/simulation/types";
for (const n of NICHES) {
  const niche: any = nicheById(n.id)!;
  let moved = 0;
  for (const id of ["b1","b2","b3","b4","b5","b6"]) {
    let world: any = buildWorld({ seasonId: "grow", niche, cadence: "quarterly", teams: [{ id, name: id, seats: [...ROLES], botRun: true }] });
    let previous: any;
    for (let p = 1; p <= 16; p++) {
      const me: any = world.companies.find((c: any) => c.id === id)!;
      const filed: any = { companyId: id };
      for (const r of ROLES) filed[r] = botDecision({ ventureId: id, year: p, role: r, company: me, previous: previous?.[r], niche, rivals: [], skill: "survivor" });
      const out = resolveYear({ ...world, year: p }, [filed], undefined, { withoutEvent: true });
      previous = filed; world = out.world;
    }
    const me: any = world.companies.find((c: any) => c.id === id)!;
    if ((me.cities ?? []).length > 1) moved++;
  }
  console.log(`${n.id.padEnd(18)} ${moved}/6`);
}
