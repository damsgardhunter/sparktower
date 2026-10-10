/**
 * A step that is right for the route and wrong for the person on it.
 *
 * The self-funded roadmap carries "Retirement money, carefully" — a ROBS
 * rollover, a 401(k) loan, an early withdrawal. That is useful to a self-funder
 * who is open to it, and it is a debt plan handed to somebody who answered "no
 * debt" two weeks earlier in the same questionnaire.
 *
 * Route was the only thing the tree filtered on, so the two could not be told
 * apart. A founder who says "no debt" and gets a 401(k) loan in their plan
 * stops trusting the tool, and nothing else in the plan survives that.
 */
import { describe, it, expect } from "vitest";
import { resolveTree } from "@shared/phase-trees";

const milestoneIds = (route: string, constraints?: { debtOk?: boolean | null }) =>
  resolveTree("systemize_business" as any, "services", route, constraints)
    .flatMap((p) => p.milestones.map((m) => m.id));

describe("the self-funded roadmap, for somebody who will not borrow", () => {
  it("drops the retirement-money step", () => {
    expect(milestoneIds("self", { debtOk: false })).not.toContain("FUND.F3.3");
  });

  it("keeps it for a self-funder who would borrow", () => {
    expect(milestoneIds("self", { debtOk: true })).toContain("FUND.F3.3");
  });

  /*
   * Unanswered is not a refusal. Hiding options from somebody who never said no
   * is its own kind of guessing on their behalf.
   */
  it("keeps it when the question has not been answered", () => {
    expect(milestoneIds("self", { debtOk: null })).toContain("FUND.F3.3");
    expect(milestoneIds("self", {})).toContain("FUND.F3.3");
    expect(milestoneIds("self")).toContain("FUND.F3.3");
  });

  /* Only that step goes. The rest of self-funding is not about borrowing. */
  it("leaves the rest of the route alone", () => {
    const without = milestoneIds("self", { debtOk: false });
    const with_ = milestoneIds("self", { debtOk: true });
    expect(with_.filter((id) => !without.includes(id))).toEqual(["FUND.F3.3"]);
    for (const id of ["FUND.F1.1", "FUND.F2.1", "FUND.F3.1", "FUND.F3.2", "FUND.F4.1"]) {
      expect(without, `${id} has nothing to do with debt`).toContain(id);
    }
  });

  /*
   * The constraint does not reach across routes. Somebody who said no debt and
   * then chose debt anyway has changed their mind, and the route they picked is
   * the more recent answer.
   */
  it("does not strip a route the person deliberately chose", () => {
    const debtRoute = milestoneIds("debt", { debtOk: false });
    expect(debtRoute.length, "the debt roadmap is still a roadmap").toBeGreaterThan(0);
  });
});
