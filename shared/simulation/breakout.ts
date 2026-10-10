/**
 * The one that pops off.
 *
 * Every business like this has the same story in it: one video, one post, one
 * stunt that goes further than anything before it and leaves the company
 * permanently bigger. It is not a reward for spending — a budget cannot buy it
 * — and it is not luck alone either, because the people it happens to are the
 * ones who were putting the work in. That is the shape this models: the hours
 * the founders spend on the work itself raise the odds, and when it lands it
 * lands on everything at once.
 *
 * ## Why it is the hours and not the money
 *
 * Paid promotion already has its own path — it buys customers at a market
 * price, bounded by what the company earned on merit (`BOUGHT_PER_EARNED`).
 * Letting money buy breakout chance too would make it a second advertising
 * lever and would run into the same guard: being louder would beat being
 * better. The hours are the right currency because they are the one thing a
 * company with nothing still has, and because it is true — the channel that
 * breaks out is the one that kept uploading.
 *
 * ## Why the effects are permanent and mixed
 *
 * A million views is not a month of extra demand, it is a step change in how
 * many people have heard of you (brand), how many of them you now have to
 * serve (capacity), how well regarded you are for having made the thing
 * (reputation), and what you learned making it (quality). It lands on all four
 * because that is what actually happens, and it stays because attention that
 * arrived for free does not leave when the month ends.
 */
import { hash } from "./random";
import { atScale } from "./market";
import type { Niche } from "./types";

/** How far it went, and how rare that is. */
export type BreakoutTier = "hundred" | "half" | "million";

export interface Breakout {
  tier: BreakoutTier;
  /** Views, in the round numbers people actually say out loud. */
  views: number;
  brand: number;
  quality: number;
  reputation: number;
  /**
   * How many people the video actually brought to the door.
   *
   * Reported rather than granted, and that distinction cost three attempts to
   * find. A hit does not build you anywhere to put them: room is money and
   * time, and handing a company free capacity it cannot fill hands it an
   * **idle-capacity bill**, which is one of the largest lines in these
   * accounts. Measured, that is what sank `balance`'s local operator — a
   * one-town construction firm survived fourteen years and lost money in every
   * one of them, because a lucky break had given it room for twelve thousand
   * clients it was never going to serve.
   *
   * So what a breakout actually does is bring *demand*: brand, standing and
   * what you learned, all of which pull people through the allocator. Whether
   * there is anywhere to serve them is the operations seat's decision, and if
   * there is not then some of them are turned away and it costs reputation —
   * which is exactly what happens when something takes off before you are
   * ready, and is a better story than free warehouses.
   */
  arrived: number;
}

/**
 * The chance of it happening at all in one period, before the work.
 *
 * Written as a chance per **year** and shared across the periods, so a monthly
 * season is not twelve times as lucky as a yearly one — the same correction
 * `founderPace` makes for the founders' hours, and for the same reason.
 *
 * ## Calibrated by counting, after the first numbers were measured as useless
 *
 * These began at a sixtieth, four sixtieths and two sixtieths, chosen to feel
 * "rare". Played, that came out as **zero breakouts in 108 company-months** —
 * nine markets, a year each — and the arithmetic says that was correct: a
 * founder putting the *whole week* into the work every month for a year had
 * about a one-in-ten chance of ever seeing one. That is not a mechanic, it is
 * a rumour. The tests did not catch it because they only held that the odds
 * *rose* with the work, never that they were high enough to matter.
 *
 * So they are set from what a season should feel like instead. A company doing
 * nothing in particular: 8% a year, so it is a surprise when it happens. A
 * founder giving the work the whole week, with a decent product: a little
 * better than even over a year, so somebody who commits to it expects one and
 * is not promised it. The odds are still the only thing the work buys — what
 * actually lands is a roll.
 */
/**
 * How many of the people who watched it stick around to be served.
 *
 * Two per cent, the sort of number anybody who has posted something that
 * travelled would recognise: most of a hundred thousand views are people who
 * watched once and left. See the note on `room` for why it is views and not
 * market share or company size.
 */
export const VIEWS_CONVERT = 0.02;

export const BREAKOUT_BASE = 0.08; // BISECT

/**
 * What a full week of the founders' own hours on the work adds to those odds.
 *
 * The biggest of the three terms, because it is the one the player controls.
 * A full week every month takes a year from 8% to 50% before quality is
 * counted — a real reason to spend the hours, and still a coin toss.
 */
export const BREAKOUT_FROM_WORK = 0.42; // BISECT

/**
 * Quality's share of the odds: nothing, and that is a correction.
 *
 * "A better product is more likely to be the one that travels" is true and it
 * was the wrong thing to model here, because of *who* has the better product.
 * Incumbents open at quality 81 and file no founder hours at all, so a quality
 * term handed them 19% a year against a startup's 13% — a mechanic meant to be
 * the lucky break a founder works for, paying the market leader most. Measured
 * on the full suite, that is what broke `balance`'s "a competent team is not
 * wiped out by bots", `from-nothing`'s "rewards capital", construction's
 * locked-out route and `simulation`'s "the second million gives less than the
 * first": four guards, all of them about relative advantage, all of them
 * tilted by a windfall that favoured whoever was already ahead.
 *
 * The brief was only ever the hours — "they can increase the odds by putting
 * hours into their videos each month". So the odds are the base plus the work,
 * and nothing else. A company that files no hours gets the base and no more,
 * whatever its product, which is also the honest reading: the channel that
 * breaks out is the one that kept uploading, not the one with the best gear.
 *
 * Kept as a named zero rather than deleted, so the next person to think of
 * this finds the measurement instead of the idea.
 */
export const BREAKOUT_FROM_QUALITY = 0; // BISECT

/**
 * How often each size happens, given one happens at all.
 *
 * Weighted hard toward the smallest, because that is the distribution these
 * things actually have — a hundred thousand views is a good month and a
 * million is the story somebody tells for years.
 */
/*
 * ## Why these are smaller than they first were
 *
 * The first set paid 6/14/26 points of brand and up to 22% of the market in
 * room. With odds low enough that nobody ever saw one, that was harmless. Once
 * the odds were raised to where a committed founder expects one in a season,
 * it broke three balance guards: "a competent team is not wiped out by bots",
 * "a local operator ends up worth having", and "nobody is locked out" in
 * construction. A windfall that lands on four axes at once is powerful, and at
 * fifty-fifty a year it was deciding seasons.
 *
 * Halved twice, and the second halving was measured on the full suite rather
 * than a handful of files. At the larger figures, three guards stayed red with
 * the odds visible — `from-nothing`'s "rewards capital" and "is harder than
 * the funded opening", and `simulation`'s "the second million gives less than
 * the first". All three are about what money is worth, and all three moved for
 * the same reason: the hit is sized by views, so it is worth proportionally
 * far more to a small company, which is right as a design and does erode
 * exactly what those guards measure. Smaller, the bias is inside their
 * tolerance and the event survives.
 *
 * The trade is deliberate: this should be something a player notices and
 * remembers, not something that settles the outcome. A hundred thousand views
 * is a good month that compounds; a million is a genuine step change and still
 * not a win on its own.
 */
const TIERS: { tier: BreakoutTier; views: number; weight: number; brand: number; quality: number; reputation: number; room: number }[] = [
  { tier: "hundred", views: 100_000, weight: 0.70, brand: 2, quality: 1, reputation: 1, room: 0.02 },
  { tier: "half", views: 500_000, weight: 0.24, brand: 4, quality: 1, reputation: 3, room: 0.05 },
  { tier: "million", views: 1_000_000, weight: 0.06, brand: 7, quality: 2, reputation: 4, room: 0.11 },
];

/**
 * Whether one happened this period, and how big.
 *
 * Seeded, like every other die in this engine, so a period re-run deals the
 * same outcome — a report that changed when it was reloaded would be worse
 * than no report. `hoursOnTheWork` is the founders' own hours against the
 * things that improve the product; `atMost` is the market's own size, so a
 * breakout in a small market is a small market's breakout.
 */
export function breakoutFor(input: {
  seed: string;
  /** The founders' hours this period on the work itself, out of sixty. */
  hoursOnTheWork: number;
  /** The product, 0–100. */
  quality: number;
  /** Customers today, so the room a hit brings is proportionate to the company. */
  held?: number;
  niche: Pick<Niche, "segments">;
  scale?: number;
  /** Periods in a year, so the odds are per period rather than per year. */
  periods: number;
}): Breakout | null {
  const work = Math.max(0, Math.min(1, input.hoursOnTheWork / 60));
  const good = Math.max(0, Math.min(1, input.quality / 100));
  /*
   * Per period, not per year: the chance is written as a year's chance and
   * shared out, or a monthly season would be twelve times as lucky as a yearly
   * one for no reason anybody chose. Same correction as `founderPace`.
   */
  const aYear = BREAKOUT_BASE + BREAKOUT_FROM_WORK * work + BREAKOUT_FROM_QUALITY * good;
  const thisPeriod = aYear / Math.max(1, input.periods);

  const roll = (hash(`${input.seed}:breakout`) % 1_000_000) / 1_000_000;
  if (roll >= thisPeriod) return null;

  const pick = (hash(`${input.seed}:breakout:size`) % 1_000_000) / 1_000_000;
  let seen = 0;
  const chosen = TIERS.find((t) => {
    seen += t.weight;
    return pick < seen;
  }) ?? TIERS[0];

  /*
   * The room it brings is the *views*, converted — not a share of the market
   * and not a multiple of the company.
   *
   * Both of those were tried and both were wrong in the same direction. A
   * share of the market handed a channel holding 4,000 some 30,600 of free
   * capacity in a 765,000-subscriber market: not a lucky break, a transplant.
   * Sizing it to the company instead fixed that and introduced a worse
   * problem, which the full suite found: the hit then *scaled with how big you
   * already were*, so it amplified whoever was already winning. Construction's
   * self-funded route fell to 23% of the best way to play it, the local
   * operator guard went red, and the capital guards followed — a windfall that
   * pays the leader most is not luck, it is interest.
   *
   * A hundred thousand views is a hundred thousand views whoever posts it. So
   * the room is the audience the video actually found, at a conversion nobody
   * would argue with, bounded by the market's own size. Which makes the same
   * hit worth proportionally far more to a small company than a large one —
   * the right way round, and what makes a breakout the lever a founder with
   * nothing can hope for.
   */
  const market = input.niche.segments.reduce((sum, s) => sum + s.size, 0);
  const room = (views: number) => Math.round(Math.min(market * 0.05, views * VIEWS_CONVERT));
  return {
    tier: chosen.tier,
    views: chosen.views,
    brand: chosen.brand,
    quality: chosen.quality,
    reputation: chosen.reputation,
    arrived: room(chosen.views),
  };
}

/** What to tell them, in the words somebody would actually use. */
export function breakoutNote(got: Breakout, many: string): string {
  const size = got.tier === "million" ? "a million" : got.tier === "half" ? "half a million" : "a hundred thousand";
  return `One of them took off: past ${size} views. ${got.brand} points of being known, ${got.reputation} of standing, ${got.quality} of what you learned making it, and about ${got.arrived.toLocaleString()} ${many} at the door who had never heard of you — serve them if you have the room. Nobody can buy that; you can only make it more likely.`;
}
