import { buildWorld } from "@shared/simulation/season";
import { NICHES } from "@shared/simulation/niches";
import { ROLES } from "@shared/simulation/types";
console.log("niche".padEnd(18), "start cap".padStart(10), "cash".padStart(12), "open pool in home".padStart(18), "cap/pool".padStart(9));
for (const niche of NICHES as any[]) {
  const world: any = buildWorld({ seasonId: "grow", niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  const me: any = world.companies.find((c: any) => c.id === "me");
  const home = niche.cities.find((c: any) => (me.cities ?? []).includes(c.id));
  const market = niche.segments.reduce((s: number, x: any) => s + x.size, 0);
  const pool = market * (home?.weight ?? 0) * 0.10 * world.economy.demand;
  console.log(niche.id.padEnd(18), String(me.capacity).padStart(10), Math.round(me.cash).toLocaleString().padStart(12), Math.round(pool).toLocaleString().padStart(18), (me.capacity / Math.max(1, pool)).toFixed(1).padStart(9));
}
