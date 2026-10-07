/**
 * Is three years of lookahead why the product is never funded?
 *
 * Run: npx tsx script/optimiser-horizon.ts
 *
 * Earlier diagnostics established that `featureSpend` is funded in 1 of 126
 * company-years and that bending a quarter of brand into it beats the
 * optimiser's own plan in 14 of 14 markets. The cause I first gave was wrong:
 * I said the search allocated using `forecastDemand`, which cannot see feature
 * spend. It does not — `measure()` runs the real engine via `resolveYear` for
 * ROLLOUT_YEARS and scores off what actually happened, and it is called for
 * every trial during allocation. `forecastDemand` only sizes the plant and the
 * final year's demand.
 *
 * So the live hypothesis is the horizon rather than the instrument. Brand pays
 * next year. A feature ships into `pipeline`, lands as quality the year after,
 * and quality pays through retention and what each segment will tolerate on
 * price — which compounds over many years. Three years may simply not be long
 * enough for the second to beat the first at the margin.
 *
 * This runs the same first-year decision at several horizons. ROLLOUT_YEARS is
 * a module constant, so it is patched on disk around each run by the caller
 * (see HORIZONS below) rather than injected.
 */
import { buildCustomMarket } from "../shared/simulation/custom-market";
import { buildWorld, economyFor } from "../shared/simulation/season";
import { optimise, ROLLOUT_YEARS } from "../shared/simulation/optimiser";
import { nicheById } from "../shared/simulation/niches";
import { ROLES, type Niche } from "../shared/simulation/types";
import { STARTUP_SPECS } from "./lib/startup-specs";

const money = (n: number) => `£${Math.round(n).toLocaleString()}`;
const pad = (s: string, n: number) => s.padEnd(n);
const rpad = (s: string, n: number) => s.padStart(n);

function nicheFor(label: string): Niche | null {
  const spec = STARTUP_SPECS.find((s) => s.label === label);
  if (spec) return buildCustomMarket(spec.spec, `hz-${label.replace(/\s+/g, "-")}`, { fresh: true });
  return nicheById(label) ?? null;
}

const MARKETS = ["dating_apps", "project_saas", "podcasts", "vet software", "coffee roastery"];

console.log(`\n=== First-year plan at ROLLOUT_YEARS = ${ROLLOUT_YEARS} ===============\n`);
console.log(pad("market", 20), rpad("brand", 11), rpad("perf", 11), rpad("FEATURE", 11), rpad("reliab", 11), rpad("support", 10), rpad("effic", 11), rpad("score", 14));

for (const label of MARKETS) {
  const niche = nicheFor(label);
  if (!niche) { console.log(pad(label, 20), "no market"); continue; }
  const seasonId = `hz-${label}`;
  const world = buildWorld({ seasonId, niche, teams: [{ id: "us", name: "Us", seats: [...ROLES] }] });
  const plan = optimise({ world, companyId: "us", year: 1, economy: economyFor(seasonId, 1, 1), totalYears: 14 });
  if (!plan) { console.log(pad(label, 20), "no plan"); continue; }
  const d = plan.decisions;
  console.log(
    pad(label, 20), rpad(money(d.cmo?.brandSpend ?? 0), 11), rpad(money(d.cmo?.performanceSpend ?? 0), 11),
    rpad(money(d.cto?.featureSpend ?? 0), 11), rpad(money(d.cto?.reliabilitySpend ?? 0), 11),
    rpad(money(d.coo?.supportSpend ?? 0), 10), rpad(money(d.coo?.efficiencySpend ?? 0), 11),
    rpad(Math.round(plan.score).toLocaleString(), 14),
  );
}
console.log("");
