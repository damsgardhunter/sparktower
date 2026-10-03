/**
 * The sponsor's side of a challenge, on a phone.
 *
 * The founder's side was already there (`app/challenges.tsx`): browse, enter,
 * change or withdraw an entry. The company's side was not, so all seven of the
 * sponsor's routes in `server/challenge-routes.ts` had no phone caller — a
 * company could not see its own entries, let alone shortlist one.
 *
 * Two things here are compared against the server rather than asserted from
 * memory: the limits, which the phone restates, and the shape of the refusal
 * when a company cannot afford to post.
 */
import { describe, it, expect } from "vitest";
import * as webChallenges from "@shared/challenges";
import { CHALLENGE_FEE_CENTS as webFee } from "@shared/challenges-money";
import * as phone from "../../mobile/src/challenges";
import { readSource, withoutComments } from "../helpers/source-parity";

const tab = withoutComments(readSource("mobile/src/components/company/ChallengesTab.tsx"));
const screen = withoutComments(readSource("mobile/app/company/[id].tsx"));
const routes = readSource("server/challenge-routes.ts");

describe("the seven sponsor routes now have a caller", () => {
  const MUST_CALL: [string, RegExp][] = [
    ["the company's own challenges", /\/challenges`\)/],
    ["posting one", /\/challenges`, \{\s*method: "POST"/],
    ["changing one", /api\(base, \{ method: "PATCH"/],
    ["closing entries", /\$\{base\}\/close-entries`, \{ method: "POST"/],
    ["reading the entries", /\$\{base\}\/entries`\)/],
    ["judging an entry", /\$\{base\}\/entries\/\$\{entry\.id\}\/status`, \{ method: "POST"/],
    ["announcing the results", /\$\{base\}\/announce`, \{ method: "POST"/],
  ];

  for (const [what, pattern] of MUST_CALL) {
    it(`calls ${what}`, () => expect(tab).toMatch(pattern));
  }

  it("is on the screen, not just in a file", () => {
    expect(screen).toMatch(/value: "challenges"/);
    expect(screen).toMatch(/tab === "challenges" \? <ChallengesTab /);
  });
});

describe("the limits the phone states are the server's", () => {
  it("restates CHALLENGE_LIMITS exactly", () => {
    expect(phone.CHALLENGE_LIMITS).toEqual(webChallenges.CHALLENGE_LIMITS);
  });

  it("restates ENTRY_LIMITS exactly", () => {
    expect(phone.ENTRY_LIMITS).toEqual(webChallenges.ENTRY_LIMITS);
  });

  it("restates the statuses, in the same order", () => {
    expect(phone.CHALLENGE_STATUSES).toEqual(webChallenges.CHALLENGE_STATUSES);
    expect(phone.ENTRY_STATUSES).toEqual(webChallenges.ENTRY_STATUSES);
    expect(phone.JUDGED_STATUSES).toEqual(webChallenges.JUDGED_STATUSES);
  });

  it("restates the fee, so the sheet does not quote a price that has changed", () => {
    expect(phone.CHALLENGE_FEE_CENTS).toBe(webFee);
  });

  it("restates the disclaimer word for word", () => {
    expect(phone.CHALLENGE_DISCLAIMER).toBe(webChallenges.CHALLENGE_DISCLAIMER);
  });

  it("uses them in the form rather than hardcoding a number beside them", () => {
    expect(tab).toMatch(/maxLength=\{CHALLENGE_LIMITS\.title\.max\}/);
    expect(tab).toMatch(/maxLength=\{CHALLENGE_LIMITS\.brief\.max\}/);
    expect(tab).toMatch(/maxLength=\{CHALLENGE_LIMITS\.terms\.max\}/);
    expect(tab).toMatch(/maxLength=\{ENTRY_LIMITS\.feedback\.max\}/);
    expect(tab).toMatch(/CHALLENGE_LIMITS\.maxDeadlineDays/);
  });
});

describe("the money refusal is handled as the server actually sends it", () => {
  /*
   * This is the detail worth a test of its own. The app has a global paywall
   * that opens on a 402 — but only when the body says `payment_required`, and
   * this route answers `insufficient_balance`. A phone that assumed the paywall
   * would appear would swallow the one sentence that says what to do.
   */
  it("the server really does answer insufficient_balance, not payment_required", () => {
    const post = routes.slice(routes.indexOf('app.post("/api/companies/:id/challenges"'), routes.indexOf('app.patch("/api/companies/:id/challenges/:cid"'));
    expect(post).toMatch(/code: "insufficient_balance"/);
    expect(post).not.toMatch(/code: "payment_required"/);
  });

  it("the client only opens the paywall for payment_required", () => {
    const client = readSource("mobile/src/api/client.ts");
    expect(client).toMatch(/res\.status === 402 && parsed\?\.code === "payment_required"/);
  });

  it("so the tab shows the server's sentence instead", () => {
    expect(tab).toMatch(/errText\(e, "Couldn't post that\."\)/);
  });
});

describe("what it refuses to offer", () => {
  it("does not offer posting to an unverified company", () => {
    /* The server's own reason: a challenge is the surface where checking who is asking is the whole of the protection. */
    expect(tab).toMatch(/verifiedDomain/);
    expect(tab).toMatch(/mayRun && verified \?/);
  });

  it("gates posting and judging on the challenges power, and reading on nothing", () => {
    expect(tab).toMatch(/hasPower\(view\.me, "challenges"\)/);
    expect(tab).toMatch(/You can read the challenges and the entries/);
  });

  it("only lets an entry be judged while the challenge is being judged", () => {
    /* The server answers "Close entries before judging them." — better not to offer the tap. */
    expect(tab).toMatch(/challenge\.status !== "judging"/);
  });

  it("keeps withdrawn entries out of the list", () => {
    /* Somebody who withdrew left before the judging and is not told how it went. */
    expect(tab).toMatch(/status !== "withdrawn"/);
  });

  it("confirms closing entries and announcing, which are both one-way", () => {
    expect(tab).toMatch(/Close entries\?/);
    expect(tab).toMatch(/Announce the results\?/);
    expect(tab).toMatch(/the prize goes back to your balance/);
  });

  it("offers taking a shortlisting back, because the server allows it", () => {
    expect(phone.JUDGED_STATUSES).toContain("entered");
    expect(tab).toMatch(/judge\.mutate\("entered"\)/);
  });
});
