/**
 * The bets: what the product becomes, how fast, and what can go wrong.
 *
 * Phase one gave the seats money and phase two gave them each other. This
 * gives the product risk. Until now every pound of product spending bought a
 * predictable amount of quality, a year later, every time — which made the
 * technology seat a calculator. Real product work is a set of bets: which
 * feature, built or copied, shipped fast or shipped right, and whether the
 * shortcuts taken to get there come due as an outage or a breach.
 *
 * Every chance here is seeded from the season, the year and the company, so a
 * year replays exactly and a bug can be reproduced from a saved world. The
 * dice decide which of the risks a team took arrives, never whether it took
 * them.
 */
import type { Company, Niche, Segment } from "./types";
import { saturate } from "./market";
import { marketPriceOf } from "./decisions";
import { rng } from "./random";

// ─── Pace ────────────────────────────────────────────────────────────────────

export type Pace = "ship" | "balanced" | "right";

/**
 * What the chief executive's pace does.
 *
 * - **Ship it**: part of this year's product work reaches customers this
 *   year, results swing further either way, feature bets flop more often, and
 *   the technology seat inherits half as much debt again.
 * - **Get it right**: nothing lands early, results barely swing, bets flop
 *   half as often, a little less debt — and marketing waits for the product,
 *   so it goes slightly less far.
 */
export const PACE = {
  ship: { landsNow: 0.4, swing: 0.3, flop: 0.35, debt: 1.5, marketing: 1.05 },
  balanced: { landsNow: 0, swing: 0.1, flop: 0.25, debt: 1, marketing: 1 },
  right: { landsNow: 0, swing: 0, flop: 0.12, debt: 0.7, marketing: 0.96 },
} as const;

export const paceOf = (p?: string) => PACE[(p as Pace) in PACE ? (p as Pace) : "balanced"];

/** A seeded swing of the year's shipped quality, ±`swing`. */
export function swingOf(pace: string | undefined, seed: string): number {
  const s = paceOf(pace).swing;
  return s === 0 ? 1 : 1 + (rng(seed)() * 2 - 1) * s;
}

// ─── Feature bets ────────────────────────────────────────────────────────────

export interface FeatureIdea {
  id: string;
  name: string;
  /** The segment it is built for. */
  segment: string;
  blurb: string;
}

/**
 * Each market's ideas. Two for each segment, so a menu can offer something
 * to everybody and a team can build towards the customers it chose.
 */
export const FEATURES: Record<string, FeatureIdea[]> = {
  dating_apps: [
    { id: "swipe_boost", name: "Instant rematch", segment: "swipers", blurb: "A second look at the ones you passed. Swipers love it; nobody else notices." },
    { id: "group_dates", name: "Group dates", segment: "swipers", blurb: "Four friends, four strangers, one bar. Low stakes, high volume." },
    { id: "verification", name: "Photo verification", segment: "recently_single", blurb: "Proof the person is the person. The single most-asked-for thing from people burned before." },
    { id: "video_dates", name: "Video first dates", segment: "recently_single", blurb: "Ten minutes on camera before an evening in person." },
    { id: "ai_matching", name: "AI matching", segment: "long_haulers", blurb: "Fewer, better introductions. Long-haulers judge you on exactly this." },
    { id: "relationship_coach", name: "Relationship coaching", segment: "long_haulers", blurb: "Help after the match. Premium people pay premium for it." },
  ],
  drone_delivery: [
    { id: "live_cam", name: "Live drone cam", segment: "novelty", blurb: "Watch it fly to you. Pointless and irresistible." },
    { id: "gift_drop", name: "Gift drops", segment: "novelty", blurb: "A surprise, from the sky, on a birthday." },
    { id: "farm_route", name: "Farm-gate routes", segment: "rural", blurb: "Scheduled runs to places the van gave up on." },
    { id: "weather_fleet", name: "All-weather fleet", segment: "rural", blurb: "Flies when it rains, which is when rural customers need it." },
    { id: "cold_chain", name: "Cold-chain pods", segment: "clinics", blurb: "Insulin and samples at the right temperature, logged." },
    { id: "audit_trail", name: "Chain-of-custody audit", segment: "clinics", blurb: "Every handover recorded. Clinics cannot buy without it." },
  ],
  podcasts: [
    { id: "clips", name: "Shareable clips", segment: "chart_hoppers", blurb: "Thirty seconds that travel. Chart-hoppers find you through them." },
    { id: "trending", name: "Trending feed", segment: "chart_hoppers", blurb: "What everybody else is hearing today." },
    { id: "offline_queue", name: "Smart offline queue", segment: "commuters", blurb: "Downloaded before the tunnel, every morning, without asking." },
    { id: "chapters", name: "Chapters and skips", segment: "commuters", blurb: "Jump to the part that fits the journey." },
    { id: "bonus_feed", name: "Bonus feeds", segment: "superfans", blurb: "The extra episode, for the people who would pay for it." },
    { id: "live_shows", name: "Live recordings", segment: "superfans", blurb: "Being in the room. Superfans measure their loyalty in these." },
  ],
  restaurant_chain: [
    { id: "order_ahead", name: "Order ahead", segment: "lunch", blurb: "Skip the queue. Twelve minutes becomes seven." },
    { id: "lunch_loyalty", name: "Lunch stamp card", segment: "lunch", blurb: "The tenth one free, and a reason to come back on Friday." },
    { id: "kids_menu", name: "A proper kids' menu", segment: "families", blurb: "Something a six-year-old will actually eat." },
    { id: "booking", name: "Table booking for groups", segment: "families", blurb: "A table for nine that is there when you arrive." },
    { id: "delivery_packaging", name: "Delivery-proof packaging", segment: "delivery", blurb: "Chips that are still chips after twenty minutes." },
    { id: "dark_kitchen", name: "Dark kitchens", segment: "delivery", blurb: "Cooking for the app alone, closer to where people order." },
  ],
  construction: [
    { id: "instant_quote", name: "Instant quotes", segment: "homeowners", blurb: "A price the same day. Homeowners hire whoever answers first." },
    { id: "tidy_site", name: "Tidy-site guarantee", segment: "homeowners", blurb: "Swept every evening. It is what gets you recommended." },
    { id: "modular", name: "Modular build", segment: "developers", blurb: "Factory-made sections, weeks off every programme." },
    { id: "bim", name: "Digital twin models", segment: "developers", blurb: "The building, modelled before it is built. Developers ask for it now." },
    { id: "social_value", name: "Social-value reporting", segment: "public", blurb: "Apprenticeships and local spend, counted. Public tenders score it." },
    { id: "framework", name: "Framework accreditation", segment: "public", blurb: "On the approved list, which is where public work comes from." },
  ],
  project_saas: [
    { id: "templates", name: "Template library", segment: "startups", blurb: "Up and running in ten minutes." },
    { id: "free_tier_ai", name: "AI task writer", segment: "startups", blurb: "Plans from a sentence. Startups try it and stay." },
    { id: "integrations", name: "Deep integrations", segment: "midsize", blurb: "Talks to everything the team already uses." },
    { id: "reporting", name: "Portfolio reporting", segment: "midsize", blurb: "The view a head of operations actually wants." },
    { id: "sso", name: "Single sign-on and audit", segment: "enterprise", blurb: "Security's checklist, ticked. No enterprise deal closes without it." },
    { id: "data_residency", name: "Data residency", segment: "enterprise", blurb: "Their data stays in their country." },
  ],
  mmos: [
    { id: "launch_event", name: "Launch-week event", segment: "tourists", blurb: "Something to see in the first hour." },
    { id: "cosmetics", name: "Cosmetic store", segment: "tourists", blurb: "Look different by Tuesday." },
    { id: "guild_halls", name: "Guild halls", segment: "guilds", blurb: "Somewhere of their own. Guilds stay where they have built something." },
    { id: "raids", name: "Twenty-player raids", segment: "guilds", blurb: "The thing a guild exists to do together." },
    { id: "legacy_servers", name: "Legacy servers", segment: "veterans", blurb: "The game as it was when they fell for it." },
    { id: "ranked", name: "Ranked seasons", segment: "veterans", blurb: "A ladder, and a reason to have played for six years." },
  ],
};

/** What a market's features are, whether or not it has a list of its own: two per segment, named plainly. */
export function featuresOf(niche: Pick<Niche, "id" | "segments">): FeatureIdea[] {
  return FEATURES[niche.id] ?? niche.segments.flatMap((s: Segment) => [
    { id: `${s.id}_a`, name: `Something for ${s.name.toLowerCase()}`, segment: s.id, blurb: `Built for ${s.name.toLowerCase()}.` },
    { id: `${s.id}_b`, name: `More for ${s.name.toLowerCase()}`, segment: s.id, blurb: `Built for ${s.name.toLowerCase()}.` },
  ]);
}

export interface MenuItem extends FeatureIdea {
  /** An incumbent already has it, so it can be copied. */
  rivalHas: boolean;
}

/**
 * This year's menu: three ideas, drawn from the market's list, the same for
 * every team in the season. One of them an incumbent already has, so there
 * is always something to copy.
 */
export function featureMenu(niche: Pick<Niche, "id" | "segments">, seasonId: string, year: number): MenuItem[] {
  const all = featuresOf(niche);
  const r = rng(`${seasonId}:${year}:features`);
  const pool = [...all];
  const picked: FeatureIdea[] = [];
  while (picked.length < 3 && pool.length) picked.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  const copyable = Math.floor(r() * picked.length);
  return picked.map((f, i) => ({ ...f, rivalHas: i === copyable }));
}

/**
 * What a feature costs to build, in this market's money: a quarter of a per
 * cent of everything the market could spend in a year. Copying costs 40% of
 * that.
 */
export const FEATURE_RATE = 0.0025;
export const COPY_SHARE = 0.4;
export function featureCost(niche: Niche, mode: "build" | "copy" = "build"): number {
  const market = niche.segments.reduce((sum, s) => sum + s.size, 0);
  const build = marketPriceOf(niche) * market * FEATURE_RATE;
  return Math.round(mode === "copy" ? build * COPY_SHARE : build);
}

export interface Feature {
  id: string;
  name: string;
  segment: string;
  /** How much more appealing it makes the company to that segment, e.g. 0.08. Nought for a flop. */
  lift: number;
  /** The year it reaches customers. */
  lands: number;
  mode: "build" | "copy";
  flopped?: boolean;
}

/** A built feature, when it works. A copy is worth half. */
export const BUILD_LIFT = 0.08;
export const COPY_LIFT = 0.04;
/** However many features a company has for one segment, together they are worth no more than this. */
export const FEATURE_CAP = 1.25;

/** What the company's live features are worth to one segment, as a multiplier on appeal. */
export function featureAppeal(company: Pick<Company, "features">, segmentId: string, year: number): number {
  let m = 1;
  for (const f of company.features ?? []) {
    if (f.segment === segmentId && f.lands <= year && !f.flopped) m *= 1 + f.lift;
  }
  return Math.min(FEATURE_CAP, m);
}

/**
 * A bet placed this year.
 *
 * Built: lands next year (this year, when shipping), and roughly one in four
 * does not work — more when shipping, fewer when getting it right. Copied:
 * lands now, never flops, and is worth half. A copy is only allowed of
 * something a rival already has: the menu's marked item, or anything another
 * team has built.
 */
export function placeBet(input: {
  idea: FeatureIdea;
  mode: "build" | "copy";
  pace?: string;
  year: number;
  seed: string;
  /** How many periods make a year: a build lands a year out, however long that is. */
  periods?: number;
}): Feature {
  const { idea, mode, pace, year, seed, periods = 1 } = input;
  if (mode === "copy") return { id: idea.id, name: idea.name, segment: idea.segment, lift: COPY_LIFT, lands: year, mode };
  const p = paceOf(pace);
  const flopped = rng(seed)() < p.flop;
  return {
    id: idea.id, name: idea.name, segment: idea.segment,
    lift: flopped ? 0 : BUILD_LIFT,
    lands: p.landsNow > 0 ? year : year + Math.max(1, periods),
    mode, flopped,
  };
}

// ─── Security, breaches and outages ──────────────────────────────────────────

/** Security built up, 0–100: a fifth of it wears off each year, and spending adds to it. */
/** A fifth wears off a year, and spending adds to it — both per period, not per call. */
export function securityNext(level: number | undefined, spend: number | undefined, per = 1): number {
  const now = Math.max(0, Math.min(100, level ?? 0));
  return Math.min(100, now * Math.pow(0.8, per) + saturate(Math.max(0, spend ?? 0), 150_000 * per) * 40 * per);
}

export interface Breach {
  reputation: number;
  service: number;
  /** Share of revenue it cost to clean up. */
  cost: number;
}

/**
 * Whether this year brings a breach, and how bad.
 *
 * Every company carries some chance; technical debt raises it and security
 * lowers both the chance and the damage. Nobody thanks you for the breach
 * that didn't happen — which is why the chance is shown on the desk, so a
 * technology seat can at least point at it.
 */
export function breachChance(security: number | undefined, techDebt: number | undefined): number {
  const s = Math.max(0, Math.min(100, security ?? 0)) / 100;
  const d = Math.max(0, Math.min(100, techDebt ?? 0)) / 100;
  return Math.max(0.01, Math.min(0.4, 0.07 + d * 0.12 - s * 0.06));
}

/** `per` is one period's share of a year: the chance is an annual one, so a quarter carries a quarter of it. */
export function breachOf(input: { security?: number; techDebt?: number; seed: string; per?: number }): Breach | null {
  if (rng(input.seed)() >= breachChance(input.security, input.techDebt) * (input.per ?? 1)) return null;
  const shield = 1 - Math.max(0, Math.min(100, input.security ?? 0)) / 150;
  return { reputation: Math.round(12 * shield), service: Math.round(5 * shield), cost: 0.02 * shield };
}

/**
 * An outage: the debt coming due. Nothing under thirty points of debt; above
 * it, more likely the more there is, and reliability work makes it rarer.
 */
export function outageChance(techDebt: number | undefined, reliabilitySpend: number | undefined): number {
  const d = Math.max(0, (techDebt ?? 0) - 30);
  return Math.min(0.6, d / 150) * (1 - saturate(Math.max(0, reliabilitySpend ?? 0), 300_000));
}

export const OUTAGE = { service: 6, reputation: 2 };

// ─── Data ────────────────────────────────────────────────────────────────────

/** Analytics built up, 0–100: a fifth wears off each year. */
/** What is known about the customers: a fifth of it goes stale a year, and spending adds to it. */
export function dataNext(level: number | undefined, spend: number | undefined, per = 1): number {
  const now = Math.max(0, Math.min(100, level ?? 0));
  return Math.min(100, now * Math.pow(0.8, per) + saturate(Math.max(0, spend ?? 0), 150_000 * per) * 40 * per);
}

/**
 * What good data does for everybody else: a narrower forecast, a marketing
 * seat that can be a little further off and still be "right", and marketing
 * and efficiency that each go a little further because they are aimed. The
 * one decision in the game that is a gift to the other seats.
 */
export const dataEffects = (level: number | undefined) => {
  const d = Math.max(0, Math.min(100, level ?? 0)) / 100;
  return { band: 1 - 0.4 * d, tolerance: 0.08 * d, aim: 1 + 0.06 * d };
};

// ─── Channels ────────────────────────────────────────────────────────────────

/**
 * PR and influencers: a coin flip. A bit better than even, it lands and buys
 * brand cheaply; otherwise it buys nothing, and one time in ten it backfires.
 */
export function prOutcome(spend: number | undefined, seed: string): { brand: number; reputation: number; landed: "hit" | "miss" | "backfire" | null } {
  const s = Math.max(0, spend ?? 0);
  if (s <= 0) return { brand: 0, reputation: 0, landed: null };
  const r = rng(seed)();
  if (r < 0.55) return { brand: saturate(s, 100_000) * 14, reputation: 0, landed: "hit" };
  if (r < 0.9) return { brand: 0, reputation: 0, landed: "miss" };
  return { brand: 0, reputation: -3, landed: "backfire" };
}

/**
 * A referral programme: customers bringing customers, which only happens if
 * the product is worth recommending. Nothing below quality 40; at 100, as
 * good as the same money on brand.
 */
export function referralBrand(spend: number | undefined, quality: number): number {
  const s = Math.max(0, spend ?? 0);
  const worth = Math.max(0, Math.min(1, (quality - 40) / 60));
  return saturate(s, 150_000) * 12 * worth;
}
