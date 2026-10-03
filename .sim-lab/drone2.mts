import { nicheById } from "@shared/simulation/niches";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number,n: any)=>s+Number(n||0),0);
const niche: any = nicheById("drone_delivery")!;
for (const [label, ev] of [["events on", {}], ["events off", { withoutEvent: true }]] as any)
for (const rate of [0, 0.03, 0.12]) {
  let world: World = buildWorld({ seasonId: "h", niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  let previous: any; let last: any; const events: string[] = [];
  for (let p = 1; p <= 16; p++) {
    const me: any = world.companies.find((c: any)=>c.id==="me")!;
    const b = Math.max(0, Number(me.cash) * rate);
    const want: any = { ceo:{focus:p<=6?"quality":"growth"},
      cmo:{brandSpend:Math.round(b*0.25),performanceSpend:Math.round(b*0.15)},
      cto:{featureSpend:Math.round(b*0.2),reliabilitySpend:Math.round(b*0.2),researchSpend:Math.round(b*0.1)},
      coo:{capacityTarget:Math.max(Number(me.capacity)||0,Math.round(held(me)*2)),supportSpend:Math.round(b*0.1)} };
    const filed: any = { companyId: "me" };
    for (const r of ROLES) filed[r] = { ...defaultDraft(r, me, previous?.[r]), ...(want[r]??{}) };
    const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], economyFor("h", p, 4), ev);
    last = out.reports.find((x: any)=>x.companyId==="me");
    if ((out as any).event?.headline) events.push(`p${p}:${(out as any).event.headline.slice(0,22)}`);
    previous = filed; world = out.world;
  }
  console.log(`${label} rate ${String(rate).padEnd(5)} worth ${Math.round(last.value).toLocaleString().padStart(10)} cust ${String(last.customers).padStart(6)} profit ${Math.round(last.profit).toLocaleString().padStart(9)} cash ${Math.round(last.cash).toLocaleString().padStart(10)}`);

}
