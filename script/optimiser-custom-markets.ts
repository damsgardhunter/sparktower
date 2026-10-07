/**
 * The optimiser against markets nobody hand-balanced.
 *
 * Run: npx tsx script/optimiser-custom-markets.ts
 *
 * `script/optimiser-report.ts` tested the seven catalogue niches, which is the
 * least interesting case: those were written and tuned by hand, and anything
 * wrong with them was found years ago. What the marketplace actually sells is
 * `customMarket` — a market Nova wrote from somebody's project, clamped by
 * `buildCustomMarket` and never seen by anybody before it was listed. That is
 * where a plan can be nonsense, and it is also where a seller can accidentally
 * publish a business nobody can run.
 *
 * So these are seven brand-new startups of deliberately different shapes,
 * written in the form Nova answers in and put through `{ fresh: true }` —
 * the same repricing and open-share calculation a listing gets when it is
 * published. Three of them are chosen to be awkward on purpose: an audience
 * that does not pay, a hardware business with a vast unit cost and a handful of
 * buyers, and a consultancy with eleven clients in the whole market.
 */
import { buildCustomMarket } from "../shared/simulation/custom-market";
import { buildWorld, economyFor, STARTING_CASH, STARTING_YEARS_OF_RUNWAY } from "../shared/simulation/season";
import { marketScale } from "../shared/simulation/world";
import { officersOf, yearOfCostsFor, REFERENCE_YEAR_OF_COSTS } from "../shared/simulation/decisions";
import { NICHES as CATALOGUE } from "../shared/simulation/niches";
import { resolveYear } from "../shared/simulation/resolve";
import { optimise } from "../shared/simulation/optimiser";
import { winnabilityOf } from "../shared/simulation/winnable";
import { ROLES, type World, type Niche } from "../shared/simulation/types";
import type { TeamDecisions } from "../shared/simulation/decisions";
import { STARTUP_SPECS } from "./lib/startup-specs";

const money = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `£${(n / 1_000_000).toFixed(2)}m`;
  if (Math.abs(n) >= 1_000) return `£${Math.round(n / 1_000)}k`;
  return `£${Math.round(n)}`;
};
const pad = (s: string, n: number) => s.padEnd(n);
const mean = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / (ns.length || 1);

/** Seven startups somebody might plausibly build a simulation of and sell. */
const STARTUPS = STARTUP_SPECS;

/** Built the way a listing is built when somebody publishes it. */
const markets: { label: string; note: string; niche: Niche }[] = [];
for (const s of STARTUPS) {
  const niche = buildCustomMarket(s.spec, `custom-${s.label.replace(/\s+/g, "-")}`, { fresh: true });
  if (!niche) { console.log(`!! ${s.label}: buildCustomMarket refused it`); continue; }
  markets.push({ label: s.label, note: s.note, niche });
}

const worldFor = (niche: Niche, seasonId: string): World =>
  buildWorld({ seasonId, niche, teams: [{ id: "us", name: "Us", seats: [...ROLES] }] });

console.log("\n=== What buildCustomMarket made of them ========================\n");
console.log(pad("startup", 20), pad("segments (size @ price)", 44), pad("unit cost", 10), pad("open", 7), "winnable");
for (const { label, niche } of markets) {
  const segs = niche.segments.map((s) => `${s.size.toLocaleString()}@${money(s.referencePrice)}`).join("  ");
  /*
   * `every-market-winnable.test.ts` holds the catalogue to this. A listing is
   * never checked against it, which is its own finding: somebody can publish
   * and sell a market no competent founder can survive.
   */
  let winnable = "—";
  try {
    const w = winnabilityOf(niche);
    winnable = w.ok ? "yes" : `NO — ${w.problems[0]?.slice(0, 46) ?? "unstated"}`;
  } catch (e: any) { winnable = `threw: ${e.message.slice(0, 24)}`; }
  console.log(
    pad(label, 20), pad(segs, 44), pad(money(niche.baseUnitCost), 10),
    pad(`${Math.round((niche.openShare ?? 0) * 100)}%`, 7), String(winnable),
  );
}

/*
 * What each of them opens with, which is not a constant.
 *
 * `startingCashFor` is STARTING_YEARS_OF_RUNWAY (5.4545) times what this
 * company costs to run for a year — so it moves with the table's size and the
 * market's scale, and every company opens with the same number of *years*
 * rather than the same number of pounds.
 */
console.log("\n=== What they open with =======================================\n");
console.log(pad("startup", 20), pad("starting cash", 14), pad("scale", 8), pad("a year of costs", 16), "years of runway");
for (const { label, niche } of markets) {
  const world = worldFor(niche, `cash-${label}`);
  const us = world.companies.find((c) => c.id === "us")!;
  const scale = marketScale(niche);
  const yearCost = yearOfCostsFor({ officers: officersOf(us), seats: [...ROLES], scale });
  console.log(
    pad(label, 20), pad(money(us.cash ?? 0), 14), pad(scale.toFixed(4), 8),
    pad(money(yearCost), 16), ((us.cash ?? 0) / (yearCost || 1)).toFixed(2),
  );
}
for (const niche of CATALOGUE) {
  const world = worldFor(niche, `cash-cat-${niche.id}`);
  const us = world.companies.find((c) => c.id === "us")!;
  const scale = marketScale(niche);
  const yearCost = yearOfCostsFor({ officers: officersOf(us), seats: [...ROLES], scale });
  console.log(
    pad(`(catalogue) ${niche.id}`.slice(0, 20), 20), pad(money(us.cash ?? 0), 14), pad(scale.toFixed(4), 8),
    pad(money(yearCost), 16), ((us.cash ?? 0) / (yearCost || 1)).toFixed(2),
  );
}

console.log("\n=== Year one, as the optimiser plans it ========================\n");
console.log(pad("startup", 20), pad("price", 10), pad("brand", 8), pad("perf", 8), pad("feature", 8),
  pad("reliab", 8), pad("support", 8), pad("effic", 8), pad("capacity", 11), "focus");
for (const { label, niche } of markets) {
  const seasonId = `cm-${label}`;
  const plan = optimise({ world: worldFor(niche, seasonId), companyId: "us", year: 1, economy: economyFor(seasonId, 1, 1), totalYears: 14 });
  if (!plan) { console.log(pad(label, 20), "NO PLAN"); continue; }
  const d = plan.decisions;
  console.log(
    pad(label, 20), pad(money(d.cmo?.price ?? 0), 10), pad(money(d.cmo?.brandSpend ?? 0), 8),
    pad(money(d.cmo?.performanceSpend ?? 0), 8), pad(money(d.cto?.featureSpend ?? 0), 8),
    pad(money(d.cto?.reliabilitySpend ?? 0), 8), pad(money(d.coo?.supportSpend ?? 0), 8),
    pad(money(d.coo?.efficiencySpend ?? 0), 8), pad((d.coo?.capacityTarget ?? 0).toLocaleString(), 11),
    String(d.ceo?.focus ?? "—"),
  );
}

/** Play a whole season, re-planning each year, optionally bending the plan. */
function playOut(niche: Niche, seed: string, bend?: (d: TeamDecisions) => TeamDecisions) {
  const seasonId = `cma-${niche.id}-${seed}`;
  let world = worldFor(niche, seasonId);
  const prices: number[] = [];
  for (let year = 1; year <= 14; year++) {
    const plan = optimise({ world, companyId: "us", year, economy: economyFor(seasonId, year, 1), totalYears: 14 });
    if (!plan) return null;
    prices.push(plan.decisions.cmo?.price ?? 0);
    const filed = bend ? bend(structuredClone(plan.decisions)) : plan.decisions;
    world = resolveYear({ ...world, year }, [filed as never], economyFor(seasonId, year, 1)).world;
    const us = world.companies.find((c) => c.id === "us");
    if (!us || us.closed) return { cash: 0, customers: 0, quality: 0, prices, closedIn: year };
  }
  const us = world.companies.find((c) => c.id === "us")!;
  return {
    cash: us.cash ?? 0,
    customers: Object.values(us.customers ?? {}).reduce((a: number, b: any) => a + Number(b), 0),
    quality: Math.round(((us as any).quality ?? 0) * 10) / 10,
    prices, closedIn: 0,
  };
}

const SEEDS = ["a", "b", "c", "d"];

console.log("\n=== Fourteen years, averaged over " + SEEDS.length + " seasons ==================\n");
console.log(pad("startup", 20), pad("mean cash", 11), pad("mean custs", 12), pad("quality", 8), pad("price y1→y14", 18), "closed");
for (const { label, niche } of markets) {
  const runs = SEEDS.map((s) => playOut(niche, s)).filter(Boolean) as NonNullable<ReturnType<typeof playOut>>[];
  if (!runs.length) { console.log(pad(label, 20), "NO PLAN"); continue; }
  const first = runs[0].prices;
  console.log(
    pad(label, 20), pad(money(mean(runs.map((r) => r.cash))), 11),
    pad(Math.round(mean(runs.map((r) => r.customers))).toLocaleString(), 12),
    pad(mean(runs.map((r) => r.quality)).toFixed(1), 8),
    pad(`${money(first[0])}→${money(first[first.length - 1])}`, 18),
    `${runs.filter((r) => r.closedIn).length}/${runs.length}`,
  );
}

/* And the same blind-spot probe, on markets nobody balanced. */
const moveToFeatures = (d: TeamDecisions): TeamDecisions => {
  const take = Math.round((d.cmo?.brandSpend ?? 0) * 0.25);
  if (!take) return d;
  d.cmo!.brandSpend = (d.cmo!.brandSpend ?? 0) - take;
  d.cto!.featureSpend = (d.cto!.featureSpend ?? 0) + take;
  return d;
};

console.log("\n=== Does the feature blind spot hold here too? =================\n");
console.log(pad("startup", 20), pad("as planned", 12), pad("¼→features", 12), "difference");
for (const { label, niche } of markets) {
  const base = SEEDS.map((s) => playOut(niche, s)).filter(Boolean) as any[];
  const bent = SEEDS.map((s) => playOut(niche, s, moveToFeatures)).filter(Boolean) as any[];
  if (!base.length || !bent.length) { console.log(pad(label, 20), "NO PLAN"); continue; }
  const a = mean(base.map((r) => r.cash));
  const b = mean(bent.map((r) => r.cash));
  console.log(pad(label, 20), pad(money(a), 12), pad(money(b), 12),
    `${b >= a ? "+" : ""}${(((b - a) / (a || 1)) * 100).toFixed(1)}%`);
}
console.log("");
