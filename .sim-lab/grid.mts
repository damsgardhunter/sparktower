import { readFileSync } from "node:fs";
import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number, n: any) => s + Number(n || 0), 0);
const niche: any = JSON.parse(readFileSync(".sim-lab/rotaread.json", "utf8"));
for (const seed of ["w", "h", "x", "y"]) {
  const row: string[] = [];
  for (const rate of [0, 0.06, 0.12, 0.25]) {
    let world: World = buildWorld({ seasonId: seed, niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
    let previous: any; let last: any;
    for (let p = 1; p <= 16; p++) {
      const me: any = world.companies.find((c: any) => c.id === "me")!;
      const b = Math.max(0, Number(me.cash) * rate);
      const want: any = {
        ceo: { focus: p <= 6 ? "quality" : "growth" },
        cmo: { brandSpend: Math.round(b * 0.25), performanceSpend: Math.round(b * 0.15) },
        cto: { featureSpend: Math.round(b * 0.2), reliabilitySpend: Math.round(b * 0.2), researchSpend: Math.round(b * 0.1) },
        coo: { capacityTarget: Math.max(Number(me.capacity) || 0, Math.round(held(me) * 2)), supportSpend: Math.round(b * 0.1) },
      };
      const filed: any = { companyId: "me" };
      for (const r of ROLES) filed[r] = { ...defaultDraft(r, me, previous?.[r]), ...(want[r] ?? {}) };
      const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], undefined, { withoutEvent: true });
      last = out.reports.find((x: any) => x.companyId === "me"); previous = filed; world = out.world;
    }
    const me: any = world.companies.find((c: any) => c.id === "me")!;
    row.push(`${String(Math.round(held(me))).padStart(4)}c/$${Math.round((last.value ?? 0) / 1000)}k`);
  }
  console.log(`seed ${seed}: spend 0% ${row[0]} · 6% ${row[1]} · 12% ${row[2]} · 25% ${row[3]}`);
}
