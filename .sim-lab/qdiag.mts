import { readFileSync } from "node:fs";
import { openShareFor, pricedForABusiness } from "@shared/simulation/custom-market";
import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { PLANS } from "./strategies.mts";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number,n: any)=>s+Number(n||0),0);
const raw: any = JSON.parse(readFileSync(".sim-lab/quorumcast.json","utf8"));
const openShare = raw.openShare ?? openShareFor(raw);
const niche = { ...raw, openShare, segments: pricedForABusiness({ segments: raw.segments, cities: raw.cities, baseUnitCost: raw.baseUnitCost, openShare }) };
console.log("segments:", niche.segments.map((s: any)=>`${s.name.slice(0,18)} ${s.size}@${s.referencePrice}`).join(" | "));
let world: World = buildWorld({ seasonId: "a", niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
const me0: any = world.companies.find((c: any)=>c.id==="me");
console.log(`opening cash ${Math.round(me0.cash).toLocaleString()} · plant ${me0.capacity} · price ${me0.price} · home ${me0.cities}`);
let previous: any;
for (let p = 1; p <= 8; p++) {
  const me: any = world.companies.find((c: any)=>c.id==="me")!;
  const want: any = PLANS.grower(p, me, niche);
  const filed: any = { companyId: "me" };
  for (const r of ROLES) filed[r] = { ...defaultDraft(r, me, previous?.[r]), ...(want[r]??{}) };
  const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], undefined, { withoutEvent: true });
  const r: any = out.reports.find((x: any)=>x.companyId==="me");
  const pn = r.pnl ?? {};
  console.log(`p${p} cust ${String(held(out.world.companies.find((c: any)=>c.id==="me"))).padStart(5)} rev ${Math.round(r.revenue).toLocaleString().padStart(8)} | serve ${Math.round(pn.costToServe??0)} sal ${Math.round(pn.salaries??0)} mktg ${Math.round(pn.marketing??0)} prod ${Math.round(pn.product??0)} ops ${Math.round(pn.operations??0)} idle ${Math.round(pn.idleCapacity??0)} | profit ${Math.round(r.profit).toLocaleString().padStart(8)} cash ${Math.round(r.cash).toLocaleString().padStart(9)}`);
  previous = filed; world = out.world;
}
