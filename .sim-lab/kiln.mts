import { readFileSync } from "node:fs";
import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number, n: any) => s + Number(n||0), 0);
const base: any = JSON.parse(readFileSync(".sim-lab/kilnshare.json","utf8"));
function run(niche: any, seed: string, rate: number) {
  let world: World = buildWorld({ seasonId: seed, niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  let previous: any; let last: any; let prof = 0;
  for (let p = 1; p <= 16; p++) {
    const me: any = world.companies.find((c: any) => c.id === "me")!;
    const b = Math.max(0, Number(me.cash) * rate);
    const want: any = { ceo: { focus: p <= 6 ? "quality" : "growth" },
      cmo: { brandSpend: Math.round(b*0.25), performanceSpend: Math.round(b*0.15) },
      cto: { featureSpend: Math.round(b*0.2), reliabilitySpend: Math.round(b*0.2) },
      coo: { capacityTarget: Math.max(Number(me.capacity)||0, Math.round(held(me)*2)), supportSpend: Math.round(b*0.1) } };
    const filed: any = { companyId: "me" };
    for (const r of ROLES) filed[r] = { ...defaultDraft(r, me, previous?.[r]), ...(want[r] ?? {}) };
    const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], undefined, { withoutEvent: true });
    last = out.reports.find((x: any) => x.companyId === "me");
    if (last.profit > 0) prof++;
    previous = filed; world = out.world;
  }
  return { prof, cust: held(world.companies.find((c: any) => c.id === "me")), worth: last.value ?? 0 };
}
for (const open of [0.1, 0.3, 0.5, 0.7]) {
  const niche = { ...base, openShare: open };
  const parts: string[] = [];
  for (const rate of [0, 0.01, 0.06]) {
    let prof = 0, cust = 0;
    for (const seed of ["a","h","w"]) { const r = run(niche, seed, rate); prof = Math.max(prof, r.prof); cust = Math.max(cust, r.cust); }
    parts.push(`spend ${rate}: ${prof}/16 prof, ${cust} cust`);
  }
  console.log(`openShare ${String(open).padEnd(5)} ` + parts.join("  |  "));
}
