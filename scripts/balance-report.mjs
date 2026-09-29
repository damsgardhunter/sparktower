/**
 * Is the game balanced, and where is it not?
 *
 * `test/unit/balance.test.ts` asks the yes-or-no questions — can you win, can
 * you lose, is there more than one way to play. They pass, and they passed
 * while two of the seven markets were killing nearly everybody who played
 * them, because a pass/fail cannot show a distribution.
 *
 * This prints the distribution. It runs the same reasonable company many
 * times in every market and reports what happened to it: how many survived,
 * what the middle one ended with, and how far apart the best and worst were.
 * The numbers that matter are not the averages but the shape — a market where
 * outcomes are bimodal, a few compounding into tens of millions and the rest
 * spiralling to nothing, is a coin toss wearing a strategy game's clothes.
 *
 *   npm run sim:balance            — every market, 24 runs each
 *   npm run sim:balance -- 48      — more runs, less noise
 *
 * Slow on purpose: a season is fourteen years and there are seven markets.
 * Being able to see the shape is worth a minute.
 */
import { buildWorld } from "../shared/simulation/season.ts";
import { resolveYear } from "../shared/simulation/resolve.ts";
import { botDecision } from "../shared/simulation/bots.ts";
import { NICHES } from "../shared/simulation/niches.ts";
import { ROLES } from "../shared/simulation/types.ts";

const RUNS = Math.max(4, Math.min(200, Number(process.argv[2]) || 24));
const YEARS = 14;
/**
 * How well the bots play. `filler` is a warm body in a seat nobody took;
 * `survivor` is a company actually trying to get in. Comparing the two is
 * the only way to tell whether a change to the bots is an improvement or a
 * story about one.
 */
const SKILL = process.argv[3] === "survivor" ? "survivor" : "filler";

/** One company, played by the bots, for a whole season. */
function season(niche, i) {
  const id = `run-${i}`;
  let world = buildWorld({ seasonId: `balance-${niche.id}-${i}`, niche, teams: [{ id, name: "C", seats: [...ROLES], botRun: true }] });
  const previous = new Map();
  for (let year = 1; year <= YEARS; year++) {
    const company = world.companies.find((c) => c.id === id);
    const decision = { companyId: id };
    for (const role of ROLES) {
      decision[role] = botDecision({ ventureId: id, year, role, company, niche, previous: previous.get(role), skill: SKILL, rivals: world.companies.filter((x) => x.id !== id) });
      previous.set(role, decision[role]);
    }
    world = resolveYear({ ...world, year }, [decision]).world;
  }
  const c = world.companies.find((x) => x.id === id);
  return { alive: !c.bankrupt && c.cash >= 0, cash: c.cash, customers: Object.values(c.customers).reduce((a, b) => a + b, 0) };
}

const m = (n) => (n < 0 ? "-£" : "£") + (Math.abs(n) / 1e6).toFixed(1) + "m";
const rows = [];

for (const niche of NICHES) {
  const ends = Array.from({ length: RUNS }, (_, i) => season(niche, i));
  const cash = ends.map((e) => e.cash).sort((a, b) => a - b);
  const alive = ends.filter((e) => e.alive).length;
  /*
   * How bimodal it is: the gap between the middle of the winners and the
   * middle of the losers, against the middle overall. A market where those
   * two clusters are far apart and the middle is empty is one where the
   * season is decided early and then compounds.
   */
  const half = Math.floor(RUNS / 2);
  const low = cash.slice(0, half), high = cash.slice(half);
  const mid = (a) => a[Math.floor(a.length / 2)];
  rows.push({
    name: niche.name, alive, runs: RUNS,
    median: mid(cash), worst: cash[0], best: cash[cash.length - 1],
    split: mid(high) - mid(low),
  });
}

console.log(`\n${RUNS} seasons of ${YEARS} years in each market, one company, bots playing as ${SKILL}\n`);
console.log("market                       survived   median      worst      best        winners vs losers");
for (const r of rows) {
  console.log(r.name.padEnd(29) + `${r.alive}/${r.runs}`.padEnd(11)
    + m(r.median).padEnd(12) + m(r.worst).padEnd(11) + m(r.best).padEnd(12) + m(r.split));
}

const total = rows.reduce((s, r) => s + r.alive, 0);
console.log(`\nsurvived overall: ${total} of ${rows.length * RUNS} (${Math.round(total / (rows.length * RUNS) * 100)}%)`);

/*
 * The two things worth shouting about. A market nearly nobody survives is a
 * trap for whoever picks it off a menu; a market nobody can lose is a
 * slideshow. Neither is visible from a test that only asks "is it possible".
 */
const brutal = rows.filter((r) => r.alive / r.runs < 0.45);
const soft = rows.filter((r) => r.alive / r.runs > 0.95);
if (brutal.length) console.log("\nnearly unplayable: " + brutal.map((r) => `${r.name} (${r.alive}/${r.runs})`).join(", "));
if (soft.length) console.log("hard to lose:      " + soft.map((r) => `${r.name} (${r.alive}/${r.runs})`).join(", "));
if (!brutal.length && !soft.length) console.log("\nevery market sits between 45% and 95% survival.");
