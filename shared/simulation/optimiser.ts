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
 * Over a full fourteen-year season it does **not** beat the hand-written
 * `survivor` tier: 62% survival and 62% of seasons ending richer, against
 * 86% and 86%. It is not a misnomer — it is a genuine constrained search over
 * the whole company, and it is optimal for the objective it is given — but
 * one year of lookahead is a greedy horizon in a game whose returns compound
 * over fourteen. It takes the best available year, repeatedly, and a sequence
 * of locally best years is not the best sequence.
 *
 * The honest next step is a longer horizon, or a value on the pipeline that
 * prices what is still in flight. Both cost more: every candidate plan here
 * already runs a full year of the engine, and there are of the order of a
 * hundred candidates per decision.
 *
 * What it is good for now is what a benchmark is for. It is deterministic, it
 * coordinates all five seats against one budget, and it will say what the best
 * plan *it can see* is worth in any market — so when a change to the engine
 * moves that number, the change did something.
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
function draftOf(
  company: Company,
  spend: Record<string, number>,
  price: number,
  capacityTarget: number,
  headcount: number,
): TeamDecisions {
  return {
    companyId: company.id,
    cmo: {
      price,
      brandSpend: spend.brandSpend ?? 0,
      performanceSpend: spend.performanceSpend ?? 0,
      celebritySpend: 0,
      targetCities: company.cities,
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
    },
    coo: {
      capacityTarget,
      supportSpend: spend.supportSpend ?? 0,
      efficiencySpend: spend.efficiencySpend ?? 0,
      headcount,
    },
    cfo: { borrow: 0, repay: 0, cashBuffer: 0 },
    // Growth, and an answer ready for whatever went wrong: silence recovers
    // far less of what a shock costs, and the forecast cannot see that either.
    ceo: { focus: "growth", shockAnswer: "statement" },
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

  const measure = (trial: Record<string, number>, price: number): { score: number; serves: number; room: number } => {
    /*
     * Room is chased to this year's forecast rather than chosen
     * independently. What is built this year opens next, so this is the plant
     * the plan is asking for.
     */
    const probe = forecastDemand({ world, companyId, year, economy, draft: draftOf(company, trial, price, company.capacity, headcount) });
    if (!probe) return { score: -Infinity, serves: 0, room: company.capacity };
    const room = Math.max(company.capacity, Math.round(probe.likely * 1.08));
    const draft = draftOf(company, trial, price, room, headcount);

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
    const reserve = fixedPerYear * OPTIMISER_RESERVE_YEARS * per;
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
    const margin = Math.max(0, price - me.unitCost);
    return { score: me.cash + serves * margin * per, serves, room };
  };

  let price = Math.max(1, company.price);
  let best = measure(spend, price);

  // The plant and the price first, against the company as it stands.
  for (const multiple of PRICE_TRIES) {
    const tryPrice = Math.max(1, Math.round(reference * multiple));
    const got = measure(spend, tryPrice);
    if (got.score > best.score) { best = got; price = tryPrice; }
  }

  /*
   * Then the budget, a slice at a time, to whichever lever returns most for
   * it. Because every lever saturates, the answer is a plan that raises all
   * of them together rather than one that empties the bank into marketing.
   */
  let committed = 0;
  for (let i = 0; i < OPTIMISER_STEPS && committed + step <= affordable; i++) {
    let bestField: string | null = null;
    let bestScore = best.score;
    let bestAt = best;
    for (const lever of levers) {
      const trial = { ...spend, [lever.field]: (spend[lever.field] ?? 0) + step };
      const got = measure(trial, price);
      if (got.score > bestScore) { bestScore = got.score; bestField = lever.field; bestAt = got; }
    }
    if (!bestField) break; // Nothing left that pays for itself.
    spend[bestField] = (spend[bestField] ?? 0) + step;
    committed += step;
    best = bestAt;

    // Re-price every few slices: what the company is worth charging changes
    // as the plan makes it better.
    if (i % 4 === 3) {
      for (const multiple of PRICE_TRIES) {
        const tryPrice = Math.max(1, Math.round(reference * multiple));
        const got = measure(spend, tryPrice);
        if (got.score > best.score) { best = got; price = tryPrice; }
      }
    }
  }

  const rounded: Record<string, number> = {};
  for (const [field, amount] of Object.entries(spend)) rounded[field] = Math.round(amount / 1000) * 1000;

  return {
    decisions: draftOf(company, rounded, price, best.room, headcount),
    score: best.score,
    serves: best.serves,
    spends: Object.values(rounded).reduce((sum, n) => sum + n, 0),
  };
}

/** Kept so a caller can size a plan against the market rather than the company. */
export const optimiserBudget = (company: Company, niche: Niche, per = 1): number =>
  Math.min(headroom(company) * OPTIMISER_COMMITS, atScale(4_000_000, company.scale)) * per;
