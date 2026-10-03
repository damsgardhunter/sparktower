import { buildWorld } from "@shared/simulation/season";
import { nicheById } from "@shared/simulation/niches";
import { botDecision } from "@shared/simulation/bots";
import { resolveYear } from "@shared/simulation/resolve";
import { ROLES } from "@shared/simulation/types";
const niche: any = nicheById("drone_delivery")!;
for (const id of ["b1","b2","b3","b4","b5","b6"]) {
  let world: any = buildWorld({ seasonId: "grow", niche, cadence: "quarterly", teams: [{ id, name: id, seats: [...ROLES], botRun: true }] });
  let previous: any;
  let peakLoad = 0;
  for (let p = 1; p <= 16; p++) {
    const me: any = world.companies.find((c: any) => c.id === id)!;
    const held = Object.values(me.customers ?? {}).reduce((s: number, n: any) => s + n, 0);
    peakLoad = Math.max(peakLoad, me.capacity > 0 ? held / me.capacity : 0);
    const filed: any = { companyId: id };
    for (const r of ROLES) filed[r] = botDecision({ ventureId: id, year: p, role: r, company: me, previous: previous?.[r], niche, rivals: [], skill: "survivor" });
    const out = resolveYear({ ...world, year: p }, [filed], undefined, { withoutEvent: true });
    previous = filed; world = out.world;
  }
  const me: any = world.companies.find((c: any) => c.id === id)!;
  const cheapest = Math.min(...niche.cities.filter((c: any) => !(me.cities ?? []).includes(c.id)).map((c: any) => c.entryCost));
  console.log(`${id}: cities ${(me.cities ?? []).length} · peak load ${peakLoad.toFixed(2)} · end cash ${Math.round(me.cash).toLocaleString()} · cheapest unopened entry ${cheapest.toLocaleString()}`);
}
