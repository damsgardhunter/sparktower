/**
 * Confirming a browser test's account, the way a person does it.
 *
 * Accounts start unconfirmed, and until the address is confirmed nothing they
 * write reaches another person (server/email-verification.ts). These tests
 * drive the real app over HTTP, so they read the link out of the development
 * outbox — the same place a developer looks when email isn't configured — and
 * follow it. No database shortcut: if the flow changes, these fail.
 */
import { expect, type APIRequestContext } from "@playwright/test";

/** Confirms `email`, or the newest unconfirmed address this context was sent a link for. */
export async function verifyEmail(api: APIRequestContext, email?: string): Promise<void> {
  const outbox = await api.get("/api/dev/outbox");
  expect(outbox.ok(), "the development outbox should be readable in tests").toBeTruthy();
  const { messages } = await outbox.json() as { messages: { to: string; text: string; tag?: string }[] };
  // The outbox comes back newest first, so the first match is the link just sent.
  const mail = messages.find((m) => m.tag === "verify-email" && (!email || m.to === email));
  const token = /verify-email\?token=([^\s&]+)/.exec(mail?.text ?? "")?.[1];
  expect(token, `no verification email for ${email ?? "the account just created"}`).toBeTruthy();
  const res = await api.post("/api/auth/verify-email", { data: { token } });
  expect(res.ok(), `confirming ${email ?? mail?.to}`).toBeTruthy();
}
