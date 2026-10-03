/**
 * The two admin consoles the mobile survey never looked at.
 *
 * `docs/mobile-parity.md` tracked "four of the web's five missing admin
 * consoles" and concluded all five were on the phone. The table was built from
 * a chosen five and then reasoned about as if it were the whole set; listing
 * the web's admin pages instead turned up `admin-contests.tsx` and
 * `admin-promotions.tsx`, whose seven routes the phone called nowhere.
 */
import { describe, it, expect } from "vitest";
import * as webContests from "@shared/contests";
import { PROMO_HEADLINE_MAX, PROMO_PERK_MAX } from "@shared/promotions";
import * as phoneContests from "../../mobile/src/contests";
import * as phonePromotions from "../../mobile/src/promotions";
import { readSource, withoutComments } from "../helpers/source-parity";

const contests = withoutComments(readSource("mobile/app/admin/contests.tsx"));
const promotions = withoutComments(readSource("mobile/app/admin/promotions.tsx"));
const more = withoutComments(readSource("mobile/app/(tabs)/more.tsx"));

describe("the seven routes that had no phone caller", () => {
  const MUST_CALL: [string, string, RegExp][] = [
    ["listing the contests", "contests", /"\/api\/admin\/contests"\)/],
    ["making one", "contests", /"\/api\/admin\/contests", \{ method: "POST"/],
    ["editing one", "contests", /\/api\/admin\/contests\/\$\{contest\.id\}`, \{ method: "PUT"/],
    ["listing the promotions", "promotions", /"\/api\/admin\/promotions"\)/],
    ["editing one", "promotions", /\/api\/admin\/promotions\/\$\{row\.promotion\.id\}`, \{\s*method: "PUT"/],
    ["refreshing them all", "promotions", /"\/api\/admin\/promotions\/refresh", \{ method: "POST"/],
    ["refreshing one", "promotions", /\/api\/admin\/promotions\/\$\{id\}\/refresh`, \{ method: "POST"/],
  ];

  for (const [what, where, pattern] of MUST_CALL) {
    it(`calls ${what} (${where})`, () => {
      expect(where === "contests" ? contests : promotions).toMatch(pattern);
    });
  }

  it("reaches both from the More menu, or nobody can open them", () => {
    /* This is how they stayed missing: a screen with no row is unreachable. */
    expect(more).toMatch(/go\("\/admin\/contests"\)/);
    expect(more).toMatch(/go\("\/admin\/promotions"\)/);
    expect(more).toMatch(/testID="more-contests"/);
    expect(more).toMatch(/testID="more-promotions"/);
  });
});

describe("the limits are the server's", () => {
  it("restates the contest limits exactly", () => {
    expect(phoneContests.CONTEST_TITLE_MAX).toBe(webContests.CONTEST_TITLE_MAX);
    expect(phoneContests.CONTEST_DESCRIPTION_MAX).toBe(webContests.CONTEST_DESCRIPTION_MAX);
    expect(phoneContests.CONTEST_PRIZE_MAX).toBe(webContests.CONTEST_PRIZE_MAX);
    expect(phoneContests.CONTEST_CATEGORY_MAX).toBe(webContests.CONTEST_CATEGORY_MAX);
  });

  it("restates the contest vocabularies, in the same order", () => {
    expect(phoneContests.CONTEST_DIFFICULTIES).toEqual(webContests.CONTEST_DIFFICULTIES);
    expect(phoneContests.CONTEST_STATUSES).toEqual(webContests.CONTEST_STATUSES);
  });

  it("restates the two promotion limits", () => {
    expect(phonePromotions.PROMO_HEADLINE_MAX).toBe(PROMO_HEADLINE_MAX);
    expect(phonePromotions.PROMO_PERK_MAX).toBe(PROMO_PERK_MAX);
  });

  it("uses them in the form rather than a number typed beside them", () => {
    expect(contests).toMatch(/maxLength=\{CONTEST_TITLE_MAX\}/);
    expect(contests).toMatch(/maxLength=\{CONTEST_DESCRIPTION_MAX\}/);
    expect(promotions).toMatch(/maxLength=\{PROMO_HEADLINE_MAX\}/);
    expect(promotions).toMatch(/maxLength=\{PROMO_PERK_MAX\}/);
  });

  it("builds the pickers from the shared lists, not from literals", () => {
    expect(contests).toMatch(/options=\{CONTEST_DIFFICULTIES\}/);
    expect(contests).toMatch(/options=\{CONTEST_STATUSES\}/);
  });
});

describe("both are behind the same gate as every other admin screen", () => {
  it("uses useReviewer, gateView and blockedView", () => {
    for (const [name, src] of [["contests", contests], ["promotions", promotions]] as const) {
      expect(src, `${name} should gate like the others`).toMatch(/useReviewer\(\)/);
      expect(src).toMatch(/gateView\(/);
      expect(src).toMatch(/blockedView\(/);
      /* Not asked for at all until the gate says yes. */
      expect(src).toMatch(/enabled: isReviewer/);
    }
  });
});

describe("what the screens say that the server would otherwise have to", () => {
  it("warns about a perk with no link to claim it through", () => {
    /*
     * The server turns a perk into an offer only when a referral URL is also
     * stored, so a perk typed without one is saved and shows nobody anything.
     */
    /*
     * The condition, not the name. `const perkWithoutLink = false` keeps the
     * identifier and loses the warning, and an earlier version of this test
     * passed with exactly that — the presence-versus-usage trap this suite
     * exists to avoid.
     */
    expect(promotions).toMatch(/const perkWithoutLink = !!f\.perk\.trim\(\) && !f\.referralUrl\.trim\(\);/);
    expect(promotions).toMatch(/\{perkWithoutLink \?/);
    expect(promotions).toMatch(/an offer is only an offer with a link to claim it through/);
  });

  it("keeps the server's own wording when a contest is refused", () => {
    /* The backwards-window check matters most: such a contest behaves like one
     * that is permanently over and nobody can tell why from the page. */
    expect(contests).toMatch(/errText\(e, "Couldn't save that contest\."\)/);
  });

  it("will not submit a contest missing a field the server requires", () => {
    expect(contests).toMatch(/disabled=\{!f\.title\.trim\(\) \|\| !f\.description\.trim\(\) \|\| !f\.category\.trim\(\) \|\| !f\.startDate \|\| !f\.endDate\}/);
  });

  it("sends dates as ISO, which is what the route parses", () => {
    expect(contests).toMatch(/startDate: fromDay\(f\.startDate\)/);
    expect(contests).toMatch(/endDate: fromDay\(f\.endDate\)/);
  });
});
