/**
 * Most routes now need a confirmed address (server/email-verification.ts), so
 * a test account has to click the link like a person does. This reads the link
 * out of the development outbox and follows it — no database shortcut, so a
 * change to the flow shows up here rather than being papered over.
 */
import request from "supertest";
import { expect } from "vitest";
import { devOutbox } from "../../server/email";

export async function verifyEmail(app: any, email: string, ip = "198.51.109.10"): Promise<void> {
  /*
   * Compared without case. The server stores and mails the address lowercased
   * (shared/email-address.ts), so a test that registers "inv-Founder@…" gets
   * its link sent to "inv-founder@…" — and an exact comparison found nothing,
   * failing every test whose address had a capital in it with "no
   * verification email", nowhere near what it was checking.
   */
  const wanted = email.trim().toLowerCase();
  const mail = devOutbox().find((m) => m.to?.toLowerCase() === wanted && m.tag === "verify-email");
  const token = /verify-email\?token=([^\s&]+)/.exec(mail?.text ?? "")?.[1];
  expect(token, `no verification email for ${email}`).toBeTruthy();
  const res = await request(app).post("/api/auth/verify-email").set("x-forwarded-for", ip).send({ token });
  /*
   * The raw text, because the interesting failures here have no JSON body.
   *
   * In long combined runs this occasionally answers 400 with a body that is
   * not JSON, so `res.body` is `{}` and the message says nothing. The token
   * row is inserted and awaited before the mail is queued, so a missing row
   * should not be possible; runs that show this have also shown an unrelated
   * three-minute test timeout, which points at the process being starved
   * rather than at this route. Printing what actually came back is what will
   * settle it.
   */
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(200);
}
