/**
 * Finishing a test account's profile.
 *
 * Registration leaves a profile row with nothing in it — the shape a Google
 * sign-in arrives in — and `requireOnboarded` refuses the actions that put a
 * person in front of somebody else until five fields are filled: a name, a
 * skill, and the three questions about how they work.
 *
 * So a fixture that registers an account and then connects, messages, posts,
 * comments or enters a contest has to do this too. Before the rule existed
 * those routes asked nothing, which is exactly why so many fixtures stop here:
 * they are not wrong, they were written when there was nothing to satisfy.
 *
 * Written straight to the row rather than driven through the onboarding form,
 * because none of these tests are about the form.
 */
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { userProfiles } from "@shared/schema";

export async function finishOnboarding(userId: string, over: Record<string, unknown> = {}): Promise<void> {
  await db.update(userProfiles).set({
    displayName: "Test Person",
    skills: ["Shipping"],
    hoursPerWeek: 20,
    riskTolerance: "moderate",
    scheduleStyle: "flexible",
    ...over,
  } as any).where(eq(userProfiles.userId, userId));
}
