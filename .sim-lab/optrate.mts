import { NICHES } from "@shared/simulation/niches";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number,n: any)=>s+Number(n||0),0);
/* Seeds whose economy is flattest, so the cycle is not deciding it. */
const flat = ["season-long","a-whole-season"];
function play(niche: any, seed: string, rate: number) {
  let world: World = buildWorld({ seasonId: seed, niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  let previous: any; let last: any;
  for (let p = 1; p <= 16; p++) {
    const me: any = world.companies.find((c: any)=>c.id==="me")!;
    const b = Math.max(0, Number(me.cash) * rate);
    const want: any = { ceo:{focus:p<=6?"quality":"growth"},
      cmo:{brandSpend:Math.round(b*0.25),performanceSpend:Math.round(b*0.15)},
      cto:{featureSpend:Math.round(b*0.2),reliabilitySpend:Math.round(b*0.2),researchSpend:Math.round(b*0.1)},
      coo:{capacityTarget:Math.max(Number(me.capacity)||0,Math.round(held(me)*2)),supportSpend:Math.round(b*0.1)} };
    const filed: any = { companyId: "me" };
    for (const r of ROLES) filed[r] = { ...defaultDraft(r, me, previous?.[r]), ...(want[r]??{}) };
    const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], economyFor(seed, p, 4), {});
    last = out.reports.find((x: any)=>x.companyId==="me"); previous = filed; world = out.world;
  }
  return last.value ?? 0;
}
const RATES = [0, 0.005, 0.01, 0.03, 0.06, 0.12];
console.log("market            best rate (mean over 2 flat seasons) · value at 0 vs at best");
for (const niche of NICHES as any[]) {
  const means = RATES.map((r) => flat.reduce((s, seed) => s + play(niche, seed, r), 0) / flat.length);
  const bestI = means.indexOf(Math.max(...means));
  console.log(`${niche.id.padEnd(17)} ${String(RATES[bestI]).padEnd(6)} · ${Math.round(means[0]).toLocaleString().padStart(11)} -> ${Math.round(means[bestI]).toLocaleString().padStart(11)} (${(means[bestI]/Math.max(1,means[0])).toFixed(2)}x)`);
}
