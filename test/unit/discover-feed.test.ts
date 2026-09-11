/**
 * The mobile Discover feed's rules, without a phone.
 *
 * The screen is a thin layer over `buildDiscoverFeed`; what's worth pinning
 * down is the order, the reason on every card, who never appears, and what
 * counts as new — the "New updates" banner is only as honest as that last one.
 */
import { describe, it, expect } from "vitest";
import { buildDiscoverFeed, projectReason, timeAgo, type MatchRow, type ProjectRow } from "../../mobile/src/discoverFeed";

const NOW = Date.parse("2026-09-10T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const match = (id: string, score: number, created = daysAgo(3), extra: Partial<MatchRow> = {}): MatchRow => ({
  id: `m-${id}`, matchedUserId: id, score, reasons: [`Reason for ${id}`], createdAt: created,
  matchedUser: { id, firstName: id.toUpperCase() }, matchedProfile: { headline: `${id} builds things`, skills: ["React"] }, ...extra,
});
const project = (id: string, created = daysAgo(10), extra: Partial<ProjectRow> = {}): ProjectRow => ({
  id, title: `Project ${id}`, ownerId: `owner-${id}`, createdAt: created, rolesNeeded: [], ...extra,
});

describe("the order", () => {
  it("interleaves two matched builders to one project, best match first", () => {
    const { items } = buildDiscoverFeed({
      matches: [match("b", 70), match("a", 90), match("c", 50)],
      projects: [project("p1", daysAgo(1)), project("p2", daysAgo(2))],
      now: NOW,
    });
    expect(items.map((i) => i.key)).toEqual(["builder:a", "builder:b", "project:p1", "builder:c", "project:p2"]);
  });

  it("never shows your own projects, private ones, or a match with no person behind it", () => {
    const { items } = buildDiscoverFeed({
      matches: [match("a", 90), { ...match("ghost", 99), matchedUser: null }],
      projects: [project("mine", daysAgo(1), { ownerId: "me" }), project("secret", daysAgo(1), { isPrivate: true }), project("open")],
      meId: "me",
      now: NOW,
    });
    expect(items.map((i) => i.key)).toEqual(["builder:a", "project:open"]);
  });
});

describe("the reason on every card", () => {
  it("uses Nova's reason for a match", () => {
    const [card] = buildDiscoverFeed({ matches: [match("a", 90)], projects: [], now: NOW }).items;
    expect(card.kind === "builder" && card.reason).toBe("Reason for a");
  });

  it("explains a project by a skill you have, then by being new, then by what it needs", () => {
    expect(projectReason(project("x", daysAgo(30), { rolesNeeded: ["Designer", "React"] }), ["react"], NOW)).toBe("Needs React — one of your skills");
    expect(projectReason(project("x", daysAgo(2)), [], NOW)).toBe("New this week");
    expect(projectReason(project("x", daysAgo(30), { rolesNeeded: ["Marketer"] }), [], NOW)).toBe("Looking for Marketer");
    expect(projectReason(project("x", daysAgo(30)), [], NOW)).toBe("Building in public");
  });

  it("marks projects you already follow, so Follow can't become an unfollow", () => {
    const { items } = buildDiscoverFeed({ matches: [], projects: [project("p1"), project("p2")], followed: new Set(["p2"]), now: NOW });
    const following = Object.fromEntries(items.map((i) => [i.key, i.kind === "project" && i.following]));
    expect(following).toEqual({ "project:p1": false, "project:p2": true });
  });
});

describe("what's new", () => {
  it("is nothing on a first visit", () => {
    const { newCount, items } = buildDiscoverFeed({ matches: [match("a", 90, daysAgo(0))], projects: [project("p", daysAgo(0))], lastSeen: null, now: NOW });
    expect(newCount).toBe(0);
    expect(items.every((i) => !i.isNew)).toBe(true);
  });

  it("is what arrived after you last looked — counted, flagged, and first", () => {
    const { newCount, items } = buildDiscoverFeed({
      matches: [match("old", 95, daysAgo(5)), match("fresh", 40, daysAgo(0.1))],
      projects: [project("p-old", daysAgo(9)), project("p-new", daysAgo(0.5))],
      lastSeen: daysAgo(1),
      now: NOW,
    });
    expect(newCount).toBe(2);
    // Newest first, ahead of a better but older match.
    expect(items.slice(0, 2).map((i) => i.key)).toEqual(["builder:fresh", "project:p-new"]);
    expect(items.slice(2).every((i) => !i.isNew)).toBe(true);
  });
});

describe("timeAgo", () => {
  it("stays short enough for the corner of a card", () => {
    expect(timeAgo(NOW - 20_000, NOW)).toBe("just now");
    expect(timeAgo(NOW - 5 * 60_000, NOW)).toBe("5m ago");
    expect(timeAgo(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
    expect(timeAgo(daysAgo(2), NOW)).toBe("2d ago");
    expect(timeAgo(daysAgo(30), NOW)).toBe("4w ago");
  });
});
