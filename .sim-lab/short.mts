import { resolveYear } from "@shared/simulation/resolve";
import { seedIncumbents } from "@shared/simulation/incumbents";
import { NICHES } from "@shared/simulation/niches";
const niche: any = NICHES[0];
const MARKET = niche.segments.reduce((s: number, x: any) => s + x.size, 0);
const newTeam = (id: string, name: string): any => ({
  id, name, kind: "player", cash: 5_000_000, debt: 0, creditLimit: 2_000_000,
  reputation: 50, quality: 40, brand: 20, service: 40,
  capacity: Math.round(MARKET * 0.03), unitCost: niche.baseUnitCost, price: 18,
  customers: {}, assets: [], cities: ["Leeds"], founderShare: 1, seats: [],
});
const fullYear = (companyId: string, spend: number, price = 18): any => ({
  companyId,
  cmo: { price, brandSpend: spend * 0.25, performanceSpend: spend * 0.15, celebritySpend: 0, targetCities: ["Leeds"] },
  cto: { featureSpend: spend * 0.2, reliabilitySpend: spend * 0.15, techDebtPaydown: 0 },
  coo: { capacityTarget: Math.round(MARKET * 0.07), supportSpend: spend * 0.15, efficiencySpend: spend * 0.1, headcount: 12 },
  cfo: { borrow: 0, repay: 0, cashBuffer: 200_000 },
  ceo: { focus: "growth" },
});
for (const cash of [300_000, 500_000, 800_000, 1_200_000, 2_000_000]) {
  const world: any = { seasonId: "s1", niche, year: 1,
    companies: [...seedIncumbents(niche), { ...newTeam("short","Short"), cash, creditLimit: 20_000 }],
    economy: { demand: 1, interestRate: 0.09, costIndex: 1, outlook: "steady" } };
  const { reports } = resolveYear(world, [fullYear("short", 3_000_000)]);
  const r: any = reports.find((x: any) => x.companyId === "short");
  console.log(`cash ${cash.toLocaleString().padStart(9)} -> bankrupt ${String(r.bankrupt).padEnd(5)} · revenue ${Math.round(r.revenue).toLocaleString().padStart(10)} · customers ${Math.round(r.customers ?? 0)} · emergencyDebt ${Math.round(r.credit?.emergencyDebt ?? 0).toLocaleString()}`);
}
