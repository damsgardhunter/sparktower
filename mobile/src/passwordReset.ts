/**
 * The words the password-reset flow speaks, on the phone.
 *
 * Mirrors shared/password-reset.ts (the window) and the `waitPhrase` half of
 * client/src/lib/api-error.ts (the cooldown), because this app can't import
 * from @shared. Both numbers are decided by the server: the token's life, and
 * how long until it will take another request. Copy that invents either of them
 * is copy that goes wrong the moment somebody changes a constant — "the link
 * expires in an hour" over a link that died in fifteen minutes is worse than
 * saying nothing at all.
 *
 * Kept apart from the screen so the phrasing can be tested without a renderer.
 */

/** How long a reset link lives. shared/password-reset.ts. */
export const RESET_TTL_MINUTES = 60;

/** For copy: "expires in an hour" reads better than "expires in 60 minutes", and both come from one number. */
export function resetWindowPhrase(minutes: number = RESET_TTL_MINUTES): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "an hour" : `${hours} hours`;
  }
  return `${minutes} minutes`;
}

/** The machine-readable code on every rate-limit refusal. shared/moderation.ts. */
export const RATE_LIMITED = "rate_limited";

/**
 * A wait, rounded to something a person would say. Never "0 seconds" and never
 * a precise count that invites watching a clock.
 */
export function waitPhrase(seconds: number): string {
  if (seconds < 55) return `about ${Math.max(1, Math.round(seconds / 5) * 5 || 1)} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
}

export interface ResetRefusal {
  /** What to show. */
  message: string;
  /** Seconds to disable the button for, or 0 when waiting isn't the answer. */
  cooldown: number;
}

/**
 * What to say when asking for a link fails.
 *
 * A rate limit is the one failure that must not be dressed up as success: the
 * endpoint answers the same way for every address precisely so it leaks
 * nothing, but a 429 means no mail was sent, and showing "check your inbox"
 * over it sends someone to wait for a message that will never arrive. Say when
 * instead, and take the server's own number for the when.
 */
export function resetRefusal(error: any, fallback = "Couldn't send that link. Try again in a moment."): ResetRefusal {
  const body = error?.body;
  if (body?.code === RATE_LIMITED) {
    const wait = Number(body.retryAfterSeconds) || 0;
    return {
      cooldown: wait,
      message: wait > 0
        ? `That's a few requests in a row. Try again in ${waitPhrase(wait)}.`
        : "That's a few requests in a row. Give it a minute and try again.",
    };
  }
  return { cooldown: 0, message: (typeof body?.message === "string" && body.message) || error?.message || fallback };
}
