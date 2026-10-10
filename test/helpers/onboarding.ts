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
 * those routes asked nothing, which is why so many fixtures stop at
 * registration: they are not wrong, they were written when there was nothing
 * to satisfy.
 *
 * ## It fills gaps and never overwrites
 *
 * The first version set every field, including a display name — and silently
 * renamed accounts whose name the test had deliberately chosen. A notification
 * test asserting "Ben started following you" got "Test Person started following
 * you", and the failure pointed at notifications rather than at this helper.
 *
 * So each field is only written when it is actually missing. A fixture that has
 * already said who somebody is keeps its answer, and this supplies only the
 * parts nobody cared about.
 */
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { userProfiles } from "@shared/schema";

export async function finishOnboarding(userId: string, over: Record<string, unknown> = {}): Promise<void> {
  if (!userId) return;
  const [existing] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
  if (!existing) return;

  const patch: Record<string, unknown> = {};
  const has = (v: unknown) => typeof v === "string" ? v.trim().length > 0 : v != null;

  if (!has(existing.displayName)) patch.displayName = "Test Person";
  if (!existing.skills?.some((s) => s?.trim())) patch.skills = ["Shipping"];
  if (!existing.hoursPerWeek) patch.hoursPerWeek = 20;
  if (!has(existing.riskTolerance)) patch.riskTolerance = "moderate";
  if (!has(existing.scheduleStyle)) patch.scheduleStyle = "flexible";

  /* What the caller asks for wins, because it asked on purpose. */
  Object.assign(patch, over);
  if (!Object.keys(patch).length) return;
  await db.update(userProfiles).set(patch as any).where(eq(userProfiles.userId, userId));
}
