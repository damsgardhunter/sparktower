/**
 * The builder reputation index: what it counts, and why it counts it that way.
 *
 * The first version scored ratios almost everywhere, and a ratio is the wrong
 * shape for most of this. One milestone finished out of one scored full marks
 * for execution; forty out of fifty scored less. Following ten projects — a
 * click — was worth a fifth of contribution, while finishing somebody else's
 * task was worth nothing at all, because contribution never looked at whose
 * project the work was on. And the strategic pillar asked a model to grade a
 * project's blurb, which measures how well the description was written, not
 * how the builder is doing.
 *
 * So the numbers here follow five rules:
 *
 *   1. **Volume counts, with diminishing returns, up to a stated target.**
 *      The fiftieth finished task is worth less than the fifth, so there is no
 *      cliff where a tenth of a percent of extra effort doubles a pillar — but
 *      every term does eventually arrive somewhere, at a number written down
 *      in `REPUTATION_TARGETS` and shown to the builder. See `toward`.
 *   2. **Rates only where the denominator is real.** An on-time rate over
 *      three milestones is noise, so a rate needs a minimum sample before it
 *      counts, and reads as neutral until it has one. Otherwise one lucky
 *      early deadline outranks a year of shipping.
 *   3. **Nothing that is free to fake.** Following a project, opening a
 *      project, and writing an application are not achievements. Finishing
 *      work, especially on somebody else's project, is.
 *   4. **Recency is visible but not punitive.** A builder who did good work a
 *      year ago keeps most of it; the consistency term is what rewards
 *      turning up lately, rather than decaying everything else away.
 *   5. **100 is extraordinary, and 100 is reachable.** Every term reaches its
 *      full marks at its target, so the index the profile promises — "out of
 *      100" — is a number a builder can actually finish at. It used not to be:
 *      see `toward`.
 *
 * Pure: no database, no clock, no model. `server/reputation-inputs.ts`
 * gathers the facts and `server/reputation.ts` stores the result, so this
 * module can be read, argued with, and tested on its own.
 */

/** The weights of the four pillars. They sum to 1. */
export const PILLAR_WEIGHTS = {
  execution: 0.3,
  contribution: 0.25,
  market: 0.25,
  strategy: 0.2,
} as const;

/**
 * A smooth, saturating curve: 0 at nothing, half the marks at `half`, and
 * approaching — never reaching — full marks after that.
 *
 * This is the shape a cap is trying to be and isn't. With a cap at ten, the
 * eleventh thing is worth exactly nothing and the tenth is worth as much as
 * the first; with this, the eleventh is worth a little, which is the honest
 * answer.
 */
export function saturate(value: number, half: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value / (value + Math.max(1e-9, half));
}

/**
 * The same shape, but it arrives: 0 at nothing, full marks at `full`, and
 * diminishing returns all the way there.
 *
 * ## Why `saturate` could not be the whole story
 *
 * Every term in all four pillars used to be a `saturate`, and a `saturate`
 * never reaches 1 — so no term could ever pay out in full, so no pillar could
 * reach 100, so the index could not either. The profile card says "out of 100"
 * under the number and draws a bar to 100 beside every pillar, and none of that
 * was true. The ceiling worked out at 99, and it was worse than the arithmetic
 * suggests: because the curve flattens, the last few points cost absurd
 * amounts. Market needed something like a hundred thousand followers *and* a
 * hundred thousand backers *and* a hundred thousand dollars to read 99, and a
 * 25x increase in money raised — $20k to $500k — bought two points of index.
 * A scale whose top is unreachable and whose top third is priced in orders of
 * magnitude is not a scale, it is an asymptote with a number painted on it.
 *
 * So volume terms use this instead. `full` is the target, written down in
 * `REPUTATION_TARGETS` and meant to read as *extraordinary*: a year of serious
 * work, not a lifetime and not an afternoon. Below it the square root keeps the
 * diminishing returns that were the point of `saturate` — the fortieth task is
 * worth less than the fourth — and a quarter of the way to a target is already
 * worth half its marks, so starting is visibly rewarded.
 *
 * Past the target it pays nothing more, which is the one thing `saturate` was
 * written to avoid. The original objection was that a cap makes "the eleventh
 * thing worth exactly nothing and the tenth worth as much as the first"; only
 * the first half of that survives here, because the curve under the cap is
 * still concave. And a builder who has finished 40 milestones, shipped 3
 * projects and turned up 40 weeks of the year does not need the score to keep
 * paying them. They have finished. That is what 100 is supposed to mean.
 *
 * `saturate` stays exactly as it was: the market simulation is built on it in
 * two dozen places, where an unreachable ceiling is the correct model of
 * spending money on advertising.
 */
export function toward(value: number, full: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const target = Math.max(1e-9, full);
  return Math.sqrt(Math.min(1, value / target));
}

/**
 * What "full marks" means for every counted term, in one table.
 *
 * These are not soft guidance, they are the divisors the pillars are computed
 * from — so this is simultaneously the tuning of the score and the thing the
 * product can show a builder as "here is what is left". One number, one place,
 * and no way for the copy on the page to drift from the arithmetic behind it.
 *
 * They were chosen to be an outstanding *year*, reachable by one person without
 * funding or an audience to start from. The old score had no such numbers to
 * choose, which is how the market pillar ended up implicitly asking for six
 * figures of donations before it would pay half its money term.
 */
export const REPUTATION_TARGETS = {
  execution: {
    /** Milestones finished. Roughly one a week, with time off. */
    milestonesCompleted: 40,
    /** Tasks finished. Five a week. */
    tasksCompleted: 250,
    /** Weeks of the last year with something finished in them — twelve weeks off is still full marks. */
    activeWeeks: 40,
    /** Projects taken all the way to "completed". */
    projectsShipped: 3,
  },
  contribution: {
    /** Tasks finished on projects somebody else owns. */
    tasksForOthers: 60,
    /** How many other people's projects that work was spread over. */
    projectsHelped: 8,
    /** Milestones closed out on other people's projects. */
    milestonesForOthers: 10,
    /** Comments left on other people's work. */
    feedbackGiven: 50,
    /** Reactions that feedback drew, which is other people saying it helped. */
    feedbackAppreciated: 40,
    /** Updates posted about your own projects. */
    updatesPosted: 40,
    /** People you have shared a project with. */
    collaborators: 10,
  },
  market: {
    /** Dollars pledged to your projects. Ten thousand, not the six figures the old curve implied. */
    donationsReceived: 10_000,
    backersCount: 50,
    followersAttracted: 200,
    /** Projects with somewhere outside the platform to point at. */
    externalTraction: 3,
    projectsLaunched: 4,
  },
  strategy: {
    /** Distinct simulation markets played. Replays of one market still count once — see `simScore`. */
    marketsPlayed: 4,
    contestWins: 3,
  },
} as const;

/**
 * A rate that admits when it hasn't got the numbers.
 *
 * Below `minimum` observations it returns `neutral` rather than whatever the
 * handful of samples happened to say — one deadline met is not a record of
 * meeting deadlines, and one missed is not a record of missing them.
 */
export function rate(part: number, whole: number, minimum: number, neutral = 0.5): number {
  if (whole < minimum || whole <= 0) return neutral;
  return Math.max(0, Math.min(1, part / whole));
}

const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// ─── The facts each pillar is built from ─────────────────────────────────────

export interface ExecutionFacts {
  /** Milestones finished on the user's own and member projects, all time. */
  milestonesCompleted: number;
  /** Of those, the ones finished on or before their target date. */
  milestonesOnTime: number;
  /** Milestones with a target date, finished — the denominator for punctuality. */
  milestonesWithDates: number;
  /** Milestones still open. Carried for the breakdown, not scored: plans are not failures. */
  milestonesOpen: number;
  /** Tasks finished, from the durable completion log rather than live board rows. */
  tasksCompleted: number;
  /** Of those, the ones inside their due date. */
  tasksOnTime: number;
  /** Distinct weeks in the last year with at least one thing finished. */
  activeWeeks: number;
  /** Projects the user owns that reached "completed". */
  projectsShipped: number;
  /** How far along the user's live projects are, 0–1, averaged over projects with any plan at all. */
  progress: number;
  /** How many projects that average is over. Below two, progress is one project's opinion. */
  progressProjects: number;
}

export interface ContributionFacts {
  /** Tasks finished on projects somebody else owns. The thing the old score missed entirely. */
  tasksForOthers: number;
  /** Distinct projects of other people's the user has finished work on. */
  projectsHelped: number;
  /** Milestones finished on other people's projects. */
  milestonesForOthers: number;
  /** Comments left on other people's projects — feedback given, not received. */
  feedbackGiven: number;
  /** Reactions those comments drew. Whether the help was worth having, in other people's words. */
  feedbackAppreciated: number;
  /** Updates posted about the user's own projects: saying what happened is contribution too. */
  updatesPosted: number;
  /** Distinct people the user has shared a project with. */
  collaborators: number;
}

export interface MarketFacts {
  donationsReceived: number;
  backersCount: number;
  followersAttracted: number;
  externalTraction: number;
  projectsLaunched: number;
}

/** How a builder's companies actually did in the market simulation. */
export interface SimFacts {
  seasons: {
    /**
     * Which market it was played in.
     *
     * A replay keeps the market it copied, so this is the same string across
     * every run of one world — which is exactly what stops eleven goes at a
     * memorised market reading as eleven seasons. See `simScore`.
     */
    marketId: string;
    /** When it was played, so the most recent run of a market can be found. Epoch ms. */
    playedAt: number;
    /** Where the company finished, 1 is first. */
    rank: number;
    /** How many companies were in that market, so a rank means something. */
    field: number;
    /** Years played of the season's whole length — abandoning at year two is not a result. */
    yearsPlayed: number;
    totalYears: number;
    /** The company's share of the market at the end, 0–1. */
    marketShare: number;
    /** Profitable in its final year. */
    profitable: boolean;
    /** Ran out of money and credit. */
    bankrupt: boolean;
  }[];
}

export interface StrategyFacts {
  sim: SimFacts;
  /** Nova's weekly reading of how this builder is playing it, 0–100. Null until it has run. */
  aiScore: number | null;
  contestWins: number;
}

export interface ReputationFacts {
  execution: ExecutionFacts;
  contribution: ContributionFacts;
  market: MarketFacts;
  strategy: StrategyFacts;
}

// ─── The pillars ─────────────────────────────────────────────────────────────

/**
 * Execution: does this builder finish things, and on time?
 *
 * Milestones lead, because a milestone is the unit a builder plans in, and the
 * old score's reading of them — a completion ratio — meant a project with one
 * milestone was "fully executed". Here finishing forty is worth more than
 * finishing one however many are open, punctuality is a separate term with its
 * own minimum sample, and consistency counts weeks turned up rather than posts
 * written.
 */
export function executionScore(f: ExecutionFacts): number {
  const T = REPUTATION_TARGETS.execution;
  const volume = 26 * toward(f.milestonesCompleted, T.milestonesCompleted);
  /*
   * Punctuality reads as neutral on too small a sample — but only for somebody
   * who has finished something. A builder on their first day has no record to
   * be neutral about, and paying them half of two punctuality terms put a
   * brand-new account above zero for having done nothing at all.
   */
  const punctuality = f.milestonesCompleted > 0 ? 16 * rate(f.milestonesOnTime, f.milestonesWithDates, 3) : 0;
  const tasks = 18 * toward(f.tasksCompleted, T.tasksCompleted);
  const taskPunctuality = f.tasksCompleted > 0 ? 8 * rate(f.tasksOnTime, f.tasksCompleted, 8) : 0;
  const consistency = 12 * toward(f.activeWeeks, T.activeWeeks);
  /*
   * Shipping, which this pillar used not to count at all.
   *
   * `projectsShipped` was gathered by `executionFacts`, carried through
   * `ReputationFacts`, and printed in the breakdown the profile card reads — and
   * never once multiplied by anything. Taking a project all the way to
   * "completed" is the single clearest evidence of execution the product has,
   * and it was worth zero points.
   */
  const shipped = 10 * toward(f.projectsShipped, T.projectsShipped);
  /* Progress is only worth reading across more than one project. */
  const progress = 10 * (f.progressProjects >= 2 ? Math.max(0, Math.min(1, f.progress)) : 0.5 * Math.max(0, Math.min(1, f.progress)));
  return clamp100(volume + punctuality + tasks + taskPunctuality + consistency + shipped + progress);
}

/**
 * Contribution: what has this builder done for other people's work?
 *
 * The old pillar counted projects joined, a task ratio, and projects followed,
 * none of which is a contribution — you can have all three without ever
 * helping anybody. Work on somebody else's project is the whole point here,
 * and it carries the most marks. A builder's own updates still count, because
 * telling people what happened is how everyone else learns anything, but they
 * cannot carry the pillar on their own.
 */
export function contributionScore(f: ContributionFacts): number {
  const T = REPUTATION_TARGETS.contribution;
  const forOthers = 30 * toward(f.tasksForOthers, T.tasksForOthers);
  const breadth = 16 * toward(f.projectsHelped, T.projectsHelped);
  const milestones = 10 * toward(f.milestonesForOthers, T.milestonesForOthers);
  const feedback = 18 * toward(f.feedbackGiven, T.feedbackGiven);
  /* Whether the feedback was worth having, judged by the people who got it. */
  const appreciated = 10 * toward(f.feedbackAppreciated, T.feedbackAppreciated);
  const updates = 10 * toward(f.updatesPosted, T.updatesPosted);
  const together = 6 * toward(f.collaborators, T.collaborators);
  return clamp100(forOthers + breadth + milestones + feedback + appreciated + updates + together);
}

/**
 * Market signal: has anything the builder made reached anybody outside it?
 *
 * This is the pillar the old curves treated worst. `34 * saturate(donations,
 * 5_000)` pays 17 of its 34 marks at five thousand dollars and then crawls:
 * $100k read 30, $500k read 32, and the 34 was never available at any price. A
 * builder who raised half a million dollars and one who raised a hundred
 * thousand scored two points apart, which is not a measurement of anything.
 * The targets are deliberately the numbers an unfunded builder with no audience
 * could actually reach in a strong year.
 */
export function marketScore(f: MarketFacts): number {
  const T = REPUTATION_TARGETS.market;
  const money = 30 * toward(f.donationsReceived, T.donationsReceived);
  const backers = 20 * toward(f.backersCount, T.backersCount);
  const followers = 20 * toward(f.followersAttracted, T.followersAttracted);
  const traction = 15 * toward(f.externalTraction, T.externalTraction);
  const launched = 15 * toward(f.projectsLaunched, T.projectsLaunched);
  return clamp100(money + backers + followers + traction + launched);
}

/**
 * One season of the simulation, as a mark out of one.
 *
 * Placement is most of it, against the size of the field — first of nine is
 * not first of three. Then whether the company made money, whether it held any
 * of the market, and whether the builder stayed to the end: a season abandoned
 * in year two is not a bad result, it is an unfinished one, and it is scored
 * as the fraction it was played.
 */
export function seasonScore(s: SimFacts["seasons"][number]): number {
  const field = Math.max(2, s.field);
  const placement = Math.max(0, Math.min(1, (field - Math.max(1, s.rank)) / (field - 1)));
  const share = Math.max(0, Math.min(1, s.marketShare / 0.35));
  const money = s.bankrupt ? 0 : s.profitable ? 1 : 0.4;
  const played = Math.max(0, Math.min(1, s.yearsPlayed / Math.max(1, s.totalYears)));
  return (placement * 0.45 + share * 0.2 + money * 0.2 + played * 0.15);
}

/**
 * How the builder plays the market simulation, over every *market* they have
 * played, with the better half weighted more heavily.
 *
 * A builder learning the game will lose the first one badly, and holding that
 * against them for the rest of the year would make the pillar a record of when
 * somebody started rather than how they play. Their best market counts double,
 * which is the usual way of reading a record of games.
 *
 * ## Why per market and not per season
 *
 * Both halves of this used to count seasons, and both were written when a
 * season was scarce: each one cost a model call and arrived in a market nobody
 * had seen before, so playing more of them really was more evidence. Replaying
 * a market you already own is now free and gives you the *same* world — same
 * rivals, same shares, same arithmetic — and that broke the assumption twice
 * over. The best run counted double, so eleven goes at a memorised market
 * meant eleven chances at a flattering `best`; and `settled` rose with the
 * count, so the grinding paid a second time.
 *
 * A market is the unit of evidence, and what it contributes is the **most
 * recent** run of it, not the best. Taking the best would have left the hole
 * half open: eleven goes at one world and you keep the luckiest, which is a
 * record of your best afternoon rather than how you play. The latest run is
 * how you play *now*, and it still rewards practice — the honest kind, where
 * the eleventh go is better than the first because you learned something, not
 * because you rolled it again.
 *
 * Across markets the best still counts double. That is where the learning
 * curve belongs: a builder who lost their first market badly is not held to it
 * forever, and no amount of replaying one world can manufacture a second.
 */
export function simScore(f: SimFacts): number | null {
  if (f.seasons.length === 0) return null;
  /*
   * Best per market. A season with no market id — an older row, or one of the
   * seven played straight — falls back to its own identity so it still counts
   * once, rather than every such season collapsing into one.
   */
  const latestByMarket = new Map<string, { at: number; score: number }>();
  f.seasons.forEach((season, i) => {
    const key = season.marketId || `season:${i}`;
    const held = latestByMarket.get(key);
    const at = Number.isFinite(season.playedAt) ? season.playedAt : i;
    if (!held || at >= held.at) latestByMarket.set(key, { at, score: seasonScore(season) });
  });

  const scores = [...latestByMarket.values()].map((x) => x.score).sort((a, b) => b - a);
  const best = scores[0];
  const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  const blended = (best * 2 + mean) / 3;
  /*
   * Playing a second *market* is evidence; playing the same one twice is
   * practice. Full confidence at `marketsPlayed` distinct markets — it used to
   * be a `saturate`, so the multiplier topped out just short of 1 and quietly
   * held the pillar below its own ceiling no matter how well anybody played.
   */
  const settled = 0.85 + 0.15 * toward(scores.length - 1, REPUTATION_TARGETS.strategy.marketsPlayed - 1);
  return clamp100(blended * settled * 100);
}

/**
 * Strategy: how the builder decides things, rather than how they write.
 *
 * Two readings, and the pillar renormalises over whichever it has, so a
 * builder who has never touched the simulation is not held to have failed it:
 *
 *   - **The simulation**, daily, from seasons actually played. It is the one
 *     place in the product where a builder's decisions are scored by something
 *     other than themselves.
 *   - **Nova's weekly read** of what they are building and how they are going
 *     about it.
 *
 * Contest wins are a small, honest extra, and they are the only thing that
 * survives when there is neither a season nor a verdict — which is the
 * shape the old pillar had for everyone.
 */
export function strategyScore(f: StrategyFacts): number {
  const sim = simScore(f.sim);
  const parts: { value: number; weight: number }[] = [];
  if (sim !== null) parts.push({ value: sim, weight: 45 });
  if (f.aiScore !== null) parts.push({ value: Math.max(0, Math.min(100, f.aiScore)), weight: 45 });
  const wins = 100 * toward(f.contestWins, REPUTATION_TARGETS.strategy.contestWins);
  parts.push({ value: wins, weight: parts.length === 0 ? 100 : 10 });

  const total = parts.reduce((sum, p) => sum + p.weight, 0);
  return clamp100(parts.reduce((sum, p) => sum + p.value * p.weight, 0) / total);
}

// ─── The index ───────────────────────────────────────────────────────────────

export interface ReputationResult {
  execution: number;
  contribution: number;
  market: number;
  strategy: number;
  builderIndex: number;
  /** What each pillar was built from, for the card that explains the number. */
  details: Record<string, unknown>;
}

export function reputationFrom(facts: ReputationFacts): ReputationResult {
  const execution = executionScore(facts.execution);
  const contribution = contributionScore(facts.contribution);
  const market = marketScore(facts.market);
  const strategy = strategyScore(facts.strategy);

  const builderIndex = clamp100(
    execution * PILLAR_WEIGHTS.execution
    + contribution * PILLAR_WEIGHTS.contribution
    + market * PILLAR_WEIGHTS.market
    + strategy * PILLAR_WEIGHTS.strategy,
  );

  return {
    execution,
    contribution,
    market,
    strategy,
    builderIndex,
    details: {
      execution: {
        milestonesCompleted: facts.execution.milestonesCompleted,
        milestonesOpen: facts.execution.milestonesOpen,
        milestoneOnTimeRate: facts.execution.milestonesWithDates >= 3
          ? Math.round(rate(facts.execution.milestonesOnTime, facts.execution.milestonesWithDates, 3) * 100)
          : null,
        tasksCompleted: facts.execution.tasksCompleted,
        taskOnTimeRate: facts.execution.tasksCompleted >= 8
          ? Math.round(rate(facts.execution.tasksOnTime, facts.execution.tasksCompleted, 8) * 100)
          : null,
        activeWeeks: facts.execution.activeWeeks,
        projectProgress: Math.round(facts.execution.progress * 100),
        projectsShipped: facts.execution.projectsShipped,
      },
      contribution: {
        tasksForOthers: facts.contribution.tasksForOthers,
        projectsHelped: facts.contribution.projectsHelped,
        milestonesForOthers: facts.contribution.milestonesForOthers,
        feedbackGiven: facts.contribution.feedbackGiven,
        feedbackAppreciated: facts.contribution.feedbackAppreciated,
        updatesPosted: facts.contribution.updatesPosted,
        collaborators: facts.contribution.collaborators,
      },
      market: { ...facts.market },
      strategy: {
        simScore: simScore(facts.strategy.sim),
        seasonsPlayed: facts.strategy.sim.seasons.length,
        bestFinish: facts.strategy.sim.seasons.length
          ? Math.min(...facts.strategy.sim.seasons.map((s) => s.rank))
          : null,
        aiScore: facts.strategy.aiScore,
        contestWins: facts.strategy.contestWins,
      },
    },
  };
}

/** Nothing done yet — the shape a builder starts at, rather than an absent row. */
export const EMPTY_FACTS: ReputationFacts = {
  execution: {
    milestonesCompleted: 0, milestonesOnTime: 0, milestonesWithDates: 0, milestonesOpen: 0,
    tasksCompleted: 0, tasksOnTime: 0, activeWeeks: 0, projectsShipped: 0, progress: 0, progressProjects: 0,
  },
  contribution: {
    tasksForOthers: 0, projectsHelped: 0, milestonesForOthers: 0, feedbackGiven: 0,
    feedbackAppreciated: 0, updatesPosted: 0, collaborators: 0,
  },
  market: { donationsReceived: 0, backersCount: 0, followersAttracted: 0, externalTraction: 0, projectsLaunched: 0 },
  strategy: { sim: { seasons: [] }, aiScore: null, contestWins: 0 },
};

/** How often each part of the index is worked out again. */
export const REFRESH = {
  /** The index itself, on the hour. */
  indexMs: 60 * 60 * 1000,
  /** Simulation results, daily — a season moves one year a day. */
  simMs: 24 * 60 * 60 * 1000,
  /** Nova's strategy read, weekly: it costs money and a week is how fast a plan really changes. */
  aiMs: 7 * 24 * 60 * 60 * 1000,
} as const;
