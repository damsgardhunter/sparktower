/**
 * A year, resolved.
 *
 * One pure function: a world plus everyone's decisions goes in, the next world
 * and a report for every company comes out. No clock, no database, no
 * randomness — which is what lets a season be replayed exactly, a bug be
 * reproduced from a saved world, and a player be told precisely why last year
 * went the way it did.
 *
 * The order below is the order things actually happen in, and it matters:
 *
 *   1. Everyone's decisions become the company they will be judged as.
 *   2. Incumbents decide, seeing the players as they now are.
 *   3. The market allocates customers — the only step where anyone competes.
 *   4. Money settles: revenue, costs, interest, and what that does to credit.
 *   5. Reputation moves, last, because it is a consequence rather than a lever.
 */
import type { Company, Economy, Niche, World } from "./types";
import { inPeriodWords } from "./cadence";
import { allocate, marketShares } from "./market";
import { incumbentYear } from "./incumbents";
import { fixedCosts, focusEffects, interlock, lift, debtDrag, nextTechDebt, sanitiseDecisions, idleCapacityCost, marketPriceOf, taxOn, FOCUS_NOTES, type Focus, type TeamDecisions } from "./decisions";
import { shortfalls, expectationsFor, weightsOf } from "./criteria";
import { assetEffects, ageAssets, stillHeld } from "./assets";
import { brandLanding, capacityBuild, qualityLanding, staffing } from "./lag";
import {
  EMERGENCY_REPUTATION, RATING_START, applyRepayment, boardChiefExecutive, creditMultiplier,
  interestOn, justifiedRating, nextRating, ratingGrade, reviewInvestors, termsFor,
} from "./finance";
import { reachOf, appealFor, atScale } from "./market";
import { eventsDue, economyWithWeather, companyWithEvents, nextWeather, type MarketEvent } from "./events";
import {
  BOND_TERM, COVENANT_COVER, COVENANT_PENALTY, COVENANT_RATING_HIT, FREE_SERVE_COST, PREPAID_SHARE,
  annualPlans, bondTotal, capacityMoney, drawdown, forecastOutcome, freeTierBrand, fundYear, isUnlocked, priceFor, takings,
  type Bond,
} from "./responsibilities";
import {
  OVERRULE_LOYALTY, REVIEW_SERVICE, RESIGN_AT, STAFF_QUALITY_START, WARN_AT, effort, payEffect, personOf, poached,
  reviewSaving, staffLeverage, staffQualityNext, yearLoyalty,
} from "./people";
import { ROLE_TITLES, type Role } from "./types";
import {
  OUTAGE, breachOf, dataEffects, dataNext, featureCost, featureMenu, outageChance, paceOf, placeBet, prOutcome,
  referralBrand, securityNext, swingOf,
} from "./product";
import { rng } from "./random";
import { entrantsFor } from "./entrants";
import { NICHE_LIMIT, mergeSimilar, nicheFor, withOpenedNiches, type OpenedNiche } from "./niche-openings";
import { automationCost, automationEffect, automationNext, shiftCapacity, sourcingOf, stockCost } from "./factory";
import { REFINANCE_TERM_YEARS, buyback, factoring, refinance, termsOf } from "./treasury";
import {
  DEAL_YEARS, EXPANSION_DISCOUNT, PAYOUT, PATIENT_INVESTORS, PREMIUM, PROGRAMMES, announcedRegion, answerShock, covers, expansionOutcome,
  dealOutcome, dealsFor, dividend, firstYearReach, lawsuitOf, programmeCost, programmeYield, promoOf, researchCost,
  statementCost, winBack, type Cover, type Shock, type ShockAnswer,
} from "./world";
import { valuation, applyAcquisition } from "./mergers";

/** What one company is told about the year it just had. */
export interface CompanyReport {
  companyId: string;
  name: string;
  year: number;

  customers: number;
  marketShare: number;
  shareChange: number;
  /** Customers who wanted them and couldn't be served. */
  turnedAway: number;

  revenue: number;
  costs: number;
  profit: number;
  cash: number;
  debt: number;

  reputation: number;
  reputationChange: number;
  quality: number;
  brand: number;
  service: number;

  /** Where the company stands against everyone in the niche, 1 is best. */
  rank: number;
  /**
   * What the business is worth: a bit over a year of sales, plus what it owns,
   * minus what it owes. The same arithmetic a buyer uses in `mergers.ts`.
   */
  value: number;
  /**
   * What the founders' share of that is worth — the number the league table
   * is ordered by.
   *
   * Ranking by customers made volume the only strategy worth playing: a team
   * that ran a smaller, far more profitable company was told every day that it
   * was losing, and the only way to climb was to sell more of everything to
   * anyone. Measuring what the five of them actually own lets a premium
   * business, a cheap one and a regional one all be right, which is the
   * difference between four markets and one market with four names.
   */
  founderValue: number;
  founderShare: number;
  /** Plain-language explanation of what actually happened, and why. */
  notes: string[];
  /**
   * What the marketplace did to this company, typed rather than narrated.
   *
   * Filled in by the tick rather than by the engine — settlement happens after
   * a year resolves, and `resolveYear` knows nothing about auctions. It lives
   * here anyway because it belongs to the year the player is reading.
   *
   * Typed because two clients need to show a won bid differently from a lost
   * one, and the alternative is each of them pattern-matching the prose below.
   * That works right up until the copy is edited, at which point the matching
   * silently stops matching and the feature degrades with nothing failing.
   */
  market?: { kind: "won" | "lost" | "sold" | "unsold"; text: string }[];
  /**
   * The year's auctions as a record: every lot, who bid, who took it and for
   * how much, with this company's own offer beside it.
   *
   * Written by the tick once the auction has settled — the seal covers a bid
   * that can still be changed, and by the time this exists none can. Without
   * it a team that spent a third of its cash at auction could find no trace of
   * it afterwards: the bid rows are deleted at settlement, and one line of
   * prose was the whole record.
   */
  auctions?: {
    listingId: string; name: string; kind: string; reserve: number;
    bidders: number; winner: string | null; winnerId: string | null;
    price: number | null; yourBid?: number | null;
  }[];
  /**
   * The year's event, typed, for the same reason the market outcomes are:
   * a screen that wants to lead with "a supplier failed" should not have to
   * recognise the sentence to know that is what happened.
   */
  event?: { headline: string; body: string; advice: string; scope: "market" | "company"; mine: boolean };
  bankrupt: boolean;
  /** Players only: the rating, the rate it buys, and any emergency loan outstanding. */
  credit?: { score: number; grade: string; rate: number; emergencyDebt: number };
  /** Players only: the investors' terms, if a stake has been sold. */
  investors?: import("./finance").Investors;

  /**
   * The year's accounts, line by line. Players only — a rival's cost base is
   * its own business.
   *
   * Every one of these figures already existed at settlement and was summed
   * into a single `costs` and thrown away. Without the breakdown a team could
   * see that it lost two million and not which of the five of them lost it,
   * which is the one thing a year is supposed to teach.
   */
  pnl?: ProfitAndLoss;
  /** Why the bank balance moved from where it started to where it ended. */
  cashBridge?: CashBridge;
  /** Where every customer came from and went to, segment by segment. */
  segments?: SegmentBridge[];
  /** What everybody else in the market did this year. */
  rivals?: RivalMove[];
}

export interface ProfitAndLoss {
  revenue: number;
  /** Making and delivering what was sold. */
  costToServe: number;
  /** The five seats and everyone else on the payroll, scaled by how widely the company sells. */
  salaries: number;
  marketing: number;
  /** Features, reliability, research and paying down technical debt. */
  product: number;
  /** Support and efficiency. */
  operations: number;
  /** Capacity paid for and not used. */
  idleCapacity: number;
  /** Building and leasing capacity. */
  capacity?: number;
  /** What the forecast saved (positive) or cost (negative). */
  planning?: number;
  /** Cleaning up after breaches and lawsuits, less what insurance paid. */
  incidents?: number;
  /** Distribution partners' share of revenue. */
  partners?: number;
  /** Insurance premiums. */
  insurance?: number;
  interest: number;
  /** Before tax. */
  operatingProfit: number;
  tax: number;
  /** After tax: the figure the year is judged on. */
  profit: number;
  /** Losses still available to set against future profits. */
  lossesCarried: number;
}

export interface CashLine {
  label: string;
  amount: number;
}

export interface CashBridge {
  opening: number;
  lines: CashLine[];
  closing: number;
}

export interface Flow {
  id: string;
  name: string;
  count: number;
}

export interface SegmentBridge {
  segmentId: string;
  name: string;
  start: number;
  /** Customers who chose a rival over you this year, by rival. */
  lostTo: Flow[];
  /** Customers who left a rival for you, by rival. */
  wonFrom: Flow[];
  /** New to the market this year, and chose you. */
  fresh: number;
  /** Chose you and could not be served. */
  turnedAway: number;
  /** Where the turned-away went instead. */
  sentTo: Flow[];
  /** Turned away by a rival who was full, and taken in by you. */
  pickedUp: number;
  /** Rounding across a market of millions; shown only when it is not trivial. */
  other: number;
  end: number;
  /** The biggest loss, explained in one sentence. Null when nothing was lost. */
  why: string | null;
  /** Where you fell below what this segment expected this year. */
  shortOf: { axis: string; by: number; expected: number }[];
}

export interface RivalMove {
  id: string;
  name: string;
  kind: "player" | "incumbent";
  priceBefore: number;
  priceAfter: number;
  /** The segment a team declared itself for, by name. */
  positioning: string | null;
  /** Segments an incumbent has stopped paying to defend, by name. */
  conceded: string[];
  /** Roughly what it spent on marketing, product and operations — rounded, because it is an estimate from outside. */
  spent: number;
  shareBefore: number;
  shareAfter: number;
  capacityBefore: number;
  capacityAfter: number;
}

export interface YearResult {
  world: World;
  reports: CompanyReport[];
  /** What happened to the market this year, if anything did. */
  event: MarketEvent | null;
}

/** Bounded 0–100. */
const clamp = (n: number): number => Math.max(0, Math.min(100, n));


const money = (n: number): string => `£${Math.round(n).toLocaleString()}`;

/**
 * Why the biggest single loss in a segment happened, in one sentence.
 *
 * "Lost 41,000 swipers to Pairwise" is a fact; "who undercut you by £9" is the
 * lesson, and the lesson is what a year is for. The reason is the axis on which
 * the rival beat you by the most *that this segment cares about* — a rival who
 * was better known does not explain losing a segment that barely notices brand,
 * however large the gap.
 */
function lossReason(me: Company, them: Company, segment: Niche["segments"][number]): string {
  const w = weightsOf(segment);
  const mine = priceFor(me, segment.id);
  const theirs = priceFor(them, segment.id);
  const candidates = [
    { axis: "price", score: (w.price / 100) * Math.max(0, mine - theirs) / Math.max(1, segment.referencePrice),
      text: `who undercut you by ${money(mine - theirs)}` },
    { axis: "quality", score: (w.quality / 100) * Math.max(0, them.quality - me.quality) / 100,
      text: `who were ahead on quality, ${Math.round(them.quality)} to your ${Math.round(me.quality)}` },
    { axis: "brand", score: (w.brand / 100) * Math.max(0, them.brand - me.brand) / 100,
      text: `who were better known, ${Math.round(them.brand)} to your ${Math.round(me.brand)}` },
    { axis: "service", score: (w.service / 100) * Math.max(0, them.service - me.service) / 100,
      text: `who looked after people better, service ${Math.round(them.service)} to your ${Math.round(me.service)}` },
  ].sort((a, b) => b.score - a.score);
  if (candidates[0].score <= 0) {
    return "who were no better on anything this segment weighs — they won on being everywhere you were not, or on who was already holding them";
  }
  return candidates[0].text;
}

/** Where every customer in every segment came from and went to, for one company. */
function segmentBridges(input: {
  company: Company;
  before: Company;
  effective: Map<string, Company>;
  names: Map<string, string>;
  niche: Niche;
  year: number;
  allocation: ReturnType<typeof allocate>;
}): SegmentBridge[] {
  const { company, before, effective, names, niche, year, allocation } = input;
  const me = effective.get(company.id) ?? company;
  const flowList = (m: Record<string, number> | undefined): Flow[] =>
    Object.entries(m ?? {})
      .filter(([, n]) => n > 0)
      .map(([id, count]) => ({ id, name: names.get(id) ?? id, count }))
      .sort((a, b) => b.count - a.count);

  return niche.segments.map((segment) => {
    const sid = segment.id;
    const start = before.customers[sid] ?? 0;
    const end = company.customers[sid] ?? 0;

    const lostTo = flowList(allocation.flows[sid]?.[company.id]);
    const wonFrom: Flow[] = [];
    for (const [from, to] of Object.entries(allocation.flows[sid] ?? {})) {
      const n = to[company.id] ?? 0;
      if (from !== company.id && n > 0) wonFrom.push({ id: from, name: names.get(from) ?? from, count: n });
    }
    wonFrom.sort((a, b) => b.count - a.count);

    const turnedAway = allocation.turnedAway[sid]?.[company.id] ?? 0;
    const sentTo = flowList(allocation.spill[sid]?.[company.id]);
    let pickedUp = 0;
    for (const [from, to] of Object.entries(allocation.spill[sid] ?? {})) {
      if (from !== company.id) pickedUp += to[company.id] ?? 0;
    }

    const lost = lostTo.reduce((sum, f) => sum + f.count, 0);
    const won = wonFrom.reduce((sum, f) => sum + f.count, 0);
    const freshWon = allocation.fresh[sid]?.[company.id] ?? 0;
    /*
     * Rounding, across markets of millions, split a dozen ways. Carried in its
     * own line so the bridge adds up to the customer exactly — a bridge that is
     * out by forty on a screen people will check with a calculator is a bridge
     * nobody trusts afterwards.
     */
    const other = end - (start - lost + won + freshWon - turnedAway + pickedUp);

    const biggest = lostTo[0];
    const rival = biggest ? effective.get(biggest.id) : undefined;
    const why = biggest && rival && biggest.count >= Math.max(50, start * 0.01)
      ? `Lost ${biggest.count.toLocaleString()} ${segment.name.toLowerCase()} to ${biggest.name}, ${lossReason(me, rival, segment)}.`
      : null;

    const { floors } = expectationsFor(segment, year);
    const shortOf = shortfalls(me, segment, year).map((sf) => ({
      axis: sf.axis,
      by: sf.by,
      expected: sf.axis === "price"
        ? expectationsFor(segment, year).priceCeiling
        : floors.find((f) => f.axis === sf.axis)?.atLeast ?? 0,
    }));

    return {
      segmentId: sid, name: segment.name, start, lostTo, wonFrom, fresh: freshWon,
      turnedAway, sentTo, pickedUp, other, end, why, shortOf,
    };
  });
}

/**
 * A year's interest, as one period's worth.
 *
 * The rates themselves are yearly and stay yearly — a rating does not change
 * because a table meets more often, and a screen showing "6.2%" must keep
 * meaning 6.2% a year. Only the money actually charged is scaled.
 */
function scaleInterest<T extends { interest: number }>(charge: T, per: number): T {
  return { ...charge, interest: charge.interest * per };
}

export function resolveYear(
  world: World,
  decisions: TeamDecisions[],
  economy?: Economy,
  options: {
    /**
     * Leave out the year's news. For projections only: the event is decided
     * from the state of the market and is secret until the year runs, so a
     * projection that included it would tell a team tonight what the market
     * does to them tomorrow.
     */
    withoutEvent?: boolean;
  } = {},
): YearResult {
  /*
   * The market, with whatever this season has gone and found in it.
   *
   * The one place the engine reads its market, which is what makes opened
   * niches possible at all: everything downstream — demand, appeal,
   * allocation, the desk, the bots — walks `niche.segments` and sees them
   * without knowing they are new.
   */
  const niche = withOpenedNiches(world.niche, world.openedNiches);
  /** Niches found this year. They join the market for next year, not this one. */
  const openedThisYear: OpenedNiche[] = [];

  /*
   * How much of a year this period is.
   *
   * One for a season decided annually, a quarter for one decided four times,
   * a twelfth for twelve. Every flow below is multiplied by it and every
   * stock is left alone — the distinction, and why getting it wrong in either
   * direction breaks a season, is written down in `cadence.ts`.
   */
  const periods = Math.max(1, Math.round(world.periodsPerYear ?? 1));
  const per = 1 / periods;
  /*
   * The year's news, decided before anything else and applied to the weather
   * before the market sees it. Drawn from the state of the market rather than
   * out of the air: a company with a poor reputation gets the scandal, one
   * that has been quietly excellent gets the write-up. The dice choose which
   * of the things you had coming arrives, never whether you deserved one.
   */
  /*
   * The news, at every grain this cadence supports: a yearly season meets one
   * event a year as it always has, a quarterly one also meets a quarter's
   * worth of smaller news, a monthly one also meets a month's.
   *
   * A market event's multipliers are written onto the world with the period
   * they expire, because a funding winter drawn in the first quarter has to
   * last the year rather than the quarter.
   */
  const events = options.withoutEvent
    ? []
    : eventsDue({ world, period: world.year, periods, economy: economy ?? world.economy });
  const weather = nextWeather(world.weather, events, world.year, periods);
  const event: MarketEvent | null = events[0] ?? null;
  const nextEconomy = economyWithWeather(economy ?? world.economy, weather);
  /*
   * Every number made a number before anything reads it. One bad field used to
   * be enough to turn an entire market's cash into NaN — see
   * `sanitiseDecisions`.
   */
  const byCompany = new Map(decisions.map((d) => [d.companyId, sanitiseDecisions(d)]));
  /*
   * Where the investors have removed the chief executive, the board's
   * decisions stand in that chair — replacing whatever was filed, before
   * anything reads it, so the focus a removed chief executive filed cannot
   * leak into this year's costs. See `finance.ts`.
   */
  for (const company of world.companies) {
    if (company.kind !== "player" || !company.investors?.inCharge) continue;
    const filed = byCompany.get(company.id) ?? { companyId: company.id };
    byCompany.set(company.id, { ...filed, ceo: boardChiefExecutive(company) as any });
  }
  const sharesBefore = marketShares(Object.fromEntries(world.companies.map((c) => [c.id, c.customers])));

  const notesFor: Record<string, string[]> = {};
  const segmentLabel = (id: string) => (niche.segments.find((s) => s.id === id)?.name ?? id).toLowerCase();
  /** What the world's moves cost each company this year, charged at settlement. */
  const worldSpend = new Map<string, { marketing: number; operations: number; cash: number }>();
  /** Companies whose table accepted a buyer's offer this year. */
  const sales = new Map<string, { buyerId: string; price: number }>();

  /*
   * 0. What each seat is actually allowed to spend, decided before anything
   * reads a single figure.
   *
   * Three things can cut a seat's plan: the finance seat's floor (cash nobody
   * may spend), the chief executive's split of what is left, and the finance
   * seat's hold-back. They used to be applied to the bill only — the floor cut
   * what a team was charged while every pound of the uncut plan still bought
   * brand, quality and service, so holding cash back was a discount rather
   * than a cost. Cutting the decisions themselves, here, makes one figure true
   * everywhere: what was spent is what was charged is what it bought.
   */
  for (const company of world.companies) {
    if (company.kind !== "player") continue;
    const d = byCompany.get(company.id);
    if (!d) continue;
    const funded = fundYear(company, d, niche, economy ?? world.economy);
    byCompany.set(company.id, funded.decisions);
    if (funded.notes.length) notesFor[company.id] = funded.notes;
  }
  const spendFor: Record<string, number> = {};
  /** What each company actually earned and spent trading, as opposed to what moved through its bank account. */
  const ledger: Record<string, { revenue: number; costs: number; profit: number }> = {};
  /** The line-by-line version of the same thing, kept for the year's report. */
  const accounts: Record<string, { pnl: ProfitAndLoss; lines: CashLine[]; opening: number }> = {};
  /** Cities each team opened this year, and what that cost. */
  const openedFor: Record<string, { cost: number; names: string[] }> = {};
  /** Segments each incumbent gave up defending. */
  const concededFor: Record<string, string[]> = {};
  /** What each company spent on the things a rival can see it spending on. */
  const visibleSpend: Record<string, number> = {};

  /* 1. Players become the company their decisions describe. */
  const afterDecisions: Company[] = world.companies.map((company) => {
    if (company.kind !== "player") return { ...company };

    const d = byCompany.get(company.id) ?? { companyId: company.id };
    const lock = interlock(company, d, niche);
    notesFor[company.id] = [...(notesFor[company.id] ?? []), ...lock.notes];

    /*
     * The chief executive's focus is a thumb on everyone else's scale rather
     * than a sixth budget: it cannot win a year by itself, and it cannot save a
     * company whose other four seats decided nothing. Each option gives up
     * something, so there is no safe default to pick without thinking.
     */
    const focus = focusEffects(d.ceo?.focus);
    if (d.ceo?.focus && FOCUS_NOTES[d.ceo.focus as Focus]) {
      notesFor[company.id].push(FOCUS_NOTES[d.ceo.focus as Focus]);
    }

    /*
     * How far each seat's money goes: its loyalty, its skill and how hard it
     * has been pushed (see `people.ts`). One for an ordinary seat, so a
     * company that never touches any of it plays as it always has.
     */
    const eff = {
      cmo: effort(personOf(company, "cmo")),
      cto: effort(personOf(company, "cto")),
      coo: effort(personOf(company, "coo")),
    };
    // Engineering pay: above market buys more, with diminishing returns; below invites the market in.
    const pay = payEffect(d.cto?.engineerPay);
    /*
     * The chief executive's pace (ship it, or get it right) and the analytics
     * the technology seat has built up both reach marketing: shipping gives it
     * something new to shout about, and data aims it. See `product.ts`.
     */
    const pace = paceOf(d.ceo?.pace);
    const aim = dataEffects(company.data).aim;
    const brandGain = lift((d.cmo?.brandSpend ?? 0) + (d.cmo?.celebritySpend ?? 0) * 1.4, atScale(220_000, company.scale) * per, 16 * per) * focus.marketing * eff.cmo * pace.marketing * aim;
    const perfGain = lift(d.cmo?.performanceSpend ?? 0, atScale(180_000, company.scale) * per, 9 * per) * focus.marketing * eff.cmo * pace.marketing * aim;
    // PR is a coin flip; a referral programme only works if the product is worth recommending.
    const seedOf = (what: string) => `${world.seasonId}:${world.year}:${company.id}:${what}`;
    const pr = prOutcome(d.cmo?.prSpend, seedOf("pr"));
    if (pr.landed === "hit") notesFor[company.id].push(`The PR push landed: ${pr.brand.toFixed(1)} points of brand for the money.`);
    if (pr.landed === "miss") notesFor[company.id].push("The PR push went nowhere. It happens a little under half the time.");
    if (pr.landed === "backfire") notesFor[company.id].push("The PR push backfired: the story people remembered was not the one that was pitched. Reputation took a knock.");
    const referral = referralBrand(d.cmo?.referralSpend, company.quality);
    if ((d.cmo?.referralSpend ?? 0) > 0 && referral < 1) {
      notesFor[company.id].push("The referral programme paid people to recommend a product they did not rate. Almost nobody did.");
    }
    /*
     * Half the saturation point and a higher ceiling than shipping: research
     * buys roughly half again as much quality per pound. It needs to, because
     * it lands two years out while everything decays in between — so a payoff
     * merely equal to shipping would make patience strictly worse and the
     * lever a tax on thinking ahead.
     */
    const researched = lift(d.cto?.researchSpend ?? 0, atScale(150_000, company.scale) * per, 24 * per) * niche.innovationPace * eff.cto * pay.output;
    /*
     * What the company already owes itself. Carried debt means a share of
     * every engineer's year goes on working around what is already there, so
     * the same money buys less.
     */
    const drag = debtDrag(company.techDebt);
    // Shipping fast is where debt comes from: the pace scales how much this year's features leave behind.
    const techDebt = nextTechDebt({
      current: company.techDebt,
      featureSpend: (d.cto?.featureSpend ?? 0) * pace.debt,
      paydown: d.cto?.techDebtPaydown,
    });
    if (techDebt > 55 && (company.techDebt ?? 0) <= 55) {
      notesFor[company.id].push(
        "The product has got hard to work in. Everything the technology seat spends from here buys noticeably less, and every unit costs a little more, until somebody pays it down.",
      );
    }
    if ((d.cto?.techDebtPaydown ?? 0) > 0 && techDebt < (company.techDebt ?? 0)) {
      notesFor[company.id].push(
        `Cleared some of what the product owed itself: technical debt is down to ${Math.round(techDebt)}. Nothing about this year looks different, and next year's work goes further.`,
      );
    }

    /*
     * The plant itself (see `factory.ts`): how automated it is, where the work
     * is done, and the stock bought last year that arrives to serve people
     * this year's room could not.
     */
    const automation = automationNext(company.automation, d.coo?.automationTarget);
    const auto = automationEffect(automation.now);
    const sourcing = sourcingOf(d.coo?.sourcing);
    const stockHeld = Math.max(0, Math.round(company.stock ?? 0));
    if (automation.building > 0) {
      notesFor[company.id].push(`The plant is being automated to ${Math.round(automation.next)}. It runs that way from next year: cheaper to make each one, dearer to build more, and slower to change what it makes.`);
    }
    if (stockHeld > 0) {
      notesFor[company.id].push(`${stockHeld.toLocaleString()} ${niche.voice.capacityShort} of stock held from last year served people the room alone would have turned away.`);
    }
    /*
     * Quality is felt a year after it is built. This year's shipping goes into
     * the pipeline; what arrives now is last year's shipping and research that
     * started two years ago. See `lag.ts`.
     */
    // An automated line is a line set up for what it already makes: product work buys less.
    const shipped = (lift((d.cto?.featureSpend ?? 0) + (d.cto?.reliabilitySpend ?? 0) * 1.2, atScale(200_000, company.scale) * per, 14 * per) * niche.innovationPace * focus.quality) * drag.product * eff.cto * pay.output * auto.product;
    /*
     * The pace again: shipping swings the year's result either way, and puts
     * part of it in front of customers now rather than next year.
     */
    const swung = shipped * swingOf(d.ceo?.pace, seedOf("swing"));
    const shippedNow = swung * pace.landsNow;
    const landing = qualityLanding(company, swung - shippedNow, researched, per);
    if (shippedNow > 0.5) notesFor[company.id].push(`Shipped fast: ${shippedNow.toFixed(1)} points of this year's work reached customers now instead of next year.`);
    /*
     * Paid below the market, and the market notices: some years a share of
     * what the product team has in flight walks out with the people doing it.
     */
    const lost = poached(pay.pay, `${world.seasonId}:${world.year}:${company.id}:poach`, per);
    const quality = lost.hit
      ? { ...landing, pipeline: landing.pipeline * (1 - lost.share), pipelineLater: landing.pipelineLater * (1 - lost.share) }
      : landing;
    if (lost.hit) {
      notesFor[company.id].push(`Engineers paid ${Math.round(pay.pay * 100)}% of the market were hired away: a quarter of the work in flight left with them.`);
    }
    if (quality.landed > 0.5) {
      notesFor[company.id].push(`Last year's work reached customers: ${quality.landed.toFixed(1)} points of quality that no amount of spending this year could have bought.`);
    }
    if (shipped > 0.5) {
      notesFor[company.id].push(`What was shipped this year — ${shipped.toFixed(1)} points of quality — reaches customers next year.`);
    }

    /*
     * Staff are paid from day one and useful from day three hundred and
     * sixty-six. Once they are established they are the cheapest service in
     * the game, which is the reward for hiring a year before you need them.
     */
    const staff = staffing(company, d.coo?.headcount ?? 0, per);
    if (staff.newHires > 0) {
      notesFor[company.id].push(
        `${staff.newHires} new ${staff.newHires === 1 ? "hire" : "hires"} this year: on the payroll now, and not much use until next year.`,
      );
    }
    // Staff are as good at service as they have been hired and trained to be.
    const serviceGain = lift(
      (d.coo?.supportSpend ?? 0) + (d.cto?.reliabilitySpend ?? 0) * 0.5 + staff.supportEquivalent * staffLeverage(company.staffQuality),
      150_000 * per, 15 * per,
    ) * focus.quality * eff.coo;
    const costCut = lift(d.coo?.efficiencySpend ?? 0, atScale(180_000, company.scale) * per, 0.18 * per) * eff.coo;
    // Next year's staff: this year's hires, as recruited, and everybody else, as trained.
    const staffQuality = staffQualityNext({
      quality: company.staffQuality ?? STAFF_QUALITY_START,
      established: staff.established,
      newHires: staff.newHires,
      recruiting: d.coo?.recruitingSpend ?? 0,
      training: d.coo?.trainingSpend ?? 0,
    });
    // Last year's cost review, felt now.
    const scar = Math.max(0, company.reviewScar ?? 0);
    if (scar > 0) {
      notesFor[company.id].push(`Last year's ${scar}% cost review is being felt: service slipped, and so did everybody's patience.`);
    }

    /*
     * Both halves of every effect are scaled, and it has to be both.
     *
     * A threshold alone is not enough: `lift` saturates, so £150,000 against
     * a £55,000 threshold buys the same *fraction* of the ceiling that
     * £600,000 against £220,000 does — and four of those a year is four times
     * the annual effect. Scaling the ceiling too makes each period buy a
     * quarter of what the year buys, which sums back to the year.
     */
    /*
     * Everything decays. A company that stands still goes backwards, which is
     * what stops a good year in year two carrying a team to year fourteen.
     *
     * And it decays *in proportion to where it is*, because staying famous is
     * harder than getting famous. A flat rate meant that once a company's
     * gains cleared the rate it climbed to the ceiling and parked there: a
     * competent table pinned quality at 100 by year eight and brand and
     * service by year twelve, so the last third of a fourteen-year season had
     * nothing left to play for and was only cash piling up.
     *
     * Measured against fifty, so a company sitting at the middle of the scale
     * pays exactly what it always paid and the early game is untouched. At
     * ninety-five it pays nearly twice that, which is the point.
     */
    const wear = (rate: number, level: number) => rate * focus.decay * per * (Math.max(0, level) / 50);
    /*
     * And the other half of it: the same money buys less the better you
     * already are.
     *
     * Steeper decay alone was not enough and the measurement said so — a good
     * table gains about twenty-one points of brand a year against a decay
     * that reached nine, so it still climbed to the ceiling and parked. Below
     * the middle of the scale nothing changes at all, which keeps the whole
     * early game exactly as it was; above it, each point costs more than the
     * last, until what a company can buy in a year is what it loses in one.
     *
     * That puts the settling point somewhere in the eighties rather than at
     * the cap, and a company only stays there by paying for it — which is the
     * thing the last third of a long season was missing.
     */
    const HOLD_FROM = 50;
    const HOLD_FLOOR = 0.15;
    const headroom = (level: number) => {
      const over = Math.max(0, Math.min(100, level)) - HOLD_FROM;
      return over <= 0 ? 1 : Math.max(HOLD_FLOOR, 1 - (over / (100 - HOLD_FROM)) * (1 - HOLD_FLOOR));
    };
    const hBrand = headroom(company.brand);
    const hQuality = headroom(company.quality);
    const hService = headroom(company.service);
    const decay = {
      brand: wear(4.5, company.brand),
      quality: wear(3, company.quality),
      service: wear(3.5, company.service),
    };

    /*
     * Brand lands half this year and half next — awareness builds, it does
     * not switch on. Performance marketing is the exception and stays
     * immediate: paying for clicks buys this year's clicks, which is the whole
     * trade between the two.
     */
    const brand = brandLanding(company, brandGain, per);

    /*
     * Capacity built this year opens next year. A cut is immediate — you can
     * close a floor faster than you can fit one out — so this year the company
     * serves with the smaller of what it had and what it asked for.
     */
    const build = capacityBuild(company, d.coo?.capacityTarget ?? company.capacity, per);
    if (build.building > 0) {
      notesFor[company.id].push(
        `Room for ${build.building.toLocaleString()} more ${niche.voice.capacityShort} is being built. It opens next year; this year you serve with what you had.`,
      );
    }
    /*
     * Leased room is here this year and gone at the end of it — dearer than
     * building, and the only way to have more room *now*.
     */
    const shift = shiftCapacity({ capacity: build.now, requested: d.coo?.shiftCapacity, niche });
    if (shift.units > 0) {
      notesFor[company.id].push(`A second shift added room for ${shift.units.toLocaleString()} more ${niche.voice.capacityShort} this year, at a premium, and the operation answered the phone worse for it.`);
    }
    const leased = Math.max(0, Math.round(d.coo?.leaseCapacity ?? 0));
    if (leased > 0) {
      notesFor[company.id].push(`Leased room for ${leased.toLocaleString()} more ${niche.voice.capacityShort} this year. It costs 40% more than building it, and it goes back at the end of the year.`);
    }
    const capacity = build.now + leased + shift.units + stockHeld;
    const price = Math.max(1, d.cmo?.price ?? company.price);

    /*
     * A year passes over what the company owns: licences run down, and the
     * ones that lapse stop working. Done here rather than at settlement so the
     * asset that expired this year is not still helping win customers in it.
     */
    const aged = ageAssets(company.assets);
    notesFor[company.id].push(...aged.notes);

    /*
     * Opening somewhere new. Charged once, in the year it happens: reach is
     * bought, not declared, and a team that tries to be everywhere at once
     * finds out what that costs before it finds out what it earns.
     */
    const here = Array.isArray(company.cities) ? company.cities : niche.cities.map((c) => c.id);
    const wanted = new Set(d.cmo?.targetCities ?? here);
    const opened = niche.cities.filter((c) => wanted.has(c.id) && !here.includes(c.id));
    const entryCost = opened.reduce((sum, c) => sum + c.entryCost, 0);
    if (opened.length > 0) {
      notesFor[company.id].push(
        `Opened in ${opened.map((c) => c.name).join(", ")} for ${entryCost.toLocaleString()}. That is reach bought rather than earned, and it is only worth it if somebody sells there.`,
      );
    }
    const cities = Array.from(new Set([...here, ...opened.map((c) => c.id)]));
    openedFor[company.id] = { cost: entryCost, names: opened.map((c) => c.name) };

    /*
     * Feature bets: one idea from this year's menu, built (a year, full
     * effect, might flop) or copied from a rival (now, half the effect).
     * Anything that reaches customers this year is announced, flop or not.
     */
    let features = [...(company.features ?? [])];
    for (const f of features) {
      if (f.lands !== world.year) continue;
      notesFor[company.id].push(f.flopped
        ? `${f.name} launched and nobody wanted it. It happens to about one feature in four.`
        : `${f.name} reached customers: the ${segmentLabel(f.segment)} find the company ${Math.round(f.lift * 100)}% more appealing for it.`);
    }
    const menu = featureMenu(niche, world.seasonId, world.year);
    const idea = d.cto?.featureBet ? menu.find((m) => m.id === d.cto!.featureBet) : undefined;
    if (idea && !features.some((f) => f.id === idea.id)) {
      const someoneHasIt = idea.rivalHas || world.companies.some((c) => c.id !== company.id && (c.features ?? []).some((f) => f.id === idea.id && !f.flopped));
      const mode = d.cto?.featureMode === "copy" && someoneHasIt ? "copy" : "build";
      const bet = placeBet({ idea, mode, pace: d.ceo?.pace, year: world.year, seed: seedOf(`feature:${idea.id}`), periods });
      features = [...features, bet];
      if (d.cto?.featureMode === "copy" && mode === "build") {
        notesFor[company.id].push(`Nobody had ${idea.name} to copy, so it is being built from scratch instead.`);
      }
      notesFor[company.id].push(mode === "copy"
        ? `Copied ${idea.name} from a rival: live now, worth half what building it would have been.`
        : bet.lands === world.year
          ? (bet.flopped ? `${idea.name} was shipped this year, fast, and did not land.` : `${idea.name} was shipped this year, fast: the ${segmentLabel(idea.segment)} find the company ${Math.round(bet.lift * 100)}% more appealing for it.`)
          : `${idea.name} is being built. It reaches customers next year — and about one in four does not work.`);
    }

    /*
     * The world, arriving (see `world.ts`). Money these moves cost is kept
     * aside for settlement, in `worldSpend`, so the year's accounts can say
     * what each was.
     */
    const spent = { marketing: 0, operations: 0, cash: 0 };
    let people = company.people;
    let reputationNow = 0;
    // Last year's shock, answered — or, with no answer, met with silence.
    if (company.shock) {
      const answer = answerShock(company.shock, (d.ceo?.shockAnswer || undefined) as ShockAnswer | undefined);
      reputationNow += answer.reputation;
      if (d.ceo?.shockAnswer === "statement") spent.marketing += statementCost(niche);
      if (answer.blamed && company.seats.includes(answer.blamed)) {
        const person = personOf(company, answer.blamed);
        people = { ...(people ?? {}), [answer.blamed]: { ...person, loyalty: Math.max(0, person.loyalty + answer.loyalty) } };
      }
      notesFor[company.id].push(
        d.ceo?.shockAnswer === "statement" ? `The chief executive answered "${company.shock.headline}" with a statement: about half the reputation it cost has come back.`
        : answer.blamed ? `The chief executive blamed the ${ROLE_TITLES[answer.blamed].toLowerCase()} for "${company.shock.headline}". Most of the reputation came back; that seat will not forget it.`
        : `Nothing was said about "${company.shock.headline}", and the silence was noticed.`,
      );
    }
    // Improvement programmes: a third of each, in each of the three years after it starts.
    const yielded = programmeYield(company.programmes, world.year, periods);
    let programmes = company.programmes;
    const programme = d.coo?.programme;
    if (programme && PROGRAMMES[programme] && !(programmes ?? []).some((p) => p.id === programme)) {
      programmes = [...(programmes ?? []), { id: programme, started: world.year }];
      spent.operations += programmeCost(niche);
      notesFor[company.id].push(`Started a ${PROGRAMMES[programme].name.toLowerCase()} programme. It pays out a third a year for the next three years.`);
    }
    // The year's offers: taken, turned down, or put to the table.
    let assets = aged.assets;
    let revenueShares = company.revenueShares;
    let comarketingBrand = 0;
    const offers = dealsFor({
      seasonId: world.seasonId, year: world.year, company, niche,
      incumbents: world.companies.filter((c) => c.kind === "incumbent"),
      worth: valuation(company).fair,
    });
    for (const offer of offers) {
      const votes = (["cmo", "cfo", "cto", "coo"] as const)
        .map((r) => (d as any)[r]?.dealVotes?.[offer.id] as "yes" | "no" | undefined)
        .filter((v): v is "yes" | "no" => v === "yes" || v === "no");
      const answer = d.ceo?.deals?.[offer.id];
      const out = dealOutcome(answer, votes);
      if (answer === "vote") {
        notesFor[company.id].push(`${offer.title}: put to the table, ${votes.filter((v) => v === "yes").length} for and ${votes.filter((v) => v === "no").length} against. ${out.accepted ? "Taken." : "Turned down."}`);
      }
      if (!out.accepted) continue;
      if (offer.kind === "distribution") {
        assets = [...assets, {
          id: `deal-${offer.id}`, kind: "distribution", name: `${offer.from} distribution`,
          effect: { capacity: offer.capacity, brand: offer.brand }, bookValue: 0, expiresIn: DEAL_YEARS * periods,
        }];
        revenueShares = [...(revenueShares ?? []), { rate: offer.revenueShare ?? 0, until: world.year + DEAL_YEARS * periods - 1, from: offer.from }];
        notesFor[company.id].push(`Signed with ${offer.from}: ${offer.terms}`);
      } else if (offer.kind === "comarketing") {
        spent.marketing += offer.cost ?? 0;
        comarketingBrand += lift((offer.cost ?? 0) * 2, atScale(220_000, company.scale) * per, 16 * per);
        notesFor[company.id].push(`Ran a joint campaign with ${offer.from}: twice the reach for the money.`);
      } else if (offer.kind === "buyout") {
        sales.set(company.id, { buyerId: offer.buyerId!, price: offer.price ?? 0 });
      }
    }
    // A region announced last year, opening now: reached only as far as the brand reaches.
    let expanding = company.expanding;
    let citiesNow = cities;
    const ramp: Record<string, number> = {};
    if (expanding && expanding.opensYear === world.year) {
      if (!citiesNow.includes(expanding.cityId)) {
        citiesNow = [...citiesNow, expanding.cityId];
        ramp[expanding.cityId] = firstYearReach(company.brand);
        notesFor[company.id].push(`Opened in ${niche.cities.find((c) => c.id === expanding!.cityId)?.name ?? "the new region"}, as announced. In its first year the company reaches ${Math.round(ramp[expanding.cityId] * 100)}% of it — as far as the brand does.`);
      }
      expanding = undefined;
    }
    /*
     * This year's announcement, put up by operations and settled by the
     * table: it opens next year, at a discount, paid now.
     *
     * Operations putting it up is its vote for. The other four vote, and a
     * majority of what is actually cast carries it — so a table that says
     * nothing lets operations have it, and a table that splits does not
     * open the region. The note names the count either way, because the
     * argument about who wanted this is the point of voting on it.
     */
    const announced = announcedRegion({ niche, seasonId: world.seasonId, year: world.year, open: citiesNow });
    if (d.coo?.expand && announced && d.coo.expand === announced.id && !expanding) {
      const votes: ("yes" | "no")[] = ["yes", ...(["ceo", "cmo", "cfo", "cto"] as const)
        .map((r) => (d as any)[r]?.expandVote?.[announced.id] as "yes" | "no" | undefined)
        .filter((v): v is "yes" | "no" => v === "yes" || v === "no")];
      const vote = expansionOutcome(votes);
      if (vote.carried) {
        expanding = { cityId: announced.id, opensYear: world.year + periods };
        spent.cash += announced.entryCost * EXPANSION_DISCOUNT;
        notesFor[company.id].push(`${announced.name} went to the table, ${vote.yes} for and ${vote.no} against: committed for next year, at ${Math.round(EXPANSION_DISCOUNT * 100)}% of the usual cost to open.`);
      } else {
        notesFor[company.id].push(`${announced.name} went to the table, ${vote.yes} for and ${vote.no} against: not opened. The announcement stands; somebody else may take it.`);
      }
    }
    // A research report, and bringing back last year's leavers: both marketing's money.
    if (d.cmo?.research && d.cmo.research !== "none") spent.marketing += researchCost(niche);
    spent.marketing += Math.max(0, d.cmo?.winbackSpend ?? 0);

    /*
     * Going and finding a niche. Costs a year's research to look, and only
     * lands where there is a segment to look inside and nobody has already
     * carved this company's corner out of it.
     */
    const looking = d.cmo?.openNiche;
    if (looking) {
      const parent = niche.segments.find((seg) => seg.id === looking);
      const already = (world.openedNiches ?? []).some((o) => o.openedBy === company.id);
      const room = (world.openedNiches ?? []).length < NICHE_LIMIT;
      if (parent && !already && room) {
        const found = nicheFor({ company, parent, year: world.year });
        openedThisYear.push(found);
        spent.marketing += researchCost(niche);
        notesFor[company.id].push(
          `Went looking inside ${parent.name.toLowerCase()} and found ${Math.round(found.share * 100)}% of them who want exactly what you build. They pay about ${Math.round((found.priceIndex - 1) * 100)}% more and they are harder to shift — and for now, nobody else is describing them as a group at all.`,
        );
      } else if (parent && already) {
        notesFor[company.id].push(`You already have a niche of your own. Finding a second is not this year's decision.`);
      }
    }
    worldSpend.set(company.id, spent);

    return {
      ...company,
      assets,
      cities: citiesNow,
      people,
      programmes,
      revenueShares,
      expanding,
      ramp: Object.keys(ramp).length ? ramp : undefined,
      promo: d.cmo?.promo && d.cmo.promo !== "none" ? d.cmo.promo : undefined,
      regionFocus: d.cmo?.regionFocus,
      segmentFocus: d.cmo?.segmentFocus,
      shock: undefined,
      /** Leased room, kept apart so it is never charged as idle and never carried into next year. */
      leased,
      // A marketing seat that filed sets the tiers; one that did not leaves them as they were.
      tiers: d.cmo ? d.cmo.tiers : company.tiers,
      retention: annualPlans(d.cfo?.annualDiscount).retention,
      // What customers are given to pay, which is part of the offer (see `treasury.ts`).
      terms: d.cfo?.terms,
      pipeline: quality.pipeline,
      pipelineLater: quality.pipelineLater,
      brandPipeline: brand.next,
      staff: staff.next,
      /** Next year's capacity, applied once the year is settled. */
      capacityNext: build.next,
      techDebt,
      positioning: d.ceo?.positioning ?? company.positioning,
      // Seats brought back cost a salary again, and the lever comes with them.
      seats: Array.from(new Set([
        ...company.seats,
        // One seat or several, and an empty string means nobody.
        ...(Array.isArray(d.ceo?.rehire) ? d.ceo!.rehire : d.ceo?.rehire ? [d.ceo.rehire] : []),
      ].filter(Boolean))) as Company["seats"],
      cash: company.cash - entryCost,
      price,
      capacity,
      brand: clamp(company.brand + (brand.now + perfGain + pr.brand + referral + comarketingBrand + yielded.brand) * hBrand - decay.brand),
      /*
       * `sourcing.quality` is a standing condition — outsourcing makes the
       * product a few points worse for as long as it is outsourced — written
       * as a yearly delta, so it is a flow and has to be scaled. Unscaled it
       * cost a monthly season 36 points of quality a year, which took a good
       * company from 38 to 5 over four years while it was shipping well.
       */
      quality: clamp(company.quality + (quality.landed + shippedNow + yielded.quality) * hQuality + sourcing.quality * per - decay.quality),
      reputation: clamp(company.reputation + reputationNow + yielded.reputation),
      security: securityNext(company.security, d.cto?.securitySpend, per),
      data: dataNext(company.data, d.cto?.dataSpend, per),
      features,
      /** This year's PR backfire, if any, for reputation at settlement. Never stored. */
      prReputation: pr.reputation,
      // The review scar and the second shift's toll are both written per year.
      service: clamp(company.service + (serviceGain + yielded.service) * hService - decay.service - (scar * REVIEW_SERVICE + shift.service) * per),
      staffQuality,
      automation: automation.now,
      /** Next year's automation, applied once the year is settled, like capacity. */
      automationNext: automation.next,
      stock: Math.max(0, Math.round(d.coo?.stockTarget ?? 0)),
      sourcing: d.coo?.sourcing === "outsourced" ? "outsourced" : "in_house",
      /*
       * Costs move by how much the index moved, not by the whole index.
       *
       * `costIndex` is "how far input costs have travelled since year one" —
       * an index, not a yearly rate. Multiplying the company's already-adjusted
       * unit cost by the whole of it every year compounded it: a 1.17 index in
       * year fourteen had been applied fourteen times over, unit costs ended
       * roughly seven times where they started, and every company in every
       * season quietly crossed the line where each sale lost money. It showed
       * up as teams dying in the last three years for no reason they could see.
       *
       * Applying the step between last year's index and this one leaves a
       * season's real drift at about what the index says it is.
       */
      unitCost: Math.max(
        niche.baseUnitCost * 0.45,
        /*
         * Automation, sourcing and the year's focus are standing conditions
         * written as yearly multipliers, and this is a stored stock they are
         * applied to every period — so each is taken to the power of a
         * period's share of a year. Unscaled, outsourcing at 1.09 a year
         * compounded to 2.8x a year in a monthly season, and by year six the
         * company was charging eight times its opening price to stay level.
         */
        company.unitCost * (1 - costCut) * yielded.unitCost
          * Math.pow(auto.unitCost, per) * Math.pow(sourcing.unitCost, per) * Math.pow(focus.cost, per)
          * (nextEconomy.costIndex / (world.economy?.costIndex || 1)),
      ),
    };
  });

  /*
   * What the company is worth facing, rather than what it built by itself.
   *
   * Assets carry an `effect` — a distribution deal is capacity, a patent is
   * quality and a lower unit cost — and until now nothing read it: owning
   * things made a company no better at anything, it only raised what a bank
   * would lend. The effects apply from here on, through the market and the
   * money, while the company's own numbers stay as they were.
   *
   * Kept separate on purpose. If the bonus were folded into the stored
   * figures it would compound every year the asset was held, and selling the
   * asset would leave the benefit behind — so a company could buy a patent,
   * sell it back the next year, and keep the quality for ever.
   */
  const effectiveOf = (c: Company): Company => {
    if (c.kind !== "player") return c;
    /*
     * Technical debt is a condition, not a scar. Folding its cost drag into
     * the stored unit cost compounded it every year the debt was carried —
     * the same runaway the cost index had, reintroduced — and it meant paying
     * the debt down left the expense permanently baked in. Applied here, a
     * company that clears its debt is cheaper to run the moment it does.
     */
    const dragged = debtDrag(c.techDebt).unitCost;
    if (c.assets.length === 0) {
      return dragged === 1 ? c : { ...c, unitCost: c.unitCost * dragged };
    }
    const e = assetEffects(c.assets);
    return {
      ...c,
      brand: clamp(c.brand + e.brand),
      quality: clamp(c.quality + e.quality),
      service: clamp(c.service + e.service),
      capacity: c.capacity + e.capacity,
      unitCost: c.unitCost * dragged * e.unitCost,
    };
  };
  const baseById = new Map(afterDecisions.map((c) => [c.id, c]));
  const withEffects = afterDecisions.map(effectiveOf);

  /* 2. Incumbents decide, seeing the players as they now are. */
  const players = withEffects.filter((c) => c.kind === "player");
  const withIncumbents: Company[] = withEffects.map((company) => {
    if (company.kind !== "incumbent") return company;
    const moves = incumbentYear(company, players, niche, nextEconomy);
    spendFor[company.id] = moves.spend;
    concededFor[company.id] = moves.conceded;
    notesFor[company.id] = [moves.note];
    return { ...company, price: moves.price, quality: moves.quality, brand: moves.brand, service: moves.service, capacity: moves.capacity };
  });

  /* 3. The market decides. */
  const allocation = allocate(withIncumbents, niche, world.year, nextEconomy, periods);

  /*
   * Win-back: last year's leavers, brought back from whoever took them — the
   * biggest holder in that segment — as far as the money and the room go. It
   * only fully works if the company got better at what they left over; see
   * `winBack` in world.ts.
   */
  for (const company of withIncumbents) {
    if (company.kind !== "player") continue;
    const d = byCompany.get(company.id);
    const spend = Math.max(0, d?.cmo?.winbackSpend ?? 0);
    const left = company.leftLastYear ?? {};
    const totalLeft = Object.values(left).reduce((a, n) => a + n, 0);
    if (spend <= 0 || totalLeft <= 0) continue;
    const was = company.lastStats;
    const fixed = !was || company.quality > was.quality + 2 || company.service > was.service + 2 || company.price < was.price * 0.97;
    let room = Math.max(0, company.capacity - Object.values(allocation.held[company.id] ?? {}).reduce((a, n) => a + n, 0));
    let back = 0;
    for (const segment of niche.segments) {
      const gone = left[segment.id] ?? 0;
      if (gone <= 0 || room <= 0) continue;
      const holder = withIncumbents
        .filter((c) => c.id !== company.id)
        .sort((a, b) => (allocation.held[b.id]?.[segment.id] ?? 0) - (allocation.held[a.id]?.[segment.id] ?? 0))[0];
      if (!holder) continue;
      const want = winBack({ spend: spend * (gone / totalLeft), left: gone, referencePrice: segment.referencePrice, fixed });
      const n = Math.min(want, room, allocation.held[holder.id]?.[segment.id] ?? 0);
      if (n <= 0) continue;
      allocation.held[holder.id][segment.id] -= n;
      allocation.held[company.id][segment.id] = (allocation.held[company.id][segment.id] ?? 0) + n;
      room -= n;
      back += n;
    }
    if (back > 0 || spend > 0) {
      notesFor[company.id] = [...(notesFor[company.id] ?? []), back > 0
        ? `Won back ${back.toLocaleString()} of last year's leavers.${fixed ? "" : " Fewer than the money should have bought: nothing they left over had changed."}`
        : "The win-back money found nobody to bring back — there was no room, or nobody had left."];
    }
  }
  const sharesAfter = marketShares(allocation.held);

  /* 4. Money. */
  const settled: Company[] = withIncumbents.map((company) => {
    /*
     * Whole people, guaranteed here rather than hoped for upstream.
     *
     * Customers are counted, split, spilled and trimmed by a dozen passes,
     * and it only takes one of them to divide without rounding for a report
     * to tell somebody they have 14,353.5 customers. Rounded once, at the
     * point they become the company's, so every screen downstream is safe.
     */
    const customers = Object.fromEntries(
      Object.entries(allocation.held[company.id] ?? {}).map(([id, n]) => [id, Math.max(0, Math.round(n))]),
    );
    const units = Object.values(customers).reduce((sum, n) => sum + n, 0);
    const d = byCompany.get(company.id);

    /*
     * What the customers paid. Tier by tier, once some have traded down to a
     * cheaper tier than their own, less the discount on annual plans; for a
     * company with neither it is customers times price, as it always was.
     */
    const plans = company.kind === "player" ? annualPlans(d?.cfo?.annualDiscount) : annualPlans(0);
    const took = takings(company, customers, niche.segments);
    /*
     * A promotion: a free first month for everybody new, or a January sale
     * for everybody. And a distribution partner's share, off the top.
     */
    const promo = promoOf(company.kind === "player" ? company.promo : undefined);
    const freshUnits = niche.segments.reduce((a, s) => a + (allocation.fresh[s.id]?.[company.id] ?? 0), 0);
    const heldUnits = Object.values(customers).reduce((a, n) => a + n, 0);
    const promoFactor = promo.allRevenue * (1 - (1 - promo.newRevenue) * (heldUnits > 0 ? Math.min(1, freshUnits / heldUnits) : 0));
    const revenue = took.revenue * plans.revenueFactor * promoFactor * per;
    const shareRate = company.kind === "player"
      ? (company.revenueShares ?? []).filter((r) => r.until >= world.year).reduce((a, r) => a + r.rate, 0)
      : 0;
    const partnerShare = revenue * shareRate;
    const extra = worldSpend.get(company.id) ?? { marketing: 0, operations: 0, cash: 0 };
    // Insurance: the premium, and later what it pays back on anything it covered.
    const cover = (company.kind === "player" ? byCompany.get(company.id)?.cfo?.insurance : "none") as Cover | undefined;
    const premium = revenue * (PREMIUM[cover ?? "none"] ?? 0);
    // Free users are served too, more cheaply than paying ones.
    const variable = ((units - took.freeUsers) * company.unitCost + took.freeUsers * company.unitCost * FREE_SERVE_COST) * per;
    const marketing = (d?.cmo?.brandSpend ?? 0) + (d?.cmo?.performanceSpend ?? 0) + (d?.cmo?.celebritySpend ?? 0)
      + (d?.cmo?.prSpend ?? 0) + (d?.cmo?.referralSpend ?? 0) + extra.marketing;
    /*
     * Research is in here, and was not.
     *
     * It was added as a lever, charged by the commitment meter, counted
     * against a challenge's spending cap and against a creditor's covenant —
     * and never taken out of the company's cash. A team could put a million a
     * year into next year's product for free, for fourteen years. Every screen
     * said they were spending it; only the bank account disagreed.
     */
    // At the engineering pay the technology seat set: the same work, at a fifth over market, is a fifth dearer.
    /*
     * A feature bet is charged in the year it is placed, built or copied, at
     * this market's price for one. Only a bet that was actually placed: one
     * that is new on the company this year.
     */
    const before = world.companies.find((c) => c.id === company.id);
    const placed = company.kind === "player"
      ? (company.features ?? []).find((f) => !(before?.features ?? []).some((p) => p.id === f.id))
      : undefined;
    const betCost = placed ? featureCost(niche, placed.mode) : 0;
    const product = ((d?.cto?.featureSpend ?? 0) + (d?.cto?.reliabilitySpend ?? 0)
      + (d?.cto?.techDebtPaydown ?? 0) + (d?.cto?.researchSpend ?? 0)
      + (d?.cto?.securitySpend ?? 0) + (d?.cto?.dataSpend ?? 0) + betCost) * payEffect(d?.cto?.engineerPay).cost;
    /*
     * The plant's money: automating it, running a second shift on it, and the
     * stock bought now for next year (see `factory.ts`). Building costs more
     * on an automated line, which is the other half of that trade.
     */
    const plant = company.kind === "player"
      ? automationCost({ from: before?.automation ?? 0, to: d?.coo?.automationTarget ?? before?.automation ?? 0, capacity: company.capacity, niche })
        + shiftCapacity({ capacity: company.capacity, requested: d?.coo?.shiftCapacity, niche }).cost
        + stockCost(d?.coo?.stockTarget, niche)
      : 0;
    const ops = (d?.coo?.supportSpend ?? 0) + (d?.coo?.efficiencySpend ?? 0)
      + (d?.coo?.recruitingSpend ?? 0) + (d?.coo?.trainingSpend ?? 0) + extra.operations + plant;
    // The finance seat's cost review comes off the overhead this year; the bill for it arrives next year.
    const review = company.kind === "player" ? reviewSaving(d?.cfo?.costReview) : 0;
    const fixed = company.kind === "player"
      ? fixedCosts(company, d?.coo?.headcount ?? 0, nextEconomy, reachOf(company, niche)) * per
        * focusEffects(d?.ceo?.focus).fixed * (1 - review) * sourcingOf(d?.coo?.sourcing).fixed
      : 0;
    if (review > 0) {
      notesFor[company.id] = [
        ...(notesFor[company.id] ?? []),
        `A ${Math.round(review * 100)}% cost review took overhead down this year. Service and morale find out next year.`,
      ];
    }
    /*
     * The finance seat's ring-fence, which now actually holds.
     *
     * `cashBuffer` was read by the on-screen preview and by nothing else: a
     * chief financial officer could refuse to let the others spend the
     * company's last two million, watch the number change on their own screen,
     * and then watch it be spent anyway. It was the one lever on the desk that
     * was purely decorative.
     *
     * Held for real, it is the only authority the finance seat has over the
     * other four — and it is visible rather than silent, because the
     * commitment meter already subtracts the buffer from what the table can
     * spend, so nobody is surprised by it. Fixed costs are outside it: salaries
     * are owed whatever anybody decided.
     */
    /*
     * The finance seat's floor, the chief executive's split and the hold-back
     * were all applied to the decisions before the year began (step 0), so
     * what is charged here is what was actually spent.
     */
    const allowed = 1;

    /*
     * Capacity is a contract rather than a budget line: building is paid for
     * in the year it is ordered, leased room for the year it is used, and room
     * given up is sold back at a loss.
     */
    const base0 = baseById.get(company.id);
    const automated = automationEffect(before?.automation ?? 0).buildCost;
    const room = company.kind === "player"
      ? capacityMoney({
          current: world.companies.find((c) => c.id === company.id)?.capacity ?? 0,
          target: (base0 as (Company & { capacityNext?: number }) | undefined)?.capacityNext ?? company.capacity,
          lease: base0?.leased ?? 0,
          niche,
        })
      : { build: 0, lease: 0, sold: 0 };
    room.build *= automated;

    const discretionary = company.kind === "player"
      ? (marketing + product + ops) * allowed + fixed + room.build + room.lease
      : (spendFor[company.id] ?? 0);
    visibleSpend[company.id] = company.kind === "player"
      ? (marketing + product + ops) * allowed
      : (spendFor[company.id] ?? 0);

    // Never more than the bank will lend, whatever was filed (see `drawdown`).
    const borrowed = company.kind === "player" ? drawdown(company, d?.cfo?.borrow) : Math.max(0, d?.cfo?.borrow ?? 0);
    /*
     * A long-term loan cannot be paid off early — that is what its lower rate
     * was bought with — so repayment only reaches the credit line.
     */
    const repayable = Math.max(0, company.debt - bondTotal(company));
    const repaid = Math.min(repayable, Math.max(0, d?.cfo?.repay ?? 0));
    if (company.kind === "player" && (d?.cfo?.repay ?? 0) > repaid + 1) {
      notesFor[company.id] = [
        ...(notesFor[company.id] ?? []),
        `Only ${Math.round(repaid).toLocaleString()} could be repaid: the rest of what the company owes is long-term, and is repaid when it matures.`,
      ];
    }
    const raised = Math.max(0, d?.cfo?.raiseAmount ?? d?.cfo?.raise?.amount ?? 0);

    /*
     * Headroom paid for and not used. The company's own capacity, not what a
     * distribution deal lends it — a deal is somebody else's warehouse, and
     * the point of buying one is that you do not pay for its empty shelves.
     */
    const ownCapacity = (baseById.get(company.id) ?? company).capacity;
    // Leased room is paid for in full already; only the company's own room sits idle at a cost.
    const idle = company.kind === "player" ? Math.max(0, ownCapacity - (base0?.leased ?? 0) - units) : 0;
    const idleCost = company.kind === "player" ? idleCapacityCost(idle, niche) * per : 0;
    if (company.kind === "player" && idleCost > 50_000 && idle > ownCapacity * 0.25) {
      notesFor[company.id] = [
        ...(notesFor[company.id] ?? []),
        `${Math.round(idle).toLocaleString()} of the ${Math.round(ownCapacity).toLocaleString()} ${niche.voice.capacityShort} went unused, and cost ${Math.round(idleCost).toLocaleString()} to keep ready.`,
      ];
    }

    /*
     * At the company's own rate, set by its credit rating, and with any
     * emergency loan at the premium. It used to be one market rate for
     * everybody, so a company on fire borrowed as cheaply as one thriving.
     */
    const rates = company.kind === "player"
      ? scaleInterest(interestOn(company, nextEconomy.interestRate), per)
      : { interest: company.debt * nextEconomy.interestRate * per, rate: nextEconomy.interestRate, emergencyRate: nextEconomy.interestRate, bondRate: nextEconomy.interestRate };
    const interest = rates.interest;
    /*
     * The marketing seat's forecast, which everybody else planned on. Right,
     * it saves money; badly wrong, it costs it. See `forecastOutcome`.
     */
    // Good data lets the marketing seat be a little further off and still have planned well.
    const forecast = company.kind === "player" ? forecastOutcome(d?.cmo?.forecast, units, revenue, dataEffects(base0?.data).tolerance) : null;
    const planning = forecast?.effect ?? 0;
    if (forecast) {
      const pct = Math.round(forecast.error * 100);
      const said = `The marketing seat forecast ${Math.round(d!.cmo!.forecast!).toLocaleString()} and ${units.toLocaleString()} came (${pct >= 0 ? "+" : ""}${pct}%).`;
      notesFor[company.id] = [
        ...(notesFor[company.id] ?? []),
        forecast.verdict === "good"
          ? `${said} Everyone planned on a good number, and it saved ${money(planning)}.`
          : forecast.verdict === "bad"
            ? `${said} Everybody planned on it, and ${pct > 0 ? "rushing to serve the ones nobody expected" : "paying for the ones who never came"} cost ${money(-planning)}.`
            : `${said} Close enough to plan on; not close enough to save anything.`,
      ];
    }
    /*
     * What can go wrong: a breach, less likely and less damaging the more
     * security has been built, more likely the more debt is carried; and an
     * outage, the debt itself coming due, made rarer by reliability work.
     */
    // Not before the technology seat has a security lever to answer it with.
    const breach = company.kind === "player" && isUnlocked("cto", "securitySpend", world.year)
      ? breachOf({ security: base0?.security, techDebt: base0?.techDebt, seed: `${world.seasonId}:${world.year}:${company.id}:breach`, per })
      : null;
    const outage = company.kind === "player"
      && rng(`${world.seasonId}:${world.year}:${company.id}:outage`)() < outageChance(base0?.techDebt, d?.cto?.reliabilitySpend) * per;
    // A lawsuit, from year three: more likely for a company that has let service slide.
    const lawsuit = company.kind === "player"
      ? lawsuitOf({ service: company.service, seed: `${world.seasonId}:${world.year}:${company.id}:lawsuit`, year: world.year, per })
      : null;
    if (lawsuit) {
      notesFor[company.id] = [...(notesFor[company.id] ?? []), `A lawsuit, settled for ${money(revenue * lawsuit.cost)}.${covers(cover, "lawsuit") ? " Insurance paid most of it." : ""}`];
    }
    const grossIncident = (breach ? revenue * breach.cost : 0) + (lawsuit ? revenue * lawsuit.cost : 0);
    const recovered = (breach && covers(cover, "breach") ? revenue * breach.cost * PAYOUT : 0)
      + (lawsuit && covers(cover, "lawsuit") ? revenue * lawsuit.cost * PAYOUT : 0);
    if (breach && covers(cover, "breach")) {
      notesFor[company.id] = [...(notesFor[company.id] ?? []), "The breach was insured: most of the clean-up was paid for. The reputation was not."];
    }
    const incidentCost = grossIncident - recovered;
    const incidentService = (breach?.service ?? 0) + (outage ? OUTAGE.service : 0);
    const incidentReputation = (breach?.reputation ?? 0) + (lawsuit?.reputation ?? 0) + (outage ? OUTAGE.reputation : 0) - (base0?.prReputation ?? 0);
    if (breach) {
      notesFor[company.id] = [...(notesFor[company.id] ?? []), `A data breach. Cleaning it up cost ${money(incidentCost)}, customers trust the company less, and support spent the year apologising.${(base0?.security ?? 0) > 40 ? " The security work kept it smaller than it would have been." : ""}`];
    }
    if (outage) {
      notesFor[company.id] = [...(notesFor[company.id] ?? []), `An outage. Technical debt at ${Math.round(base0?.techDebt ?? 0)} came due on a busy evening; service and reputation paid for it.`];
    }
    const operatingProfit = revenue + planning - (variable + discretionary + interest + idleCost + incidentCost + partnerShare + premium);
    const taxed = company.kind === "player" ? taxOn(operatingProfit, company.taxLosses ?? 0) : { tax: 0, carried: 0 };
    const costs = variable + discretionary + interest + idleCost + incidentCost + partnerShare + premium + taxed.tax - planning;
    const profit = revenue - costs;
    /*
     * Kept, because the report used to throw this away and recompute profit as
     * the change in cash — see the note where the reports are built.
     */
    ledger[company.id] = { revenue, costs, profit };

    /*
     * Annual plans: this year, cash for next year's service arrives early; and
     * last year's early cash is revenue this year that brings no money in.
     */
    const prepaidIn = company.kind === "player" ? plans.uptake * revenue * PREPAID_SHARE : 0;
    const prepaidOut = company.kind === "player" ? Math.max(0, company.prepaid ?? 0) : 0;

    /*
     * Long-term loans: issued when the finance seat borrows on long terms, and
     * repaid in full, from cash, in the year they mature.
     */
    let bonds: Bond[] = company.kind === "player" ? [...(company.bonds ?? [])] : [];
    const maturing = bonds.filter((b) => b.maturesYear <= world.year).reduce((sum, b) => sum + b.amount, 0);
    bonds = bonds.filter((b) => b.maturesYear > world.year);
    if (maturing > 0) {
      notesFor[company.id] = [...(notesFor[company.id] ?? []), `A long-term loan of ${money(maturing)} matured and was repaid from cash.`];
    }
    if (company.kind === "player" && borrowed > 0 && d?.cfo?.borrowTerm === "long") {
      bonds.push({ amount: borrowed, rate: rates.bondRate ?? rates.rate, maturesYear: world.year + BOND_TERM * periods });
      notesFor[company.id] = [
        ...(notesFor[company.id] ?? []),
        `Borrowed ${money(borrowed)} long-term at ${Math.round((rates.bondRate ?? rates.rate) * 1000) / 10}%, fixed for ${BOND_TERM} years. It cannot be repaid early, and it comes with a covenant: profit must cover the interest ${COVENANT_COVER} times over.`,
      ];
    }

    /*
     * Dividends: out of this year's profit, as the finance seat set. The
     * founders' share is banked for good; the investors' share keeps them
     * patient. See `dividend` in world.ts.
     */
    const payout = company.kind === "player"
      ? dividend({ profit, payoutPct: d?.cfo?.dividendPct, founderShare: company.founderShare ?? 1 })
      : { paid: 0, founders: 0, investors: 0 };
    if (payout.paid > 0) {
      notesFor[company.id] = [...(notesFor[company.id] ?? []), `Paid out ${money(payout.paid)} of the year's profit${payout.investors > 0 ? `: ${money(payout.founders)} to the founders and ${money(payout.investors)} to the investors` : " to the founders, banked for good"}.`];
    }
    /*
     * What customers were given to pay, and what that does to the money: a
     * share of this year's takings is still owed at the year's end, and last
     * year's is collected now. A factor will buy what is owed for cash today,
     * at a price (see `treasury.ts`).
     */
    const terms = company.kind === "player" ? termsOf(d?.cfo?.terms) : termsOf(0);
    const owedNow = revenue * terms.deferred;
    const collected = company.kind === "player" ? Math.max(0, company.receivables ?? 0) : 0;
    const sold = company.kind === "player" ? factoring({ receivables: owedNow, share: d?.cfo?.factorPct }) : { sold: 0, cash: 0, cost: 0 };
    const receivables = Math.max(0, owedNow - sold.sold);
    if (sold.sold > 0) {
      notesFor[company.id] = [...(notesFor[company.id] ?? []), `Sold ${money(sold.sold)} of what customers owed to a factor for ${money(sold.cash)} today. The difference, ${money(sold.cost)}, is what speed costs.`];
    }

    /*
     * Refinancing: what is on the credit line moved onto fixed terms at the
     * rate this year's rating earns, for a fee.
     */
    const onLine = Math.max(0, company.debt - bondTotal(company) - (company.emergencyDebt ?? 0));
    const moved = company.kind === "player"
      ? refinance({ onLine, amount: d?.cfo?.refinance, rate: rates.bondRate ?? rates.rate, year: world.year, term: REFINANCE_TERM_YEARS })
      : { moved: 0, fee: 0, bond: null };
    if (moved.bond) {
      bonds.push(moved.bond);
      notesFor[company.id] = [...(notesFor[company.id] ?? []), `Moved ${money(moved.moved)} off the credit line and onto a ${REFINANCE_TERM_YEARS}-year loan at ${Math.round(moved.bond.rate * 1000) / 10}%, for a ${money(moved.fee)} fee. The line can be pulled; this cannot.`];
    }

    let cash = company.cash + profit + borrowed + raised - repaid + room.sold + prepaidIn - prepaidOut - maturing - extra.cash - payout.paid
      - owedNow + collected + sold.cash - moved.fee;
    let debt = Math.max(0, company.debt + borrowed - repaid - maturing);

    /*
     * Running out of money does not end a season. The brief is explicit and it
     * is the right call: a player knocked out on day three has eleven days of
     * nothing. A company that cannot pay draws automatically against what is
     * left of its credit, and beyond that it is marked bankrupt — which unlocks
     * the recovery moves rather than closing the game.
     */
    let bankruptSince = company.bankruptSince;
    let emergencyDrawn = 0;
    // Repayment clears the expensive money first.
    let emergencyDebt = company.kind === "player" ? applyRepayment(company.emergencyDebt ?? 0, repaid) : 0;
    if (cash < 0) {
      /*
       * The emergency loan. It used to be a silent draw on the credit line at
       * the ordinary rate, which made running out of money cost almost
       * nothing. Now it is lent at a punitive premium, it costs reputation,
       * and it drags the rating — but it still keeps the company in the
       * season, because a season is never ended by one bad year.
       *
       * Lent beyond the ordinary line, by up to a year of salaries *in total*
       * — not per year. A company rescued once is rescued expensively; one
       * that has already used its rescue and runs out again is out of money
       * and credit, and the recovery moves open. Capped per year instead, it
       * could be rescued every year for ever and bankruptcy would never come.
       */
      const rescueLeft = company.kind === "player" ? Math.max(0, fixed - emergencyDebt) : 0;
      const room = Math.max(0, company.creditLimit - debt) + rescueLeft;
      const emergency = Math.min(room, -cash);
      if (emergency > 0) {
        cash += emergency;
        debt += emergency;
        emergencyDrawn = emergency;
        if (company.kind === "player") emergencyDebt += emergency;
      }
      if (company.kind === "player" && emergency > 0) {
        notesFor[company.id] = [
          ...(notesFor[company.id] ?? []),
          `Cash ran out and an emergency loan of ${Math.round(emergency).toLocaleString()} covered it — at ${Math.round(rates.emergencyRate * 1000) / 10}% a year, repaid before anything else. Customers heard about it, and so did the credit agencies.`,
        ];
      }
      if (cash < 0 && company.kind === "player") {
        bankruptSince ??= world.year;
        notesFor[company.id] = [
          ...(notesFor[company.id] ?? []),
          "The company ran out of money and credit. It is not out of the season: assets can be sold, seats dissolved, debt restructured, and a rival may bid for what is left.",
        ];
      }
    }
    emergencyDebt = Math.min(emergencyDebt, debt);

    /*
     * The credit rating moves with the year's numbers — gradually, the way a
     * lender re-rates, not in one lurch. See `finance.ts`.
     */
    const creditScore = company.kind === "player"
      ? nextRating(company.creditScore, justifiedRating({
          revenue, profit, debt, cash, fixedCosts: fixed, rescued: emergencyDrawn > 0,
        }))
      : company.creditScore;
    if (company.kind === "player" && creditScore !== undefined) {
      const before = ratingGrade(company.creditScore ?? RATING_START);
      const after = ratingGrade(creditScore);
      if (before !== after) {
        notesFor[company.id] = [
          ...(notesFor[company.id] ?? []),
          `The credit rating moved from ${before} to ${after}. That changes what everything the company owes costs next year, and how much it can borrow.`,
        ];
      }
    }

    /*
     * The covenant on long-term loans: operating profit must cover interest.
     * Broken, the lenders mark the company down and reprice what it owes them.
     */
    let ratedScore = creditScore;
    if (company.kind === "player" && bonds.length > 0 && interest > 0) {
      const cover = (operatingProfit + interest) / interest;
      if (cover < COVENANT_COVER) {
        ratedScore = Math.max(0, (creditScore ?? RATING_START) - COVENANT_RATING_HIT);
        bonds = bonds.map((b) => ({ ...b, rate: b.rate + COVENANT_PENALTY }));
        notesFor[company.id] = [
          ...(notesFor[company.id] ?? []),
          `The long-term loan's covenant was broken: profit covered interest ${Math.max(0, Math.round(cover * 10) / 10)} times, not ${COVENANT_COVER}. The lenders marked the rating down and added ${COVENANT_PENALTY * 100} points to what those loans cost.`,
        ];
      }
    }

    // What a bank will lend against reputation and what the company holds.
    const assetValue = company.assets.reduce((sum, a) => sum + a.bookValue, 0);
    const creditLimit = Math.max(0, Math.round(
      (revenue * 0.35 + assetValue * 0.5 + company.reputation * 4_000)
      // A lender lends more to a company it rates, and far less to one it does not.
      * (company.kind === "player" ? creditMultiplier(ratedScore ?? RATING_START) : 1),
    ));

    /*
     * 5. Reputation: a consequence, not a lever. It is bought by keeping
     * promises — serving who you sold to, at a quality that matches the price —
     * and lost fastest by turning people away.
     */
    const turnedAway = allocation.unserved[company.id] ?? 0;
    const served = units;
    if (company.kind === "player" && turnedAway > 0) {
      let wentToRivals = 0;
      for (const bySource of Object.values(allocation.spill)) {
        for (const n of Object.values(bySource[company.id] ?? {})) wentToRivals += n;
      }
      notesFor[company.id] = [
        ...(notesFor[company.id] ?? []),
        `${turnedAway.toLocaleString()} people wanted you and could not be served${wentToRivals > 0 ? ` — ${wentToRivals.toLocaleString()} of them went straight to a rival` : ""}. They are ${niche.voice.turnedAway}, and they remember.`,
      ];
    }
    const letDown = served + turnedAway > 0 ? turnedAway / (served + turnedAway) : 0;
    /*
     * Value for money, against what this market charges on average and capped
     * at twice a fair deal.
     *
     * Two things were wrong here. It measured against `segments[0]`, so which
     * segment happened to be listed first decided the yardstick for the whole
     * market — reordering a niche's segments silently changed every company's
     * reputation. And it was uncapped, so a company charging a fifth of the
     * going rate scored so far above fair that the penalty for turning
     * customers away could not touch it: the more people it failed to serve,
     * the better its reputation got.
     */
    const marketPrice = marketPriceOf(niche);
    // What customers actually paid on average, which with tiers is not the list price.
    const paidOnAverage = units > 0 ? revenue / units : company.price;
    const valueForMoney = paidOnAverage > 0
      ? Math.min(2, (company.quality / 100) / (paidOnAverage / marketPrice))
      : 0;
    const repChange =
      -incidentReputation +
      (company.service - 50) * 0.06 +
      (valueForMoney - 0.8) * 6 -
      letDown * 26 -
      (profit < 0 && company.cash < 0 ? 2 : 0) -
      (emergencyDrawn > 0 && company.kind === "player" ? EMERGENCY_REPUTATION : 0);

    /*
     * Back to the company's own numbers. Everything the assets lent it was for
     * facing the market with; what it keeps is what it built, plus the result.
     *
     * For a team, that is the figure from before the asset effects. For an
     * incumbent it is the figure *after* its moves — and it used to be the
     * figure before them, because `baseById` was snapshotted before the
     * incumbents decided anything. So every incumbent in every season was
     * frozen at its opening quality, brand, service and capacity for all
     * fourteen years: a fortress could spend two and a half million a year on
     * service and keep none of it, and Ember's quality read 66.0 in year one
     * and 66.0 in year fourteen. Nobody could see it until the year-end report
     * started listing what each rival did, and every one of them had
     * apparently "held course" while spending millions.
     */
    const base = company.kind === "incumbent" ? company : baseById.get(company.id) ?? company;

    /*
     * What raising costs, which is not interest.
     *
     * An investor buys a share of everything the company will ever be, priced
     * against what it is worth today — so money raised cheaply when the
     * company is worth little is the most expensive money in the game. The
     * team feels nothing this year and finds out on day fourteen that they won
     * a market they own a third of.
     */
    let founderShare = base.founderShare ?? 1;
    if (raised > 0) {
      const units = Object.values(customers).reduce((sum, n) => sum + n, 0);
      const worth = Math.max(500_000, revenue * 1.2 + assetValue - debt);
      founderShare = Math.max(0.05, founderShare * (worth / (worth + raised)));
      notesFor[company.id] = [
        ...(notesFor[company.id] ?? []),
        `Raised ${Math.round(raised).toLocaleString()} against a company worth about ${Math.round(worth).toLocaleString()}. The founders now hold ${Math.round(founderShare * 100)}% of whatever this becomes.`,
      ];
    }

    /*
     * Buying the company back, which is the only way a founder's share goes
     * up — and money not spent on the year to do it.
     */
    const bought = company.kind === "player"
      // Never with money the company does not have: a buyback is not a way to go insolvent.
      ? buyback({ spend: Math.min(Math.max(0, cash), d?.cfo?.buyback ?? 0), worth: Math.max(0, revenue * 1.2 + assetValue - debt), founderShare })
      : { paid: 0, bought: 0, share: founderShare };
    if (bought.paid > 0) {
      founderShare = bought.share;
      cash -= bought.paid;
      notesFor[company.id] = [...(notesFor[company.id] ?? []), `Bought back ${(bought.bought * 100).toFixed(1)}% of the company for ${money(bought.paid)}. The founders now hold ${Math.round(founderShare * 100)}%.`];
    }

    /*
     * The investors. Reviewed first, against the target that fell due this
     * year; then, if a stake was sold, the terms that came with it. Selling
     * a stake used to cost ownership and nothing else. See `finance.ts`.
     */
    let investors = company.kind === "player" ? company.investors : undefined;
    if (investors) {
      // Investors paid a twentieth of their stake this year do not hold a missed target against the company.
      const patient = payout.investors >= (investors.raised ?? 0) * PATIENT_INVESTORS && payout.investors > 0;
      const review = reviewInvestors(investors, revenue, world.year, { patient });
      investors = review.investors;
      if (review.note) notesFor[company.id] = [...(notesFor[company.id] ?? []), review.note];
    }
    if (company.kind === "player" && raised > 0) {
      investors = termsFor({ existing: investors, raised, revenue, year: world.year });
      notesFor[company.id] = [
        ...(notesFor[company.id] ?? []),
        `The new investors expect revenue of at least £${investors.target.toLocaleString()} next year. Miss their target twice running and the board can remove the chief executive.`,
      ];
    }

    if (company.kind === "player") {
      const allowedShare = (n: number) => n * allowed;
      const opened = openedFor[company.id];
      /*
       * The opening balance is the one the year started from, which is not
       * `company.cash`: opening a city has already come out of that by this
       * point, and a bridge that began after the first withdrawal would not
       * add up.
       */
      const opening = company.cash + (opened?.cost ?? 0);
      const lines: CashLine[] = [];
      if (opened && opened.cost > 0) lines.push({ label: `Opened in ${opened.names.join(", ")}`, amount: -opened.cost });
      lines.push({ label: "Sales", amount: revenue });
      lines.push({ label: "Running the business", amount: -(variable + discretionary - room.build - room.lease + idleCost) + planning });
      if (incidentCost > 0) lines.push({ label: "Breaches and lawsuits", amount: -incidentCost });
      if (partnerShare > 0) lines.push({ label: "Distribution partners' share", amount: -partnerShare });
      if (premium > 0) lines.push({ label: "Insurance", amount: -premium });
      if (extra.cash > 0) lines.push({ label: "Committing to a new region", amount: -extra.cash });
      if (payout.paid > 0) lines.push({ label: "Dividends", amount: -payout.paid });
      if (owedNow > 0) lines.push({ label: "Still owed by customers", amount: -owedNow });
      if (collected > 0) lines.push({ label: "Collected from last year", amount: collected });
      if (sold.cash > 0) lines.push({ label: "Sold to a factor", amount: sold.cash });
      if (moved.fee > 0) lines.push({ label: "Refinancing fee", amount: -moved.fee });
      if (bought.paid > 0) lines.push({ label: "Bought the company back", amount: -bought.paid });
      if (room.build > 0) lines.push({ label: "Building capacity", amount: -room.build });
      if (room.lease > 0) lines.push({ label: "Leased capacity", amount: -room.lease });
      if (room.sold > 0) lines.push({ label: "Capacity sold back", amount: room.sold });
      if (prepaidIn > 0) lines.push({ label: "Annual plans paid up front", amount: prepaidIn });
      if (prepaidOut > 0) lines.push({ label: "Paid up front last year", amount: -prepaidOut });
      if (maturing > 0) lines.push({ label: "Long-term loan repaid", amount: -maturing });
      if (interest > 0) lines.push({ label: "Interest", amount: -interest });
      if (taxed.tax > 0) lines.push({ label: "Tax", amount: -taxed.tax });
      if (borrowed > 0) lines.push({ label: "Borrowed", amount: borrowed });
      if (repaid > 0) lines.push({ label: "Repaid", amount: -repaid });
      if (raised > 0) lines.push({ label: "Raised from investors", amount: raised });
      if (emergencyDrawn > 0) lines.push({ label: "Drawn on credit to stay solvent", amount: emergencyDrawn });

      accounts[company.id] = {
        opening,
        lines,
        pnl: {
          revenue,
          costToServe: variable,
          salaries: fixed,
          marketing: allowedShare(marketing),
          product: allowedShare(product),
          operations: allowedShare(ops),
          /*
           * Room, and only room. The plant — automating it, a second shift,
           * stock held ahead — is already inside `ops`, so adding it here
           * charged the company for it twice in the accounts while the profit
           * underneath counted it once. The column then did not add up to the
           * figure printed below it, which is the one thing a column of costs
           * has to do.
           */
          capacity: room.build + room.lease,
          planning,
          incidents: incidentCost,
          partners: partnerShare,
          insurance: premium,
          idleCapacity: idleCost,
          interest,
          operatingProfit,
          tax: taxed.tax,
          profit,
          lossesCarried: taxed.carried,
        },
      };
    }

    /*
     * The people: a year's worth of loyalty, and the stretch the chief
     * executive set on each seat's next objective. See `people.ts`.
     */
    let people = company.kind === "player" ? company.people : undefined;
    if (company.kind === "player") {
      const overruled = d?.ceo?.overrule || null;
      const next: NonNullable<Company["people"]> = {};
      for (const role of company.seats) {
        if (role === "ceo") continue;
        const person = personOf(company, role);
        const loyalty = yearLoyalty({
          person, role,
          profitable: profit > 0,
          rescued: emergencyDrawn > 0,
          overruled: overruled === role,
          scar: base0?.reviewScar ?? 0,
          pay: payEffect(d?.cto?.engineerPay).pay,
        });
        next[role] = { ...person, loyalty, stretch: d?.ceo?.targets?.[role] ?? person.stretch ?? "fair" };
        if (loyalty < WARN_AT && person.loyalty >= WARN_AT) {
          notesFor[company.id] = [...(notesFor[company.id] ?? []), `The ${ROLE_TITLES[role].toLowerCase()} is thinking about leaving: loyalty is down to ${Math.round(loyalty)}. At ${RESIGN_AT} they go.`];
        }
      }
      if (overruled) {
        notesFor[company.id] = [
          ...(notesFor[company.id] ?? []),
          `The chief executive overruled the ${ROLE_TITLES[overruled as Role].toLowerCase()}: last year's plan ran in that chair instead. It cost ${OVERRULE_LOYALTY} points of their loyalty.`,
        ];
      }
      people = next;
    }

    // Capacity ordered this year opens now that the year is over.
    const { capacityNext, automationNext: _autoNext, leased: _leased, retention: _retention, prReputation: _pr, ramp: _ramp, promo: _promo, regionFocus: _focus, segmentFocus: _segFocus, terms: _terms, ...rest } = company as Company & { capacityNext?: number; automationNext?: number };
    return {
      ...rest,
      ...(company.kind === "player"
        ? {
            tiers: (base0 ?? company).tiers, bonds: bonds.length ? bonds : undefined, prepaid: prepaidIn,
            people, staffQuality: (base0 ?? company).staffQuality, reviewScar: Math.round(review * 100),
            banked: (company.banked ?? 0) + payout.founders,
            receivables,
            terms: terms.days,
            revenueShares: (company.revenueShares ?? []).filter((r) => r.until > world.year),
            // Who the promotion brought in, for next year's churn; who left, and where the company stood, for win-back.
            dealChasers: company.promo
              ? Object.fromEntries(niche.segments.map((s) => [s.id, allocation.fresh[s.id]?.[company.id] ?? 0]))
              : undefined,
            leftLastYear: Object.fromEntries(niche.segments.map((s) => [s.id,
              Object.values(allocation.flows[s.id]?.[company.id] ?? {}).reduce((a, n) => a + n, 0)])),
            lastStats: { quality: company.quality, service: company.service, price: company.price },
            // A shock this year, waiting for the chief executive's answer next year.
            shock: breach
              ? { kind: "breach", year: world.year, reputation: breach.reputation, headline: "A data breach" } as Shock
              : lawsuit ? { kind: "lawsuit", year: world.year, reputation: lawsuit.reputation, headline: "A lawsuit" } as Shock
              : undefined,
          }
        : {}),
      // An asset whose last year this was leaves with it (see ageAssets).
      assets: stillHeld(rest.assets ?? []),
      ...(company.kind === "player" ? { taxLosses: taxed.carried } : {}),
      founderShare,
      // A free tier is talked about: people who use it for nothing tell people.
      brand: clamp(base.brand + (company.kind === "player" ? freeTierBrand(took.freeUsers, niche) * per : 0)),
      quality: base.quality,
      service: clamp(base.service - incidentService),
      capacity: (base as Company & { capacityNext?: number }).capacityNext ?? base.capacity,
      // Automation ordered this year runs from now, like the room built this year.
      ...(company.kind === "player" ? { automation: (base as Company & { automationNext?: number }).automationNext ?? base.automation } : {}),
      unitCost: base.unitCost,
      customers,
      cash,
      debt,
      creditLimit,
      bankruptSince,
      ...(company.kind === "player" ? { creditScore: ratedScore, emergencyDebt, investors } : {}),
      reputation: clamp(base.reputation + repChange),
    };
  });

  /*
   * A buyer's offer the table accepted: the business changes hands now that
   * the year is settled. The seller keeps the company, the seats and the
   * money, and starts again from in front (see `applyAcquisition`).
   */
  let sold = settled;
  for (const [sellerId, sale] of sales) {
    const seller = sold.find((c) => c.id === sellerId);
    const buyer = sold.find((c) => c.id === sale.buyerId);
    if (!seller || !buyer) continue;
    const out = applyAcquisition({ buyer, seller, amount: sale.price, year: world.year });
    sold = sold.map((c) => (c.id === buyer.id ? out.buyer : c.id === seller.id ? out.seller : c));
    notesFor[sellerId] = [...(notesFor[sellerId] ?? []), ...out.sellerNotes];
    if (accounts[sellerId]) accounts[sellerId].lines.push({ label: `Sold the business to ${buyer.name}`, amount: sale.price });
  }

  /*
   * The year's news lands on whoever it happened to, after the market has
   * resolved. A scandal is a consequence of the year, not a condition of it.
   */
  const afterEvent = sold.map((c) => {
    const touched = companyWithEvents(c, events);
    const moved = touched.cash - c.cash;
    const blamed = events.find((e) => e.scope === "company" && e.companyId === c.id && e.effect.cash);
    if (Math.abs(moved) >= 1 && accounts[c.id] && blamed) {
      accounts[c.id].lines.push({ label: blamed.headline, amount: moved });
    }
    /*
     * Everyone hears about a market event; only the company it happened to
     * hears about a company one.
     *
     * The first version of this added the note only when the company's numbers
     * had changed — and `companyWithEvent` returns a market-scope company
     * untouched, because the weather is applied to the economy rather than to
     * anybody's stats. So a supplier failing, a funding winter, a regulator
     * arriving: none of them were ever mentioned to a single player. The year
     * simply got harder for reasons nobody was told.
     */
    const heard = events.filter((e) => e.scope === "market" || e.companyId === c.id);
    if (heard.length > 0 && c.kind === "player") {
      notesFor[c.id] = [...(notesFor[c.id] ?? []), ...heard.map((e) => `${e.headline}. ${e.body} ${e.advice}`)];
    }
    /*
     * A company event that cost reputation is a shock the chief executive can
     * answer next year — a statement, silence, or somebody to blame. A breach
     * or a lawsuit set one at settlement; this is the scandal and the recall.
     */
    const wounding = events
      .filter((e) => e.scope === "company" && e.companyId === c.id && (e.effect.reputation ?? 0) < 0)
      .sort((x, y) => (x.effect.reputation ?? 0) - (y.effect.reputation ?? 0))[0];
    if (c.kind === "player" && wounding) {
      return {
        ...touched,
        shock: { kind: /recall/i.test(wounding.headline) ? "recall" : "scandal", year: world.year, reputation: -(wounding.effect.reputation ?? 0), headline: wounding.headline } as Shock,
      };
    }
    return touched;
  });

  /*
   * Rankings: by what the founders own, not by how many customers they have.
   *
   * Share is the number everyone argues about and it is still on every screen,
   * but ordering by it made the game one-dimensional — volume beat everything,
   * and a team running a small, highly profitable company was told for
   * fourteen days that it was losing. Ranking on the value of what the five of
   * them actually hold makes the premium play, the cheap play and the regional
   * play all legitimate ways to win, and makes diluting the company a decision
   * with a visible cost.
   */
  const valueOf = (c: Company): number => {
    // A year of what its customers actually pay, tier by tier.
    const sales = takings(c, c.customers, niche.segments).revenue;
    const assets = c.assets.reduce((sum, a) => sum + a.bookValue * 0.8, 0);
    return Math.max(0, Math.round(sales * 1.2 + assets - c.debt));
  };
  /*
   * What the founders hold: their share of the company, plus every dividend
   * they have taken out, which is theirs whatever happens next. Paying out is
   * how a team banks a good year against a bad one.
   */
  const founderValueOf = (c: Company): number => Math.round(valueOf(c) * (c.founderShare ?? 1) + (c.banked ?? 0));

  const ordered = [...afterEvent].sort((a, b) => founderValueOf(b) - founderValueOf(a));

  /*
   * What everybody did, once, for every report. Only what a company in the
   * market could see or reasonably estimate from outside: price, who it
   * declared itself for, what it gave up defending, whether it built capacity,
   * and roughly what it spent — rounded to the nearest quarter of a million,
   * because an exact figure would be a way of reading a rival's accounts.
   */
  const names = new Map(world.companies.map((c) => [c.id, c.name]));
  const effective = new Map(withIncumbents.map((c) => [c.id, c]));
  const segmentName = (id: string | undefined | null) => niche.segments.find((sg) => sg.id === id)?.name ?? null;
  const moves: RivalMove[] = afterEvent.map((c) => {
    const before = world.companies.find((b) => b.id === c.id)!;
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      priceBefore: Math.round(before.price),
      priceAfter: Math.round(effective.get(c.id)?.price ?? c.price),
      positioning: c.kind === "player" ? segmentName(c.positioning) : null,
      conceded: (concededFor[c.id] ?? []).map((id) => segmentName(id) ?? id),
      spent: Math.round((visibleSpend[c.id] ?? 0) / 250_000) * 250_000,
      shareBefore: sharesBefore[c.id] ?? 0,
      shareAfter: sharesAfter[c.id] ?? 0,
      capacityBefore: Math.round(before.capacity),
      capacityAfter: Math.round(c.capacity),
    };
  });
  const rankOf = new Map(ordered.map((c, i) => [c.id, i + 1]));

  const reports: CompanyReport[] = afterEvent.map((company) => {
    const units = Object.values(company.customers).reduce((sum, n) => sum + n, 0);
    const before = world.companies.find((c) => c.id === company.id)!;
    /*
     * The year's trading, not the year's bank statement.
     *
     * Profit used to be defined as the change in cash, with costs derived
     * backwards from it — so every pound that moved for a reason other than
     * trading landed in it. A team that borrowed three million was told it had
     * made a profit on a year it lost two; borrowing, raising, selling an
     * asset and being acquired all read as earnings. Worse, the finance seat's
     * challenge to "end the year in profit" could be met by taking out a loan,
     * which is the exact opposite of the thing it was asking for.
     *
     * The engine has always known the real figures at settlement. It just
     * threw them away here.
     */
    const traded = ledger[company.id] ?? { revenue: takings(company, company.customers, niche.segments).revenue, costs: 0, profit: 0 };
    return {
      companyId: company.id,
      name: company.name,
      year: world.year,
      customers: units,
      marketShare: sharesAfter[company.id] ?? 0,
      shareChange: (sharesAfter[company.id] ?? 0) - (sharesBefore[company.id] ?? 0),
      turnedAway: allocation.unserved[company.id] ?? 0,
      revenue: traded.revenue,
      costs: traded.costs,
      profit: traded.profit,
      cash: company.cash,
      debt: company.debt,
      reputation: company.reputation,
      reputationChange: company.reputation - before.reputation,
      quality: company.quality,
      brand: company.brand,
      service: company.service,
      rank: rankOf.get(company.id) ?? 0,
      /*
       * The one this company is most likely to want to read about: its own
       * news first, then the market's. A monthly season can draw three at
       * once and the report has room for one.
       */
      event: (() => {
        const heard = events.filter((e) => e.scope === "market" || e.companyId === company.id);
        const chosen = heard.find((e) => e.scope === "company") ?? heard[0];
        return chosen
          ? {
              headline: inPeriodWords(chosen.headline, periods),
              body: inPeriodWords(chosen.body, periods),
              advice: inPeriodWords(chosen.advice, periods),
              scope: chosen.scope,
              mine: chosen.scope === "market" || chosen.companyId === company.id,
            }
          : undefined;
      })(),
      value: valueOf(company),
      founderValue: founderValueOf(company),
      founderShare: company.founderShare ?? 1,
      notes: (notesFor[company.id] ?? []).map((note) => inPeriodWords(note, periods)),
      bankrupt: !!company.bankruptSince,
      ...(company.kind === "player"
        ? {
            credit: {
              score: company.creditScore ?? RATING_START,
              grade: ratingGrade(company.creditScore ?? RATING_START),
              /** What its debt will cost next year, at the rating it now has. */
              rate: interestOn(company, nextEconomy.interestRate).rate,
              emergencyDebt: company.emergencyDebt ?? 0,
            },
            investors: company.investors,
          }
        : {}),
      ...(company.kind === "player" && accounts[company.id]
        ? {
            pnl: accounts[company.id].pnl,
            cashBridge: { opening: accounts[company.id].opening, lines: accounts[company.id].lines, closing: company.cash },
            segments: segmentBridges({ company, before, effective, names, niche, year: world.year, allocation }),
            rivals: moves.filter((m) => m.id !== company.id),
          }
        : {}),
    };
  });

  /*
   * And who turned up because of how this year went.
   *
   * After the year is resolved, so an entrant is a consequence of what
   * happened rather than a participant in it — they arrive for next year and
   * start from nothing, like anybody else. A market that looks worth entering
   * gets entered, and the clearest sign it is worth entering is somebody
   * having just done well in it. See `entrants.ts`.
   */
  /*
   * And the year's niches, with any that turned out to be the same thing
   * folded together.
   *
   * Two tables in one season will think of similar things — they are looking
   * at the same market and the good ideas in it are not infinite. Left alone,
   * each would get a private run at people the other is also selling to,
   * which is the same niche twice and a head start against somebody who is
   * standing in the same place. Decided after the year rather than when they
   * file, so whoever went first gets a year of it being theirs.
   */
  const beforeMerge = [...(world.openedNiches ?? []), ...openedThisYear];
  const nichesNow = mergeSimilar(beforeMerge);
  if (nichesNow.length < beforeMerge.length) {
    for (const merged of nichesNow) {
      for (const also of merged.alsoFoundBy ?? []) {
        if (also.year !== world.year) continue;
        const first = afterEvent.find((c) => c.id === merged.openedBy);
        for (const id of [merged.openedBy, also.companyId]) {
          const other = id === merged.openedBy ? also.companyId : merged.openedBy;
          const them = afterEvent.find((c) => c.id === other);
          notesFor[id]?.push(
            `${them?.name ?? "Another company"} went looking in the same place and came back with the same people. ${merged.name} is not a corner either of you owns — you are both selling to them, and neither of you has a head start on the other.`,
          );
        }
        void first;
      }
    }
  }

  const arrived = entrantsFor({
    seasonId: world.seasonId,
    year: world.year,
    periods,
    niche,
    companies: afterEvent,
    /*
     * Demand nobody served, summed across segments: the clearest invitation a
     * market sends, because it is people who tried to buy and could not.
     */
    turnedAway: Object.fromEntries(afterEvent.map((c) => [
      c.id,
      niche.segments.reduce((sum, seg) => sum + (allocation.turnedAway[seg.id]?.[c.id] ?? 0), 0),
    ])),
  });
  for (const entrant of arrived) {
    const after = niche.segments.find((s) => s.id === entrant.enteredAfter);
    const note = after
      ? `${entrant.name} has entered the market, aimed squarely at ${after.name.toLowerCase()}.`
      : `${entrant.name} has entered the market.`;
    for (const company of afterEvent) {
      if (company.kind === "player") notesFor[company.id]?.push(note);
    }
  }

  return {
    world: {
      ...world,
      year: world.year + 1,
      companies: [...afterEvent, ...arrived],
      economy: nextEconomy,
      // What is still in force next period, so a year event drawn in the
      // first quarter is still cold weather in the fourth.
      ...(weather.length ? { weather } : {}),
      ...(nichesNow.length ? { openedNiches: nichesNow } : {}),
    },
    reports,
    event,
  };
}
