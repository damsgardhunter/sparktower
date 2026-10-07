/**
 * Where the money actually went, year by year, on £60,000.
 *
 * Run: npx tsx script/optimiser-spend-trace.ts
 *
 * `script/optimiser-sixty-k.ts` answered whether a company survives on £60k and
 * not what it did with it — it computed the spend and then only returned it on
 * the path where the company died, which was a bug in the diagnostic rather
 * than a finding.
 *
 * This prints the whole ledger: what the optimiser committed to each lever,
 * what the year earned, what it cost to run, and where the cash ended. That is
 * also what settles the thing the survival table could not explain — three
 * markets reporting a lowest cash point exactly equal to the £60,000 they
 * opened with, and a launch business surviving fourteen years on a bank balance
 * that touched zero.
 */
import { buildCustomMarket } from "../shared/simulation/custom-market";
import { buildWorld, economyFor } from "../shared/simulation/season";
import { resolveYear } from "../shared/simulation/resolve";
import { optimise } from "../shared/simulation/optimiser";
import { nicheById } from "../shared/simulation/niches";
import { ROLES, type World, type Niche, type Role } from "../shared/simulation/types";
import { distressOf } from "../shared/simulation/recovery";
import { valuation } from "../shared/simulation/mergers";
import { STARTUP_SPECS } from "./lib/startup-specs";

/** Exact pounds, with separators. Rounding to thousands hides the year-one numbers entirely. */
const money = (n: number) => `${n < 0 ? "-" : ""}£${Math.round(Math.abs(n)).toLocaleString()}`;
const pad = (s: string, n: number) => s.padEnd(n);
const rpad = (s: string, n: number) => s.padStart(n);

function nicheFor(label: string): Niche | null {
  const spec = STARTUP_SPECS.find((s) => s.label === label);
  if (spec) return buildCustomMarket(spec.spec, `trace-${label.replace(/\s+/g, "-")}`, { fresh: true });
  return nicheById(label) ?? null;
}

function trace(label: string, cash: number, seats: Role[]) {
  const niche = nicheFor(label);
  if (!niche) { console.log(`!! no market for ${label}`); return; }
  const seasonId = `spend-${label}-${seats.length}`;
  const base = buildWorld({ seasonId, niche, teams: [{ id: "us", name: "Us", seats }] });
  let world: World = { ...base, companies: base.companies.map((c) => (c.id === "us" ? { ...c, cash } : c)) };

  console.log(`\n-- ${label}, ${seats.length === 1 ? "solo founder" : "five seats"}, opening on ${money(cash)} ${"-".repeat(Math.max(0, 28 - label.length))}`);
  console.log(
    pad("yr", 4), rpad("price", 8), rpad("brand", 11), rpad("perf", 11), rpad("feature", 9), rpad("reliability", 12),
    rpad("support", 9), rpad("efficiency", 11), rpad("COMMITTED", 12), rpad("revenue", 13), rpad("profit", 13), rpad("cash", 11), rpad("DEBT", 13), rpad("state", 11), rpad("value", 12), rpad("custs", 9),
  );

  for (let year = 1; year <= 14; year++) {
    const plan = optimise({ world, companyId: "us", year, economy: economyFor(seasonId, year, 1), totalYears: 14 });
    if (!plan) { console.log(pad(String(year), 4), "— no plan: the company is gone"); return; }
    const d = plan.decisions;
    const committed =
      (d.cmo?.brandSpend ?? 0) + (d.cmo?.performanceSpend ?? 0) +
      (d.cto?.featureSpend ?? 0) + (d.cto?.reliabilitySpend ?? 0) +
      (d.coo?.supportSpend ?? 0) + (d.coo?.efficiencySpend ?? 0);

    const out = resolveYear({ ...world, year }, [d as never], economyFor(seasonId, year, 1));
    const report: any = out.reports.find((r: any) => r.companyId === "us");
    world = out.world;
    const us = world.companies.find((c) => c.id === "us");
    const custs = us ? Object.values(us.customers ?? {}).reduce((a: number, b: any) => a + Number(b), 0) : 0;

    console.log(
      pad(String(year), 4), rpad(money(d.cmo?.price ?? 0), 8), rpad(money(d.cmo?.brandSpend ?? 0), 11),
      rpad(money(d.cmo?.performanceSpend ?? 0), 11), rpad(money(d.cto?.featureSpend ?? 0), 9),
      rpad(money(d.cto?.reliabilitySpend ?? 0), 12), rpad(money(d.coo?.supportSpend ?? 0), 9),
      rpad(money(d.coo?.efficiencySpend ?? 0), 11), rpad(money(committed), 12),
      rpad(money(report?.revenue ?? 0), 13), rpad(money(report?.profit ?? 0), 13),
      rpad(money(us?.cash ?? 0), 11), rpad(money(us?.debt ?? 0), 13),
      /* The state and the worth, which is where failure was always visible and my first trace never looked. */
      rpad(us ? `${distressOf(us)}${us.bankruptSince ? ` y${us.bankruptSince}` : ""}` : "gone", 11),
      /* `valuation` returns a Valuation, not a number — `.fair` is the figure. */
      rpad(us ? money(valuation(us).fair) : "—", 12),
      rpad(custs.toLocaleString(), 9),
    );

    if (!us || us.closed) { console.log(`     closed in year ${year}`); return; }
  }
}

console.log("\n=== £60,000, and what the optimiser did with it =================");
for (const label of ["vet software", "coffee roastery", "launch hardware"]) {
  trace(label, 60_000, [...ROLES]);
  trace(label, 60_000, ["ceo"]);
}

console.log("\n\n=== A catalogue market on £60,000, which should not work =======");
trace("dating_apps", 60_000, [...ROLES]);
trace("dating_apps", 60_000, ["ceo"]);

console.log("\n\n=== The same catalogue market on the £6m it is designed for ====");
trace("dating_apps", 6_000_000, [...ROLES]);
console.log("");
