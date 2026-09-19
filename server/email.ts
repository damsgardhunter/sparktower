/**
 * Sending email — one function, three outcomes:
 *
 *  - "sent": RESEND_API_KEY and EMAIL_FROM are set, and Resend accepted it.
 *  - "logged": email isn't configured (or it's a test). The whole message is
 *    written to the log and kept in the dev outbox (GET /api/dev/outbox), so a
 *    flow that sends email can be tested end to end without deliverability.
 *  - "failed": configured, but the provider refused or couldn't be reached.
 *    The caller still has what it needs — an invite's link is shown either way.
 *
 * Never throws: an email is never the thing that fails a request.
 */
export interface EmailMessage { to: string; subject: string; text: string; html?: string; tag?: string }
export interface EmailResult { status: "sent" | "logged" | "failed"; id?: string; error?: string }

/**
 * How many messages the development outbox keeps.
 *
 * Fifty is plenty for a person clicking around a dev server, and far too few
 * for the test suite. Registering an account sends a confirmation link, the
 * helper that confirms it reads that link back out of here, and a worker
 * running several registration-heavy files sends well over fifty — so the
 * earliest links were evicted before anything read them and the tests failed
 * on `no verification email`, eight at a time, nowhere near whatever they were
 * actually checking.
 *
 * Under test the cap is large enough that a suite never outruns it. It stays
 * small elsewhere, because this is a debugging aid held in memory and a
 * long-lived dev server should not grow one.
 */
const OUTBOX_LIMIT = process.env.NODE_ENV === "test" ? 5_000 : 50;
const outbox: (EmailMessage & { at: string; status: EmailResult["status"] })[] = [];

export const emailConfigured = () => !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM && process.env.NODE_ENV !== "test";

/** The most recent messages, newest first — for development and tests only. */
export const devOutbox = () => [...outbox].reverse();

/**
 * Said once at boot, because the consequence is invisible and permanent.
 *
 * Confirming an address is what lets a new account post, comment, message or
 * invite (server/email-verification.ts). With no email configured, every link
 * goes to the log instead of the person, so everyone who signs up is stuck at
 * the door — the site looks fine, and no one who joins can do anything. That
 * is worth a line in the log, and in production it is worth a loud one.
 */
export function warnIfEmailUnconfigured(): void {
  if (emailConfigured()) return;
  const missing = [!process.env.RESEND_API_KEY && "RESEND_API_KEY", !process.env.EMAIL_FROM && "EMAIL_FROM"].filter(Boolean).join(" and ");
  if (process.env.NODE_ENV === "production") {
    console.error(
      `[email] ${missing} not set. Confirmation links cannot be delivered, so every new account will be unable to post, comment, message or invite. ` +
      "Set them, or people will sign up into a product they can't use.",
    );
    return;
  }
  console.log(`[email] ${missing} not set — confirmation and invite emails go to the server log and GET /api/dev/outbox.`);
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const record = (status: EmailResult["status"]) => {
    outbox.push({ ...message, at: new Date().toISOString(), status });
    if (outbox.length > OUTBOX_LIMIT) outbox.shift();
  };
  if (!emailConfigured()) {
    record("logged");
    if (process.env.NODE_ENV !== "test") {
      console.log(`[email] not configured (set RESEND_API_KEY and EMAIL_FROM) — would send:\n  to: ${message.to}\n  subject: ${message.subject}\n  ${message.text.replace(/\n/g, "\n  ")}`);
    }
    return { status: "logged" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text, ...(message.html ? { html: message.html } : {}), ...(message.tag ? { tags: [{ name: "kind", value: message.tag }] } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      record("failed");
      console.error(`[email] Resend refused (${res.status}):`, body?.message ?? body);
      return { status: "failed", error: String(body?.message ?? `HTTP ${res.status}`) };
    }
    record("sent");
    return { status: "sent", id: body?.id };
  } catch (err) {
    record("failed");
    console.error("[email] send failed:", (err as Error).message);
    return { status: "failed", error: (err as Error).message };
  }
}
