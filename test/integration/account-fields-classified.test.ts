/**
 * Every column on `users` is either somebody else's business or it isn't.
 *
 * `stripOthersAccountFields` in server/app.ts is the thing that decides, and it
 * works from a list. A list is the right mechanism — dozens of routes embed whole
 * account rows, and catching them centrally is what stopped the email, the
 * Stripe ids and the suspension state riding out on a project's owner card — but
 * a list has one failure mode: a column added to the schema is public by default,
 * silently, and nobody finds out.
 *
 * That has now happened twice. `appleId` was never added, so the stable per-app
 * identifier of anybody who signed in with Apple rode out on every embedded row,
 * while `googleId` beside it was covered. And `pushEnabled` was added to the
 * schema on 2026-10-02 and not here, by me, the day before this test was written.
 *
 * So the three sets below have to account for *every* column. Adding one to the
 * schema fails this test until somebody says which it is, which is the only
 * moment the question is cheap to answer.
 *
 * Under test/integration rather than test/unit despite touching no database:
 * importing `server/app` reaches `server/db`, which throws without DATABASE_URL,
 * and the unit config deliberately has none.
 */
import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { users } from "@shared/schema";
import { stripOthersAccountFields } from "../../server/app";
import { readSource } from "../helpers/source-parity";

/**
 * Credentials. Never sent to anybody, including the account holder, because
 * nothing legitimate reads them from a response.
 */
const NEVER_SENT = [
  "passwordHash", "mfaSecret", "mfaPendingSecret", "mfaLastStep",
];

/**
 * Fine on somebody else's row, because the product shows them: a name, a face,
 * when they joined, and whether the account is one the product plays rather than
 * a person who signed up (`isBot`, which renders as a badge).
 */
const PUBLIC_ON_ANYONE = [
  "id", "firstName", "lastName", "profileImageUrl", "createdAt", "isBot",
];

/**
 * Theirs alone. Still sent on your *own* row — which is where the clients read
 * them — and stripped from anybody else's.
 */
const PRIVATE_TO_THEM = [
  // Identity and how they got in.
  "email", "authProvider", "googleId", "appleId", "emailVerifiedAt",
  // Money owed, money held, money spent, and where it goes.
  "stripeCustomerId", "stripeSubscriptionId", "stripeConnectAccountId", "subscriptionTier",
  "creditsUsed", "creditsResetAt", "balanceCents", "dayPassUntil", "payoutTarget",
  "devUnlimited", "novaActionsBought", "gamePlaysPaid", "imagePassUntil",
  "paymentFailedAt", "paymentFailureMessage", "subscriptionRefundedAt", "subscriptionEventAt",
  // Security posture — exactly what somebody picking an account to attack wants.
  "mfaEnabledAt", "accessTokensRevokedAt",
  // Standing: platform powers, suspension, closure.
  "platformRole", "suspendedAt", "suspendedReason", "deletedAt",
  // Where they came from, which is marketing data about a person.
  "signupSource", "signupMedium", "signupCampaign", "signupReferrer", "signupLandingPath", "signupParams",
  // Preferences and bookkeeping.
  "pushEnabled", "updatedAt",
];

const columns = Object.keys(getTableColumns(users)).sort();

describe("the account columns, classified", () => {
  it("accounts for every column exactly once", () => {
    const classified = [...NEVER_SENT, ...PUBLIC_ON_ANYONE, ...PRIVATE_TO_THEM];
    expect(new Set(classified).size, "a column is in two of the three sets").toBe(classified.length);

    const unclassified = columns.filter((c) => !classified.includes(c));
    expect(
      unclassified,
      "a new column on `users` is public on everybody's row until it is classified — decide here, and add it to PRIVATE_ACCOUNT_FIELDS in server/app.ts if it is theirs",
    ).toEqual([]);

    const stale = classified.filter((c) => !columns.includes(c));
    expect(stale, "these are classified but are no longer columns").toEqual([]);
  });

  /** A full row, as the dozens of routes that embed one would hand it over. */
  const theirRow = () => Object.fromEntries(columns.map((c) => [c, `value-of-${c}`])) as any;

  it("keeps nothing private when the row belongs to somebody else", () => {
    const seen = stripOthersAccountFields({ ...theirRow(), id: "them" }, { id: "me" });
    const leaked = PRIVATE_TO_THEM.filter((f) => f in seen);
    expect(leaked, "these would ride out on any embedded account row").toEqual([]);
  });

  it("keeps the public ones, so a name and a face still render", () => {
    const seen = stripOthersAccountFields({ ...theirRow(), id: "them" }, { id: "me" });
    for (const field of PUBLIC_ON_ANYONE) {
      if (field === "id") continue; // overwritten above
      expect(field in seen, `${field} should survive, or nobody's card has it`).toBe(true);
    }
  });

  it("keeps everything on your own row, which is where the clients read it", () => {
    /*
     * `payoutTarget`, `devUnlimited` and the credit counters are read by both
     * clients for the signed-in person. Stripping them from your own row would
     * break the earnings screen and the paywall.
     */
    const seen = stripOthersAccountFields({ ...theirRow(), id: "me" }, { id: "me" });
    for (const field of PRIVATE_TO_THEM) {
      expect(field in seen, `${field} should still reach its owner`).toBe(true);
    }
  });

  it("keeps everything for a reviewer, who is looking at accounts for a living", () => {
    const seen = stripOthersAccountFields({ ...theirRow(), id: "them" }, { id: "me", platformRole: "reviewer" });
    expect("email" in seen).toBe(true);
  });

  it("names the credentials in the set that never leaves the server", () => {
    /*
     * Read from the source rather than exercised, because `stripPasswordHash` is
     * not exported and should not be widened for a test. The set is a literal, so
     * reading it is enough to notice one going missing.
     */
    const app = readSource("server/app.ts");
    const set = app.match(/const NEVER_SENT = new Set\(\[([^\]]*)\]\)/);
    expect(set, "NEVER_SENT has moved").not.toBeNull();
    const named = [...set![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    for (const credential of NEVER_SENT) {
      expect(named, `${credential} must never leave the server`).toContain(credential);
    }
  });
});
