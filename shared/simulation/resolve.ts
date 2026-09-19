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
import { allocate, marketShares } from "./market";
import { incumbentYear } from "./incumbents";
import { fixedCosts, focusEffects, interlock, lift, debtDrag, nextTechDebt, sanitiseDecisions, idleCapacityCost, marketPriceOf, taxOn, FOCUS_NOTES, type Focus, type TeamDecisions } from "./decisions";
import { shortfalls, expectationsFor, weightsOf } from "./criteria";
import { assetEffects, ageAssets } from "./assets";
import { brandLanding, capacityBuild, qualityLanding, staffing } from "./lag";
import {
  EMERGENCY_REPUTATION, RATING_START, applyRepayment, boardChiefExecutive, creditMultiplier,
  interestOn, justifiedRating, nextRating, ratingGrade, reviewInvestors, termsFor,
} from "./finance";
import { reachOf, appealFor } from "./market";
import { eventFor, economyWithEvent, companyWithEvent, type MarketEvent } from "./events";

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
  const candidates = [
    { axis: "price", score: (w.price / 100) * Math.max(0, me.price - them.price) / Math.max(1, segment.referencePrice),
      text: `who undercut you by ${money(me.price - them.price)}` },
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
  const { niche } = world;
  /*
   * The year's news, decided before anything else and applied to the weather
   * before the market sees it. Drawn from the state of the market rather than
   * out of the air: a company with a poor reputation gets the scandal, one
   * that has been quietly excellent gets the write-up. The dice choose which
   * of the things you had coming arrives, never whether you deserved one.
   */
  const event = options.withoutEvent ? null : eventFor({ world, year: world.year, economy: economy ?? world.economy });
  const nextEconomy = economyWithEvent(economy ?? world.economy, event);
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
    notesFor[company.id] = [...lock.notes];

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

    const brandGain = lift((d.cmo?.brandSpend ?? 0) + (d.cmo?.celebritySpend ?? 0) * 1.4, 220_000, 16) * focus.marketing;
    const perfGain = lift(d.cmo?.performanceSpend ?? 0, 180_000, 9) * focus.marketing;
    /*
     * Half the saturation point and a higher ceiling than shipping: research
     * buys roughly half again as much quality per pound. It needs to, because
     * it lands two years out while everything decays in between — so a payoff
     * merely equal to shipping would make patience strictly worse and the
     * lever a tax on thinking ahead.
     */
    const researched = lift(d.cto?.researchSpend ?? 0, 150_000, 24) * niche.innovationPace;
    /*
     * What the company already owes itself. Carried debt means a share of
     * every engineer's year goes on working around what is already there, so
     * the same money buys less.
     */
    const drag = debtDrag(company.techDebt);
    const techDebt = nextTechDebt({
      current: company.techDebt,
      featureSpend: d.cto?.featureSpend,
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
     * Quality is felt a year after it is built. This year's shipping goes into
     * the pipeline; what arrives now is last year's shipping and research that
     * started two years ago. See `lag.ts`.
     */
    const shipped = (lift((d.cto?.featureSpend ?? 0) + (d.cto?.reliabilitySpend ?? 0) * 1.2, 200_000, 14) * niche.innovationPace * focus.quality) * drag.product;
    const quality = qualityLanding(company, shipped, researched);
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
    const staff = staffing(company, d.coo?.headcount ?? 0);
    if (staff.newHires > 0) {
      notesFor[company.id].push(
        `${staff.newHires} new ${staff.newHires === 1 ? "hire" : "hires"} this year: on the payroll now, and not much use until next year.`,
      );
    }
    const serviceGain = lift(
      (d.coo?.supportSpend ?? 0) + (d.cto?.reliabilitySpend ?? 0) * 0.5 + staff.supportEquivalent,
      150_000, 15,
    ) * focus.quality;
    const costCut = lift(d.coo?.efficiencySpend ?? 0, 180_000, 0.18);

    // Everything decays. A company that stands still goes backwards, which is
    // what stops a good year in year two carrying a team to year fourteen.
    const decay = { brand: 4.5 * focus.decay, quality: 3 * focus.decay, service: 3.5 * focus.decay };

    /*
     * Brand lands half this year and half next — awareness builds, it does
     * not switch on. Performance marketing is the exception and stays
     * immediate: paying for clicks buys this year's clicks, which is the whole
     * trade between the two.
     */
    const brand = brandLanding(company, brandGain);

    /*
     * Capacity built this year opens next year. A cut is immediate — you can
     * close a floor faster than you can fit one out — so this year the company
     * serves with the smaller of what it had and what it asked for.
     */
    const build = capacityBuild(company, d.coo?.capacityTarget ?? company.capacity);
    if (build.building > 0) {
      notesFor[company.id].push(
        `Room for ${build.building.toLocaleString()} more ${niche.voice.capacityShort} is being built. It opens next year; this year you serve with what you had.`,
      );
    }
    const capacity = build.now;
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

    return {
      ...company,
      assets: aged.assets,
      cities,
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
      brand: clamp(company.brand + brand.now + perfGain - decay.brand),
      quality: clamp(company.quality + quality.landed - decay.quality),
      service: clamp(company.service + serviceGain - decay.service),
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
        company.unitCost * (1 - costCut) * (nextEconomy.costIndex / (world.economy?.costIndex || 1)) * focus.cost,
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
  const allocation = allocate(withIncumbents, niche, world.year, nextEconomy);
  const sharesAfter = marketShares(allocation.held);

  /* 4. Money. */
  const settled: Company[] = withIncumbents.map((company) => {
    const customers = allocation.held[company.id] ?? {};
    const units = Object.values(customers).reduce((sum, n) => sum + n, 0);
    const d = byCompany.get(company.id);

    const revenue = units * company.price;
    const variable = units * company.unitCost;
    const marketing = (d?.cmo?.brandSpend ?? 0) + (d?.cmo?.performanceSpend ?? 0) + (d?.cmo?.celebritySpend ?? 0);
    /*
     * Research is in here, and was not.
     *
     * It was added as a lever, charged by the commitment meter, counted
     * against a challenge's spending cap and against a creditor's covenant —
     * and never taken out of the company's cash. A team could put a million a
     * year into next year's product for free, for fourteen years. Every screen
     * said they were spending it; only the bank account disagreed.
     */
    const product = (d?.cto?.featureSpend ?? 0) + (d?.cto?.reliabilitySpend ?? 0)
      + (d?.cto?.techDebtPaydown ?? 0) + (d?.cto?.researchSpend ?? 0);
    const ops = (d?.coo?.supportSpend ?? 0) + (d?.coo?.efficiencySpend ?? 0);
    const fixed = company.kind === "player"
      ? fixedCosts(company, d?.coo?.headcount ?? 0, nextEconomy, reachOf(company, niche)) * focusEffects(d?.ceo?.focus).fixed
      : 0;
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
    const buffer = Math.max(0, d?.cfo?.cashBuffer ?? 0);
    /*
     * Measured against everything the table could actually spend, which is
     * what the commitment meter has always shown: cash, plus anything drawn
     * down, plus the credit still available, less what finance is holding
     * back. Measuring the cut against cash alone meant a company could read as
     * comfortably funded on every screen and still lose a third of its year —
     * two numbers describing the same decision and disagreeing.
     */
    const spendable = Math.max(
      0,
      company.cash + (d?.cfo?.borrow ?? 0) + Math.max(0, company.creditLimit - company.debt) - buffer,
    );
    const wanted = marketing + product + ops;
    const allowed = wanted > spendable && wanted > 0 ? spendable / wanted : 1;
    if (company.kind === "player" && allowed < 1) {
      notesFor[company.id] = [
        ...(notesFor[company.id] ?? []),
        `Finance held ${Math.round(buffer).toLocaleString()} back, so ${Math.round(wanted).toLocaleString()} of planned spending became ${Math.round(wanted * allowed).toLocaleString()}. Everyone's year was cut by the same fraction.`,
      ];
    }

    const discretionary = company.kind === "player"
      ? (marketing + product + ops) * allowed + fixed
      : (spendFor[company.id] ?? 0);
    visibleSpend[company.id] = company.kind === "player"
      ? (marketing + product + ops) * allowed
      : (spendFor[company.id] ?? 0);

    const borrowed = Math.max(0, d?.cfo?.borrow ?? 0);
    const repaid = Math.max(0, d?.cfo?.repay ?? 0);
    const raised = Math.max(0, d?.cfo?.raiseAmount ?? d?.cfo?.raise?.amount ?? 0);

    /*
     * Headroom paid for and not used. The company's own capacity, not what a
     * distribution deal lends it — a deal is somebody else's warehouse, and
     * the point of buying one is that you do not pay for its empty shelves.
     */
    const ownCapacity = (baseById.get(company.id) ?? company).capacity;
    const idle = company.kind === "player" ? Math.max(0, ownCapacity - units) : 0;
    const idleCost = company.kind === "player" ? idleCapacityCost(idle, niche) : 0;
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
      ? interestOn(company, nextEconomy.interestRate)
      : { interest: company.debt * nextEconomy.interestRate, rate: nextEconomy.interestRate, emergencyRate: nextEconomy.interestRate };
    const interest = rates.interest;
    const operatingProfit = revenue - (variable + discretionary + interest + idleCost);
    const taxed = company.kind === "player" ? taxOn(operatingProfit, company.taxLosses ?? 0) : { tax: 0, carried: 0 };
    const costs = variable + discretionary + interest + idleCost + taxed.tax;
    const profit = revenue - costs;
    /*
     * Kept, because the report used to throw this away and recompute profit as
     * the change in cash — see the note where the reports are built.
     */
    ledger[company.id] = { revenue, costs, profit };

    let cash = company.cash + profit + borrowed + raised - repaid;
    let debt = Math.max(0, company.debt + borrowed - repaid);

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

    // What a bank will lend against reputation and what the company holds.
    const assetValue = company.assets.reduce((sum, a) => sum + a.bookValue, 0);
    const creditLimit = Math.max(0, Math.round(
      (revenue * 0.35 + assetValue * 0.5 + company.reputation * 4_000)
      // A lender lends more to a company it rates, and far less to one it does not.
      * (company.kind === "player" ? creditMultiplier(creditScore ?? RATING_START) : 1),
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
    const valueForMoney = company.price > 0
      ? Math.min(2, (company.quality / 100) / (company.price / marketPrice))
      : 0;
    const repChange =
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
      const worth = Math.max(500_000, units * company.price * 1.2 + assetValue - debt);
      founderShare = Math.max(0.05, founderShare * (worth / (worth + raised)));
      notesFor[company.id] = [
        ...(notesFor[company.id] ?? []),
        `Raised ${Math.round(raised).toLocaleString()} against a company worth about ${Math.round(worth).toLocaleString()}. The founders now hold ${Math.round(founderShare * 100)}% of whatever this becomes.`,
      ];
    }

    /*
     * The investors. Reviewed first, against the target that fell due this
     * year; then, if a stake was sold, the terms that came with it. Selling
     * a stake used to cost ownership and nothing else. See `finance.ts`.
     */
    let investors = company.kind === "player" ? company.investors : undefined;
    if (investors) {
      const review = reviewInvestors(investors, revenue, world.year);
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
      lines.push({ label: "Running the business", amount: -(variable + discretionary + idleCost) });
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
          idleCapacity: idleCost,
          interest,
          operatingProfit,
          tax: taxed.tax,
          profit,
          lossesCarried: taxed.carried,
        },
      };
    }

    // Capacity ordered this year opens now that the year is over.
    const { capacityNext, ...rest } = company as Company & { capacityNext?: number };
    return {
      ...rest,
      ...(company.kind === "player" ? { taxLosses: taxed.carried } : {}),
      founderShare,
      brand: base.brand,
      quality: base.quality,
      service: base.service,
      capacity: (base as Company & { capacityNext?: number }).capacityNext ?? base.capacity,
      unitCost: base.unitCost,
      customers,
      cash,
      debt,
      creditLimit,
      bankruptSince,
      ...(company.kind === "player" ? { creditScore, emergencyDebt, investors } : {}),
      reputation: clamp(base.reputation + repChange),
    };
  });

  /*
   * The year's news lands on whoever it happened to, after the market has
   * resolved. A scandal is a consequence of the year, not a condition of it.
   */
  const afterEvent = settled.map((c) => {
    const touched = companyWithEvent(c, event);
    const moved = touched.cash - c.cash;
    if (Math.abs(moved) >= 1 && accounts[c.id] && event) {
      accounts[c.id].lines.push({ label: event.headline, amount: moved });
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
    const heard = event && (event.scope === "market" || event.companyId === c.id);
    if (heard && c.kind === "player") {
      notesFor[c.id] = [...(notesFor[c.id] ?? []), `${event!.headline}. ${event!.body} ${event!.advice}`];
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
    const units = Object.values(c.customers).reduce((sum, n) => sum + n, 0);
    const assets = c.assets.reduce((sum, a) => sum + a.bookValue * 0.8, 0);
    return Math.max(0, Math.round(units * c.price * 1.2 + assets - c.debt));
  };
  const founderValueOf = (c: Company): number => Math.round(valueOf(c) * (c.founderShare ?? 1));

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
    const traded = ledger[company.id] ?? { revenue: units * company.price, costs: 0, profit: 0 };
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
      event: event
        ? {
            headline: event.headline,
            body: event.body,
            advice: event.advice,
            scope: event.scope,
            mine: event.scope === "market" || event.companyId === company.id,
          }
        : undefined,
      value: valueOf(company),
      founderValue: founderValueOf(company),
      founderShare: company.founderShare ?? 1,
      notes: notesFor[company.id] ?? [],
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

  return {
    world: { ...world, year: world.year + 1, companies: afterEvent, economy: nextEconomy },
    reports,
    event,
  };
}
