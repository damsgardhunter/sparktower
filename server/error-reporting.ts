/**
 * Where a 500 goes.
 *
 * Until this, an unexpected error was a `console.error` and nothing else: it
 * existed for as long as somebody was watching the log, and the failures that
 * matter are exactly the ones nobody is watching — the checkout that throws for
 * one card type, the nightly job that has been failing since Tuesday. You hear
 * about those from a user, late, or not at all.
 *
 * This is not an SDK. Adding Sentry means a dependency, an account and a DSN
 * before the first error is collected, and this codebase should be able to
 * report errors the day it is deployed anywhere. So:
 *
 *  - Every error becomes one structured line on stderr (`[error] {...}`), which
 *    any log drain — Papertrail, CloudWatch, Loki, `grep` — can pick up.
 *  - If `ERROR_WEBHOOK_URL` is set, the same record is POSTed there. A Slack
 *    incoming webhook, a Discord one, an alerting endpoint, or a Sentry store
 *    endpoint all accept a JSON body, so the choice is the operator's.
 *
 * What is deliberately never in a report: the request body, headers, cookies,
 * query string and raw URL. Those are where the passwords, tokens and personal
 * data are, and a monitoring service is one more place holding them. What a
 * report carries is the route *pattern*, the status, the error and its stack,
 * and the account id — enough to find it in the code and reproduce it, with
 * nothing anybody typed.
 *
 * Alerting is on a rate, not on an event: identical errors are folded into one
 * report per fingerprint per window, and the whole drain has a ceiling. A burst
 * that would page somebody a thousand times pages them once and says a thousand.
 */

/** A report the drain sends and the log prints. No caller data beyond ids. */
export interface ErrorReport {
  time: string;
  /** Error constructor name, e.g. "TypeError" — the fingerprint's first half. */
  kind: string;
  message: string;
  status: number;
  /** The route pattern ("/api/projects/:id"), never the URL that was called. */
  route?: string;
  method?: string;
  userId?: string;
  /** Top frames only: the tail is node internals and says nothing. */
  stack?: string;
  /** How many identical errors this one stands for, when folded. */
  count?: number;
  env: string;
  release?: string;
}

const WINDOW_MS = 5 * 60_000;
/** Identical errors inside a window: one report, with the count on it. */
const seen = new Map<string, { first: number; count: number }>();
/** The ceiling for the whole drain, so a storm can't become the outage. */
const MAX_PER_WINDOW = 60;
let windowStart = Date.now();
let sentThisWindow = 0;

/**
 * Anything in a message that looks like a credential or an address.
 *
 * Messages are written by us and by libraries, and libraries put the thing that
 * failed in the message: `invalid token sk_live_…`, `no user for a@b.com`. The
 * report is the last place to notice that, so it is noticed here.
 */
const SECRETS: [RegExp, string][] = [
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "<email>"],
  [/\b(sk|pk|rk|whsec|xoxb|ghp|gho|github_pat)_[A-Za-z0-9_-]{8,}/g, "<key>"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, "<jwt>"],
  [/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer <token>"],
  [/\b(postgres(ql)?|redis|mongodb(\+srv)?):\/\/[^\s"']+/gi, "<connection-string>"],
  [/\b[0-9a-f]{32,}\b/gi, "<hex>"],
];

export function redact(text: string): string {
  return SECRETS.reduce((s, [pattern, replacement]) => s.replace(pattern, replacement), text);
}

/** The first few frames, with the machine's own paths taken off the front. */
function trimStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const cwd = process.cwd();
  return stack
    .split("\n")
    .slice(0, 8)
    .map((line) => redact(line.split(cwd + "/").join("")))
    .join("\n");
}

/**
 * Identical-enough errors share a fingerprint: same kind, same route, and the
 * message with its numbers and ids taken out, so "project 7f3… not found" and
 * "project 91a… not found" are one thing rather than thousands.
 */
function fingerprint(report: ErrorReport): string {
  const shape = report.message.replace(/[0-9a-f]{8,}|\d+/gi, "#").slice(0, 120);
  return `${report.kind}|${report.method ?? ""} ${report.route ?? ""}|${shape}`;
}

export interface ErrorContext {
  /** The route pattern, not the URL. */
  route?: string;
  method?: string;
  userId?: string;
  status?: number;
}

/**
 * Report one error. Never throws, never awaits: a failure to report a failure
 * must not become a second failure, and the request is already answering.
 */
export function reportError(error: unknown, context: ErrorContext = {}): ErrorReport | null {
  const err = error as any;
  const status = context.status ?? err?.status ?? err?.statusCode ?? 500;
  // 4xx is the caller's mistake and belongs in the access log, not in alerts.
  if (status < 500) return null;

  const report: ErrorReport = {
    time: new Date().toISOString(),
    kind: String(err?.name ?? typeof error),
    message: redact(String(err?.message ?? error ?? "unknown error")).slice(0, 500),
    status,
    route: context.route,
    method: context.method,
    userId: context.userId,
    stack: trimStack(typeof err?.stack === "string" ? err.stack : undefined),
    env: process.env.NODE_ENV ?? "development",
    // Whichever the host sets: RENDER_GIT_COMMIT on Render, GITHUB_SHA in CI.
    release: process.env.RELEASE_SHA || process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || undefined,
  };

  const now = Date.now();
  if (now - windowStart > WINDOW_MS) { windowStart = now; sentThisWindow = 0; seen.clear(); }

  const key = fingerprint(report);
  const before = seen.get(key);
  if (before) {
    before.count += 1;
    // Already reported this one in this window; the count rides on the next window's report.
    return report;
  }
  seen.set(key, { first: now, count: 1 });

  console.error(`[error] ${JSON.stringify(report)}`);

  if (sentThisWindow >= MAX_PER_WINDOW) {
    if (sentThisWindow === MAX_PER_WINDOW) {
      sentThisWindow += 1;
      console.error(`[error] drain ceiling reached: further errors this window are logged, not sent`);
    }
    return report;
  }
  sentThisWindow += 1;
  void drain(report);
  return report;
}

/** POST the report, if there is somewhere to post it. Failures are swallowed by design. */
async function drain(report: ErrorReport): Promise<void> {
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `text` is what Slack and Discord read; the record is there in full for everything else.
      body: JSON.stringify({
        text: `${report.env} ${report.status} ${report.kind} on ${report.method ?? ""} ${report.route ?? "(no route)"}: ${report.message}`,
        ...report,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  } catch (err) {
    // One line, not a loop: reporting the reporter's failure through the reporter never ends.
    console.error("[error] could not reach ERROR_WEBHOOK_URL:", (err as any)?.message ?? err);
  }
}

/**
 * The two ways a Node process dies without any route being involved: a promise
 * nobody caught, and a throw outside every handler. Both used to be a silent
 * exit or a stack on a terminal nobody was looking at.
 *
 * Neither exits the process here. An uncaught exception leaves the process in
 * an unknown state and the textbook answer is to exit and let the supervisor
 * restart — but this server is often the only copy running, and a crash loop on
 * a background job is worse than a degraded one. The report is what makes it
 * visible either way.
 */
export function watchProcessErrors(): void {
  process.on("unhandledRejection", (reason) => {
    reportError(reason, { route: "(unhandled rejection)" });
  });
  process.on("uncaughtException", (error) => {
    reportError(error, { route: "(uncaught exception)" });
  });
}

/** Test seam: the fold and the ceiling are per-process state. */
export function resetErrorReporting(): void {
  seen.clear();
  windowStart = Date.now();
  sentThisWindow = 0;
}
