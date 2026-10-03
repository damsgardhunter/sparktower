import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number, n: any) => s + Number(n||0), 0);
const niche: any = nicheById("dating_apps")!;
let world: World = buildWorld({ seasonId: "idle", niche, cadence: "yearly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
const open = (world.companies.find((c: any) => c.id === "me") as any).cash;
let previous: any;
for (let y = 1; y <= 14; y++) {
  const me: any = world.companies.find((c: any) => c.id === "me")!;
  const filed: any = { companyId: "me" };
  for (const r of ROLES) filed[r] = { ...defaultDraft(r, me, previous?.[r]) };
  const out = resolveYear({ ...world, year: y }, [filed as TeamDecisions], undefined, { withoutEvent: true });
  const a: any = out.world.companies.find((c: any) => c.id === "me");
  const rep: any = out.reports.find((r: any) => r.companyId === "me");
  if (y % 3 === 1 || y === 14) console.log(`y${String(y).padStart(2)} brand ${a.brand.toFixed(1)} quality ${a.quality.toFixed(1)} cust ${String(held(a)).padStart(7)} rev ${Math.round(rep.revenue).toLocaleString().padStart(11)} profit ${Math.round(rep.profit).toLocaleString().padStart(11)} cash ${Math.round(a.cash).toLocaleString().padStart(11)}`);
  previous = filed; world = out.world;
}
console.log("opening cash", Math.round(open).toLocaleString());
