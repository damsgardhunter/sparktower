import { NICHES } from "@shared/simulation/niches";
import { officerCost } from "@shared/simulation/decisions";
import { marketScale } from "@shared/simulation/world";
import { buildWorld } from "@shared/simulation/season";
import { ROLES } from "@shared/simulation/types";
console.log("market              price  unitCost  contrib   payroll/yr  breakEven  plant  reachable(best seen)");
const best: any = { dating_apps: 66347, drone_delivery: 9153, podcasts: 55124, restaurant_chain: 143350, construction: 1195, project_saas: 45335, mmos: 33482 };
for (const niche of NICHES as any[]) {
  const price = niche.segments[0].referencePrice;
  const contribution = Math.max(1, price - niche.baseUnitCost);
  const payroll = officerCost({ officers: 1, scale: marketScale(niche) } as any);
  const world: any = buildWorld({ seasonId: "a", niche, cadence: "quarterly", teams: [{ id: "me", name: "M", seats: [...ROLES], officers: 1 }] });
  const me: any = world.companies.find((c: any) => c.id === "me");
  const be = payroll / contribution;
  const reach = best[niche.id] ?? 0;
  const flag = reach < be ? "  <-- cannot ever pay its people" : "";
  console.log(`${niche.id.padEnd(18)} ${String(price).padStart(5)} ${String(niche.baseUnitCost).padStart(9)} ${contribution.toFixed(1).padStart(8)} ${Math.round(payroll).toLocaleString().padStart(12)} ${Math.round(be).toLocaleString().padStart(10)} ${String(me.capacity).padStart(6)} ${reach.toLocaleString().padStart(10)}${flag}`);
}
