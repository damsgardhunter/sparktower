import { expect, type APIRequestContext } from "@playwright/test";
import { timeStep, totpAt } from "../server/totp";

/**
 * Turns on 2FA for the signed-in account of a browser context, through the
 * real endpoints, with the code an authenticator app would show. The
 * context's session counts as verified afterwards, so reviewer, admin and
 * owner pages work in it (server/mfa.ts).
 */
export async function passMfa(api: APIRequestContext) {
  const setup = await api.post("/api/auth/mfa/setup", { data: {} });
  expect(setup.ok(), await setup.text()).toBeTruthy();
  const { secret } = await setup.json();
  const enabled = await api.post("/api/auth/mfa/enable", { data: { code: totpAt(secret, timeStep()) } });
  expect(enabled.ok(), await enabled.text()).toBeTruthy();
  return { secret: secret as string, recoveryCodes: (await enabled.json()).recoveryCodes as string[] };
}
