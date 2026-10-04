/**
 * The rule that an action needs a finished profile, enforced where it counts.
 *
 * Until now this was a redirect in `App.tsx` and nothing else. Every write
 * route gated on `isAuthenticated` alone, so the requirement held only for
 * people who used the interface: an account that signed in with Google and
 * never finished could post, comment, connect and enter a contest by calling
 * the API directly, and nothing on the server would have noticed.
 *
 * That was survivable while the redirect sent everyone to the form anyway.
 * It stops being survivable the moment people are let in to look around, which
 * is the point of this change — so the rule moves to where it cannot be
 * skipped, and `shared/onboarding.ts` holds the one definition both sides read.
 *
 * ## What it refuses, and how
 *
 * 403 with `onboarding_required` and the list of what is missing, so the client
 * can say "add your name and at least one skill" at the place the person was
 * refused rather than only in a banner they have scrolled past. A refusal that
 * does not say what to do is a dead end with extra steps.
 *
 * Reads are never gated here. Looking is the whole point.
 */
import type { RequestHandler } from "express";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { userProfiles } from "@shared/schema";
import {
  ONBOARDING_REQUIRED_CODE, missingOnboarding, missingOnboardingLabels, onboardingPrompt,
} from "@shared/onboarding";

/**
 * Refuses an action until the profile behind it is finished.
 *
 * `what` names the action in the sentence somebody reads, so the refusal is
 * about the thing they just tried rather than about profiles in general.
 */
export function requireOnboarded(what: string): RequestHandler {
  return async (req: any, res, next) => {
    /*
     * Not this middleware's job. `isAuthenticated` runs first everywhere this
     * is used, and answering 403 to a signed-out request would tell them to go
     * and finish a profile they have not started.
     */
    if (!req.user?.id) return next();

    try {
      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, req.user.id));
      const missing = missingOnboarding(profile as any);
      if (missing.length === 0) return next();

      return res.status(403).json({
        code: ONBOARDING_REQUIRED_CODE,
        message: `Finish setting up your profile before you ${what}. ${onboardingPrompt(profile as any)}`,
        missing,
        missingLabels: missingOnboardingLabels(profile as any),
      });
    } catch (error) {
      /*
       * A database that cannot be read is not a half-finished profile. Letting
       * the request through puts it in front of the route's own handling, which
       * will fail honestly; refusing here would blame the person for an outage
       * and tell them to go and edit a profile that is already complete.
       */
      console.error("[onboarding] could not check the profile, letting the request through:", error);
      return next();
    }
  };
}
