/**
 * What the optimiser actually decides, market by market.
 *
 * Run: npx tsx script/optimiser-report.ts
 *
 * Two questions this answers that the unit tests deliberately do not. The
 * tests assert the *properties* — that it fills every seat, that it respects
 * the budget, that it is deterministic — because those must hold whatever the
 * engine does. What the plans actually look like, and whether they differ
 * between a dating app and a construction firm, is a judgement call about
 * realism, and a judgement call wants numbers in front of it rather than an
 * assertion.
 */
import { buildWorld, economyFor } from "../shared/simulation/season";
import { resolveYear } from "../shared/simulation/resolve";
import { NICHES } from "../shared/simulation/niches";
import { optimise } from "../shared/simulation/optimiser";
import { ROLES, type World, type Niche } from "../shared/simulation/types";
import type { TeamDecisions } from "../shared/simulation/decisions";

const money = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `£${(n / 1_000_000).toFixed(2)}m`;
  if (Math.abs(n) >= 1_000) return `£${Math.round(n / 1_000)}k`;
  return `£${Math.round(n)}`;
};
const pad = (s: string, n: number) => s.padEnd(n);
const num = (n: number, w = 9) => String(Math.round(n).toLocaleString()).padStart(w);

const worldFor = (niche: Niche, seasonId: string): World =>
  buildWorld({ seasonId, niche, teams: [{ id: "us", name: "Us", seats: [...ROLES] }] });

/** The levers worth printing: the ones the optimiser actually moves. */
function describe(d: TeamDecisions) {
  return {
    price: d.cmo?.price ?? 0,
    brand: d.cmo?.brandSpend ?? 0,
    perf: d.cmo?.performanceSpend ?? 0,
    feature: d.cto?.featureSpend ?? 0,
    reliability: d.cto?.reliabilitySpend ?? 0,
    support: d.coo?.supportSpend ?? 0,
    efficiency: d.coo?.efficiencySpend ?? 0,
    capacity: d.coo?.capacityTarget ?? 0,
    focus: d.ceo?.focus ?? "—",
    segment: d.cmo?.segment || "(all)",
  };
}

console.log("\n=== One year, planned from the opening position =================\n");
console.log(pad("market", 18), pad("price", 7), pad("brand", 8), pad("perf", 8), pad("feature", 8),
  pad("reliab", 8), pad("support", 8), pad("effic", 8), pad("capacity", 10), pad("focus", 9), "segment");

const firstYear: Record<string, ReturnType<typeof describe>> = {};
for (const niche of NICHES) {
  const world = worldFor(niche, `rep-${niche.id}`);
  const plan = optimise({ world, companyId: "us", year: 1, economy: economyFor(`rep-${niche.id}`, 1, 1), totalYears: 14 });
  if (!plan) { console.log(pad(niche.id, 18), "no plan"); continue; }
  const d = describe(plan.decisions);
  firstYear[niche.id] = d;
  console.log(
    pad(niche.id, 18), pad(`£${d.price}`, 7), pad(money(d.brand), 8), pad(money(d.perf), 8),
    pad(money(d.feature), 8), pad(money(d.reliability), 8), pad(money(d.support), 8),
    pad(money(d.efficiency), 8), pad(d.capacity.toLocaleString(), 10), pad(String(d.focus), 9), d.segment,
  );
}

/*
 * Whether the plans are actually different, or the same numbers with different
 * labels. Compared on the spend shape rather than the absolute pounds: two
 * markets with different opening cash would differ trivially otherwise.
 */
console.log("\n=== Is it the same plan everywhere? ============================\n");
const shapes = new Map<string, string[]>();
for (const [id, d] of Object.entries(firstYear)) {
  const total = d.brand + d.perf + d.feature + d.reliability + d.support + d.efficiency || 1;
  const shape = [d.brand, d.perf, d.feature, d.reliability, d.support, d.efficiency]
    .map((n) => Math.round((n / total) * 100)).join("/");
  shapes.set(shape, [...(shapes.get(shape) ?? []), id]);
}
console.log(pad("brand/perf/feature/reliab/support/effic", 42), "markets");
for (const [shape, ids] of shapes) console.log(pad(shape, 42), ids.join(", "));
console.log(`\n${shapes.size} distinct spend shapes across ${Object.keys(firstYear).length} markets.`);

console.log("\nprices:   ", Object.entries(firstYear).map(([id, d]) => `${id} £${d.price}`).join("   "));
console.log("reference:", NICHES.map((n) => `${n.id} £${Math.round(n.segments.reduce((s, g) => s + g.referencePrice, 0) / n.segments.length)}`).join("   "));

/*
 * And over a season, because a one-year plan says nothing about whether the
 * strategy holds. Every year is re-planned from the position the last one
 * produced, which is what the button does when somebody presses it repeatedly.
 */
console.log("\n=== Fourteen years, re-planned each year ========================\n");
console.log(pad("market", 18), pad("value", 10), pad("cash", 10), pad("customers", 11),
  pad("price y1→y14", 14), pad("quality", 8), "brand");

for (const niche of NICHES) {
  const seasonId = `arc-${niche.id}`;
  let world = worldFor(niche, seasonId);
  const prices: number[] = [];
  let died = 0;

  for (let year = 1; year <= 14; year++) {
    const plan = optimise({ world, companyId: "us", year, economy: economyFor(seasonId, year, 1), totalYears: 14 });
    if (!plan) { died = year; break; }
    prices.push(plan.decisions.cmo?.price ?? 0);
    world = resolveYear(
      { ...world, year },
      [plan.decisions as never],
      economyFor(seasonId, year, 1),
    ).world;
    const us = world.companies.find((c) => c.id === "us");
    if (!us || us.closed) { died = year; break; }
  }

  const us = world.companies.find((c) => c.id === "us");
  if (!us) { console.log(pad(niche.id, 18), `closed in year ${died}`); continue; }
  const customers = Object.values(us.customers ?? {}).reduce((a: number, b: any) => a + Number(b), 0);
  console.log(
    pad(niche.id, 18),
    pad(money((us as any).valuation ?? us.cash ?? 0), 10),
    pad(money(us.cash ?? 0), 10),
    pad(customers.toLocaleString(), 11),
    pad(`£${prices[0]}→£${prices[prices.length - 1]}`, 14),
    pad(String(Math.round(((us as any).quality ?? 0) * 10) / 10), 8),
    String(Math.round(((us as any).brand ?? 0) * 10) / 10) + (died ? `  (closed y${died})` : ""),
  );
}
console.log("");

/*
 * And the year-by-year trace for two very different businesses, because "do
 * the decisions ever change" is a question about the arc rather than the
 * opening move.
 */
console.log("\n=== Year by year: a dating app and a construction firm ==========\n");
for (const id of ["dating_apps", "construction"]) {
  const niche = NICHES.find((n) => n.id === id)!;
  const seasonId = `trace-${id}`;
  let world = worldFor(niche, seasonId);
  console.log(`-- ${id} ${"-".repeat(60 - id.length)}`);
  console.log(pad("yr", 4), pad("price", 7), pad("brand", 8), pad("perf", 8), pad("feature", 8),
    pad("reliab", 8), pad("support", 8), pad("effic", 8), pad("capacity", 10), pad("focus", 9), pad("cash", 9), "customers");

  for (let year = 1; year <= 14; year++) {
    const plan = optimise({ world, companyId: "us", year, economy: economyFor(seasonId, year, 1), totalYears: 14 });
    if (!plan) { console.log(pad(String(year), 4), "no plan"); break; }
    const d = describe(plan.decisions);
    const before = world.companies.find((c) => c.id === "us")!;
    const held = Object.values(before.customers ?? {}).reduce((a: number, b: any) => a + Number(b), 0);
    console.log(
      pad(String(year), 4), pad(`£${d.price}`, 7), pad(money(d.brand), 8), pad(money(d.perf), 8),
      pad(money(d.feature), 8), pad(money(d.reliability), 8), pad(money(d.support), 8),
      pad(money(d.efficiency), 8), pad(d.capacity.toLocaleString(), 10), pad(String(d.focus), 9),
      pad(money(before.cash ?? 0), 9), held.toLocaleString(),
    );
    world = resolveYear({ ...world, year }, [plan.decisions as never], economyFor(seasonId, year, 1)).world;
    const us = world.companies.find((c) => c.id === "us");
    if (!us || us.closed) { console.log(`   closed in year ${year}`); break; }
  }
  console.log("");
}
