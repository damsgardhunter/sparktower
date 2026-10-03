import { buildWorld } from "@shared/simulation/season";
import { NICHES } from "@shared/simulation/niches";
import { ROLES } from "@shared/simulation/types";
const teams = ["t1","t2","t3","t4","t5"].map((id) => ({ id, name: id, seats: [...ROLES] as any, officers: 1 }));
console.log("niche".padEnd(18), "plant".padStart(9), "pool/company".padStart(13), "plant/share".padStart(12));
for (const niche of NICHES as any[]) {
  const world: any = buildWorld({ seasonId: "grow", niche, cadence: "quarterly", teams });
  const me: any = world.companies.find((c: any) => c.id === "t1");
  const home = world.niche.cities.find((c: any) => (me.cities ?? []).includes(c.id));
  const market = world.niche.segments.reduce((s: number, x: any) => s + x.size, 0);
  const share = market * (home?.weight ?? 0) * 0.10 * world.economy.demand / teams.length;
  console.log(niche.id.padEnd(18), String(me.capacity).padStart(9), Math.round(share).toLocaleString().padStart(13), (me.capacity / Math.max(1, share)).toFixed(1).padStart(12));
}
