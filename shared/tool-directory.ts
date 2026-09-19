/**
 * The tools Nova is allowed to point at, and where each one applies.
 *
 * Nova names a need (@shared/needs); this answers with links. Nothing reaches
 * a founder from here that a person did not put in this file, which is the
 * point — see the header of needs.ts for why a model must never produce the
 * URL itself.
 *
 * ## Countries
 *
 * Every entry declares the regions it serves, and the whole directory is built
 * so that adding a country is data rather than a rewrite. Today that data is
 * `US` plus the things that are the same everywhere; a founder in Lagos or
 * Lisbon asking about forming a company gets told plainly that this part
 * differs where they are, instead of being handed American advice with
 * American confidence. That is the difference between a gap and a lie, and it
 * is the only honest way to ship one country first.
 *
 * `GLOBAL` means genuinely everywhere — a code editor, a design tool. It is
 * not a synonym for "we didn't check": if an entry's usefulness depends on the
 * country, it names countries.
 *
 * ## What each entry has to carry
 *
 * `costs` and `insteadOf` are required thinking, not decoration. A directory
 * that lists a $299 formation service without mentioning that the state will
 * take the same filing for $50 is an advert. The most trustworthy sentence on
 * most of these cards is the one about not needing them yet.
 */
import type { Stage } from "./needs";

/** ISO 3166-1 alpha-2, or GLOBAL for things that don't vary by country. */
export type Region = "GLOBAL" | "US" | "GB" | "CA" | "AU" | "EU" | "IN" | "NG";

export interface Tool {
  id: string;
  name: string;
  /** Canonical https URL. No referral codes here — those live in promotion_settings, set per tool by an admin. */
  url: string;
  /** What it is, in one sentence, to someone who has never heard of it. */
  what: string;
  /** Which needs this answers. */
  needs: string[];
  regions: Region[];
  /** Real money, in plain words. "Free" on its own is never enough — say free for what. */
  costs: string;
  /** What you'd do without it, when that's a real option. Omitted only when there genuinely isn't one. */
  insteadOf?: string;
  /** Anything that would annoy someone who signed up without knowing. */
  catch?: string;
  /** Matches an id in @shared/promotions so a referral link and perk can be attached later without a second list. */
  promotionId?: string;
  /** When someone is likely to meet it, if it differs from the need's own stage. */
  stage?: Stage;
}

/**
 * Deliberately empty until the research lands.
 *
 * An empty directory shows nothing, which is the correct behaviour for a
 * product that has not yet checked its links: `recommendationsFor` returning
 * [] means Nova says "I don't have a vetted link for that yet" rather than
 * improvising one. Seeding it with plausible-looking entries nobody verified
 * would be the same failure as letting the model write them, with an extra
 * step.
 */
export const TOOLS: Tool[] = [];

export interface RecommendationContext {
  /** Where the founder is. Unknown is a real answer and must not be treated as the US. */
  region?: Region | null;
}

/**
 * The tools for a need, best first.
 *
 * Ordering is by how well the entry fits the country asked about, then by the
 * order they appear in this file — which is a human's judgement of what to try
 * first, and deliberately not anything to do with what any of them pay.
 */
export function recommendationsFor(needId: string, ctx: RecommendationContext = {}): Tool[] {
  const region = ctx.region ?? null;
  const matches = TOOLS.filter((t) => t.needs.includes(needId));

  return matches
    .filter((t) => {
      if (t.regions.includes("GLOBAL")) return true;
      // Unknown region: show only what's universal, and let the caller say why.
      if (!region) return false;
      return t.regions.includes(region);
    })
    .sort((a, b) => Number(b.regions.includes(region as Region)) - Number(a.regions.includes(region as Region)));
}

/**
 * True when we have country-specific entries for this need but none for theirs.
 *
 * The case worth handling out loud: a need that is all about jurisdiction, a
 * founder outside the one we've covered, and a directory that would otherwise
 * quietly show them nothing and let them conclude the step doesn't apply.
 */
export function coveredElsewhereOnly(needId: string, region: Region | null | undefined): boolean {
  const matches = TOOLS.filter((t) => t.needs.includes(needId));
  if (!matches.length) return false;
  const usable = matches.filter((t) => t.regions.includes("GLOBAL") || (region && t.regions.includes(region)));
  return usable.length === 0;
}

/** Which countries this directory can actually answer for, for an honest "where are you?" prompt. */
export const COVERED_REGIONS: Region[] = Array.from(
  new Set(TOOLS.flatMap((t) => t.regions).filter((r): r is Region => r !== "GLOBAL")),
);
