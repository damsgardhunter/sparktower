import { readFileSync } from "node:fs";
import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { marketScale, marketPotential } from "@shared/simulation/world";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number, n: any) => s + Number(n || 0), 0);
for (const f of ["kilnshare", "tallyhold", "rotaread"]) {
  const niche: any = JSON.parse(readFileSync(`.sim-lab/${f}.json`, "utf8"));
  let world: World = buildWorld({ seasonId: f, niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  const me0: any = world.companies.find((c: any) => c.id === "me");
  const worth = marketPotential(niche);
  let previous: any; let last: any;
  for (let p = 1; p <= 8; p++) {
    const me: any = world.companies.find((c: any) => c.id === "me")!;
    const b = Math.max(0, Number(me.cash) * 0.05);
    const filed: any = { companyId: "me" };
    for (const r of ROLES) filed[r] = { ...defaultDraft(r, me, previous?.[r]), ...(r === "cto" ? { featureSpend: Math.round(b * 0.5), reliabilitySpend: Math.round(b * 0.25), researchSpend: Math.round(b * 0.25) } : {}) };
    const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], undefined, { withoutEvent: true });
    last = out.reports.find((x: any) => x.companyId === "me"); previous = filed; world = out.world;
  }
  const me: any = world.companies.find((c: any) => c.id === "me")!;
  console.log(`${f.padEnd(11)} scale ${marketScale(niche).toFixed(5)} · market $${Math.round(worth).toLocaleString().padStart(10)}/yr · open cash $${Math.round(me0.cash).toLocaleString().padStart(8)} (${((me0.cash / worth) * 100).toFixed(1)}% of the market) · room ${String(Math.round(me0.capacity)).padStart(5)} → after 8q: ${String(Math.round(held(me))).padStart(5)} customers, cash $${Math.round(last.cash).toLocaleString()}, quality ${Math.round(last.quality)}`);
}
