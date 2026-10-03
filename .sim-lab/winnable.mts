/* For each market: the best a competent founder can do, searching spend rate. */
import { readFileSync } from "node:fs";
import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { NICHES, nicheById } from "@shared/simulation/niches";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number, n: any) => s + Number(n || 0), 0);

function season(niche: any, rate: number, room: number, seg: string | null, officers = 1) {
  let world: World = buildWorld({ seasonId: "w", niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers }] });
  const open = (world.companies.find((c: any) => c.id === "me") as any).cash;
  let previous: any; let last: any; let profitableQuarters = 0;
  for (let p = 1; p <= 16; p++) {
    const me: any = world.companies.find((c: any) => c.id === "me")!;
    const b = Math.max(0, Number(me.cash) * rate);
    const want: any = {
      ceo: { focus: p <= 6 ? "quality" : "growth", ...(seg ? { positioning: seg } : {}) },
      cmo: { brandSpend: Math.round(b * 0.25), performanceSpend: Math.round(b * 0.15) },
      cto: { featureSpend: Math.round(b * 0.2), reliabilitySpend: Math.round(b * 0.2), researchSpend: Math.round(b * 0.1) },
      coo: { capacityTarget: Math.max(Number(me.capacity) || 0, Math.round(held(me) * room)), supportSpend: Math.round(b * 0.1) },
    };
    const filed: any = { companyId: "me" };
    for (const r of ROLES) filed[r] = { ...defaultDraft(r, me, previous?.[r]), ...(want[r] ?? {}) };
    const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], undefined, { withoutEvent: true });
    last = out.reports.find((x: any) => x.companyId === "me");
    if (last.profit > 0) profitableQuarters++;
    previous = filed; world = out.world;
  }
  const me: any = world.companies.find((c: any) => c.id === "me")!;
  return { worth: last.value ?? 0, customers: held(me), cash: last.cash, open, profitableQuarters, quality: last.quality };
}

export function best(niche: any, label: string, officers = 1) {
  const total = niche.segments.reduce((s: number, x: any) => s + x.size, 0);
  let top: any = null;
  for (const rate of [0, 0.02, 0.06, 0.12, 0.25]) for (const room of [1.5, 2.5]) {
    const r = season(niche, rate, room, null, officers);
    if (!top || r.worth > top.worth) top = { ...r, rate, room };
    if (rate === 0 && room === 1.5) (globalThis as any).__nothing = r.worth;
  }
  const nothing = (globalThis as any).__nothing ?? 0;
  console.log(`${label.padEnd(30)} best: ${String(Math.round(top.customers)).padStart(7)} customers (${((top.customers / total) * 100).toFixed(2)}%) · worth $${Math.round(top.worth).toLocaleString().padStart(10)} · cash $${Math.round(top.cash).toLocaleString().padStart(9)} of $${Math.round(top.open).toLocaleString()} · ${top.profitableQuarters}/16 profitable quarters · quality ${Math.round(top.quality)} · vs doing nothing $${Math.round(nothing).toLocaleString()} → ${nothing > 0 ? (top.worth / nothing).toFixed(1) + "x" : "n/a"} · spend ${(top.rate * 100).toFixed(0)}%`);
  return top;
}
if (process.argv[1]?.endsWith("winnable.mts")) {
  for (const f of ["tallyhold", "kilnshare", "rotaread"]) best(JSON.parse(readFileSync(`.sim-lab/${f}.json`, "utf8")), `NOVA ${f}`);
  for (const n of NICHES) best(nicheById(n.id)!, n.name + " (table of 5)", 5);
}
