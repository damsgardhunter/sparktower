import { Link } from "wouter";
import { UserPlus, X } from "lucide-react";
import { useState } from "react";
import { onboardingPrompt, type OnboardingProfile } from "@shared/onboarding";

/**
 * The line that follows somebody around until their profile is finished.
 *
 * Replacing a redirect. Anyone who had not finished was sent to the form from
 * every address, which meant a Google sign-in ended in "tell us about
 * yourself" before the person had seen a single thing the product does — and
 * the ones who left there never saw any of it.
 *
 * They can look around now: the feed, Discover, a project, a simulation. What
 * they cannot do is anything that puts them in front of somebody else, and the
 * server is what refuses that (`server/require-onboarded.ts`) rather than this.
 * This is the reminder, not the rule.
 *
 * ## Why it says what is missing
 *
 * "Finish your profile" is a sign on a door with no handle. The prompt names
 * the actual gaps — "add your name and at least one skill" — because that is
 * the difference between a nag and an instruction. It comes from the same
 * function the server's refusal uses, so the banner and the refusal can never
 * describe different work.
 *
 * ## Why it can be dismissed, and why that does not last
 *
 * Somebody mid-task should be able to make it go away. It comes back on the
 * next page, because a reminder that can be turned off permanently is one that
 * will be, and the thing it is reminding them of is the thing that makes the
 * product work for them. Dismissal is per page view, held in component state
 * and deliberately not persisted.
 */
export function OnboardingBanner({ profile }: { profile: OnboardingProfile | null | undefined }) {
  const [dismissed, setDismissed] = useState(false);
  const prompt = onboardingPrompt(profile);
  if (!prompt || dismissed) return null;

  return (
    <div
      className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm"
      role="status"
      data-testid="onboarding-banner"
    >
      <UserPlus className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="min-w-0 flex-1">
        <span className="text-foreground">{prompt}</span>{" "}
        <span className="text-muted-foreground">
          You can look around meanwhile — posting, commenting and connecting need it finished.
        </span>
      </p>
      <Link
        href="/onboarding"
        className="shrink-0 rounded-md bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700"
        data-testid="button-finish-onboarding"
      >
        Finish
      </Link>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Hide this for now"
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-amber-500/20"
        data-testid="button-dismiss-onboarding"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
