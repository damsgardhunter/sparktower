/**
 * Is the optimiser right to never fund the product?
 *
 * Run: npx tsx script/optimiser-feature-probe.ts
 *
 * `script/optimiser-report.ts` found that `featureSpend` and `supportSpend` are
 * never funded — not in any of the seven markets, and not in any of fourteen
 * years. Both are in `SPEND_LEVERS`, both are unlocked from year one, so the
 * search is considering them and rejecting them every time.
 *
 * That is either a correct reading of the engine or a blind spot in it, and the
 * difference matters: a button that files "the best plan" and never once builds
 * the product is either teaching a real lesson about this market or teaching a
 * wrong one. So rather than argue from the code, this takes the optimiser's own
 * plan and moves money into the levers it refused, plays the year, and compares
 * what the company is worth afterwards.
 *
 * ## What it established, and what it did not
 *
 * Features are underfunded, and that result survives its own control. Moving a
 * quarter of brand into features beats the optimiser's plan in 7 of 7 markets;
 * *cutting* the same quarter and spending it on nothing is worse than the plan
 * in four of them (-1% to -11%). In those four the destination is doing the
 * work, not the cut, and the quality column shows the mechanism — features
 * raise it, the bare cut lowers it. Without the control row this file proved
 * nothing: "move money out of brand and things improve" is equally consistent
 * with brand being over-funded, which has the opposite fix.
 *
 * The *cause* is not established. Three explanations were offered and all three
 * are disproved, which is recorded here so nobody spends an afternoon on them
 * again:
 *
 *   - "The search allocates with `forecastDemand`, which cannot see feature
 *     spend." No: `measure()` runs the real engine through `resolveYear` for
 *     every trial and scores off what happened. `forecastDemand` only sizes the
 *     plant and the final year's demand.
 *   - "Three years of lookahead is too short for a pipeline to pay." No:
 *     `script/optimiser-horizon.ts` runs the same first-year decision at 3, 5
 *     and 7 years. Features are £0 at all three. Other levers move — efficiency
 *     appears at 7 — and features never do.
 *   - "`draftOf` charges every pound of features another 40p of
 *     `techDebtPaydown`, so it costs 1.4x at the margin." No: zeroing that term
 *     produces byte-identical plans and identical scores.
 */
import { buildWorld, economyFor } from "../shared/simulation/season";
import { resolveYear } from "../shared/simulation/resolve";
import { NICHES, nicheById } from "../shared/simulation/niches";
import { optimise } from "../shared/simulation/optimiser";
import { ROLES, type World } from "../shared/simulation/types";
import type { TeamDecisions } from "../shared/simulation/decisions";

const money = (n: number) => `£${(n / 1_000_000).toFixed(2)}m`;
const pad = (s: string, n: number) => s.padEnd(n);

/** Play a plan for `years`, re-planning each year, and say where it ended. */
function playOut(nicheId: string, years: number, seed: string, bend?: (d: TeamDecisions, year: number) => TeamDecisions) {
  const niche = nicheById(nicheId)!;
  const seasonId = `probe-${nicheId}-${seed}`;
  let world: World = buildWorld({ seasonId, niche, teams: [{ id: "us", name: "Us", seats: [...ROLES] }] });

  for (let year = 1; year <= years; year++) {
    const plan = optimise({ world, companyId: "us", year, economy: economyFor(seasonId, year, 1), totalYears: 14 });
    if (!plan) return null;
    const filed = bend ? bend(structuredClone(plan.decisions), year) : plan.decisions;
    world = resolveYear({ ...world, year }, [filed as never], economyFor(seasonId, year, 1)).world;
    const us = world.companies.find((c) => c.id === "us");
    if (!us || us.closed) return { cash: 0, customers: 0, quality: 0, closedIn: year };
  }

  const us = world.companies.find((c) => c.id === "us")!;
  return {
    cash: us.cash ?? 0,
    customers: Object.values(us.customers ?? {}).reduce((a: number, b: any) => a + Number(b), 0),
    quality: Math.round(((us as any).quality ?? 0) * 10) / 10,
    closedIn: 0,
  };
}

/**
 * Take a quarter of what the plan gave the lever it liked most, and give it to
 * the one it refused. A quarter rather than all of it, because the question is
 * whether the refused lever is worth *anything* at the margin, not whether it
 * is worth more than everything else put together.
 */
/**
 * Just cut a quarter of brand and spend it on nothing.
 *
 * The control this probe was missing. Every "bend" below moves money *out of
 * brand* and into something else, so a gain could be the destination earning
 * its keep or simply brand being over-funded — and those have opposite fixes.
 * Without this row the whole probe is unreadable.
 */
const cutBrand = (d: TeamDecisions): TeamDecisions => {
  const take = Math.round((d.cmo?.brandSpend ?? 0) * 0.25);
  if (!take) return d;
  d.cmo!.brandSpend = (d.cmo!.brandSpend ?? 0) - take;
  return d;
};

const moveTo = (field: "featureSpend" | "supportSpend") => (d: TeamDecisions): TeamDecisions => {
  const take = Math.round((d.cmo?.brandSpend ?? 0) * 0.25);
  if (!take) return d;
  d.cmo!.brandSpend = (d.cmo!.brandSpend ?? 0) - take;
  if (field === "featureSpend") d.cto!.featureSpend = (d.cto!.featureSpend ?? 0) + take;
  else d.coo!.supportSpend = (d.coo!.supportSpend ?? 0) + take;
  return d;
};

/*
 * Across several seasons, not one.
 *
 * `economyFor` is seeded on the season id and the year, and the year's events
 * come out of the same seed — so one run of each variant is one draw, and a ten
 * per cent gap between two draws says nothing. The bent run also re-plans from
 * a world its own earlier bends produced, so it is a different trajectory
 * rather than a controlled comparison. Averaging over seeds is the cheapest
 * thing that makes the difference legible.
 */
const SEEDS = ["a", "b", "c", "d", "e", "f", "g", "h"];
const mean = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / (ns.length || 1);

console.log("\n=== Fourteen years, averaged over " + SEEDS.length + " seasons ================\n");
console.log(pad("market", 18), pad("variant", 22), pad("mean cash", 11), pad("mean custs", 11), pad("quality", 8), "vs planned");

for (const niche of NICHES) {
  const variants: [string, ((d: TeamDecisions) => TeamDecisions) | undefined][] = [
    ["as planned", undefined],
    ["¼ brand cut, unspent", cutBrand],
    ["¼ brand → features", moveTo("featureSpend")],
    ["¼ brand → support", moveTo("supportSpend")],
  ];

  let baseCash = 0;
  for (const [label, bend] of variants) {
    const runs = SEEDS.map((s) => playOut(niche.id, 14, s, bend)).filter(Boolean) as NonNullable<ReturnType<typeof playOut>>[];
    const cash = mean(runs.map((r) => r.cash));
    const custs = mean(runs.map((r) => r.customers));
    const quality = mean(runs.map((r) => r.quality));
    const closed = runs.filter((r) => r.closedIn).length;
    if (label === "as planned") baseCash = cash;
    const delta = label === "as planned" ? "—"
      : `${cash >= baseCash ? "+" : ""}${(((cash - baseCash) / (baseCash || 1)) * 100).toFixed(1)}%`;
    console.log(
      pad(label === "as planned" ? niche.id : "", 18), pad(label, 22),
      pad(money(cash), 11), pad(Math.round(custs).toLocaleString(), 11),
      pad(quality.toFixed(1), 8), delta + (closed ? `  (${closed}/${runs.length} closed)` : ""),
    );
  }
  console.log("");
}
