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

const OUTBOX_LIMIT = 50;
const outbox: (EmailMessage & { at: string; status: EmailResult["status"] })[] = [];

export const emailConfigured = () => !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM && process.env.NODE_ENV !== "test";

/** The most recent messages, newest first — for development and tests only. */
export const devOutbox = () => [...outbox].reverse();

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
