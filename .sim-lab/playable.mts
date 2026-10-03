import { readFileSync } from "node:fs";
import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { NICHES, nicheById } from "@shared/simulation/niches";
import { marketShares } from "@shared/simulation/custom-market";
import { ROLES, type TeamDecisions, type World } from "@shared/simulation/types";
const held = (c: any) => Object.values(c?.customers ?? {}).reduce((s: number, n: any) => s + Number(n || 0), 0);

function playable(niche: any, label: string) {
  let world: World = buildWorld({ seasonId: "p", niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  let previous: any; let last: any; let profitable = false;
  for (let p = 1; p <= 16; p++) {
    const me: any = world.companies.find((c: any) => c.id === "me")!;
    const b = Math.max(0, Number(me.cash) * 0.05);
    const want: any = {
      ceo: { focus: "quality" },
      cmo: { brandSpend: Math.round(b * 0.2), performanceSpend: Math.round(b * 0.15) },
      cto: { featureSpend: Math.round(b * 0.2), reliabilitySpend: Math.round(b * 0.2), researchSpend: Math.round(b * 0.15) },
      coo: { capacityTarget: Math.max(Number(me.capacity) || 0, Math.round(held(me) * 2)), supportSpend: Math.round(b * 0.1) },
    };
    const filed: any = { companyId: "me" };
    for (const r of ROLES) filed[r] = { ...defaultDraft(r, me, previous?.[r]), ...(want[r] ?? {}) };
    const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], undefined, { withoutEvent: true });
    last = out.reports.find((x: any) => x.companyId === "me");
    if (last.profit > 0) profitable = true;
    previous = filed; world = out.world;
  }
  const me: any = world.companies.find((c: any) => c.id === "me")!;
  const total = niche.segments.reduce((s: number, x: any) => s + x.size, 0);
  const rivals = niche.incumbents.reduce((s: number, i: any) => s + i.startingShare, 0);
  const meanQ = niche.incumbents.reduce((s: number, i: any) => s + i.quality, 0) / niche.incumbents.length;
  const margin = Math.min(...niche.segments.map((s: any) => s.referencePrice)) - niche.baseUnitCost;
  console.log(`${label.padEnd(30)} share ${((held(me) / total) * 100).toFixed(2).padStart(6)}% · rivals hold ${(rivals * 100).toFixed(0).padStart(2)}% at mean q${Math.round(meanQ)} · cheapest margin $${margin} · profitable ${profitable ? "yes" : "NO "} · worth $${Math.round(last.value ?? 0).toLocaleString()}`);
}
for (const f of ["tallyhold", "kilnshare", "rotaread"]) playable(JSON.parse(readFileSync(`.sim-lab/${f}.json`, "utf8")), `NOVA ${f}`);
for (const n of NICHES) playable(nicheById(n.id)!, n.name);
