/**
 * The contests page has to ask for contests.
 *
 * A contest created in the admin tool existed in `contests`, was served by
 * `GET /api/contests`, and appeared nowhere — because the page rendered a
 * hardcoded announcement and a list of communities, and never called that
 * endpoint at all. Nothing was broken in the usual sense: the row was right,
 * the API was right, the page was right about everything it did do. The bug was
 * the absence of a request, and an absence is what no test notices.
 *
 * So this is the same technique the mobile tests use — read both halves and
 * fail when they disagree — applied to a page and the resource it exists to
 * show. It is deliberately about the wiring and not the markup: markup changes
 * every week, and "does this page fetch the thing it is named after" does not.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(import.meta.dirname, "../..", p), "utf8");
const page = read("client/src/pages/contests.tsx");

describe("the contests page", () => {
  it("asks the API for contests", () => {
    expect(page, "the page that lists contests must query /api/contests").toContain("/api/contests");
  });

  it("offers a way in, so a listed contest can be entered", () => {
    expect(page, "the join route exists; the page should use it").toMatch(/\/api\/contests\/\$\{[^}]+\}\/join/);
  });

  it("offers a way to file the work, which no client had", () => {
    /*
     * `POST /api/contests/:id/submit` existed from the beginning and nothing
     * called it — not this page, not the phone. Entering turned the button into a
     * disabled "Entered" and there was nowhere to put what you built.
     */
    expect(page).toMatch(/contests\/\$\{[^}]*\}\/submit/);
    expect(page).toContain("submissionUrl");
  });

  it("knows the difference between entered and filed", () => {
    /*
     * The page cannot offer to file without being told whether somebody already
     * has. `isParticipant` alone is what made this a dead end on both clients.
     */
    expect(page, "the page's Contest shape has to carry the viewer's entry").toMatch(/submission:\s*\{/);
  });

  it("does not offer to file a contest that has not opened", () => {
    /* Joining takes `upcoming`; submitting does not, so the button would 400. */
    const branch = page.match(/c\.isParticipant \?[\s\S]*?button-file-/);
    expect(branch, "the filing branch has moved").not.toBeNull();
    expect(branch![0]).toMatch(/c\.status === "active"/);
  });

  it("shows the server's own refusal rather than a shrug", () => {
    /*
     * Both contest mutations read the server's sentence now, through one helper:
     * the link is not a link, the contest is full, it has closed. Each is
     * actionable and "try again in a moment" throws it away.
     */
    expect(page).toContain("function serverMessage");
    const calls = [...page.matchAll(/serverMessage\(err\)/g)];
    expect(calls, "both entering and filing should say what the server said").toHaveLength(2);
  });

  /*
   * `judging` and `completed` contests are refused by the join route, so
   * listing them would be offering a door that answers 400.
   */
  it("lists the ones that are open to entries", () => {
    expect(page).toContain("active");
    expect(page).toContain("upcoming");
  });
});

/**
 * The $50 Billion Challenge, on hold.
 *
 * Asked for on 2026-10-01: off the contests page, not deleted. It is not a row
 * in `contests` — it is announcement copy in `lib/featured-contest.ts`, by its
 * own comment — so "on hold" means the page does not render its card, and
 * everything needed to bring it back is still here.
 *
 * Pinned in both directions on purpose. Re-adding the card is a decision
 * somebody should make deliberately rather than by merging a stale branch, and
 * deleting the copy would turn a hold into a loss.
 */
describe("the $50 Billion Challenge", () => {
  it("is not on the contests page", () => {
    /*
     * Rendered or imported, not merely mentioned — the comment at the top of
     * that page names the component to say it is on hold, and an earlier
     * version of this test matched its own explanation.
     */
    expect(page, "the card is still rendered; it is supposed to be on hold").not.toMatch(/<FeaturedContestCard\b/);
    expect(page, "the card is still imported").not.toMatch(/^import[^\n]*featured-contest-card/m);
  });

  it("is kept, so the hold is reversible", () => {
    const constant = read("client/src/lib/featured-contest.ts");
    expect(constant).toContain("50-billion");
    expect(constant).toContain("$50,000,000,000");
    expect(read("client/src/components/featured-contest-card.tsx"), "the card still exists to be re-rendered").toContain("FeaturedContestCard");
  });
});
