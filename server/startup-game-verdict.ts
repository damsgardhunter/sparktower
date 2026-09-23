/**
 * Asking a model what the thing is worth.
 *
 * The payoff of the whole game: two people spend half an hour inventing a
 * company, and this is where they find out what it was. It runs once per game,
 * when the last round closes.
 *
 * ## Everything the model says is treated as a guess
 *
 * `cleanVerdict` in `@shared/sprints/scoring` is the wall between the model
 * and the leaderboard, and it is not optional politeness — asked to value an
 * imaginary company, models return 1200 out of 1000, a peak lower than the
 * ten-year figure, and valuations in the hundreds of trillions. None of that
 * can reach a board that people are ranked on.
 *
 * ## A failure must not cost somebody their game
 *
 * If the model is unreachable or answers with nonsense, the game still ends
 * with a verdict — an honest one that says so, marked `fromModel: false` and
 * left out of the leaderboards. Twenty minutes of somebody's evening must not
 * come down to an upstream timeout, and a placeholder that quietly ranks
 * alongside real scores would be worse than no score at all.
 */
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { startupGames, startupGameVerdicts } from "@shared/schema";
import { parseModelJson } from "./ai-json";
import { recordValuation, refundPlay, takePlay } from "./game-plays";
import { cleanVerdict, overallScore, DIMENSIONS, type Verdict } from "@shared/sprints/scoring";
import { summariseBudget, money } from "@shared/sprints/budget";
import { coreClaims, type Claim } from "@shared/sprints/product";
/*
 * The shared client, not one of its own.
 *
 * This module built its client from `OPENAI_API_KEY`, which this product
 * does not set — every other AI feature reads `AI_INTEGRATIONS_OPENAI_API_KEY`
 * and routes through the gateway's base URL, via server/openai-client.ts. So
 * every valuation failed at the first call, silently fell back, and every
 * finished game told its two players "the valuation couldn't be reached this
 * time". There was no "this time": it could never be reached.
 */
import { getOpenAI } from "./openai-client";

/**
 * The company, written out the way a person would describe it.
 *
 * Prose rather than the raw row. A model handed `{"customerCardId":
 * "night-nurses"}` has to guess what that means; handed "Night-shift nurses —
 * three twelve-hour nights a week, no time to learn anything" it is reasoning
 * about the same thing the players were.
 *
 * The budget is spelled out in full, including what was left unspent and which
 * lines were funded below what they cost, because that is the part of the game
 * carrying the most information about whether this company survives.
 */
export function describeCompany(game: any): string {
  const idea = game.idea ?? {};
  const claims = (game.productClaims ?? []) as Claim[];
  const budget = summariseBudget((game.budget ?? {}) as Record<string, number>);

  const lines: string[] = [];
  lines.push(`COMPANY: ${idea.name || "Unnamed"}`);
  if (idea.tagline) lines.push(`Tagline: ${idea.tagline}`);
  if (idea.pitch) lines.push(`Pitch: ${idea.pitch}`);
  if (idea.twist) lines.push(`The twist: ${idea.twist}`);
  if (game.era) lines.push(`Era: ${game.era}`);

  lines.push(`\nCUSTOMER: ${game.customerLabel || "not chosen"}`);
  lines.push(`BUSINESS MODEL: ${game.modelLabel || "not chosen"}`);

  const core = coreClaims(claims);
  lines.push(`\nWHAT IT DOES BETTER THAN WHAT EXISTS (${claims.length} claims):`);
  for (const c of claims) lines.push(`- ${c.text}${c.core ? "  [CORE]" : ""}`);
  if (core.length === 0) lines.push("- (they never agreed which of these actually matter)");

  lines.push(`\nHOW THEY SPENT THE FIRST MILLION (year one):`);
  for (const line of budget.funded) {
    lines.push(`- ${money(line.amount)} — ${line.option.label}${line.underfunded ? "  [funded below what it costs; likely bought nothing]" : ""}`);
  }
  if (budget.funded.length === 0) lines.push("- (they spent nothing at all)");
  if (budget.unallocated > 0) lines.push(`- ${money(budget.unallocated)} left unallocated.`);
  lines.push(`Deployed: ${money(budget.deployed)} of ${money(budget.total)}.`);

  return lines.join("\n");
}

const SYSTEM = `You are a blunt, experienced venture analyst valuing an imaginary startup that two people invented in half an hour as a game.

Judge what is actually in front of you. Do not be generous because it is a game, and do not be withering because it is unfinished — the pair get one number and it should be one they can learn from.

Score five dimensions from 0 to 1000. USE THE FULL RANGE. A competent, unremarkable answer is around 500; 800+ means genuinely excellent and should be rare; below 250 means seriously broken.
${DIMENSIONS.map((d) => `- ${d.id}: ${d.blurb}${d.betterIs === "lower" ? " (HIGHER NUMBER = MORE RISK)" : ""}`).join("\n")}

Then value it: a ten-year valuation in US dollars, the peak valuation it ever reaches, and which year that peak falls in (1-10). The peak can never be lower than the ten-year figure. Most startups are worth very little; a few are worth billions. Be willing to say a number is small.

Respond with ONLY valid JSON:
{"scores":{"growth":0,"capital":0,"product":0,"acquisition":0,"risk":0},
 "tenYear":0,"peak":0,"peakYear":1,
 "summary":"two or three sentences on what this company is and what decides whether it works",
 "notes":{"growth":"one line","capital":"one line","product":"one line","acquisition":"one line","risk":"one line"},
 "advice":["the single change that would most raise this valuation","a second one"]}`;

/**
 * Whether there is a company here at all.
 *
 * A game whose players both close the tab still reaches the verdict: every
 * round settles on its clock whether or not anybody answered, which is the
 * rule that stops one person holding another hostage. What comes out the far
 * end is an empty row — no idea, no customer, no budget — and without this
 * check it was sent to the model to be valued, at cost, and the resulting
 * scores went on a leaderboard as "Unnamed".
 *
 * An idea is the floor: a company nobody named is not a company. Beyond that
 * one more decision is enough, because a pair who got as far as choosing a
 * customer and then ran out of time have still built something worth judging.
 */
export function hasSubstance(game: any): boolean {
  const named = !!String((game.idea as any)?.name ?? "").trim();
  if (!named) return false;
  const decisions = [
    game.customerCardId,
    game.modelCardId,
    ((game.productClaims ?? []) as unknown[]).length > 0 || null,
    game.budget,
  ].filter(Boolean);
  return decisions.length > 0;
}

/**
 * The verdict used when the model could not give one.
 *
 * Deliberately middling and honest about itself rather than zeroed. A pair who
 * played well and hit an outage should not read "0 out of 1000" — that is a
 * judgement the product did not make and cannot support.
 */
export const FALLBACK_SUMMARY =
  "The valuation couldn't be reached this time, so this game isn't scored yet. Everything you decided is still here, and it will be valued as soon as the valuation can be reached.";

export function fallbackVerdict(): Verdict {
  return cleanVerdict({
    scores: { growth: 500, capital: 500, product: 500, acquisition: 500, risk: 500 },
    tenYear: 0, peak: 0, peakYear: 10,
    summary: FALLBACK_SUMMARY,
    advice: [],
  });
}

/**
 * How long a game keeps trying to be valued after the first attempt failed,
 * and how often.
 *
 * A fallback used to be final: it was written as the game's verdict, and
 * `valueGame` stops at any existing verdict — so one timeout, one malformed
 * answer, one missing key, and a finished game could never be scored, whatever
 * the comment below says about outages. Now a fallback is provisional. While
 * somebody is on the results page (it polls every five seconds) the game is
 * asked about again once a minute, for up to a day, and the first real answer
 * replaces the placeholder.
 */
export const RETRY_EVERY_MS = 60_000;
export const RETRY_FOR_MS = 24 * 60 * 60_000;
const lastTried = new Map<string, number>();

/** Whether a stored verdict is a placeholder worth asking about again. */
export function shouldRetry(existing: { fromModel: boolean; summary: string; createdAt: Date | null } | undefined, now = Date.now()): boolean {
  if (!existing || existing.fromModel) return false;
  // Only the outage placeholder: a game nobody played stays unscored for good.
  if (existing.summary !== FALLBACK_SUMMARY && !existing.summary.startsWith("The valuation couldn't be reached")) return false;
  const since = existing.createdAt ? now - new Date(existing.createdAt).getTime() : 0;
  return since < RETRY_FOR_MS;
}

/**
 * Games this process is already valuing.
 *
 * The read-then-call-then-write below has a gap in the middle wide enough for
 * a model call, and both players poll the finished game every few seconds — so
 * without this, two requests sail past the "already valued?" check together
 * and each pay for an answer to the same question. The row's primary key stops
 * the second one being *stored*; nothing stopped it being *bought*.
 *
 * In-process only, which is the right size for the problem: a second server
 * would need a lock, but the cost of the occasional duplicate across two
 * machines is one model call, where the cost here was one per poll.
 */
const valuing = new Set<string>();

export async function valueGame(gameId: string, askedBy?: string, model = "gpt-4o"): Promise<Verdict | null> {
  if (valuing.has(gameId)) return null;

  const [existing] = await db.select().from(startupGameVerdicts)
    .where(eq(startupGameVerdicts.gameId, gameId));
  const retrying = !!existing && shouldRetry(existing);
  if (existing && !retrying) return null;
  if (retrying && Date.now() - (lastTried.get(gameId) ?? 0) < RETRY_EVERY_MS) return null;

  valuing.add(gameId);
  lastTried.set(gameId, Date.now());
  try {
    return await runValuation(gameId, model, retrying, askedBy);
  } finally {
    /*
     * Released even when it failed, so a transient outage doesn't leave the
     * game permanently unvaluable — but the screen only asks again on a later
     * poll, so a persistent failure retries slowly rather than in a loop.
     */
    valuing.delete(gameId);
  }
}

/**
 * Value a finished game, once.
 *
 * Idempotent twice over: the in-flight set above stops a second model call,
 * and the verdict row's primary key stops a second write.
 */
async function runValuation(gameId: string, model: string, retrying = false, askedBy?: string): Promise<Verdict | null> {
  const [game] = await db.select().from(startupGames).where(eq(startupGames.id, gameId));
  if (!game || game.round !== "verdict") return null;

  let verdict = fallbackVerdict();
  let fromModel = false;

  /*
   * Nothing was decided. Recorded so the screen has something to show and the
   * game stops asking, but never sent to the model and never scored — paying
   * to have an empty row valued, and then ranking the result, is worse than
   * saying plainly that there was nothing to judge.
   */
  if (!hasSubstance(game)) {
    await writeVerdict(gameId, emptyGameVerdict(), false);
    return null;
  }

  /*
   * The play is taken here and not before, because everything above this can
   * decide not to call the model at all — a game with nothing in it is
   * written off without being valued, and charging a person a play for that
   * would be taking a dollar for a call that never happened.
   *
   * `takePlay` is conditional in SQL, so two tabs polling the same finished
   * game cannot both spend the same bought play.
   */
  let paidForIt = false;
  if (askedBy) {
    const play = await takePlay(askedBy);
    if (!play.ok) return null;
    paidForIt = play.paid;
  }

  try {
    const response = await getOpenAI().chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: describeCompany(game) },
      ],
      temperature: 0.6,
      max_completion_tokens: 1200,
    });
    const parsed = parseModelJson<Record<string, unknown>>(
      response.choices[0]?.message?.content, "startup valuation",
    );
    if (parsed) {
      verdict = cleanVerdict(parsed);
      fromModel = true;
    }
  } catch (err) {
    console.error(`[game] valuation for ${gameId} failed, falling back:`, err);
  }

  /*
   * What the person actually got decides what they are charged.
   *
   * An answer is recorded, which is what spends their free one for the day and
   * what makes the call visible in `ai_spend`. A failure is not: the free play
   * is counted from what was recorded, so recording nothing leaves it intact,
   * and a bought play is handed straight back. Nobody pays a dollar for a
   * placeholder.
   */
  if (askedBy) {
    if (fromModel) await recordValuation(askedBy, model);
    else if (paidForIt) await refundPlay(askedBy);
  }

  if (retrying) {
    // A second failure changes nothing: the placeholder is already there.
    if (!fromModel) return null;
    /*
     * The real answer replaces the placeholder — and only the placeholder. The
     * condition on `fromModel` means a real verdict that landed in the
     * meantime, from another request, is never overwritten by this one.
     */
    await db.update(startupGameVerdicts)
      .set({
        ...verdict.scores,
        overall: overallScore(verdict.scores),
        tenYear: verdict.tenYear,
        peak: verdict.peak,
        peakYear: verdict.peakYear,
        summary: verdict.summary,
        notes: verdict.notes,
        advice: verdict.advice,
        fromModel: true,
        createdAt: new Date(),
      } as any)
      .where(and(eq(startupGameVerdicts.gameId, gameId), eq(startupGameVerdicts.fromModel, false)));
    lastTried.delete(gameId);
    return verdict;
  }

  await writeVerdict(gameId, verdict, fromModel);
  return verdict;
}

/** What a game nobody played is told. */
function emptyGameVerdict(): Verdict {
  return cleanVerdict({
    scores: { growth: 0, capital: 0, product: 0, acquisition: 0, risk: 0 },
    tenYear: 0, peak: 0, peakYear: 10,
    summary: "Neither of you got far enough to build anything, so there's nothing to value. Start another one whenever you like.",
    advice: [],
  });
}

/*
 * `onConflictDoNothing` as well as the in-flight guard: two requests can both
 * get past the check, and the pair must still end up with one verdict rather
 * than whichever landed second.
 */
async function writeVerdict(gameId: string, verdict: Verdict, fromModel: boolean) {
  await db.insert(startupGameVerdicts).values({
    gameId,
    ...verdict.scores,
    overall: overallScore(verdict.scores),
    tenYear: verdict.tenYear,
    peak: verdict.peak,
    peakYear: verdict.peakYear,
    summary: verdict.summary,
    notes: verdict.notes,
    advice: verdict.advice,
    fromModel,
    createdAt: new Date(),
  } as any).onConflictDoNothing({ target: startupGameVerdicts.gameId });
}
