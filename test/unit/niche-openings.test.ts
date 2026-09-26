/**
 * Niches a company goes and finds.
 *
 * A market is written with three or four segments, which is a useful lie:
 * real markets have dozens, and most did not exist until somebody went
 * looking. The claim worth holding is not "a new segment appears" but the
 * arithmetic around it — a niche is carved *out of* people who were already
 * there, it suits whoever found them because they were chosen for that, and
 * the run at them closes as everybody else notices.
 */
import { describe, it, expect } from "vitest";
import {
  nicheFor, withOpenedNiches, mergeSimilar, similarity,
  NICHE_LIMIT, NICHE_MAX_SHARE, NICHE_MIN_SHARE, SAME_NICHE_AT,
} from "@shared/simulation/niche-openings";
import { appealFor, headStartAgainst, NICHE_HEAD_START_YEARS } from "@shared/simulation/market";
import { startingCompany } from "@shared/simulation/season";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type Company } from "@shared/simulation/types";

const niche = nicheById("dating_apps")!;
const parent = niche.segments[0];
const base = () => startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] });
const distinctive = (): Company => ({ ...base(), quality: 82, brand: 10, service: 28 });
const middling = (): Company => ({ ...base(), quality: 50, brand: 50, service: 50 });

describe("what going looking finds", () => {
  it("takes its people from the segment they were already in", () => {
    const found = nicheFor({ company: distinctive(), parent, year: 5 });
    const after = withOpenedNiches(niche, [found]);
    const before = niche.segments.reduce((sum, s) => sum + s.size, 0);
    const now = after.segments.reduce((sum, s) => sum + s.size, 0);
    // Within rounding: opening a niche does not invent buyers.
    expect(Math.abs(now - before)).toBeLessThan(after.segments.length + 1);
  });

  it("finds more for a company that is actually distinctive", () => {
    const sharp = nicheFor({ company: distinctive(), parent, year: 5 });
    const bland = nicheFor({ company: middling(), parent, year: 5 });
    expect(sharp.share).toBeGreaterThan(bland.share);
    expect(bland.share).toBeGreaterThanOrEqual(NICHE_MIN_SHARE);
    expect(sharp.share).toBeLessThanOrEqual(NICHE_MAX_SHARE);
  });

  it("finds people who want what that company already has", () => {
    const company = distinctive();
    const found = nicheFor({ company, parent, year: 5 });
    const after = withOpenedNiches(niche, [found]);
    const mine = after.segments.find((s) => s.id === found.id)!;
    // Strong on quality, weak on brand — so the people found care more about
    // the first and less about the second than the segment they came from.
    expect(mine.qualityFocus).toBeGreaterThan(parent.qualityFocus);
    expect(mine.brandFocus).toBeLessThan(parent.brandFocus);
    expect(appealFor(company, mine)).toBeGreaterThan(appealFor(company, parent));
  });

  it("never carves away most of a segment, however many niches are found in it", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      nicheFor({ company: { ...distinctive(), id: `c${i}`, name: `C${i}` }, parent, year: 5 }));
    const after = withOpenedNiches(niche, many);
    const left = after.segments.find((s) => s.id === parent.id)!;
    expect(left.size / parent.size, "most of a segment was never looking for anything").toBeGreaterThan(0.35);
  });

  it("ignores a niche whose segment is not in this market", () => {
    const orphan = { ...nicheFor({ company: distinctive(), parent, year: 5 }), parentId: "not_a_segment" };
    expect(withOpenedNiches(niche, [orphan]).segments).toHaveLength(niche.segments.length);
  });

  it("changes nothing when nobody has found anything", () => {
    expect(withOpenedNiches(niche, [])).toBe(niche);
    expect(withOpenedNiches(niche, undefined)).toBe(niche);
  });

  it("stops at the limit rather than turning a market into a list", () => {
    const lots = Array.from({ length: NICHE_LIMIT + 8 }, (_, i) =>
      nicheFor({ company: { ...distinctive(), id: `c${i}`, name: `C${i}` }, parent, year: 5 }));
    const after = withOpenedNiches(niche, lots);
    expect(after.segments.length).toBeLessThanOrEqual(niche.segments.length + NICHE_LIMIT);
  });
});

describe("the run at them, and how it closes", () => {
  const found = nicheFor({ company: distinctive(), parent, year: 5 });
  const mine = withOpenedNiches(niche, [found]).segments.find((s) => s.id === found.id)!;
  const rival = { ...base(), id: "rival" };

  it("is a real advantage the year it is found", () => {
    expect(headStartAgainst(mine, distinctive(), 5), "never against the company that found them").toBe(1);
    expect(headStartAgainst(mine, rival, 5)).toBeLessThan(1);
  });

  it("fades, and is gone once everybody has noticed", () => {
    const years = [0, 1, 2].map((n) => headStartAgainst(mine, rival, 5 + n));
    expect(years).toEqual([...years].sort((a, b) => a - b));
    expect(headStartAgainst(mine, rival, 5 + NICHE_HEAD_START_YEARS)).toBe(1);
    expect(headStartAgainst(mine, rival, 20)).toBe(1);
  });

  it("does not exist on a segment the market was written with", () => {
    expect(headStartAgainst(parent, rival, 6)).toBe(1);
  });

  it("is nothing at all when nobody said what year it is", () => {
    expect(headStartAgainst(mine, rival, undefined)).toBe(1);
  });
});

/**
 * Two tables, one idea.
 *
 * Teams in the same season look at the same market, and the good ideas in it
 * are not infinite. Left alone, each would be handed a private corner and a
 * head start against somebody standing in the same place — which is the same
 * niche twice, and nonsense to anybody who met the other team.
 */
describe("when two tables find the same people", () => {
  const twin = (id: string, year = 5) => nicheFor({ company: { ...distinctive(), id, name: id }, parent, year });
  const unlike = (id: string, year = 5) =>
    nicheFor({ company: { ...base(), id, name: id, quality: 20, brand: 85, service: 70 }, parent, year });

  it("calls them the same when they want the same things", () => {
    expect(similarity(twin("a"), twin("b"))).toBeGreaterThanOrEqual(SAME_NICHE_AT);
  });

  it("does not call them the same when they want different things", () => {
    expect(similarity(twin("a"), unlike("b"))).toBeLessThan(SAME_NICHE_AT);
  });

  it("never calls two niches in different segments the same", () => {
    const elsewhere = nicheFor({ company: distinctive(), parent: niche.segments[1], year: 5 });
    expect(similarity(twin("a"), elsewhere)).toBe(0);
  });

  it("folds them into one, and whoever was first keeps the naming", () => {
    const merged = mergeSimilar([twin("first", 5), twin("second", 7)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].openedBy).toBe("first");
    expect(merged[0].alsoFoundBy?.map((a) => a.companyId)).toEqual(["second"]);
  });

  it("leaves genuinely different corners alone", () => {
    expect(mergeSimilar([twin("a"), unlike("b")])).toHaveLength(2);
  });

  it("gives neither of them a head start on the other", () => {
    const merged = mergeSimilar([twin("first", 5), twin("second", 5)]);
    const seg = withOpenedNiches(niche, merged).segments.find((sg) => sg.id === merged[0].id)!;
    expect(headStartAgainst(seg, { ...base(), id: "first" }, 5)).toBe(1);
    expect(headStartAgainst(seg, { ...base(), id: "second" }, 5)).toBe(1);
    // And everybody else still has to catch up.
    expect(headStartAgainst(seg, { ...base(), id: "outsider" }, 5)).toBeLessThan(1);
  });

  it("finds a few more of them than either would alone, but not twice as many", () => {
    const [one] = mergeSimilar([twin("a", 5)]);
    const [both] = mergeSimilar([twin("a", 5), twin("b", 6)]);
    expect(both.share).toBeGreaterThan(one.share);
    expect(both.share).toBeLessThan(one.share * 2);
    expect(both.share).toBeLessThanOrEqual(NICHE_MAX_SHARE);
  });

  it("does not fold a company into its own niche twice", () => {
    const merged = mergeSimilar([twin("a", 5), twin("a", 6), twin("b", 7)]);
    const owners = merged.flatMap((m) => [m.openedBy, ...(m.alsoFoundBy ?? []).map((x) => x.companyId)]);
    expect(new Set(owners).size).toBe(owners.length);
  });
});
