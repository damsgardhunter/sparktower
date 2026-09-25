/**
 * A priced outcome is never gated on the month's free actions.
 *
 * The two budgets are unrelated. A **small action** spends one of the month's
 * free Nova actions (MONTHLY_SMALL_ACTIONS). A **priced outcome** — an audit,
 * a roadmap, the whole-business build — costs dollars off the balance, taken
 * by `requireCredits` at the route, and never touches the free actions at all.
 *
 * `CREDIT_COSTS` is what those things cost under the retired subscription
 * pricing. It still exists, and screens still read it, which is fine for a
 * label and wrong for a gate: comparing a priced outcome's old credit cost
 * against this month's remaining free actions disables the button for somebody
 * who has spent their free actions on something else, with money sitting on
 * the account and no explanation offered.
 *
 * It shipped that way twice. The codebase audit went dead after eighteen of
 * twenty-five free actions were used — it costs $5 and needs none of them —
 * and roadmap generation did the same at $3. Reported as "I have credits and
 * funds and cannot audit".
 *
 * So this reads the client source and refuses the pattern. It cannot catch
 * every shape of the mistake; it catches the one that has actually happened,
 * which is a `disabled=` that depends on a comparison against
 * `CREDIT_COSTS.<something priced>`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { CHARGE_FOR, OUTCOME_PRICE_CENTS } from "@shared/plans";

const CLIENT = path.resolve(import.meta.dirname, "../../client/src");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

/** The actions whose money comes off the balance rather than the free allowance. */
const PRICED = Object.entries(CHARGE_FOR)
  .filter(([, kind]) => typeof kind === "string" && kind !== "free" && kind !== "small"
    && kind in OUTCOME_PRICE_CENTS)
  .map(([action]) => action);

describe("what the screens gate on", () => {
  it("has priced outcomes to check, or this test is proving nothing", () => {
    expect(PRICED.length).toBeGreaterThan(0);
    expect(PRICED).toContain("codeAudit");
  });

  it("never compares a priced outcome's old credit cost against the free allowance", () => {
    const offenders: string[] = [];
    for (const file of sources(CLIENT)) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("CREDIT_COSTS.")) continue;
      for (const action of PRICED) {
        /*
         * The shape that has actually shipped: a comparison of what is left
         * against CREDIT_COSTS.<priced action>. Matched on the same line,
         * either way round, because that is how both bugs were written.
         */
        const compared = new RegExp(
          String.raw`^.*(?:creditsRemaining|creditsLeft|remaining)\s*[<>]=?\s*CREDIT_COSTS\.${action}\b.*$`,
          "m",
        );
        const reversed = new RegExp(
          String.raw`^.*CREDIT_COSTS\.${action}\s*[<>]=?\s*(?:creditsRemaining|creditsLeft|remaining)\b.*$`,
          "m",
        );
        if (compared.test(src) || reversed.test(src)) {
          offenders.push(`${path.relative(CLIENT, file)} gates ${action}, which costs money, on free Nova actions`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
