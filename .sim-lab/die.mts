import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number, n: any) => s + Number(n || 0), 0);
for (const id of ["drone_delivery", "project_saas"]) {
  const niche: any = nicheById(id)!;
  let world: World = buildWorld({ seasonId: "a", niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  const me0: any = world.companies.find((c: any) => c.id === "me");
  console.log(`\n=== ${id} === opening cash ${Math.round(me0.cash).toLocaleString()} · plant ${me0.capacity.toLocaleString()} · price ${me0.price}`);
  let previous: any;
  for (let p = 1; p <= 6; p++) {
    const me: any = world.companies.find((c: any) => c.id === "me")!;
    const b = Math.max(0, Number(me.cash) * 0.12);
    const want: any = {
      ceo: { focus: "quality" },
      cmo: { brandSpend: Math.round(b * 0.25), performanceSpend: Math.round(b * 0.15) },
      cto: { featureSpend: Math.round(b * 0.2), reliabilitySpend: Math.round(b * 0.2) },
      coo: { capacityTarget: Math.max(Number(me.capacity) || 0, Math.round(held(me) * 2)), supportSpend: Math.round(b * 0.1) },
    };
    const filed: any = { companyId: "me" };
    for (const r of ROLES) filed[r] = { ...defaultDraft(r, me, previous?.[r]), ...(want[r] ?? {}) };
    const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], undefined, { withoutEvent: true });
    const r: any = out.reports.find((x: any) => x.companyId === "me");
    const pnl = r.pnl ?? {};
    if (p === 1) console.log("  pnl keys:", JSON.stringify(Object.fromEntries(Object.entries(pnl).map(([k,v]:any)=>[k,Math.round(Number(v)||0)]))));
    console.log(`p${p} held ${String(held(out.world.companies.find((c:any)=>c.id==="me"))).padStart(6)} cap ${String((out.world.companies.find((c:any)=>c.id==="me") as any).capacity).padStart(7)} rev ${Math.round(r.revenue).toLocaleString().padStart(9)} | costToServe ${Math.round(pnl.costToServe??0).toLocaleString().padStart(8)} salaries ${Math.round(pnl.salaries??0).toLocaleString().padStart(8)} room ${Math.round(pnl.room??0).toLocaleString().padStart(9)} mktg ${Math.round(pnl.marketing??0).toLocaleString().padStart(8)} ops ${Math.round(pnl.operations??0).toLocaleString().padStart(8)} | profit ${Math.round(r.profit).toLocaleString().padStart(10)} cash ${Math.round(r.cash).toLocaleString().padStart(10)}`);
    previous = filed; world = out.world;
  }
}
