/**
 * What a credit costs and what a day may cost, read from the database rather
 * than from a constant.
 *
 * Cost per credit has already been measured at four cents and at two, and
 * both were right: it is whatever people happened to do that day. A number
 * that moves like that should be adjustable by whoever is watching the bill,
 * not fixed by whoever last deployed — so it lives in a row, and the ceilings
 * derive from it.
 *
 * Falls back, in order: the row, then `AI_DAILY_SPEND_CAP_USD` for the cap,
 * then the constants in `@shared/plans`. A database that cannot be read must
 * never take the brake off, so every failure lands on the defaults.
 */
import { eq } from "drizzle-orm";
import { db } from "./db";
import { aiSettings } from "@shared/schema";
import { COST_PER_CREDIT_USD, PLATFORM_DAILY_SPEND_USD } from "@shared/plans";

export interface AiSettings {
  costPerCreditUsd: number;
  dailySpendCapUsd: number;
  updatedAt: string | null;
  /** True when these are the built-in defaults rather than anything anyone chose. */
  isDefault: boolean;
}

/** The environment's cap, where it set one. Overridden by a row, if there is one. */
function capFromEnv(): number | null {
  const raw = process.env.AI_DAILY_SPEND_CAP_USD?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const DEFAULTS: AiSettings = {
  costPerCreditUsd: COST_PER_CREDIT_USD,
  dailySpendCapUsd: capFromEnv() ?? PLATFORM_DAILY_SPEND_USD,
  updatedAt: null,
  isDefault: true,
};

/*
 * Read on every AI request, so it is memoised for a minute. The cost of the
 * staleness is that a change takes up to a minute to bite, which is the right
 * trade for not querying on every call.
 */
let memo: { at: number; value: AiSettings } | null = null;
const MEMO_MS = 60_000;

export function forgetAiSettings(): void { memo = null; }

export async function aiSettingsNow(now = Date.now()): Promise<AiSettings> {
  if (memo && now - memo.at < MEMO_MS) return memo.value;
  let value = { ...DEFAULTS, dailySpendCapUsd: capFromEnv() ?? PLATFORM_DAILY_SPEND_USD };
  try {
    const [row] = await db.select().from(aiSettings).where(eq(aiSettings.id, "singleton"));
    if (row) {
      value = {
        costPerCreditUsd: row.costPerCreditMicros / 1_000_000,
        dailySpendCapUsd: row.dailySpendCapUsd,
        updatedAt: row.updatedAt?.toISOString() ?? null,
        isDefault: false,
      };
    }
  } catch (err) {
    // Unreadable settings mean the defaults, which are the safe end.
    console.error("[ai-settings] could not read, using defaults:", (err as Error)?.message ?? err);
  }
  memo = { at: now, value };
  return value;
}

/** Bounds, so a typo in an admin form cannot switch the economics off. */
export const COST_MICROS_MIN = 100;          // $0.0001 a credit
export const COST_MICROS_MAX = 1_000_000;    // $1.00 a credit
export const CAP_USD_MAX = 100_000;

export interface SettingsProblem { field: "costPerCredit" | "dailySpendCap"; message: string }

/** Save what somebody chose, or say why it was refused. */
export async function saveAiSettings(input: {
  costPerCreditUsd: unknown; dailySpendCapUsd: unknown; userId: string;
}): Promise<{ ok: true; settings: AiSettings } | { ok: false; problem: SettingsProblem }> {
  const micros = Math.round(Number(input.costPerCreditUsd) * 1_000_000);
  if (!Number.isFinite(micros) || micros < COST_MICROS_MIN || micros > COST_MICROS_MAX) {
    return { ok: false, problem: {
      field: "costPerCredit",
      message: `A credit costs between $${COST_MICROS_MIN / 1e6} and $${COST_MICROS_MAX / 1e6}. Everything else is derived from this, so it is not a field to guess at.`,
    } };
  }
  const cap = Math.round(Number(input.dailySpendCapUsd));
  if (!Number.isFinite(cap) || cap < 0 || cap > CAP_USD_MAX) {
    return { ok: false, problem: {
      field: "dailySpendCap",
      message: `A daily ceiling is between $0 and $${CAP_USD_MAX.toLocaleString()}. Zero takes the brake off entirely.`,
    } };
  }

  await db.insert(aiSettings)
    .values({ id: "singleton", costPerCreditMicros: micros, dailySpendCapUsd: cap, updatedBy: input.userId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: aiSettings.id,
      set: { costPerCreditMicros: micros, dailySpendCapUsd: cap, updatedBy: input.userId, updatedAt: new Date() },
    });
  forgetAiSettings();
  return { ok: true, settings: await aiSettingsNow() };
}

/**
 * The ladder these numbers imply.
 *
 * Each tier is sized so the builder it is aimed at is never capped, and so a
 * month spent entirely at the daily ceiling still cannot lose money. Prices
 * are not stored here on purpose: changing what a customer is charged is a
 * deliberate act involving Stripe, not a slider. This says what a given price
 * can afford, which is the part that moves when the cost does.
 */
export interface Rung {
  name: string; priceMonthly: number; serves: string;
  /** A month of the use this tier is for, in credits. */
  typicalUse: number;
  credits: number; capPerDay: number;
  costOfTypicalUse: number; worstMonth: number; profit: number; margin: number;
}

/** What a month of each kind of use costs, in credits. From scripts/price-model.mjs. */
export const JOURNEY_CREDITS = { "Dipping in": 38, "Building properly": 197, "Leaning on it": 588 } as const;

const netOf = (price: number) => price > 0 ? price - (price * 0.029 + 0.30) : 0;

export function ladderFor(costPerCreditUsd: number, prices: { name: string; price: number; serves: keyof typeof JOURNEY_CREDITS }[]): Rung[] {
  return prices.map((p) => {
    const net = netOf(p.price);
    // The worst case — the whole ceiling, every day — must still break even.
    const capPerDay = Math.max(1, Math.floor(net / 30 / costPerCreditUsd));
    const use = JOURNEY_CREDITS[p.serves];
    const costOfTypicalUse = use * costPerCreditUsd;
    const profit = net - costOfTypicalUse;
    return {
      name: p.name, priceMonthly: p.price, serves: p.serves, typicalUse: use,
      // A generous allowance that still sits under what the daily cap permits.
      credits: Math.round(capPerDay * 30 * 0.55),
      capPerDay,
      costOfTypicalUse: Math.round(costOfTypicalUse * 100) / 100,
      worstMonth: Math.round(capPerDay * 30 * costPerCreditUsd * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      margin: net > 0 ? Math.round((profit / net) * 100) : 0,
    };
  });
}
