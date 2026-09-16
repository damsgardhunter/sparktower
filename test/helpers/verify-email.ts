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
  const mail = devOutbox().find((m) => m.to === email && m.tag === "verify-email");
  const token = /verify-email\?token=([^\s&]+)/.exec(mail?.text ?? "")?.[1];
  expect(token, `no verification email for ${email}`).toBeTruthy();
  const res = await request(app).post("/api/auth/verify-email").set("x-forwarded-for", ip).send({ token });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}
