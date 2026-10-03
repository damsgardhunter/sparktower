import { nicheById } from "@shared/simulation/niches";
import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number,n: any)=>s+Number(n||0),0);
const niche: any = nicheById("restaurant_chain")!;
const KEYS = ["revenue","costToServe","salaries","marketing","product","operations","idleCapacity","interest","capacity"];
for (const cad of ["monthly","quarterly"] as const) {
  const periods = cad === "monthly" ? 12 : 4;
  const spans = 4 * periods;
  let world: World = buildWorld({ seasonId: "w", niche, cadence: cad, teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  let previous: any; const tot: Record<string, number> = {};
  let bankrupt = false;
  for (let p = 1; p <= spans; p++) {
    const me: any = world.companies.find((c: any)=>c.id==="me")!;
    const b = Math.max(0, Number(me.cash) * 0.12 * (4 / periods));
    const want: any = { ceo:{focus:"growth"}, cmo:{brandSpend:Math.round(b*0.25),performanceSpend:Math.round(b*0.15)},
      cto:{featureSpend:Math.round(b*0.2),reliabilitySpend:Math.round(b*0.2)},
      coo:{capacityTarget:Math.max(Number(me.capacity)||0,Math.round(held(me)*2)),supportSpend:Math.round(b*0.1)} };
    const filed: any = { companyId: "me" };
    for (const r of ROLES) filed[r] = { ...defaultDraft(r, me, previous?.[r]), ...(want[r]??{}) };
    const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], undefined, {});
    const r: any = out.reports.find((x: any)=>x.companyId==="me");
    if (r.bankrupt) bankrupt = true;
    for (const k of KEYS) tot[k] = (tot[k] ?? 0) + Number((r.pnl ?? {})[k] ?? 0);
    if (p % periods === 0) {
      const uc = ((out.world.companies.find((c: any)=>c.id==="me") as any).unitCost ?? 0);
      console.log(`    ${cad} year ${p/periods}: unitCost ${uc.toFixed(2)}`);
    }
    if (p === periods * 2) {
      const pn: any = r.pnl ?? {};
      const cust = held(out.world.companies.find((c: any)=>c.id==="me"));
      console.log(`  ${cad} at year 2: customers ${cust} · revenue/period ${Math.round(r.revenue).toLocaleString()} · costToServe/period ${Math.round(pn.costToServe??0).toLocaleString()} · revenue per customer ${(r.revenue/Math.max(1,cust)).toFixed(2)} · cost per customer ${((pn.costToServe??0)/Math.max(1,cust)).toFixed(2)} · price ${(out.world.companies.find((c: any)=>c.id==="me") as any).price} · techDebt ${((out.world.companies.find((c: any)=>c.id==="me") as any).techDebt ?? 0).toFixed(1)} · unitCost ${((out.world.companies.find((c: any)=>c.id==="me") as any).unitCost ?? 0).toFixed(2)} · stock ${((out.world.companies.find((c: any)=>c.id==="me") as any).stock ?? 0)}`);
    }
    previous = filed; world = out.world;
  }
  console.log(`${cad.padEnd(10)} over 4 years${bankrupt ? " (BANKRUPT)" : ""}: ` + KEYS.map((k) => `${k} ${Math.round(tot[k]).toLocaleString()}`).join(" | "));
}
