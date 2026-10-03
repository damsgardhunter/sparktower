import { readFileSync } from "node:fs";
import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { marketScale } from "@shared/simulation/world";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number, n: any) => s + Number(n || 0), 0);
const niche: any = JSON.parse(readFileSync(".sim-lab/kilnshare.json", "utf8"));
let world: World = buildWorld({ seasonId: "tiny", niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
const me0: any = world.companies.find((c: any) => c.id === "me");
console.log(`scale ${marketScale(niche).toFixed(6)} · cash $${Math.round(me0.cash).toLocaleString()} · room ${Math.round(me0.capacity)} · price $${me0.price} · unitCost $${me0.unitCost}`);
let previous: any;
let bad = 0;
for (let p = 1; p <= 16; p++) {
  const me: any = world.companies.find((c: any) => c.id === "me")!;
  const b = Math.max(0, Number(me.cash) * 0.05);
  const filed: any = { companyId: "me" };
  for (const r of ROLES) filed[r] = { ...defaultDraft(r, me, previous?.[r]), ...(r === "cto" ? { featureSpend: Math.round(b * 0.5), reliabilitySpend: Math.round(b * 0.25), researchSpend: Math.round(b * 0.25) } : {}) };
  const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], undefined, { withoutEvent: true });
  const rep: any = out.reports.find((x: any) => x.companyId === "me");
  for (const [k, v] of Object.entries({ revenue: rep.revenue, profit: rep.profit, cash: rep.cash, quality: rep.quality, value: rep.value })) {
    if (!Number.isFinite(v as number)) { console.log(`  p${p}: ${k} is ${v}`); bad++; }
  }
  if (p % 4 === 0) console.log(`  Y${p / 4}: ${Math.round(held(out.world.companies.find((c: any) => c.id === "me")))} customers · revenue $${Math.round(rep.revenue)} · cash $${Math.round(rep.cash).toLocaleString()} · quality ${Math.round(rep.quality)} · worth $${Math.round(rep.value ?? 0).toLocaleString()}`);
  previous = filed; world = out.world;
}
console.log(bad === 0 ? "no NaN or Infinity anywhere" : `${bad} broken numbers`);
