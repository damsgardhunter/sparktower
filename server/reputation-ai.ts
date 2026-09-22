/**
 * Nova's weekly reading of how a builder is going about it.
 *
 * The old version asked a model to grade the *description* of somebody's
 * projects — clarity of problem statement, strength of value proposition — and
 * folded that into the index. That measures how well the pitch was written. A
 * builder with a rough idea and a shipped product scored below one with a
 * polished paragraph and nothing behind it, which is the wrong way round.
 *
 * This asks about the week instead: what has been finished, what is stuck,
 * what they chose to do next, and how their companies are doing in the
 * simulation. It sees what happened as well as what was claimed.
 *
 * It returns null rather than a guess whenever it cannot answer — no key, a
 * refusal, an unparseable reply, a builder with nothing to read yet. The
 * caller keeps last week's score in that case, which is how a pillar survives
 * a bad afternoon at the model's end. The old code added a flat 25 points on
 * any exception, so an outage quietly handed every builder a quarter of a
 * pillar.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";
import { openai, openAiConfigured } from "./openai-client";
import { TEXT_MODEL } from "./aiModels";
import { parseModelJson } from "./ai-json";

export interface StrategyRead {
  /** 0–100. How well this builder is choosing what to do, on the evidence. */
  score: number;
  /** One line a person can read, shown under the strategy pillar. */
  summary: string;
}

/** What the builder has been doing, in the few facts worth sending. */
async function evidenceFor(userId: string) {
  const result: any = await db.execute(sql`
    with mine as (select id, title, description, category, status from projects where owner_id = ${userId} limit 5)
    select
      (select json_agg(json_build_object(
        'title', m.title, 'status', m.status, 'category', m.category,
        'pitch', left(coalesce(m.description, ''), 240),
        'milestonesDone', (select count(*) from project_milestones x where x.project_id = m.id and x.status = 'completed'),
        'milestonesOpen', (select count(*) from project_milestones x where x.project_id = m.id and x.status <> 'completed'),
        'tasksDone', (select count(*) from project_task_completions c where c.project_id = m.id),
        'lastFinished', (select max(c.completed_at) from project_task_completions c where c.project_id = m.id)
      )) from mine m) as projects,
      (select json_agg(json_build_object('title', left(t.title, 80), 'at', t.completed_at, 'onTime', t.on_time))
        from (select title, completed_at, on_time from project_task_completions
              where completed_by_id = ${userId} order by completed_at desc limit 12) t) as recent,
      (select json_agg(json_build_object('year', r.year, 'rank', r.report->'rank', 'profit', r.report->'profit',
                                          'share', r.report->'marketShare', 'bankrupt', r.report->'bankrupt'))
        from sim_reports r
        where r.venture_id in (select venture_id from sim_seats where user_id = ${userId})
        order by r.year desc limit 6) as seasons
  `);
  return (result.rows ?? result)[0] ?? {};
}

const SYSTEM = [
  "You are scoring how well a founder is *deciding* what to build, from evidence of what they have actually done.",
  "Judge: whether finished work adds up to a coherent direction, whether they finish what they start,",
  "whether they respond to what is not working, and — if they have played the business simulation —",
  "how their decisions there turned out. Do not reward polished wording; a rough description with",
  "steady shipping beats a beautiful pitch with nothing behind it. Be sparing: 50 is an ordinary",
  "builder making reasonable choices, 80+ is someone whose decisions are visibly paying off.",
  'Answer as JSON only: {"score": <0-100 integer>, "summary": "<one sentence, max 20 words, addressed to them>"}',
].join(" ");

/**
 * Ask Nova. Null when there is nothing worth asking about, or when the answer
 * cannot be used — never a fallback number, because a fallback number is
 * indistinguishable from a verdict once it is in the column.
 */
export async function strategyRead(userId: string): Promise<StrategyRead | null> {
  if (!openAiConfigured()) return null;

  const evidence = await evidenceFor(userId);
  const projects = evidence.projects ?? [];
  const recent = evidence.recent ?? [];
  const seasons = evidence.seasons ?? [];
  /* Nothing to read: a brand-new account is not a bad strategist. */
  if (projects.length === 0 && seasons.length === 0) return null;

  try {
    const response = await openai.chat.completions.create({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: JSON.stringify({
            projects,
            recentlyFinished: recent,
            simulationSeasons: seasons,
          }),
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 200,
    });

    /* parseModelJson throws on anything it can't read; the catch below owns that. */
    const parsed = parseModelJson<{ score?: unknown; summary?: unknown }>(response.choices[0]?.message?.content ?? "", "strategy read");
    const score = Math.round(Number(parsed.score));
    if (!Number.isFinite(score) || score < 0 || score > 100) return null;
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 240) : "";
    return { score, summary };
  } catch (error) {
    console.error("[reputation] Nova's strategy read failed:", error);
    return null;
  }
}
