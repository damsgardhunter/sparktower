import { readFileSync } from "node:fs";
import { openShareFor } from "@shared/simulation/custom-market";
import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number,n: any)=>s+Number(n||0),0);
export function play(niche: any, seed: string, rate: number) {
  let world: World = buildWorld({ seasonId: seed, niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  let previous: any; let last: any; let prof = 0;
  for (let p = 1; p <= 16; p++) {
    const me: any = world.companies.find((c: any) => c.id === "me")!;
    const b = Math.max(0, Number(me.cash)*rate);
    const want: any = { ceo:{focus: p<=6?"quality":"growth"},
      cmo:{brandSpend:Math.round(b*0.25),performanceSpend:Math.round(b*0.15)},
      cto:{featureSpend:Math.round(b*0.2),reliabilitySpend:Math.round(b*0.2)},
      coo:{capacityTarget:Math.max(Number(me.capacity)||0,Math.round(held(me)*2)),supportSpend:Math.round(b*0.1)} };
    const filed: any = { companyId: "me" };
    for (const r of ROLES) filed[r] = { ...defaultDraft(r, me, previous?.[r]), ...(want[r]??{}) };
    const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], undefined, { withoutEvent: true });
    last = out.reports.find((x: any)=>x.companyId==="me");
    if (last.profit > 0) prof++;
    previous = filed; world = out.world;
  }
  return { prof, cust: held(world.companies.find((c: any)=>c.id==="me")), worth: last.value ?? 0, bankrupt: !!last.bankrupt };
}
if (process.argv[1].endsWith("customviable.mts")) {
  const SEEDS = ["a","d","h","m","q","t","w","y"];
  const { NICHES } = await import("@shared/simulation/niches");
  const all: any[] = [...(NICHES as any[]).map((n: any) => ({ n, raw: n, cat: true })), ...["kilnshare","tallyhold","rotaread"].map((f) => ({ n: { id: f }, raw: JSON.parse(readFileSync(`.sim-lab/${f}.json`,"utf8")), cat: false }))];
  for (const entry of all) {
    const n = entry.n.id; const raw = entry.raw;
    for (const label of entry.cat ? ["after"] : ["after"]) {
      const niche = { ...raw, openShare: openShareFor(raw) };
      let profSeeds = 0, broke = 0, bestProf = 0, cust = 0;
      for (const seed of SEEDS) {
        let bestByProfit = 0, bestByWorth: any = null;
        for (const rate of [0, 0.005, 0.01, 0.03, 0.06, 0.12]) {
          const r = play(niche, seed, rate);
          bestByProfit = Math.max(bestByProfit, r.prof);
          if (!bestByWorth || r.worth > bestByWorth.worth) bestByWorth = r;
        }
        if (bestByProfit > 0) profSeeds++;
        if (bestByWorth.bankrupt) broke++;
        bestProf = Math.max(bestProf, bestByProfit); cust = Math.max(cust, bestByWorth.cust);
      }
      console.log(`${n.padEnd(10)} ${label.padEnd(6)} openShare ${(niche.openShare ?? 0.1).toFixed(3)} · seeds with a profitable quarter ${profSeeds}/8 · best ${bestProf}/16 · bankrupt ${broke}/8 · customers up to ${cust}`);
    }
  }
}
