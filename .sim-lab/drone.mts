import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number, n: any) => s + Number(n || 0), 0);
const niche: any = nicheById("drone_delivery")!;
function run(seed: string, price: number | null, rate = 0.12) {
  let world: World = buildWorld({ seasonId: seed, niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  let previous: any; let last: any;
  for (let p = 1; p <= 16; p++) {
    const me: any = world.companies.find((c: any) => c.id === "me")!;
    const b = Math.max(0, Number(me.cash) * rate);
    const want: any = {
      ceo: { focus: p <= 6 ? "quality" : "growth" },
      cmo: { brandSpend: Math.round(b * 0.25), performanceSpend: Math.round(b * 0.15), ...(price ? { price } : {}) },
      cto: { featureSpend: Math.round(b * 0.2), reliabilitySpend: Math.round(b * 0.2), researchSpend: Math.round(b * 0.1) },
      coo: { capacityTarget: Math.max(Number(me.capacity) || 0, Math.round(held(me) * 2)), supportSpend: Math.round(b * 0.1) },
    };
    const filed: any = { companyId: "me" };
    for (const r of ROLES) filed[r] = { ...defaultDraft(r, me, previous?.[r]), ...(want[r] ?? {}) };
    const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], undefined, { withoutEvent: true });
    last = out.reports.find((x: any) => x.companyId === "me"); previous = filed; world = out.world;
  }
  const me: any = world.companies.find((c: any) => c.id === "me")!;
  return { worth: last.value ?? 0, customers: held(me), bankrupt: !!last.bankrupt, cash: last.cash };
}
console.log("seed  price     customers  bankrupt   worth");
for (const seed of ["a","d","h","m","w","y"]) {
  for (const price of [null, 60, 150, 300]) {
    const r = run(seed, price);
    console.log(`${seed}     ${String(price ?? "default").padStart(7)} ${String(r.customers).padStart(10)}  ${String(r.bankrupt).padEnd(8)} ${Math.round(r.worth).toLocaleString().padStart(14)}`);
  }
}
