/**
 * One person's year, inside five people's company.
 *
 * A team game has a problem it does not advertise: four of the five people can
 * have a good fortnight while one of them quietly has nothing to do. The seat
 * that was dealt to them at random turns out to be the quiet one, their
 * decisions get overruled in the group chat, and by day six they are not
 * opening it. Nothing about the company's result tells them whether *they*
 * played well, because the company's result is four other people too.
 *
 * So every seat gets its own thing to win each year, and it is theirs.
 *
 * ## Why these are not multiple choice
 *
 * A challenge that offers three buttons is a quiz, and a quiz has a right
 * answer somebody will look up. These are objectives: a target and a
 * constraint, written against the company's actual position this year, met
 * through the levers the player already has. "Win forty thousand of the
 * committed amateurs without going above twenty-four pounds" is not a question
 * with an answer — it is a year of work that can be done well or badly, and it
 * collides with what the other four want, which is the entire point.
 *
 * ## Why the reward lands on the company
 *
 * If a personal challenge paid out personally, the game would have five people
 * optimising past each other — and a CMO cutting price to hit their own target
 * while the CFO watches the margin collapse is not a team, it is a room full
 * of strangers. So the prize goes to the company, and the credit goes to the
 * person. Your teammates want you to win yours.
 *
 * ## Why they are never impossible
 *
 * Targets are computed from where the company actually is — a share target for
 * a company holding two per cent is not the same number as for one holding
 * twenty — and a team in trouble gets challenges about getting out of trouble.
 * A challenge nobody could hit is worse than no challenge, because it reads as
 * the game telling you it has stopped paying attention.
 */
import type { Company, Niche, Role, World } from "./types";
import type { TeamDecisions } from "./decisions";
import type { CompanyReport } from "./resolve";
import { distressOf } from "./recovery";
import { rng, pick } from "./random";

/** One measurable thing, and what it is worth having done. */
export interface Target {
  id: string;
  /** What to do, as a person would say it. */
  label: string;
  /** The number to beat, for the screen to show progress against. */
  goal: number;
  /** How it is read: above the goal, below it, or exactly. */
  compare: "at_least" | "at_most";
  /** Where the number comes from, for the check. */
  metric: MetricId;
}

export type MetricId =
  | "customers" | "market_share" | "revenue" | "profit" | "reputation" | "quality"
  | "brand" | "service" | "price" | "unit_cost" | "cash" | "debt" | "turned_away"
  | "capacity" | "spend";

export interface Challenge {
  id: string;
  role: Role;
  year: number;
  title: string;
  /** Why this, this year — the context that makes it feel written for them. */
  brief: string;
  targets: Target[];
  /** What the company gets if every target is met. */
  reward: Reward;
  /** What partially meeting it is worth. Half a loaf, because a near miss is still a year of work. */
  partialReward: Reward;
}

export interface Reward {
  kind: "reputation" | "cash" | "capacity" | "credit";
  amount: number;
  label: string;
}

/** What actually happened, measured. */
export function readMetric(id: MetricId, input: {
  report: CompanyReport;
  company: Company;
  decisions?: TeamDecisions;
}): number {
  const { report, company, decisions } = input;
  switch (id) {
    case "customers": return report.customers;
    case "market_share": return report.marketShare * 100;
    case "revenue": return report.revenue;
    case "profit": return report.profit;
    case "reputation": return report.reputation;
    case "quality": return report.quality;
    case "brand": return report.brand;
    case "service": return report.service;
    case "price": return company.price;
    case "unit_cost": return company.unitCost;
    case "cash": return report.cash;
    case "debt": return report.debt;
    case "turned_away": return report.turnedAway;
    case "capacity": return company.capacity;
    case "spend": return discretionarySpend(decisions);
  }
}

/**
 * Everything a team chose to spend this year.
 *
 * One definition, used by the challenge targets that cap spending and by the
 * creditor's covenant in the tick — they have to agree, or a team is told it
 * is inside a cap it has broken.
 *
 * Research is in it. It was not, briefly, because it was added after this sum
 * was written: a company under a creditor's cap could pour money into next
 * year's product and stay technically compliant, which is the one loophole
 * that would have made the recovery arc toothless. City entry costs are not
 * here — they are charged directly against cash rather than counted as
 * discretionary — and are added by the caller that knows the market.
 */
export function discretionarySpend(decisions?: TeamDecisions): number {
  return (
    (decisions?.cmo?.brandSpend ?? 0) + (decisions?.cmo?.performanceSpend ?? 0) + (decisions?.cmo?.celebritySpend ?? 0) +
    (decisions?.cto?.featureSpend ?? 0) + (decisions?.cto?.reliabilitySpend ?? 0) +
    (decisions?.cto?.techDebtPaydown ?? 0) + (decisions?.cto?.researchSpend ?? 0) +
    (decisions?.coo?.supportSpend ?? 0) + (decisions?.coo?.efficiencySpend ?? 0)
  );
}

const round = (n: number, to: number) => Math.max(to, Math.round(n / to) * to);

/**
 * A challenge for this seat, this year, in this company's actual position.
 *
 * Deterministic from the venture, role and year, so it survives a re-run of
 * the tick and two people looking at the same screen see the same thing.
 */
export function challengeFor(input: {
  company: Company;
  world: World;
  role: Role;
  year: number;
  ventureId: string;
}): Challenge {
  const { company, world, role, year, ventureId } = input;
  const seed = `${ventureId}:${role}:${year}`;
  const niche = world.niche;
  const state = distressOf(company);
  const held = Object.values(company.customers).reduce((sum, n) => sum + n, 0);

  /*
   * A company in trouble is set the work of getting out of trouble. Handing a
   * team on the edge of insolvency a growth target is the game admitting it is
   * not looking at them — and it is exactly the moment they are deciding
   * whether to keep playing.
   */
  if (state === "insolvent" || state === "distressed") {
    return rescueChallenge({ company, role, year, seed, state });
  }

  const build = pick(seed, BUILDERS[role]);
  return build({ company, niche, year, seed, held });
}

interface BuildInput {
  company: Company;
  niche: Niche;
  year: number;
  seed: string;
  held: number;
}

type Builder = (input: BuildInput) => Challenge;

const id = (seed: string) => `chal_${seed.replace(/[^a-z0-9]/gi, "_")}`;

/**
 * The work of not going under, made explicit.
 *
 * Deliberately modest and deliberately concrete: survive, and show one number
 * moving the right way. A team that hits this has something to point at on a
 * day when the league table says nothing good about them at all.
 */
function rescueChallenge(input: { company: Company; role: Role; year: number; seed: string; state: string }): Challenge {
  const { company, role, year, seed, state } = input;
  /*
   * Half of what they have, never more than they have.
   *
   * A flat floor here asked a company holding 100,000 to finish the year with
   * 250,000 — a growth target dressed as a rescue, handed to the team least
   * able to hit it, at the exact moment they are deciding whether to keep
   * playing. The number has to come from their position or it is not a rescue
   * challenge at all.
   */
  const runway = Math.max(0, Math.round(company.cash * 0.5));

  const targets: Record<Role, Target[]> = {
    cfo: [
      { id: "cash", label: "End the year with money in the bank", goal: runway, compare: "at_least", metric: "cash" },
      { id: "debt", label: "Do not owe more than you do now", goal: Math.round(company.debt), compare: "at_most", metric: "debt" },
    ],
    ceo: [
      { id: "cash", label: "Still solvent at the end of the year", goal: 1, compare: "at_least", metric: "cash" },
      { id: "rep", label: "Hold the company's reputation", goal: Math.max(1, Math.round(company.reputation - 4)), compare: "at_least", metric: "reputation" },
    ],
    cmo: [
      { id: "customers", label: "Do not lose customers this year", goal: Math.round(Object.values(company.customers).reduce((s, n) => s + n, 0) * 0.95), compare: "at_least", metric: "customers" },
      { id: "spend", label: "Do it without spending your way there", goal: Math.round(Math.max(300_000, company.cash * 0.4)), compare: "at_most", metric: "spend" },
    ],
    coo: [
      { id: "cost", label: "Get the cost of a unit down", goal: Math.round(company.unitCost * 0.94 * 100) / 100, compare: "at_most", metric: "unit_cost" },
      { id: "away", label: "Turn nobody away while you do it", goal: 0, compare: "at_most", metric: "turned_away" },
    ],
    cto: [
      { id: "quality", label: "Hold the product's quality", goal: Math.max(1, Math.round(company.quality - 2)), compare: "at_least", metric: "quality" },
      { id: "spend", label: "On a fraction of what you would normally spend", goal: Math.round(Math.max(250_000, company.cash * 0.3)), compare: "at_most", metric: "spend" },
    ],
  };

  return {
    id: id(seed),
    role,
    year,
    title: state === "insolvent" ? "Keep the doors open" : "Stop the bleeding",
    brief: state === "insolvent"
      ? "The company is insolvent. Nobody is removed from this game, and the way back starts with a year that does not make it worse. This is that year."
      : "There is less than a year of costs within reach. This is the year to stop the slide, before the moves available get expensive.",
    targets: targets[role],
    reward: { kind: "credit", amount: 500_000, label: "The creditor extends the line by 500,000 — someone noticed the company being run properly." },
    partialReward: { kind: "reputation", amount: 2, label: "A little reputation back for steadying things." },
  };
}

const BUILDERS: Record<Role, Builder[]> = {
  cmo: [
    ({ company, niche, year, seed, held }) => {
      /* Take a specific segment, at a price that segment will bear. */
      const segment = pick(`${seed}:seg`, niche.segments);
      const have = company.customers[segment.id] ?? 0;
      const goal = round(Math.max(have * 1.4, segment.size * 0.02), 1_000);
      return {
        id: id(seed), role: "cmo", year,
        title: `Take the ${segment.name.toLowerCase()}`,
        brief: `${segment.description} You hold ${have.toLocaleString()} of them. The rest are somebody else's, and they pay around ${segment.referencePrice} for this.`,
        targets: [
          { id: "customers", label: `Hold at least ${goal.toLocaleString()} customers in total`, goal: Math.max(goal, held), compare: "at_least", metric: "customers" },
          { id: "price", label: `Without going above ${Math.round(segment.referencePrice * 1.1)}`, goal: Math.round(segment.referencePrice * 1.1), compare: "at_most", metric: "price" },
        ],
        reward: { kind: "reputation", amount: 5, label: "Reputation, for a promise kept at a price people thought was fair." },
        partialReward: { kind: "reputation", amount: 2, label: "Some reputation for the ground you did take." },
      };
    },
    ({ company, year, seed, held }) => {
      const goal = Math.min(100, Math.round(company.brand + 12));
      return {
        id: id(seed), role: "cmo", year,
        title: "Be heard of",
        brief: `The company's brand is at ${Math.round(company.brand)}. A product nobody has heard of is a product nobody buys, however good the other four make it.`,
        targets: [
          { id: "brand", label: `Get brand to ${goal}`, goal, compare: "at_least", metric: "brand" },
          { id: "customers", label: "Without losing customers to do it", goal: Math.round(held * 0.98), compare: "at_least", metric: "customers" },
        ],
        reward: { kind: "capacity", amount: 0.05, label: "The attention converts: capacity up 5% as demand pulls it." },
        partialReward: { kind: "reputation", amount: 2, label: "Some reputation for the noise you did make." },
      };
    },
    ({ company, niche, year, seed }) => {
      const dearest = [...niche.segments].sort((a, b) => b.referencePrice - a.referencePrice)[0];
      return {
        id: id(seed), role: "cmo", year,
        title: "Charge what it's worth",
        brief: `You sell at ${Math.round(company.price)}. The ${dearest.name.toLowerCase()} pay around ${dearest.referencePrice} and barely look at the number — the question is whether the product earns it.`,
        targets: [
          { id: "price", label: `Get the price to ${Math.round(dearest.referencePrice * 0.9)} or above`, goal: Math.round(dearest.referencePrice * 0.9), compare: "at_least", metric: "price" },
          { id: "customers", label: "And keep nine in ten of the customers while you do it", goal: Math.round(Object.values(company.customers).reduce((s, n) => s + n, 0) * 0.9), compare: "at_least", metric: "customers" },
        ],
        reward: { kind: "cash", amount: 600_000, label: "A year of margin nobody had to be persuaded into." },
        partialReward: { kind: "reputation", amount: 2, label: "Some credit for the nerve." },
      };
    },
    ({ company, year, seed }) => ({
      id: id(seed), role: "cmo", year,
      title: "Be somewhere new",
      brief: `You sell in ${(company.cities ?? []).length} place${(company.cities ?? []).length === 1 ? "" : "s"}. Nobody outside them can choose you, however good the product gets.`,
      targets: [
        { id: "customers", label: "Grow customers by a quarter", goal: Math.round(Math.max(1000, Object.values(company.customers).reduce((s, n) => s + n, 0) * 1.25)), compare: "at_least", metric: "customers" },
        { id: "away", label: "Without turning anybody away when they arrive", goal: 0, compare: "at_most", metric: "turned_away" },
      ],
      reward: { kind: "credit", amount: 700_000, label: "Reach on the books: the credit line rises with the footprint." },
      partialReward: { kind: "reputation", amount: 2, label: "Credit for the ground covered." },
    }),
  ],
  cfo: [
    ({ company, year, seed }) => {
      const goal = round(Math.max(company.cash * 1.15, 1_000_000), 100_000);
      return {
        id: id(seed), role: "cfo", year,
        title: "Fund the year without the bank",
        brief: `The company holds ${Math.round(company.cash).toLocaleString()} and owes ${Math.round(company.debt).toLocaleString()}. Everyone else on this team wants to spend, and money borrowed this year is interest in every year after it.`,
        targets: [
          { id: "cash", label: `End the year holding ${goal.toLocaleString()}`, goal, compare: "at_least", metric: "cash" },
          { id: "debt", label: `Without owing more than ${Math.round(company.debt).toLocaleString()}`, goal: Math.round(company.debt), compare: "at_most", metric: "debt" },
        ],
        reward: { kind: "credit", amount: 750_000, label: "The bank raises the line by 750,000 on the strength of the year." },
        partialReward: { kind: "cash", amount: 150_000, label: "A small rebate on the interest for a year run tightly." },
      };
    },
    ({ company, year, seed }) => ({
      id: id(seed), role: "cfo", year,
      title: "Make it pay",
      brief: `A company can grow and lose money at the same time for a very long time, and this is the year somebody checks. Profit is revenue minus everything the other four decided to spend.`,
      targets: [
        { id: "profit", label: "Finish the year in profit", goal: 1, compare: "at_least", metric: "profit" },
        { id: "rep", label: `Without letting reputation fall below ${Math.max(1, Math.round(company.reputation - 5))}`, goal: Math.max(1, Math.round(company.reputation - 5)), compare: "at_least", metric: "reputation" },
      ],
      reward: { kind: "credit", amount: 1_000_000, label: "A profitable year, on the record: the credit line goes up by a million." },
      partialReward: { kind: "cash", amount: 200_000, label: "Something back for the discipline." },
    }),
    ({ company, year, seed }) => ({
      id: id(seed), role: "cfo", year,
      title: "Keep the company yours",
      brief: `The founders hold ${Math.round((company.founderShare ?? 1) * 100)}% of this. Every pound raised buys a permanent slice of whatever it becomes, and the cheapest money is the money you did not need.`,
      targets: [
        { id: "cash", label: "Finish the year solvent, without raising", goal: 1, compare: "at_least", metric: "cash" },
        { id: "debt", label: `And owing no more than ${Math.round(company.debt).toLocaleString()}`, goal: Math.round(company.debt), compare: "at_most", metric: "debt" },
      ],
      reward: { kind: "credit", amount: 900_000, label: "A lender who noticed you did not need them." },
      partialReward: { kind: "cash", amount: 200_000, label: "Something for the restraint." },
    }),
    ({ company, year, seed }) => ({
      id: id(seed), role: "cfo", year,
      title: "Turn revenue into money",
      brief: "Revenue is what the market gave you; cash is what survived the year. This one is about the gap between them.",
      targets: [
        { id: "revenue", label: "Grow revenue", goal: 1, compare: "at_least", metric: "revenue" },
        { id: "cash", label: `While ending with more than the ${Math.round(company.cash).toLocaleString()} you started with`, goal: Math.round(company.cash), compare: "at_least", metric: "cash" },
      ],
      reward: { kind: "credit", amount: 800_000, label: "A year that converted, on the record." },
      partialReward: { kind: "cash", amount: 150_000, label: "Part of the difference." },
    }),
  ],
  cto: [
    ({ company, year, seed }) => {
      const goal = Math.min(100, Math.round(company.quality + 10));
      return {
        id: id(seed), role: "cto", year,
        title: "Make it better than theirs",
        brief: `Quality sits at ${Math.round(company.quality)}. It decays every year on its own, so standing still is a decision to get worse.`,
        targets: [
          { id: "quality", label: `Get quality to ${goal}`, goal, compare: "at_least", metric: "quality" },
          { id: "service", label: `And keep service at ${Math.max(1, Math.round(company.service - 3))} or better`, goal: Math.max(1, Math.round(company.service - 3)), compare: "at_least", metric: "service" },
        ],
        reward: { kind: "reputation", amount: 6, label: "Reputation, for a product that got visibly better." },
        partialReward: { kind: "reputation", amount: 2, label: "Some credit for the direction." },
      };
    },
    ({ company, year, seed }) => ({
      id: id(seed), role: "cto", year,
      title: "Make it not break",
      brief: "Reliability counts twice — for what the product is, and for what happens after someone buys it. It is the cheapest way to move two numbers at once, and the least visible work on the team.",
      targets: [
        { id: "service", label: `Get service to ${Math.min(100, Math.round(company.service + 12))}`, goal: Math.min(100, Math.round(company.service + 12)), compare: "at_least", metric: "service" },
        { id: "away", label: "And turn nobody away all year", goal: 0, compare: "at_most", metric: "turned_away" },
      ],
      reward: { kind: "reputation", amount: 5, label: "Reputation: the people you sold to stayed sold." },
      partialReward: { kind: "reputation", amount: 2, label: "Partial credit for a steadier year." },
    }),
    ({ company, year, seed }) => ({
      id: id(seed), role: "cto", year,
      title: "Build for next year",
      brief: `Research lands a year late and buys more than shipping does. It is the only decision here that asks you to be behind on purpose — and the one that makes year ${year + 1} unanswerable.`,
      targets: [
        { id: "quality", label: `Hold quality at ${Math.max(1, Math.round(company.quality - 1))} while you do it`, goal: Math.max(1, Math.round(company.quality - 1)), compare: "at_least", metric: "quality" },
        { id: "spend", label: `Spending no more than ${Math.round(Math.max(600_000, company.cash * 0.35)).toLocaleString()} across the company`, goal: Math.round(Math.max(600_000, company.cash * 0.35)), compare: "at_most", metric: "spend" },
      ],
      reward: { kind: "reputation", amount: 5, label: "A roadmap people believe in." },
      partialReward: { kind: "reputation", amount: 2, label: "Some of it landed." },
    }),
    ({ company, year, seed }) => ({
      id: id(seed), role: "cto", year,
      title: "Pay down what you owe yourselves",
      brief: "Technical debt is the speed you sold to get here. Nothing visible comes of clearing it, which is exactly why nobody ever does.",
      targets: [
        { id: "cost", label: `Get unit cost to ${(company.unitCost * 0.93).toFixed(2)}`, goal: Math.round(company.unitCost * 0.93 * 100) / 100, compare: "at_most", metric: "unit_cost" },
        { id: "quality", label: `Without quality slipping below ${Math.max(1, Math.round(company.quality - 2))}`, goal: Math.max(1, Math.round(company.quality - 2)), compare: "at_least", metric: "quality" },
      ],
      reward: { kind: "capacity", amount: 0.06, label: "The same team, shipping faster." },
      partialReward: { kind: "cash", amount: 150_000, label: "A little of it back." },
    }),
  ],
  coo: [
    ({ company, year, seed }) => ({
      id: id(seed), role: "coo", year,
      title: "Serve everyone who comes",
      brief: `Capacity is ${company.capacity.toLocaleString()}. Marketing's job is to bring more people than that, and yours is to make sure that is not a problem — somebody turned away costs reputation, not just the sale.`,
      targets: [
        { id: "away", label: "Turn nobody away", goal: 0, compare: "at_most", metric: "turned_away" },
        { id: "cost", label: `While getting unit cost to ${(company.unitCost * 0.95).toFixed(2)}`, goal: Math.round(company.unitCost * 0.95 * 100) / 100, compare: "at_most", metric: "unit_cost" },
      ],
      reward: { kind: "capacity", amount: 0.08, label: "The operation tightens: 8% more capacity for nothing." },
      partialReward: { kind: "cash", amount: 150_000, label: "Savings that went straight to the bank." },
    }),
    ({ company, year, seed }) => ({
      id: id(seed), role: "coo", year,
      title: "Take a pound out of every unit",
      brief: `Each unit costs ${company.unitCost.toFixed(2)} to make and serve. Efficiency is the only spending here that keeps paying after the year it was spent in.`,
      targets: [
        { id: "cost", label: `Get unit cost to ${(company.unitCost * 0.9).toFixed(2)}`, goal: Math.round(company.unitCost * 0.9 * 100) / 100, compare: "at_most", metric: "unit_cost" },
        { id: "service", label: `Without service dropping below ${Math.max(1, Math.round(company.service - 4))}`, goal: Math.max(1, Math.round(company.service - 4)), compare: "at_least", metric: "service" },
      ],
      reward: { kind: "cash", amount: 400_000, label: "The savings, banked." },
      partialReward: { kind: "cash", amount: 120_000, label: "Part of the savings, banked." },
    }),
    ({ company, year, seed }) => ({
      id: id(seed), role: "coo", year,
      title: "Grow without breaking",
      brief: `Capacity is ${company.capacity.toLocaleString()} and marketing intends to bring more than that. Building ahead of demand is expensive; building behind it is worse.`,
      targets: [
        { id: "capacity", label: `Get capacity to ${Math.round(company.capacity * 1.3).toLocaleString()}`, goal: Math.round(company.capacity * 1.3), compare: "at_least", metric: "capacity" },
        { id: "away", label: "And turn nobody away getting there", goal: 0, compare: "at_most", metric: "turned_away" },
      ],
      reward: { kind: "reputation", amount: 5, label: "Everyone who came got served." },
      partialReward: { kind: "reputation", amount: 2, label: "Mostly held together." },
    }),
    ({ company, year, seed }) => ({
      id: id(seed), role: "coo", year,
      title: "Be the reason they stay",
      brief: `Service is at ${Math.round(company.service)}. It is the least visible work on the team, and the segments who pay most care about it more than anything else.`,
      targets: [
        { id: "service", label: `Get service to ${Math.min(100, Math.round(company.service + 10))}`, goal: Math.min(100, Math.round(company.service + 10)), compare: "at_least", metric: "service" },
        { id: "rep", label: `And reputation to ${Math.min(100, Math.round(company.reputation + 4))}`, goal: Math.min(100, Math.round(company.reputation + 4)), compare: "at_least", metric: "reputation" },
      ],
      reward: { kind: "reputation", amount: 6, label: "People stopped leaving." },
      partialReward: { kind: "reputation", amount: 2, label: "Fewer of them, anyway." },
    }),
  ],
  ceo: [
    ({ company, year, seed, held }) => ({
      id: id(seed), role: "ceo", year,
      title: "Grow without buying it",
      brief: "Anyone can take share by selling at a loss. The year that counts is the one where the company gets bigger and the books still work.",
      targets: [
        { id: "customers", label: `Finish above ${Math.round(held * 1.2).toLocaleString()} customers`, goal: Math.round(Math.max(held * 1.2, 1000)), compare: "at_least", metric: "customers" },
        { id: "profit", label: "And do not lose money doing it", goal: 0, compare: "at_least", metric: "profit" },
      ],
      reward: { kind: "reputation", amount: 6, label: "Reputation: growth that did not come at the company's expense." },
      partialReward: { kind: "reputation", amount: 2, label: "Credit for one half of it." },
    }),
    ({ company, year, seed }) => ({
      id: id(seed), role: "ceo", year,
      title: "Be worth trusting",
      brief: `Reputation is at ${Math.round(company.reputation)}. It is the only number here nobody can buy directly — it comes from keeping the promises the other four make on the company's behalf.`,
      targets: [
        { id: "rep", label: `Get reputation to ${Math.min(100, Math.round(company.reputation + 8))}`, goal: Math.min(100, Math.round(company.reputation + 8)), compare: "at_least", metric: "reputation" },
        { id: "away", label: "Turning away no more than a handful", goal: 1_000, compare: "at_most", metric: "turned_away" },
      ],
      reward: { kind: "credit", amount: 800_000, label: "Reputation is collateral: the credit line rises with it." },
      partialReward: { kind: "reputation", amount: 2, label: "A little of it stuck." },
    }),
    ({ company, niche, year, seed }) => {
      const target = pick(`${seed}:pos`, niche.segments);
      return {
        id: id(seed), role: "ceo", year,
        title: `Be the company for ${target.name.toLowerCase()}`,
        brief: `${target.description} Deciding who you are for makes you better to them and worse to everybody else, and the other four then have to live inside that.`,
        targets: [
          { id: "customers", label: "Come out of the year with more customers than you went in with", goal: Math.round(Object.values(company.customers).reduce((s, n) => s + n, 0) * 1.05), compare: "at_least", metric: "customers" },
          { id: "rep", label: `And reputation no lower than ${Math.max(1, Math.round(company.reputation - 2))}`, goal: Math.max(1, Math.round(company.reputation - 2)), compare: "at_least", metric: "reputation" },
        ],
        reward: { kind: "reputation", amount: 6, label: "A company that stands for something, and was believed." },
        partialReward: { kind: "reputation", amount: 2, label: "Halfway to meaning it." },
      };
    },
    ({ company, year, seed }) => ({
      id: id(seed), role: "ceo", year,
      title: "A year that pays for itself",
      brief: "Four people want to spend and one of them has to decide what the company is for this year. This is the year it has to add up.",
      targets: [
        { id: "profit", label: "End the year in profit", goal: 1, compare: "at_least", metric: "profit" },
        { id: "customers", label: "Without shrinking to do it", goal: Math.round(Object.values(company.customers).reduce((s, n) => s + n, 0)), compare: "at_least", metric: "customers" },
      ],
      reward: { kind: "credit", amount: 900_000, label: "Growth and profit in the same year. Lenders remember that." },
      partialReward: { kind: "cash", amount: 200_000, label: "One of the two." },
    }),
  ],
};

export interface TargetResult extends Target {
  actual: number;
  met: boolean;
}

export interface ChallengeResult {
  challengeId: string;
  role: Role;
  year: number;
  outcome: "met" | "partial" | "missed";
  targets: TargetResult[];
  /** What the team is told, and what they get. */
  note: string;
  reward: Reward | null;
}

/** Whether a year did what was asked of it. */
export function checkChallenge(input: {
  challenge: Challenge;
  report: CompanyReport;
  company: Company;
  decisions?: TeamDecisions;
}): ChallengeResult {
  const { challenge, report, company, decisions } = input;

  const targets: TargetResult[] = challenge.targets.map((t) => {
    const actual = readMetric(t.metric, { report, company, decisions });
    const met = t.compare === "at_least" ? actual >= t.goal : actual <= t.goal;
    return { ...t, actual, met };
  });

  const hit = targets.filter((t) => t.met).length;
  const outcome = hit === targets.length ? "met" : hit > 0 ? "partial" : "missed";
  const reward = outcome === "met" ? challenge.reward : outcome === "partial" ? challenge.partialReward : null;

  /*
   * A miss is described by what fell short, not by the fact of missing. "You
   * failed" tells a player nothing they did not already know; "customers were
   * there, the price was not" tells them what to do tomorrow, which is the
   * only useful thing a result can say on day four of fourteen.
   */
  const missed = targets.filter((t) => !t.met);
  const note =
    outcome === "met" ? `${challenge.title}: done. ${challenge.reward.label}`
    : outcome === "partial" ? `${challenge.title}: half. ${missed.map((t) => t.label.toLowerCase()).join("; ")} — that part did not land. ${challenge.partialReward.label}`
    : `${challenge.title}: missed. ${missed.map((t) => `${t.label.toLowerCase()} (got ${fmt(t.actual)})`).join("; ")}.`;

  return { challengeId: challenge.id, role: challenge.role, year: challenge.year, outcome, targets, note, reward };
}

const fmt = (n: number): string =>
  Math.abs(n) >= 10_000 ? Math.round(n).toLocaleString() : Math.abs(n) >= 10 ? String(Math.round(n)) : n.toFixed(2);

/** Apply what a completed challenge gives the company. */
export function applyReward(company: Company, reward: Reward | null): Company {
  if (!reward) return company;
  switch (reward.kind) {
    case "reputation": return { ...company, reputation: Math.max(0, Math.min(100, company.reputation + reward.amount)) };
    case "cash": return { ...company, cash: company.cash + reward.amount };
    case "credit": return { ...company, creditLimit: company.creditLimit + reward.amount };
    case "capacity": return { ...company, capacity: Math.round(company.capacity * (1 + reward.amount)) };
  }
}
