/**
 * Acting from the support console, on a phone.
 *
 * The screen refused to do this for a while and said precisely what it was
 * waiting for: "a confirmation that names the person and the amount, the
 * per-day remainder shown before the field, and the reason field the server
 * already requires". That was a good refusal and a complete specification, so
 * this tests the three things rather than the existence of the buttons.
 */
import { describe, it, expect } from "vitest";
import { CONSOLE_ACTION_DEFS, MAX_GRANT_CENTS, MAX_GRANT_CENTS_PER_DAY, MAX_PASS_DAYS, MIN_REASON } from "@shared/admin-console";
import { readSource, withoutComments } from "../helpers/source-parity";

const console_ = withoutComments(readSource("mobile/app/admin/console.tsx"));
const routes = readSource("server/admin-console-routes.ts");

describe("the two routes that had no phone caller", () => {
  it("reads what this operator may do", () => {
    expect(console_).toMatch(/"\/api\/admin\/console\/actions"\)/);
  });

  it("acts", () => {
    expect(console_).toMatch(/"\/api\/admin\/console\/act", \{\s*method: "POST"/);
  });

  it("no longer says the actions are on the web", () => {
    const whole = readSource("mobile/app/admin/console.tsx");
    expect(whole).not.toMatch(/granting credit and issuing a day pass are on the web console/);
  });
});

describe("the catalogue is not restated", () => {
  /*
   * `/api/admin/console/actions` sends CONSOLE_ACTION_DEFS whole — label,
   * blurb, role, reversible, subject. A power over somebody not in the room is
   * exactly the list that must not exist twice: a copy would eventually offer
   * something the server has removed.
   */
  it("the server really does send the definitions", () => {
    expect(routes).toMatch(/actions: Object\.values\(CONSOLE_ACTION_DEFS\)/);
  });

  it("the phone names none of the actions as a literal list", () => {
    const ids = Object.keys(CONSOLE_ACTION_DEFS);
    expect(ids.length).toBeGreaterThan(5);
    /* `credit` and `day_pass` appear as behaviour switches, which is different
     * from carrying the catalogue; what must not appear is every id. */
    const named = ids.filter((id) => console_.includes(`"${id}"`));
    expect(named.length, `the phone should not restate the catalogue: ${named.join(", ")}`).toBeLessThan(4);
  });

  it("renders the server's label and blurb rather than its own words", () => {
    expect(console_).toMatch(/\{a\.label\}/);
    expect(console_).toMatch(/\{a\.blurb\}/);
    expect(console_).toMatch(/caps\.data\.actions/);
  });

  it("hides what this operator may never do rather than disabling it", () => {
    /* A disabled button for something somebody will never be allowed to press
     * is a question with no answer. */
    expect(console_).toMatch(/\.filter\(\(a\) => a\.role !== "owner" \|\| caps\.data!\.you\.isOwner\)/);
  });
});

describe("the three things the screen was waiting for", () => {
  it("shows the day's remainder before the field, not after the refusal", () => {
    expect(console_).toMatch(/testID="grant-remainder"/);
    expect(console_).toMatch(/maxGrantPerDayCents - caps\.data\.limits\.grantedTodayCents/);
    /* And again inside the sheet, next to the amount. */
    expect(console_).toMatch(/testID="act-money-limits"/);
    expect(console_).toMatch(/left of today's allowance/);
  });

  it("names the person and the amount in the confirmation", () => {
    expect(console_).toMatch(/Put \$\{money\(cents\)\} on \$\{personName\}'s balance\?/);
    /* Not a bare "are you sure". */
    expect(console_).not.toMatch(/Are you sure/i);
  });

  it("requires the reason the server requires, and says why", () => {
    expect(console_).toMatch(/reason\.trim\(\)\.length < limits\.minReason/);
    expect(console_).toMatch(/indistinguishable from an intrusion/);
    expect(console_).toMatch(/reason: reason\.trim\(\)/);
  });
});

describe("the ceilings match the server's", () => {
  it("reads them from the route rather than restating the numbers", () => {
    /*
     * Only the two money ceilings are checked as absent literals. MAX_PASS_DAYS
     * is 14 and MIN_REASON is 8, and both are ordinary numbers in a stylesheet
     * — asserting those strings are absent fails on a padding value, which is
     * what the first version of this test did. The positive assertions below
     * are what actually hold those two.
     */
    for (const n of [MAX_GRANT_CENTS, MAX_GRANT_CENTS_PER_DAY]) {
      expect(console_, `${n} should be read from the route, not typed in`).not.toContain(String(n));
    }
    expect(console_).toMatch(/limits\.maxGrantCents/);
    expect(console_).toMatch(/limits\.maxGrantPerDayCents/);
    expect(console_).toMatch(/limits\.maxPassDays/);
    expect(console_).toMatch(/limits\.minReason/);
  });

  it("refuses before sending, for the same reasons the server refuses", () => {
    expect(console_).toMatch(/const tooMuch = needsMoney && \(cents > limits\.maxGrantCents \|\| cents > leftToday\)/);
    expect(console_).toMatch(/const tooLong = needsDays && \(dayCount < 1 \|\| dayCount > limits\.maxPassDays\)/);
    expect(console_).toMatch(/disabled=\{reasonShort \|\| tooMuch \|\| tooLong \|\| \(needsMoney && cents <= 0\)\}/);
  });

  it("says which ceiling was hit rather than only that one was", () => {
    expect(console_).toMatch(/over the \$\{money\(limits\.maxGrantCents\)\} limit for a single action/);
    expect(console_).toMatch(/more than the \$\{money\(leftToday\)\} left in today's allowance/);
  });

  it("warns when an action cannot be undone", () => {
    expect(console_).toMatch(/!action\.reversible \?/);
    expect(console_).toMatch(/cannot be undone from the log/);
  });
});

describe("project actions are not pretended at", () => {
  it("only offers the ones whose subject is a person", () => {
    /* This screen has a person open, not a project. */
    expect(console_).toMatch(/\.filter\(\(a\) => a\.subject === "user"\)/);
  });

  it("says where the project ones are instead of leaving a hole", () => {
    expect(console_).toMatch(/are on the web console, which has the project open beside them/);
  });
});
