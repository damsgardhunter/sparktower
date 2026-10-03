/**
 * Nova writes the market, instead of picking one of the seven.
 *
 * The seven are hand-balanced worlds and they cover a lot of businesses. They
 * do not cover everybody. Somebody building scheduling software for veterinary
 * practices is told to go and play at dating apps, which teaches the mechanics
 * and nothing about their business — and the whole promise of this feature is
 * that the simulation is *theirs*.
 *
 * So this asks for the market itself: who the buyers are and what they weigh
 * when they choose, where it exists, who is already there, and the words it
 * uses. Those are the dimensions of the game. Getting them from the business
 * rather than from a menu is what makes a season feel like a rehearsal for
 * the real thing.
 *
 * ## Small markets
 *
 * The instinct of a model asked to invent a market is to make it enormous,
 * because enormous sounds impressive. Most real businesses are not in enormous
 * markets, and a market of four hundred million makes every decision cosmetic:
 * nothing a five-person company does moves a number that size, so the season
 * becomes a spreadsheet nobody can affect.
 *
 * A small market is a better game, not a worse one. Fewer buyers who are
 * harder to win, where one big account matters and losing two hurts. The
 * prompt says so, and `custom-market.ts` clamps the answer either way.
 *
 * The prompt and the parse live here, pure and tested. The model call and the
 * writing of the season live in the route, where the entitlement is.
 */
import { parseModelJson } from "./ai-json";
import { winnabilityOf } from "@shared/simulation/winnable";
import { buildCustomMarket, MIN_SEGMENT_SIZE, MAX_SEGMENT_SIZE, MIN_SEGMENTS, MAX_SEGMENTS, MIN_REGIONS, MAX_REGIONS, MIN_INCUMBENTS, MAX_INCUMBENTS, RIVALS_IN_A_CUSTOM_SEASON } from "@shared/simulation/custom-market";
import type { Niche } from "@shared/simulation/types";

const str = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** What Nova is told about the business, and the shape it has to answer in. */
export function buildMarketPrompt(input: {
  project: { title?: string | null; description?: string | null; goal?: string | null; category?: string | null };
  company?: { name?: string | null; industry?: string | null; description?: string | null } | null;
  /** Where the project has actually got to, in whatever words the app has. */
  progress?: string | null;
  /**
   * Write it at the scale the people asking are actually at.
   *
   * The ordinary market is written for a company with six million in the bank
   * deciding how to spend it. A project on this platform usually has a laptop
   * and some savings, and handing it a market where the opening move costs
   * £900,000 teaches nothing it can use on Monday. In this mode the market is
   * small enough that the money in `season.ts` scales down with it — same
   * ratios, same decisions, a size somebody recognises.
   */
  startup?: boolean;
}): { system: string; user: string } {
  const startup = !!input.startup;
  return {
    system: [
      "You design the market a real business competes in, so its founders can rehearse running it.",
      "",
      "You are not choosing from a list. You are writing the world: who buys, what they weigh when",
      "they choose, where they are, who already has them, and what this trade calls things.",
      "",
      startup
        ? [
            "SIZE. This is the market a founder can actually reach in their first few years, not the",
            "whole world's version of it. Write the beachhead: one country or a handful of cities,",
            `the buyers they could name. A segment is between ${MIN_SEGMENT_SIZE.toLocaleString()} and 60,000 buyers, and the`,
            "smaller end is usually the honest one — a few thousand who are hard to win and expensive",
            "to lose is a better game than millions nobody can move. Do not write a national or global",
            "total addressable market; that is a pitch deck, not a place to trade.",
          ].join("\n")
        : [
            "SIZE. Write the market as big as it really is and no bigger. Most businesses are not in",
            `enormous markets. A segment is between ${MIN_SEGMENT_SIZE.toLocaleString()} and ${MAX_SEGMENT_SIZE.toLocaleString()} buyers;`,
            "if the real market is small, say small — a few thousand buyers who are hard to win and",
            "expensive to lose is a better game than millions nobody can move. If it is genuinely large,",
            "the cap is not a reason to pretend otherwise; it is the scale this engine plays at.",
          ].join("\n"),
      "",
      /*
       * Named and counted, the way the incumbents are.
       *
       * This used to ask for "two to five groups" and a model asked for a range
       * takes the floor: three markets written from three real projects came
       * back with two segments and three regions every time — the minimum of
       * both. Two segments is two positioning choices, two price tiers and a
       * market that plays the same shape whatever the business is. The
       * incumbents block below has always said "exactly four, not three, not
       * five" and named the four, and it gets four every time.
       */
      "SEGMENTS are the dimensions that make the game theirs. Exactly four groups — not two, not",
      "three — who want different things and disagree about price. Four because two is a coin flip",
      "and the whole game is choosing who you are for.",
      "  Most trades have roughly these four, in their own words: the many small buyers who feel",
      "  every pound; the solid middle who will pay for something that works; the large buyer with",
      "  procurement, a security review and the deepest pockets; and the awkward one nobody serves",
      "  properly — a niche with an odd requirement, or people using something not built for this.",
      "  If this trade genuinely has a different four, write those instead. Do not pad to four with",
      "  two halves of the same group.",
      "The five weights are 0 to 1 and should differ between",
      "segments — a market where everyone weighs everything the same has no decisions in it.",
      "  priceSensitivity: how much a higher price puts them off.",
      "  qualityFocus: how much they notice the product being better.",
      "  brandFocus: how much they need to have heard of you.",
      "  serviceFocus: how much support and reliability matter after the sale.",
      "  loyalty: how hard they are to move once they have chosen. This is the incumbents' moat.",
      "  referencePrice: what this segment considers a normal price, in whole US dollars.",
      "",
      startup
        ? "REGIONS: five or six places this market exists, with weights that sum to 1 and an entry cost each."
        : `REGIONS: ${MIN_REGIONS} to ${MAX_REGIONS} places this market exists, with weights that sum to 1 and an entry cost each.`,
      "They can be countries, cities, or kinds of place — whatever this business actually thinks in.",
      "Five or six because where to go next is a decision, and three places is barely one. Make them",
      "differ: one obvious home, one big and expensive, one small and cheap, and the rest in between.",
      "segmentMix says who over-indexes where: 1.3 means a third more of that segment than average.",
      "",
      startup
        ? `INCUMBENTS: exactly ${RIVALS_IN_A_CUSTOM_SEASON} companies already holding this market — not three, not five.`
        : `INCUMBENTS: ${MIN_INCUMBENTS} to ${MAX_INCUMBENTS} companies already holding this market. Real-sounding, not real names.`,
      startup
        ? [
            "These are the whole competition — nobody else is seated — so make them the four a",
            "founder in this trade would actually name: the one everybody defaults to, the cheap one,",
            "the one for bigger customers, and the adjacent tool that does this as a side feature.",
            "Real-sounding, not real names, and no trademarks.",
            "Their startingShare is not a formality — it is the answer to the first question a",
            "founder asks about a market, which is whether there is room in it. Say what is true of",
            "this trade:",
            "  A settled market with entrenched names — most software, most retail — has them holding",
            "  0.70 to 0.85 between them, and getting in is the whole difficulty.",
            "  A trade that is still forming, or one that is mostly served badly by generalists and",
            "  spreadsheets, has them holding 0.35 to 0.55, and the difficulty is elsewhere: reaching",
            "  people, being believed, building the thing.",
            "Do not default to the middle. A local trade nobody has productised yet and a market with",
            "four national incumbents are different games, and this number is what makes them so.",
          ].join("\n")
        : "Between them they hold most of it.",
      "Give each a posture — fortress, brawler, coaster or",
      "innovator — and a persona with a knock, which is the way in for a newcomer.",
      "",
      "VOICE: what this trade calls a customer, a sale, capacity and a region. A vet practice has",
      "clinics and licences, not users and units.",
      "",
      "WORKFORCE: two to four kinds of people this business employs beneath the five founders —",
      "the ones who do the work. A kitchen has chefs and front of house; a studio has engineers",
      "and game masters; a practice has vets and receptionists. For each:",
      "  does: what hiring them buys. \"room\" is the ability to serve customers at all, \"product\"",
      "    is what the thing is like, \"service\" is what happens around it. Nothing buys brand.",
      "  pay: what one costs against an ordinary salary. 0.6 is low-paid, 1.8 is a senior engineer.",
      "  share: roughly what fraction of the payroll they are. They should sum to about 1.",
      "Be specific to the trade. \"Staff\" is not an answer; \"dispatchers\" is.",
      "",
      "",
      "ASSETS — nine things this market lets a company buy, in this exact order and kind:",
      "  1 distribution, 2 distribution, 3 celebrity, 4 patent, 5 patent,",
      "  6 facility, 7 facility, 8 brand_licence, 9 brand_licence.",
      "Name each one as this trade would name it, and say in one line what it buys.",
      "The shapes are fixed and the words are yours: a \"facility\" is whatever lets this",
      "business serve more people at once — another region of cloud capacity for software,",
      "a second kitchen for a restaurant, a bonded warehouse for a distributor. A",
      "\"distribution\" deal is somebody else's route to customers. Do not answer with retail",
      "shelves unless this business actually has shelves.",
      "",
      "",
      "baseUnitCost is what serving ONE customer for one period actually costs you —",
      "the marginal cost, not the company's overheads, which are modelled elsewhere.",
      "It must be comfortably below the CHEAPEST segment's referencePrice, or that",
      "segment cannot be sold to at all and the market is unplayable for it.",
      "Software, marketplaces and anything delivered over a network: a small fraction",
      "of the price — hosting, support, payment fees. Physical goods, food, hardware,",
      "logistics: a large fraction, sometimes most of it. Say what is true of this trade.",
      "",
      "Answer as JSON only, no prose:",
      '{"name":"","premise":"one or two sentences","baseUnitCost":0,"innovationPace":1,',
      '"voice":{"customer":"","customers":"","unit":"","per":"","capacity":"","place":"","places":"","quality":"","brand":""},',
      '"segments":[{"id":"","name":"","description":"","size":0,"growth":0.05,"priceSensitivity":0.5,"qualityFocus":0.5,"brandFocus":0.4,"serviceFocus":0.4,"loyalty":0.4,"referencePrice":0}],',
      '"workforce":[{"id":"","name":"","one":"","does":"room","pay":1,"share":0.5}],',
      '"assets":[{"kind":"distribution","name":"","blurb":""}],',
      '"regions":[{"id":"","name":"","weight":0.25,"entryCost":0,"note":"","segmentMix":{}}],',
      '"incumbents":[{"id":"","name":"","posture":"fortress","startingShare":0.3,"quality":60,"brand":70,"service":50,"priceIndex":1.1,',
      '  "persona":{"tagline":"","boss":"","character":"","known":"","knock":"","voice":""}}]}',
    ].join("\n"),
    user: [
      `WHAT THEY ARE BUILDING\n${str(input.project.title, 200)}`,
      input.project.description ? `${str(input.project.description, 2500)}` : "",
      input.project.category ? `Category: ${str(input.project.category, 80)}` : "",
      input.project.goal ? `Their goal: ${str(input.project.goal, 200)}` : "",
      "",
      input.company?.name ? `COMPANY\n${str(input.company.name, 120)}` : "",
      input.company?.industry ? `Industry: ${str(input.company.industry, 120)}` : "",
      input.company?.description ? `About: ${str(input.company.description, 1200)}` : "",
      "",
      input.progress ? `WHERE THEY HAVE GOT TO\n${str(input.progress, 2000)}` : "",
    ].filter(Boolean).join("\n"),
  };
}

/**
 * The market that came back, made playable — or null, which means use one of
 * the seven. Never throws: `parseModelJson` refuses prose, and a refusal here
 * is an answer rather than an exception thrown at somebody who pressed a
 * button.
 */
export function parseMarket(
  raw: string,
  fallbackId: string,
  opts: {
    /**
     * Whether to refuse a market a business cannot be built in.
     *
     * True when Nova has just written one, which is the only moment refusing is
     * useful — the route falls back to the catalogue and the player is told the
     * market is not theirs.
     *
     * **False when replaying a market a project already owns.** A stored market
     * that failed this check would come back as "nothing to replay", which is a
     * worse outcome than the one being prevented: it is a season somebody has
     * already played being declared not to exist. If an old market is unwinnable
     * that is worth knowing, and it is not worth taking their season away to say
     * so.
     */
    check?: boolean;
  } = {},
): Niche | null {
  let parsed: unknown;
  try {
    parsed = parseModelJson(raw, "market");
  } catch {
    return null;
  }
  /* Nova has just written it, so this is the one moment the market may be changed. */
  const written = buildCustomMarket(parsed, fallbackId, { fresh: true });
  if (!written) return null;

  /*
   * And the one moment it can still be refused.
   *
   * `buildCustomMarket` checks the market's *shape* — every number clamped to a
   * range the engine survives, the shares normalised rather than rejected — and
   * says nothing about whether a business can be built in it. Three faults have
   * produced markets nobody could play (rivals seated across the whole of a
   * segment, the same arriving through the economy, an opening plant whose idle
   * cost bankrupted the founder), and each was found by sweeping the catalogue
   * rather than by anybody reporting it. They would not have been reported: a
   * season that cannot be won is not a bug, it is a fortnight somebody spends
   * losing and concludes they are bad at it.
   *
   * So a market that cannot be won is treated as a market that did not come back.
   * Returning null is already the documented answer for an unreadable one and the
   * route already handles it — it falls back to the nearest of the seven and tells
   * the player the market is not theirs — which is a far better outcome than a
   * bespoke market they cannot play. 57ms, against a model call of several
   * seconds.
   *
   * Logged with what was wrong, because this is the only trace left: the fallback
   * is silent by design, so without this nobody could tell a model writing bad
   * markets from a guard that had become too strict.
   */
  if (opts.check === false) return written;
  const verdict = winnabilityOf(written);
  if (!verdict.ok) {
    console.warn(
      `[nova-market] refused an unwinnable market (${written.id}): ${verdict.problems.join("; ")} ` +
      `— checked ${verdict.checked.periods} periods on seed(s) ${verdict.checked.seeds.join(", ")}. Falling back to the catalogue.`,
    );
    return null;
  }
  return written;
}
