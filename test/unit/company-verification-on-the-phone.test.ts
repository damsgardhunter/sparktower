/**
 * Proving a company owns its website, on a phone.
 *
 * Verification is what the rest of the company surface hangs off: an unverified
 * company keeps its people, its seasons and its recruiting, but cannot put a
 * challenge in front of strangers or approach anybody. The phone could say that
 * and could do nothing about it — all three of
 * `server/company-verification-routes.ts` and `POST /api/companies/:id/verify`
 * had no caller.
 */
import { describe, it, expect } from "vitest";
import { readSource, withoutComments } from "../helpers/source-parity";

const verify = withoutComments(readSource("mobile/src/components/company/VerifyDomain.tsx"));
const screen = withoutComments(readSource("mobile/app/company/[id].tsx"));
const shared = readSource("shared/company-verification.ts");

describe("the four routes that had no caller", () => {
  const MUST_CALL: [string, RegExp][] = [
    ["starting a verification", /"\/api\/company-verifications", \{ method: "POST"/],
    ["listing this person's verifications", /"\/api\/company-verifications"\)/],
    ["asking the server to go and look", /\/api\/company-verifications\/\$\{id\}\/check`, \{ method: "POST"/],
    ["attaching a proved domain to the company", /\/api\/companies\/\$\{companyId\}\/verify`, \{ method: "POST"/],
  ];
  for (const [what, pattern] of MUST_CALL) {
    it(`calls ${what}`, () => expect(verify).toMatch(pattern));
  }

  it("is reached from the company screen rather than only existing", () => {
    /* Rendered from the About tab, which the screen passes the company id and the notifier to. */
    expect(screen).toMatch(/<VerifyDomain companyId=\{companyId\} notify=\{notify\} \/>/);
    expect(screen).toMatch(/<About view=\{q\.data\} companyId=\{id!\} notify=\{show\} \/>/);
  });

  it("no longer tells somebody to go to the web", () => {
    /* The old About tab said "Verifying it is on the web". That was the gap. */
    expect(screen).not.toMatch(/Verifying it is on the web/);
    expect(screen).not.toMatch(/can verify it on the web/);
  });
});

describe("the instructions are the server's, not a second copy", () => {
  /*
   * The exact file path and record name live in shared/company-verification.ts
   * and arrive in the payload with the domain and token already substituted. A
   * phone that wrote its own copy would eventually show a path that is not the
   * one being checked, and the person would do everything right and still fail.
   */
  it("renders the steps the payload carries", () => {
    expect(verify).toMatch(/current\.steps\[method\]\.steps\.map\(/);
    expect(verify).toMatch(/current\.steps\[m\]\.title/);
  });

  it("writes neither the file path nor the DNS prefix itself", () => {
    expect(shared, "the server still owns these strings").toMatch(/VERIFICATION_PATH|VERIFICATION_DNS_PREFIX/);
    expect(verify).not.toMatch(/well-known/);
    expect(verify).not.toMatch(/_sparktower/);
  });

  it("offers both ways, because one of them is impossible on some setups", () => {
    expect(verify).toMatch(/\(\["file", "dns"\] as Method\[\]\)/);
  });
});

describe("what it does with a failed check", () => {
  it("treats it as the normal case and shows what the server saw", () => {
    /* "No TXT record at _sparktower.acme.com yet" is the difference between finishing and giving up. */
    expect(verify).toMatch(/current\.lastError \?/);
  });

  it("refetches after a failure, so the attempt count on screen is the real one", () => {
    const onError = verify.slice(verify.indexOf("const check = useMutation"));
    expect(onError.slice(0, 700)).toMatch(/onError: \(e\) => \{ void mine\.refetch\(\)/);
  });

  it("stops offering the check when the attempts are gone, and says what to do", () => {
    /* The server answers 429 "Start it again for a fresh one" — better not to spend a tap on it. */
    expect(verify).toMatch(/current\.attemptsLeft <= 0/);
    expect(verify).toMatch(/Start again for a fresh token/);
  });
});

describe("the things that stop somebody wasting an hour", () => {
  it("keeps the server's refusals, which are the reason to ask first", () => {
    /*
     * "acme.com is already verified by a company on SparkTower" and "that
     * doesn't look like a website" are both answers somebody acts on — said
     * before they go and edit DNS.
     */
    expect(verify).toMatch(/errText\(e, "Couldn't start that\."\)/);
  });

  it("makes the token copyable rather than something to read across devices", () => {
    expect(verify).toMatch(/Clipboard\.setStringAsync\(current\.token\)/);
    expect(verify).toMatch(/TAP TO COPY/);
  });

  it("leaves a spent verification out, because it cannot be reused", () => {
    expect(verify).toMatch(/all\.filter\(\(v\) => !v\.spent\)/);
  });

  it("says nothing more to do once the company is verified", () => {
    expect(verify).toMatch(/if \(company\.verifiedDomain\)/);
    expect(verify).toMatch(/Verified as \$\{company\.verifiedDomain\}/);
  });
});
