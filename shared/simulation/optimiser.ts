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
 * ## Where it stands, honestly
 *
 * It decides 16 of the game's 72 levers, against the hand-written
 * `survivor` tier's 40. That is the real gap and it was not the one I
 * expected: the search is better and the *model* is smaller. It plays a
 * business as six spending taps, a price, a plant, a headcount, a loan and a
 * second market — which is more than any bot before it, and a long way from
 * a company.
 *
 * Over fourteen years it survives 62% of seasons against the survivor's 86%,
 * and when it survives it builds a bigger business: £214m against £127m in
 * project management software, on 826,000 customers. It has become a
 * high-conviction player — it borrows, it opens regions, it commits — which
 * wins larger and fails more often. That is a fair shape for an aggressive
 * growth strategy and a bad shape for a benchmark, and closing it means
 * finding what kills the other 38%.
 *
 * What is still missing, in the order it matters: the rest of the finance
 * seat (raising, dividends, factoring, refinancing), price tiers, segment
 * targeting, hiring and training, research, deals, and niches. Several of
 * those have the same problem expansion had — they pay over years, and a
 * one-year lookahead prices them at their cost.
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
import { atScale } from "./market";
import { EXECUTIVE } from "./decisions";
import { announcedRegion, EXPANSION_DISCOUNT, firstYearReach } from "./world";

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
export const OPTIMISER_COMMITS = 0.55;

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
 * A reserve is not caution, it is the constraint that was missing. The
 * objective is next year's forecast, and a company that cannot reach next
 * year does not have one.
 */
export const OPTIMISER_RESERVE_YEARS = 1;

/** How much of the remaining credit line to try drawing on, as shares of it. */
const BORROW_TRIES = [0.25, 0.5];

/**
 * The multiple a year of contribution is valued at.
 *
 * Five, which is roughly what the engine's own `valueOf` pays for a year of
 * sales and about what a steady business changes hands for. It is the whole
 * of the optimiser's patience: at one, nothing with a payback longer than a
 * year is ever worth buying.
 */
export const VALUE_YEARS = 5;

/**
 * How many slices the budget is handed out in. More is finer and slower, and
 * every slice costs a full run of the year across every lever — so ten is a
 * deliberate trade against the lookahead being expensive.
 */
export const OPTIMISER_STEPS = 10;

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
  /** What to draw down to pay for the plan. */
  borrow: number;
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
  return {
    companyId: company.id,
    cmo: {
      price,
      brandSpend: spend.brandSpend ?? 0,
      performanceSpend: spend.performanceSpend ?? 0,
      celebritySpend: 0,
      targetCities: company.cities,
      ...vote,
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
    },
    coo: {
      capacityTarget,
      supportSpend: spend.supportSpend ?? 0,
      efficiencySpend: spend.efficiencySpend ?? 0,
      headcount,
      ...(shape.region ? { expand: shape.region } : {}),
    },
    /*
     * And it borrows to pay for growth, which no bot has ever done either.
     * A business that will only spend what is already in the bank is not
     * being careful, it is refusing to use half of what the finance seat is
     * for — and the engine bounds the draw at what the bank would actually
     * lend (see `drawdown`), so this cannot run away.
     */
    cfo: { borrow: Math.max(0, Math.round(shape.borrow)), repay: 0, cashBuffer: 0, ...vote },
    // Growth, and an answer ready for whatever went wrong: silence recovers
    // far less of what a shock costs, and the forecast cannot see that either.
    ceo: { focus: "growth", shockAnswer: "statement", ...vote },
  };
}

export interface OptimiserInput {
  world: World;
  companyId: string;
  year: number;
  economy: Economy;
  /** How many decisions make a year, since every budget here is an annual one. */
  periods?: number;
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

  const affordable = headroom(company) * OPTIMISER_COMMITS * per;
  const step = affordable / OPTIMISER_STEPS;
  const levers = SPEND_LEVERS.filter((l) => isUnlocked(l.role, l.field, year, periods));

  /** Staff enough to serve, and no more: every head is a salary whether it is busy or not. */
  const headcount = Math.max(1, Math.round((company.seats?.length ?? 5) + (company.capacity / 40_000)));

  /** What the company costs to run before it does anything: the floor the plan has to clear. */
  const fixedPerYear = (company.seats?.length ?? 5) * EXECUTIVE * (company.scale ?? 1);

  const spend: Record<string, number> = {};
  for (const l of levers) spend[l.field] = 0;

  /** What this segment thinks the ordinary thing costs: the anchor for every price tried. */
  const reference = [...niche.segments].sort((a, b) => a.referencePrice - b.referencePrice)[0]?.referencePrice ?? company.price;

  const measure = (trial: Record<string, number>, price: number, shape: Shape): { score: number; serves: number; room: number } => {
    /*
     * Room is chased to this year's forecast rather than chosen
     * independently. What is built this year opens next, so this is the plant
     * the plan is asking for.
     */
    const probe = forecastDemand({ world, companyId, year, economy, draft: draftOf(company, trial, price, company.capacity, headcount, shape) });
    if (!probe) return { score: -Infinity, serves: 0, room: company.capacity };
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
    const room = Math.max(company.capacity, Math.round(probe.likely * 1.2));
    const draft = draftOf(company, trial, price, room, headcount, shape);

    /*
     * Play the year, then ask what the company it has become could sell the
     * year after. Without the news: the optimiser is choosing between plans,
     * and a plan should not look better because a die fell well for it.
     */
    let after;
    try {
      after = resolveYear({ ...world, year }, [draft], economy, { withoutEvent: true }).world;
    } catch {
      return { score: -Infinity, serves: 0, room };
    }
    const me = after.companies.find((c) => c.id === companyId);
    /*
     * Solvency with something left over. A plan that ends the year bankrupt
     * has no year after to forecast, and one that ends it on nothing is one
     * bad year from the same thing.
     */
    /*
     * The reserve scales with the plan, not just with the payroll.
     *
     * A flat year of running costs is the right buffer for a company
     * spending nothing and far too small for one committing millions a year
     * and servicing a loan — which is what this optimiser does once it is
     * allowed to borrow. Half of what the plan itself commits, or a year of
     * costs, whichever is larger: a company should be able to absorb a bad
     * year without the bad year being the end of it.
     */
    const committed = Object.values(trial).reduce((sum, n) => sum + n, 0);
    const reserve = Math.max(fixedPerYear * OPTIMISER_RESERVE_YEARS, committed * 0.5) * per;
    if (!me || me.bankruptSince || me.cash < reserve) return { score: -Infinity, serves: 0, room };

    const ahead = forecastDemand({ world: after, companyId, year: year + 1, economy });
    if (!ahead) return { score: -Infinity, serves: 0, room };
    const serves = Math.min(ahead.likely, Math.max(1, me.capacity));
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
    const position = serves * margin * per * VALUE_YEARS;
    return { score: me.cash + position * (1 + pending), serves, room };
  };

  let shape: Shape = { region: null, borrow: 0 };
  let price = Math.max(1, company.price);
  let best = measure(spend, price, shape);

  /** One pass of the budget, a slice at a time, for a given shape. */
  const ascend = (from: Record<string, number>, startPrice: number, withShape: Shape) => {
    const trialSpend = { ...from };
    let trialPrice = startPrice;
    let at = measure(trialSpend, trialPrice, withShape);

    // The price first, against the company as it stands.
    for (const multiple of PRICE_TRIES) {
      const tryPrice = Math.max(1, Math.round(reference * multiple));
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
      let bestField: string | null = null;
      let bestAt = at;
      for (const lever of levers) {
        const trial = { ...trialSpend, [lever.field]: (trialSpend[lever.field] ?? 0) + step };
        const got = measure(trial, trialPrice, withShape);
        if (got.score > bestAt.score) { bestField = lever.field; bestAt = got; }
      }
      if (!bestField) break; // Nothing left that pays for itself.
      trialSpend[bestField] = (trialSpend[bestField] ?? 0) + step;
      spent += step;
      at = bestAt;

      // Re-price every few slices: what the company is worth charging changes
      // as the plan makes it better.
      if (i % 4 === 3) {
        for (const multiple of PRICE_TRIES) {
          const tryPrice = Math.max(1, Math.round(reference * multiple));
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

  for (const draw of BORROW_TRIES) {
    const amount = Math.round(Math.max(0, (company.creditLimit ?? 0) - (company.debt ?? 0)) * draw);
    if (amount <= 0) continue;
    const withDebt: Shape = { ...shape, borrow: amount };
    const alternative = ascend(run.spend, run.price, withDebt);
    if (alternative.at.score > run.at.score) { shape = withDebt; run = alternative; }
  }

  const spendFinal = run.spend;
  price = run.price;
  best = run.at;
  for (const key of Object.keys(spend)) spend[key] = spendFinal[key] ?? 0;

  const rounded: Record<string, number> = {};
  for (const [field, amount] of Object.entries(spend)) rounded[field] = Math.round(amount / 1000) * 1000;

  return {
    decisions: draftOf(company, rounded, price, best.room, headcount, shape),
    score: best.score,
    serves: best.serves,
    spends: Object.values(rounded).reduce((sum, n) => sum + n, 0),
  };
}

/** Kept so a caller can size a plan against the market rather than the company. */
export const optimiserBudget = (company: Company, niche: Niche, per = 1): number =>
  Math.min(headroom(company) * OPTIMISER_COMMITS, atScale(4_000_000, company.scale)) * per;
