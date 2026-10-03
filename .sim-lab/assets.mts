import { seedIncumbents } from "@shared/simulation/incumbents";
import { startingCompany } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { nicheById } from "@shared/simulation/niches";
import { ROLES } from "@shared/simulation/types";
const niche: any = nicheById("dating_apps")!;
const company = (over: any = {}) => ({ ...startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] as any }), cash: 12_000_000, ...over });
const patent: any = { id: "a1", kind: "patent", name: "P", effect: { quality: 9, unitCost: 0.93 }, bookValue: 2_000_000 };
const deal: any = { id: "a2", kind: "distribution", name: "D", effect: { capacity: 500_000, brand: 6 }, bookValue: 2_400_000, expiresIn: 3 };
const base: any = { seasonId: "s", niche, year: 1, economy: { demand: 1, interestRate: 0.08, costIndex: 1, outlook: "steady" } };
const decisions: any = [{ companyId: "t",
  cmo: { price: 22, brandSpend: 500_000, performanceSpend: 500_000, celebritySpend: 0, targetCities: [] },
  coo: { capacityTarget: 400_000, supportSpend: 200_000, efficiencySpend: 0, headcount: 5 } }];
for (const [label, assets] of [["plain", []], ["patent", [patent]], ["deal", [deal]], ["both", [patent, deal]]] as any) {
  const w = { ...base, companies: [...seedIncumbents(niche), company({ assets })] };
  const r: any = resolveYear(w, decisions).reports.find((x: any) => x.companyId === "t");
  if (label==="plain"||label==="both") console.log(label, JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k,v]:any)=>typeof v!=="object"&&k!=="notes").map(([k,v]:any)=>[k,typeof v==="number"?Math.round(v):v]))));
  console.log(`${label.padEnd(6)} customers ${String(r.customers).padStart(7)} · capacity ${String(r.capacity ?? "?").padStart(8)} · revenue ${Math.round(r.revenue).toLocaleString().padStart(12)} · profit ${Math.round(r.profit).toLocaleString().padStart(13)} · cash ${Math.round(r.cash).toLocaleString().padStart(12)}`);
}
