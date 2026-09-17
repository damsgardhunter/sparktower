/**
 * The vocabulary both sides of the reset flow speak.
 *
 * The server decides what happened and the two reset pages decide what to show
 * — which means the codes and the expiry have to agree across a network
 * boundary. They were string literals on one side and hardcoded prose on the
 * other, which holds right up until someone changes the window to fifteen
 * minutes and the page keeps promising an hour.
 */

/** How long a reset link lives. Long enough to find the mail, short enough that a forwarded inbox isn't a standing key. */
export const RESET_TTL_MINUTES = 60;

/** Why a reset didn't happen. `invalid` covers unknown, already-spent, and a link for an address the account no longer has. */
export const RESET_FAILURES = ["invalid", "expired", "invalid_input", "breached_password"] as const;
export type ResetFailure = (typeof RESET_FAILURES)[number];

/** For copy: "expires in an hour" reads better than "expires in 60 minutes", and both come from one number. */
export function resetWindowPhrase(minutes: number = RESET_TTL_MINUTES): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "an hour" : `${hours} hours`;
  }
  return `${minutes} minutes`;
}
