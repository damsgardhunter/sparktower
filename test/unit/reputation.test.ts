/**
 * What the builder index rewards.
 *
 * These are the complaints the scoring was rebuilt for, written as tests so
 * they cannot come back: one milestone out of one used to score full marks for
 * execution, following ten projects was worth a fifth of contribution while
 * finishing somebody else's task was worth nothing, and the strategy pillar
 * graded a project's blurb rather than anything the builder decided.
 */
import { describe, it, expect } from "vitest";
import {
  EMPTY_FACTS, PILLAR_WEIGHTS, contributionScore, executionScore, rate,
  reputationFrom, saturate, seasonScore, simScore, strategyScore,
  type ContributionFacts, type ExecutionFacts, type SimFacts,
} from "@shared/reputation";

const execution = (over: Partial<ExecutionFacts> = {}): ExecutionFacts => ({ ...EMPTY_FACTS.execution, ...over });
const contribution = (over: Partial<ContributionFacts> = {}): ContributionFacts => ({ ...EMPTY_FACTS.contribution, ...over });
/*
 * A different market each time unless one is named. Most of these tests are
 * about how a season is scored rather than which world it was in, and giving
 * them all the same market would silently collapse them into one result now
 * that a market is the unit of evidence.
 */
let seasonN = 0;
const season = (over: Partial<SimFacts["seasons"][number]> = {}) => ({
  marketId: `market_${++seasonN}`, playedAt: seasonN,
  rank: 5, field: 9, yearsPlayed: 14, totalYears: 14, marketShare: 0.1, profitable: false, bankrupt: false, ...over,
});

describe("the curve everything is built on", () => {
  it("gives half the marks at the halfway mark, and never quite all of them", () => {
    expect(saturate(10, 10)).toBeCloseTo(0.5);
    expect(saturate(0, 10)).toBe(0);
    expect(saturate(1_000_000, 10)).toBeLessThan(1);
  });

  it("keeps paying something for more work, unlike a cap", () => {
    const tenth = saturate(10, 6) - saturate(9, 6);
    const fiftieth = saturate(50, 6) - saturate(49, 6);
    expect(fiftieth).toBeGreaterThan(0);
    expect(fiftieth).toBeLessThan(tenth);
  });

  it("calls a rate neutral until there are enough of them to mean anything", () => {
    expect(rate(1, 1, 3)).toBe(0.5);
    expect(rate(8, 10, 3)).toBeCloseTo(0.8);
  });
});

describe("execution", () => {
  it("does not treat one milestone out of one as a finished record", () => {
    const beginner = executionScore(execution({ milestonesCompleted: 1, milestonesOpen: 0 }));
    const builder = executionScore(execution({ milestonesCompleted: 40, milestonesOpen: 10 }));
    expect(beginner).toBeLessThan(30);
    expect(builder, "forty finished beats one finished, whatever is still open").toBeGreaterThan(beginner * 2);
  });

  it("counts open milestones as plans rather than failures", () => {
    const tidy = executionScore(execution({ milestonesCompleted: 12 }));
    const ambitious = executionScore(execution({ milestonesCompleted: 12, milestonesOpen: 30 }));
    expect(ambitious).toBe(tidy);
  });

  it("rewards hitting the dates, once there are enough dates to judge", () => {
    const punctual = executionScore(execution({ milestonesCompleted: 10, milestonesWithDates: 10, milestonesOnTime: 10 }));
    const late = executionScore(execution({ milestonesCompleted: 10, milestonesWithDates: 10, milestonesOnTime: 0 }));
    expect(punctual - late).toBeGreaterThan(15);

    const lucky = executionScore(execution({ milestonesCompleted: 10, milestonesWithDates: 1, milestonesOnTime: 1 }));
    const middling = executionScore(execution({ milestonesCompleted: 10 }));
    expect(lucky, "one early deadline is not a record of punctuality").toBe(middling);
  });

  it("counts turning up week after week", () => {
    const steady = executionScore(execution({ milestonesCompleted: 6, activeWeeks: 20 }));
    const burst = executionScore(execution({ milestonesCompleted: 6, activeWeeks: 1 }));
    expect(steady).toBeGreaterThan(burst);
  });

  it("reads how far the projects have actually got", () => {
    const moving = executionScore(execution({ milestonesCompleted: 5, progress: 0.9, progressProjects: 3 }));
    const stalled = executionScore(execution({ milestonesCompleted: 5, progress: 0.05, progressProjects: 3 }));
    expect(moving).toBeGreaterThan(stalled);
  });
});

describe("contribution", () => {
  it("counts work on other people's projects, which it used not to at all", () => {
    const helper = contributionScore(contribution({ tasksForOthers: 25, projectsHelped: 4, collaborators: 6 }));
    const soloist = contributionScore(contribution({ updatesPosted: 20 }));
    expect(helper).toBeGreaterThan(soloist * 2);
  });

  it("rewards feedback that other people found worth having", () => {
    const heard = contributionScore(contribution({ feedbackGiven: 12, feedbackAppreciated: 20 }));
    const ignored = contributionScore(contribution({ feedbackGiven: 12, feedbackAppreciated: 0 }));
    expect(heard).toBeGreaterThan(ignored);
  });

  it("cannot be carried by talking about your own work", () => {
    expect(contributionScore(contribution({ updatesPosted: 500 }))).toBeLessThan(20);
  });
});

describe("the simulation, as a record of how somebody plays", () => {
  it("scores first of nine above first of three, and last below both", () => {
    expect(seasonScore(season({ rank: 1, field: 9 }))).toBeGreaterThan(seasonScore(season({ rank: 2, field: 9 })));
    expect(seasonScore(season({ rank: 9, field: 9 }))).toBeLessThan(seasonScore(season({ rank: 5, field: 9 })));
  });

  it("treats an abandoned season as unfinished, not as a loss", () => {
    const quit = seasonScore(season({ rank: 9, field: 9, yearsPlayed: 2 }));
    const played = seasonScore(season({ rank: 9, field: 9, yearsPlayed: 14 }));
    expect(quit).toBeLessThan(played);
  });

  it("weighs the best season most, so a first attempt doesn't follow you around", () => {
    const learned = simScore({ seasons: [season({ rank: 9, field: 9 }), season({ rank: 1, field: 9, profitable: true, marketShare: 0.3 })] })!;
    const onlyBad = simScore({ seasons: [season({ rank: 9, field: 9 })] })!;
    expect(learned).toBeGreaterThan(onlyBad + 20);
  });

  it("says nothing about a builder who has never played", () => {
    expect(simScore({ seasons: [] })).toBeNull();
  });

  it("punishes going bankrupt, and pays for turning a profit", () => {
    expect(seasonScore(season({ bankrupt: true }))).toBeLessThan(seasonScore(season({ profitable: true })));
  });
});

describe("strategy", () => {
  it("shares the pillar between the simulation and Nova's weekly read", () => {
    const both = strategyScore({ sim: { seasons: [season({ rank: 1, field: 9, profitable: true, marketShare: 0.3 })] }, aiScore: 90, contestWins: 0 });
    const onlyAi = strategyScore({ sim: { seasons: [] }, aiScore: 90, contestWins: 0 });
    expect(both).toBeGreaterThan(70);
    expect(onlyAi, "a builder who has never played the simulation is not marked down for it").toBeGreaterThan(70);
  });

  it("falls back to what it has when there is neither", () => {
    expect(strategyScore({ sim: { seasons: [] }, aiScore: null, contestWins: 0 })).toBe(0);
    expect(strategyScore({ sim: { seasons: [] }, aiScore: null, contestWins: 3 })).toBeGreaterThan(50);
  });

  it("does not let one bad simulation erase a good week of building", () => {
    const withBadSim = strategyScore({ sim: { seasons: [season({ rank: 9, field: 9, bankrupt: true, yearsPlayed: 3 })] }, aiScore: 80, contestWins: 0 });
    expect(withBadSim).toBeGreaterThan(30);
  });
});

describe("the index itself", () => {
  it("weighs the four pillars as declared, and stays inside 0–100", () => {
    const full = reputationFrom({
      execution: execution({ milestonesCompleted: 60, milestonesWithDates: 40, milestonesOnTime: 40, tasksCompleted: 300, tasksOnTime: 280, activeWeeks: 26, projectsShipped: 5, progress: 1, progressProjects: 4 }),
      contribution: contribution({ tasksForOthers: 120, projectsHelped: 12, milestonesForOthers: 20, feedbackGiven: 80, feedbackAppreciated: 90, updatesPosted: 60, collaborators: 20 }),
      market: { donationsReceived: 100_000, backersCount: 200, followersAttracted: 300, externalTraction: 6, projectsLaunched: 5 },
      strategy: { sim: { seasons: [season({ rank: 1, field: 9, profitable: true, marketShare: 0.35 })] }, aiScore: 100, contestWins: 5 },
    });
    expect(full.builderIndex).toBeGreaterThan(80);
    expect(full.builderIndex).toBeLessThanOrEqual(100);

    const nobody = reputationFrom(EMPTY_FACTS);
    expect(nobody.builderIndex).toBe(0);
    expect(Object.values(PILLAR_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("explains itself: every pillar says what it was built from", () => {
    const r = reputationFrom({
      ...EMPTY_FACTS,
      execution: execution({ milestonesCompleted: 9, milestonesOpen: 4, milestonesWithDates: 6, milestonesOnTime: 5 }),
      strategy: { sim: { seasons: [season({ rank: 2, field: 9 })] }, aiScore: 70, contestWins: 1 },
    });
    expect((r.details.execution as any).milestonesCompleted).toBe(9);
    expect((r.details.execution as any).milestoneOnTimeRate).toBe(83);
    expect((r.details.strategy as any).bestFinish).toBe(2);
    expect((r.details.strategy as any).seasonsPlayed).toBe(1);
  });

  it("does not report a rate it hasn't the numbers for", () => {
    const r = reputationFrom({ ...EMPTY_FACTS, execution: execution({ milestonesCompleted: 2, milestonesWithDates: 1, milestonesOnTime: 1 }) });
    expect((r.details.execution as any).milestoneOnTimeRate).toBeNull();
  });
});

/**
 * What replaying a market can and cannot do to the index.
 *
 * Replaying a market you already own became free, and gives back the *same*
 * world — same rivals, same shares, same arithmetic. Both halves of the old
 * score assumed the opposite: the best run counted double, and playing more
 * seasons raised a confidence multiplier. Together they meant somebody could
 * grind one memorised market until a run went well and be paid twice for it.
 */
describe("a market played again", () => {
  const run = (marketId: string, playedAt: number, over: Partial<SimFacts["seasons"][number]> = {}) => ({
    ...season(over), marketId, playedAt,
  });

  it("does not pay for a fluke you have since stopped repeating", () => {
    const honest = simScore({ seasons: [run("kerb", 1, { rank: 6, field: 9 })] })!;
    const ground = simScore({ seasons: [
      run("kerb", 1, { rank: 6, field: 9 }),
      run("kerb", 2, { rank: 1, field: 9, profitable: true, marketShare: 0.3 }),  // the lucky afternoon
      run("kerb", 3, { rank: 6, field: 9 }),                                      // ...and back to form
    ] })!;
    expect(ground, "the last run is how you play; the fluke was a day").toBeCloseTo(honest, 6);
  });

  it("pays for practice that actually made you better", () => {
    const first = simScore({ seasons: [run("kerb", 1, { rank: 8, field: 9 })] })!;
    const learned = simScore({ seasons: [
      run("kerb", 1, { rank: 8, field: 9 }),
      run("kerb", 2, { rank: 5, field: 9 }),
      run("kerb", 3, { rank: 2, field: 9, profitable: true, marketShare: 0.25 }),
    ] })!;
    expect(learned, "getting better at a world is the thing this is for").toBeGreaterThan(first);
  });

  it("does not let eleven goes at one world outweigh four different ones", () => {
    const ground = simScore({ seasons: Array.from({ length: 11 }, (_, i) =>
      run("kerb", i + 1, { rank: 3, field: 9, profitable: true, marketShare: 0.15 })) })!;
    const breadth = simScore({ seasons: [
      run("kerb", 1, { rank: 3, field: 9, profitable: true, marketShare: 0.15 }),
      run("larder", 2, { rank: 3, field: 9, profitable: true, marketShare: 0.15 }),
      run("bakehouse", 3, { rank: 3, field: 9, profitable: true, marketShare: 0.15 }),
      run("vet", 4, { rank: 3, field: 9, profitable: true, marketShare: 0.15 }),
    ] })!;
    expect(breadth, "four worlds is four results; one world is one, however often").toBeGreaterThan(ground);
  });

  it("still counts a builder's best market double, across markets", () => {
    const bad = simScore({ seasons: [run("a", 1, { rank: 9, field: 9 })] })!;
    const recovered = simScore({ seasons: [
      run("a", 1, { rank: 9, field: 9 }),
      run("b", 2, { rank: 1, field: 9, profitable: true, marketShare: 0.3 }),
    ] })!;
    expect(recovered, "a bad first market must not follow somebody around").toBeGreaterThan(bad + 20);
  });
});
