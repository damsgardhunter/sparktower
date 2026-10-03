import { readFileSync } from "node:fs";
import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number, n: any) => s + Number(n || 0), 0);
const niche: any = JSON.parse(readFileSync(".sim-lab/rotaread.json", "utf8"));
const total = niche.segments.reduce((s: number, x: any) => s + x.size, 0);
console.log("home region        weight  entry     → after 16q: customers · worth · quality");
for (const city of niche.cities) {
  let world: World = buildWorld({ seasonId: "h", niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  world = { ...world, companies: world.companies.map((c: any) => (c.id === "me" ? { ...c, cities: [city.id] } : c)) };
  let previous: any; let last: any;
  for (let p = 1; p <= 16; p++) {
    const me: any = world.companies.find((c: any) => c.id === "me")!;
    const b = Math.max(0, Number(me.cash) * 0.12);
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
  console.log(`${city.name.slice(0, 16).padEnd(18)} ${(city.weight * 100).toFixed(0).padStart(3)}% $${String(Math.round(city.entryCost)).padStart(6)}  → ${String(Math.round(held(me))).padStart(6)} · $${Math.round(last.value ?? 0).toLocaleString().padStart(9)} · q${Math.round(last.quality)}`);
}
