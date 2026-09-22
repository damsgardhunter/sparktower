/**
 * The two things a person can do with their own data: take a copy, and leave.
 *
 * Both are theirs by right (UK GDPR arts. 15 and 17), and both are easy to get
 * wrong in opposite directions — an export that quietly leaks someone else's
 * rows, or a deletion that leaves the personal parts behind. So each table is
 * listed here by hand, with what happens to it, rather than inferred at
 * runtime: a new table is invisible to both until someone decides which list it
 * belongs on, and `test/integration/account-data.test.ts` fails when a table
 * that references a user isn't on one.
 *
 * What deletion does NOT do is remove the `users` row. Moderation records,
 * other people's threads, and anything the person chose to leave behind all
 * point at it. It stays as a tombstone: every personal field scrubbed,
 * `deletedAt` set, nothing able to sign in as it again.
 */
import { pool } from "./db";
import { companiesOnAccountClose } from "./company-lifecycle";

/** A table holding the person's own rows, and the column that says so. */
interface Owned { table: string; column: string }

/**
 * Everything keyed to a user, and what leaving does to it.
 *
 * `mine` — theirs alone: exported, then deleted.
 * `choice` — things other people may have replied to: exported, then deleted
 *   or kept under "Deleted account", as they choose.
 * `kept` — exported, never deleted: money and moderation records we have to
 *   keep (tax, disputes, ban evasion), which point at the tombstone afterwards.
 */
export const MINE: Owned[] = [
  { table: "user_profiles", column: "user_id" },
  { table: "project_members", column: "user_id" },
  { table: "project_applications", column: "user_id" },
  { table: "project_follows", column: "user_id" },
  { table: "user_follows", column: "follower_id" },
  { table: "user_follows", column: "followee_id" },
  { table: "user_matches", column: "user_id" },
  { table: "user_badges", column: "user_id" },
  { table: "backer_badges", column: "user_id" },
  { table: "contest_participants", column: "user_id" },
  { table: "direct_messages", column: "sender_id" },
  { table: "user_task_stats", column: "user_id" },
  { table: "health_finding_feedback", column: "user_id" },
  { table: "project_storyboards", column: "user_id" },
  { table: "investor_artifacts", column: "user_id" },
  { table: "mock_interviews", column: "user_id" },
  { table: "project_comment_reactions", column: "user_id" },
  { table: "feed_reactions", column: "user_id" },
  { table: "feed_comment_reactions", column: "user_id" },
  { table: "notifications", column: "recipient_id" },
  { table: "notifications", column: "actor_id" },
  { table: "project_activity_log", column: "user_id" },
  { table: "project_decisions", column: "user_id" },
  { table: "rate_limit_hits", column: "user_id" },
  { table: "activity_events", column: "user_id" },
  { table: "community_members", column: "user_id" },
  { table: "explore_seen", column: "user_id" },
  { table: "project_live_chat_messages", column: "user_id" },
  { table: "project_interviews", column: "user_id" },
  { table: "project_experiments", column: "user_id" },
  { table: "project_check_ins", column: "user_id" },
  { table: "loop_events", column: "user_id" },
  { table: "game_leaderboard", column: "user_id" },
  { table: "tactics_players", column: "user_id" },
  { table: "typing_race_players", column: "user_id" },
  { table: "signal_noise_games", column: "user_id" },
  { table: "user_reputation_scores", column: "user_id" },
  { table: "sprint_responses", column: "user_id" },
  { table: "sprint_deliverables", column: "user_id" },
  /*
   * The market simulation: a seat in a season and everything played from it.
   * Classified like the other games above — it is this person's own play, so
   * it leaves with them rather than being kept as somebody else's record.
   */
  { table: "sim_seats", column: "user_id" },
  { table: "sim_decisions", column: "user_id" },
  /*
   * Ten Years From Now. Both players are named on the game row, so leaving
   * takes your side of every game you played with it.
   *
   * `startup_game_verdicts` is deliberately absent: it has no user column and
   * cascades from the game, so it goes when the game does. The messages are
   * here rather than under `choice` because a game's chat is two people in a
   * closed room for half an hour, not something published that others replied
   * to — nobody outside it ever sees a line of it.
   */
  { table: "startup_games", column: "player1_id" },
  { table: "startup_games", column: "player2_id" },
  { table: "startup_game_submissions", column: "user_id" },
  // What a player was still typing when a round's clock ran out — theirs alone.
  { table: "startup_game_drafts", column: "user_id" },
  { table: "startup_game_messages", column: "user_id" },
  { table: "sim_challenges", column: "user_id" },
  { table: "sim_recovery_moves", column: "user_id" },
  { table: "sprint_decisions", column: "user_id" },
  { table: "sprint_messages", column: "user_id" },
  { table: "sprint_behavioral_metrics", column: "user_id" },
  { table: "sprint_matchmaking_queue", column: "user_id" },
  // Companies: their place in one (handed on first, in companiesOnAccountClose), their talent profile, invites addressed to them.
  { table: "company_members", column: "user_id" },
  { table: "talent_profiles", column: "user_id" },
  { table: "recruit_invites", column: "user_id" },
  /*
   * Found once the coverage test looked for every column pointing at a user
   * rather than for a handful of names: an investor's application (their
   * phone number, LinkedIn and message to the founder), their connections and
   * the notes on them, matches suggesting them, ratings of them, and the
   * sign-in tokens still carrying their email address.
   */
  { table: "investment_applications", column: "investor_id" },
  { table: "connections", column: "requester_id" },
  { table: "connections", column: "receiver_id" },
  { table: "user_matches", column: "matched_user_id" },
  { table: "sprint_ratings", column: "ratee_id" },
  { table: "email_verification_tokens", column: "user_id" },
  { table: "password_reset_tokens", column: "user_id" },
  { table: "web_handoff_tokens", column: "user_id" },
  /*
   * Blocks, both ways round.
   *
   * A block the person made is plainly theirs — including the private reason
   * they wrote for themselves, which is why it's in the export as well as the
   * deletion. A block held *against* them goes too, and that is not a gap in
   * anyone's protection: an account that no longer exists cannot reach
   * anybody, and keeping the row would leave the blocker a list entry naming a
   * tombstone they can't do anything about.
   */
  { table: "user_blocks", column: "blocker_id" },
  { table: "user_blocks", column: "blocked_id" },
];

export const CHOICE: Owned[] = [
  { table: "feed_posts", column: "author_id" },
  { table: "feed_comments", column: "author_id" },
  { table: "project_comments", column: "author_id" },
  { table: "path_artifacts", column: "author_id" },
  // A company judged it and may have announced it, so it goes or stays with their posts.
  { table: "challenge_entries", column: "user_id" },
  // A rating they gave a sprint partner: part of that partner's record, so it goes or stays with their posts.
  { table: "sprint_ratings", column: "rater_id" },
];

export const KEPT: Owned[] = [
  // Money: kept for accounting and refunds, pointing at the tombstone.
  { table: "project_backings", column: "backer_id" },
  // Moderation: a report and its outcome outlive the account, or deleting is a way to wipe a ban.
  { table: "moderation_log", column: "actor_id" },
  { table: "moderation_log", column: "target_user_id" },
  /*
   * A company's own records, which it goes on running on after one of its
   * people leaves: who did what in it, the weekly numbers someone filed, and
   * the jobs and goals they owned (unassigned on the way out, so the job's
   * reminder goes to somebody still there).
   */
  { table: "company_audit_log", column: "actor_id" },
  { table: "company_audit_log", column: "target_user_id" },
  { table: "project_checkins", column: "user_id" },
  { table: "recurring_jobs", column: "owner_id" },
  { table: "quarter_goals", column: "owner_id" },
  /*
   * Other people's records that name them: a message someone sent them is
   * that person's conversation; a pledge is money (tax, disputes); a team's
   * tasks, documents, files and audits are the team's work; a sprint, a game,
   * an offer and a company's own rows belong to the others who were in them;
   * and review and moderation decisions outlive whoever made them.
   */
  { table: "direct_messages", column: "receiver_id" },
  { table: "donations", column: "donor_id" },
  { table: "project_invites", column: "created_by_id" },
  { table: "project_invites", column: "accepted_by_id" },
  { table: "project_kanban_tasks", column: "assignee_id" },
  { table: "project_kanban_tasks", column: "started_by_id" },
  { table: "project_kanban_tasks", column: "completed_by_id" },
  { table: "project_task_completions", column: "completed_by_id" },
  { table: "project_documents", column: "created_by_id" },
  { table: "project_files", column: "uploader_id" },
  { table: "code_audit_runs", column: "started_by_id" },
  { table: "project_code_audits", column: "created_by_id" },
  { table: "cofounder_sprints", column: "user1_id" },
  { table: "cofounder_sprints", column: "user2_id" },
  { table: "cofounder_sprints", column: "abandoned_by_id" },
  { table: "sprint_kanban_tasks", column: "assignee_id" },
  { table: "startup_games", column: "abandoned_by_id" },
  { table: "sim_offers", column: "responded_by_id" },
  { table: "companies", column: "created_by" },
  { table: "company_challenges", column: "created_by" },
  { table: "company_follows", column: "created_by" },
  { table: "recruit_invites", column: "sent_by" },
  { table: "recurring_jobs", column: "backup_id" },
  { table: "recurring_job_runs", column: "done_by" },
  { table: "project_backing_campaigns", column: "reviewed_by_id" },
  { table: "content_reports", column: "reporter_id" },
  { table: "content_reports", column: "target_owner_id" },
  { table: "content_reports", column: "reviewed_by_id" },
  { table: "surface_flags", column: "updated_by_id" },
  { table: "promotion_settings", column: "updated_by_id" },
  // A reviewer's decision to hide a project, and which account applied a batch of operations to one.
  { table: "projects", column: "hidden_by_id" },
  // Who ticked a milestone off: part of the project's history, and the Builder Index reads it.
  { table: "project_milestones", column: "completed_by_id" },
  // The reviewer who took a published page down: a moderation record, like the rest of them.
  { table: "path_artifacts", column: "hidden_by_id" },
  { table: "project_operation_applications", column: "user_id" },
  // Who asked what it would take to reach a target: the roadmap is the company's, the name on it is a record.
  { table: "what_would_it_take_roadmaps", column: "generated_by" },
];

/**
 * Never exported: a credential, or a billing id that identifies the account to
 * a third party. Listed both ways — the rows here come from SQL (snake_case),
 * but an ORM row is camelCase, and a filter that only knew one spelling shipped
 * the password hash in the first draft of this file.
 */
const NEVER_EXPORTED = new Set([
  // mfa_recovery_codes is dropped (migrations/0024) and kept on this list anyway: it costs
  // nothing, and it still holds for a database restored from a dump taken before that.
  "password_hash", "mfa_secret", "mfa_pending_secret", "mfa_recovery_codes", "mfa_last_step",
  "token_hash", "stripe_customer_id", "stripe_subscription_id",
  "passwordHash", "mfaSecret", "mfaPendingSecret", "mfaRecoveryCodes", "mfaLastStep",
  "tokenHash", "stripeCustomerId", "stripeSubscriptionId",
  /*
   * The project's read-only database connection, sealed at rest and never
   * returned to a client (shared/schema.ts). The export is a file a person
   * downloads and forwards, and a member of a project — not only its owner —
   * can ask for one, so this is the one path where "sealed" had a way out.
   */
  "data_source", "dataSource",
]);

const ident = (v: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(v)) throw new Error(`unsafe identifier: ${v}`);
  return `"${v}"`;
};

/**
 * One statement over one of the tables above.
 *
 * A table name can't be a bound parameter, so it is spelled into the text —
 * but only from the lists in this file, never from a request, and only after
 * `ident` has checked its shape. The value is still `$1`.
 */
const statement = (verb: "SELECT *" | "DELETE", table: string, column: string) =>
  `${verb} FROM ${ident(table)} WHERE ${ident(column)} = $1`;

const scrub = <T extends Record<string, unknown>>(rows: T[]): T[] =>
  rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !NEVER_EXPORTED.has(k))) as T);

/**
 * Everything the account holds, as JSON: the account itself, its profile, the
 * projects it owns or is on, and every row above — its own rows only, never a
 * row belonging to someone else.
 */
export async function exportAccount(userId: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  // Straight from SQL, like every other table here, so the export reads in one spelling and one filter covers it.
  const account = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
  if (!account.rows.length) throw Object.assign(new Error("No such account"), { status: 404 });
  out.account = scrub(account.rows)[0];

  const projects = await pool.query(
    `SELECT p.* FROM projects p WHERE p.owner_id = $1
       OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1)`,
    [userId],
  );
  // Scrubbed like every other table here: this row carries the sealed data source.
  out.projects = scrub(projects.rows);

  for (const { table, column } of [...MINE, ...CHOICE, ...KEPT]) {
    const { rows } = await pool.query(statement("SELECT *", table, column), [userId]);
    if (!rows.length) continue;
    const key = column === "user_id" || column === "author_id" ? table : `${table}.${column}`;
    out[key] = scrub(rows);
  }
  out.exportedAt = new Date().toISOString();
  return out;
}

export interface DeleteOutcome {
  /** Projects handed to another member, and who now owns them. */
  transferred: { projectId: string; title: string; newOwnerId: string }[];
  /** Projects nobody else was on, deleted with everything under them. */
  deletedProjects: { projectId: string; title: string }[];
  /** What happened to posts, comments and published artifacts. */
  posts: "deleted" | "kept-anonymous";
  rowsDeleted: number;
}

/**
 * Closes the account.
 *
 * A project with other people on it is handed to the member who has been there
 * longest, so leaving never takes someone else's work with it; a project nobody
 * else is on goes, and the database takes everything under it (the project
 * foreign keys cascade, migration 0019). Sessions and tokens are revoked so
 * every device is signed out, and the `users` row is scrubbed in place.
 *
 * One transaction: a half-deleted account is worse than a failed one.
 */
/**
 * Who inherits a project when its owner closes their account: an admin if
 * there is one, otherwise the member whose account is oldest. One statement,
 * shared, so the projects `deleteAccount` removes and the ones
 * `projectsLeavingWith` names — the ones whose held pledges are refunded first
 * — can never disagree.
 */
const HEIR_SQL = `SELECT m.user_id FROM project_members m
   JOIN users u ON u.id = m.user_id
  WHERE m.project_id = $1 AND m.user_id <> $2 AND u.deleted_at IS NULL
  ORDER BY (m.role IN ('owner', 'admin')) DESC, u.created_at ASC NULLS LAST, m.user_id ASC
  LIMIT 1`;

/** The projects that will be deleted, not handed on, when this account closes. */
export async function projectsLeavingWith(userId: string): Promise<{ id: string; title: string }[]> {
  const owned = await pool.query<{ id: string; title: string }>("SELECT id, title FROM projects WHERE owner_id = $1", [userId]);
  const leaving: { id: string; title: string }[] = [];
  for (const project of owned.rows) {
    const heir = await pool.query(HEIR_SQL, [project.id, userId]);
    if (heir.rows.length === 0) leaving.push(project);
  }
  return leaving;
}

export async function deleteAccount(userId: string, opts: { keepPosts: boolean }): Promise<DeleteOutcome> {
  const client = await pool.connect();
  const outcome: DeleteOutcome = { transferred: [], deletedProjects: [], posts: opts.keepPosts ? "kept-anonymous" : "deleted", rowsDeleted: 0 };
  try {
    await client.query("BEGIN");

    // Companies first: their Run projects go to the company's next owner, not to the loop below.
    await companiesOnAccountClose(client, userId);

    /*
     * Their open tasks go back to the team, unassigned. A task assigned to a
     * closed account sits on the board as somebody's forever, and nobody else
     * picks it up. Finished tasks keep the name: that's who did the work.
     */
    await client.query("UPDATE project_kanban_tasks SET assignee_id = NULL WHERE assignee_id = $1 AND status <> 'done'", [userId]);
    await client.query("UPDATE sprint_kanban_tasks SET assignee_id = NULL WHERE assignee_id = $1", [userId]);

    const owned = await client.query<{ id: string; title: string }>("SELECT id, title FROM projects WHERE owner_id = $1", [userId]);
    for (const project of owned.rows) {
      /*
       * Who inherits it. project_members records no join date, so "longest
       * standing on the project" isn't knowable: an admin takes it if there is
       * one, otherwise the member whose SparkTower account is oldest. Stable,
       * explainable, and the same answer every time.
       */
      const heir = await client.query<{ user_id: string }>(HEIR_SQL, [project.id, userId]);
      if (heir.rows[0]) {
        await client.query("UPDATE projects SET owner_id = $1 WHERE id = $2", [heir.rows[0].user_id, project.id]);
        await client.query("UPDATE project_members SET role = 'owner' WHERE project_id = $1 AND user_id = $2", [project.id, heir.rows[0].user_id]);
        /*
         * An approval vouched for the person who ran the project, and release
         * pays whoever owns it now. Left standing, the next release would send
         * held pledges to a new owner no reviewer ever looked at. Back to the
         * queue: a reviewer decides again, and nothing is paid out until then.
         */
        await client.query(
          "UPDATE project_backing_campaigns SET review_status = 'pending', submitted_for_review_at = (now() at time zone 'utc') WHERE project_id = $1 AND review_status = 'approved'",
          [project.id],
        );
        outcome.transferred.push({ projectId: project.id, title: project.title, newOwnerId: heir.rows[0].user_id });
      } else {
        await client.query("DELETE FROM projects WHERE id = $1", [project.id]);
        outcome.deletedProjects.push({ projectId: project.id, title: project.title });
      }
    }

    const toDelete = opts.keepPosts ? MINE : [...MINE, ...CHOICE];
    for (const { table, column } of toDelete) {
      const res = await client.query(statement("DELETE", table, column), [userId]);
      outcome.rowsDeleted += res.rowCount ?? 0;
    }

    // Every device, now: web sessions, mobile refresh tokens, editor tokens, and any access token already issued.
    await client.query("DELETE FROM sessions WHERE sess -> 'passport' ->> 'user' = $1 OR sess -> 'mfaPending' ->> 'userId' = $1", [userId]);
    await client.query("DELETE FROM mobile_refresh_tokens WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM mcp_tokens WHERE user_id = $1", [userId]);

    /*
     * The tombstone. The email is replaced rather than nulled: it's unique, and
     * signing up again with the same address has to work.
     */
    await client.query(
      `UPDATE users SET
         email = $2, first_name = 'Deleted', last_name = 'account', profile_image_url = NULL,
         password_hash = NULL, google_id = NULL, stripe_customer_id = NULL, stripe_subscription_id = NULL,
         mfa_secret = NULL, mfa_pending_secret = NULL, mfa_enabled_at = NULL, mfa_last_step = NULL,
         access_tokens_revoked_at = now(), deleted_at = now()
       WHERE id = $1`,
      [userId, `deleted+${userId}@deleted.invalid`],
    );

    await client.query("COMMIT");
    return outcome;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Whether this account has been closed — checked wherever a session or token is turned back into a user. */
export const isDeleted = (user: { deletedAt?: Date | null } | null | undefined) => !!user?.deletedAt;
