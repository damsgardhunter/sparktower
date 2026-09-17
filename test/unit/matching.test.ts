/**
 * The match scoring, on its own.
 *
 * These are statements about what the product should recommend, not about how
 * the arithmetic happens to work today — "someone you already know is not a
 * match" is a rule, and the weights are free to move under it.
 */
import { describe, it, expect } from "vitest";
import {
  scoreMatch, isMatchable, experienceOverlap, backgroundTerms, jaccardSimilarity,
  cofounderCompatibility, projectFit, defaultMatchReasons, matchFactors,
  MATCH_WEIGHTS, type MatchProfile, type MatchContext,
} from "@shared/matching";

const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({
  categories: [], rolesNeeded: [], mutualConnections: 0, builderIndex: 0, ...over,
});
const person = (profile: MatchProfile, context: Partial<MatchContext> = {}) => ({ profile, context: ctx(context) });

describe("who can be matched", () => {
  const base = { viewerId: "me", isOnboarded: true, relatedUserIds: new Set<string>() };

  it("never matches you with yourself", () => {
    expect(isMatchable("me", base)).toBe(false);
  });

  it("skips anyone who hasn't finished onboarding — there's nothing to match on", () => {
    expect(isMatchable("them", { ...base, isOnboarded: false })).toBe(false);
  });

  /*
   * The bug this whole module was pulled out for: connections were read and
   * then ignored, so the people you'd already added came back as your best
   * matches, forever, at 90-odd percent.
   */
  it("excludes someone you're already connected to", () => {
    expect(isMatchable("friend", { ...base, relatedUserIds: new Set(["friend"]) })).toBe(false);
  });

  it("excludes someone with a request open either way — the introduction is already in flight", () => {
    expect(isMatchable("pending", { ...base, relatedUserIds: new Set(["pending", "other"]) })).toBe(false);
  });

  it("still matches a stranger", () => {
    expect(isMatchable("stranger", { ...base, relatedUserIds: new Set(["friend"]) })).toBe(true);
  });
});

describe("overlap of stated skills", () => {
  it("is 1 for identical lists and 0 when one is empty", () => {
    expect(jaccardSimilarity(["React", "Node"], ["node", "react"])).toBe(1);
    expect(jaccardSimilarity(["React"], [])).toBe(0);
    expect(jaccardSimilarity(null, ["React"])).toBe(0);
  });

  it("ignores case and punctuation, so 'Node.js' and 'node.js' are the same skill", () => {
    expect(jaccardSimilarity(["Node.js"], ["node.js"])).toBe(1);
  });
});

describe("past experience", () => {
  const banker: MatchProfile = {
    headline: "Payments infrastructure",
    experience: [
      { title: "Senior Payments Engineer", company: "Stripe", skills: ["ledgers", "reconciliation"] },
      { title: "Backend Engineer", company: "Monzo" },
    ],
  };

  it("reads roles, employers and résumé skills into one vocabulary", () => {
    const terms = backgroundTerms(banker);
    expect(terms).toContain("payments");
    expect(terms).toContain("stripe");
    expect(terms).toContain("ledgers");
    // "Senior" is a title decoration, not a domain.
    expect(terms).not.toContain("senior");
  });

  it("counts portfolio work too", () => {
    expect(backgroundTerms({ portfolioProjects: [{ name: "Splitwise clone", technologies: ["Postgres"] }] }))
      .toEqual(expect.arrayContaining(["splitwise", "clone", "postgres"]));
  });

  it("finds two people with the same background even when their skill lists don't overlap", () => {
    const other: MatchProfile = {
      experience: [{ title: "Payments Lead", company: "Stripe", skills: ["reconciliation"] }],
    };
    expect(experienceOverlap(banker, other)).toBeGreaterThan(0.5);
  });

  it("is 0 when either side has no history to read", () => {
    expect(experienceOverlap(banker, { skills: ["React"] })).toBe(0);
  });

  /*
   * Scored against the smaller vocabulary, not the union: a ten-year résumé
   * should not be penalised for being long when matching a one-line one.
   */
  it("doesn't punish a long résumé for matching a short one", () => {
    const deep: MatchProfile = {
      experience: Array.from({ length: 12 }, (_, i) => ({ title: `Role ${i}`, company: `Company${i}`, skills: [`skill${i}`] })),
    };
    const shallow: MatchProfile = { experience: [{ title: "Role 0", company: "Company0", skills: ["skill0"] }] };
    expect(experienceOverlap(deep, shallow)).toBeGreaterThan(0.5);
  });
});

describe("working style", () => {
  it("is neutral, not zero, when nobody has answered the questions", () => {
    expect(cofounderCompatibility({}, {})).toBe(0.5);
  });

  it("rates complementary conflict styles above identical avoidant ones", () => {
    const complementary = cofounderCompatibility({ conflictStyle: "direct" }, { conflictStyle: "diplomatic" });
    const same = cofounderCompatibility({ conflictStyle: "avoidant" }, { conflictStyle: "avoidant" });
    expect(complementary).toBeGreaterThan(same);
  });
});

describe("project fit", () => {
  it("rewards a shared category", () => {
    const shared = projectFit(ctx({ categories: ["fintech"] }), ctx({ categories: ["fintech"] }));
    const apart = projectFit(ctx({ categories: ["fintech"] }), ctx({ categories: ["gaming"] }));
    expect(shared).toBeGreaterThan(apart);
  });

  it("rewards them not needing the role you need — that's a gap they can fill", () => {
    expect(projectFit(ctx({ rolesNeeded: ["designer"] }), ctx({ rolesNeeded: ["engineer"] })))
      .toBeGreaterThan(0);
  });
});

describe("the whole score", () => {
  it("never exceeds 100, even for two identical people", () => {
    const twin: MatchProfile = {
      skills: ["React", "Node"], interests: ["fintech"], experienceLevel: "expert",
      riskTolerance: "high", scheduleStyle: "flexible", conflictStyle: "collaborative",
      hoursPerWeek: 40, builderType: "both", speedVsPolish: "speed",
      headline: "Payments", experience: [{ title: "Payments Engineer", company: "Stripe" }],
    };
    const { score } = scoreMatch(
      person(twin, { categories: ["fintech"], mutualConnections: 10 }),
      person(twin, { categories: ["fintech"], mutualConnections: 10 }),
    );
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThan(80);
  });

  it("weights sum to 100, so a score reads as a percentage", () => {
    expect(Object.values(MATCH_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  /* The point of the background factor: a shared history beats a shared job title. */
  it("ranks someone with your background above someone with only your experience level", () => {
    const me: MatchProfile = {
      skills: ["Go"], experienceLevel: "expert",
      experience: [{ title: "Payments Engineer", company: "Stripe", skills: ["ledgers"] }],
    };
    const sameField: MatchProfile = {
      skills: ["Rust"], experienceLevel: "beginner",
      experience: [{ title: "Payments Engineer", company: "Adyen", skills: ["ledgers"] }],
    };
    const sameLevel: MatchProfile = { skills: ["Rust"], experienceLevel: "expert" };

    expect(scoreMatch(person(me), person(sameField)).score)
      .toBeGreaterThan(scoreMatch(person(me), person(sameLevel)).score);
  });

  it("reports every factor it used", () => {
    const factors = matchFactors(person({ skills: ["React"] }), person({ skills: ["React"] }));
    expect(Object.keys(factors).sort()).toEqual(Object.keys(MATCH_WEIGHTS).sort());
  });
});

describe("fallback reasons", () => {
  it("cites work history when that's what drove the match", () => {
    const reasons = defaultMatchReasons({
      skills: 0.1, interests: 0.1, experience: 0.5, background: 0.8,
      projects: 0, connections: 0, cofounder: 0.5, builder: 1,
    });
    expect(reasons.join(" ")).toMatch(/work history/i);
  });

  it("always gives something to show", () => {
    const reasons = defaultMatchReasons({
      skills: 0, interests: 0, experience: 0, background: 0,
      projects: 0, connections: 0, cofounder: 0, builder: 0,
    });
    expect(reasons.length).toBeGreaterThanOrEqual(2);
    expect(reasons.every((r) => r.length > 0)).toBe(true);
  });
});
