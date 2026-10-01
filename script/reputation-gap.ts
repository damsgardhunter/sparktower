/**
 * What is standing between one builder and a 100 in every pillar.
 *
 * The index is four weighted pillars of seven, seven, five and three terms, and
 * a number on a profile card cannot say which of the twenty-two is the one
 * holding it down. This prints exactly that: every counted term, what the
 * builder has, what the target is, and how many points are still on the table —
 * sorted so the cheapest points come first.
 *
 * It reads the same fact-gatherers the hourly pass uses
 * (`server/reputation-inputs.ts`) and the same pure arithmetic
 * (`shared/reputation.ts`), so it cannot drift from the real score: if this says
 * forty more tasks is worth six points, forty more tasks is worth six points.
 *
 * Read-only. It never writes a score row and never calls Nova — the strategy
 * pillar is read from whatever the weekly pass last stored, because asking
 * costs money per run and a gap report is something you run repeatedly.
 *
 *   DATABASE_URL=… npx tsx script/reputation-gap.ts <username-or-email-or-id>
 */
import { eq, or, sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { db } from "../server/db";
import { userProfiles, userReputationScores, users } from "@shared/schema";
import {
  PILLAR_WEIGHTS, REPUTATION_TARGETS, contributionScore, executionScore, marketScore,
  reputationFrom, strategyScore, type ReputationFacts,
} from "@shared/reputation";
import { contestWins, contributionFacts, executionFacts, marketFacts, simFacts } from "../server/reputation-inputs";

/** One counted term: where the builder is, and where full marks begin. */
interface Gap {
  pillar: keyof typeof PILLAR_WEIGHTS;
  term: string;
  have: number;
  target: number;
  /** Points of the 100-point pillar still unearned on this term. */
  missing: number;
  /** Points of the *index* still unearned — the pillar's points times its weight. */
  indexMissing: number;
  unit: string;
}

const UNITS: Record<string, string> = {
  milestonesCompleted: "milestones finished",
  tasksCompleted: "tasks finished",
  activeWeeks: "weeks with something finished (of the last 52)",
  projectsShipped: "projects taken to 'completed'",
  tasksForOthers: "tasks finished on other people's projects",
  projectsHelped: "other people's projects helped on",
  milestonesForOthers: "milestones closed on other people's projects",
  feedbackGiven: "comments left on other people's work",
  feedbackAppreciated: "reactions that feedback drew",
  updatesPosted: "updates posted about your projects",
  collaborators: "people you have shared a project with",
  donationsReceived: "dollars pledged to your projects",
  backersCount: "distinct backers",
  followersAttracted: "followers on your projects (not counting you)",
  externalTraction: "projects with an external traction link",
  projectsLaunched: "projects live or completed",
  marketsPlayed: "distinct simulation markets played",
  contestWins: "contests won outright",
};

/**
 * How much a term is worth, measured rather than declared.
 *
 * Rather than restating each term's coefficient here — a second copy that would
 * drift the first time anybody retuned a pillar — this scores the builder as
 * they are, then again with that one term at its target, and takes the
 * difference. It is the term's real marginal value under the real function.
 */
function gapsFor<T extends object>(
  pillar: keyof typeof PILLAR_WEIGHTS,
  facts: T,
  targets: Record<string, number>,
  score: (f: T) => number,
): Gap[] {
  const base = score(facts);
  return Object.entries(targets).flatMap(([term, target]) => {
    const have = Number((facts as any)[term] ?? 0);
    if (have >= target) return [];
    const missing = score({ ...facts, [term]: target }) - base;
    return [{
      pillar, term, have, target,
      missing,
      indexMissing: missing * PILLAR_WEIGHTS[pillar],
      unit: UNITS[term] ?? term,
    }];
  });
}

const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

async function main(): Promise<number> {
  const who = process.argv[2];
  if (!who) {
    console.error("Usage: npx tsx script/reputation-gap.ts <username | email | user id>");
    return 1;
  }

  /* The handle is on `user_profiles`, not `users`, so either can name a builder. */
  const [user] = await db
    .select({
      id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName,
      username: userProfiles.username, displayName: userProfiles.displayName,
    })
    .from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(or(eq(users.id, who), eq(users.email, who), eq(userProfiles.username, who)));
  if (!user) {
    console.error(`No account matches ${who}.`);
    return 1;
  }

  const [stored] = await db.select().from(userReputationScores).where(eq(userReputationScores.userId, user.id));
  const [execution, contribution, market, wins, sim] = await Promise.all([
    executionFacts(user.id), contributionFacts(user.id), marketFacts(user.id), contestWins(user.id), simFacts(user.id),
  ]);
  const facts: ReputationFacts = {
    execution, contribution, market,
    strategy: { sim, aiScore: stored?.aiScore ?? null, contestWins: wins },
  };
  const now = reputationFrom(facts);

  const name = user.displayName || [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || user.id;
  console.log(`\n${name}  (@${user.username ?? "—"})`);
  console.log("─".repeat(74));
  for (const p of ["execution", "contribution", "market", "strategy"] as const) {
    const bar = "█".repeat(Math.round(now[p] / 4)).padEnd(25, "·");
    console.log(`  ${p.padEnd(13)} ${String(now[p]).padStart(3)} / 100  ${bar}  ×${PILLAR_WEIGHTS[p]}`);
  }
  console.log(`  ${"BUILDER INDEX".padEnd(13)} ${String(now.builderIndex).padStart(3)} / 100`);

  /*
   * The strategy pillar is not a list of counters like the other three: two of
   * its three parts are a model's opinion and a simulation result, so it is
   * reported rather than tabulated.
   */
  const distinctMarkets = new Set(sim.seasons.map((s, i) => s.marketId || `season:${i}`)).size;
  const gaps = [
    ...gapsFor("execution", execution, { ...REPUTATION_TARGETS.execution }, executionScore),
    ...gapsFor("contribution", contribution, { ...REPUTATION_TARGETS.contribution }, contributionScore),
    ...gapsFor("market", market, { ...REPUTATION_TARGETS.market }, marketScore),
  ].sort((a, b) => b.indexMissing - a.indexMissing);

  if (gaps.length === 0) {
    console.log("\nEvery counted term is at or past its target.");
  } else {
    console.log(`\nWHAT IS LEFT — ${gaps.length} terms short, biggest first`);
    console.log("─".repeat(74));
    for (const g of gaps) {
      console.log(
        `  +${g.indexMissing.toFixed(2).padStart(5)} index  `
        + `${g.pillar.padEnd(12)} ${n(g.have).padStart(6)} → ${n(g.target).padEnd(6)}  ${g.unit}`,
      );
    }
  }

  console.log(`\nSTRATEGY — ${now.strategy} / 100`);
  console.log("─".repeat(74));
  console.log(`  simulation   ${distinctMarkets} distinct market(s) played, target ${REPUTATION_TARGETS.strategy.marketsPlayed}`
    + ` — worth 45% of the pillar${distinctMarkets === 0 ? " (unscored until you play one)" : ""}`);
  console.log(`  Nova's read  ${stored?.aiScore ?? "not yet run"} — worth 45% of the pillar, refreshed weekly`);
  console.log(`  contests     ${wins} won, target ${REPUTATION_TARGETS.strategy.contestWins} — worth 10%`);

  /* What the index would be if every counted term hit its target and nothing else changed. */
  const maxed = reputationFrom({
    execution: { ...execution, ...REPUTATION_TARGETS.execution },
    contribution: { ...contribution, ...REPUTATION_TARGETS.contribution },
    market: { ...market, ...REPUTATION_TARGETS.market },
    strategy: facts.strategy,
  });
  console.log(`\nEvery counted term at target, strategy untouched: index ${maxed.builderIndex}.`);
  console.log(`A 100 also needs strategy at 100: Nova reading 100, ${REPUTATION_TARGETS.strategy.contestWins} contest wins,`);
  console.log(`and ${REPUTATION_TARGETS.strategy.marketsPlayed} distinct markets won outright with ≥35% share and a profit.\n`);
  return 0;
}

/*
 * Only when run as a command, never on import — the sibling scripts learned
 * this the expensive way (see `script/baseline-migrations.ts`): a `main()` at
 * module scope makes importing anything from the file connect to a database and
 * call process.exit inside whatever imported it.
 */
const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => { console.error(err); process.exit(1); },
  );
}
