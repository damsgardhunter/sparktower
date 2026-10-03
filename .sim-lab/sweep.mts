import { readFileSync } from "node:fs";
import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { NICHES } from "@shared/simulation/niches";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";

const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number, n: any) => s + Number(n || 0), 0);

export function season(niche: any, seed: string, rate: number, officers = 1) {
  let world: World = buildWorld({ seasonId: seed, niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers }] });
  let previous: any; let last: any; let everBankrupt = false;
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
    last = out.reports.find((x: any) => x.companyId === "me");
    if (last.bankrupt) everBankrupt = true;
    previous = filed; world = out.world;
  }
  const me: any = world.companies.find((c: any) => c.id === "me")!;
  return { worth: last.value ?? last.founderValue ?? 0, customers: held(me), bankrupt: !!last.bankrupt, everBankrupt };
}

const customs = ["rotaread", "kilnshare", "tallyhold"].map((n) => JSON.parse(readFileSync(`.sim-lab/${n}.json`, "utf8")));
const all: any[] = [...NICHES, ...customs];
const SEEDS = ["a", "d", "h", "m", "q", "t", "w", "y"];
const RATES = [0.02, 0.06, 0.12, 0.25];

console.log("market              seeds where a competent founder…");
console.log("                    wins 0 | beaten by doing nothing | went bankrupt | best customers (min..max)");
for (const niche of all) {
  let zero = 0, beaten = 0, broke = 0; let lo = Infinity, hi = 0; const bad: string[] = [];
  for (const seed of SEEDS) {
    const nothing = season(niche, seed, 0);
    let top: any = null;
    for (const rate of RATES) { const r = season(niche, seed, rate); if (!top || r.worth > top.worth) top = r; }
    if (top.customers === 0) { zero++; bad.push(`${seed}:0cust`); }
    if (top.worth <= nothing.worth) { beaten++; bad.push(`${seed}:donothing`); }
    if (top.bankrupt) { broke++; bad.push(`${seed}:bankrupt`); }
    lo = Math.min(lo, top.customers); hi = Math.max(hi, top.customers);
  }
  const flag = (zero || beaten || broke) ? "  <-- " + bad.join(" ") : "";
  console.log(`${niche.id.padEnd(18)}  ${String(zero).padStart(6)} | ${String(beaten).padStart(23)} | ${String(broke).padStart(13)} | ${lo.toLocaleString()}..${hi.toLocaleString()}${flag}`);
}
