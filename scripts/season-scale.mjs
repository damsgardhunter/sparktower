/**
 * How long a fifty-company season actually takes.
 *
 * `botTeams` lets a company season seat fifty companies, a season runs up to
 * fourteen years, and a year resolves every company in one pass inside one
 * database transaction. Nobody had ever run that. Charging for something
 * whose worst case is unmeasured is how you find out about it from the person
 * paying.
 *
 * This measures the engine, not the route: `botDecision` for every seat of
 * every bot company, then `resolveYear`, year after year. That is where the
 * work is — the transaction around it writes one report row per company per
 * year, which is small and linear, but the resolve is the thing that could be
 * quadratic in companies without anybody noticing.
 *
 *   npx tsx scripts/season-scale.mjs [sizes...]
 *
 * It prints a table and exits 1 if a season would take longer than the budget
 * below, so this can be a gate rather than a thing somebody remembers to run.
 */
import { buildWorld } from "../shared/simulation/season.ts";
import { resolveYear } from "../shared/simulation/resolve.ts";
import { botDecision } from "../shared/simulation/bots.ts";
import { nicheById } from "../shared/simulation/niches.ts";
import { ROLES } from "../shared/simulation/types.ts";

/**
 * What a whole season is allowed to take, end to end.
 *
 * A season's years do not run together — one a day, or one on each advance —
 * so this is not a request budget. It is the budget for the one transaction
 * that resolves a single year, times fourteen, with room to spare: if the
 * fourteen years of a fifty-company season cost more than this, one of those
 * years is holding a transaction open for longer than is decent.
 */
const BUDGET_MS = 14_000;
const YEARS = 14;

const sizes = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n) && n > 0);
const plan = sizes.length ? sizes : [1, 10, 25, 50];

const niche = nicheById("dating_apps");
if (!niche) throw new Error("dating_apps is gone; pick another market");

/** One season of `teams` bot companies, resolved for `YEARS` years. */
function runSeason(teams) {
  const seasonId = `scale-${teams}`;
  let world = buildWorld({
    seasonId,
    niche,
    teams: Array.from({ length: teams }, (_, i) => ({
      id: `co-${i}`,
      name: `Company ${i}`,
      seats: [...ROLES],
      botRun: true,
    })),
  });

  const ours = new Set(world.companies.filter((c) => c.id.startsWith("co-")).map((c) => c.id));
  let decisionMs = 0;
  let resolveMs = 0;
  let worstYearMs = 0;
  let previous = new Map();

  for (let year = 1; year <= YEARS; year++) {
    const t0 = performance.now();
    const decisions = [];
    for (const company of world.companies) {
      if (!ours.has(company.id)) continue;
      const decision = { companyId: company.id };
      for (const role of ROLES) {
        decision[role] = botDecision({
          ventureId: company.id,
          year,
          role,
          company,
          niche,
          previous: previous.get(`${company.id}:${role}`),
        });
        previous.set(`${company.id}:${role}`, decision[role]);
      }
      decisions.push(decision);
    }
    const t1 = performance.now();
    const result = resolveYear({ ...world, year }, decisions);
    const t2 = performance.now();

    decisionMs += t1 - t0;
    resolveMs += t2 - t1;
    worstYearMs = Math.max(worstYearMs, t2 - t0);
    world = result.world;
  }

  const alive = world.companies.filter((c) => ours.has(c.id) && !c.bankrupt).length;
  return { teams, decisionMs, resolveMs, totalMs: decisionMs + resolveMs, worstYearMs, alive };
}

/*
 * A throwaway season first. Without it the first row measured is whatever the
 * engine costs before it has been compiled, which came out at six times the
 * per-company cost of every row after it — and a per-company figure that falls
 * as the season grows is the opposite of the thing this script is watching
 * for. The warm-up makes the shape of the table mean what it says.
 */
runSeason(4);

const rows = plan.map(runSeason);

const ms = (n) => `${n.toFixed(0)}ms`;
console.log(`\n${YEARS} years, one market, every company run by bots\n`);
console.log("companies   decisions      resolve        total    worst year   survived");
for (const r of rows) {
  console.log(
    String(r.teams).padEnd(11)
    + ms(r.decisionMs).padEnd(15)
    + ms(r.resolveMs).padEnd(15)
    + ms(r.totalMs).padEnd(13)
    + ms(r.worstYearMs).padEnd(13)
    + `${r.alive}/${r.teams}`,
  );
}

/*
 * The number that matters is not the total but its shape: if doubling the
 * companies more than doubles the time, the resolve is comparing companies to
 * each other somewhere and fifty is the size at which somebody notices.
 */
/*
 * Measured between the last two sizes rather than against the smallest,
 * because the smallest still pays for the market's incumbents in full. That
 * fixed cost makes a one-company season look expensive per company and every
 * larger one look like a bargain, which says nothing about how this scales.
 */
if (rows.length > 1) {
  const [a, b] = rows.slice(-2);
  const growth = (b.totalMs - a.totalMs) / Math.max(1, a.totalMs);
  const size = (b.teams - a.teams) / a.teams;
  console.log(
    `\n${a.teams} to ${b.teams} companies: ${(1 + size).toFixed(1)}x the companies for`
    + ` ${(1 + growth).toFixed(2)}x the time. At or under linear is fine; above it, the resolve is`
    + ` comparing companies to each other and fifty is where somebody notices.`,
  );
}

const over = rows.filter((r) => r.totalMs > BUDGET_MS);
if (over.length) {
  console.error(`\nOver budget (${BUDGET_MS}ms for ${YEARS} years): ${over.map((r) => `${r.teams} companies`).join(", ")}`);
  process.exit(1);
}
console.log(`\nWithin budget (${BUDGET_MS}ms for ${YEARS} years).`);
