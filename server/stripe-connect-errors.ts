/**
 * Saying why a Stripe Connect call failed, rather than that it did.
 *
 * All three Connect routes used to answer `500 {"message":"Failed to create
 * connect account"}` whatever went wrong, and put the reason in the server
 * log. So somebody pressing "Connect a bank account" was told the setup
 * couldn't be opened and given nothing to act on — and the one cause that
 * actually happens is a configuration step on the platform's Stripe account
 * that nobody can guess at from a 500.
 *
 * Stripe's own messages are written for whoever has to fix it and carry no
 * secrets — "Only Stripe Connect platforms can work with other accounts" names
 * the problem exactly. They are passed through.
 */

/** A Stripe error, as far as we need to read one. */
interface StripeishError {
  type?: string;
  code?: string;
  message?: string;
  statusCode?: number;
}

/**
 * The one that actually happens: a platform whose Stripe account has never had
 * Connect switched on. Creating an Express account is the first call that
 * needs it, so this is where it surfaces — usually the first time anybody
 * tries to take money out.
 */
export function isConnectNotEnabled(err: unknown): boolean {
  const message = String((err as StripeishError)?.message ?? "");
  return /connect|platform/i.test(message) && /sign(ed)? up|enable|not (a )?(valid )?platform|only stripe connect/i.test(message);
}

export interface ConnectFailure {
  status: number;
  body: { message: string; code: string; detail?: string };
}

/** Stripe's error objects carry a `type` like "invalid_request_error". */
const isStripeError = (err: unknown): boolean =>
  typeof (err as StripeishError)?.type === "string" && /_error$/.test((err as StripeishError).type!);

/**
 * What to answer when a Connect call throws.
 *
 * `what` is the thing that was being attempted, in words a person would use:
 * it becomes the first half of the sentence they read.
 */
export function connectFailure(err: unknown, what: string): ConnectFailure {
  const message = (err as StripeishError)?.message;

  if (isConnectNotEnabled(err)) {
    return {
      status: 503,
      body: {
        message:
          "Bank payouts aren't finished being set up on this server yet. Stripe Connect has to be " +
          "switched on for the platform account before anyone can connect a bank.",
        code: "connect_not_enabled",
        detail: message,
      },
    };
  }

  /*
   * Anything else Stripe refused. Its message is the useful part and is safe
   * to pass on. A failure that isn't Stripe's at all gets the generic line,
   * because that one could be anything — including something we should not
   * be repeating to a browser.
   */
  return {
    status: 502,
    body: isStripeError(err) && message
      ? { message: `${what}: ${message}`, code: "stripe_refused" }
      : { message: `${what}. The server log has the detail.`, code: "stripe_refused" },
  };
}
