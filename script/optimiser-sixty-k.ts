/**
 * £60,000 in the bank, which is what a person actually has.
 *
 * Run: npx tsx script/optimiser-sixty-k.ts
 *
 * Every season in this engine opens on `STARTING_YEARS_OF_RUNWAY` — 5.45 years
 * of the company's own costs — which comes to £6m for a five-person table in a
 * catalogue market, and £102k to £658k for the small custom markets. None of
 * those is a number somebody starting a business has. £60k is: a redundancy
 * payment, a year of savings, an angel cheque from a relative.
 *
 * So this holds the market and the company fixed and puts £60k in the bank
 * instead, then plays fourteen years with the optimiser filing every one. Two
 * table shapes, because they are two different businesses:
 *
 *   - five seats, which is what the lobby seats by default. Five executives at
 *     EXECUTIVE = £140,000 each is a payroll of £700,000 before anybody does
 *     anything, scaled by the market.
 *   - one seat, the solo founder (`seatCount: 1`), which is what somebody with
 *     £60,000 actually is.
 *
 * What is NOT adjusted: the plant and the home region, which `season.ts` sizes
 * against the opening cash. A company given £60k here still has the factory a
 * well-funded one would have built. That makes this generous rather than
 * harsh — if it dies at £60k here, it would die sooner honestly.
 */
import { buildCustomMarket } from "../shared/simulation/custom-market";
import { buildWorld, economyFor, STARTING_CASH } from "../shared/simulation/season";
import { resolveYear } from "../shared/simulation/resolve";
import { optimise } from "../shared/simulation/optimiser";
import { NICHES as CATALOGUE } from "../shared/simulation/niches";
import { marketScale } from "../shared/simulation/world";
import { officersOf, yearOfCostsFor, EXECUTIVE } from "../shared/simulation/decisions";
import { ROLES, type World, type Niche, type Role } from "../shared/simulation/types";
import { STARTUP_SPECS } from "./lib/startup-specs";

const POCKET = 60_000;

const money = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `£${(n / 1_000_000).toFixed(2)}m`;
  if (Math.abs(n) >= 1_000) return `£${Math.round(n / 1_000)}k`;
  return `£${Math.round(n)}`;
};
const pad = (s: string, n: number) => s.padEnd(n);
const mean = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / (ns.length || 1);

const markets: { label: string; niche: Niche }[] = [];
for (const s of STARTUP_SPECS) {
  const niche = buildCustomMarket(s.spec, `sixty-${s.label.replace(/\s+/g, "-")}`, { fresh: true });
  if (niche) markets.push({ label: s.label, niche });
}
for (const niche of CATALOGUE) markets.push({ label: `(catalogue) ${niche.id}`, niche });

/** A world whose company has `cash` in the bank and `seats` at the table. */
function worldWith(niche: Niche, seasonId: string, seats: Role[], cash: number): World {
  const world = buildWorld({ seasonId, niche, teams: [{ id: "us", name: "Us", seats }] });
  return {
    ...world,
    companies: world.companies.map((c) => (c.id === "us" ? { ...c, cash } : c)),
  };
}

console.log(`\n=== What £60,000 buys you ======================================\n`);
console.log(pad("startup", 24), pad("seats", 6), pad("a year of costs", 16), pad("runway at £60k", 15), "normally opens on");
for (const { label, niche } of markets) {
  const scale = marketScale(niche);
  for (const seats of [[...ROLES], ["ceo" as Role]]) {
    const yearCost = yearOfCostsFor({ officers: seats.length, seats, scale });
    const normal = worldWith(niche, "probe", seats, 0).companies.find((c) => c.id === "us");
    void normal;
    console.log(
      pad(seats.length === 1 ? "" : label, 24), pad(String(seats.length), 6),
      pad(money(yearCost), 16),
      pad(`${(POCKET / (yearCost || 1)).toFixed(2)} years`, 15),
      money(5.4545 * yearCost),
    );
  }
}

/** Fourteen years, the optimiser filing each one. */
function playOut(niche: Niche, seed: string, seats: Role[], cash: number) {
  const seasonId = `sixty-${niche.id}-${seats.length}-${seed}`;
  let world = worldWith(niche, seasonId, seats, cash);
  const totalYears = 14;
  let lowest = cash;

  for (let year = 1; year <= totalYears; year++) {
    const plan = optimise({ world, companyId: "us", year, economy: economyFor(seasonId, year, 1), totalYears });
    /*
     * No plan is itself an answer: `optimise` returns null only when the
     * company is gone, so a season that stops planning is a season that ended.
     */
    if (!plan) return { cash: 0, customers: 0, closedIn: year, lowest, spent: 0 };
    const spend =
      (plan.decisions.cmo?.brandSpend ?? 0) + (plan.decisions.cmo?.performanceSpend ?? 0) +
      (plan.decisions.cto?.featureSpend ?? 0) + (plan.decisions.cto?.reliabilitySpend ?? 0) +
      (plan.decisions.coo?.supportSpend ?? 0) + (plan.decisions.coo?.efficiencySpend ?? 0);

    world = resolveYear({ ...world, year }, [plan.decisions as never], economyFor(seasonId, year, 1)).world;
    const us = world.companies.find((c) => c.id === "us");
    if (!us || us.closed) return { cash: 0, customers: 0, closedIn: year, lowest, spent: spend };
    lowest = Math.min(lowest, us.cash ?? 0);
  }

  const us = world.companies.find((c) => c.id === "us")!;
  return {
    cash: us.cash ?? 0,
    customers: Object.values(us.customers ?? {}).reduce((a: number, b: any) => a + Number(b), 0),
    closedIn: 0, lowest, spent: 0,
  };
}

const SEEDS = ["a", "b", "c", "d"];

for (const [shapeLabel, seats] of [["five seats", [...ROLES]], ["solo founder", ["ceo" as Role]]] as const) {
  console.log(`\n=== £60k, ${shapeLabel}: fourteen years, ${SEEDS.length} seasons each ==========\n`);
  console.log(pad("startup", 24), pad("survived", 10), pad("mean cash", 11), pad("mean custs", 12), "lowest point");
  for (const { label, niche } of markets) {
    const runs = SEEDS.map((s) => playOut(niche, s, seats as Role[], POCKET));
    const lived = runs.filter((r) => !r.closedIn);
    const closedAt = runs.filter((r) => r.closedIn).map((r) => r.closedIn);
    console.log(
      pad(label, 24),
      pad(`${lived.length}/${runs.length}`, 10),
      pad(lived.length ? money(mean(lived.map((r) => r.cash))) : "—", 11),
      pad(lived.length ? Math.round(mean(lived.map((r) => r.customers))).toLocaleString() : "—", 12),
      closedAt.length ? `closed y${closedAt.join(",y")}` : money(Math.min(...runs.map((r) => r.lowest))),
    );
  }
}

/* And the same thing at the cash the engine would have given them, for contrast. */
console.log(`\n=== For contrast: solo founder on the engine's own opening cash ==\n`);
console.log(pad("startup", 24), pad("opens on", 11), pad("survived", 10), pad("mean cash", 11), "mean custs");
for (const { label, niche } of markets) {
  const scale = marketScale(niche);
  const given = Math.round(5.4545 * yearOfCostsFor({ officers: 1, seats: ["ceo"], scale }));
  const runs = SEEDS.map((s) => playOut(niche, s, ["ceo"], given));
  const lived = runs.filter((r) => !r.closedIn);
  console.log(
    pad(label, 24), pad(money(given), 11), pad(`${lived.length}/${runs.length}`, 10),
    pad(lived.length ? money(mean(lived.map((r) => r.cash))) : "—", 11),
    lived.length ? Math.round(mean(lived.map((r) => r.customers))).toLocaleString() : "—",
  );
}
console.log("");
console.log(`(EXECUTIVE = ${money(EXECUTIVE)} a seat a year, before scaling. STARTING_CASH = ${money(STARTING_CASH)}.)\n`);
