/**
 * What each decision is likely to do to you — the good and the cost.
 *
 * ## The problem this fixes
 *
 * Every lever on a desk had a line of help, and the help was well written and
 * mostly true, and people still could not answer the only question they were
 * asking: *if I do this, what happens?* "Being known. Durable and expensive:
 * half of it lands this year, half next, and it fades slowly" is a good
 * sentence about brand spend and it is four clauses deep before it says
 * anything you can weigh against another lever.
 *
 * The marketplace in this same game had already solved it. An asset there
 * reads `+6 brand`, `+231,600 capacity`, `12% off every unit` — three chips,
 * no prose, and you can compare two listings in a second. The decisions
 * deserved the same treatment, with one addition: assets in a shop are all
 * upside, and a decision at this table never is.
 *
 * ## Why both directions, always
 *
 * Because a lever with no downside is a lever nobody has to think about, and
 * a game made of those is a game of pressing every button. The trade is the
 * decision. So `down` is not an afterthought here — for most of these it is
 * the more useful half, and the ones where it was hard to write are exactly
 * the ones where a player was most likely to be surprised later.
 *
 * ## Where these come from
 *
 * The `help` text in `levers.ts`, which was written by someone reading the
 * engine, and the engine itself where the help was vague. Nothing here is
 * invented: every number that appears — 40% for a pushed region, 8% for a
 * feature bet, twenty points of loyalty for an overrule — is one the resolver
 * actually uses. A consequence panel that lies is worse than no panel, because
 * people will plan around it.
 *
 * Keyed rather than inlined so that `levers.ts` stays a description of the
 * controls and this stays a description of the consequences, and so a test can
 * walk every lever and check none has been left without one.
 */
import type { Role } from "./types";

export interface Outcome {
  /** What gets better. */
  up: string[];
  /** What it costs. Rarely empty — see the note above on why. */
  down: string[];
}

/**
 * Keyed `role.leverId`, and `role.leverId.optionValue` for a choice whose
 * options each carry their own trade.
 */
export const LEVER_OUTCOMES: Record<string, Outcome> = {
  // ---- Chief Marketing Officer -------------------------------------------
  "cmo.price": {
    up: ["More from every customer who stays", "Margin on the whole book, not just new sales"],
    down: ["The price-sensitive segments leave first", "Fewer new customers at the door"],
  },
  "cmo.brandSpend": {
    up: ["Makes every other marketing pound work harder", "Keeps paying next year and after"],
    down: ["Only half of it lands this year", "Slow to show, and expensive"],
  },
  "cmo.performanceSpend": {
    up: ["Customers this year, quickly"],
    down: ["Stops dead the moment you stop paying", "Builds nothing that lasts"],
  },
  "cmo.celebritySpend": {
    up: ["Known faster than brand can manage", "Worth more than the same money on brand"],
    down: ["Costs a premium for the shortcut", "Does not repeat — one hit, then it fades"],
  },
  "cmo.targetCities": {
    up: ["People who cannot choose you at all until you open"],
    down: ["Costs once to open and every year to hold", "Reach you cannot sell into is money burned"],
  },
  "cmo.forecast": {
    up: ["Within 10%: about 2% of revenue saved on buying at the right volume"],
    down: ["Out by more than 20%: up to 8% of revenue gone", "The year's report says whose number it was"],
  },
  "cmo.prSpend": {
    up: ["A little better than half the time, brand cheaply"],
    down: ["The rest of the time it buys nothing", "One time in ten the story that runs is not yours"],
  },
  "cmo.referralSpend": {
    up: ["At quality 100, worth as much as TV"],
    down: ["Worth nothing at all below quality 40"],
  },
  "cmo.promo.none": {
    up: ["Everybody pays the list price"],
    down: ["Nothing here to win the people who watch the price"],
  },
  "cmo.promo.free_month": {
    up: ["Wins the people who watch the price", "Eleven months of revenue from twelve"],
    down: ["They leave faster once the deal is over", "The finance seat will notice who it attracted"],
  },
  "cmo.promo.january": {
    up: ["A gentler way to win the same people"],
    down: ["Everybody pays a little less, all year"],
  },
  "cmo.winbackSpend": {
    up: ["About a third of a year's takings each — far cheaper than finding new people"],
    down: ["Only works if what drove them off was fixed", "A fifth of the effect if nothing changed"],
  },
  "cmo.research": {
    up: ["One report, paid once, read by the whole table"],
    down: ["Costs money and changes nothing on its own"],
  },
  "cmo.regionFocus": {
    up: ["Up to 40% more in a region you push harder than its size"],
    down: ["Up to 40% less where you go short", "Concentration, not extra reach — the total does not grow"],
  },
  "cmo.segmentFocus": {
    up: ["Up to 25% more in a segment you push"],
    down: ["Up to 25% less in the ones you leave short", "Aimed at everybody is aimed at nobody"],
  },
  "cmo.tiers": {
    up: ["A price that fits each segment instead of one for all"],
    down: ["Every paying tier leaks towards the cheapest", "The wider the gap, the more who work out how to pay less"],
  },

  // ---- Chief Technology Officer ------------------------------------------
  "cto.featureSpend": {
    up: ["Quality — what the product can actually do"],
    down: ["Quality nobody has heard of moves nothing"],
  },
  "cto.reliabilitySpend": {
    up: ["Quality and service from one spend — the cheapest way to move two numbers"],
    down: ["Invisible to anyone who never hit a fault"],
  },
  "cto.techDebtPaydown": {
    up: ["Buys back the speed you sold"],
    down: ["Nothing visible this year at all"],
  },
  "cto.researchSpend": {
    up: ["More quality per pound, for the wait"],
    down: ["Lands next year, not this one", "Asks you to be behind on purpose"],
  },
  "cto.securitySpend": {
    up: ["Breaches get rarer and cheaper", "Builds up year on year"],
    down: ["Wears off a fifth a year", "Nobody thanks you for the breach that did not happen"],
  },
  "cto.dataSpend": {
    up: ["A narrower forecast for everyone", "Marketing and efficiency go further", "Builds up over years"],
    down: ["Helps the other seats more than it helps yours"],
  },
  "cto.featureBet": {
    up: ["About 8% keener, in the segment it was built for"],
    down: ["About one in four flops outright", "Built from scratch, it lands next year"],
  },
  "cto.featureMode.build": {
    up: ["The full effect"],
    down: ["A year before it lands", "It might simply be wrong"],
  },
  "cto.featureMode.copy": {
    up: ["Live now", "40% of the price"],
    down: ["Half the effect", "Only possible for something a rival already has"],
  },
  "cto.engineerPay": {
    up: ["Above the market, the product moves faster"],
    down: ["Above it, every pound of product work costs that much more", "Below it, your engineer is unhappy and some years the market hires away a quarter of what is in flight"],
  },

  // ---- Chief Operating Officer -------------------------------------------
  "coo.capacityTarget": {
    up: ["Customers you can actually serve"],
    down: ["Win more than this and they are turned away", "Turning people away costs reputation, not just the sale"],
  },
  "coo.supportSpend": {
    up: ["Service, which the segments that pay most care about most"],
    down: ["Costs every year, and shows slowly"],
  },
  "coo.efficiencySpend": {
    up: ["Permanently cheaper to make each unit"],
    down: ["Pays back over years rather than this one"],
  },
  "coo.headcount": {
    up: ["Hands to do the work"],
    down: ["A salary every year, in good years and bad"],
  },
  "coo.leaseCapacity": {
    up: ["Room immediately, where building takes a year"],
    down: ["40% dearer than building it", "Gone the moment the year ends"],
  },
  "coo.programme": {
    up: ["A third of its effect in each of the next three years", "Slow, cumulative and permanent"],
    down: ["The year you start it, it does nothing at all"],
  },
  "coo.expand": {
    up: ["The announced region at 70% of the usual cost"],
    down: ["It opens next year, not this one", "In its first year you reach only as far as the brand does"],
  },
  "coo.automationTarget": {
    up: ["A little off every unit — a quarter off at the top"],
    down: ["Building new room costs more", "The product changes more slowly", "Paid for when ordered; runs from next year"],
  },
  "coo.shiftCapacity": {
    up: ["Up to half as much room again, this year", "Cheaper than leasing"],
    down: ["Dearer than building", "The operation answers the phone worse while it runs"],
  },
  "coo.stockTarget": {
    up: ["Sells next year to people your room would have turned away", "Insurance against a forecast that comes in high"],
    down: ["Costs to hold", "Worth nothing at all in a quiet year"],
  },
  "coo.sourcing.in_house": {
    up: ["The quality of doing it yourself"],
    down: ["A fixed cost you carry whatever the year does"],
  },
  "coo.sourcing.outsourced": {
    up: ["About a fifth off the overhead"],
    down: ["9% more on every unit", "Three points of quality — they work for somebody else"],
  },
  "coo.recruitingSpend": {
    up: ["Hires who arrive good rather than whoever turned up"],
    down: ["They arrive next year either way"],
  },
  "coo.trainingSpend": {
    up: ["Staff get better at looking after people"],
    down: ["Shows next year", "Staff who are not trained slowly get worse"],
  },

  // ---- Chief Financial Officer -------------------------------------------
  "cfo.borrow": {
    up: ["Money now"],
    down: ["Interest every year after", "Bounded by what your reputation lets you borrow"],
  },
  "cfo.repay": {
    up: ["Less owed and less interest", "Keeps a bad year from being a fatal one"],
    down: ["Less cash in hand this year"],
  },
  "cfo.cashBuffer": {
    up: ["The others cannot spend it — and it holds", "The only authority this seat has over the other four"],
    down: ["Everyone's plan is cut by the same fraction", "Worth telling them before the year runs, not after"],
  },
  "cfo.raiseAmount": {
    up: ["Money that never has to be repaid"],
    down: ["A permanent share of everything the company becomes", "Raising while the company is worth little is the most expensive money in the game"],
  },
  "cfo.borrowTerm.short": {
    up: ["Repay whenever you like"],
    down: ["Today's rate, which moves with the rating", "The line can be pulled"],
  },
  "cfo.borrowTerm.long": {
    up: ["A point and a half cheaper", "Fixed for three years, and cannot be pulled"],
    down: ["Cannot be repaid early", "Profit must cover the interest one and a half times or the lenders mark you down"],
  },
  "cfo.holdBack": {
    up: ["Spending you judged excessive, cut before the year runs"],
    down: ["The report says who did it", "The seat you cut planned around the money"],
  },
  "cfo.annualDiscount": {
    up: ["Customers who cannot leave until the year is up", "Cash before it is earned", "Worth most where people leave most"],
    down: ["Costs revenue on everyone who takes it"],
  },
  "cfo.insurance.none": {
    up: ["Most years, the cheapest answer"],
    down: ["You carry the whole of the year that goes wrong"],
  },
  "cfo.insurance.breach": {
    up: ["The insurer pays 80% of a breach's clean-up"],
    down: ["Never the reputation", "A premium charged on revenue"],
  },
  "cfo.insurance.lawsuit": {
    up: ["The insurer pays 80% of a settlement"],
    down: ["A premium charged on revenue"],
  },
  "cfo.insurance.poaching": {
    up: ["Half of what the market takes when engineers are underpaid comes back"],
    down: ["A premium charged on revenue"],
  },
  "cfo.insurance.all": {
    up: ["All three risks covered"],
    down: ["About twice the price of any one of them"],
  },
  "cfo.dividendPct": {
    up: ["The founders' share is banked for good, safe from whatever happens next", "Investors who have been paid do not hold a missed target against you"],
    down: ["Money that leaves the company and does not come back"],
  },
  "cfo.terms.0": {
    up: ["Every pound the day it is earned"],
    down: ["The hardest company in the market to buy from"],
  },
  "cfo.terms.30": {
    up: ["Easier to buy from"],
    down: ["A twelfth of the year's takings still owed at the end of it"],
  },
  "cfo.terms.60": {
    up: ["Easier to buy from again"],
    down: ["A sixth of the year's takings still owed at the end of it"],
  },
  "cfo.terms.90": {
    up: ["The easiest company in the market to buy from"],
    down: ["A quarter of a year's takings outstanding"],
  },
  "cfo.factorPct": {
    up: ["Cash today for what you are owed"],
    down: ["92p in the pound — 8p gone", "Expensive money, second only to an emergency loan"],
  },
  "cfo.refinance": {
    up: ["A fixed loan cannot be pulled; a credit line can"],
    down: ["A 1% fee to move it", "A poor rating locks in a poor rate for three years"],
  },
  "cfo.buyback": {
    up: ["The only way the founders' share goes up"],
    down: ["What the company is worth, plus 15%", "Money not spent on the year"],
  },
  "cfo.costReview": {
    up: ["The salaries bill falls this year"],
    down: ["Next year service slips", "Every seat loses about half a point of loyalty for each point cut"],
  },

  // ---- Chief Executive ----------------------------------------------------
  "ceo.focus.growth": {
    up: ["Share, taken now"],
    down: ["Margin, worried about later"],
  },
  "ceo.focus.margin": {
    up: ["The customers you already have, paying properly"],
    down: ["Slower to take anybody else's"],
  },
  "ceo.focus.quality": {
    up: ["Something genuinely worth switching to"],
    down: ["You wait for it — this year buys next year"],
  },
  "ceo.focus.survival": {
    up: ["The bleeding stops"],
    down: ["Everything else waits a year"],
  },
  "ceo.positioning": {
    up: ["Meaningfully more appealing to the people you declare for"],
    down: ["Slightly less appealing to everybody else", "The other four have to live inside it"],
  },
  "ceo.rehire": {
    up: ["The seat comes back, and its lever with it"],
    down: ["The salary you saved by losing it comes back too"],
  },
  "ceo.deals": {
    up: ["A partner, a campaign, sometimes a buyer"],
    down: ["Most carry a cost for years — read the terms, not the headline"],
  },
  "ceo.shockAnswer": {
    up: ["A statement wins back about half the reputation it cost", "Blaming a seat wins back the most"],
    down: ["Silence wins back nothing and reads as evasive", "Blaming a seat costs them dearly"],
  },
  "ceo.budget": {
    up: ["Nobody can commit more than their share", "A share left unused stays in the bank"],
    down: ["A seat that needed more is cut to its share", "Leave it empty and nobody is capped at all"],
  },
  "ceo.pace.ship": {
    up: ["Part of this year's product work lands now"],
    down: ["Results swing further, both ways", "Bets flop more often", "Technology inherits half as much debt again"],
  },
  "ceo.pace.balanced": {
    up: ["No swing either way"],
    down: ["And no advantage either"],
  },
  "ceo.pace.right": {
    up: ["Steadier results", "Bets flop half as often", "Less debt for technology to carry"],
    down: ["Nothing lands early", "Marketing waits for the product"],
  },
  "ceo.targets.easy": {
    up: ["Missing it barely stings"],
    down: ["They coast a little"],
  },
  "ceo.targets.fair": {
    up: ["The objective as written"],
    down: ["No extra effort bought, and none lost"],
  },
  "ceo.targets.aggressive": {
    up: ["A tenth harder, and they work harder for it"],
    down: ["A miss costs a lot of loyalty", "More of them leave"],
  },
  "ceo.bonusPool": {
    up: ["About ten points of loyalty for a year's executive salary"],
    down: ["Paid only if they meet the objective", "Money out of the company either way it is budgeted"],
  },
  "ceo.overrule": {
    up: ["Last year's plan runs in that chair instead", "The year's report works out who was right"],
    down: ["Twenty points of their loyalty", "Once a year, and only once"],
  },
  "ceo.replaceSeat": {
    up: ["A better person off the market"],
    down: ["Half a year's salary in severance, on top of the bid", "The person you fire moves to a rival table in this market"],
  },
  "ceo.replaceBid": {
    up: ["The highest bid gets the best person on the market"],
    down: ["The incumbents sometimes take them first", "The last bidder gets whoever is left, or a stopgap"],
  },
};

/**
 * The consequences for one lever, or for one option within it.
 *
 * Asked for the option first and the lever second, so a choice whose options
 * each carry a different trade — the pace, the payment terms — answers with
 * the trade actually being chosen rather than a summary of all of them.
 */
export function outcomeFor(
  role: Role, leverId: string, optionValue?: string | number | null,
): Outcome | null {
  if (optionValue !== undefined && optionValue !== null && optionValue !== "") {
    const exact = LEVER_OUTCOMES[`${role}.${leverId}.${optionValue}`];
    if (exact) return exact;
  }
  return LEVER_OUTCOMES[`${role}.${leverId}`] ?? null;
}

/**
 * Levers that carry no trade and are not expected to have one.
 *
 * A vote is not a decision with consequences of its own — the consequences
 * belong to the offer being voted on — and the seat that a hold-back falls on
 * only names a target for a cut described on the hold-back itself. Listed
 * explicitly so that the test walking every lever can tell "has no trade-off"
 * apart from "nobody has written one yet".
 */
export const LEVERS_WITHOUT_TRADES: ReadonlySet<string> = new Set([
  "cmo.dealVotes", "cto.dealVotes", "coo.dealVotes", "cfo.dealVotes",
  "cfo.holdBackSeat",
]);

/**
 * The trade belonging to one option alone, with no fall-back to the lever.
 *
 * The screen needs both halves separately: the lever's own trade under its
 * help line, and each option's under that option. `outcomeFor` falls back, so
 * using it per option would print the lever's summary under every one of them
 * and make four different choices look identical.
 */
export const optionOutcome = (
  role: Role | null | undefined, leverId: string, value: string | number,
): Outcome | null => (role ? LEVER_OUTCOMES[`${role}.${leverId}.${value}`] ?? null : null);

/** The lever's own trade, ignoring anything its options say. */
export const leverOutcome = (role: Role | null | undefined, leverId: string): Outcome | null =>
  (role ? LEVER_OUTCOMES[`${role}.${leverId}`] ?? null : null);
