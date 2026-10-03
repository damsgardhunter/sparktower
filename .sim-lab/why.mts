import { readFileSync } from "node:fs";
import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { appealFor, regionalReach } from "@shared/simulation/market";
import { topPriceCeiling } from "@shared/simulation/criteria";
import { ROLES, type TeamDecisions } from "@shared/simulation/types";
const niche: any = JSON.parse(readFileSync(".sim-lab/rotaread.json", "utf8"));
for (const seed of ["w", "h"]) {
  const world = buildWorld({ seasonId: seed, niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  const me: any = world.companies.find((c: any) => c.id === "me");
  const ceiling = topPriceCeiling(niche.segments, 1);
  console.log(`\nseed ${seed}: demand ${(world.economy as any).demand} · cost ${(world.economy as any).costIndex} · my price $${me.price} · room ${Math.round(me.capacity)} · reach ${(regionalReach(me, niche) * 100).toFixed(0)}%`);
  const filed: any = { companyId: "me" };
  for (const r of ROLES) filed[r] = { ...defaultDraft(r, me) };
  const out = resolveYear({ ...world, year: 1 }, [filed as TeamDecisions], undefined, { withoutEvent: true });
  const rep: any = out.reports.find((x: any) => x.companyId === "me");
  for (const s of (rep.segments ?? [])) {
    console.log(`  ${s.name.slice(0, 20).padEnd(22)} fresh ${Math.round(s.fresh)} · pickedUp ${Math.round(s.pickedUp)} · end ${Math.round(s.end)} · shortOf ${JSON.stringify(s.shortOf ?? [])}`);
  }
}
