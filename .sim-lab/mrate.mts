import { nicheById } from "@shared/simulation/niches";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number,n: any)=>s+Number(n||0),0);
function play(niche: any, seed: string, annual: number, cad: "monthly"|"quarterly", years = 0) {
  const periods = cad === "monthly" ? 12 : 4;
  const spans = years ? years * periods : (cad === "monthly" ? 24 : 16);
  let world: World = buildWorld({ seasonId: seed, niche, cadence: cad, teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  let previous: any; let last: any;
  for (let p = 1; p <= spans; p++) {
    const me: any = world.companies.find((c: any)=>c.id==="me")!;
    const b = Math.max(0, Number(me.cash) * annual / periods);
    const want: any = { ceo:{focus:p<=spans/3?"quality":"growth"}, cmo:{brandSpend:Math.round(b*0.25),performanceSpend:Math.round(b*0.15)},
      cto:{featureSpend:Math.round(b*0.2),reliabilitySpend:Math.round(b*0.2)},
      coo:{capacityTarget:Math.max(Number(me.capacity)||0,Math.round(held(me)*2)),supportSpend:Math.round(b*0.1)} };
    const filed: any = { companyId: "me" };
    for (const r of ROLES) filed[r] = { ...defaultDraft(r, me, previous?.[r]), ...(want[r]??{}) };
    const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], economyFor(seed, p, periods), {});
    last = out.reports.find((x: any)=>x.companyId==="me"); previous = filed; world = out.world;
  }
  return last.value ?? 0;
}
console.log("monthly at its default two years, across seeds: value building vs value holding");
for (const id of ["podcasts","project_saas","restaurant_chain","dating_apps","mmos"]) {
  const niche: any = nicheById(id)!;
  const row = ["a","d","h","m","q","t","w","y"].map((seed) => {
    const nothing = play(niche, seed, 0, "monthly", 2);
    const best = Math.max(...[0.04, 0.12, 0.24, 0.48].map((a) => play(niche, seed, a, "monthly", 2)));
    return (best / Math.max(1, nothing));
  });
  const paid = row.filter((r) => r > 1).length;
  console.log(`${id.padEnd(17)} pays in ${paid}/8 seeds · ${row.map((r)=>r.toFixed(2)+"x").join(" ")}`);
}
