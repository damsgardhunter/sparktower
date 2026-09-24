/**
 * The people a business actually employs.
 *
 * The five seats are the players. Everybody else — the ones who cook the
 * food, fly the drones, answer the phone, write the code — is the operations
 * seat's `headcount`, and until now a head was a head: one flat salary,
 * identical in every market, and the only thing it bought back was service.
 *
 * That is why nobody ever hired one. Measured over fourteen years in all
 * seven markets, `headcount` ended at zero in every season — a restaurant
 * chain turning over £50.7m and serving 2.8 million covers with nobody behind
 * the counter, because hiring was priced as a pure cost and the game let it
 * work.
 *
 * ## Why the kinds are the market's, not the engine's
 *
 * A kitchen hires chefs and a studio hires engineers, and the difference is
 * not decoration: a chef costs half what an engineer costs, and what the two
 * of them buy is not the same thing. A chef is *room* — covers you can
 * actually serve. An engineer is *product*. A rider is room again, and cheap.
 * A site manager is dear and is both.
 *
 * So the mix belongs to the market, beside the rest of its vocabulary in
 * `voice`, and the restaurant's own description of capacity already says so:
 * "how many covers you can actually serve, which is a staffing problem long
 * before it is a building problem."
 *
 * A market Nova writes gets its own workforce for the same reason — see
 * `server/nova-market.ts`. A market that arrives without one is given a
 * sensible mix rather than an error, because a season that cannot start is
 * worse than a season whose people are described generically.
 */
import type { Niche } from "./types";
import { SALARY } from "./decisions";

/** One kind of person a business in this market employs. */
export interface WorkKind {
  id: string;
  /** What this market calls them, plural: "chefs", "engineers", "riders". */
  name: string;
  /** One of them, for a sentence that needs a singular: "a chef". */
  one: string;
  /**
   * What hiring them buys.
   *
   * `room` is the ability to serve at all — the constraint a restaurant hits
   * first. `product` is what the thing is like. `service` is what happens
   * around it. Nothing buys brand: you cannot hire your way to being known.
   */
  does: "room" | "product" | "service";
  /** What one costs a year, as a multiple of the ordinary salary. */
  pay: number;
  /** Roughly how many of them a company of this kind needs, as a share of its people. */
  share: number;
}

/**
 * A mix for a market that did not describe one.
 *
 * Deliberately bland, and deliberately not an error: a season that cannot
 * start because a market Nova wrote left a field out is a worse outcome than
 * one whose people are called "staff".
 */
export const GENERIC_WORKFORCE: WorkKind[] = [
  { id: "operators", name: "operators", one: "an operator", does: "room", pay: 0.85, share: 0.55 },
  { id: "makers", name: "makers", one: "a maker", does: "product", pay: 1.3, share: 0.25 },
  { id: "support", name: "support staff", one: "a support person", does: "service", pay: 0.8, share: 0.2 },
];

/** The people this market employs, whoever wrote it. */
export function workforceFor(niche: Pick<Niche, "workforce">): WorkKind[] {
  const written = niche.workforce;
  if (!written?.length) return GENERIC_WORKFORCE;
  // Shares are normalised here rather than trusted, because a market Nova
  // wrote can hand over three kinds that add up to 1.4.
  const total = written.reduce((sum, k) => sum + Math.max(0, k.share), 0);
  if (total <= 0) return GENERIC_WORKFORCE;
  return written.map((k) => ({ ...k, share: Math.max(0, k.share) / total }));
}

/**
 * What one head costs a year in this market.
 *
 * The mix's own weighted pay, so a kitchen's people are cheaper than a
 * studio's and the operations seat's hiring decision is a different decision
 * in each — which is most of what makes two markets feel different to run
 * rather than only different to read.
 */
export function salaryIn(niche: Pick<Niche, "workforce">): number {
  const mix = workforceFor(niche);
  return Math.round(SALARY * mix.reduce((sum, k) => sum + k.pay * k.share, 0));
}

/** How a head's effort splits across the three things people can buy. */
export function effortIn(niche: Pick<Niche, "workforce">): { room: number; product: number; service: number } {
  const mix = workforceFor(niche);
  const out = { room: 0, product: 0, service: 0 };
  for (const kind of mix) out[kind.does] += kind.share;
  return out;
}

/**
 * How many customers one head can serve in this market.
 *
 * Only the kinds that make room count, so a market whose people are mostly
 * engineers needs far fewer of them per customer than one whose people are
 * mostly riders. Scaled off the market's own reference so it does not have to
 * be written down twice.
 */
export function servesPerHead(niche: Pick<Niche, "workforce" | "segments">): number {
  const room = effortIn(niche).room;
  if (room <= 0) return Infinity; // Nobody here serves customers directly.
  const people = niche.segments?.reduce((sum, s) => sum + s.size, 0) ?? 0;
  // A market's whole population served by a thousand people at full room:
  // the number itself matters less than that it differs between markets.
  return Math.max(50, Math.round((people / 1000) * room));
}
