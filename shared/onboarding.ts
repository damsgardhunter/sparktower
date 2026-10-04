/**
 * What "finished onboarding" means, in one place both sides read.
 *
 * It used to mean a boolean column and a redirect in `App.tsx`: anyone whose
 * `isOnboarded` was false was sent to the form, from every address, and that
 * was the whole of it. The redirect was doing two jobs by accident — routing
 * people to onboarding, and incidentally keeping half-registered accounts away
 * from everything else — and only the first was ever written down. No route on
 * the server asked the question at all, so the second job was done by the
 * client politely declining to make the request.
 *
 * Letting people look around before filling in forms removes the first job.
 * That is the point: a Google sign-in that dead-ends in "tell us about
 * yourself" is where people leave. But it also removes the second, which was
 * never really there, so the rule has to be written down and enforced where it
 * cannot be skipped.
 *
 * ## What is required, and why only this much
 *
 * A display name, at least one skill, and the three questions about how
 * somebody works: hours a week, appetite for risk, and how they like their
 * time structured. Those five are what co-founder matching reads, which is the
 * one feature that silently produces worse results for everybody when a profile
 * is half-filled — a person with no skills does not merely match badly, they
 * dilute everyone else's matches too.
 *
 * Everything else onboarding asks for — a bio, interests, past experience, a
 * résumé, links — is skippable. It is useful and it is not load-bearing, and a
 * form that refuses to end is a form people abandon.
 */

/** The parts of a profile this rule reads. Deliberately narrow. */
export interface OnboardingProfile {
  displayName?: string | null;
  skills?: string[] | null;
  hoursPerWeek?: number | null;
  riskTolerance?: string | null;
  scheduleStyle?: string | null;
}

/** One requirement: how to test it, and what to say when it is not met. */
interface Requirement {
  key: OnboardingField;
  label: string;
  met: (p: OnboardingProfile) => boolean;
}

export type OnboardingField = "displayName" | "skills" | "hoursPerWeek" | "riskTolerance" | "scheduleStyle";

const REQUIREMENTS: Requirement[] = [
  {
    key: "displayName",
    label: "your name",
    /* Trimmed: a name of spaces is not a name, and a form will happily send one. */
    met: (p) => typeof p.displayName === "string" && p.displayName.trim().length > 0,
  },
  {
    key: "skills",
    label: "at least one skill",
    met: (p) => Array.isArray(p.skills) && p.skills.some((s) => typeof s === "string" && s.trim().length > 0),
  },
  {
    key: "hoursPerWeek",
    label: "how many hours a week you have",
    /*
     * Zero is a real answer to "how many hours", and it is also what an empty
     * number input coerces to. Treated as unanswered: somebody with no hours to
     * give is not looking for a co-founder, and the matcher reads this as a
     * quantity rather than a flag.
     */
    met: (p) => typeof p.hoursPerWeek === "number" && Number.isFinite(p.hoursPerWeek) && p.hoursPerWeek > 0,
  },
  { key: "riskTolerance", label: "how you feel about risk", met: (p) => !!p.riskTolerance },
  { key: "scheduleStyle", label: "how you like your time structured", met: (p) => !!p.scheduleStyle },
];

/** What is still missing, in the order the form asks for it. */
export function missingOnboarding(profile: OnboardingProfile | null | undefined): OnboardingField[] {
  if (!profile) return REQUIREMENTS.map((r) => r.key);
  return REQUIREMENTS.filter((r) => !r.met(profile)).map((r) => r.key);
}

/** Whether this profile is finished enough to take part. */
export const onboardingComplete = (profile: OnboardingProfile | null | undefined): boolean =>
  missingOnboarding(profile).length === 0;

/** The missing pieces, named the way a person would say them. */
export function missingOnboardingLabels(profile: OnboardingProfile | null | undefined): string[] {
  const missing = new Set(missingOnboarding(profile));
  return REQUIREMENTS.filter((r) => missing.has(r.key)).map((r) => r.label);
}

/**
 * One sentence saying what is left, for a banner or a refusal.
 *
 * Named rather than counted. "Add your name and at least one skill" is a thing
 * somebody can act on; "2 fields remaining" is a thing they have to go and
 * decode, and the decoding is the part that loses them.
 */
export function onboardingPrompt(profile: OnboardingProfile | null | undefined): string | null {
  const labels = missingOnboardingLabels(profile);
  if (!labels.length) return null;
  if (labels.length === 1) return `Add ${labels[0]} to finish setting up your profile.`;
  const last = labels[labels.length - 1];
  return `Add ${labels.slice(0, -1).join(", ")} and ${last} to finish setting up your profile.`;
}

/**
 * What a half-finished account may still do.
 *
 * The line is whether an action puts this person in front of somebody else.
 * Reading the feed, opening a project, following one, reacting to a post and
 * playing a simulation are all things that either nobody sees or that carry no
 * claim about who you are — a follow is a bookmark, a reaction is a number.
 *
 * Connecting, messaging, commenting, posting, entering a contest and backing a
 * project all put a name and a face next to something another person reads, or
 * enter a competition judged against other people. Those wait.
 */
export const ONBOARDING_REQUIRED_FOR = [
  "connect", "message", "comment", "post", "contest", "backing",
] as const;
export type GatedAction = (typeof ONBOARDING_REQUIRED_FOR)[number];

/** The code the server sends and the client recognises, so the prompt is specific. */
export const ONBOARDING_REQUIRED_CODE = "onboarding_required";
