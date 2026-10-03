import { readFileSync } from "node:fs";
import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { NICHES } from "@shared/simulation/niches";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number, n: any) => s + Number(n||0), 0);
function run(niche: any, seed: string, rate: number) {
  let world: World = buildWorld({ seasonId: seed, niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  const open = (world.companies.find((c: any) => c.id === "me") as any).cash;
  let previous: any; let last: any; let profitable = 0;
  for (let p = 1; p <= 16; p++) {
    const me: any = world.companies.find((c: any) => c.id === "me")!;
    const b = Math.max(0, Number(me.cash) * rate);
    const want: any = {
      ceo: { focus: p <= 6 ? "quality" : "growth" },
      cmo: { brandSpend: Math.round(b*0.25), performanceSpend: Math.round(b*0.15) },
      cto: { featureSpend: Math.round(b*0.2), reliabilitySpend: Math.round(b*0.2), researchSpend: Math.round(b*0.1) },
      coo: { capacityTarget: Math.max(Number(me.capacity)||0, Math.round(held(me)*2)), supportSpend: Math.round(b*0.1) },
    };
    const filed: any = { companyId: "me" };
    for (const r of ROLES) filed[r] = { ...defaultDraft(r, me, previous?.[r]), ...(want[r] ?? {}) };
    const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], undefined, { withoutEvent: true });
    last = out.reports.find((x: any) => x.companyId === "me");
    if (last.profit > 0) profitable++;
    previous = filed; world = out.world;
  }
  const me: any = world.companies.find((c: any) => c.id === "me")!;
  return { worth: last.value ?? 0, profitable, endCash: last.cash, open, grew: last.cash > open };
}
const customs = ["rotaread","kilnshare","tallyhold"].map((n) => JSON.parse(readFileSync(`.sim-lab/${n}.json`,"utf8")));
const SEEDS = ["a","d","h","m","q","t","w","y"];
console.log("market             seeds where the best plan ends richer than it started | profitable quarters (best seed)");
for (const niche of [...(NICHES as any[]), ...customs]) {
  let richer = 0, bestProf = 0;
  for (const seed of SEEDS) {
    let top: any = null;
    for (const rate of [0.02,0.06,0.12,0.25]) { const r = run(niche, seed, rate); if (!top || r.worth > top.worth) top = r; }
    if (top.grew) richer++;
    bestProf = Math.max(bestProf, top.profitable);
  }
  const flag = richer < 8 ? `  <-- ${8-richer} season(s) end poorer` : "";
  console.log(`${niche.id.padEnd(18)} ${richer}/8   ${String(bestProf).padStart(2)}/16${flag}`);
}
