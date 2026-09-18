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
import type { Company, Economy, World } from "./types";
import { allocate, marketShares } from "./market";
import { incumbentYear } from "./incumbents";
import { fixedCosts, focusEffects, interlock, lift, FOCUS_NOTES, type Focus, type TeamDecisions } from "./decisions";

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
  /** Plain-language explanation of what actually happened, and why. */
  notes: string[];
  bankrupt: boolean;
}

export interface YearResult {
  world: World;
  reports: CompanyReport[];
}

/** Bounded 0–100. */
const clamp = (n: number): number => Math.max(0, Math.min(100, n));

export function resolveYear(world: World, decisions: TeamDecisions[], economy?: Economy): YearResult {
  const { niche } = world;
  const nextEconomy = economy ?? world.economy;
  const byCompany = new Map(decisions.map((d) => [d.companyId, d]));
  const sharesBefore = marketShares(Object.fromEntries(world.companies.map((c) => [c.id, c.customers])));

  const notesFor: Record<string, string[]> = {};
  const spendFor: Record<string, number> = {};

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

    const brandGain = lift((d.cmo?.brandSpend ?? 0) + (d.cmo?.celebritySpend ?? 0) * 1.4, 220_000, 16) * lock.deliverable * focus.marketing;
    const perfGain = lift(d.cmo?.performanceSpend ?? 0, 180_000, 9) * lock.deliverable * focus.marketing;
    const qualityGain = lift((d.cto?.featureSpend ?? 0) + (d.cto?.reliabilitySpend ?? 0) * 1.2, 200_000, 14) * niche.innovationPace * focus.quality;
    const serviceGain = lift((d.coo?.supportSpend ?? 0) + (d.cto?.reliabilitySpend ?? 0) * 0.5, 150_000, 15) * focus.quality;
    const costCut = lift(d.coo?.efficiencySpend ?? 0, 180_000, 0.18);

    // Everything decays. A company that stands still goes backwards, which is
    // what stops a good year in year two carrying a team to year fourteen.
    const decay = { brand: 4.5 * focus.decay, quality: 3 * focus.decay, service: 3.5 * focus.decay };

    const capacity = Math.max(0, Math.round(d.coo?.capacityTarget ?? company.capacity));
    const price = Math.max(1, d.cmo?.price ?? company.price);

    return {
      ...company,
      price,
      capacity,
      brand: clamp(company.brand + brandGain + perfGain - decay.brand),
      quality: clamp(company.quality + qualityGain - decay.quality),
      service: clamp(company.service + serviceGain - decay.service),
      unitCost: Math.max(niche.baseUnitCost * 0.45, company.unitCost * (1 - costCut) * nextEconomy.costIndex * focus.cost),
    };
  });

  /* 2. Incumbents decide, seeing the players as they now are. */
  const players = afterDecisions.filter((c) => c.kind === "player");
  const withIncumbents: Company[] = afterDecisions.map((company) => {
    if (company.kind !== "incumbent") return company;
    const moves = incumbentYear(company, players, niche, nextEconomy);
    spendFor[company.id] = moves.spend;
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
    const product = (d?.cto?.featureSpend ?? 0) + (d?.cto?.reliabilitySpend ?? 0) + (d?.cto?.techDebtPaydown ?? 0);
    const ops = (d?.coo?.supportSpend ?? 0) + (d?.coo?.efficiencySpend ?? 0);
    const fixed = company.kind === "player"
      ? fixedCosts(company, d?.coo?.headcount ?? 0, nextEconomy) * focusEffects(d?.ceo?.focus).fixed
      : 0;
    const discretionary = company.kind === "player" ? marketing + product + ops + fixed : (spendFor[company.id] ?? 0);

    const borrowed = Math.max(0, d?.cfo?.borrow ?? 0);
    const repaid = Math.max(0, d?.cfo?.repay ?? 0);
    const raised = d?.cfo?.raise?.amount ?? 0;

    const interest = company.debt * nextEconomy.interestRate;
    const costs = variable + discretionary + interest;
    const profit = revenue - costs;

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
    if (cash < 0) {
      const emergency = Math.min(company.creditLimit - debt, -cash);
      if (emergency > 0) { cash += emergency; debt += emergency; }
      if (cash < 0 && company.kind === "player") {
        bankruptSince ??= world.year;
        notesFor[company.id] = [
          ...(notesFor[company.id] ?? []),
          "The company ran out of money and credit. It is not out of the season: assets can be sold, seats dissolved, debt restructured, and a rival may bid for what is left.",
        ];
      }
    }

    // What a bank will lend against reputation and what the company holds.
    const assetValue = company.assets.reduce((sum, a) => sum + a.bookValue, 0);
    const creditLimit = Math.max(0, Math.round(revenue * 0.35 + assetValue * 0.5 + company.reputation * 4_000));

    /*
     * 5. Reputation: a consequence, not a lever. It is bought by keeping
     * promises — serving who you sold to, at a quality that matches the price —
     * and lost fastest by turning people away.
     */
    const turnedAway = allocation.unserved[company.id] ?? 0;
    const served = units;
    const letDown = served + turnedAway > 0 ? turnedAway / (served + turnedAway) : 0;
    const valueForMoney = company.price > 0 ? (company.quality / 100) / (company.price / niche.segments[0].referencePrice) : 0;
    const repChange =
      (company.service - 50) * 0.06 +
      (valueForMoney - 0.8) * 6 -
      letDown * 26 -
      (profit < 0 && company.cash < 0 ? 2 : 0);

    return {
      ...company,
      customers,
      cash,
      debt,
      creditLimit,
      bankruptSince,
      reputation: clamp(company.reputation + repChange),
    };
  });

  /* Rankings: by share, which is the number everyone actually argues about. */
  const ordered = [...settled].sort((a, b) => (sharesAfter[b.id] ?? 0) - (sharesAfter[a.id] ?? 0));
  const rankOf = new Map(ordered.map((c, i) => [c.id, i + 1]));

  const reports: CompanyReport[] = settled.map((company) => {
    const units = Object.values(company.customers).reduce((sum, n) => sum + n, 0);
    const before = world.companies.find((c) => c.id === company.id)!;
    const revenue = units * company.price;
    return {
      companyId: company.id,
      name: company.name,
      year: world.year,
      customers: units,
      marketShare: sharesAfter[company.id] ?? 0,
      shareChange: (sharesAfter[company.id] ?? 0) - (sharesBefore[company.id] ?? 0),
      turnedAway: allocation.unserved[company.id] ?? 0,
      revenue,
      costs: revenue - (company.cash - before.cash),
      profit: company.cash - before.cash,
      cash: company.cash,
      debt: company.debt,
      reputation: company.reputation,
      reputationChange: company.reputation - before.reputation,
      quality: company.quality,
      brand: company.brand,
      service: company.service,
      rank: rankOf.get(company.id) ?? 0,
      notes: notesFor[company.id] ?? [],
      bankrupt: !!company.bankruptSince,
    };
  });

  return {
    world: { ...world, year: world.year + 1, companies: settled, economy: nextEconomy },
    reports,
  };
}
