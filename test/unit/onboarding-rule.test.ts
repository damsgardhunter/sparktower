/**
 * What counts as a finished profile.
 *
 * This replaces a boolean column and a redirect. The redirect was doing two
 * jobs — routing people to the form, and incidentally keeping half-registered
 * accounts away from everything else — and only the first was ever written
 * down. No route on the server asked the question, so the second was done by
 * the client choosing not to make the request.
 *
 * Opening the product up to people who have not finished removes the first job
 * on purpose. So the rule has to be a rule, in one place, that both sides read
 * and neither can skip.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  missingOnboarding, onboardingComplete, onboardingPrompt, missingOnboardingLabels,
} from "@shared/onboarding";

const whole = {
  displayName: "Hunter Damsgard",
  skills: ["SQL", "Python"],
  hoursPerWeek: 20,
  riskTolerance: "moderate",
  scheduleStyle: "flexible",
};

describe("a finished profile", () => {
  it("is the five things matching actually reads", () => {
    expect(onboardingComplete(whole)).toBe(true);
    expect(missingOnboarding(whole)).toEqual([]);
  });

  /* Everything else onboarding asks for is useful and not load-bearing. */
  it("does not require a bio, interests, experience, a résumé or links", () => {
    expect(onboardingComplete({ ...whole, bio: null, interests: [], experience: [] } as any)).toBe(true);
  });

  it("asks for everything when there is no profile at all", () => {
    expect(missingOnboarding(null)).toHaveLength(5);
    expect(missingOnboarding(undefined)).toHaveLength(5);
    expect(onboardingComplete(null)).toBe(false);
  });

  /*
   * A form will happily send a name of spaces, and a column will happily store
   * it. It is not a name, and somebody matched against it sees a blank.
   */
  it("does not accept a name made of whitespace", () => {
    expect(onboardingComplete({ ...whole, displayName: "   " })).toBe(false);
    expect(missingOnboarding({ ...whole, displayName: "" })).toEqual(["displayName"]);
  });

  it("does not accept an empty skill list, or a list of empty strings", () => {
    expect(onboardingComplete({ ...whole, skills: [] })).toBe(false);
    expect(onboardingComplete({ ...whole, skills: ["", "  "] })).toBe(false);
    expect(onboardingComplete({ ...whole, skills: ["", "SQL"] }), "one real skill is enough").toBe(true);
  });

  /*
   * Zero hours is what an emptied number input coerces to, and it is also a
   * real answer. Treated as unanswered: the matcher reads it as a quantity,
   * and somebody with no hours is not looking for a co-founder.
   */
  it("treats zero hours as unanswered", () => {
    expect(onboardingComplete({ ...whole, hoursPerWeek: 0 })).toBe(false);
    expect(onboardingComplete({ ...whole, hoursPerWeek: null })).toBe(false);
    expect(onboardingComplete({ ...whole, hoursPerWeek: 1 })).toBe(true);
  });

  it("needs both of the working-style answers", () => {
    expect(missingOnboarding({ ...whole, riskTolerance: null })).toEqual(["riskTolerance"]);
    expect(missingOnboarding({ ...whole, scheduleStyle: null })).toEqual(["scheduleStyle"]);
  });

  it("reports what is missing in the order the form asks for it", () => {
    expect(missingOnboarding({ displayName: null, skills: null, hoursPerWeek: null, riskTolerance: null, scheduleStyle: null }))
      .toEqual(["displayName", "skills", "hoursPerWeek", "riskTolerance", "scheduleStyle"]);
  });
});

/*
 * The sentence somebody reads. Named rather than counted: "add your name and
 * at least one skill" can be acted on, "2 fields remaining" has to be decoded
 * first, and the decoding is where people are lost.
 */
describe("what the banner says", () => {
  it("says nothing when there is nothing left", () => {
    expect(onboardingPrompt(whole)).toBeNull();
  });

  it("names a single missing thing", () => {
    expect(onboardingPrompt({ ...whole, skills: [] })).toBe("Add at least one skill to finish setting up your profile.");
  });

  it("lists several readably, rather than as a count", () => {
    const prompt = onboardingPrompt({ ...whole, displayName: "", skills: [] });
    expect(prompt).toBe("Add your name and at least one skill to finish setting up your profile.");
    expect(prompt).not.toMatch(/\d/);
  });

  it("uses commas and an 'and' for three or more", () => {
    expect(onboardingPrompt(null))
      .toBe("Add your name, at least one skill, how many hours a week you have, how you feel about risk and how you like your time structured to finish setting up your profile.");
  });

  it("labels every requirement, so nothing can go missing unnamed", () => {
    expect(missingOnboardingLabels(null)).toHaveLength(missingOnboarding(null).length);
    for (const label of missingOnboardingLabels(null)) expect(label.trim().length).toBeGreaterThan(0);
  });
});

/**
 * The rule and the form that satisfies it.
 *
 * These drifted apart once already and the failure was expensive to read. The
 * rule became five profile fields; the form and the test fixtures still thought
 * "onboarded" meant the `isOnboarded` column, which `POST
 * /api/profile/complete-onboarding` sets without reading its body. Everything
 * answered 200. A dozen browser specs registered accounts that looked finished,
 * were not, and failed several screens later on a missing button — never at the
 * call that was lying.
 *
 * The expensive half of that is unfixable by a test: an endpoint that ignores
 * its body will always answer 200. The cheap half is this — if the rule asks
 * for something the form never asks for, nobody can finish onboarding at all,
 * by any route, and that is worth catching here rather than in production.
 *
 * Matched on the page source naming the field — as a registered input
 * (`name="x"`) or through the form object (`watch("x")`, `setValue("x", …)`,
 * which is how the skill chips are kept). A floor and not a proof: it says the
 * form touches each requirement, not that the control sits on a step somebody
 * is made to visit. The catastrophic case is the one where the field is absent
 * altogether, and that is what this catches.
 */
describe("the form asks for what the rule requires", () => {
  it("has a field for every required answer", () => {
    const page = readFileSync(join(__dirname, "..", "..", "client", "src", "pages", "onboarding.tsx"), "utf8");
    const asked = (field: string) =>
      page.includes(`name="${field}"`) ||
      new RegExp(`\\.(?:watch|setValue|getValues|trigger)\\(\\s*"${field}"`).test(page);
    const unasked = missingOnboarding(null).filter((field) => !asked(field));
    expect(unasked, `the rule requires these and the form never asks for them: ${unasked.join(", ")}`).toEqual([]);
  });
});
