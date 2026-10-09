/**
 * Why a plan stops spending.
 *
 * Run: OPT_TRACE=1 npx tsx script/idle-trace.ts "fitness app" 4
 *
 * Five of seven written markets commit nothing at all in three or more years
 * while holding millions. `ascend` stops when no lever's slice beats doing
 * nothing; this prints the scores it stopped on.
 */
import { buildCustomMarket } from "../shared/simulation/custom-market";
import { buildWorld, economyFor } from "../shared/simulation/season";
import { resolveYear } from "../shared/simulation/resolve";
import { optimise } from "../shared/simulation/optimiser";
import { ROLES, type World } from "../shared/simulation/types";
import { STARTUP_SPECS } from "./lib/startup-specs";

const label = process.argv[2] ?? "fitness app";
const upTo = Number(process.argv[3] ?? 4);
const spec = STARTUP_SPECS.find((s) => s.label.toLowerCase().includes(label.toLowerCase()))!;
const niche = buildCustomMarket(spec.spec, `idle-${spec.label}`, { fresh: true })!;
const seasonId = `idle-${niche.id}`;
let world: World = buildWorld({ seasonId, niche, teams: [{ id: "us", name: "Us", seats: [...ROLES] }] });
world = { ...world, companies: world.companies.map((c) => (c.id === "us" ? { ...c, cash: 60_000 } : c)) };

for (let year = 1; year <= upTo; year++) {
  const us = world.companies.find((c) => c.id === "us")!;
  const held = Object.values(us.customers ?? {}).reduce((a: number, b: any) => a + Number(b), 0);
  console.log(`\n--- year ${year}: cash £${Math.round(us.cash ?? 0).toLocaleString()}, capacity ${(us.capacity ?? 0).toLocaleString()}, ${held.toLocaleString()} customers, quality ${Math.round((us as any).quality ?? 0)}`);
  const plan = optimise({ world, companyId: "us", year, economy: economyFor(seasonId, year, 1), totalYears: 14 });
  if (!plan) { console.log("no plan"); break; }
  const d = plan.decisions;
  const spent = (d.cmo?.brandSpend ?? 0) + (d.cmo?.performanceSpend ?? 0) + (d.cto?.featureSpend ?? 0)
    + (d.cto?.reliabilitySpend ?? 0) + (d.coo?.supportSpend ?? 0) + (d.coo?.efficiencySpend ?? 0);
  console.log(`    committed £${spent.toLocaleString()}  capacityTarget ${(d.coo?.capacityTarget ?? 0).toLocaleString()}  price £${d.cmo?.price}`);
  world = resolveYear({ ...world, year }, [d as never], economyFor(seasonId, year, 1)).world;
}
