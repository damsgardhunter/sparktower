/**
 * Drives one account to 100 in every pillar of the builder index.
 *
 * ## What this is for
 *
 * Two things, both of them about the *scoring* rather than about the account:
 *
 *   1. **Proving the ceiling is real.** `shared/reputation.ts` is pure and its
 *      unit tests hand it numbers directly, so they prove the arithmetic can
 *      reach 100 and nothing more. They cannot catch a gatherer that caps a
 *      fact before the arithmetic ever sees it — which is exactly the bug that
 *      made 100 unreachable for the life of the feature: `activeWeeks` was
 *      counted over `interval '26 weeks'` while the consistency term wanted
 *      more weeks than that window could ever return. Only real rows, read by
 *      the real queries, can show that a 100 exists end to end.
 *   2. **A demonstration account**, for looking at how a full card renders.
 *
 * ## What this is not for
 *
 * Production, and it refuses to run anywhere that does not look local — see
 * `assertLocal`. Three of the four pillars are fabricable and two of them are
 * fabricated social proof the moment anybody else can see the profile: the
 * market pillar invents donations and backers, and the contribution pillar
 * invents other people thanking you for help you did not give. That score feeds
 * the public profile, the leaderboard and co-founder matching, so on a live
 * database this is not seed data, it is a lie told to real users about who is
 * worth partnering with. Keep it on a development database.
 *
 * Idempotent: it reads the current facts through the same gatherers the hourly
 * pass uses and only tops up what is short, so running it twice is the same as
 * running it once.
 *
 *   DATABASE_URL=… npx tsx script/seed-max-reputation.ts <username|email|id>
 *   DATABASE_URL=… npx tsx script/seed-max-reputation.ts hunterd987 --apply
 */
import { pathToFileURL } from "node:url";
import { eq, or, sql } from "drizzle-orm";
import { db } from "../server/db";
import { userProfiles, userReputationScores, users } from "@shared/schema";
import { REPUTATION_TARGETS as T, reputationFrom, type ReputationFacts } from "@shared/reputation";
import { contestWins, contributionFacts, executionFacts, marketFacts, simFacts } from "../server/reputation-inputs";

const apply = process.argv.includes("--apply");
const allowRemote = process.argv.includes("--allow-remote");

/** Weeks back to spread finished work over, so `activeWeeks` has enough distinct weeks to count. */
const WEEK_SPREAD = T.execution.activeWeeks;

/**
 * Refuse to invent donations against anything that might be real.
 *
 * A host check rather than a database-name check: the name is the thing most
 * likely to have been copied from production into a local clone, and the host
 * is the thing that actually decides whose data gets written. `--allow-remote`
 * exists because a staging box is a legitimate target, and it is deliberately
 * something you have to type.
 */
function assertLocal(url: string): void {
  const host = new URL(url).hostname;
  const local = ["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"];
  if (local.includes(host) || allowRemote) return;
  throw new Error(
    `Refusing to write fabricated donations, backers and followers to ${host}.\n`
    + "This score feeds the public profile, the leaderboard and co-founder matching. "
    + `If ${host} really is a throwaway, pass --allow-remote.`,
  );
}

/** Every step is "how short are we, and what fixes it" — which is what makes a second run a no-op. */
interface Step {
  what: string;
  short: number;
  run: () => Promise<void>;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const rows = async (q: ReturnType<typeof sql>): Promise<any[]> => {
  const r: any = await db.execute(q);
  return (r.rows ?? r) as any[];
};
const one = async (q: ReturnType<typeof sql>): Promise<any> => (await rows(q))[0] ?? {};

async function main(): Promise<number> {
  const who = process.argv[2];
  if (!who || who.startsWith("--")) {
    console.error("Usage: npx tsx script/seed-max-reputation.ts <username|email|id> [--apply]");
    return 1;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL.");
  assertLocal(url);

  const [user] = await db
    .select({ id: users.id, email: users.email, username: userProfiles.username })
    .from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(or(eq(users.id, who), eq(users.email, who), eq(userProfiles.username, who)));
  if (!user) {
    console.error(`No account matches ${who}.`);
    return 1;
  }
  const me = user.id;

  const before = reputationFrom(await gather(me));
  console.log(`\n${user.email} (@${user.username ?? "—"}) — index ${before.builderIndex} `
    + `(e${before.execution} c${before.contribution} m${before.market} s${before.strategy})`);
  console.log(`database: ${new URL(url).hostname}${new URL(url).pathname}\n`);

  /* Who else exists, to be backers, followers, collaborators and rivals. */
  const others = (await rows(sql`
    select id from users where id <> ${me} and deleted_at is null order by is_bot desc, created_at asc
  `)).map((r) => String(r.id));
  if (others.length < T.market.backersCount) {
    throw new Error(`Need ${T.market.backersCount} other accounts for backers; found ${others.length}.`);
  }

  const steps = [
    ...await executionSteps(me),
    ...await contributionSteps(me, others),
    ...await marketSteps(me, others),
    ...await strategySteps(me, others),
  ];

  const todo = steps.filter((s) => s.short > 0);
  if (todo.length === 0) {
    console.log("Already at every target — nothing to do.");
  } else {
    for (const s of todo) console.log(`  ${String(s.short).padStart(6)}  ${s.what}`);
  }

  if (!apply) {
    console.log(`\n${todo.length} step(s). Dry run — rerun with --apply.\n`);
    return 0;
  }

  console.log("\napplying…");
  for (const s of todo) {
    await s.run();
    process.stdout.write(".");
  }
  console.log(" done");

  /*
   * Score it again through the real pass rather than recomputing here: the whole
   * point of the exercise is that the *stored* score reaches 100, and the stored
   * score is whatever `refreshReputation` writes. Nova is skipped and her
   * reading is set directly — asking costs money per run, and she cannot be
   * made to answer 100 on request.
   */
  const { refreshReputation } = await import("../server/reputation");
  await db.execute(sql`
    update user_reputation_scores
    set ai_score = 100, ai_scored_at = now() at time zone 'utc',
        ai_summary = ${"Seeded by script/seed-max-reputation.ts — not a real reading."}
    where user_id = ${me}`);
  const after = await refreshReputation(me, { forceSim: true, skipAi: true });
  console.log(`\nindex ${after.builderIndex} `
    + `(e${after.executionScore} c${after.contributionScore} m${after.marketSignalScore} s${after.strategicThinkingScore})\n`);
  return 0;
}

async function gather(me: string): Promise<ReputationFacts> {
  const [stored] = await db.select().from(userReputationScores).where(eq(userReputationScores.userId, me));
  const [execution, contribution, market, wins, sim] = await Promise.all([
    executionFacts(me), contributionFacts(me), marketFacts(me), contestWins(me), simFacts(me),
  ]);
  return { execution, contribution, market, strategy: { sim, aiScore: stored?.aiScore ?? null, contestWins: wins } };
}

// ─── Execution ───────────────────────────────────────────────────────────────

async function executionSteps(me: string): Promise<Step[]> {
  const f = await executionFacts(me);
  const mine = (await rows(sql`select id from projects where owner_id = ${me} order by created_at`))
    .map((r) => String(r.id));

  return [
    {
      /*
       * `progress` is the average, over the builder's projects, of how much of
       * each is finished — so 10 out of 10 means every project they started is
       * actually done, and nothing else in the pillar substitutes for it.
       */
      what: "finish every open milestone on your projects, on time",
      short: num((await one(sql`
        select count(*)::int n from project_milestones m join projects p on p.id = m.project_id
        where p.owner_id = ${me} and m.status <> 'completed'`)).n),
      run: async () => {
        await db.execute(sql`
          update project_milestones m set
            status = 'completed',
            completed_by_id = ${me},
            target_date = coalesce(m.target_date, (now() at time zone 'utc') - interval '3 days'),
            completed_at = coalesce(m.target_date, (now() at time zone 'utc') - interval '3 days') - interval '1 day'
          from projects p
          where p.id = m.project_id and p.owner_id = ${me} and m.status <> 'completed'`);
      },
    },
    {
      what: "move every board card on your projects to done",
      short: num((await one(sql`
        select count(*)::int n from project_kanban_tasks t join projects p on p.id = t.project_id
        where p.owner_id = ${me} and t.status <> 'done'`)).n),
      run: async () => {
        await db.execute(sql`
          update project_kanban_tasks t set status = 'done'
          from projects p where p.id = t.project_id and p.owner_id = ${me} and t.status <> 'done'`);
      },
    },
    {
      what: "mark the work you have already finished as on time",
      short: f.tasksCompleted - f.tasksOnTime,
      run: async () => {
        await db.execute(sql`
          update project_task_completions set on_time = true
          where completed_by_id = ${me} and on_time = false`);
      },
    },
    {
      /*
       * Spread over `WEEK_SPREAD` distinct weeks rather than dumped on today:
       * the consistency term counts weeks with something finished in them, and
       * 250 completions all stamped this afternoon is one active week.
       */
      what: `spread your finished work across ${WEEK_SPREAD} distinct weeks`,
      short: Math.max(0, WEEK_SPREAD - f.activeWeeks),
      run: async () => {
        const ids = (await rows(sql`
          select id from project_task_completions where completed_by_id = ${me} order by completed_at
        `)).map((r) => String(r.id));
        for (const [i, id] of ids.entries()) {
          await db.execute(sql`
            update project_task_completions
            set completed_at = (now() at time zone 'utc') - (${(i % WEEK_SPREAD) + 1} * interval '1 week') - interval '2 days'
            where id = ${id}`);
        }
      },
    },
    {
      what: `finish ${T.execution.tasksCompleted} tasks in total`,
      short: Math.max(0, T.execution.tasksCompleted - f.tasksCompleted - T.contribution.tasksForOthers),
      run: async () => {
        if (mine.length === 0) throw new Error("No project of your own to finish work on.");
        const need = T.execution.tasksCompleted - f.tasksCompleted - T.contribution.tasksForOthers;
        for (let i = 0; i < need; i++) {
          await db.execute(sql`
            insert into project_task_completions (project_id, task_id, title, completed_by_id, on_time, completed_at)
            values (${mine[i % mine.length]}, ${`maxrep-own-${me.slice(0, 8)}-${i}`}, ${"Finished a task"}, ${me}, true,
                    (now() at time zone 'utc') - (${(i % WEEK_SPREAD) + 1} * interval '1 week') - interval '2 days')
            on conflict (task_id) do nothing`);
        }
      },
    },
    {
      what: `take ${T.execution.projectsShipped} projects to "completed"`,
      short: Math.max(0, T.execution.projectsShipped - f.projectsShipped),
      run: async () => {
        for (const id of mine.slice(0, T.execution.projectsShipped)) {
          await db.execute(sql`update projects set status = 'completed' where id = ${id}`);
        }
      },
    },
  ];
}

// ─── Contribution ────────────────────────────────────────────────────────────

async function contributionSteps(me: string, others: string[]): Promise<Step[]> {
  const f = await contributionFacts(me);

  /*
   * Other people's projects, meaning neither owned nor joined. A project the
   * builder is a *member* of counts as theirs for execution and drags their
   * progress average, so helping on one is not the same as helping on a
   * stranger's and is excluded here.
   */
  const theirs = (await rows(sql`
    select p.id from projects p
    where p.owner_id <> ${me}
      and not exists (select 1 from project_members pm where pm.project_id = p.id and pm.user_id = ${me})
    order by p.created_at limit 40`)).map((r) => String(r.id));
  const helpOn = theirs.slice(0, T.contribution.projectsHelped);

  /* Posts the feedback query will actually count: somebody else's, and not about a project of ours. */
  const posts = (await rows(sql`
    select fp.id from feed_posts fp
    left join projects p on p.id = fp.project_id
    where fp.author_id <> ${me} and (p.id is null or p.owner_id <> ${me}) and fp.deleted_at is null
    order by fp.created_at limit 200`)).map((r) => String(r.id));
  const myProject = (await one(sql`select id from projects where owner_id = ${me} order by created_at limit 1`)).id;

  return [
    {
      what: `finish ${T.contribution.tasksForOthers} tasks across ${T.contribution.projectsHelped} other people's projects`,
      short: Math.max(0, T.contribution.tasksForOthers - f.tasksForOthers),
      run: async () => {
        if (helpOn.length === 0) throw new Error("No other people's projects to help on.");
        const need = T.contribution.tasksForOthers - f.tasksForOthers;
        for (let i = 0; i < need; i++) {
          await db.execute(sql`
            insert into project_task_completions (project_id, task_id, title, completed_by_id, on_time, completed_at)
            values (${helpOn[i % helpOn.length]}, ${`maxrep-help-${me.slice(0, 8)}-${i}`}, ${"Helped out"}, ${me}, true,
                    (now() at time zone 'utc') - (${(i % WEEK_SPREAD) + 1} * interval '1 week') - interval '2 days')
            on conflict (task_id) do nothing`);
        }
      },
    },
    {
      what: `close ${T.contribution.milestonesForOthers} milestones on other people's projects`,
      short: Math.max(0, T.contribution.milestonesForOthers - f.milestonesForOthers),
      run: async () => {
        const need = T.contribution.milestonesForOthers - f.milestonesForOthers;
        const ids = (await rows(sql`
          select m.id from project_milestones m join projects p on p.id = m.project_id
          where p.owner_id <> ${me} and coalesce(m.completed_by_id, '') <> ${me}
            and not exists (select 1 from project_members pm where pm.project_id = p.id and pm.user_id = ${me})
          order by m.created_at limit ${need}`)).map((r) => String(r.id));
        for (const id of ids) {
          await db.execute(sql`
            update project_milestones set status = 'completed', completed_by_id = ${me},
              completed_at = (now() at time zone 'utc') - interval '10 days'
            where id = ${id}`);
        }
      },
    },
    {
      what: `leave ${T.contribution.feedbackGiven} comments on other people's work`,
      short: Math.max(0, T.contribution.feedbackGiven - f.feedbackGiven),
      run: async () => {
        if (posts.length === 0) throw new Error("No posts by other people to comment on.");
        const need = T.contribution.feedbackGiven - f.feedbackGiven;
        for (let i = 0; i < need; i++) {
          await db.execute(sql`
            insert into feed_comments (post_id, author_id, content, created_at)
            values (${posts[i % posts.length]}, ${me}, ${"Had a read of this — nice work."},
                    (now() at time zone 'utc') - (${(i % WEEK_SPREAD) + 1} * interval '1 week'))`);
        }
      },
    },
    {
      what: `draw ${T.contribution.feedbackAppreciated} reactions to that feedback`,
      short: Math.max(0, T.contribution.feedbackAppreciated - f.feedbackAppreciated),
      run: async () => {
        const mineComments = (await rows(sql`
          select fc.id from feed_comments fc join feed_posts fp on fp.id = fc.post_id
          where fc.author_id = ${me} and fp.author_id <> ${me} and fc.deleted_at is null
          order by fc.created_at limit ${T.contribution.feedbackAppreciated}`)).map((r) => String(r.id));
        /* One reaction per person per comment, so walk the accounts alongside the comments. */
        for (const [i, comment] of mineComments.entries()) {
          await db.execute(sql`
            insert into feed_comment_reactions (comment_id, user_id, reaction)
            values (${comment}, ${others[i % others.length]}, ${"like"})
            on conflict (comment_id, user_id) do nothing`);
        }
      },
    },
    {
      what: `post ${T.contribution.updatesPosted} updates about your own projects`,
      short: Math.max(0, T.contribution.updatesPosted - f.updatesPosted),
      run: async () => {
        if (!myProject) throw new Error("No project of your own to post about.");
        const need = T.contribution.updatesPosted - f.updatesPosted;
        for (let i = 0; i < need; i++) {
          await db.execute(sql`
            insert into feed_posts (author_id, project_id, post_type, content, is_system_generated, created_at)
            values (${me}, ${myProject}, ${"project_update"}, ${`Progress update #${i + 1}.`}, false,
                    (now() at time zone 'utc') - (${(i % WEEK_SPREAD) + 1} * interval '1 week'))`);
        }
      },
    },
    {
      what: `share a project with ${T.contribution.collaborators} people`,
      short: Math.max(0, T.contribution.collaborators - f.collaborators),
      run: async () => {
        if (!myProject) throw new Error("No project of your own to share.");
        for (const who of others.slice(0, T.contribution.collaborators)) {
          await db.execute(sql`
            insert into project_members (project_id, user_id, role)
            values (${myProject}, ${who}, ${"contributor"})
            on conflict (project_id, user_id) do nothing`);
        }
      },
    },
  ];
}

// ─── Market ──────────────────────────────────────────────────────────────────

const myProjects = async (me: string): Promise<string[]> =>
  (await rows(sql`select id from projects where owner_id = ${me} order by created_at`)).map((r) => String(r.id));

async function marketSteps(me: string, others: string[]): Promise<Step[]> {
  const f = await marketFacts(me);
  const mine = await myProjects(me);

  return [
    {
      /*
       * `projectsLaunched` counts projects that are live or finished, and the
       * execution pillar wants three of them *completed* — so a builder with
       * exactly three projects cannot satisfy both at once. One more is needed,
       * and it is deliberately left without a board or a plan: a project with
       * neither is excluded from the progress average rather than counting as 0%.
       */
      what: `have ${T.market.projectsLaunched} projects, live or completed`,
      short: Math.max(0, T.market.projectsLaunched - mine.length),
      run: async () => {
        const need = T.market.projectsLaunched - mine.length;
        for (let i = 0; i < need; i++) {
          await db.execute(sql`
            insert into projects (owner_id, title, description, category, status)
            values (${me}, ${`Side project ${i + 1}`}, ${"Seeded so the launched count can be met."},
                    ${"saas"}, ${"active"})`);
        }
      },
    },
    {
      what: "put every project of yours live",
      short: num((await one(sql`
        select count(*)::int n from projects
        where owner_id = ${me} and status not in ('active', 'completed')`)).n),
      run: async () => {
        await db.execute(sql`
          update projects set status = 'active'
          where owner_id = ${me} and status not in ('active', 'completed')`);
      },
    },
    {
      what: `raise ${T.market.donationsReceived} in pledges`,
      short: Math.max(0, T.market.donationsReceived - f.donationsReceived),
      run: async () => {
        const all = await myProjects(me);
        const each = Math.floor(T.market.donationsReceived / all.length);
        for (const [i, id] of all.entries()) {
          /* Remainder on the first, so the total is exact rather than rounded down. */
          const amount = i === 0 ? T.market.donationsReceived - each * (all.length - 1) : each;
          await db.execute(sql`update projects set total_donations = ${amount} where id = ${id}`);
        }
      },
    },
    {
      what: `attract ${T.market.backersCount} distinct backers`,
      short: Math.max(0, T.market.backersCount - f.backersCount),
      run: async () => {
        const all = await myProjects(me);
        for (const [i, who] of others.slice(0, T.market.backersCount).entries()) {
          await db.execute(sql`
            insert into project_backings (project_id, backer_id, amount_cents, status, created_at)
            values (${all[i % all.length]}, ${who}, ${2_000}, ${"released"},
                    (now() at time zone 'utc') - (${(i % WEEK_SPREAD) + 1} * interval '1 week'))`);
        }
      },
    },
    {
      what: `attract ${T.market.followersAttracted} followers to your projects`,
      short: Math.max(0, T.market.followersAttracted - f.followersAttracted),
      run: async () => {
        const all = await myProjects(me);
        let made = f.followersAttracted;
        for (const id of all) {
          for (const who of others) {
            if (made >= T.market.followersAttracted) return;
            const done: any = await db.execute(sql`
              insert into project_follows (project_id, user_id) values (${id}, ${who})
              on conflict (project_id, user_id) do nothing`);
            made += done.rowCount ?? 0;
          }
        }
      },
    },
    {
      what: `point at traction outside the platform on ${T.market.externalTraction} projects`,
      short: Math.max(0, T.market.externalTraction - f.externalTraction),
      run: async () => {
        const all = await myProjects(me);
        for (const id of all.slice(0, T.market.externalTraction)) {
          await db.execute(sql`
            update projects set external_traction_url = ${"https://example.com/seeded-traction"} where id = ${id}`);
        }
      },
    },
  ];
}

// ─── Strategy ────────────────────────────────────────────────────────────────

async function strategySteps(me: string, others: string[]): Promise<Step[]> {
  const sim = await simFacts(me);
  const wins = await contestWins(me);

  /*
   * The pillar wants every market's *latest* run to be a win, and a market the
   * builder has already played badly cannot be dropped from the record — so its
   * niche is replayed too, in a newer season, which is what `latestByMarket`
   * picks up in place of the old run.
   */
  const played = [...new Set(sim.seasons.map((s) => s.marketId).filter(Boolean))];
  const fresh = ["seeded_market_a", "seeded_market_b", "seeded_market_c", "seeded_market_d"];
  const niches = [...played, ...fresh.filter((n) => !played.includes(n))]
    .slice(0, Math.max(T.strategy.marketsPlayed, played.length));
  const alreadyWon = sim.seasons.filter((s) => s.rank === 1 && s.marketShare >= 0.35 && s.profitable).length;

  return [
    {
      what: `win ${niches.length} distinct simulation markets outright`,
      short: Math.max(0, niches.length - alreadyWon),
      run: async () => {
        for (const niche of niches) {
          const years = 14;
          const season = String((await one(sql`
            insert into sim_seasons (niche_id, name, status, year, total_years, created_at)
            values (${niche}, ${`Seeded run of ${niche}`}, ${"finished"}, ${years}, ${years}, now() at time zone 'utc')
            returning id`)).id);
          const venture = String((await one(sql`
            insert into sim_ventures (season_id, name, phase) values (${season}, ${"Your company"}, ${"running"})
            returning id`)).id);
          await db.execute(sql`
            insert into sim_seats (venture_id, user_id, role, assigned) values (${venture}, ${me}, ${"ceo"}, true)
            on conflict (venture_id, user_id) do nothing`);
          /*
           * Two reports in the final year, because the field size is counted
           * from them: a rank of 1 in a field of 1 is not a placement, and
           * `seasonScore` needs somebody to have come second.
           */
          await db.execute(sql`
            insert into sim_reports (season_id, venture_id, company_id, year, report, created_at)
            values (${season}, ${venture}, ${`co-${venture.slice(0, 8)}`}, ${years},
                    ${JSON.stringify({ rank: 1, marketShare: 0.42, profit: 4_200_000, bankrupt: false })}::jsonb,
                    now() at time zone 'utc')`);
          await db.execute(sql`
            insert into sim_reports (season_id, company_id, year, report, created_at)
            values (${season}, ${`rival-${venture.slice(0, 8)}`}, ${years},
                    ${JSON.stringify({ rank: 2, marketShare: 0.18, profit: 90_000, bankrupt: false })}::jsonb,
                    now() at time zone 'utc')`);
        }
      },
    },
    {
      what: `win ${T.strategy.contestWins} contests outright`,
      short: Math.max(0, T.strategy.contestWins - wins),
      run: async () => {
        const need = T.strategy.contestWins - wins;
        for (let i = 0; i < need; i++) {
          const contest = String((await one(sql`
            insert into contests (title, description, category, difficulty, status, start_date, end_date)
            values (${`Seeded contest ${i + 1}`}, ${"Seeded so a win can be counted."}, ${"build"},
                    ${"intermediate"}, ${"completed"},
                    (now() at time zone 'utc') - interval '60 days', (now() at time zone 'utc') - interval '30 days')
            returning id`)).id);
          await db.execute(sql`
            insert into contest_participants (contest_id, user_id, score) values (${contest}, ${me}, ${100})
            on conflict (contest_id, user_id) do nothing`);
          /* Somebody to beat — a win with no runner-up is `max(score)` over one row. */
          await db.execute(sql`
            insert into contest_participants (contest_id, user_id, score)
            values (${contest}, ${others[i % others.length]}, ${60})
            on conflict (contest_id, user_id) do nothing`);
        }
      },
    },
  ];
}

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(String(err instanceof Error ? err.message : err));
      process.exit(1);
    },
  );
}
