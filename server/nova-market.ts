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
import { buildCustomMarket, MIN_SEGMENT_SIZE, MAX_SEGMENT_SIZE, MIN_SEGMENTS, MAX_SEGMENTS, MIN_REGIONS, MAX_REGIONS, MIN_INCUMBENTS, MAX_INCUMBENTS } from "@shared/simulation/custom-market";
import type { Niche } from "@shared/simulation/types";

const str = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** What Nova is told about the business, and the shape it has to answer in. */
export function buildMarketPrompt(input: {
  project: { title?: string | null; description?: string | null; goal?: string | null; category?: string | null };
  company?: { name?: string | null; industry?: string | null; description?: string | null } | null;
  /** Where the project has actually got to, in whatever words the app has. */
  progress?: string | null;
}): { system: string; user: string } {
  return {
    system: [
      "You design the market a real business competes in, so its founders can rehearse running it.",
      "",
      "You are not choosing from a list. You are writing the world: who buys, what they weigh when",
      "they choose, where they are, who already has them, and what this trade calls things.",
      "",
      "SIZE. Write the market as big as it really is and no bigger. Most businesses are not in",
      `enormous markets. A segment is between ${MIN_SEGMENT_SIZE.toLocaleString()} and ${MAX_SEGMENT_SIZE.toLocaleString()} buyers;`,
      "if the real market is small, say small — a few thousand buyers who are hard to win and",
      "expensive to lose is a better game than millions nobody can move. If it is genuinely large,",
      "the cap is not a reason to pretend otherwise; it is the scale this engine plays at.",
      "",
      "SEGMENTS are the dimensions that make the game theirs. Two to five groups who want different",
      "things and disagree about price. The five weights are 0 to 1 and should differ between",
      "segments — a market where everyone weighs everything the same has no decisions in it.",
      "  priceSensitivity: how much a higher price puts them off.",
      "  qualityFocus: how much they notice the product being better.",
      "  brandFocus: how much they need to have heard of you.",
      "  serviceFocus: how much support and reliability matter after the sale.",
      "  loyalty: how hard they are to move once they have chosen. This is the incumbents' moat.",
      "  referencePrice: what this segment considers a normal price, in whole pounds.",
      "",
      `REGIONS: ${MIN_REGIONS} to ${MAX_REGIONS} places this market exists, with weights that sum to 1 and an entry cost each.`,
      "They can be countries, cities, or kinds of place — whatever this business actually thinks in.",
      "segmentMix says who over-indexes where: 1.3 means a third more of that segment than average.",
      "",
      `INCUMBENTS: ${MIN_INCUMBENTS} to ${MAX_INCUMBENTS} companies already holding this market. Real-sounding, not real names.`,
      "Between them they hold most of it. Give each a posture — fortress, brawler, coaster or",
      "innovator — and a persona with a knock, which is the way in for a newcomer.",
      "",
      "VOICE: what this trade calls a customer, a sale, capacity and a region. A vet practice has",
      "clinics and licences, not users and units.",
      "",
      "Answer as JSON only, no prose:",
      '{"name":"","premise":"one or two sentences","baseUnitCost":0,"innovationPace":1,',
      '"voice":{"customer":"","customers":"","unit":"","per":"","capacity":"","place":"","places":"","quality":"","brand":""},',
      '"segments":[{"id":"","name":"","description":"","size":0,"growth":0.05,"priceSensitivity":0.5,"qualityFocus":0.5,"brandFocus":0.4,"serviceFocus":0.4,"loyalty":0.4,"referencePrice":0}],',
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
export function parseMarket(raw: string, fallbackId: string): Niche | null {
  let parsed: unknown;
  try {
    parsed = parseModelJson(raw, "market");
  } catch {
    return null;
  }
  return buildCustomMarket(parsed, fallbackId);
}
