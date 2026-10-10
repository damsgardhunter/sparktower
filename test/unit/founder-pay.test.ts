/**
 * Founders are not charged salaries they never chose to pay.
 *
 * Two ways it happened: a solo founder (and any table built from somebody's own
 * project) drew a full executive salary from the first day, and every plan
 * Nova filed counted the founders into `headcount` — staff *beyond* the
 * founders — so a founder was charged a second salary for being themselves.
 */
import { describe, it, expect } from "vitest";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type Role } from "@shared/simulation/types";
import { fixedCosts, officerCost } from "@shared/simulation/decisions";
import { optimise } from "@shared/simulation/optimiser";
import { staffFor } from "@shared/simulation/workforce";

const niche = nicheById("dating_apps")!;

describe("what founders pay themselves", () => {
  it("is nothing when the season says they are unpaid", () => {
    const world = buildWorld({ seasonId: "pay", niche, teams: [{ id: "me", name: "Me", seats: [...ROLES] as Role[], officers: 1, foundersPaid: false }] });
    const me = world.companies.find((c) => c.id === "me")!;
    expect(me.officerPay).toBe(0);
    expect(officerCost(me)).toBe(0);
    expect(fixedCosts(me, 0, economyFor("pay", 1), 1, niche), "no staff, no salaries").toBe(0);
  });

  it("is a full salary where the chairs are jobs, as it always was", () => {
    const world = buildWorld({ seasonId: "pay", niche, teams: [{ id: "me", name: "Me", seats: [...ROLES] as Role[] }] });
    const me = world.companies.find((c) => c.id === "me")!;
    expect(officerCost(me)).toBeGreaterThan(0);
  });
});

describe("Nova's plan", () => {
  it("files only the staff the room needs beyond the founders — never the founders again", () => {
    for (const officers of [1, 5]) {
      const world = buildWorld({ seasonId: "pay", niche, teams: [{ id: "me", name: "Me", seats: [...ROLES] as Role[], officers }] });
      const plan = optimise({ world, companyId: "me", year: 1, economy: economyFor("pay", 1) })!;
      const room = plan.decisions.coo!.capacityTarget;
      expect(plan.decisions.coo!.headcount, `${officers} founder(s)`).toBe(staffFor(niche, room, officers));
    }
  });
});
