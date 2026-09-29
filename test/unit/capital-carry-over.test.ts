/**
 * The money questions asked first, counting toward the score they were asked for.
 *
 * The Systemize path opens with six questions about cash, credit and
 * experience (`SYS.F1.1`). The fundability score reads a fuller set asked
 * later (`FUND.C1.x`). Nothing joined them, so a builder could answer all six
 * in their first minute and watch the Fundability card say "Not fundable yet —
 * not answered yet" against every part, then be asked the same three subjects
 * again further down the path.
 */
import { describe, it, expect } from "vitest";
import {
  capitalAnswersFromMoneyPosition, mergeCapitalAnswers, capitalProfile,
  MONEY_TODAY_QUESTIONS, EXPERIENCE_QUESTIONS,
} from "../../shared/capital";
import { MONEY_POSITION_QUESTIONS } from "../../shared/phase-trees/systemize";

/** Every option the opening questions offer, so the mapping can't quietly miss one. */
const optionsOf = (questions: typeof MONEY_POSITION_QUESTIONS, id: string) =>
  questions.find((q) => q.id === id)?.options.map((o) => o.id) ?? [];

describe("carrying the opening money answers forward", () => {
  it("translates what it can into the words the score is written in", () => {
    const carried = capitalAnswersFromMoneyPosition({
      cash: ["25k_100k"], credit: ["740_plus"], assets: ["equipment", "home_equity"],
      experience: ["2_5"], monthly: ["3k_plus"], situation: ["running"],
    });
    expect(carried.money?.cash).toEqual(["25k_100k"]);
    expect(carried.money?.credit).toEqual(["740_799"]);
    expect(carried.money?.assets).toEqual(["equipment", "home_equity"]);
    expect(carried.experience?.industry_years).toEqual(["2_5"]);
  });

  it("only ever produces options the later questions actually offer", () => {
    for (const option of optionsOf(MONEY_POSITION_QUESTIONS, "cash")) {
      const cash = capitalAnswersFromMoneyPosition({ cash: [option] }).money?.cash?.[0];
      if (!cash) continue;  // deliberately untranslated ("Not sure yet")
      expect(optionsOf(MONEY_TODAY_QUESTIONS as any, "cash"), `cash "${option}" → "${cash}"`).toContain(cash);
    }
    for (const option of optionsOf(MONEY_POSITION_QUESTIONS, "credit")) {
      const credit = capitalAnswersFromMoneyPosition({ credit: [option] }).money?.credit?.[0];
      if (!credit) continue;
      expect(optionsOf(MONEY_TODAY_QUESTIONS as any, "credit"), `credit "${option}" → "${credit}"`).toContain(credit);
    }
    for (const option of optionsOf(MONEY_POSITION_QUESTIONS, "experience")) {
      const years = capitalAnswersFromMoneyPosition({ experience: [option] }).experience?.industry_years?.[0];
      if (!years) continue;
      expect(optionsOf(EXPERIENCE_QUESTIONS as any, "industry_years"), `experience "${option}" → "${years}"`).toContain(years);
    }
  });

  it("guesses at nothing — an unsure answer carries nothing forward", () => {
    expect(capitalAnswersFromMoneyPosition({ cash: ["unsure"] }).money?.cash).toBeUndefined();
    // "I've managed or owned one" is a role, not a number of years.
    expect(capitalAnswersFromMoneyPosition({ experience: ["managed"] }).experience).toBeUndefined();
    expect(capitalAnswersFromMoneyPosition(undefined)).toEqual({});
  });

  it("takes the lower band where one answer spans two of the later ones", () => {
    // Flattering somebody into an application they will fail is the worse error.
    expect(capitalAnswersFromMoneyPosition({ cash: ["250k_plus"] }).money?.cash).toEqual(["250k_500k"]);
    expect(capitalAnswersFromMoneyPosition({ credit: ["740_plus"] }).money?.credit).toEqual(["740_799"]);
  });

  it("lets the later, fuller answers win question by question", () => {
    const merged = mergeCapitalAnswers(
      { money: { cash: ["25k_100k"], credit: ["740_799"] } },
      { money: { cash: ["500k_plus"], income: ["100k_200k"] } },
    );
    expect(merged.money?.cash, "the later answer wins").toEqual(["500k_plus"]);
    expect(merged.money?.credit, "and the earlier one stays where there is no later one").toEqual(["740_799"]);
    expect(merged.money?.income).toEqual(["100k_200k"]);
  });

  it("does not let an unanswered later question erase what was already said", () => {
    const merged = mergeCapitalAnswers({ money: { cash: ["25k_100k"] } }, { money: { cash: [], income: ["30k_60k"] } });
    expect(merged.money?.cash).toEqual(["25k_100k"]);
  });

  it("moves the score, which is the whole point", () => {
    const nothing = capitalProfile({});
    const carried = capitalProfile(capitalAnswersFromMoneyPosition({
      cash: ["100k_250k"], credit: ["740_plus"], experience: ["5_plus"], assets: ["home_equity"],
    }));
    expect(nothing.score, "no answers, no score").toBe(0);
    expect(carried.score, "six answers in the first minute used to score zero").toBeGreaterThan(0);
  });
});
