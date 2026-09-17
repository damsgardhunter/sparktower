/**
 * How two builders are scored against each other.
 *
 * This used to live inside POST /api/matches/generate, tangled up with the
 * database reads that feed it. Pure functions here instead: the route gathers
 * the facts, this decides what they're worth. That's what makes the weights
 * testable — "someone who shares your stack but none of your interests should
 * still outrank a stranger" is a unit test, not a thing you find out in
 * production.
 *
 * Two changes over the original scoring, both from what people actually
 * complained about:
 *
 *   - Past experience counts. Someone whose résumé says four years of
 *     payments work is a real match for a payments project even when their
 *     skills list says "TypeScript" and yours says "Node". Roles, the
 *     companies behind them, and portfolio work all feed `experienceOverlap`.
 *
 *   - People you already know are not matches. The candidate set excludes
 *     anyone you're connected to or have a request open with — see
 *     `isMatchable`. The old code read your connections and then never used
 *     them, so your closest collaborators came back as 90% matches forever.
 */
import type { ProfileExperience, ProfilePortfolioProject } from "./schema";

/** The slice of a profile matching reads. Kept structural so both sides of a match, and tests, can build one cheaply. */
export interface MatchProfile {
  skills?: string[] | null;
  interests?: string[] | null;
  experienceLevel?: string | null;
  headline?: string | null;
  bio?: string | null;
  hoursPerWeek?: number | null;
  riskTolerance?: string | null;
  speedVsPolish?: string | null;
  scheduleStyle?: string | null;
  conflictStyle?: string | null;
  builderType?: string | null;
  /** ProfileExperience[] as stored — jsonb, so it arrives as unknown. */
  experience?: unknown;
  /** ProfilePortfolioProject[] as stored. */
  portfolioProjects?: unknown;
}

/** What the route knows about a candidate's projects and standing, gathered once per person. */
export interface MatchContext {
  /** Categories of the projects they own. */
  categories: string[];
  /** Roles their projects are looking to fill. */
  rolesNeeded: string[];
  /** How many connections the two of you share. */
  mutualConnections: number;
  /** Their reputation's builder index, 0 when they have none yet. */
  builderIndex: number;
}

export type MatchFactors = {
  skills: number;
  interests: number;
  experience: number;
  /** Overlap in what the two of you have actually worked on before. */
  background: number;
  projects: number;
  connections: number;
  cofounder: number;
  builder: number;
};

/**
 * What each factor is worth, out of 100.
 *
 * `background` is paid for out of what `skills` and `interests` used to carry:
 * a stated skill list is a claim, a résumé is a record, so the record gets
 * weight without the whole score swinging onto it.
 */
export const MATCH_WEIGHTS: MatchFactors = {
  skills: 20,
  interests: 15,
  experience: 8,
  background: 15,
  projects: 10,
  connections: 10,
  cofounder: 14,
  builder: 8,
};

/** Below this, a match isn't worth showing — it's two people who happen to both exist. */
export const MATCH_FLOOR = 5;

// ─── Small pure pieces ───────────────────────────────────────────────────────

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();

/** Words too common in a skills or job-title list to mean anything when two people share them. */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "a", "an", "of", "at", "in", "to", "on", "by",
  "senior", "junior", "staff", "lead", "principal", "head", "chief", "intern",
  "i", "ii", "iii", "co", "inc", "llc", "ltd", "corp", "company", "team",
]);

/** A phrase as its meaningful words. "Senior Payments Engineer" → ["payments", "engineer"]. */
export function tokenize(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return normalize(value)
    .split(" ")
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Overlap of two sets as a fraction of their union — 0 when either is empty. */
export function jaccardSimilarity(a: string[] | null | undefined, b: string[] | null | undefined): number {
  if (!a?.length || !b?.length) return 0;
  const setA = new Set(a.map(normalize).filter(Boolean));
  const setB = new Set(b.map(normalize).filter(Boolean));
  if (!setA.size || !setB.size) return 0;
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

const EXPERIENCE_LEVELS = ["beginner", "intermediate", "expert"];

/** How well two stated experience levels sit together. Unknown on either side is neutral, not bad. */
export function experienceCompatibility(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0.5;
  const idxA = EXPERIENCE_LEVELS.indexOf(a);
  const idxB = EXPERIENCE_LEVELS.indexOf(b);
  if (idxA === -1 || idxB === -1) return 0.5;
  const diff = Math.abs(idxA - idxB);
  return diff === 0 ? 1 : diff === 1 ? 0.7 : 0.4;
}

/** Everything a profile says about what this person has actually done, as one bag of words. */
export function backgroundTerms(profile: MatchProfile): string[] {
  const terms: string[] = [];

  const roles = Array.isArray(profile.experience) ? (profile.experience as ProfileExperience[]) : [];
  for (const role of roles) {
    if (!role || typeof role !== "object") continue;
    terms.push(...tokenize(role.title));
    // The company is a domain signal on its own: two people who were both at a
    // bank are likelier to build a fintech together than their titles suggest.
    terms.push(...tokenize(role.company));
    for (const skill of Array.isArray(role.skills) ? role.skills : []) terms.push(...tokenize(skill));
  }

  const portfolio = Array.isArray(profile.portfolioProjects) ? (profile.portfolioProjects as ProfilePortfolioProject[]) : [];
  for (const work of portfolio) {
    if (!work || typeof work !== "object") continue;
    terms.push(...tokenize(work.name));
    terms.push(...tokenize(work.role));
    for (const tech of Array.isArray(work.technologies) ? work.technologies : []) terms.push(...tokenize(tech));
  }

  // The headline is the one line someone writes about themselves on purpose.
  terms.push(...tokenize(profile.headline));

  return [...new Set(terms)];
}

/**
 * How much two people's histories overlap.
 *
 * Not Jaccard: a long résumé would be punished for being long, and the person
 * with ten years of range is exactly who you want surfaced. Scored against the
 * smaller of the two vocabularies instead, so a short profile can still match
 * a deep one completely.
 */
export function experienceOverlap(a: MatchProfile, b: MatchProfile): number {
  const termsA = new Set(backgroundTerms(a));
  const termsB = new Set(backgroundTerms(b));
  if (!termsA.size || !termsB.size) return 0;
  const shared = [...termsA].filter((t) => termsB.has(t)).length;
  const smaller = Math.min(termsA.size, termsB.size);
  // Saturating: eight shared domain words is already a strong signal, and
  // beyond that the difference between 8 and 30 isn't meaningful.
  return Math.min(1, shared / Math.min(smaller, 8));
}

/** Working-style compatibility: same risk appetite, complementary conflict styles, similar hours. */
export function cofounderCompatibility(a: MatchProfile, b: MatchProfile): number {
  let score = 0;
  let factors = 0;

  if (a.riskTolerance && b.riskTolerance) {
    const levels = ["low", "moderate", "high"];
    const diff = Math.abs(levels.indexOf(a.riskTolerance) - levels.indexOf(b.riskTolerance));
    score += diff === 0 ? 1.0 : diff === 1 ? 0.5 : 0.1;
    factors++;
  }

  if (a.scheduleStyle && b.scheduleStyle) {
    if (a.scheduleStyle === b.scheduleStyle) score += 1.0;
    else if (a.scheduleStyle === "hybrid" || b.scheduleStyle === "hybrid") score += 0.7;
    else score += 0.3;
    factors++;
  }

  if (a.conflictStyle && b.conflictStyle) {
    const complementary: Record<string, string[]> = {
      direct: ["diplomatic", "collaborative"],
      diplomatic: ["direct", "collaborative"],
      avoidant: ["collaborative", "diplomatic"],
      collaborative: ["direct", "diplomatic", "collaborative"],
    };
    if (a.conflictStyle === b.conflictStyle) score += 0.7;
    else if (complementary[a.conflictStyle]?.includes(b.conflictStyle)) score += 1.0;
    else score += 0.3;
    factors++;
  }

  if (a.hoursPerWeek && b.hoursPerWeek) {
    const diff = Math.abs(a.hoursPerWeek - b.hoursPerWeek);
    score += diff <= 5 ? 1.0 : diff <= 10 ? 0.6 : 0.2;
    factors++;
  }

  if (a.builderType && b.builderType) {
    if (a.builderType === b.builderType) score += 1.0;
    else if (a.builderType === "both" || b.builderType === "both") score += 0.7;
    else score += 0.3;
    factors++;
  }

  if (a.speedVsPolish && b.speedVsPolish) {
    const levels = ["speed", "balanced", "polish"];
    const diff = Math.abs(levels.indexOf(a.speedVsPolish) - levels.indexOf(b.speedVsPolish));
    score += diff === 0 ? 1.0 : diff === 1 ? 0.6 : 0.2;
    factors++;
  }

  // Nobody has filled any of it in: neutral, rather than a zero that would
  // bury every new account.
  return factors > 0 ? score / factors : 0.5;
}

/** Shared project ground, and the roles you need that they don't. */
export function projectFit(mine: MatchContext, theirs: MatchContext): number {
  const myCategories = new Set(mine.categories.map(normalize).filter(Boolean));
  const theirCategories = new Set(theirs.categories.map(normalize).filter(Boolean));
  const allCategories = new Set([...myCategories, ...theirCategories]);
  const categoryScore = allCategories.size > 0
    ? [...myCategories].filter((c) => theirCategories.has(c)).length / allCategories.size
    : 0;

  const myRoles = new Set(mine.rolesNeeded.map(normalize).filter(Boolean));
  const theirRoles = new Set(theirs.rolesNeeded.map(normalize).filter(Boolean));
  const allRoles = new Set([...myRoles, ...theirRoles]);
  // A role you need and they don't is a gap they might fill.
  const complementScore = allRoles.size > 0
    ? [...myRoles].filter((r) => !theirRoles.has(r)).length / allRoles.size
    : 0;

  return categoryScore * 0.6 + complementScore * 0.4;
}

// ─── The score ───────────────────────────────────────────────────────────────

export interface ScoredMatch {
  score: number;
  factors: MatchFactors;
}

/** Every factor for a pair, before weighting — what the reasons are written from. */
export function matchFactors(
  me: { profile: MatchProfile; context: MatchContext },
  them: { profile: MatchProfile; context: MatchContext },
): MatchFactors {
  return {
    skills: jaccardSimilarity(me.profile.skills, them.profile.skills),
    interests: jaccardSimilarity(me.profile.interests, them.profile.interests),
    experience: experienceCompatibility(me.profile.experienceLevel, them.profile.experienceLevel),
    background: experienceOverlap(me.profile, them.profile),
    projects: projectFit(me.context, them.context),
    connections: Math.min(1, them.context.mutualConnections * 0.25),
    cofounder: cofounderCompatibility(me.profile, them.profile),
    builder: (() => {
      const diff = Math.abs(me.context.builderIndex - them.context.builderIndex);
      return diff <= 10 ? 1.0 : diff <= 25 ? 0.7 : 0.4;
    })(),
  };
}

/** One candidate's score out of 100, and the factors behind it. */
export function scoreMatch(
  me: { profile: MatchProfile; context: MatchContext },
  them: { profile: MatchProfile; context: MatchContext },
): ScoredMatch {
  const factors = matchFactors(me, them);
  const weighted = (Object.keys(MATCH_WEIGHTS) as (keyof MatchFactors)[])
    .reduce((sum, key) => sum + factors[key] * MATCH_WEIGHTS[key], 0);
  return { score: Math.min(100, Math.round(weighted)), factors };
}

/**
 * Whether someone belongs in your matches at all.
 *
 * Yourself, obviously not. Anyone not through onboarding has nothing to match
 * on. And — the bug this function exists for — nobody you've already
 * connected with: a match is an introduction, and you don't need introducing
 * to someone in your network. A pending request either way counts too; the
 * introduction is already in flight.
 */
export function isMatchable(
  candidateId: string,
  opts: { viewerId: string; isOnboarded: boolean; relatedUserIds: ReadonlySet<string> },
): boolean {
  if (candidateId === opts.viewerId) return false;
  if (!opts.isOnboarded) return false;
  return !opts.relatedUserIds.has(candidateId);
}

/** Plain-language reasons for a match, used when Nova doesn't write them. */
export function defaultMatchReasons(factors: MatchFactors): string[] {
  const reasons: string[] = [];
  if (factors.skills > 0.3) reasons.push("Overlapping technical skills");
  else reasons.push("Complementary skill set");
  if (factors.background > 0.3) reasons.push("Similar work history and past projects");
  else if (factors.interests > 0.3) reasons.push("Shared interests");
  else reasons.push("Diverse perspectives");
  if (factors.connections > 0) reasons.push("Mutual connections");
  else if (factors.cofounder > 0.7) reasons.push("Compatible working styles");
  else reasons.push("Potential new collaborator");
  return reasons;
}
