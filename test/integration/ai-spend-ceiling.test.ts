/**
 * The brake over everything.
 *
 * Per-account ceilings answer "can one person run up a bill". They do not
 * answer the question a launch day actually asks: a thousand people who have
 * paid nothing, spending twenty free credits each, is $800 in a day against
 * no revenue. This is the ceiling over the lot — and the rule that when it
 * bites, the people who have paid keep working.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../server/db";
import { aiSpend, aiSettings } from "@shared/schema";
import { closeTestApp } from "../helpers/app";
import { overPlatformCeiling, platformSpendToday, forgetPlatformSpend } from "../../server/ai-spend";
import { aiSettingsNow, forgetAiSettings } from "../../server/ai-settings";
import { COST_PER_CREDIT_USD, FREE_TIER_SPEND_SHARE } from "@shared/plans";

afterAll(async () => { await closeTestApp(); });

const CAP = "AI_DAILY_SPEND_CAP_USD";
let written: string[] = [];

/** Put a given number of dollars of spend on the board, today. */
async function spend(usd: number) {
  const credits = Math.round(usd / COST_PER_CREDIT_USD);
  const [row] = await db.insert(aiSpend)
    .values({ userId: `ceiling-${Math.random().toString(36).slice(2, 10)}`, action: "novaChat", credits })
    .returning({ id: aiSpend.id });
  written.push(row.id);
  forgetPlatformSpend();
}

beforeEach(async () => {
  if (written.length) await db.delete(aiSpend).where(inArray(aiSpend.id, written));
  written = [];
  delete process.env[CAP];
  /*
   * And no saved settings, so these test the environment fallback rather than
   * whatever the console test last saved. A row outranks the environment by
   * design — somebody sitting at the console should not be overruled by a
   * deploy variable — which makes it an ordering trap for tests that share a
   * database.
   */
  await db.delete(aiSettings);
  forgetAiSettings();
  forgetPlatformSpend();
});

describe("the platform's daily ceiling", () => {
  it("stops free accounts before paying ones", async () => {
    process.env[CAP] = "100";
    // Past the free share, nowhere near the whole ceiling.
    await spend(100 * FREE_TIER_SPEND_SHARE + 1);

    expect(await overPlatformCeiling("free"), "free accounts stop first").toBeTruthy();
    expect(await overPlatformCeiling("builder"), "a paying customer keeps working").toBeNull();
    expect(await overPlatformCeiling("pro")).toBeNull();
  }, 120_000);

  it("stops everyone once the whole ceiling is reached", async () => {
    process.env[CAP] = "100";
    await spend(101);
    for (const tier of ["free", "starter", "builder", "pro"] as const) {
      expect(await overPlatformCeiling(tier), `${tier} is stopped`).toBeTruthy();
    }
  }, 120_000);

  it("lets everyone through on a quiet day", async () => {
    process.env[CAP] = "100";
    await spend(5);
    for (const tier of ["free", "builder"] as const) {
      expect(await overPlatformCeiling(tier)).toBeNull();
    }
  }, 120_000);

  it("counts what was actually spent, in dollars", async () => {
    await spend(12);
    expect(await platformSpendToday()).toBeCloseTo(12, 1);
  }, 120_000);

  it("takes the brake off only when told to, never by accident", async () => {
    process.env[CAP] = "0";
    await spend(10_000);
    expect(await overPlatformCeiling("free"), "zero is off, deliberately").toBeNull();

    // Anything unparseable falls back to the default rather than to no limit.
    process.env[CAP] = "not-a-number";
    forgetAiSettings();
    expect((await aiSettingsNow()).dailySpendCapUsd).toBeGreaterThan(0);
    process.env[CAP] = "-5";
    forgetAiSettings();
    expect((await aiSettingsNow()).dailySpendCapUsd, "a negative is not a licence to spend").toBeGreaterThan(0);
  }, 120_000);

  it("does not re-count the whole table on every request", async () => {
    process.env[CAP] = "100";
    await spend(1);
    const first = await platformSpendToday();
    // A write the memo has not been told about is not seen for up to a minute.
    await db.insert(aiSpend).values({ userId: "ceiling-memo", action: "novaChat", credits: 1000 });
    expect(await platformSpendToday(), "memoised, deliberately").toBeCloseTo(first, 2);
    await db.delete(aiSpend).where(eq(aiSpend.userId, "ceiling-memo"));
    forgetPlatformSpend();
  }, 120_000);
});
