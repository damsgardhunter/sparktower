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
import { fixedCosts, focusEffects, interlock, lift, debtDrag, nextTechDebt, FOCUS_NOTES, type Focus, type TeamDecisions } from "./decisions";
import { assetEffects, ageAssets } from "./assets";
import { reachOf } from "./market";
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
}

export interface YearResult {
  world: World;
  reports: CompanyReport[];
  /** What happened to the market this year, if anything did. */
  event: MarketEvent | null;
}

/** Bounded 0–100. */
const clamp = (n: number): number => Math.max(0, Math.min(100, n));

export function resolveYear(world: World, decisions: TeamDecisions[], economy?: Economy): YearResult {
  const { niche } = world;
  /*
   * The year's news, decided before anything else and applied to the weather
   * before the market sees it. Drawn from the state of the market rather than
   * out of the air: a company with a poor reputation gets the scandal, one
   * that has been quietly excellent gets the write-up. The dice choose which
   * of the things you had coming arrives, never whether you deserved one.
   */
  const event = eventFor({ world, year: world.year, economy: economy ?? world.economy });
  const nextEconomy = economyWithEvent(economy ?? world.economy, event);
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
    /*
     * This year's shipping, plus whatever last year's research finished.
     * Research buys more per pound than features do and buys it a year late —
     * the one lever here that asks a team to be behind on purpose.
     */
    const landed = company.pipeline ?? 0;
    /*
     * Half the saturation point and a higher ceiling than shipping: research
     * buys roughly half again as much quality per pound. It needs to, because
     * the year you spend it you gain nothing while everything still decays —
     * so a payoff merely equal to shipping would make patience strictly worse
     * and the lever a tax on thinking ahead.
     */
    const pipeline = lift(d.cto?.researchSpend ?? 0, 150_000, 24) * niche.innovationPace;
    if (landed > 0) {
      notesFor[company.id].push(`Last year's research shipped: ${landed.toFixed(1)} points of quality that no amount of spending this year could have bought.`);
    }
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

    const qualityGain = (lift((d.cto?.featureSpend ?? 0) + (d.cto?.reliabilitySpend ?? 0) * 1.2, 200_000, 14) * niche.innovationPace * focus.quality) * drag.product + landed;
    const serviceGain = lift((d.coo?.supportSpend ?? 0) + (d.cto?.reliabilitySpend ?? 0) * 0.5, 150_000, 15) * focus.quality;
    const costCut = lift(d.coo?.efficiencySpend ?? 0, 180_000, 0.18);

    // Everything decays. A company that stands still goes backwards, which is
    // what stops a good year in year two carrying a team to year fourteen.
    const decay = { brand: 4.5 * focus.decay, quality: 3 * focus.decay, service: 3.5 * focus.decay };

    const capacity = Math.max(0, Math.round(d.coo?.capacityTarget ?? company.capacity));
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

    return {
      ...company,
      assets: aged.assets,
      cities,
      pipeline,
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
      brand: clamp(company.brand + brandGain + perfGain - decay.brand),
      quality: clamp(company.quality + qualityGain - decay.quality),
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

    const borrowed = Math.max(0, d?.cfo?.borrow ?? 0);
    const repaid = Math.max(0, d?.cfo?.repay ?? 0);
    const raised = Math.max(0, d?.cfo?.raiseAmount ?? d?.cfo?.raise?.amount ?? 0);

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
    const marketPrice = niche.segments.reduce((sum, s) => sum + s.referencePrice * s.size, 0)
      / Math.max(1, niche.segments.reduce((sum, s) => sum + s.size, 0));
    const valueForMoney = company.price > 0
      ? Math.min(2, (company.quality / 100) / (company.price / marketPrice))
      : 0;
    const repChange =
      (company.service - 50) * 0.06 +
      (valueForMoney - 0.8) * 6 -
      letDown * 26 -
      (profit < 0 && company.cash < 0 ? 2 : 0);

    /*
     * Back to the company's own numbers. Everything the assets lent it was for
     * facing the market with; what it keeps is what it built, plus the result.
     */
    const base = baseById.get(company.id) ?? company;

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

    return {
      ...company,
      founderShare,
      brand: base.brand,
      quality: base.quality,
      service: base.service,
      capacity: base.capacity,
      unitCost: base.unitCost,
      customers,
      cash,
      debt,
      creditLimit,
      bankruptSince,
      reputation: clamp(base.reputation + repChange),
    };
  });

  /*
   * The year's news lands on whoever it happened to, after the market has
   * resolved. A scandal is a consequence of the year, not a condition of it.
   */
  const afterEvent = settled.map((c) => {
    const touched = companyWithEvent(c, event);
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
  const rankOf = new Map(ordered.map((c, i) => [c.id, i + 1]));

  const reports: CompanyReport[] = afterEvent.map((company) => {
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
    };
  });

  return {
    world: { ...world, year: world.year + 1, companies: afterEvent, economy: nextEconomy },
    reports,
    event,
  };
}
