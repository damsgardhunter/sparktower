import { nicheById } from "@shared/simulation/niches";
import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { PLANS, season } from "./strategies.mts";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number,n: any)=>s+Number(n||0),0);
const niche: any = nicheById("construction")!;
/* find a bankrupt run */
let target: any = null;
for (const seed of ["a","d","h","m","q","t","w","y"]) for (const p of Object.keys(PLANS).filter((x) => x !== "nothing")) {
  const r: any = season(niche, seed, p, true);
  if (r.bankrupt && !target) { target = { seed, p }; }
}
console.log("bankrupt run:", JSON.stringify(target));
if (target) {
  let world: World = buildWorld({ seasonId: target.seed, niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  const me0: any = world.companies.find((c: any)=>c.id==="me");
  console.log(`opening cash ${Math.round(me0.cash).toLocaleString()} · plant ${me0.capacity} · price ${me0.price} · segments ${niche.segments.map((s: any)=>`${s.size}@${s.referencePrice}`).join("/")}`);
  let previous: any;
  for (let p = 1; p <= 10; p++) {
    const me: any = world.companies.find((c: any)=>c.id==="me")!;
    (me as any).lastRevenue = 0;
    const want: any = PLANS[target.p](p, me, niche);
    const filed: any = { companyId: "me" };
    for (const r of ROLES) filed[r] = { ...defaultDraft(r, me, previous?.[r]), ...(want[r]??{}) };
    const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], undefined, {});
    const r: any = out.reports.find((x: any)=>x.companyId==="me");
    const pn = r.pnl ?? {};
    console.log(`p${p} cust ${String(held(out.world.companies.find((c: any)=>c.id==="me"))).padStart(5)} rev ${Math.round(r.revenue).toLocaleString().padStart(10)} | serve ${Math.round(pn.costToServe??0).toLocaleString().padStart(8)} sal ${Math.round(pn.salaries??0).toLocaleString().padStart(7)} mktg ${Math.round(pn.marketing??0).toLocaleString().padStart(8)} idle ${Math.round(pn.idleCapacity??0).toLocaleString().padStart(8)} | profit ${Math.round(r.profit).toLocaleString().padStart(10)} cash ${Math.round(r.cash).toLocaleString().padStart(10)} ${r.bankrupt?"BANKRUPT":""} ${(out as any).event?.headline ?? ""}`);
    previous = filed; world = out.world;
  }
}
