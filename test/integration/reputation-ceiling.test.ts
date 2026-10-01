/**
 * That a 100 exists, from the database up.
 *
 * `test/unit/reputation.test.ts` proves the *arithmetic* can reach 100: it hands
 * the pure functions numbers and checks what comes back. That is not the same
 * claim, and the difference is the bug this test was written after.
 *
 * `activeWeeks` was gathered over `interval '26 weeks'` while the consistency
 * term was `12 * saturate(activeWeeks, 8)`. 26 on that curve pays 9.18 of 12, so
 * execution could not exceed 97 and the index could not exceed 99 — for anybody,
 * from any amount of work, ever. The unit tests were green throughout, because
 * the cap was not in the formula. It was in a SQL interval one file away, and
 * nothing that only reads the formula could ever have seen it.
 *
 * So this one builds a real builder out of real rows, scores them through the
 * real gatherers and the real hourly pass, and insists on the number the profile
 * card promises. Every pillar is driven from `REPUTATION_TARGETS` rather than
 * from literals, so retuning a target moves this test with it — what is pinned
 * is that the targets are *sufficient*, which is the actual contract.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import {
  contestParticipants, contests, feedCommentReactions, feedComments, feedPosts,
  projectBackings, projectFollows, projectKanbanTasks, projectMembers, projectMilestones,
  projectTaskCompletions, projects, simReports, simSeasons, simSeats, simVentures,
  userReputationScores, users,
} from "@shared/schema";
import { REPUTATION_TARGETS as T } from "@shared/reputation";
import { refreshReputation } from "../../server/reputation";

afterAll(async () => { await closeTestApp(); });

const WEEK = 7 * 24 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

/** `n` weeks and a bit ago — inside the 52-week window, in a week of its own. */
const weeksAgo = (n: number) => new Date(Date.now() - n * WEEK - 2 * DAY);

let seq = 0;
async function account(): Promise<string> {
  seq += 1;
  const [row] = await db.insert(users).values({
    email: `ceiling-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 6)}@example.test`,
    firstName: `Builder${seq}`,
  } as any).returning();
  return row.id;
}

async function project(ownerId: string, over: Record<string, unknown> = {}) {
  const [row] = await db.insert(projects).values({
    ownerId, title: `Project ${++seq}`, description: "Something being built.", category: "saas", ...over,
  } as any).returning();
  return row;
}

describe("the top of the builder index, from the database up", () => {
  it("reaches 100 in every pillar from real rows and the real hourly pass", async () => {
    const me = await account();

    /*
     * Enough other people to be backers, followers and collaborators. The
     * backers term counts *distinct* accounts, so this is the one place the
     * number of accounts actually has to be met rather than simulated.
     */
    const others: string[] = [];
    for (let i = 0; i < T.market.backersCount; i++) others.push(await account());

    // ── Execution ───────────────────────────────────────────────────────────
    /*
     * Four projects: three taken to "completed" for the shipping term, and a
     * fourth left live so the market pillar's "launched" count can be met. The
     * fourth deliberately gets no board and no plan — a project with neither is
     * excluded from the progress average rather than counting as 0%, which is
     * the only way "ship three" and "have four live" can both hold.
     */
    const mine = [
      await project(me, { status: "completed" }),
      await project(me, { status: "completed" }),
      await project(me, { status: "completed" }),
      await project(me, { status: "active" }),
    ];
    const planned = mine.slice(0, 3);

    /* Milestones, all finished and all inside their target date. */
    await db.insert(projectMilestones).values(
      Array.from({ length: T.execution.milestonesCompleted }, (_, i) => ({
        projectId: planned[i % planned.length].id,
        title: `Milestone ${i}`,
        status: "completed",
        targetDate: weeksAgo((i % 40) + 1),
        completedAt: new Date(weeksAgo((i % 40) + 1).getTime() - DAY),
        completedById: me,
        order: i,
      })) as any,
    );

    /*
     * Finished work, spread over `activeWeeks` distinct weeks. Stamping all of
     * it today would satisfy the volume term and leave consistency at one week,
     * which is the term that used to be uncappable.
     */
    const ownTasks = T.execution.tasksCompleted - T.contribution.tasksForOthers;
    const boardCards = await db.insert(projectKanbanTasks).values(
      Array.from({ length: ownTasks }, (_, i) => ({
        projectId: planned[i % planned.length].id,
        title: `Card ${i}`, status: "done", priority: "medium", order: i,
      })) as any,
    ).returning();
    await db.insert(projectTaskCompletions).values(
      boardCards.map((card, i) => ({
        projectId: card.projectId, taskId: card.id, title: card.title,
        completedById: me, onTime: true,
        completedAt: weeksAgo((i % T.execution.activeWeeks) + 1),
      })) as any,
    );

    // ── Contribution ────────────────────────────────────────────────────────
    /*
     * Other people's projects, owned by other people. The contribution pillar
     * is the one that knows whose project the work was on, so these must not be
     * owned by — or joined by — the builder being scored.
     */
    const theirs = [];
    for (let i = 0; i < T.contribution.projectsHelped; i++) {
      theirs.push(await project(others[i % others.length], { status: "active" }));
    }

    const helpCards = await db.insert(projectKanbanTasks).values(
      Array.from({ length: T.contribution.tasksForOthers }, (_, i) => ({
        projectId: theirs[i % theirs.length].id,
        title: `Helped ${i}`, status: "done", priority: "medium", order: i,
      })) as any,
    ).returning();
    await db.insert(projectTaskCompletions).values(
      helpCards.map((card, i) => ({
        projectId: card.projectId, taskId: card.id, title: card.title,
        completedById: me, onTime: true,
        completedAt: weeksAgo((i % T.execution.activeWeeks) + 1),
      })) as any,
    );

    await db.insert(projectMilestones).values(
      Array.from({ length: T.contribution.milestonesForOthers }, (_, i) => ({
        projectId: theirs[i % theirs.length].id,
        title: `Their milestone ${i}`, status: "completed",
        targetDate: weeksAgo(3), completedAt: weeksAgo(4), completedById: me, order: i,
      })) as any,
    );

    /*
     * Feedback: comments the builder left under somebody else's post. The
     * gatherer excludes replies to their own posts and to posts about their own
     * projects, so the posts being commented on are other people's and carry no
     * project at all.
     */
    const theirPosts = await db.insert(feedPosts).values(
      Array.from({ length: 10 }, (_, i) => ({
        authorId: others[i % others.length], postType: "project_update",
        content: `Something they posted ${i}`, isSystemGenerated: false,
      })) as any,
    ).returning();
    const myComments = await db.insert(feedComments).values(
      Array.from({ length: T.contribution.feedbackGiven }, (_, i) => ({
        postId: theirPosts[i % theirPosts.length].id, authorId: me,
        content: `Had a read of this ${i}`, createdAt: weeksAgo((i % 40) + 1),
      })) as any,
    ).returning();

    /* And whether it was worth having, in other people's words. */
    await db.insert(feedCommentReactions).values(
      Array.from({ length: T.contribution.feedbackAppreciated }, (_, i) => ({
        commentId: myComments[i].id, userId: others[i % others.length], reaction: "like",
      })) as any,
    );

    await db.insert(feedPosts).values(
      Array.from({ length: T.contribution.updatesPosted }, (_, i) => ({
        authorId: me, projectId: planned[i % planned.length].id, postType: "project_update",
        content: `Progress update ${i}`, isSystemGenerated: false, createdAt: weeksAgo((i % 40) + 1),
      })) as any,
    );

    await db.insert(projectMembers).values(
      others.slice(0, T.contribution.collaborators).map((who) => ({
        projectId: planned[0].id, userId: who, role: "contributor",
      })) as any,
    );

    // ── Market ──────────────────────────────────────────────────────────────
    const each = Math.floor(T.market.donationsReceived / mine.length);
    for (const [i, p] of mine.entries()) {
      await db.update(projects).set({
        /* Remainder on the first, so the total is exact rather than rounded down. */
        totalDonations: i === 0 ? T.market.donationsReceived - each * (mine.length - 1) : each,
        externalTractionUrl: i < T.market.externalTraction ? "https://example.test/traction" : null,
      } as any).where(eq(projects.id, p.id));
    }

    await db.insert(projectBackings).values(
      others.slice(0, T.market.backersCount).map((who, i) => ({
        projectId: mine[i % mine.length].id, backerId: who,
        amountCents: 2_000, status: "released",
      })) as any,
    );

    /* Followers are counted as rows, not distinct people: four projects by fifty accounts. */
    const follows = [];
    for (const p of mine) {
      for (const who of others) {
        if (follows.length >= T.market.followersAttracted) break;
        follows.push({ projectId: p.id, userId: who });
      }
    }
    await db.insert(projectFollows).values(follows as any);

    // ── Strategy ────────────────────────────────────────────────────────────
    /*
     * Four distinct markets, each won outright. A market is the unit of
     * evidence — replays of one world collapse to their latest run — so these
     * are four different niches, and each needs a runner-up, because the field
     * size is counted from the reports of that year and a rank of 1 in a field
     * of 1 is not a placement.
     */
    for (let i = 0; i < T.strategy.marketsPlayed; i++) {
      const years = 14;
      const [season] = await db.insert(simSeasons).values({
        nicheId: `ceiling_market_${seq}_${i}`, name: `Season ${i}`,
        status: "finished", year: years, totalYears: years,
      } as any).returning();
      const [venture] = await db.insert(simVentures).values({
        seasonId: season.id, name: "My company", phase: "running",
      } as any).returning();
      await db.insert(simSeats).values({
        ventureId: venture.id, userId: me, role: "ceo", assigned: true,
      } as any);
      await db.insert(simReports).values([
        {
          seasonId: season.id, ventureId: venture.id, companyId: `mine-${i}`, year: years,
          report: { rank: 1, marketShare: 0.42, profit: 4_200_000, bankrupt: false },
        },
        {
          seasonId: season.id, companyId: `rival-${i}`, year: years,
          report: { rank: 2, marketShare: 0.18, profit: 90_000, bankrupt: false },
        },
      ] as any);
    }

    for (let i = 0; i < T.strategy.contestWins; i++) {
      const [contest] = await db.insert(contests).values({
        title: `Contest ${seq}-${i}`, description: "A contest.", category: "build",
        difficulty: "intermediate", status: "completed",
        startDate: weeksAgo(10), endDate: weeksAgo(5),
      } as any).returning();
      await db.insert(contestParticipants).values([
        { contestId: contest.id, userId: me, score: 100 },
        { contestId: contest.id, userId: others[i], score: 60 },
      ] as any);
    }

    // ── Score it the way the product does ───────────────────────────────────
    /*
     * Through `refreshReputation`, not by calling the pure functions: the number
     * that matters is the one written to the row the profile, the leaderboard
     * and co-founder matching all read. Nova is skipped — she cannot be made to
     * answer 100 in a test, and the pillar renormalises over what it has, so a
     * builder who has never been read is not held to have failed it.
     */
    const stored = await refreshReputation(me, { forceSim: true, skipAi: true });

    expect(stored.executionScore, "execution").toBe(100);
    expect(stored.contributionScore, "contribution").toBe(100);
    expect(stored.marketSignalScore, "market").toBe(100);
    expect(stored.strategicThinkingScore, "strategy").toBe(100);
    expect(stored.builderIndex, "the number the profile card prints 'out of 100' under").toBe(100);

    /* And it is the stored row, not just the return value. */
    const [row] = await db.select().from(userReputationScores).where(eq(userReputationScores.userId, me));
    expect(row.builderIndex).toBe(100);
  }, 180_000);

  /*
   * The companion claim, and the one that would have caught the original bug on
   * its own: the window the facts are gathered over has to be wide enough for
   * the target to fit inside it. It was not — the target needed more weeks than
   * the query could return — and no amount of work could close the gap.
   */
  it("gathers a long enough history for the consistency target to be reachable", async () => {
    const me = await account();
    const p = await project(me, { status: "active" });

    /* One finished task in each of `activeWeeks` distinct weeks, and nothing else. */
    const cards = await db.insert(projectKanbanTasks).values(
      Array.from({ length: T.execution.activeWeeks }, (_, i) => ({
        projectId: p.id, title: `Card ${i}`, status: "done", priority: "medium", order: i,
      })) as any,
    ).returning();
    await db.insert(projectTaskCompletions).values(
      cards.map((card, i) => ({
        projectId: p.id, taskId: card.id, title: card.title,
        completedById: me, onTime: true, completedAt: weeksAgo(i + 1),
      })) as any,
    );

    const { executionFacts } = await import("../../server/reputation-inputs");
    const facts = await executionFacts(me);
    expect(
      facts.activeWeeks,
      "the gatherer's window has to reach at least as far back as the target it is scored against",
    ).toBeGreaterThanOrEqual(T.execution.activeWeeks);
  }, 120_000);
});
