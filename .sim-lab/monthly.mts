import { nicheById } from "@shared/simulation/niches";
import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number,n: any)=>s+Number(n||0),0);
const niche: any = nicheById("restaurant_chain")!;
for (const [cad, spans] of [["monthly", 24], ["quarterly", 16]] as const) {
  let world: World = buildWorld({ seasonId: "w", niche, cadence: cad as any, teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  const me0: any = world.companies.find((c: any)=>c.id==="me");
  console.log(`\n=== ${cad} === opening cash ${Math.round(me0.cash).toLocaleString()} plant ${me0.capacity}`);
  let previous: any;
  for (let p = 1; p <= spans; p++) {
    const me: any = world.companies.find((c: any)=>c.id==="me")!;
    const b = Math.max(0, Number(me.cash) * 0.12);
    const want: any = { ceo:{focus:"growth"}, cmo:{brandSpend:Math.round(b*0.25),performanceSpend:Math.round(b*0.15)},
      cto:{featureSpend:Math.round(b*0.2),reliabilitySpend:Math.round(b*0.2)},
      coo:{capacityTarget:Math.max(Number(me.capacity)||0,Math.round(held(me)*2)),supportSpend:Math.round(b*0.1)} };
    const filed: any = { companyId: "me" };
    for (const r of ROLES) filed[r] = { ...defaultDraft(r, me, previous?.[r]), ...(want[r]??{}) };
    const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], undefined, {});
    const r: any = out.reports.find((x: any)=>x.companyId==="me");
    if (p === 2) { const per = cad === "monthly" ? 12 : 4; const pn: any = r.pnl ?? {};
      console.log("  annualised at p2: " + ["revenue","costToServe","salaries","marketing","product","operations","idleCapacity","interest"].map((k) => `${k} ${Math.round((pn[k]??0)*per).toLocaleString()}`).join(" | "));
      console.log(`  annualised profit ${Math.round((pn.profit??0)*per).toLocaleString()}`); }
    previous = filed; world = out.world;
  }
}
