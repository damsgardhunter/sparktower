/**
 * A table that plays the forecast.
 *
 * Every bot until now decided one seat at a time. `botDecision` is called
 * once per role with that role's levers and no idea what the other four are
 * doing, so the marketing seat spends against the same cash the technology
 * seat is spending against and neither knows. That is a fair model of a table
 * that does not talk to each other, and it is why the difficulty tiers came
 * out within a point of one another: five seats guessing separately cannot
 * add up to a plan.
 *
 * This one decides the whole company at once. One budget, one objective, and
 * every lever in the game competing for the same pound — which is what a
 * table actually argues about, and the only way an answer can be optimal
 * rather than merely reasonable.
 *
 * ## What it maximises
 *
 * Next year's forecast. It runs the year, and then asks what the company it
 * has become could sell the year after.
 *
 *     maximise   the forecast a year out, once this plan has been played
 *     such that  the company is still solvent when it gets there
 *
 * The lookahead is the whole of it, and two shorter objectives were tried
 * first and are worth recording because each failed in its own direction.
 *
 * **Maximising money** did exactly what it was asked: it raised the price a
 * little every year, compounding to almost three hundred times where it
 * started, served a hundred and seventy thousand customers where the ordinary
 * bot served one and a half million, and finished with £1.9bn, brand 30 and
 * quality 4. A correct answer to the wrong question — and a useful one, since
 * it says plainly that this engine still rewards gouging.
 *
 * **Maximising this year's forecast** put nothing at all into the product,
 * and it was right to: `projected` in `forecast.ts` deliberately leaves this
 * year's shipping out, because it lands next year. A one-year objective
 * cannot see a pipeline, so it will not pay for one, and the optimiser came
 * last of the three tiers with quality 5.
 *
 * A year of lookahead is the shortest horizon that can see brand landing,
 * quality landing, room opening and a hire becoming useful — which is to say
 * the shortest horizon at which this game has anything to decide.
 *
 * ## Where it stands
 *
 * It is the best table in the codebase on the three things a season is made
 * of, and level on the fourth:
 *
 * ```
 * mode        value     cash   customers   survived
 * idle        £0.0m    £3.4m          11         0%
 * filler      £9.9m   £10.6m     167,242        83%
 * survivor   £10.6m   £18.3m     198,313        86%
 * optimal    £15.1m   £31.1m     247,943        86%
 * ```
 *
 * Four things got it there, and three of them are corrections to how a
 * business is modelled rather than to the search:
 *
 *   - **Three years of rollout, with a continuation that grows.** Holding a
 *     frozen plan understates every growth strategy, because the plan that
 *     wins is the one that spends more as the company earns more.
 *   - **A plant allowed to double.** Capped at half as much again it could
 *     never reach the size the ordinary bot gets to by simply building ahead
 *     every year, and customers sat a fifth below it.
 *   - **Cash worth a little, not nothing and not a lot.** `valueOf` leaves
 *     cash out, so with no weight at all the search spent to the last pound
 *     for any gain however small; at a half it hoarded and the business
 *     collapsed to 29,000 customers. Eight hundredths is the measured middle.
 *   - **Two years of costs held back**, which is worth three points of
 *     survival against one year and does not make it timid the way three
 *     does.
 *
 * It decides 16 of the game's 72 levers against the survivor tier's 40 and
 * beats it anyway, which remains the most interesting thing about it.
 *
 * ## Why it ramps rather than jumps
 *
 * Every lever in the engine saturates — `lift` is a diminishing return, by
 * design, so that no seat can buy an outcome outright. Allocating the budget
 * a step at a time to whichever lever returns most at the margin therefore
 * produces exactly the behaviour a good operator has: brand and product and
 * service all rising together, none of them starved, none of them gorged,
 * and the whole thing growing as the company can afford more of it.
 *
 * Nothing here is random. Given the same company in the same market it files
 * the same plan, which is what makes it a benchmark: when a change to the
 * engine moves what the best possible table achieves, that is worth knowing,
 * and a bot with jitter in it cannot tell you.
 */
import type { Company, Economy, Niche, Role, World } from "./types";
import type { TeamDecisions } from "./decisions";
import { forecastDemand } from "./forecast";
import { resolveYear } from "./resolve";
import { isUnlocked } from "./responsibilities";
import { staffFor } from "./workforce";
import { HOURS_A_WEEK, buildableActions, foundersActions } from "./actions";
import { marketListings } from "./assets";
import { atScale, expectedPrice, snapPrice } from "./market";
import { EXECUTIVE, officerCost, officersOf } from "./decisions";
import { announcedRegion, EXPANSION_DISCOUNT, firstYearReach } from "./world";
import { LEVER_FIELDS, type LeverField } from "./levers";
import { withOptions, type OfferView } from "./lever-options";
import { ROLES } from "./types";

/** One lever the optimiser can put money into, and where it lives. */
interface SpendLever {
  role: Role;
  field: string;
  /** Roughly where this lever stops paying, so the search can size its steps. */
  scale: number;
}

/**
 * The levers worth optimising over.
 *
 * Deliberately not every money lever in the game. Borrowing and raising are
 * the finance seat's and change what the company *is* rather than what it
 * does with a year; a bot inventing a loan is a bot making a decision nobody
 * asked it to. The rest are here in the order the engine cares about them.
 */
const SPEND_LEVERS: SpendLever[] = [
  { role: "cmo", field: "brandSpend", scale: 220_000 },
  { role: "cmo", field: "performanceSpend", scale: 180_000 },
  { role: "cto", field: "featureSpend", scale: 200_000 },
  { role: "cto", field: "reliabilitySpend", scale: 200_000 },
  { role: "coo", field: "supportSpend", scale: 150_000 },
  { role: "coo", field: "efficiencySpend", scale: 180_000 },
];

/** How much of what it could lay hands on the optimiser will commit in one year. */
export const OPTIMISER_COMMITS = 0.35;

/**
 * How much of the cash it is actually holding a plan may commit in one period.
 *
 * Separate from `OPTIMISER_COMMITS`, which paces *borrowing* and is right to:
 * drawing a whole credit line in a month is how a company kills itself. Money
 * in the bank is a different question — it is this period's budget, and pacing
 * it at a fiftieth a month is how £51,119 of borrowed money sat untouched
 * while the company lost £3,892 a month around it.
 *
 * A third, so a plan can move decisively and still cannot empty the account on
 * one month's conviction. The solvency gate above still holds the reserve back
 * on top of this.
 */
export const CASH_COMMITS = 1 / 3;

/**
 * And what it will not spend, whatever the forecast says: a year of what the
 * company costs to run, kept back.
 *
 * An optimiser with solvency as its only constraint spends to exactly that
 * constraint — it finished every year on nothing, because a pound in the bank
 * scores nothing and a pound of marketing scores customers. Then one ordinary
 * bad year, a shock or a rival's price move, and it was gone: 52% survival
 * against the ordinary bot's 86%, which is not what an optimal table looks
 * like.
 *
 * A reserve is not caution, it is the constraint that was missing: the
 * objective is what the company is worth a few years out, and one that
 * cannot reach them is not worth anything. Two years of costs, measured —
 * one leaves it growing hard and dying at 83%, three makes it timid and it
 * dies at 83% again with a third less business to show for it.
 */
export const OPTIMISER_RESERVE_YEARS = 2;

/**
 * How many years of the plan to play out before scoring it.
 *
 * Every year is another run of the whole engine for every candidate, and
 * there are of the order of a hundred candidates a decision — so this is the
 * expensive constant. One is blind to compounding; two sees a pipeline land;
 * three sees whether the company that lands it is still growing.
 */
export const ROLLOUT_YEARS = 3;

/**
 * What a pound in the bank is worth against a pound of company.
 *
 * Zero, and measured: at a half the optimiser went straight back to hoarding
 * — value fell from £11.5m to £4.1m, customers from 176,000 to 29,000, and
 * survival from 93% to 67%. `valueOf` is what the season ranks founders on
 * and it leaves cash out deliberately. The way to finish with money here is
 * to own something worth money, not to be paid for holding it.
 */
export const CASH_WEIGHT = 0.08;

/**
 * What a point of market share is worth, against owning the whole market.
 *
 * The objective was all money and no position, and money alone does not ask
 * for growth: a company keeping its customers while the market adds more comes
 * out level, so Nova would take a channel from 0.08% to 0.4% in a year and
 * score it as a good plan with the marketing budget untouched. The owner's
 * standard is 10–15% of a market by the end of a season, and an objective that
 * cannot tell 0.4% from 4% will never find it.
 *
 * Expressed as a share of what the whole market would be worth at this
 * company's own margin, so it is in the same units as everything else in the
 * score and cannot be won by charging more (the price is anchored to the
 * market's reference — see `PRICE_TRIES`).
 */
export const SHARE_PRIZE = 4;

/**
 * How much to try raising, as shares of what the company is worth.
 *
 * Keyed on its worth and not on its headroom, which was the first answer and
 * is backwards for the only company that needs this: a startup with an
 * exhausted credit line can lay hands on nothing, so shares of *that* are
 * nothing, and the search could only raise money for companies that already
 * had money. Somebody raising at this stage is selling a share of what the
 * business might become, which is what `worth` is — and `resolve` prices the
 * dilution off exactly the same figure.
 */
const RAISE_TRIES = [0.1, 0.2, 0.33];

/** How much of the remaining credit line to try drawing on, as shares of it. */
const BORROW_TRIES = [0.25, 0.5];


/**
 * How many years of the position to count, when nobody says how long the
 * season is.
 *
 * This number is the whole of the optimiser's patience, and it is worth more
 * than any other constant in here. At five it would not invest at all in a
 * hard market: a pound of brand has to win back a fifth of itself in
 * customers *next year* to pay, brand compounds over many years, and so the
 * search banked the money and watched the company bleed to death — three
 * seasons in a row of spending nothing while customers fell from 25,000 to
 * 11,000. Survival ran at 62%. At twelve it invests, and survival is 76%; above the season's own length it
 * makes no further difference, because `life` is capped by the years left.
 *
 * Counted from the years actually left in the season where the caller knows,
 * so a table is patient in year two and harvests in year thirteen, which is
 * how anybody with an exit date behaves.
 */
export const VALUE_YEARS = 14;

/** How long a season runs, when the caller does not say. */
export const ASSUMED_SEASON = 14;

/**
 * How many slices the budget is handed out in. More is finer and slower, and
 * every slice costs a full run of the year across every lever — so ten is a
 * deliberate trade against the lookahead being expensive.
 */
export const OPTIMISER_STEPS = 16;

/**
 * Prices tried, as a multiple of what the segment the company opens onto
 * expects to pay.
 *
 * Anchored to the market rather than to what the company charged last year,
 * which compounds: a search that may raise the price by half each year and is
 * run fourteen years running can reach two hundred and ninety times where it
 * started, one step at a time, each step locally optimal.
 */
const PRICE_TRIES = [0.55, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5];

/** Cash plus what the bank would still lend: what a plan is allowed to think with. */
function headroom(company: Company): number {
  return Math.max(0, company.cash) + Math.max(0, (company.creditLimit ?? 0) - (company.debt ?? 0));
}

/** The plan as a decision the engine will accept. */
/** The two structural choices, kept together because they are decided together. */
interface Shape {
  /** A region to open, if the table is putting one up this year. */
  region: string | null;
  /**
   * Equity sold this period, in money.
   *
   * On the shape beside `borrow` because it is the other way to pay for a
   * plan, and like borrowing it is tried against a finished plan rather than
   * inside the budget: raising is only worth doing if there is something to
   * spend it on.
   */
  raise?: number;
  /**
   * How the founders split their own week, as hours against action ids.
   *
   * On the shape rather than in the budget because it costs no money: every
   * other lever in the ascent competes for a slice of the money, and this
   * competes for the week. Chosen after the money is allocated — see the
   * greedy pass at the end of `optimise`.
   */
  hours?: Record<string, number>;
  /**
   * Every other lever the plan has an answer for, per desk: the chief
   * executive's focus and positioning, the feature bet, the programme, the
   * insurance, the offers — the "wordy" decisions. Laid over the desk this
   * year only; see `decideTheRest`.
   */
  extras?: Partial<Record<Role, Record<string, unknown>>>;
  /**
   * Desks somebody else has already filed, held exactly as filed.
   *
   * At a five-person table Nova plans one chair, and the best answer for that
   * chair depends on what the other four actually chose — a positioning is
   * worth something different at the price the marketing seat set than at the
   * price Nova would have set. Planning against its own imagined colleagues
   * gave an answer for a company that did not exist.
   */
  fixed?: Partial<Record<Role, any>>;
  /** What to draw down to pay for the plan. */
  borrow: number;
  /*
   * ## Renting room: tried, and it is not what makes capital matter
   *
   * `leaseCapacity` is the one lever that buys *time* — room for this period
   * rather than a build that opens next — so it looked like the reason the
   * opening balance does not matter. A written consultancy finishes a season on
   * £75.50m from £4.55m and £75.39m from £60k, a tenth of a per cent apart on
   * seventy-six times the capital, and a company that cannot buy speed can
   * only grow at the build lag whatever is in the bank.
   *
   * Wiring it in as a third structural choice did not change that. Measured
   * across seven written markets at £60k against £4.55m: four finished
   * *identical*, two finished worse with more money, and only one moved at all
   * (by 2%). What it did do is let a launch business rent unbounded room in a
   * market where a sale is £4.5m and a unit of plant is not — it finished on
   * £10.5bn from £60,000, against £756m before.
   *
   * So capital irrelevance is not a missing lever. Over fourteen years of
   * reinvestment an opening balance is a rounding error: the business funds
   * growth from revenue, and `headroom` grows with revenue and reputation, so
   * every company earns its way to the same place. Making capital matter needs
   * either a shorter horizon or an advantage money buys that cannot be earned
   * back — a region, a patent, a licence — and that is a design decision rather
   * than a search one.
   */
}

function draftOf(
  company: Company,
  spend: Record<string, number>,
  price: number,
  capacityTarget: number,
  headcount: number,
  shape: Shape,
): TeamDecisions {
  /*
   * Opening a region takes a majority of the seats, and this is the one
   * decision in the game that an optimiser can express and five independent
   * seats structurally cannot: operations puts it up and the others vote. No
   * bot had ever opened a region, in any season, which is why a company was
   * confined for fourteen years to the one region it started in — a tenth of
   * a market at best, and most of why market shares read as low single
   * digits.
   */
  const vote = shape.region ? { expandVote: { [shape.region]: "yes" as const } } : {};
  const planned: TeamDecisions = {
    companyId: company.id,
    cmo: {
      price,
      brandSpend: spend.brandSpend ?? 0,
      performanceSpend: spend.performanceSpend ?? 0,
      celebritySpend: 0,
      targetCities: company.cities,
      ...vote,
      ...shape.extras?.cmo,
    },
    cto: {
      featureSpend: spend.featureSpend ?? 0,
      reliabilitySpend: spend.reliabilitySpend ?? 0,
      /*
       * A fixed share of the shipping, back into the debt it creates.
       * Shipping hard and never paying any of it back buys outages and
       * breaches, and those cost reputation, which costs customers — a cost
       * the forecast cannot see, so the optimiser would never choose it.
       */
      techDebtPaydown: Math.round((spend.featureSpend ?? 0) * 0.4),
      ...vote,
      ...shape.extras?.cto,
    },
    coo: {
      capacityTarget,
      supportSpend: spend.supportSpend ?? 0,
      efficiencySpend: spend.efficiencySpend ?? 0,
      headcount,
      ...(shape.region ? { expand: shape.region } : {}),
      ...shape.extras?.coo,
    },
    /*
     * And it borrows to pay for growth, which no bot has ever done either.
     * A business that will only spend what is already in the bank is not
     * being careful, it is refusing to use half of what the finance seat is
     * for — and the engine bounds the draw at what the bank would actually
     * lend (see `drawdown`), so this cannot run away.
     */
    cfo: { borrow: Math.max(0, Math.round(shape.borrow)), raiseAmount: Math.max(0, Math.round(shape.raise ?? 0)), repay: 0, cashBuffer: 0, ...vote, ...shape.extras?.cfo },
    // Growth, and an answer ready for whatever went wrong: silence recovers
    // far less of what a shock costs, and the forecast cannot see that either.
    ceo: { focus: "growth", shockAnswer: "statement", founderHours: shape.hours ?? {}, ...vote, ...shape.extras?.ceo } as TeamDecisions["ceo"],
  };
  for (const [role, filed] of Object.entries(shape.fixed ?? {})) {
    if (filed) (planned as any)[role] = filed;
  }
  return planned;
}

export interface OptimiserInput {
  world: World;
  companyId: string;
  year: number;
  economy: Economy;
  /** How many decisions make a year, since every budget here is an annual one. */
  periods?: number;
  /** How long the season runs, so the last years can be played as last years. */
  totalYears?: number;
  /** This year's offers from outside, so the plan can answer them. */
  offers?: OfferView[];
  /**
   * Which levers this company has this year. Defaults to the table's unlock
   * schedule; a solo founder is on their own (`soloSchedule`), so the route
   * passes theirs in.
   */
  unlocked?: (role: Role, field: string) => boolean;
  /** The desks this plan is for. Every desk when absent. */
  desks?: Role[];
  /** Other desks' filed decisions, held fixed while these are planned. */
  fixed?: Partial<Record<Role, any>>;
}

export interface OptimisedPlan {
  decisions: TeamDecisions;
  /** What the plan is expected to be worth, by the objective above. */
  score: number;
  /** The customers it expects to serve. */
  serves: number;
  /** What it commits, across every lever. */
  spends: number;
}

/**
 * The best plan this company can file this year.
 *
 * Coordinate ascent: hand the budget out one slice at a time, each slice to
 * whichever lever is worth most at the margin, re-pricing and re-sizing the
 * plant as it goes. It is not a proof of optimality — the objective is not
 * convex and the engine is not differentiable — but it is a genuine search
 * over the whole company rather than five seats guessing separately, and it
 * beats both of the existing tiers by a distance.
 */
export function optimise(input: OptimiserInput): OptimisedPlan | null {
  const { world, companyId, year, economy } = input;
  const periods = Math.max(1, Math.round(input.periods ?? world.periodsPerYear ?? 1));
  const per = 1 / periods;
  const company = world.companies.find((c) => c.id === companyId);
  if (!company) return null;
  const niche = world.niche;

  /*
   * The years left, which is what the position is worth holding for. A
   * company with twelve years ahead of it should buy a brand; one with two
   * should not.
   */
  const life = Math.max(2, Math.min(VALUE_YEARS, (input.totalYears ?? ASSUMED_SEASON) - Math.floor((year - 1) / periods)) - 1);

  /*
   * What this period may commit: a share of what the company could lay hands
   * on, as a rate over the year.
   *
   * ## Why the slice being small is not the thing starving a small business
   *
   * Dropping the `* per` was tried, because for a one-van business on £2,000
   * it makes the slice £59 instead of £5 against lift thresholds of about
   * £570, and £5 a month is not how anybody buys leaflets. It changes nothing:
   * at £59 the search still declines every lever, each one scoring fifteen
   * points *below* spending nothing. `OPT_TRACE=1` prints it either way.
   *
   * The reason is that the business is capacity-bound, not demand-bound. In
   * month one it had room for twelve jobs and turned away 176 riders who
   * wanted it. Brand buys demand, and demand it cannot serve is worth less
   * than the money — so declining to market is the right answer, and what it
   * does instead is build: capacity goes 12 to 44 over two years, which is as
   * fast as £2,000 pays for. The discretionary levers are quiet because the
   * operations lever is the one that matters, and that one is being used.
   *
   * So this stays as it was. Removing it would make a monthly season commit
   * twelve times more per decision — including the company workshop seasons
   * that run monthly — for no measured gain.
   */
  /*
   * How far ahead a candidate is played, in periods.
   *
   * `ROLLOUT_YEARS` is written as years — "one is blind to compounding, two
   * sees a pipeline land, three sees whether the company that lands it is
   * still growing" — and the loop below advances `year` by one, which in a
   * monthly season is one *month*. So a monthly season looked three months
   * ahead and a yearly one three years, and the constant's own reasoning only
   * held for the yearly case.
   *
   * Three months cannot see brand or quality pay for themselves, because they
   * do not: they pay over a year. So the search declined every lever on a real
   * season — measured on one, every candidate scored below spending nothing,
   * and Nova filed five desks of zeroes. Played out, that plan lost 45% of the
   * subscribers a modest 2%-of-cash-a-month plan won and let quality rot from
   * 38 to 27 while holding the money.
   *
   * A year at minimum, so the horizon is a span of time rather than a count of
   * filings. Not `ROLLOUT_YEARS * periods` — three years of months is 36 runs
   * of the engine per candidate against a hundred-odd candidates a decision,
   * and this is already the expensive constant. A year is what it takes to see
   * the levers pay; the yearly season keeps its three.
   */
  const rollout = Math.max(ROLLOUT_YEARS, periods);

  /*
   * And cash in hand is not rationed the way a credit line is.
   *
   * `headroom × OPTIMISER_COMMITS × per` is "a share of everything it could
   * lay hands on, as a rate over the year", and as a rule for *borrowing* that
   * is right: a company should not draw its whole facility in a month. Applied
   * to money already in the bank it produced the thing the owner spotted —
   * Nova drew £51,119 on day one, committed £3,750, and banked the rest, then
   * went on committing about a fiftieth of its balance a month while losing
   * money. Cash it already has is not a facility to be paced; it is this
   * period's budget.
   *
   * So the cap is the pacing rule applied to what it could *borrow*, plus a
   * real share of what it is actually holding. It can still only draw a slice
   * of the credit line in a period, and it can now spend the money it drew.
   */
  const inHand = Math.max(0, company.cash);
  const borrowable = Math.max(0, headroom(company) - inHand);
  const affordable = (borrowable * OPTIMISER_COMMITS * per) + (inHand * CASH_COMMITS);
  const step = affordable / OPTIMISER_STEPS;
  const mine = (role: Role) => !input.desks || input.desks.includes(role);
  const levers = SPEND_LEVERS.filter((l) => mine(l.role) && isUnlocked(l.role, l.field, year, periods));

  /** Staff enough to serve, and no more: every head is a salary whether it is busy or not. */
  /**
   * How many people it takes to serve the room a plan asks for.
   *
   * This was `officers + capacity / 40_000`: a constant, in an engine where one
   * worker in a consultancy looks after a handful of clients and one in a
   * podcast network looks after tens of thousands. The market already says
   * which — every niche carries a `workforce` whose `serves` figure is exactly
   * this number — and `staffFor` already turns that into a headcount. It was
   * never called by anything, along with `canServe` beside it.
   *
   * The constant is why margins come out where they do. A consultancy serving
   * 2,016 clients at £31,210 apiece — £62.9m of revenue — ran on five people,
   * because 2,627 of capacity over 40,000 rounds to nothing. Nothing else in
   * the plan scales with the business either: the optimiser commits £0 in most
   * years, so there is no marketing or product spend to absorb the gross
   * margin, and payroll was the only cost left that could have. Post-tax net
   * margins came out at 52-68% across fourteen markets, against 5-25% in the
   * trades they are modelled on.
   *
   * Taken from the room rather than from today's capacity, because the plan is
   * deciding the room: staffing the company it is now and then selling what
   * the new plant can hold is how you serve £62.9m with five people.
   */
  const staffedFor = (room: number): number => {
    const officers = officersOf(company);
    const hired = staffFor(niche, Math.max(0, room), officers);
    /*
     * Staff only. `headcount` is the people *beyond* the founders — its own
     * lever says so — and `staffFor` already takes the founders off. Adding
     * them back, and flooring at one, had every plan Nova filed hire the
     * founders again as employees: a solo founder was charged a salary for a
     * person who was themselves.
     */
    return Math.max(0, Math.round(Number.isFinite(hired) ? hired : 0));
  };

  /** What the company costs to run before it does anything: the floor the plan has to clear. */
  /*
   * What the company costs to run before it does anything, from the one
   * function that knows: `officerCost`.
   *
   * This was `officersOf(company) * EXECUTIVE * (company.scale ?? 1)` — its
   * own arithmetic, and wrong twice over. It scaled by `scale` where the real
   * bill scales by `payScale(scale)`, and it did not know about `officerPay`
   * at all, so a season where the founders draw nothing — every solo season,
   * and now every season built from a project — still had two years of five
   * full salaries held back out of its spending.
   *
   * That reserve is a hard gate: a plan leaving cash below it scores minus
   * infinity. So the money a startup made went unspent because the search was
   * protecting a payroll that does not exist, which is what "why is it not
   * spending any of the money it made" turned out to be.
   */
  const fixedPerYear = officerCost(company);

  const spend: Record<string, number> = {};
  for (const l of levers) spend[l.field] = 0;

  /**
   * What this segment thinks the ordinary thing costs: the anchor for every
   * price tried — in *this year's* money.
   *
   * Static, this was the whole reason a plan held one price for thirteen years.
   * Every price the search considers is a multiple of this anchor, so an anchor
   * that never moved meant the same ladder of candidate prices every year while
   * the cost of serving a customer climbed underneath it. Holding the price was
   * the correct answer to the question being asked; the question was wrong.
   */
  const cheapest = [...niche.segments].sort((a, b) => a.referencePrice - b.referencePrice)[0];
  const reference = cheapest ? expectedPrice(cheapest, year) : company.price;


  /**
   * Every candidate price, as multiples of the cheapest segment's expectation.
   *
   * Anchored on the market and not on what the company charged last year: a
   * search allowed to raise its own price by half a year reaches 290x where it
   * started over fourteen years, one locally-optimal step at a time.
   *
   * ## Why the cheapest segment, and not all of them
   *
   * Widening the ladder to every segment's expectation was tried, because the
   * cheapest-only anchor leaves the price lever dead in a market whose segments
   * are far apart — a launch business opens at £4.5m while the ladder spans
   * £330k to £900k, so every candidate is an 80% cut that loses money and the
   * opening price survives all fourteen years untouched.
   *
   * It broke nine balance guards and they diagnosed it exactly: "the same
   * strategy won everywhere: premium, premium, premium, premium, premium,
   * premium, premium", and "cheap is hopeless everywhere". Given the option of
   * pricing at the dear segment the search always takes it, because value is
   * maximised by a fat margin on few customers — so the whole field converges
   * on one strategy and the volume plays stop being viable at all.
   *
   * So this anchor is not only the anti-spiral guard. It is what keeps more
   * than one way to play. The dead lever in a wide-spread market is the price
   * of that and is the cheaper of the two problems; fixing it properly means
   * making the appeal curve punish premium pricing harder, which is a change to
   * how the market works rather than to how the search reads it.
   */
  const priceTries = PRICE_TRIES.map((m) => Math.max(1, snapPrice(reference * m, reference)));

  const measure = (trial: Record<string, number>, price: number, shape: Shape): { score: number; serves: number; room: number; revenue: number } => {
    /*
     * Room is chased to this year's forecast rather than chosen
     * independently. What is built this year opens next, so this is the plant
     * the plan is asking for.
     */
    const probe = forecastDemand({ world, companyId, year, economy, draft: draftOf(company, trial, price, company.capacity, staffedFor(company.capacity), shape) });
    if (!probe) return { score: -Infinity, serves: 0, room: company.capacity, revenue: 0 };
    /*
     * The plant is sized against the band, not the middle of it.
     *
     * This is where the forecast's uncertainty actually belongs. Room built
     * for the likely case and paid for whether or not it fills is a bet on
     * the mean; sizing nearer the low end costs a few turned-away customers
     * in a good year and nothing in a bad one, which is the trade a real
     * operation makes.
     *
     * Requiring the *spend* to be covered by the low case was tried instead
     * and is far too strict — it forbids investing ahead of revenue at all,
     * and the optimiser funded brand alone, £440,000 of a £4.4m budget,
     * because every further slice failed the constraint. Solvency is guarded
     * after the year is played, where it can be checked rather than guessed.
     */
    /*
     * And the plant grows at the speed a plant grows.
     *
     * Sizing it straight off the forecast let the sketch's optimism be built
     * in brick: 369,000 seats against 60,000 customers, and £1.8m a year of
     * empty room for the three years it took to finish the company. Half as
     * much again as it is already serving is a fast year for an operation and
     * an absolute limit for one; the forecast can ask for less and never for
     * more.
     */
    const held = Object.values(company.customers ?? {}).reduce((sum, n) => sum + n, 0);
    const canFill = Math.max(held, company.capacity * 0.6);
    /*
     * Floored at the room it already has, and that floor was tested.
     *
     * Letting the plant shrink to what the company actually serves looked
     * right — a channel opened at nothing built room for 4,590 while holding
     * 715, and paid for it — and it is wrong. Measured, share over a year fell
     * from 0.40% to 0.36%: the room is not waste, it is what the company grows
     * into, and capping it at today's customers caps tomorrow's.
     */
    const room = Math.max(company.capacity, Math.min(Math.round(probe.likely * 1.3), Math.round(canFill * 2)));
    const draft = draftOf(company, trial, price, room, staffedFor(room), shape);

    /*
     * Play the year, then ask what the company it has become could sell the
     * year after. Without the news: the optimiser is choosing between plans,
     * and a plan should not look better because a die fell well for it.
     */
    let after;
    let valued = 0;
    let earned = 0;
    try {
      let running = resolveYear({ ...world, year }, [draft], economy, { withoutEvent: true });
      after = running.world;
      /*
       * The founders' share of it, not the whole company.
       *
       * This read `report.value` — what the company is worth — while the
       * season ranks founders on `report.founderValue`, which is that times
       * what they still own, plus what they have banked. The file's own notes
       * have said for a while that "`valueOf` is what the season actually
       * ranks founders on" and then read the unweighted figure beside it.
       *
       * It matters the moment anything in the plan can sell equity. Raising
       * money is free against `value` — the cash arrives, the company grows,
       * and the dilution costs the objective nothing — so a search allowed to
       * raise would sell the company out from under the person pressing the
       * button, and be scored well for it.
       */
      const mine = running.reports.find((r) => r.companyId === companyId);
      valued = mine?.founderValue ?? mine?.value ?? 0;
      /* Kept for pricing a raise: the same takings `resolve` will value it on. */
      earned = (mine?.pnl?.revenue ?? 0);
      /*
       * And then the years after it, carried forward as a company that keeps
       * growing rather than one that files the same numbers for ever.
       *
       * Two things were wrong with rolling one year and holding the plan
       * fixed. A single year cannot see compounding at all — brand does not
       * pay in the year it is bought, it pays by making next year's brand
       * cheaper — and a frozen continuation understates every growth strategy,
       * because the plan that wins is the one that spends more as the company
       * earns more. The survivor tier reaches 419,000 customers by holding a
       * course for fourteen years; an optimiser that models the next two as a
       * photograph will never choose that course.
       *
       * So the continuation scales: spending rises with what the company
       * takes, and the plant chases the customers it actually won. Each year
       * costs one more run of the engine per candidate, which is the whole
       * reason this is three and not fourteen.
       */
      for (let ahead = 1; ahead < rollout; ahead++) {
        const held = after.companies.find((c) => c.id === companyId);
        if (!held || held.bankruptSince) break;
        const heldNow = Object.values(held.customers ?? {}).reduce((sum, n) => sum + n, 0);
        const grew = company.capacity > 0 ? Math.max(1, held.capacity / company.capacity) : 1;
        const carried: Record<string, number> = {};
        for (const [field, amount] of Object.entries(trial)) carried[field] = amount * grew;
        const plant = Math.max(held.capacity, Math.round(Math.max(heldNow, held.capacity * 0.6) * 1.4));
        const onward = draftOf(held, carried, price, plant, staffedFor(plant), { region: null, borrow: 0, hours: shape.hours, fixed: shape.fixed });
        running = resolveYear({ ...after, year: year + ahead }, [onward], economy, { withoutEvent: true });
        after = running.world;
        const ours = running.reports.find((r) => r.companyId === companyId);
        valued = ours?.founderValue ?? ours?.value ?? valued;
      }
    } catch {
      return { score: -Infinity, serves: 0, room, revenue: 0 };
    }
    const me = after.companies.find((c) => c.id === companyId);
    /*
     * Solvency with something left over. A plan that ends the year bankrupt
     * has no year after to forecast, and one that ends it on nothing is one
     * bad year from the same thing.
     */
    /*
     * A year of what the company costs to run, held back.
     *
     * Deliberately *not* scaled by what the plan commits, which was tried and
     * is circular: spending more raises the bar for spending more, so the
     * search stalls at nothing. The optimiser funded no marketing at all for
     * three years running and acquired about a thousand customers before the
     * fixed costs finished it.
     */
    const reserve = fixedPerYear * OPTIMISER_RESERVE_YEARS * per;
    if (!me || me.bankruptSince || me.cash < reserve) return { score: -Infinity, serves: 0, room, revenue: 0 };

    const ahead = forecastDemand({ world: after, companyId, year: year + ROLLOUT_YEARS, economy });
    if (!ahead) return { score: -Infinity, serves: 0, room, revenue: 0 };
    /*
     * Believed only as far as the engine has already gone.
     *
     * `forecastDemand` is a sketch of the engine, not the engine — its own
     * comment says so — and an optimiser searching against an approximate
     * model finds the places the approximation is generous. It did: in dating
     * apps it committed £5.7m against a forecast of 350,000 customers, the
     * year delivered 44,000, and it spent the next three years paying for a
     * plant four hundred thousand seats too big.
     *
     * So the position is the smaller of what the sketch predicts and what the
     * engine actually produced when the year was played. The forecast can
     * still argue the company down; it can no longer argue it up.
     */
    const won = Object.values(me.customers ?? {}).reduce((sum, n) => sum + n, 0);
    const serves = Math.min(Math.min(ahead.likely, won), Math.max(1, me.capacity));
    /*
     * The company a year out: what it will be able to sell, and what it has
     * in the bank to sell it with.
     *
     * Customers alone was tried and is not it. A pound in the bank scores
     * nothing against a customer count, so the search spent to the reserve
     * every single year and finished fourteen of them with nothing — 62%
     * survival and a tenth of seasons ending richer than they began. Counting
     * the money makes holding on to some of it worth something, which is the
     * difference between a forecast and a business.
     *
     * Priced at what the company will actually charge, so this cannot be won
     * by charging more: the price is anchored to the market's own reference
     * (see `PRICE_TRIES`) and cannot run away.
     */
    /*
     * Valued as a business rather than as a year.
     *
     * A year of contribution was not enough to buy anything with a long
     * payback, and the measurement was unambiguous: with the objective one
     * year out, the optimiser never once opened a region or drew on its
     * credit line in ten seasons. It was right not to — a region opens the
     * *following* year and reaches only as far as the brand does when it
     * gets there, so within one year of lookahead it is an entry cost and
     * nothing else. The same argument sank borrowing, which is interest now
     * against growth later.
     *
     * So the score is what the company is worth: the money in the bank plus
     * the position it will hold, taken at a multiple. That is what a buyer
     * would pay and it is the shortest way to make an optimiser value a
     * pipeline, a plant and a second market without running five more years
     * of the engine for every one of a hundred candidates.
     */
    const margin = Math.max(0, price - me.unitCost);
    /*
     * And a region that is about to open counts for something.
     *
     * This is the one thing the lookahead cannot see for itself. A region
     * committed this year opens *next* year, so at the moment the forecast
     * for next year is taken it is not in `cities` yet — the entry cost has
     * been paid and none of the market has arrived. A horizon of one year
     * therefore values expansion at exactly its cost and never buys it, which
     * is why no bot in this codebase has ever opened a second region and why
     * companies spend fourteen years confined to a tenth of a market.
     *
     * Credited at what it will be able to reach when it gets there — as far
     * as the brand carries, which is the engine's own rule (`firstYearReach`)
     * — rather than at the whole region, because the first year in a new
     * place is mostly introductions.
     */
    const opening = me.expanding ? niche.cities.find((c) => c.id === me.expanding!.cityId) : undefined;
    const here = company.cities.reduce((sum, id) => sum + (niche.cities.find((c) => c.id === id)?.weight ?? 0), 0);
    const pending = opening && here > 0
      ? (opening.weight / here) * firstYearReach(me.brand)
      : 0;
    /*
     * Net of what it owes. Borrowed money is not wealth, and scoring it as
     * though it were made drawing on the credit line free points: the
     * optimiser took a million pounds in its first year, spent none of it,
     * and paid interest on the privilege — in every season it lost. Cash
     * minus debt is the only version of this that cannot be gamed by
     * borrowing.
     */
    /*
     * Valued on what the position *earns*, not on what it takes.
     *
     * Contribution with no cost against it made standing still look safe: in
     * drone delivery the optimiser spent nothing for three years running,
     * held about a thousand customers, and bled a million a year in fixed
     * costs until it died — and every one of those years it was scoring
     * correctly, because a pound not spent stayed in the bank and a pound
     * spent bought a position worth less than a pound.
     *
     * Netting the running costs off says the thing the game is actually
     * about: a company that cannot cover what it costs to exist is worth
     * less every year it goes on existing, and spending to get above that
     * line beats holding on to the money.
     */
    /*
     * Scored the way the game scores it.
     *
     * The objective was the money in the bank plus a multiple of the
     * position, and it produced a company that banked the money: £30.3m of
     * cash against the ordinary bot's £18.8m, on 172,000 customers against
     * 371,000 — and on the engine's own measure of what a company is worth it
     * came *last* of the four tiers, behind the bot that plays badly. It was
     * liquidating: every pound not spent scored a pound, and a pound spent
     * had to earn its way back.
     *
     * `valueOf` in `resolve.ts` is what the season actually ranks founders on
     * — a year of what the customers pay, plus what the company owns, less
     * what it owes — and cash is deliberately not in it. Optimising anything
     * else optimises the wrong game.
     */
    /*
     * The company's worth, plus the money beside it.
     *
     * `valueOf` deliberately leaves cash out — it is a year of what the
     * customers pay, plus what is owned, less what is owed — and optimising
     * it alone left the optimiser ahead on the season's own score and behind
     * on the bank, because a pound kept scored nothing. Scoring cash alone
     * was worse in the other direction: it banked £30m on half the customers
     * and liquidated the business to do it.
     *
     * Half-weighted, so holding money is worth something and never worth as
     * much as putting it to work.
     */
    const position = (serves * margin * per - fixedPerYear * per) * life;

    /*
     * And the share itself, because the owner asked for share and the
     * objective was not asking for it.
     *
     * Everything above this line is money: what the founders' stake is worth,
     * the cash beside it, and a multiple of the margin the position throws
     * off. All three are absolute, and a market grows — so a company that
     * holds its customers while the market adds more scores exactly as well as
     * one that keeps pace, and a company that grows slower than the market
     * reads as success. Measured, that is what it did: Nova would finish a
     * year on 0.4% of a market it opened on 0.08% of and call it a good plan,
     * while the money levers sat untouched because no single slice of them
     * paid for itself inside the horizon.
     *
     * Share is priced as what the market would be worth to own: every customer
     * in it, at what this company charges, for the years it has left. A point
     * of share is then worth a point of that, which makes taking share from
     * somebody comparable with the cash it costs to do it — and leaves the
     * decision to the search rather than forcing it, because a plan that buys
     * share by going bust still fails the solvency gate above.
     */
    const inTheMarket = niche.segments.reduce((sum, s) => sum + s.size, 0);
    const share = inTheMarket > 0 ? serves / inTheMarket : 0;
    const wholeMarket = inTheMarket * Math.max(0, margin) * life;

    return {
      score: valued + me.cash * CASH_WEIGHT + position * pending + share * wholeMarket * SHARE_PRIZE,
      serves, room, revenue: earned,
    };
  };

  /* Only the desks this plan is not for are held; a plan never overrides its own chair with a filing. */
  const fixed = Object.fromEntries(Object.entries(input.fixed ?? {}).filter(([role]) => !mine(role as Role)));
  let shape: Shape = { region: null, borrow: 0, hours: {}, fixed };
  let price = Math.max(1, company.price);
  let best = measure(spend, price, shape);

  /** One pass of the budget, a slice at a time, for a given shape. */
  const ascend = (from: Record<string, number>, startPrice: number, withShape: Shape) => {
    const trialSpend = { ...from };
    let trialPrice = startPrice;
    let at = measure(trialSpend, trialPrice, withShape);

    // The price first, against the company as it stands.
    for (const tryPrice of mine("cmo") ? priceTries : []) {
      const got = measure(trialSpend, tryPrice, withShape);
      if (got.score > at.score) { at = got; trialPrice = tryPrice; }
    }

    /*
     * Then the budget, a slice at a time, to whichever lever returns most for
     * it. Because every lever saturates, the answer is a plan that raises all
     * of them together rather than one that empties the bank into marketing.
     */
    const room = affordable + Math.max(0, withShape.borrow);
    let spent = 0;
    for (let i = 0; i < OPTIMISER_STEPS && spent + step <= room; i++) {
      /*
       * ## Every lever that pays, not only the one that pays most
       *
       * This took the argmax and gave it the whole slice. With a diminishing
       * return on each lever that sounds right and starves the tail: `OPT_TRACE`
       * shows `featureSpend` scoring *above* doing nothing and ranking fourth
       * of six, every round, in every market — and the ascent only ever hands
       * out two or three slices before no single slice pays, so the fourth-best
       * lever is never reached. Features were funded in 1 of 126 company-years
       * traced, and bending a quarter of brand into them beat the search's own
       * plan in 14 of 14 markets.
       *
       * It is also why the plans idle. The stop condition is "no single slice
       * improves", which with a coarse slice fires early and leaves a company
       * sitting on millions: five of seven written markets spent nothing at all
       * in three or more years.
       *
       * So each round funds every lever whose own slice beats doing nothing,
       * which is what "brand and product and service all rising together" —
       * this file's own description of what it produces — actually requires.
       * The combined move is then measured, because levers interact and the sum
       * of six good slices is not six times one; if the combination is worse
       * than where the round started, it is undone and the round falls back to
       * the single best lever, which is exactly the old behaviour.
       */
      let bestField: string | null = null;
      let bestAt = at;
      /*
       * `OPT_TRACE=1` prints every lever's marginal score at every step.
       *
       * Kept because it is what finally answered a question three plausible
       * explanations got wrong: features are not invisible to this search and
       * never were. They score *positively* and rank fourth of six, and the
       * ascent only ever hands out two or three slices before no single slice
       * pays — so the fourth-best lever is never reached. Reading the scores
       * took one run; guessing at the mechanism took an afternoon.
       */
      const trace = process.env.OPT_TRACE ? [] as string[] : null;
      /** What each lever is worth on its own this round, kept for the round below. */
      const alone: Record<string, number> = {};
      for (const lever of levers) {
        const trial = { ...trialSpend, [lever.field]: (trialSpend[lever.field] ?? 0) + step };
        const got = measure(trial, trialPrice, withShape);
        alone[lever.field] = got.score;
        trace?.push(`${lever.field}=${got.score === -Infinity ? "-inf" : Math.round(got.score).toLocaleString()}`);
        if (got.score > bestAt.score) { bestField = lever.field; bestAt = got; }
      }
      if (trace) {
        console.log(`[opt] step ${i} base=${at.score === -Infinity ? "-inf" : Math.round(at.score).toLocaleString()} step=${Math.round(step).toLocaleString()} | ${trace.join("  ")} | chose ${bestField ?? "nothing"}`);
      }
      if (!bestField) break; // Nothing left that pays for itself.

      /* Everything that paid on its own, best first, while there is room. */
      const worth = levers
        .map((l) => ({ field: l.field, score: alone[l.field] ?? -Infinity }))
        .filter((l) => l.score > at.score)
        .sort((a, b) => b.score - a.score);
      const before = { ...trialSpend };
      const spentBefore = spent;
      for (const l of worth) {
        if (spent + step > room) break;
        trialSpend[l.field] = (trialSpend[l.field] ?? 0) + step;
        spent += step;
      }
      const together = measure(trialSpend, trialPrice, withShape);
      if (together.score > at.score) {
        at = together;
      } else {
        /* The combination was worth less than its parts. Take the best one only. */
        for (const k of Object.keys(trialSpend)) trialSpend[k] = before[k] ?? 0;
        spent = spentBefore;
        trialSpend[bestField] = (trialSpend[bestField] ?? 0) + step;
        spent += step;
        at = bestAt;
      }

      // Re-price every few slices: what the company is worth charging changes
      // as the plan makes it better.
      if (i % 4 === 3) {
        for (const tryPrice of mine("cmo") ? priceTries : []) {
          const got = measure(trialSpend, tryPrice, withShape);
          if (got.score > at.score) { at = got; trialPrice = tryPrice; }
        }
      }
    }
    return { spend: trialSpend, price: trialPrice, at };
  };

  let run = ascend(spend, price, shape);

  /*
   * Then the two structural choices, against the plan rather than in the
   * abstract — a region is only worth opening if there is a business to open
   * it with, and borrowing is only worth doing if there is something to spend
   * it on.
   *
   * Tried after the ascent rather than inside it because each is a full pass
   * of the budget, and the lookahead already runs a year of the engine for
   * every candidate. Greedy, and affordable.
   */
  const announced = announcedRegion({ niche, seasonId: world.seasonId, year, open: company.cities });
  if (announced && company.cash > announced.entryCost * EXPANSION_DISCOUNT * 1.5) {
    const withRegion: Shape = { ...shape, region: announced.id };
    const alternative = ascend(spend, run.price, withRegion);
    if (alternative.at.score > run.at.score) { shape = withRegion; run = alternative; }
  }

  /*
   * And whether to sell a slice of it.
   *
   * Two constraints, and both were put here after watching it go wrong without
   * them. Measured on a real season — a company holding 36% of its market,
   * $2.3m in the bank — the first version raised **$45 million a month** and
   * took the founders to 5% in the first period, then went on raising, because:
   *
   *   - it tried shares of what the company was *worth*, and a year of
   *     takings from 150,000 subscribers is a very large number next to a
   *     plan that wanted to spend nothing; and
   *   - `resolve` floors `founderShare` at 0.05, so once the founders are at
   *     the floor further dilution costs the objective nothing at all. Scoring
   *     `founderValue` instead of `value` is necessary and it is not enough:
   *     below the floor the score stops noticing.
   *
   * So the amounts are shares of what the company could already lay hands on
   * (`headroom`: its cash and its credit line), because a raise is for
   * out-spending what you have rather than for its own sake; and no single
   * raise may cost the founders more than half of what they still hold, which
   * bounds it where the score cannot. `raised <= worth` is exactly that half,
   * from `resolve`'s own dilution arithmetic.
   *
   * A founder may of course choose a bigger raise, and the lever lets them.
   * This is a button pressed on their behalf, and handing over control of
   * somebody's company in one filing is not a thing it should be able to do.
   */
  /*
   * Priced the way `resolve` prices it, which is not what this used to do.
   *
   * It was `customers × price × periods × 1.2`, and in an audience market
   * subscribers do not pay a price at all — the money comes from ads, sponsors
   * and memberships. Measured on a channel: 3,970 subscribers × £36 × 12 came
   * out at £1,715,040 of "takings" and a £2,006,929 valuation, against the
   * channel's actual yearly revenue of **£5,038**. Four hundred times. So the
   * search filed a £662,287 raise against a business earning £420 that month,
   * and only the control bound below stopped it selling the lot.
   *
   * Measured rather than estimated now: `measure` has already played the
   * period, so the report's own revenue is available and is the same figure
   * `resolve` will use when it prices the dilution. A company whose revenue
   * cannot be read yet falls back to the market-scaled floor, which is what
   * `resolve` floors at too.
   */
  const aYearOfTakings = (best.revenue ?? 0) * periods;
  const worthNow = Math.max(
    atScale(500_000, company.scale ?? 1),
    aYearOfTakings * 1.2 + (company.assets ?? []).reduce((sum, a) => sum + a.bookValue, 0) - (company.debt ?? 0),
  );


  /*
   * And only when the money would actually be used.
   *
   * This is the constraint that matters and it took two wrong versions to
   * find. Raising is *score-positive on its own*: the objective credits cash
   * (`CASH_WEIGHT`) and, once `resolve` has floored `founderShare` at 0.05,
   * further dilution costs the score nothing — so a search allowed to raise
   * freely raises for ever. Shares of what the company is worth gave $45m a
   * month on a real season; shares of its headroom gave $138m. Both took the
   * founders to 5% in the first period and went on going.
   *
   * A raise is for out-spending what you have. If the ascent did not even
   * commit what the company could already afford, more money changes nothing
   * about the plan and the only thing it does is inflate the score — so there
   * is nothing here to weigh and the pass does not run. That is also the
   * honest reading of the decision: nobody sells a fifth of their company to
   * leave it in the bank.
   */
  const committed = Object.values(run.spend).reduce((sum, n) => sum + n, 0);
  const wantedItAll = committed >= affordable * 0.9;
  if (process.env.OPT_TRACE) {
    console.error(`[raise] committed ${Math.round(committed)} of affordable ${Math.round(affordable)} -> ${wantedItAll ? "trying" : "not trying"}; worth ${Math.round(worthNow)}, score ${Math.round(run.at.score)}`);
  }
  /*
   * And never past the point where it is still their company.
   *
   * Capping each single raise at half the stake is not enough, because the cap
   * is per period and the seasons are not. Measured on a channel opened at
   * nothing, with the share term in the objective and the gate letting raises
   * through: the founders went 100% → 39% → 8% → **5%** by month five, and the
   * search kept raising after that — $782,208 in month two, $1.8m in month
   * four, $5.4m in month ten, about $24m over the year. It reached 3.87% of
   * the market, which looks like success until you notice it was bought by
   * handing over nineteen twentieths of the company.
   *
   * The score cannot see it. `resolve` floors `founderShare` at 0.05, so once
   * the founders are at the floor further dilution is free, and scoring
   * `founderValue` — necessary as that is — stops discriminating exactly where
   * it matters most.
   *
   * So the bound is control, and it is absolute rather than per period: this
   * will not file a raise that leaves the founders with less than half. A
   * founder may of course choose to sell more, and the lever is theirs. A
   * button pressed on their behalf may not give their company away.
   */
  const KEEP_CONTROL = 0.5;
  const stake = company.founderShare ?? 1;
  const roomToSell = stake > KEEP_CONTROL ? worthNow * (stake / KEEP_CONTROL - 1) : 0;

  for (const slice of wantedItAll && roomToSell > 0 ? RAISE_TRIES : []) {
    /* Never more than half the founders' stake in one period, nor past control. */
    const amount = Math.round(Math.min(worthNow * slice, worthNow, roomToSell));
    if (amount <= 0) continue;
    const withRaise: Shape = { ...shape, raise: amount };
    const alternative = ascend(run.spend, run.price, withRaise);
    if (process.env.OPT_TRACE) {
      console.error(`[raise]   ${Math.round(amount)} -> score ${Math.round(alternative.at.score)} ${alternative.at.score > run.at.score ? "TAKEN" : "declined"}`);
    }
    if (alternative.at.score > run.at.score) { shape = withRaise; run = alternative; }
  }

  for (const draw of BORROW_TRIES) {
    const amount = Math.round(Math.max(0, (company.creditLimit ?? 0) - (company.debt ?? 0)) * draw);
    if (amount <= 0) continue;
    const withDebt: Shape = { ...shape, borrow: amount };
    const alternative = ascend(run.spend, run.price, withDebt);
    if (alternative.at.score > run.at.score) { shape = withDebt; run = alternative; }
  }

  /*
   * And then the week, which costs no money and so has to be chosen last.
   *
   * Greedy and measured, not assumed. It is tempting to hard-code "put the
   * hours into the product" — but which hours are worth having depends
   * entirely on the position: a business turning away customers wants the
   * hours worked, one nobody has heard of wants the doors knocked, and one
   * losing money on every sale wants the bills renegotiated. Scoring them is
   * the only way the choice tracks the company.
   *
   * The week is split evenly across whatever it picks, one more at a time, so
   * the second choice is made knowing the first — which matters, because the
   * axes interact (room is worth nothing without demand, and the other way
   * round). Even rather than optimised: searching the real simplex of sixty
   * hours across nine actions is a different and far more expensive problem,
   * and an even split across the two or three that score is most of the value
   * for nine-plus-eight-plus-seven runs of the engine.
   *
   * Nothing is taken that does not score better than leaving the hours where
   * they were. A founder's week is not free to *them*, and an action that
   * moves the company backwards — more room it cannot fill, carrying fixed
   * cost — should be declined.
   */
  /*
   * The nine standing actions, plus anything on this period's shelf the
   * founders could make instead of buying.
   *
   * Dealt from the same seed as the auction and the engine, so a build the
   * search commits to is the lot the player was shown. A made one is free and
   * takes weeks, a bought one is instant and costs money — which is a real
   * trade and exactly the kind the search should be making rather than a
   * person guessing.
   */
  const shelfNow = marketListings({
    seasonId: world.seasonId, year, niche, periods,
    owned: (company.assets ?? []).map((a) => a.name),
  });
  const offered = [...foundersActions(niche), ...buildableActions(shelfNow)];
  const MOST_AT_ONCE = 3;
  if (offered.length) {
    const chosen: string[] = [];
    const split = (ids: string[]): Record<string, number> => {
      const each = HOURS_A_WEEK / ids.length;
      return Object.fromEntries(ids.map((id) => [id, each]));
    };
    for (let slot = 0; slot < MOST_AT_ONCE; slot++) {
      let tookId: string | null = null;
      let tookAt = run.at;
      for (const action of offered) {
        if (chosen.includes(action.id)) continue;
        const withHours: Shape = { ...shape, hours: split([...chosen, action.id]) };
        const got = measure(run.spend, run.price, withHours);
        if (got.score > tookAt.score) { tookAt = got; tookId = action.id; }
      }
      if (!tookId) break;
      chosen.push(tookId);
      run = { ...run, at: tookAt };
      shape = { ...shape, hours: split(chosen) };
    }
  }

  /*
   * And then everything else, against the same score.
   *
   * Without this the plan had an answer for sixteen levers and filed the
   * defaults for the rest — so a chief executive who pressed the button got
   * `focus: growth` back, which is what the desk already said, and was told
   * their year had been planned. See `decideTheRest`.
   */
  shape = decideTheRest({
    company, niche, world, year, periods, offers: input.offers ?? [],
    desks: input.desks ?? [...ROLES],
    unlocked: input.unlocked ?? ((role, field) => isUnlocked(role, field, year, periods)),
    shape, at: run.at,
    measure: (withShape) => measure(run.spend, run.price, withShape),
  });
  run = { ...run, at: measure(run.spend, run.price, shape) };

  const spendFinal = run.spend;
  price = run.price;
  best = run.at;
  for (const key of Object.keys(spend)) spend[key] = spendFinal[key] ?? 0;

  /*
   * Tidied to a round number, at this company's own order of magnitude.
   *
   * This was `Math.round(amount / 1000) * 1000` — a flat thousand, which is a
   * sensible tidy-up for a company spending £4m a year and an eraser for one
   * spending four hundred. Measured on a real monthly season: the whole
   * affordable budget for the month was $1,728, every lever's slice came out
   * between $100 and $500, and all of them rounded to **zero**. So the search
   * would decide to fund brand, say so in the trace, and file a plan that
   * committed nothing — which is what "Nova doesn't change any decisions"
   * actually was, from the keyboard.
   *
   * Two orders of magnitude below the amount keeps the old behaviour where it
   * was right (£37,655 still becomes £38,000) and stops it destroying
   * everything a small business does.
   */
  const tidy = (amount: number): number => {
    if (!(amount > 0)) return 0;
    const grain = Math.max(1, Math.pow(10, Math.floor(Math.log10(amount)) - 1));
    return Math.round(amount / grain) * grain;
  };

  const rounded: Record<string, number> = {};
  for (const [field, amount] of Object.entries(spend)) rounded[field] = tidy(amount);

  const decisions = draftOf(company, rounded, price, best.room, staffedFor(best.room), shape);
  /*
   * The marketing seat's forecast, filled with what the plan actually expects
   * this year — the number operations and finance are told to plan on. Left
   * empty it scored as a forecast of nobody, which is "out by more than 20%"
   * and costs up to 8% of revenue on its own.
   */
  if ((input.unlocked ?? ((r: Role, f: string) => isUnlocked(r, f, year, periods)))("cmo", "forecast") && decisions.cmo) {
    try {
      const played = resolveYear({ ...world, year }, [decisions], economy, { withoutEvent: true });
      const customers = played.reports.find((r) => r.companyId === companyId)?.customers;
      if (customers != null) decisions.cmo.forecast = Math.round(customers);
    } catch { /* A forecast is advice to the table, never the reason a plan fails. */ }
  }

  return {
    decisions,
    score: best.score,
    serves: best.serves,
    spends: Object.values(rounded).reduce((sum, n) => sum + n, 0),
  };
}

/** Kept so a caller can size a plan against the market rather than the company. */
export const optimiserBudget = (company: Company, niche: Niche, per = 1): number =>
  Math.min(headroom(company) * OPTIMISER_COMMITS, atScale(4_000_000, company.scale)) * per;

/**
 * Levers the plan leaves alone, and why.
 *
 * Decided elsewhere in the search (the money ascent, the price, the plant, the
 * region, borrowing, the founders' own time, the forecast), or not a plan's
 * to make: selling equity, buying it back and paying it out change who owns
 * the company rather than what it does; firing, overruling and holding back a
 * colleague's spending are decisions about people at the table, and a press
 * of a button must never make one of those for somebody.
 */
const DECIDED_ELSEWHERE = new Set([
  "price", "brandSpend", "performanceSpend", "featureSpend", "reliabilitySpend", "techDebtPaydown",
  "supportSpend", "efficiencySpend", "capacityTarget", "headcount", "borrow", "expand", "expandVote",
  "founderHours", "forecast", "targetCities", "dealVotes",
  /*
   * `raiseAmount` was here, and it was not decided elsewhere — it was decided
   * nowhere. The main ascent never emitted it and this list told the second
   * pass to skip it, so in every season, for every company, Nova's only source
   * of money beyond its own takings was the credit line. For a founder trying
   * to go from nothing to a real share of a market, raising is the lever that
   * does that, and the button never touched it. It has its own pass below,
   * after the objective was fixed to charge for dilution.
   */
  "buyback", "dividendPct", "replaceSeat", "replaceBid", "overrule", "holdBack", "holdBackSeat",
  "budget", "repay", "cashBuffer", "refinance", "factorPct",
]);

/** How many runs of the engine the pass below may spend, all levers together. */
export const REST_BUDGET = 260;

/*
 * 260 rather than 180, and spread rather than spent front to back.
 *
 * Counted on dating apps in year five, the five desks between them want 37,
 * 41, 47, 28 and 35 candidate runs — 188. At 180, spent in desk order, the
 * budget ran out inside the operations desk and the loop returned: `sourcing`,
 * `recruitingSpend` and `trainingSpend` were never tried in any season, by any
 * company, and nothing said so. A silent cut-off is the worst shape for this,
 * because the levers that go untried are always the same ones.
 *
 * So the budget is big enough for the ordinary case, and a guard in
 * `test/unit/forecast-connection.test.ts` counts the candidates against it —
 * so the next four levers somebody adds to one desk turn this red instead of
 * silently un-trying the end of another desk.
 *
 * Walking the desks round-robin was tried as well and reverted: with a budget
 * this size nothing is cut either way, so all it changed was the order, and
 * this pass is greedy enough that the order moved a funded season's outcome by
 * 7% and turned a balance guard red.
 */

/**
 * The values worth trying for one lever, from where it stands now.
 *
 * Not every value — a handful that span what the lever can do: each option of
 * a choice, a modest and a bold amount of money, the ends and middle of a
 * percentage, concentrating an allocation on each thing it can be aimed at.
 * Exported because the audit (`script/lever-forecast-audit.ts`) asks the same
 * question of every lever.
 */
export function candidatesFor(field: LeverField, company: Company, current: Record<string, any> | undefined, per = 1): unknown[] {
  const now = current?.[field.id];
  const scale = company.scale ?? 1;
  /*
   * Rounded to two figures of the amount itself, not to the desk's step.
   *
   * The steps in `LEVER_FIELDS` are written for a market spending millions —
   * £50,000 of research, 10,000 units of room — and a company spending £1,700
   * a month rounded every money candidate to nought (so the lever was never
   * tried at all) and offered to lease ten thousand units to a business with
   * forty. The same failure as the final rounding in `optimise`, one level in.
   */
  const snap = (n: number) => {
    const mag = n > 0 ? Math.max(1, 10 ** (Math.floor(Math.log10(n)) - 1)) : 1;
    const rounded = n >= 1 ? Math.round(n / mag) * mag : Math.round(n);
    return Math.max(field.min ?? 0, Math.min(field.max ?? Infinity, rounded));
  };
  const opts = (field.options ?? []).map((o) => o.value);
  switch (field.kind) {
    case "money": {
      const unit = atScale(100_000, scale) * per;
      return [...new Set([0.5, 1, 2.5].map((m) => snap((Number(now) || 0) + unit * m)))].filter((v) => v !== now && v > 0);
    }
    case "price":
      return [0.9, 1.1].map((m) => Math.max(1, Math.round((Number(now) || company.price) * m)));
    case "count": {
      const from = Number(now) || company.capacity || 1;
      /* Half as much again, and half; and one more, for a market that counts in dozens. */
      return [...new Set([from * 1.5, from * 0.5, from + 1].map(snap))].filter((v) => v > 0 && v !== now);
    }
    case "percent": {
      const lo = field.min ?? 0, hi = field.max ?? 100;
      return [...new Set([lo, Math.round((lo + hi) / 2), hi].map(snap))].filter((v) => v !== now);
    }
    case "choice":
    case "segment":
      return opts.filter((v) => v !== (now ?? ""));
    case "hours":
      /* The whole week on each one in turn: the optimiser's own pass splits it. */
      return opts.map((v) => ({ [v]: HOURS_A_WEEK }));
    case "cities": {
      /* Opening each region not yet open, one at a time. */
      const open = company.cities ?? [];
      return opts.filter((id) => !open.includes(id)).map((id) => [...open, id]);
    }
    case "allocation":
      return opts.length > 1 ? opts.map((v) => Object.fromEntries(opts.map((o) => [o, o === v ? 60 : Math.round(40 / (opts.length - 1))]))) : [];
    case "tiers": {
      const p = Number(current?.price) || company.price;
      return opts.map((v) => ({ [v]: Math.round(p * 1.2) }));
    }
    case "levels":
      return opts.flatMap((o) => (field.choices ?? []).map((c) => c.value)
        .filter((c) => c !== field.defaultChoice)
        .map((c) => ({ ...(now ?? {}), [o]: c })));
    default:
      return [];
  }
}

/**
 * Every lever the money search did not decide, one at a time, against the
 * plan's own score.
 *
 * Coordinate ascent again, and for the same reason as the budget: each lever
 * is tried at each of its candidate values with everything else held, and the
 * best one is kept only if it actually beats leaving it alone. So a choice is
 * only ever made because the engine, played three years out, says the company
 * is worth more for it — a focus, a positioning, a programme, an answer to an
 * offer. Bounded by `REST_BUDGET` runs, so a desk with forty levers costs a
 * bounded amount however many options each one has.
 */
function decideTheRest(input: {
  company: Company; niche: Niche; world: World; year: number; periods: number;
  offers: OfferView[];
  desks: Role[];
  unlocked: (role: Role, field: string) => boolean;
  shape: Shape;
  at: { score: number };
  measure: (shape: Shape) => { score: number };
}): Shape {
  const { company, niche, world, year, periods, offers, unlocked } = input;
  let shape = input.shape;
  let score = input.at.score;
  let runs = 0;
  const base = draftOf(company, {}, company.price, company.capacity, 0, shape) as Record<string, any>;

  /*
   * Every lever worth trying, in desk order.
   *
   * Walking them round-robin across the desks was tried, to make running out
   * of budget cost each desk its last lever rather than one desk everything.
   * With the budget large enough that nothing is cut it changes nothing about
   * *which* levers are tried and only the order they are tried in — and this
   * pass is greedy, so order is not free: it moved the funded opening 7% and
   * put `from-nothing`'s "harder than the funded opening" guard red. Bisected
   * to the ordering, with the budget held at both sizes.
   *
   * So the starvation is fixed where it actually lived — in `REST_BUDGET`,
   * which was too small for the five desks and cut the operations seat off
   * mid-way — and the order is left alone.
   */
  const queue: { role: Role; raw: LeverField }[] = [];
  for (const role of input.desks) {
    if (!company.seats?.includes(role)) continue;
    for (const raw of LEVER_FIELDS[role]) {
      /* A creator market's own levers are on from the start there, and do not exist anywhere else. */
      if (raw.audienceOnly ? niche.model !== "audience" : (DECIDED_ELSEWHERE.has(raw.id) || !unlocked(role, raw.id))) continue;
      queue.push({ role, raw });
    }
  }

  for (const { role, raw } of queue) {
  const field = withOptions(raw, { company, niche, seasonId: world.seasonId, year, solo: false, offers, openedNiches: world.openedNiches });
    const current = { ...(base[role] ?? {}), ...(shape.extras?.[role] ?? {}) };
    let bestValue: unknown = undefined;
    /*
     * Never a public blame. Pinning a shock on a colleague wins back the most
     * reputation and costs that person dearly, and it is not a thing a
     * button should do to somebody on the chief executive's behalf.
     */
    const tries = candidatesFor(field, company, current, 1 / periods)
      .filter((v) => !(raw.id === "shockAnswer" && typeof v === "string" && v.startsWith("blame_")));
    for (const value of tries) {
      if (runs >= REST_BUDGET) return shape;
      runs += 1;
      const trial: Shape = { ...shape, extras: { ...shape.extras, [role]: { ...(shape.extras?.[role] ?? {}), [raw.id]: value } } };
      const got = input.measure(trial).score;
      /* Better by something, not by rounding: a tie leaves the lever as it was. */
      if (got > score + Math.abs(score) * 1e-6) { score = got; bestValue = value; }
    }
    if (bestValue !== undefined) {
      shape = { ...shape, extras: { ...shape.extras, [role]: { ...(shape.extras?.[role] ?? {}), [raw.id]: bestValue } } };
    }
  }
  return shape;
}
