/**
 * The two doors into a region, and the guide that describes them.
 *
 * There are two ways to open one — marketing buys it (`targetCities`) or
 * operations announces it and the table votes (`expand`) — and they differ on
 * six axes. `docs/playing-your-own-season.md` teaches those differences as rules
 * of the game, so a number that drifts out of the engine and stays in the guide
 * is the product lying to somebody who read the instructions.
 *
 * It had drifted. The guide gave one floor, 15%, which is the *announced* door's;
 * a bought region is floored at 50% (`BOUGHT_REACH_FLOOR`). Its worked example —
 * "a brand of 20 reaches a third of it" — was therefore wrong for the door
 * available from period one, which is the one most people will find first. The
 * table in the guide is now the whole picture, and these tests are what keep it
 * one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { boughtReach, firstYearReach, BOUGHT_REACH_FLOOR, EXPANSION_DISCOUNT } from "@shared/simulation/world";
import { unlockYear } from "@shared/simulation/responsibilities";

const guide = readFileSync(join(__dirname, "..", "..", "docs", "playing-your-own-season.md"), "utf8");

describe("the ramp on a new region", () => {
  it("floors a bought region higher than an announced one", () => {
    /*
     * This is the asymmetry that makes the two doors a choice rather than one
     * door and a worse door. Buying is immediate, any region, nobody's
     * agreement, and it gets you half the region at worst; announcing is
     * cheaper and slower and can leave you with a seventh of it.
     */
    expect(boughtReach(0), "a bought region has a floor of its own").toBe(BOUGHT_REACH_FLOOR);
    expect(firstYearReach(0)).toBeLessThan(boughtReach(0));
  });

  it("lets brand carry both doors past their floors, at the same rate", () => {
    // Above the floor it is the same rule — `brand / 60` — through either door.
    const strong = 60;
    expect(firstYearReach(strong)).toBe(1);
    expect(boughtReach(strong)).toBe(1);
    expect(firstYearReach(45)).toBeCloseTo(0.75, 5);
    expect(boughtReach(45)).toBeCloseTo(0.75, 5);
  });

  it("gives the guide's worked example the number the engine gives", () => {
    /*
     * The example that was wrong. A brand of 20 is a third of the way to 60, so
     * an announced region is a third reached — and a bought one is half, because
     * the floor catches it.
     */
    expect(firstYearReach(20)).toBeCloseTo(1 / 3, 5);
    expect(boughtReach(20)).toBe(0.5);
    expect(guide, "the guide should state the bought floor").toContain("floor 50%");
    expect(guide, "and the announced floor beside it").toContain("floor 15%");
  });

  it("never reaches more than all of a region, or less than its floor", () => {
    for (const brand of [-10, 0, 1, 30, 59, 60, 120]) {
      expect(boughtReach(brand)).toBeGreaterThanOrEqual(BOUGHT_REACH_FLOOR);
      expect(boughtReach(brand)).toBeLessThanOrEqual(1);
      expect(firstYearReach(brand)).toBeGreaterThan(0);
      expect(firstYearReach(brand)).toBeLessThanOrEqual(1);
    }
  });
});

describe("what the guide promises about the two doors", () => {
  it("is right about when each one arrives", () => {
    /*
     * Marketing can buy a region in period one; operations cannot announce one
     * until year four. The guide used to say expansion "arrives in period four"
     * without that distinction, which is true of one door and not the other.
     */
    expect(unlockYear("cmo", "targetCities"), "buying a region is there from the start").toBe(1);
    expect(unlockYear("coo", "expand"), "announcing one is not").toBe(4);
    expect(guide).toContain("from period one");
    expect(guide).toContain("from period four");
  });

  it("is right that the slower door is the cheaper one", () => {
    expect(EXPANSION_DISCOUNT).toBeLessThan(1);
    const off = Math.round((1 - EXPANSION_DISCOUNT) * 100);
    expect(guide, `the discount is ${off}%, so the guide should say so`).toContain(`${off}% less`);
  });
});
