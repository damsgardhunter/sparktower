/**
 * Tests that act as a reviewer, admin or the platform owner need what the app
 * needs: a second factor on the session (server/mfa.ts). This enrols the
 * signed-in agent's account in 2FA through the real endpoints and leaves the
 * session verified — no bypass, the same path a person takes.
 */
import { expect } from "vitest";
import { timeStep, totpAt } from "../../server/totp";

export async function passMfa(agent: any): Promise<{ secret: string; recoveryCodes: string[] }> {
  const setup = await agent.post("/api/auth/mfa/setup").send({});
  expect(setup.status, JSON.stringify(setup.body)).toBe(200);
  const enable = await agent.post("/api/auth/mfa/enable").send({ code: totpAt(setup.body.secret, timeStep()) });
  expect(enable.status, JSON.stringify(enable.body)).toBe(200);
  return { secret: setup.body.secret, recoveryCodes: enable.body.recoveryCodes };
}

/** A code for a secret at a step offset from now (the next step, for a second sign-in in the same 30 seconds). */
export const codeFor = (secret: string, offset = 0) => totpAt(secret, timeStep() + offset);
