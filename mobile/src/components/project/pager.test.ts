/**
 * The paging rules behind the project page's swipe, driven through the cases
 * that make a pager feel wrong: a blank page mid-swipe, a section that forgets
 * where you were, and nine sections all fetching at once on open.
 */
import { describe, it, expect } from "vitest";
import { indexFromOffset, mountedPages, pageIndex, tabAt } from "./pager";

const TABS = [
  { value: "overview" }, { value: "updates" }, { value: "roadmap" }, { value: "milestones" },
  { value: "team" }, { value: "roles" }, { value: "media" }, { value: "discussion" }, { value: "followers" },
] as const;

describe("a tab and its page", () => {
  it("maps both ways in PROJECT_TABS order", () => {
    expect(pageIndex(TABS, "overview")).toBe(0);
    expect(pageIndex(TABS, "media")).toBe(6);
    expect(tabAt(TABS, 6)).toBe("media");
  });

  it("sends an unknown tab to the first page", () => {
    // A stale `?tab=` link shouldn't open on a page that isn't there.
    expect(pageIndex(TABS, undefined)).toBe(0);
    expect(pageIndex(TABS, "files" as any)).toBe(0);
  });

  it("clamps a page past either end to a real tab", () => {
    // Overscroll reports offsets outside the pages; they still have to name a section.
    expect(tabAt(TABS, -1)).toBe("overview");
    expect(tabAt(TABS, 99)).toBe("followers");
  });
});

describe("reading the page out of a scroll offset", () => {
  it("rounds to the page the swipe landed on", () => {
    expect(indexFromOffset(0, 390, 9)).toBe(0);
    expect(indexFromOffset(390, 390, 9)).toBe(1);
    expect(indexFromOffset(760, 390, 9)).toBe(2); // a hair short of page 2, still page 2
  });

  it("survives a rubber-band and a width we don't know yet", () => {
    expect(indexFromOffset(-40, 390, 9)).toBe(0);
    expect(indexFromOffset(99999, 390, 9)).toBe(8);
    expect(indexFromOffset(120, 0, 9)).toBe(0); // before the first layout
  });
});

describe("which sections are in the tree", () => {
  it("opens with the first section and its neighbour, not all nine", () => {
    // Nine sections mounted at once is nine queries and a slow first frame.
    expect(mountedPages([], 0, 9)).toEqual([0, 1]);
  });

  it("keeps the neighbours mounted so a swipe never shows a blank page", () => {
    expect(mountedPages([], 4, 9)).toEqual([3, 4, 5]);
    expect(mountedPages([], 8, 9)).toEqual([7, 8]);
  });

  it("never lets a visited section go, so it remembers where you were", () => {
    // Team, scrolled halfway, then two swipes away: coming back has to land in
    // the same place rather than refetch and jump to the top.
    expect(mountedPages([0, 1, 4], 6, 9)).toEqual([0, 1, 4, 5, 6, 7]);
  });

  it("drops pages that no longer exist", () => {
    expect(mountedPages([0, 12], 1, 3)).toEqual([0, 1, 2]);
  });
});
