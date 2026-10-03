/**
 * What gets sent when a screen throws.
 *
 * Its own module, with no imports, for the usual two reasons: the test runner
 * cannot parse anything that reaches for React Native, and this is the one
 * payload in the app that leaves the device while something is already wrong —
 * which is exactly when nobody is watching what goes into it.
 *
 * Mirrors `client/src/components/error-boundary.tsx`'s `report`. The web gets the
 * path from `window.location.pathname`, which is query-free by construction; a
 * phone route is a string that may carry one, so the stripping here is a rule
 * rather than a formality.
 */

/** The ceilings the server applies anyway (`server/client-error-routes.ts`); applied here too so the request is small. */
export const ERROR_MESSAGE_MAX = 500;
export const ERROR_STACK_MAX = 4_000;
export const ERROR_COMPONENT_STACK_MAX = 2_000;
export const ERROR_PATH_MAX = 300;

export interface ErrorReportBody {
  message: string;
  stack: string;
  componentStack: string;
  where: string | null;
  path: string | null;
}

/**
 * A route reduced to a path, and never its query.
 *
 * An invite code, a password-reset token and whatever somebody typed into a
 * search all live in a query string, and this request is the one thing on its way
 * off the device at the moment of a crash. Same rule as
 * `shared/problem-reports.ts`'s `readProblemPath`, and the same refusal to send
 * anything that is not one of our own paths.
 */
export function errorReportPath(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  /*
   * Rejected the same way `safeReturnPath` rejects a return path: a protocol-
   * relative `//host` and a backslash form are both read as a host by browsers,
   * and both start with a slash.
   */
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  if (/[\u0000-\u001f]/.test(value)) return null;
  return value.split(/[?#]/)[0].slice(0, ERROR_PATH_MAX) || null;
}

/**
 * The body, built defensively.
 *
 * Every field is coerced rather than trusted: this runs inside a failure, and
 * `error` may be anything a `throw` can carry — a string, undefined, an object
 * with a getter that throws. A report that cannot be built is a crash inside a
 * crash handler, which is the one outcome worse than the crash.
 */
export function errorReportBody(error: unknown, componentStack: unknown, where: unknown, route: unknown): ErrorReportBody {
  /*
   * A thunk, not a value. The first version took the value — `read(error.stack,
   * …)` — which reads the property in the argument expression, *outside* the
   * try/catch that was supposed to protect it. A thrown object with a hostile or
   * merely unusual getter therefore threw before the guard was entered, which is
   * the crash-inside-the-crash-handler this function exists to avoid. Every read
   * of anything off `error` goes through here.
   */
  const read = (get: () => unknown, max: number): string => {
    try {
      return String(get() ?? "").slice(0, max);
    } catch {
      return "";
    }
  };
  return {
    message: read(() => (error as { message?: unknown })?.message ?? error, ERROR_MESSAGE_MAX),
    stack: read(() => (error as { stack?: unknown })?.stack, ERROR_STACK_MAX),
    componentStack: read(() => componentStack, ERROR_COMPONENT_STACK_MAX),
    where: typeof where === "string" && where ? where : null,
    path: errorReportPath(route),
  };
}
