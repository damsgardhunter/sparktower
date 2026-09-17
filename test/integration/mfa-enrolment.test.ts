/**
 * Setting up two-factor authentication, from the enrolment screen's side.
 *
 * The part that decides whether people finish is the QR code: without it,
 * enrolment means hand-typing a thirty-two character key into a phone, and the
 * people most likely to give up are the ones being forced into 2FA because
 * they have admin access.
 *
 * What is pinned here is that the picture and the key are the same secret —
 * a QR encoding the wrong thing produces an authenticator that generates
 * confidently wrong codes forever, and the error appears at sign-in, days
 * later, with nothing pointing back at enrolment.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { totpAt, timeStep } from "../../server/totp";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function signedIn(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.130.${(n % 200) + 20}`;
  const email = `mfa-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip).send({ email, password: "a-good-passphrase-here", firstName: "Nat" });
  expect(res.status).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, email };
}

describe("starting 2FA setup", () => {
  it("returns a QR image alongside the key, both carrying the same secret", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app);

    const setup = await agent.post("/api/auth/mfa/setup").send({});
    expect(setup.status).toBe(200);

    const { secret, otpauthUrl, qrDataUrl } = setup.body;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);

    // A picture, and one a browser can render as an image rather than markup.
    expect(qrDataUrl, "no QR came back").toBeTruthy();
    expect(qrDataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(qrDataUrl.length).toBeGreaterThan(500);

    /*
     * The QR is drawn from this URL, so what the camera reads is what the
     * key says. Checked through the URL rather than by decoding the image:
     * the encoder is a dependency with its own tests, and the mistake worth
     * catching here is ours — drawing a different secret from the one stored.
     */
    expect(otpauthUrl).toContain(`secret=${secret}`);
    expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(otpauthUrl).toContain("issuer=SparkTower");
  }, 30_000);

  it("accepts a code generated from the key it handed out", async () => {
    // The whole round trip an authenticator app makes, in one assertion: take
    // the secret, generate the code, and the server turns 2FA on.
    const app = await getTestApp();
    const { agent } = await signedIn(app);
    const { secret } = (await agent.post("/api/auth/mfa/setup").send({})).body;

    const enabled = await agent.post("/api/auth/mfa/enable").send({ code: totpAt(secret, timeStep()) });
    expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
    expect(enabled.body.enabled).toBe(true);
    // Shown once, and the only way back in without the phone.
    expect(Array.isArray(enabled.body.recoveryCodes)).toBe(true);
    expect(enabled.body.recoveryCodes.length).toBeGreaterThan(0);
  }, 30_000);

  it("won't hand out a second secret once 2FA is on", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app);
    const { secret } = (await agent.post("/api/auth/mfa/setup").send({})).body;
    await agent.post("/api/auth/mfa/enable").send({ code: totpAt(secret, timeStep()) });

    const again = await agent.post("/api/auth/mfa/setup").send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("mfa_already_enabled");
  }, 30_000);
});
