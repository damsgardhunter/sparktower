/**
 * Finishing a browser test's profile, the way the app does it.
 *
 * `requireOnboarded` refuses the actions that put a person in front of somebody
 * else — connect, message, comment, post, contest, backing — until five fields
 * are filled: a name, a skill, and the three questions about how somebody works
 * (shared/onboarding.ts). Registration leaves all five empty, which is the
 * shape a Google sign-in arrives in.
 *
 * ## Why the fixtures that broke looked like they were already doing this
 *
 * They called `POST /api/profile/complete-onboarding` with a body —
 * `{ displayName, headline, bio }` — and that endpoint has never read its body.
 * It sets the `isOnboarded` column and nothing else. That was enough while the
 * column *was* the rule; it stopped being enough when the rule became the five
 * fields, and the endpoint kept answering 200 either way. So a dozen specs were
 * registering accounts that looked finished, were not, and failed several steps
 * later on a missing button rather than at the call that was lying.
 *
 * This posts the fields to `/api/profile` first, which is what the onboarding
 * form itself does, then marks it complete. Over HTTP and through the real
 * routes, so a change to either breaks these rather than drifting past them.
 *
 * ## It fills gaps and never overwrites
 *
 * Same reason as the unit-test helper: a spec that chose a display name is
 * asserting on it somewhere ("Bea Builder" in a notification), and a helper
 * that renames accounts produces failures that point anywhere but here.
 */
import { expect, type APIRequestContext } from "@playwright/test";

/** The five required answers, for a fixture that doesn't care which. */
const FILLER = {
  displayName: "Test Person",
  skills: ["Shipping"],
  hoursPerWeek: 20,
  riskTolerance: "moderate",
  scheduleStyle: "flexible",
} as const;

const filled = (v: unknown): boolean => {
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.some((s) => typeof s === "string" && s.trim().length > 0);
  if (typeof v === "number") return Number.isFinite(v) && v > 0;
  return v != null;
};

/**
 * Finishes onboarding for whoever `api` is signed in as.
 *
 * `over` wins outright — a spec passing `displayName` is naming that account on
 * purpose, and anything it names is also allowed to replace a stored value.
 */
export async function finishOnboarding(
  api: APIRequestContext,
  over: Record<string, unknown> = {},
): Promise<void> {
  const current = await api.get("/api/profile");
  const profile = current.ok() ? await current.json().catch(() => null) : null;

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(FILLER)) {
    if (!filled(profile?.[key])) patch[key] = value;
  }
  /* What the caller asks for wins, because it asked on purpose. */
  Object.assign(patch, over);

  if (Object.keys(patch).length) {
    const saved = await api.post("/api/profile", { data: patch });
    expect(saved.ok(), `saving the profile: ${saved.status()} ${await saved.text()}`).toBeTruthy();
  }

  const done = await api.post("/api/profile/complete-onboarding");
  expect(done.ok(), `marking onboarding complete: ${done.status()}`).toBeTruthy();
}
