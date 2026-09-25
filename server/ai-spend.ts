/**
 * What Nova has spent for one person lately, and whether it may spend more.
 *
 * The monthly allowance says what a subscription buys; it does not say when.
 * A month emptied in a weekend costs the same to serve as a month spread over
 * four weeks and is worth much less, because the inference is paid for now
 * and the subscription renews later — and an account that burns the lot in
 * week one and cancels has been served at a loss.
 *
 * So there are two ceilings under the monthly one. A daily credit cap, which
 * every AI route gets for free because they all pass through `requireCredits`.
 * And per-action ceilings for the handful whose real cost is nothing like
 * their price — a codebase audit is eight credits and reads a repository.
 *
 * Both read `ai_spend`, which is also the record of what the calls actually
 * cost in tokens. The same table that enforces the ceiling is the one that
 * says where the ceiling should be.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { aiSpend } from "@shared/schema";
import { setUsageRecorder } from "./openai-client";
import {
  DAILY_CREDIT_CAP, FREE_TIER_SPEND_SHARE, HEAVY_ACTION_LIMITS,
  type ActionCeiling, type TierId,
} from "@shared/plans";
import { aiSettingsNow, forgetAiSettings } from "./ai-settings";

const since = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);
/** A month as a rolling thirty days, not a calendar one: a ceiling that resets on the 1st invites the 1st. */
const DAY = 24, MONTH = 24 * 30;

/** Credits this person has spent in the last day. */
export async function creditsToday(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${aiSpend.credits}), 0)::int` })
    .from(aiSpend)
    .where(and(eq(aiSpend.userId, userId), gte(aiSpend.createdAt, since(DAY))));
  return Number(row?.n ?? 0);
}

/** How many times this person has taken one named action, in the last day and the last thirty. */
export async function actionCounts(userId: string, action: string): Promise<{ day: number; month: number }> {
  const [row] = await db
    .select({
      month: sql<number>`count(*)::int`,
      day: sql<number>`count(*) filter (where ${aiSpend.createdAt} >= ${since(DAY)})::int`,
    })
    .from(aiSpend)
    .where(and(eq(aiSpend.userId, userId), eq(aiSpend.action, action), gte(aiSpend.createdAt, since(MONTH))));
  return { day: Number(row?.day ?? 0), month: Number(row?.month ?? 0) };
}

/**
 * What the whole platform has spent on AI today, in dollars.
 *
 * Memoised for a minute, because this is read on every AI request and the
 * answer does not need to be to the second: it is a brake, and a brake that
 * costs a full-table scan per request is its own kind of expensive. The cost
 * of the staleness is at most a minute of spend past the line, per process.
 */
let spendMemo: { at: number; usd: number } | null = null;
const SPEND_MEMO_MS = 60_000;

export async function platformSpendToday(now = Date.now()): Promise<number> {
  if (spendMemo && now - spendMemo.at < SPEND_MEMO_MS) return spendMemo.usd;
  const [[row], settings] = await Promise.all([
    db.select({ n: sql<number>`coalesce(sum(${aiSpend.credits}), 0)::int` })
      .from(aiSpend)
      .where(gte(aiSpend.createdAt, new Date(now - DAY * 60 * 60 * 1000))),
    aiSettingsNow(now),
  ]);
  const usd = Number(row?.n ?? 0) * settings.costPerCreditUsd;
  spendMemo = { at: now, usd };
  return usd;
}

/** For tests, and for anything that has just changed the day's spend on purpose. */
export const forgetPlatformSpend = (): void => { spendMemo = null; forgetAiSettings(); };

/**
 * Whether the platform's own ceiling has been reached for this account.
 *
 * Free accounts stop earlier than paying ones. When a launch day runs hot the
 * people to stop first are the ones who have paid nothing, not the customer
 * halfway through the work they are paying for.
 */
export async function overPlatformCeiling(tier: TierId): Promise<{ spent: number; cap: number } | null> {
  const ceiling = await platformCeilingUsd();
  if (ceiling <= 0) return null;
  const spent = await platformSpendToday();
  const cap = ceiling * (tier === "free" ? FREE_TIER_SPEND_SHARE : 1);
  return spent >= cap ? { spent, cap } : null;
}

/**
 * The day's ceiling in dollars: the environment's if it set one, else the
 * default. Read per call rather than at import so a deployment can raise or
 * drop the brake without a rebuild, and so a test can set it.
 */
export async function platformCeilingUsd(): Promise<number> {
  return (await aiSettingsNow()).dailySpendCapUsd;
}

export type Refusal =
  | { kind: "daily_credits"; spent: number; cap: number; amount: number }
  | { kind: "action_day"; action: string; used: number; cap: number }
  | { kind: "action_month"; action: string; used: number; cap: number }
  | { kind: "platform"; tier: TierId };

/**
 * Whether this call is within both ceilings. Null means go ahead.
 *
 * Checked before the credits are charged and before the model is called, so a
 * refusal costs the person nothing — the same rule the rest of the metering
 * follows.
 */
export async function overCeiling(
  userId: string,
  tier: TierId,
  amount: number,
  action?: string,
): Promise<Refusal | null> {
  // The ceiling over everything, before the ones over this account.
  if (await overPlatformCeiling(tier)) return { kind: "platform", tier };

  const limits: ActionCeiling | undefined = action ? HEAVY_ACTION_LIMITS[action]?.[tier] : undefined;
  if (limits) {
    const used = await actionCounts(userId, action!);
    if (used.day >= limits.day) return { kind: "action_day", action: action!, used: used.day, cap: limits.day };
    if (used.month >= limits.month) return { kind: "action_month", action: action!, used: used.month, cap: limits.month };
  }

  const cap = DAILY_CREDIT_CAP[tier];
  if (cap === undefined) return null;
  const spent = await creditsToday(userId);
  if (spent + amount > cap) return { kind: "daily_credits", spent, cap, amount };
  return null;
}

/**
 * Write the call down, and hand back the row so the tokens can be filled in
 * once the model has answered. Never throws: a ledger that cannot be written
 * must not be the reason somebody's request fails, and a missing row costs a
 * little accuracy on a ceiling rather than an outage.
 */
export async function recordSpend(input: {
  userId: string; action: string; credits: number; model?: string | null;
}): Promise<string | null> {
  try {
    const [row] = await db.insert(aiSpend).values({
      userId: input.userId,
      action: input.action.slice(0, 64),
      credits: input.credits,
      model: input.model ?? null,
    }).returning({ id: aiSpend.id });
    return row?.id ?? null;
  } catch (err) {
    console.error("[ai-spend] could not record a call:", (err as Error)?.message ?? err);
    return null;
  }
}

/** What the model reported it used, once it has answered. Same rule: never throws. */
export async function recordTokens(id: string | null, usage: {
  prompt_tokens?: number | null; completion_tokens?: number | null;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
  model?: string | null;
} | null | undefined): Promise<void> {
  if (!id || !usage) return;
  try {
    await db.update(aiSpend).set({
      promptTokens: usage.prompt_tokens ?? null,
      completionTokens: usage.completion_tokens ?? null,
      cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? null,
      ...(usage.model ? { model: usage.model } : {}),
    }).where(eq(aiSpend.id, id));
  } catch (err) {
    console.error("[ai-spend] could not record tokens:", (err as Error)?.message ?? err);
  }
}

/**
 * Which row the calls on this request belong to.
 *
 * The client knows what an answer cost and nothing about who asked; the route
 * knows who asked and never sees the usage. This is what joins them, without
 * threading an id through thirty call sites that have no other reason to know
 * about billing.
 *
 * `enterWith` rather than `run`, because the credit check happens in the
 * middle of a handler rather than around it: there is no callback to wrap.
 * It sets the store for the rest of this request's async chain, which is
 * exactly the scope wanted.
 *
 * A request that charges once and then makes several model calls — the
 * codebase audit makes seventeen — records the last one's usage against the
 * row. That is a known limit of one row per charge, and the totals that
 * matter (what a charge cost, across the whole ledger) still come out right
 * for the single-call actions that are almost all of the traffic.
 */
const currentSpend = new AsyncLocalStorage<string | null>();

/** Begin attributing model calls on this request to a ledger row. */
export const beginSpend = (id: string | null): void => { currentSpend.enterWith(id); };

/**
 * Wire the client up to the ledger. Called once, when this module loads —
 * which it does behind every AI route, because `requireCredits` lives here.
 */
setUsageRecorder((usage) => {
  const id = currentSpend.getStore();
  if (id) void recordTokens(id, usage);
});

/** A stable key from whatever the person was told, for a call that named no action. */
export const slugOf = (label: string): string =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) || "nova";
