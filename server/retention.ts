/**
 * Clearing out what has stopped meaning anything.
 *
 * The event stream and the limiter's hits have their own sweeps (analytics.ts,
 * moderation.ts). This is for the rest: spent credentials and finished ledger
 * rows that no code will read again and that nothing else deletes. They are
 * small tables, so the reason to clear them isn't disk — it's that a revoked
 * refresh token, a used sign-up link and a two-year-old payment event are all
 * records about a person, and keeping them after they can serve no purpose is
 * a choice nobody made on purpose.
 *
 * Deliberately kept: failed Stripe events (evidence of a payment that didn't
 * land), live tokens, and anything a person can still act on. Web sessions
 * aren't here — the session store prunes its own expired rows.
 */
import { and, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "./db";
import { emailVerificationTokens, mobileRefreshTokens, projectInvites, stripeEvents } from "@shared/schema";

/** A spent or expired sign-in link is no longer a credential; a week's grace for support questions. */
export const VERIFICATION_TOKEN_DAYS = 7;
/** A revoked or expired refresh token can't be exchanged; kept a month so "when did that device stop?" is answerable. */
export const REFRESH_TOKEN_DAYS = 30;
/** Stripe retries a delivery for three days; ninety is far past any redelivery this ledger must refuse. */
export const STRIPE_EVENT_DAYS = 90;
/** An invite that was accepted, revoked or has expired is finished business. */
export const INVITE_DAYS = 30;

const days = (n: number) => sql`now() - make_interval(days => ${n})`;
const countOf = (result: unknown) => (result as any)?.rowCount ?? 0;

export interface SweepCounts {
  verificationTokens: number;
  refreshTokens: number;
  stripeEvents: number;
  invites: number;
}

export async function sweepFinishedRecords(): Promise<SweepCounts> {
  const verification = await db.delete(emailVerificationTokens)
    .where(or(lt(emailVerificationTokens.expiresAt, days(VERIFICATION_TOKEN_DAYS)), lt(emailVerificationTokens.usedAt, days(VERIFICATION_TOKEN_DAYS))));

  const refresh = await db.delete(mobileRefreshTokens)
    .where(or(lt(mobileRefreshTokens.expiresAt, days(REFRESH_TOKEN_DAYS)), lt(mobileRefreshTokens.revokedAt, days(REFRESH_TOKEN_DAYS))));

  // Processed only: a failed event is the record of a payment that didn't land, and stays.
  const events = await db.delete(stripeEvents)
    .where(and(sql`${stripeEvents.status} = 'processed'`, isNotNull(stripeEvents.processedAt), lt(stripeEvents.processedAt, days(STRIPE_EVENT_DAYS))));

  const invites = await db.delete(projectInvites)
    .where(and(
      lt(projectInvites.createdAt, days(INVITE_DAYS)),
      or(isNotNull(projectInvites.acceptedAt), isNotNull(projectInvites.revokedAt), lt(projectInvites.expiresAt, sql`now()`)),
    ));

  return {
    verificationTokens: countOf(verification),
    refreshTokens: countOf(refresh),
    stripeEvents: countOf(events),
    invites: countOf(invites),
  };
}

export function startRetentionJobs(): void {
  const sweep = async () => {
    try {
      const n = await sweepFinishedRecords();
      const total = n.verificationTokens + n.refreshTokens + n.stripeEvents + n.invites;
      if (total > 0) {
        console.log(`[retention] Cleared ${n.verificationTokens} sign-up link(s), ${n.refreshTokens} device token(s), ${n.stripeEvents} processed payment event(s), ${n.invites} finished invite(s).`);
      }
    } catch (err) {
      console.error("[retention] Sweep failed:", err);
    }
  };
  // After the other sweeps, so a cold start isn't three queries deep at once.
  setTimeout(sweep, 150_000);
  setInterval(sweep, 24 * 60 * 60_000).unref();
}
