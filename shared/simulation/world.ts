/**
 * The world coming to the company: offers, shocks, and the slower moves a
 * company makes to meet it.
 *
 * The first three phases were about what the five of them decide among
 * themselves. This one is about what arrives from outside and has to be
 * answered — a partner with a deal, a buyer with a number, a breach that is
 * in the papers — and the patient decisions that pay out over years:
 * improvement programmes, a region announced a year ahead, insurance that is
 * wasted most years and the only thing that mattered in one.
 *
 * As everywhere else, every chance is seeded from the season, the year and
 * the company, so a year replays exactly.
 */
import type { Company, Niche, Role, Segment } from "./types";
import { marketPriceOf } from "./decisions";
import { rng } from "./random";

/** What a year of the whole market could spend, for pricing things in this market's money. */
export const marketPotential = (niche: Pick<Niche, "segments">): number =>
  marketPriceOf(niche as Niche) * niche.segments.reduce((sum, s) => sum + s.size, 0);

// ─── Deals ───────────────────────────────────────────────────────────────────

export type DealKind = "distribution" | "comarketing" | "buyout";

export interface Deal {
  id: string;
  kind: DealKind;
  /** Who is offering. */
  from: string;
  title: string;
  /** What it gives and what it costs, in a sentence. */
  terms: string;
  /** Distribution: extra room, and brand, for three years, for a share of revenue. */
  capacity?: number;
  brand?: number;
  revenueShare?: number;
  /** Co-marketing: what the company pays; the partner matches it. */
  cost?: number;
  /** Buyout: what the buyer pays for the business. */
  price?: number;
  buyerId?: string;
}

export type DealAnswer = "accept" | "decline" | "vote";

/**
 * The year's offers to one company: one, some years two. A distribution
 * partner and a co-marketing partner can come to anybody; a buyer only comes
 * to a company worth buying — one with customers — and only from year five,
 * when there is something to buy.
 */
export function dealsFor(input: {
  seasonId: string;
  year: number;
  company: Company;
  niche: Niche;
  incumbents: Company[];
  /** What the company is worth to a buyer, for the buyout price. */
  worth: number;
}): Deal[] {
  const { seasonId, year, company, niche, incumbents, worth } = input;
  const r = rng(`${seasonId}:${year}:${company.id}:deals`);
  const partners = ["Northgate", "Brightwell", "Halden & Co", "Castleford", "Meridian", "Oakline"];
  const pot = marketPotential(niche);
  const held = Object.values(company.customers).reduce((sum, n) => sum + n, 0);
  const offers: Deal[] = [];

  const kinds: DealKind[] = ["distribution", "comarketing"];
  const biggest = [...incumbents].sort((a, b) => sum(b.customers) - sum(a.customers))[0];
  if (year >= 5 && held > 0 && biggest && r() < 0.35) kinds.push("buyout");
  const count = r() < 0.4 ? 2 : 1;
  const pool = [...kinds];
  while (offers.length < count && pool.length) {
    const kind = pool.splice(Math.floor(r() * pool.length), 1)[0];
    const from = partners[Math.floor(r() * partners.length)];
    const id = `${year}-${kind}`;
    if (kind === "distribution") {
      const capacity = Math.round(Math.max(held, company.capacity) * (0.08 + r() * 0.08) / 1000) * 1000;
      const revenueShare = Math.round((0.03 + r() * 0.03) * 100) / 100;
      offers.push({
        id, kind, from, capacity, brand: 4, revenueShare,
        title: `${from} want to distribute you`,
        terms: `Room for ${capacity.toLocaleString()} more ${niche.voice.capacityShort} and 4 points of brand for three years, for ${Math.round(revenueShare * 100)}% of revenue for those three years.`,
      });
    } else if (kind === "comarketing") {
      const cost = Math.round(pot * (0.0006 + r() * 0.0006) / 10_000) * 10_000;
      offers.push({
        id, kind, from, cost,
        title: `${from} want a joint campaign`,
        terms: `You put in ${cost.toLocaleString()}, they match it, and the campaign runs under both names — brand for half the price, this year.`,
      });
    } else {
      const price = Math.round(worth * (1.15 + r() * 0.3) / 10_000) * 10_000;
      offers.push({
        id, kind, from: biggest!.name, price, buyerId: biggest!.id,
        title: `${biggest!.name} want to buy the business`,
        terms: `${price.toLocaleString()} for the customers, what you own and what you owe. You keep the company, every seat and the cash, and start again from in front.`,
      });
    }
  }
  return offers;
}

const sum = (m: Record<string, number>) => Object.values(m).reduce((a, n) => a + n, 0);

/**
 * What the table decided about an offer. The chief executive can take it,
 * turn it down, or send it to the table — in which case the other seats'
 * votes decide it, a tie or nobody voting counting as no.
 */
export function dealOutcome(answer: DealAnswer | undefined, votes: ("yes" | "no")[]): { accepted: boolean; byVote: boolean } {
  if (answer === "accept") return { accepted: true, byVote: false };
  if (answer !== "vote") return { accepted: false, byVote: false };
  const yes = votes.filter((v) => v === "yes").length;
  return { accepted: yes > votes.length - yes && yes > 0, byVote: true };
}

/** How long a distribution deal runs. */
export const DEAL_YEARS = 3;

// ─── Shocks and how they are answered ────────────────────────────────────────

export interface Shock {
  kind: "breach" | "lawsuit" | "scandal" | "recall" | "outage";
  year: number;
  /** Reputation it cost, for the answer to win some of it back. */
  reputation: number;
  headline: string;
}

export type ShockAnswer = "statement" | "silence" | `blame_${"cmo" | "cfo" | "cto" | "coo"}`;

/**
 * What an answer does, the year after.
 *
 * A statement wins back half of what the shock cost and costs a little to
 * make well. Silence wins nothing back and reads as evasive. Blaming a seat
 * wins back the most — somebody has been held responsible — and costs that
 * seat a great deal of loyalty. Reputation moves whichever is chosen.
 */
export const SHOCK_ANSWERS = {
  statement: { recover: 0.5, loyalty: 0 },
  silence: { recover: -0.15, loyalty: 0 },
  blame: { recover: 0.7, loyalty: -25 },
} as const;

export function answerShock(shock: Shock, answer: ShockAnswer | undefined): { reputation: number; blamed: Role | null; loyalty: number } {
  if (answer?.startsWith("blame_")) {
    return { reputation: shock.reputation * SHOCK_ANSWERS.blame.recover, blamed: answer.slice(6) as Role, loyalty: SHOCK_ANSWERS.blame.loyalty };
  }
  const a = answer === "statement" ? SHOCK_ANSWERS.statement : SHOCK_ANSWERS.silence;
  return { reputation: shock.reputation * a.recover, blamed: null, loyalty: 0 };
}

/** What a well-made statement costs: a small share of what the market could spend. */
export const statementCost = (niche: Niche): number => Math.round(marketPotential(niche) * 0.0002 / 1000) * 1000;

/**
 * A lawsuit: a small chance each year from year three, larger for a company
 * that has been cutting corners on service. Costs a share of revenue to
 * settle and some reputation. Insurance pays most of the money, never the
 * reputation.
 */
export function lawsuitOf(input: { service: number; seed: string; year: number }): { cost: number; reputation: number } | null {
  if (input.year < 3) return null;
  const chance = 0.03 + Math.max(0, 50 - input.service) / 1000;
  if (rng(input.seed)() >= chance) return null;
  return { cost: 0.03, reputation: 4 };
}

// ─── Insurance ───────────────────────────────────────────────────────────────

export type Cover = "none" | "breach" | "lawsuit" | "poaching" | "all";

/** Premium as a share of revenue, per year. */
export const PREMIUM: Record<Cover, number> = { none: 0, breach: 0.005, lawsuit: 0.004, poaching: 0.003, all: 0.01 };
/** Share of a covered loss the insurer pays. */
export const PAYOUT = 0.8;

export const covers = (cover: string | undefined, risk: "breach" | "lawsuit" | "poaching"): boolean =>
  cover === "all" || cover === risk;

// ─── Dividends ───────────────────────────────────────────────────────────────

/**
 * Paying out rather than reinvesting. The founders' share of what is paid out
 * is theirs for good — banked in what they own, safe from whatever happens to
 * the company after — and the investors' share keeps them patient: a year in
 * which they were paid at least a twentieth of what they put in is not held
 * against the company if their target is missed.
 */
export function dividend(input: { profit: number; payoutPct: number | undefined; founderShare: number }): { paid: number; founders: number; investors: number } {
  const pct = Math.max(0, Math.min(100, Number(input.payoutPct) || 0)) / 100;
  const paid = Math.max(0, input.profit) * pct;
  const founders = paid * Math.max(0, Math.min(1, input.founderShare));
  return { paid, founders, investors: paid - founders };
}

export const PATIENT_INVESTORS = 0.05;

// ─── The offer ───────────────────────────────────────────────────────────────

export type Promo = "none" | "free_month" | "january";

/**
 * A promotion: more appealing to people who watch the price, paid for in
 * margin — and the customers it wins are deal-chasers, who leave faster next
 * year. The finance seat will notice who they attracted.
 */
export const PROMO = {
  none: { appeal: 0, newRevenue: 1, allRevenue: 1 },
  /** First month free: only new customers pay less, eleven months of twelve. */
  free_month: { appeal: 0.16, newRevenue: 11 / 12, allRevenue: 1 },
  /** A January sale: a little more appealing, and everyone pays a little less. */
  january: { appeal: 0.09, newRevenue: 1, allRevenue: 0.96 },
} as const;

export const promoOf = (p?: string) => PROMO[(p as Promo) in PROMO ? (p as Promo) : "none"];

/** How much more appealing a promotion makes a company to a segment: the more it watches the price, the more. */
export const promoAppeal = (promo: string | undefined, segment: Pick<Segment, "priceSensitivity">): number =>
  1 + promoOf(promo).appeal * segment.priceSensitivity;

/** Of the customers a promotion won, the share who leave the following year on top of the usual. */
export const DEAL_CHASERS_LEAVE = 0.35;

// ─── Win-back ────────────────────────────────────────────────────────────────

/**
 * Bringing back last year's leavers. Cheaper than finding new people — a
 * third of what they pay in a year each — but only if whatever drove them off
 * was fixed. A company that got no better at the thing they left over wins
 * back a fifth of what it would have.
 */
export function winBack(input: {
  spend: number | undefined;
  left: number;
  referencePrice: number;
  fixed: boolean;
}): number {
  const spend = Math.max(0, Number(input.spend) || 0);
  if (spend <= 0 || input.left <= 0) return 0;
  const each = input.referencePrice / 3;
  const reached = Math.min(input.left, spend / Math.max(1, each));
  return Math.round(reached * (input.fixed ? 1 : 0.2));
}

// ─── Research ────────────────────────────────────────────────────────────────

export type Research = "none" | "expectations" | "rivals";

/** What a research report costs: a small share of what the market could spend. */
export const researchCost = (niche: Niche): number => Math.round(marketPotential(niche) * 0.0005 / 1000) * 1000;

// ─── Improvement programmes ──────────────────────────────────────────────────

export type ProgrammeId = "process" | "vendor" | "quality" | "green" | "benchmarking";

export interface Programme {
  id: ProgrammeId;
  started: number;
}

/**
 * The menu. Each pays out a third of its effect in each of the three years
 * after it starts — slow, cumulative, and permanent — and one can be started a
 * year.
 */
export const PROGRAMMES: Record<ProgrammeId, { name: string; blurb: string; unitCost?: number; quality?: number; reputation?: number; brand?: number; service?: number }> = {
  process: { name: "Process redesign", blurb: "Every unit a little cheaper to make: 6% off, over three years.", unitCost: 0.94 },
  vendor: { name: "Vendor consolidation", blurb: "Fewer, better suppliers: 4% off unit costs and a little more reliable.", unitCost: 0.96, quality: 2 },
  quality: { name: "Quality programme", blurb: "Six points of quality, arriving over three years.", quality: 6 },
  green: { name: "Going green", blurb: "Five points of reputation and two of brand, over three years. People notice.", reputation: 5, brand: 2 },
  benchmarking: { name: "Benchmarking", blurb: "Learning from the best: six points of service over three years.", service: 6 },
};

/** A programme's price: a fixed share of what the market could spend. */
export const programmeCost = (niche: Niche): number => Math.round(marketPotential(niche) * 0.001 / 1000) * 1000;

/** What running programmes deliver this year: a third of each, in each of the three years after it started. */
export function programmeYield(programmes: Programme[] | undefined, year: number): { unitCost: number; quality: number; reputation: number; brand: number; service: number } {
  const out = { unitCost: 1, quality: 0, reputation: 0, brand: 0, service: 0 };
  for (const p of programmes ?? []) {
    if (year <= p.started || year > p.started + 3) continue;
    const e = PROGRAMMES[p.id];
    if (e.unitCost) out.unitCost *= Math.pow(e.unitCost, 1 / 3);
    out.quality += (e.quality ?? 0) / 3;
    out.reputation += (e.reputation ?? 0) / 3;
    out.brand += (e.brand ?? 0) / 3;
    out.service += (e.service ?? 0) / 3;
  }
  return out;
}

// ─── Expansion ───────────────────────────────────────────────────────────────

/**
 * The region announced for next year: one place the company does not yet
 * sell, seeded by the season and year, so the table has a year to argue
 * about it. Opened through operations it costs 70% of the usual entry — and
 * in its first year it only reaches as far as the brand does.
 */
export function announcedRegion(input: { niche: Niche; seasonId: string; year: number; open: string[] }): Niche["cities"][number] | null {
  const closed = input.niche.cities.filter((c) => !input.open.includes(c.id));
  if (!closed.length) return null;
  return closed[Math.floor(rng(`${input.seasonId}:${input.year}:region`)() * closed.length)];
}

export const EXPANSION_DISCOUNT = 0.7;

/** How much of a newly opened region a company reaches in its first year there: as far as its brand does. */
export const firstYearReach = (brand: number): number => Math.max(0.15, Math.min(1, brand / 60));
