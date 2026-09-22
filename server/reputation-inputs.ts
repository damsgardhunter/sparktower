/**
 * The facts the builder index is worked out from, read straight from the
 * database.
 *
 * The old gatherer (`storage.getReputationStats`) loaded every project a
 * person touched and then looped over them, one query per project for
 * milestones, another for tasks, another for the activity log, and a nested
 * pair for contest wins. That is survivable for one person pressing a button
 * and hopeless for an hourly pass over everybody, so each fact here is one
 * set-based query that the database answers in one go.
 *
 * It is also where the two complaints about the old score are actually fixed,
 * because they were failures of what was counted rather than of arithmetic:
 *
 *   - **Execution** now reads the durable completion log
 *     (`project_task_completions`) rather than live board rows, which are
 *     deleted when a card is, and it reads milestones as things finished
 *     rather than as a ratio of whatever happens to be on the board.
 *   - **Contribution** now knows whose project the work was on. Finishing a
 *     task on somebody else's project is the thing the pillar is supposed to
 *     be about, and the old one could not see it at all.
 *
 * Simulation results and Nova's weekly verdict are not gathered here: they are
 * kept on the score row and folded in by `server/reputation.ts`, because they
 * run on their own clocks.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";
import type { ContributionFacts, ExecutionFacts, MarketFacts, SimFacts } from "@shared/reputation";

/** Rows come back from the driver as strings for bigint-ish aggregates; this is the cast. */
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function one<T = Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T> {
  const result: any = await db.execute(query);
  return ((result.rows ?? result)[0] ?? {}) as T;
}

/**
 * What this builder has finished.
 *
 * "Their projects" means owned or joined, which is the same set the old score
 * used — a milestone finished by a team you are on is the team's, and the
 * contribution pillar is where the difference between your work and theirs is
 * drawn.
 */
export async function executionFacts(userId: string): Promise<ExecutionFacts> {
  const milestones = await one(sql`
    with mine as (
      select id from projects where owner_id = ${userId}
      union
      select project_id from project_members where user_id = ${userId}
    )
    select
      count(*) filter (where m.status = 'completed')::int as completed,
      count(*) filter (where m.status <> 'completed')::int as open,
      count(*) filter (where m.status = 'completed' and m.target_date is not null and m.completed_at is not null)::int as dated,
      count(*) filter (where m.status = 'completed' and m.target_date is not null and m.completed_at is not null
                         and m.completed_at <= m.target_date)::int as on_time
    from project_milestones m
    join mine on mine.id = m.project_id
  `);

  /*
   * Tasks from the completion log, which outlives the board. Active weeks are
   * counted over the last half-year: it is the "did they keep turning up"
   * term, and a year of silence followed by one busy week should read as one
   * busy week.
   */
  const tasks = await one(sql`
    select
      count(*)::int as completed,
      count(*) filter (where on_time)::int as on_time,
      count(distinct date_trunc('week', completed_at)) filter (
        where completed_at > (now() at time zone 'utc') - interval '26 weeks'
      )::int as active_weeks
    from project_task_completions
    where completed_by_id = ${userId}
  `);

  /*
   * How far the projects have actually got: for each project the builder is
   * on, the share of its tasks that are done and of its milestones that are
   * finished, whichever it has, averaged over the projects that have any plan
   * at all. A project with neither is not at 0% — it simply has nothing to
   * measure, and counting it as zero punished starting something.
   */
  const progress = await one(sql`
    with mine as (
      select id from projects where owner_id = ${userId}
      union
      select project_id from project_members where user_id = ${userId}
    ),
    per_project as (
      select
        mine.id,
        (select count(*) from project_kanban_tasks t where t.project_id = mine.id)::int as tasks,
        (select count(*) from project_kanban_tasks t where t.project_id = mine.id and t.status = 'done')::int as tasks_done,
        (select count(*) from project_milestones m where m.project_id = mine.id)::int as milestones,
        (select count(*) from project_milestones m where m.project_id = mine.id and m.status = 'completed')::int as milestones_done
      from mine
    )
    select
      count(*) filter (where tasks > 0 or milestones > 0)::int as projects,
      coalesce(avg(
        case when tasks + milestones > 0
          then (tasks_done + milestones_done)::numeric / (tasks + milestones)
        end
      ), 0)::float as progress
    from per_project
  `);

  const shipped = await one(sql`
    select count(*)::int as n from projects where owner_id = ${userId} and status = 'completed'
  `);

  return {
    milestonesCompleted: num(milestones.completed),
    milestonesOnTime: num(milestones.on_time),
    milestonesWithDates: num(milestones.dated),
    milestonesOpen: num(milestones.open),
    tasksCompleted: num(tasks.completed),
    tasksOnTime: num(tasks.on_time),
    activeWeeks: num(tasks.active_weeks),
    projectsShipped: num(shipped.n),
    progress: num(progress.progress),
    progressProjects: num(progress.projects),
  };
}

/**
 * What this builder has done for everybody else.
 *
 * Every term here is deliberately about other people's work or about telling
 * other people what happened. The old pillar's headline term — projects
 * followed — is gone: following is a click, and a score that pays for clicks
 * is a score that teaches people to click.
 */
export async function contributionFacts(userId: string): Promise<ContributionFacts> {
  const forOthers = await one(sql`
    select
      count(*)::int as tasks,
      count(distinct c.project_id)::int as projects
    from project_task_completions c
    join projects p on p.id = c.project_id
    where c.completed_by_id = ${userId} and p.owner_id <> ${userId}
  `);

  const milestonesForOthers = await one(sql`
    select count(*)::int as n
    from project_milestones m
    join projects p on p.id = m.project_id
    where m.completed_by_id = ${userId} and p.owner_id <> ${userId}
  `);

  /*
   * Feedback given: comments this builder left under somebody else's project
   * post, and the reactions those comments drew. Replies to their own posts
   * are not feedback, they are a conversation about their own work — the join
   * excludes them.
   */
  const feedback = await one(sql`
    select
      count(*)::int as given,
      coalesce(sum((select count(*) from feed_comment_reactions r where r.comment_id = fc.id)), 0)::int as appreciated
    from feed_comments fc
    join feed_posts fp on fp.id = fc.post_id
    left join projects p on p.id = fp.project_id
    where fc.author_id = ${userId}
      and fp.author_id <> ${userId}
      and (p.id is null or p.owner_id <> ${userId})
      and fc.deleted_at is null
  `);

  const updates = await one(sql`
    select count(*)::int as n
    from feed_posts
    where author_id = ${userId}
      and is_system_generated = false
      and project_id is not null
      and post_type in ('project_update', 'milestone')
      and deleted_at is null
      and hidden_at is null
  `);

  const collaborators = await one(sql`
    with mine as (
      select id from projects where owner_id = ${userId}
      union
      select project_id from project_members where user_id = ${userId}
    )
    select count(distinct who)::int as n from (
      select pm.user_id as who from project_members pm join mine on mine.id = pm.project_id
      union
      select p.owner_id from projects p join mine on mine.id = p.id
    ) everyone
    where who <> ${userId}
  `);

  return {
    tasksForOthers: num(forOthers.tasks),
    projectsHelped: num(forOthers.projects),
    milestonesForOthers: num(milestonesForOthers.n),
    feedbackGiven: num(feedback.given),
    feedbackAppreciated: num(feedback.appreciated),
    updatesPosted: num(updates.n),
    collaborators: num(collaborators.n),
  };
}

/** Whether anything the builder made reached anybody outside it. */
export async function marketFacts(userId: string): Promise<MarketFacts> {
  const owned = await one(sql`
    select
      coalesce(sum(total_donations), 0)::int as donations,
      count(*) filter (where external_traction_url is not null and external_traction_url <> '')::int as traction,
      count(*) filter (where status in ('active', 'completed'))::int as launched
    from projects where owner_id = ${userId}
  `);

  const reach = await one(sql`
    with mine as (select id from projects where owner_id = ${userId})
    select
      (select count(distinct b.backer_id) from project_backings b join mine on mine.id = b.project_id
        where b.status in ('held', 'released'))::int as backers,
      (select count(*) from project_follows f join mine on mine.id = f.project_id
        where f.user_id <> ${userId})::int as followers
  `);

  return {
    donationsReceived: num(owned.donations),
    backersCount: num(reach.backers),
    followersAttracted: num(reach.followers),
    externalTraction: num(owned.traction),
    projectsLaunched: num(owned.launched),
  };
}

/**
 * How this builder's companies did in the market simulation.
 *
 * One row per season they held a seat in, built from that company's last
 * report — where it finished, against how many, holding how much of the
 * market, and whether it was making money or had run out of it. The field size
 * is counted from the reports of that year rather than assumed, because a
 * market with four teams and five incumbents is not a market of nine teams.
 */
export async function simFacts(userId: string): Promise<SimFacts> {
  const result: any = await db.execute(sql`
    with seats as (
      select distinct s.venture_id, v.season_id
      from sim_seats s
      join sim_ventures v on v.id = s.venture_id
      where s.user_id = ${userId}
    ),
    last_year as (
      select seats.venture_id, seats.season_id, max(r.year) as year
      from seats
      join sim_reports r on r.venture_id = seats.venture_id
      group by seats.venture_id, seats.season_id
    )
    select
      r.report as report,
      ly.year as years_played,
      se.total_years as total_years,
      (select count(*) from sim_reports f where f.season_id = ly.season_id and f.year = ly.year)::int as field
    from last_year ly
    join sim_reports r on r.venture_id = ly.venture_id and r.year = ly.year
    join sim_seasons se on se.id = ly.season_id
  `);

  const rows = (result.rows ?? result) as { report: any; years_played: number; total_years: number; field: number }[];
  return {
    seasons: rows.map((row) => {
      const report = row.report ?? {};
      return {
        rank: num(report.rank) || 99,
        field: Math.max(2, num(row.field)),
        yearsPlayed: num(row.years_played),
        totalYears: Math.max(1, num(row.total_years)),
        marketShare: num(report.marketShare),
        profitable: num(report.profit) > 0,
        bankrupt: !!report.bankrupt,
      };
    }),
  };
}

/** Contests this builder won outright, in one query rather than a loop over every entrant. */
export async function contestWins(userId: string): Promise<number> {
  const row = await one(sql`
    select count(*)::int as n
    from contest_participants me
    where me.user_id = ${userId}
      and me.score is not null
      and me.score = (select max(p.score) from contest_participants p where p.contest_id = me.contest_id)
  `);
  return num(row.n);
}

/**
 * Everyone whose index is worth working out again this hour.
 *
 * The sweep is not "every account": most accounts have not changed since the
 * last pass, and re-scoring them is a pile of queries to write the same number
 * back. A row is due when something it counts has happened since it was last
 * worked out, or when it has never been worked out at all, or when it has gone
 * a day without a pass — the last one so a score cannot drift for ever on a
 * quiet account with an old simulation result in it.
 */
export async function usersDue(limit: number, now = new Date()): Promise<string[]> {
  const stale = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const result: any = await db.execute(sql`
    with scored as (select user_id, last_calculated_at from user_reputation_scores),
    active as (
      select completed_by_id as user_id, max(completed_at) as at from project_task_completions
        where completed_by_id is not null group by completed_by_id
      union all
      select author_id, max(created_at) from feed_posts where deleted_at is null group by author_id
      union all
      select author_id, max(created_at) from feed_comments where deleted_at is null group by author_id
      union all
      select m.completed_by_id, max(m.completed_at) from project_milestones m
        where m.completed_by_id is not null group by m.completed_by_id
      union all
      select s.user_id, max(r.created_at) from sim_seats s
        join sim_reports r on r.venture_id = s.venture_id group by s.user_id
    ),
    latest as (select user_id, max(at) as at from active group by user_id)
    select u.id
    from users u
    left join scored on scored.user_id = u.id
    left join latest on latest.user_id = u.id
    where u.deleted_at is null and u.is_bot = false and u.suspended_at is null
      and (
        scored.last_calculated_at is null
        or (latest.at is not null and latest.at > scored.last_calculated_at)
        or scored.last_calculated_at < ${stale}
      )
    order by scored.last_calculated_at asc nulls first
    limit ${limit}
  `);
  return ((result.rows ?? result) as { id: string }[]).map((r) => r.id);
}
