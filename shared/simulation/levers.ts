/**
 * What each seat can actually move, and what the table is about to do to
 * itself.
 *
 * The engine takes five decision objects and resolves a year. This is the
 * layer between that and a person: what the fields are, what they mean in
 * plain words, what a sensible starting position is, and — the part that
 * matters most — what the five of them add up to *before* anyone commits.
 *
 * ## The failure this file exists to prevent
 *
 * Five people each open their own screen. The CMO commits £2m to marketing,
 * the CTO £2m to the product, the COO £2m to capacity, and the CFO — who is
 * the only one who can see the bank balance — has already gone to bed. Nobody
 * did anything unreasonable. The company has £6m and has just committed £6m
 * of discretionary spend on top of a £1.1m salary bill, and finds out on the
 * daily tick.
 *
 * That is not a difficulty, it is a gotcha: the information needed to avoid it
 * was never on anyone's screen. So every seat sees the table's total
 * commitment against what the company actually has, live, while they are still
 * deciding — and the interlock notes that the engine already writes after the
 * fact are shown *before* it, where they can still change someone's mind.
 *
 * Being able to see the trap is what makes walking into it a decision.
 */
import type { Company, Niche, NicheVoice, Role } from "./types";
import type { TeamDecisions } from "./decisions";
import { interlock, fixedCosts, sanitiseDecisions } from "./decisions";
import { reachOf } from "./market";
import { SPENDING_SEATS, capacityMoney, drawdown, fundYear, isUnlocked } from "./responsibilities";
import { SEVERANCE, payEffect } from "./people";
import { featureCost } from "./product";
import { programmeCost, researchCost, statementCost } from "./world";
import { SHIFT_MAX, automationCost, shiftCapacity, stockCost } from "./factory";

/** How a lever is presented and bounded. */
export interface LeverField {
  /** Key inside the role's decision object. */
  id: string;
  label: string;
  /** One line on what moving it actually does. */
  help: string;
  kind: "money" | "price" | "count" | "choice" | "cities" | "segment" | "percent" | "tiers" | "allocation" | "levels";
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string; help: string }[];
  /** For "levels": the answers each option can be given — easy, fair, aggressive. */
  choices?: { value: string; label: string; help: string }[];
  /** For "levels": the answer an option carries when nobody has chosen one. */
  defaultChoice?: string;
  /**
   * The season year this lever first appears in, when it is not year one.
   * Set by the desk from `UNLOCKS`, so a screen can mark what is new.
   */
  unlocksIn?: number;
}

/**
 * The fields each seat fills in.
 *
 * Deliberately few. A screen with fourteen sliders is a screen people scroll
 * past; four or five levers that visibly collide with each other is a game.
 * Everything here maps directly onto a field the engine reads — there are no
 * decorative controls, because a control that changes nothing is a lie the
 * first spreadsheet will expose.
 */
export const LEVER_FIELDS: Record<Role, LeverField[]> = {
  cmo: [
    { id: "price", label: "Price", kind: "price", min: 1, step: 1,
      help: "What one customer pays. Segments differ wildly in how much they care — some leave over a pound, others barely look." },
    { id: "brandSpend", label: "TV and billboards", kind: "money", min: 0, step: 50_000,
      help: "Being known. Durable and expensive: half of it lands this year, half next, and it fades slowly. The thing that makes every other pound work harder." },
    { id: "performanceSpend", label: "Performance marketing", kind: "money", min: 0, step: 50_000,
      help: "Buying customers now. Faster than brand and it stops the moment you stop paying." },
    { id: "celebritySpend", label: "Sponsorship", kind: "money", min: 0, step: 100_000,
      help: "A shortcut to being known, at a premium. Worth more than the same money on brand, and it does not repeat itself." },
    { id: "dealVotes", label: "Your vote on the table's offers", kind: "levels", choices: [
      { value: "yes", label: "For", help: "Take it." },
      { value: "no", label: "Against", help: "Turn it down." },
    ], options: [], help: "Only counts on an offer the chief executive put to the table. A majority of the votes cast decides it." },
    { id: "expandVote", label: "Your vote on opening the region", kind: "levels", choices: [
      { value: "yes", label: "For", help: "Open it." },
      { value: "no", label: "Against", help: "Stay where you are this year." },
    ], options: [], help: "Only counts on a region operations has put up. Opening one is years of rent and a first year reaching almost nobody, so the whole table decides it: a majority of the votes cast carries it, and a tie or silence leaves the region shut." },
    { id: "targetCities", label: "Where you sell", kind: "cities",
      help: "Only people in a city you have opened can choose you, however good you are. Opening one costs money once and costs more to run for ever — spread faster than you can sell and you pay for reach you are not using." },
    { id: "forecast", label: "The forecast", kind: "count", min: 0, step: 1_000,
      help: "How many customers you will end the year with. Operations builds against it and finance plans cash on it. Within 10% saves about 2% of revenue in things bought at the right volume; out by more than 20% costs up to 8%, and the year's report says whose number it was." },
    { id: "prSpend", label: "PR and influencers", kind: "money", min: 0, step: 25_000,
      help: "A coin flip. A little better than half the time it lands and buys brand cheaply; otherwise it buys nothing, and one time in ten the story that runs is not the one you pitched." },
    { id: "referralSpend", label: "Referral programme", kind: "money", min: 0, step: 25_000,
      help: "Paying customers to bring customers. Worth nothing below quality 40 and as much as TV at quality 100 — it only works if the product is one people want to recommend." },
    { id: "promo", label: "The offer", kind: "choice", options: [
      { value: "none", label: "No offer", help: "Everybody pays the list price." },
      { value: "free_month", label: "First month free", help: "New customers only, and they pay for eleven months of twelve. Wins the people who watch the price — and they leave faster once the deal is over." },
      { value: "january", label: "A January sale", help: "Everybody pays a little less all year. A gentler version of the same trade." },
    ], help: "A promotion. It wins the price-sensitive, it costs margin, and the finance seat will notice who it attracted." },
    { id: "winbackSpend", label: "Win-back", kind: "money", min: 0, step: 25_000,
      help: "Bringing back last year's leavers, at about a third of a year's takings each — far cheaper than finding new people. It only works if what drove them off was fixed; if nothing changed, you get a fifth of it." },
    { id: "research", label: "Buy research", kind: "choice", options: [
      { value: "none", label: "None", help: "Decide on what you can see." },
      { value: "expectations", label: "Next year's expectations", help: "What each segment will demand of a company next year, before you have to meet it." },
      { value: "rivals", label: "What the incumbents will charge", help: "Their likely prices next year, which is what your price will be judged against." },
    ], help: "A report, paid for once and read by the whole table." },
    { id: "regionFocus", label: "Where the marketing goes", kind: "allocation", min: 0, max: 100, step: 5,
      help: "The share of this year's marketing aimed at each region you sell in. A region pushed harder than its size is worth up to 40% more there, and one left short is worth up to 40% less — so this is concentration, not extra reach. Regions you leave out share what is left, evenly by size. Who lives where differs: pushing into a region full of the people you are for is worth more than pushing into the biggest one." },
    { id: "segmentFocus", label: "Who the marketing is for", kind: "allocation", min: 0, max: 100, step: 5,
      help: "The share of the year's marketing aimed at each kind of customer. A segment pushed harder than its size is worth up to 25% more, one left short up to 25% less. A campaign aimed at everybody is aimed at nobody — and one aimed at a segment you have priced out of reach is money spent twice on the same mistake." },
    { id: "openNiche", label: "Go and find a niche", kind: "choice", options: [],
      help: "Pick a kind of customer and go looking inside it for the people who want what you are already good at. They pay a little more, they are harder to shift once they choose, and for a while nobody else is even describing them as a group. It costs a year of marketing to find them and you only own them while you are the only one who fits — the better you are at something in particular, the more of them there turn out to be." },
    { id: "tiers", label: "Price tiers", kind: "tiers", min: 0, step: 1,
      help: "A price for each segment instead of one for everybody. Nought is a free tier: advertising money and word of mouth, and every paying tier leaks towards it. The wider the gap between a tier and the cheapest one, the more of that segment works out how to pay less." },
  ],
  cto: [
    { id: "featureSpend", label: "New features", kind: "money", min: 0, step: 50_000,
      help: "What the product can do. Moves quality, and quality nobody has heard of moves nothing." },
    { id: "reliabilitySpend", label: "Reliability", kind: "money", min: 0, step: 50_000,
      help: "Whether it works. Counts for quality and for service, so it is the cheapest way to move two numbers." },
    { id: "techDebtPaydown", label: "Technical debt", kind: "money", min: 0, step: 50_000,
      help: "Buying back the speed you sold. Nothing visible this year." },
    { id: "researchSpend", label: "Research", kind: "money", min: 0, step: 50_000,
      help: "Work that lands next year instead of this one, and buys more quality per pound for the wait. The only decision here that asks you to be behind on purpose." },
    { id: "dealVotes", label: "Your vote on the table's offers", kind: "levels", choices: [
      { value: "yes", label: "For", help: "Take it." },
      { value: "no", label: "Against", help: "Turn it down." },
    ], options: [], help: "Only counts on an offer the chief executive put to the table. A majority of the votes cast decides it." },
    { id: "expandVote", label: "Your vote on opening the region", kind: "levels", choices: [
      { value: "yes", label: "For", help: "Open it." },
      { value: "no", label: "Against", help: "Stay where you are this year." },
    ], options: [], help: "Only counts on a region operations has put up. Opening one is years of rent and a first year reaching almost nobody, so the whole table decides it: a majority of the votes cast carries it, and a tie or silence leaves the region shut." },
    { id: "securitySpend", label: "Security", kind: "money", min: 0, step: 25_000,
      help: "Lowers the chance of a breach and how bad one is. Builds up over years and wears off a fifth a year. Nobody thanks you for the breach that didn't happen." },
    { id: "dataSpend", label: "Data and analytics", kind: "money", min: 0, step: 25_000,
      help: "A gift to the other seats: a narrower forecast for everyone, more room for the marketing seat's number to be right, and marketing and efficiency that go a little further. Builds up over years." },
    { id: "featureBet", label: "This year's feature bet", kind: "choice", options: [],
      help: "One idea from this year's menu, each built for one segment. Built, it lands next year and makes them about 8% keener — and about one in four flops. Copied from a rival, it is live now, cheaper, and worth half." },
    { id: "featureMode", label: "Build it or copy it", kind: "choice", options: [
      { value: "build", label: "Build our own", help: "A year to land, the full effect, and it might be wrong." },
      { value: "copy", label: "Copy a rival's", help: "Live now, 40% of the price, half the effect. Only for something a rival already has." },
    ], help: "Whether the feature bet is built from scratch or copied." },
    { id: "engineerPay", label: "Engineer pay", kind: "percent", min: 80, max: 130, step: 5,
      help: "Pay against the market. Above it, the product moves faster — and every pound of product work costs that much more. Below it, the work is cheaper, your engineer stays less happy, and some years the market hires away a quarter of what is in flight." },
  ],
  coo: [
    { id: "capacityTarget", label: "Capacity", kind: "count", min: 0, step: 10_000,
      help: "How many customers you can actually serve. Win more than this and they are turned away — which costs reputation, not just revenue." },
    { id: "supportSpend", label: "Support", kind: "money", min: 0, step: 50_000,
      help: "What happens after someone buys. The segments that pay most are the ones that care about this most." },
    { id: "efficiencySpend", label: "Efficiency", kind: "money", min: 0, step: 50_000,
      help: "Cuts what each unit costs to make, permanently. Pays back over years rather than this one." },
    { id: "headcount", label: "Headcount", kind: "count", min: 0, max: 400, step: 1,
      help: "Staff beyond the five of you. Each one is a salary every year, in good years and bad." },
    { id: "leaseCapacity", label: "Lease capacity", kind: "count", min: 0, step: 10_000,
      help: "Room you can use this year, rented rather than built. Immediate where building takes a year, 40% dearer than building, and gone when the year ends. Cutting built capacity sells it back for 30% of what it cost." },
    { id: "dealVotes", label: "Your vote on the table's offers", kind: "levels", choices: [
      { value: "yes", label: "For", help: "Take it." },
      { value: "no", label: "Against", help: "Turn it down." },
    ], options: [], help: "Only counts on an offer the chief executive put to the table. A majority of the votes cast decides it." },
    { id: "programme", label: "Improvement programme", kind: "choice", options: [],
      help: "One a year, paying out a third of its effect in each of the next three years. Slow, cumulative and permanent — and the year you start one, it does nothing at all." },
    { id: "expand", label: "Put the announced region to the table", kind: "choice", options: [],
      help: "The region announced for next year, at 70% of the usual cost. You put it up and it counts as your vote for; the other four vote too, and a majority of the votes cast opens it. It opens next year, and in its first year you reach only as far as the brand does." },
    { id: "automationTarget", label: "Automate the plant", kind: "percent", min: 0, max: 100, step: 5,
      help: "How automated it should be next year. Every point takes a little off what each one costs to make — a quarter off at the top — and puts it onto what building more room costs, and onto how slowly the product can change. Paid for when ordered; it runs from next year. Taking it out again is immediate." },
    { id: "shiftCapacity", label: "Second shift", kind: "count", min: 0, step: 10_000,
      help: "Run the plant you have for longer: room this year, up to half as much again, cheaper than leasing and dearer than building. The operation answers the phone worse while it runs." },
    { id: "stockTarget", label: "Stock for next year", kind: "count", min: 0, step: 10_000,
      help: "Made now, sold next year, to the people your room would otherwise turn away. It costs to hold and it is worth nothing in a quiet year: insurance against a forecast that comes in high." },
    { id: "sourcing", label: "Make it or buy it", kind: "choice", options: [
      { value: "in_house", label: "In house", help: "Your people, your fixed cost, and the quality of doing it yourself." },
      { value: "outsourced", label: "Buy it in", help: "About a fifth off the overhead, 9% more on every unit, and three points of quality: the people doing it work for somebody else." },
    ], help: "Where the work is actually done. A fixed cost traded for a variable one." },
    { id: "recruitingSpend", label: "Recruiting", kind: "money", min: 0, step: 25_000,
      help: "Who this year's hires are. Spend nothing and you get whoever turned up; spend well and they arrive good. They arrive next year either way." },
    { id: "trainingSpend", label: "Training", kind: "money", min: 0, step: 25_000,
      help: "Making the staff already here better at looking after people. Shows next year, and staff who are not trained slowly get worse." },
  ],
  cfo: [
    { id: "borrow", label: "Draw down", kind: "money", min: 0, step: 100_000,
      help: "Money now against interest every year after. Bounded by what the company can borrow, which rises with reputation." },
    { id: "repay", label: "Repay", kind: "money", min: 0, step: 100_000,
      help: "Less owed, less interest, less cash. The boring move that keeps a bad year from being fatal." },
    { id: "cashBuffer", label: "Cash to hold back", kind: "money", min: 0, step: 100_000,
      help: "What you refuse to let the others spend, and it holds — spending above it is cut back, everyone's by the same fraction. The only authority this seat has over the other four, so it is worth telling them." },
    { id: "raiseAmount", label: "Raise from investors", kind: "money", min: 0, step: 500_000,
      help: "Money that never has to be repaid, bought with a permanent share of everything the company becomes. Raising while the company is worth little is the most expensive money in the game." },
    { id: "borrowTerm", label: "Borrow on", kind: "choice", options: [
      { value: "short", label: "The credit line", help: "Today's rate, which moves with the rating. Repay whenever you like." },
      { value: "long", label: "A three-year loan", help: "A point and a half cheaper, fixed for three years, repaid in full when it ends. It cannot be repaid early, and profit must cover the interest one and a half times over or the lenders mark you down." },
    ], help: "What this year's drawdown is borrowed on. Interest is paid from next year." },
    { id: "holdBack", label: "Sign-off: hold back", kind: "percent", min: 0, max: 20, step: 1,
      help: "Hold back up to 20% of what a seat committed, or everyone's. It is cut before the year runs, and the report says who did it." },
    { id: "holdBackSeat", label: "Hold back from", kind: "choice", options: [
      { value: "all", label: "Everyone", help: "Every spending seat, by the same share." },
      { value: "cmo", label: "Marketing", help: "Only the marketing plan." },
      { value: "cto", label: "Technology", help: "Only the product plan." },
      { value: "coo", label: "Operations", help: "Only the operations plan, capacity included." },
    ], help: "Whose plan the hold-back falls on." },
    { id: "annualDiscount", label: "Annual plans", kind: "percent", min: 0, max: 30, step: 1,
      help: "A discount for paying a year up front. Costs revenue on everyone who takes it; buys customers who cannot leave until the year is up, and cash before it is earned. Worth most where people leave most." },
    { id: "dealVotes", label: "Your vote on the table's offers", kind: "levels", choices: [
      { value: "yes", label: "For", help: "Take it." },
      { value: "no", label: "Against", help: "Turn it down." },
    ], options: [], help: "Only counts on an offer the chief executive put to the table. A majority of the votes cast decides it." },
    { id: "expandVote", label: "Your vote on opening the region", kind: "levels", choices: [
      { value: "yes", label: "For", help: "Open it." },
      { value: "no", label: "Against", help: "Stay where you are this year." },
    ], options: [], help: "Only counts on a region operations has put up. Opening one is years of rent and a first year reaching almost nobody, so the whole table decides it: a majority of the votes cast carries it, and a tie or silence leaves the region shut." },
    { id: "insurance", label: "Insure against", kind: "choice", options: [
      { value: "none", label: "Nothing", help: "Carry the risk. Most years, the cheapest answer." },
      { value: "breach", label: "Breaches", help: "The insurer pays 80% of a breach's clean-up. Never the reputation." },
      { value: "lawsuit", label: "Lawsuits", help: "The insurer pays 80% of a settlement." },
      { value: "poaching", label: "Poaching", help: "Half of what the market takes when engineers are paid under the odds comes back." },
      { value: "all", label: "Everything", help: "All three, for about twice the price of any one." },
    ], help: "A premium against the year going wrong, charged on revenue. Wasted money most years, and the only thing that mattered in one." },
    { id: "dividendPct", label: "Pay out", kind: "percent", min: 0, max: 100, step: 5,
      help: "The share of this year's profit paid to the owners. The founders' share is banked for good — safe from whatever happens next — and investors who have been paid do not hold a missed target against you. It is money that leaves the company." },
    { id: "terms", label: "Payment terms", kind: "choice", options: [
      { value: "0", label: "On delivery", help: "Every pound the day it is earned. How the company has always billed." },
      { value: "30", label: "30 days", help: "Easier to buy from, and a twelfth of the year's takings still owed at the end of it." },
      { value: "60", label: "60 days", help: "Easier to buy from. A sixth of the year's takings is still owed at the end of it." },
      { value: "90", label: "90 days", help: "The easiest company in the market to buy from, and a quarter of a year's takings outstanding." },
    ], help: "How long customers get to pay. Longer wins business and delays the money; the marketing seat gets the credit and this seat carries it." },
    { id: "factorPct", label: "Sell what you are owed", kind: "percent", min: 0, max: 100, step: 5,
      help: "A factor buys what customers owe you and pays 92p in the pound today. Expensive money, and faster than anything except an emergency loan." },
    { id: "refinance", label: "Refinance the line", kind: "money", min: 0, step: 100_000,
      help: "Move what is on the credit line onto a three-year fixed loan at today's rate, for a 1% fee. The line moves with the rating and can be pulled; a fixed loan cannot — which cuts both ways, because a poor rating locks in a poor rate." },
    { id: "buyback", label: "Buy the company back", kind: "money", min: 0, step: 250_000,
      help: "Buy a stake back from the investors, at what the company is worth plus 15%. The only way the founders' share goes up, and money not spent on the year to do it." },
    { id: "costReview", label: "Cost review", kind: "percent", min: 0, max: 20, step: 1,
      help: "Cut overhead by a percentage. The salaries bill falls this year; next year service slips and every seat's loyalty drops, by about half a point for each point cut." },
  ],
  ceo: [
    { id: "focus", label: "Where the year goes", kind: "choice", options: [
      { value: "growth", label: "Growth", help: "Take share now and worry about the margin later." },
      { value: "margin", label: "Margin", help: "Make the customers you have pay properly." },
      { value: "quality", label: "Quality", help: "Build something worth switching to, and wait for it." },
      { value: "survival", label: "Survival", help: "Stop the bleeding. Everything else can wait for next year." },
    ], help: "What the company is for this year. It does not override anyone — it is what you have told them all to weigh." },
    { id: "positioning", label: "Who the company is for", kind: "segment",
      help: "Declaring a segment makes you meaningfully more appealing to those people and slightly less to everyone else. It is the decision the other four then have to live inside." },
    { id: "rehire", label: "Bring a seat back", kind: "choice", options: [], 
      help: "A seat dissolved in a bad year can be filled again, at the salary that was saved by losing it — and the lever comes back with it." },
    { id: "deals", label: "This year's offers", kind: "levels", defaultChoice: "decline", choices: [
      { value: "accept", label: "Take it", help: "Your call, on your own." },
      { value: "decline", label: "Turn it down", help: "Nothing happens." },
      { value: "vote", label: "Put it to the table", help: "The other four vote. A majority of those who vote decides it; a tie or silence turns it down." },
    ], options: [], help: "What arrives from outside: a partner, a campaign, sometimes a buyer. Accept, decline, or let the table decide." },
    { id: "expandVote", label: "Your vote on opening the region", kind: "levels", choices: [
      { value: "yes", label: "For", help: "Open it." },
      { value: "no", label: "Against", help: "Stay where you are this year." },
    ], options: [], help: "Only counts on a region operations has put up. Opening one is years of rent and a first year reaching almost nobody, so the whole table decides it: a majority of the votes cast carries it, and a tie or silence leaves the region shut." },
    { id: "shockAnswer", label: "Answer the shock", kind: "choice", options: [],
      help: "What the company says about what happened. A statement wins back about half the reputation it cost; silence wins back nothing and reads as evasive; blaming a seat wins back the most and costs them dearly." },
    { id: "budget", label: "Split the budget", kind: "allocation", min: 0, max: 100, step: 5,
      help: "The share of what the company can spend, once salaries are paid, that each seat may commit. A seat that asks for more is cut to its share; a share left unused stays in the bank rather than going to somebody else. Leave it empty and nobody is capped." },
    { id: "pace", label: "Pace", kind: "choice", options: [
      { value: "ship", label: "Ship it", help: "Part of this year's product work lands now, results swing further, bets flop more, and the technology seat inherits half as much debt again." },
      { value: "balanced", label: "Balanced", help: "Neither." },
      { value: "right", label: "Get it right", help: "Nothing early, steadier results, bets flop half as often, less debt — and marketing waits for the product." },
    ], help: "How fast the company moves. Faster everything, higher variance, and the technology seat inherits the debt." },
    { id: "targets", label: "Set each seat's target", kind: "levels", defaultChoice: "fair", choices: [
      { value: "easy", label: "Easy", help: "A tenth easier. They coast a little, and missing it barely stings." },
      { value: "fair", label: "Fair", help: "The objective as written." },
      { value: "aggressive", label: "Aggressive", help: "A tenth harder, and they work harder for it — but a miss costs a lot of loyalty." },
    ], help: "How hard each seat's objective is pushed next year. Aggressive targets get more effort out of people and more of them leave." },
    { id: "bonusPool", label: "Bonus pot", kind: "money", min: 0, step: 50_000,
      help: "Shared equally by the seats that meet this year's objective, and paid only if they do. Loyalty for the money: about ten points for a year's executive salary." },
    { id: "overrule", label: "Overrule a seat", kind: "choice", options: [],
      help: "Once a year, reverse one seat's decision: last year's plan runs in that chair instead. It costs them twenty points of loyalty, and the year's report works out who was right." },
    { id: "replaceSeat", label: "Replace a seat", kind: "choice", options: [],
      help: "Fire someone and hire a replacement from the market, where rivals are bidding too. Costs half a year's salary in severance on top of the bid. A person who is fired moves to another table in this market." },
    { id: "replaceBid", label: "Bid for the replacement", kind: "money", min: 0, step: 50_000,
      help: "What you offer the best executive on the market this year. The highest bid gets the best person; the incumbents sometimes take them first; the last bidder gets whoever is left, or a stopgap." },
  ],
};

/** A sensible starting position for a seat, from last year rather than from zero. */
/**
 * The levers whose "no answer" is *as you were*, rather than nought.
 *
 * Everything else on a desk starts at zero because zero is a real decision:
 * spend nothing, build nothing. These are different. A missing automation
 * target reads as "take the automation out", a missing pay level as "cut
 * every engineer to the floor", missing terms as "cash on delivery" — none of
 * which anybody chose, and each of which arrives the year the lever does,
 * when the seat has never seen it before.
 */
function standing(role: Role, company: Company, draft: Record<string, any>): Record<string, any> {
  const fill = (id: string, value: unknown) => {
    if (draft[id] === undefined || draft[id] === null || draft[id] === "") draft[id] = value;
  };
  if (role === "cto") fill("engineerPay", 100);
  if (role === "coo") {
    fill("automationTarget", Math.round(company.automation ?? 0));
    fill("sourcing", company.sourcing ?? "in_house");
  }
  if (role === "cfo") {
    fill("terms", company.terms ?? 0);
    fill("borrowTerm", "short");
    fill("insurance", "none");
  }
  if (role === "cmo") {
    fill("price", company.price);
    fill("promo", "none");
    fill("research", "none");
  }
  if (role === "ceo") fill("pace", "balanced");
  return draft;
}

export function defaultDraft(role: Role, company: Company, previous?: any): Record<string, any> {
  if (previous) {
    // What they did last year, minus the moves that should never repeat by default.
    const carried = { ...previous };
    /*
     * The one-shot levers, reset by their real field ids. (This used to delete
     * `raise`, which has never been a field — so last year's `raiseAmount`
     * survived, and a bot, which starts from this draft, sold another slice of
     * the company every year.) Zero rather than delete, so the control shows.
     */
    if (role === "cfo") { carried.borrow = 0; carried.repay = 0; carried.raiseAmount = 0; }
    if (role === "cmo") carried.celebritySpend = 0;
    if (role === "ceo") {
      delete carried.offer; delete carried.dissolveSeats;
      // An overrule, a firing and a bonus are each one year's decision, never a habit.
      carried.overrule = ""; carried.replaceSeat = ""; carried.replaceBid = 0; carried.bonusPool = 0;
      // A seat brought back last year is already back.
      carried.rehire = "";
    }
    if (role === "cfo") carried.costReview = 0;
    // A feature bet is placed once; next year has its own menu.
    if (role === "cto") { carried.featureBet = ""; carried.featureMode = "build"; }
    // Rented room goes back at the end of the year; renting it again is a new decision.
    if (role === "coo") { carried.leaseCapacity = 0; carried.shiftCapacity = 0; }
    // A factoring run, a refinancing and a buyback are each this year's call.
    if (role === "cfo") { carried.factorPct = 0; carried.refinance = 0; carried.buyback = 0; }
    return standing(role, company, carried);
  }

  switch (role) {
    case "cmo": return standing(role, company, { price: company.price, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: company.cities ?? [] });
    case "cto": return standing(role, company, { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0, researchSpend: 0 });
    case "coo": return standing(role, company, { capacityTarget: company.capacity, supportSpend: 0, efficiencySpend: 0, headcount: 0 });
    case "cfo": return standing(role, company, { borrow: 0, repay: 0, cashBuffer: 0, raiseAmount: 0 });
    case "ceo": return standing(role, company, { focus: "growth", positioning: company.positioning ?? "", rehire: "" });
  }
}

export interface ValidationResult {
  ok: boolean;
  /** Keyed by field id, so a screen can put the message under the control that caused it. */
  errors: Record<string, string>;
}

/**
 * Whether one seat's decision is submittable at all.
 *
 * This is the narrow check: numbers that are numbers, within their own bounds.
 * It deliberately does *not* refuse an expensive year — spending more than the
 * company has is a decision a team is allowed to make, and telling them what
 * it will cost is `commitment()`'s job. A validator that refuses risk turns a
 * business simulation into a form that only accepts the safe answer.
 */
export function validateDecision(role: Role, payload: any, company: Company): ValidationResult {
  const errors: Record<string, string> = {};
  if (!payload || typeof payload !== "object") {
    return { ok: false, errors: { _: "Nothing to submit." } };
  }

  for (const field of LEVER_FIELDS[role]) {
    const value = payload[field.id];

    if (field.kind === "choice" && field.id === "focus") {
      if (!field.options?.some((o) => o.value === value)) errors[field.id] = "Pick one.";
      continue;
    }

    if (field.kind === "choice") {
      // A choice with no options is one the season has nothing to offer for —
      // an empty seat list, say — and is skipped rather than refused.
      if ((field.options?.length ?? 0) === 0) continue;
      if (value !== undefined && value !== null && value !== "" && !field.options!.some((o) => o.value === value)) {
        errors[field.id] = "Pick one.";
      }
      continue;
    }

    if (field.kind === "cities") {
      if (value !== undefined && !Array.isArray(value)) errors[field.id] = "Pick the places you sell.";
      continue;
    }

    if (field.kind === "levels") {
      if (value === undefined || value === null || value === "") continue;
      if (typeof value !== "object" || Array.isArray(value)) { errors[field.id] = "Pick one for each."; continue; }
      const allowed = (field.choices ?? []).map((c) => c.value);
      if (Object.values(value as Record<string, unknown>).some((v) => v !== "" && !allowed.includes(String(v)))) errors[field.id] = "Pick one for each.";
      continue;
    }

    if (field.kind === "tiers" || field.kind === "allocation") {
      if (value === undefined || value === null || value === "") continue;
      if (typeof value !== "object" || Array.isArray(value)) { errors[field.id] = "Needs a number for each."; continue; }
      const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== "" && v !== null && v !== undefined);
      if (entries.some(([, v]) => !Number.isFinite(Number(v)) || Number(v) < 0)) { errors[field.id] = "Each needs a number of nought or more."; continue; }
      if (field.kind === "allocation") {
        const total = entries.reduce((sum, [, v]) => sum + Number(v), 0);
        if (total > 100) errors[field.id] = `That adds up to ${Math.round(total)}%. The shares can't come to more than 100%.`;
      }
      continue;
    }

    if (field.kind === "segment") {
      // Optional: a company is allowed to be for everybody.
      if (value !== undefined && value !== null && value !== "" && typeof value !== "string") {
        errors[field.id] = "Pick one, or none.";
      }
      continue;
    }

    /*
     * A field that was never sent is not an error; a field that was sent empty
     * is.
     *
     * The difference matters the moment a new lever is added: every client
     * that predates it stops sending it, and treating absence as "needs a
     * number" made adding `researchSpend` silently reject every decision the
     * technology seat filed. Missing means nought; cleared means the person
     * emptied the box and meant something by it.
     */
    if (value === undefined) continue;
    if (value === null || value === "") { errors[field.id] = "Needs a number."; continue; }
    const n = Number(value);
    if (!Number.isFinite(n)) { errors[field.id] = "Needs a number."; continue; }
    if (field.min !== undefined && n < field.min) errors[field.id] = `Can't go below ${field.min}.`;
    if (field.max !== undefined && n > field.max) errors[field.id] = `Can't go above ${field.max}.`;
  }

  // The one hard stop: you cannot repay money you do not owe.
  if (role === "cfo" && Number(payload.repay) > company.debt) {
    errors.repay = `You only owe ${Math.round(company.debt).toLocaleString()}.`;
  }

  /*
   * The other hard stop: you cannot draw down credit the bank has not extended.
   *
   * This is not refusing risk — borrowing to the last pound of the line is
   * allowed, and is exactly the kind of bet the note above protects. It is
   * refusing money that does not exist. Without it a finance seat could file
   * fifty million against a two-million line and the engine would fund the
   * lot, which made the credit rating (the thing that sets the line) decorative.
   * The engine clamps as well, so a filing that slips past this — an old
   * client, a line that shrinks before the tick — still cannot overdraw.
   */
  if (role === "cfo") {
    const room = Math.max(0, company.creditLimit - company.debt);
    if (Number(payload.borrow) > room) {
      errors.borrow = room > 0
        ? `The bank will lend at most ${Math.round(room).toLocaleString()} more.`
        : "The credit line is fully drawn. Repay some of it, or raise from investors.";
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * A decision reduced to the fields the seat actually owns.
 *
 * Taken from the lever list rather than from the submission, so nothing that
 * wasn't asked for survives. Without this a crafted body could file a `borrow`
 * alongside a marketing decision and the engine — which reads decisions by
 * role — would honour it, letting a CMO quietly take out a loan the CFO never
 * agreed to.
 *
 * It runs on bot decisions too. A bot files through the same door a person
 * does, so there is one definition of what a seat may say and no second path
 * that could drift from it.
 */
export function cleanDecision(
  role: Role,
  payload: any,
  cityIds: readonly string[] = [],
  context: {
    /**
     * The season year. A lever that has not arrived yet (see `UNLOCKS`) is
     * dropped, so it cannot be filed early by a client that shows it anyway.
     */
    year?: number;
    /** How many decisions make a year, since `year` counts decisions. */
    periods?: number;
    /** The market's segments: price tiers can only be set for ones that exist. */
    segmentIds?: readonly string[];
  } = {},
): Record<string, any> {
  const source = payload ?? {};
  const clean: Record<string, any> = {};
  for (const field of LEVER_FIELDS[role]) {
    if (context.year !== undefined && !isUnlocked(role, field.id, context.year, context.periods ?? 1)) continue;
    const raw = source[field.id];
    switch (field.kind) {
      case "choice":
      case "segment":
        // A segment, or nobody. An unset choice is a real answer here.
        clean[field.id] = raw === undefined || raw === null ? "" : String(raw);
        break;
      case "cities":
        /*
         * A list of ids, filtered to places that exist.
         *
         * The default `Number()` below turned this into NaN, which silently
         * unset every city the marketing seat had chosen — the decision was
         * accepted, stored as nonsense, and the team found out by not
         * expanding. Anything the engine reads by shape rather than by number
         * has to be handled by shape.
         */
        clean[field.id] = Array.isArray(raw)
          ? raw.map(String).filter((id) => cityIds.includes(id)).slice(0, 20)
          : [];
        break;
      case "levels": {
        /*
         * Pairs, then fromEntries: the keys of this map come from the client,
         * and `out[key] = …` with a key of `__proto__` sets the object's
         * prototype instead of filing an answer. fromEntries defines own
         * properties, so no spelling of a key can reach the prototype. (Not a
         * prototype-less object: this goes to jsonb, and the Postgres driver
         * asks every value for its constructor.)
         */
        const pairs: [string, string][] = [];
        const answers = (field.choices ?? []).map((c) => c.value);
        /*
         * Targets are keyed by seat, and nothing else is a seat. Everything
         * else of this shape — an answer or a vote on each of the year's
         * offers — is keyed by whatever the season called them, so the key is
         * only bounded in length.
         */
        const seatsOnly = field.id === "targets";
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          for (const [k, v] of Object.entries(raw)) {
            const key = seatsOnly ? (["cmo", "cfo", "cto", "coo"].includes(k) ? k : null) : k.slice(0, 64);
            if (key && answers.includes(String(v))) pairs.push([key, String(v)]);
          }
        }
        const out = Object.fromEntries(pairs);
        if (Object.keys(out).length) clean[field.id] = out;
        break;
      }
      case "tiers":
      case "allocation": {
        // A map of numbers keyed by segment or by seat, and nothing else.
        // Built from pairs for the same reason as above: client keys, and
        // `allowed` is not always there to bound them.
        const numbers: [string, number][] = [];
        /*
         * What the keys of this particular map are allowed to be. They are
         * not all the same shape: the budget is split between seats, the
         * marketing between the regions the company sells in and the segments
         * it sells to, and a price tier is per segment. A single rule for all
         * of them silently threw away every regional split that was filed.
         */
        const allowed = field.id === "budget" ? (SPENDING_SEATS as readonly string[])
          : field.id === "regionFocus" ? cityIds
            : context.segmentIds;
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          for (const [k, v] of Object.entries(raw)) {
            if (v === "" || v === null || v === undefined) continue;
            if (allowed && !allowed.includes(k)) continue;
            const n = Number(v);
            if (Number.isFinite(n) && n >= 0) numbers.push([String(k).slice(0, 64), field.max !== undefined ? Math.min(field.max, n) : n]);
          }
        }
        // Empty means none: no split, no tiers. Left out rather than filed as {}.
        const filed = Object.fromEntries(numbers);
        if (Object.keys(filed).length) clean[field.id] = filed;
        break;
      }
      default: {
        const n = Number(raw);
        clean[field.id] = Number.isFinite(n) ? n : 0;
      }
    }
  }
  return clean;
}

/**
 * What building and leasing room costs this year, which is operations'
 * spending like anything else. Needs the market to price it; without one it
 * is left out, as the city fee is.
 */
/**
 * What one of each thing costs in this market, as the desk sends it: a unit
 * of capacity built or leased, and a feature built or copied. For a screen
 * that has the market's shape but not the sizes to price them from.
 */
export interface UnitPrices {
  build: number;
  lease: number;
  /** A unit of second-shift room, a unit of stock held for a year, and a point of automation per unit of plant. */
  shift?: number;
  stock?: number;
  automation?: number;
  featureBuild?: number;
  featureCopy?: number;
  /** A research report, an improvement programme, a statement, and opening the announced region. */
  research?: number;
  programme?: number;
  statement?: number;
  expansion?: number;
}

/**
 * A move that is one price or nothing — a report, a programme, a statement,
 * opening the announced region. Priced by the desk where it can be, and from
 * the market where the screen has its sizes.
 */
function oneOff(
  taken: boolean | undefined,
  niche: Niche | undefined,
  prices: UnitPrices | null | undefined,
  key: "research" | "programme" | "statement" | "expansion",
  fallback: (n: Niche) => number,
): number {
  if (!taken) return 0;
  if (prices?.[key] !== undefined) return prices[key] ?? 0;
  if (!niche) return 0;
  const cost = fallback(niche);
  return Number.isFinite(cost) ? cost : 0;
}

/**
 * What the plant costs this year: automating it, a second shift on it, and
 * stock held for next year. Priced by the desk where it can be, and from the
 * market where the screen has its sizes (see `factory.ts`).
 */
export function plantSpend(company: Company, decisions: TeamDecisions, niche?: Niche, prices?: UnitPrices | null): number {
  const d = decisions.coo;
  if (!d) return 0;
  const from = company.automation ?? 0;
  const points = Math.max(0, Math.min(100, Number(d.automationTarget ?? from) || 0) - from);
  const shift = Math.max(0, Math.min(company.capacity * SHIFT_MAX, Math.round(Number(d.shiftCapacity) || 0)));
  const stock = Math.max(0, Math.round(Number(d.stockTarget) || 0));
  if (prices?.automation !== undefined) {
    return points * company.capacity * (prices.automation ?? 0) + shift * (prices.shift ?? 0) + stock * (prices.stock ?? 0);
  }
  if (!niche) return 0;
  const total = automationCost({ from, to: d.automationTarget ?? from, capacity: company.capacity, niche })
    + shiftCapacity({ capacity: company.capacity, requested: d.shiftCapacity, niche }).cost
    + stockCost(d.stockTarget, niche);
  return Number.isFinite(total) ? total : 0;
}

/** What this year's feature bet costs, if one is placed. */
export function betSpend(decisions: TeamDecisions, niche?: Niche, prices?: UnitPrices | null): number {
  const bet = decisions.cto?.featureBet;
  if (!bet) return 0;
  const copy = decisions.cto?.featureMode === "copy";
  if (prices?.featureBuild !== undefined) return (copy ? prices.featureCopy : prices.featureBuild) ?? 0;
  if (!niche) return 0;
  const cost = featureCost(niche, copy ? "copy" : "build");
  return Number.isFinite(cost) ? cost : 0;
}

export function capacitySpend(
  company: Company,
  decisions: TeamDecisions,
  niche?: Niche,
  /** Per-unit prices as the desk sends them, for a screen that has the market's shape but not its sizes. */
  prices?: UnitPrices | null,
): number {
  if (!decisions.coo) return 0;
  const target = decisions.coo.capacityTarget ?? company.capacity;
  const lease = decisions.coo.leaseCapacity ?? 0;
  if (prices) {
    return Math.max(0, target - company.capacity) * prices.build + Math.max(0, lease) * prices.lease;
  }
  if (!niche) return 0;
  const room = capacityMoney({ current: company.capacity, target, lease, niche });
  const total = room.build + room.lease;
  // A market passed without its segment sizes cannot be priced; leave it out rather than turn the meter into NaN.
  return Number.isFinite(total) ? total : 0;
}

export interface Commitment {
  /** Discretionary spend the five of them have committed between them. */
  spend: number;
  /** Salaries and seats, which are owed whatever anyone decides. */
  fixed: number;
  /** Cash plus what is still borrowable, minus what finance has ring-fenced. */
  available: number;
  /** Spend plus fixed, against available. Over 1 means the year is funded by credit or not at all. */
  ratio: number;
  /** How each seat contributed, so the number is arguable rather than mysterious. */
  bySeat: { role: Role; spend: number }[];
  /** Of which, the one-off cost of opening somewhere new. */
  openingCost: number;
}

/**
 * What the table has committed, and what it has.
 *
 * The single most useful number on the screen, and the one no individual seat
 * could work out for themselves: each person sees their own spend, nobody sees
 * the sum. Shown live, it turns "I'll take two million for marketing" from a
 * private decision into a thing the other four can see happening.
 */
export function commitment(
  company: Company,
  decisions: TeamDecisions,
  economy: { costIndex: number },
  niche?: Niche,
  prices?: UnitPrices | null,
): Commitment {
  const bySeat: { role: Role; spend: number }[] = [
    { role: "cmo", spend: (decisions.cmo?.brandSpend ?? 0) + (decisions.cmo?.performanceSpend ?? 0) + (decisions.cmo?.celebritySpend ?? 0) + (decisions.cmo?.prSpend ?? 0) + (decisions.cmo?.referralSpend ?? 0) + (decisions.cmo?.winbackSpend ?? 0) + oneOff(decisions.cmo?.research && decisions.cmo.research !== "none", niche, prices, "research", researchCost) },
    // At the engineering pay the technology seat set.
    { role: "cto", spend: ((decisions.cto?.featureSpend ?? 0) + (decisions.cto?.reliabilitySpend ?? 0) + (decisions.cto?.techDebtPaydown ?? 0) + (decisions.cto?.researchSpend ?? 0) + (decisions.cto?.securitySpend ?? 0) + (decisions.cto?.dataSpend ?? 0) + betSpend(decisions, niche, prices)) * payEffect(decisions.cto?.engineerPay).cost },
    { role: "coo", spend: (decisions.coo?.supportSpend ?? 0) + (decisions.coo?.efficiencySpend ?? 0) + (decisions.coo?.recruitingSpend ?? 0) + (decisions.coo?.trainingSpend ?? 0)
      + oneOff(!!decisions.coo?.programme && !(company.programmes ?? []).some((p) => p.id === decisions.coo!.programme), niche, prices, "programme", programmeCost)
      /*
       * Opening the announced region is counted the moment operations puts
       * it up, before the table has voted. It is an exposure rather than a
       * commitment — the table may vote it down and the money stays — but
       * the meter exists to stop a company filing a year it cannot pay
       * for, and overstating what a year might cost is the safe side of
       * that. The mobile mirror counts it the same way.
       */
      + oneOff(!!decisions.coo?.expand, niche, prices, "expansion", () => 0)
      + plantSpend(company, decisions, niche, prices)
      + capacitySpend(company, decisions, niche, prices) },
    { role: "cfo", spend: Math.max(0, decisions.cfo?.repay ?? 0) },
    /*
     * The chief executive's own money: the bonus pot, if every objective is
     * met, and what firing somebody costs — the bid and the severance. Most
     * years nothing; the year it is not, it is the table's money too.
     */
    { role: "ceo", spend: Math.max(0, decisions.ceo?.bonusPool ?? 0) + (decisions.ceo?.replaceSeat ? Math.max(0, decisions.ceo?.replaceBid ?? 0) + SEVERANCE : 0)
      + oneOff(decisions.ceo?.shockAnswer === "statement", niche, prices, "statement", statementCost) },
  ];

  /*
   * Opening a city is the largest single movement of cash a marketing seat can
   * make, and it was not in this total.
   *
   * The engine takes it straight out of cash rather than counting it as
   * discretionary spending, so a table opening three cities for 1.7m watched
   * the meter stay comfortable and found out at the tick. Whether the engine
   * books it as spend or as a cash movement is bookkeeping; what the five of
   * them have committed is the same money either way, and this number exists
   * to tell them that.
   */
  const openingCost = niche
    ? niche.cities
        .filter((c) => (decisions.cmo?.targetCities ?? []).includes(c.id) && !(company.cities ?? []).includes(c.id))
        .reduce((sum, c) => sum + c.entryCost, 0)
    : 0;
  if (openingCost > 0) {
    const marketing = bySeat.find((s) => s.role === "cmo")!;
    marketing.spend += openingCost;
  }

  const spend = bySeat.reduce((sum, s) => sum + s.spend, 0);
  /*
   * The same reach the engine will charge against. A preview that assumed a
   * national cost base for a one-city company would overstate the bill by more
   * than half, and the number this whole screen exists for would be wrong.
   */
  const fixed = fixedCosts(
    company,
    decisions.coo?.headcount ?? 0,
    { costIndex: economy.costIndex } as any,
    niche ? reachOf(company, niche) : 1,
    /*
     * The market, so ordinary salaries are this market's salaries. Without it
     * `fixedCosts` falls back to the generic SALARY, and the preview differs
     * from the year it is previewing by whatever `salaryIn` would have said —
     * which on a Nova-written startup market is most of it.
     */
    niche ?? undefined,
  );
  const borrowable = Math.max(0, company.creditLimit - company.debt);
  /*
   * Clamped to the line the way the engine clamps it, so a draft asking for
   * more than the bank will lend does not show a table funded by money that
   * will never arrive — and counted once, not twice (see `drawdown`).
   */
  const drawn = drawdown(company, decisions.cfo?.borrow);
  const available = Math.max(0,
    company.cash + drawn + Math.max(0, borrowable - drawn) - (decisions.cfo?.cashBuffer ?? 0));

  return {
    spend,
    fixed,
    available,
    ratio: available > 0 ? (spend + fixed) / available : Infinity,
    bySeat,
    openingCost,
  };
}

export interface DraftPreview {
  commitment: Commitment;
  /**
   * What the engine would say about these decisions together, said before the
   * year runs instead of after it.
   */
  notes: string[];
  /** Loud, specific warnings that a screen should show differently from advice. */
  warnings: string[];
}

/**
 * The table's year, previewed.
 *
 * Not a forecast of the result — deliberately. A screen that told you your
 * market share before you committed would turn fourteen days of argument into
 * an optimisation problem solved on day one, and the incumbents' reactions
 * cannot be known in advance anyway. What it shows is what the five of you
 * have done *to each other*: money that does not exist, marketing that
 * outruns delivery, a product improvement nobody will hear about, a price
 * below cost. All of those are knowable now, and all of them are arguments
 * worth having before the tick rather than after it.
 */
export function draftPreview(input: {
  company: Company;
  niche: Niche;
  decisions: TeamDecisions;
  economy: { costIndex: number };
}): DraftPreview {
  const { company, niche, decisions, economy } = input;
  const money = commitment(company, decisions, economy, niche);
  const lock = interlock(company, decisions, niche);
  const warnings: string[] = [];

  if (money.ratio > 1) {
    const short = Math.round(money.spend + money.fixed - money.available);
    warnings.push(
      `The table has committed ${Math.round(money.spend + money.fixed).toLocaleString()} against ${Math.round(money.available).toLocaleString()} available — ${short.toLocaleString()} short. The year still runs; the shortfall comes out of credit, and past that the company is insolvent.`,
    );
  } else if (money.ratio > 0.9) {
    warnings.push("This spends almost everything the company has. A bad year after this one has nothing left to absorb it.");
  } else if (money.spend + money.fixed > company.cash) {
    /*
     * The line between spending money and borrowing it.
     *
     * A single ratio against cash-plus-credit misses this: a team can commit
     * every pound in the bank, still sit at 0.84 of what they could technically
     * raise, and be told nothing — even though they have just quietly moved
     * from spending their own money to spending the bank's, which costs
     * interest every year afterwards and is the first step toward insolvency.
     * It is a change in kind, not in degree, so it gets said out loud.
     */
    const drawn = Math.round(money.spend + money.fixed - company.cash);
    warnings.push(
      `This costs more than the ${Math.round(company.cash).toLocaleString()} in the bank. About ${drawn.toLocaleString()} of it comes out of the credit line, and carries interest every year until it is repaid.`,
    );
  }

  /*
   * Notes about seats that have not filed yet are noise on a screen where
   * people are still filing — of course the CFO hasn't decided, it is nine in
   * the morning. The engine's after-the-fact wording ("no finance decision was
   * made this year") is correct once the year has run and wrong before it, so
   * it is dropped here and the empty seats are shown as empty seats instead.
   */
  const notes = lock.notes.filter((n) => !/^No \w+ decision was made/.test(n));

  /*
   * The chief executive's split and the finance seat's hold-back, said before
   * the year rather than discovered in its report. The floor is left to the
   * warning above, which already says the same thing in money.
   */
  const funded = fundYear(company, sanitiseDecisions(decisions), niche, { costIndex: economy.costIndex } as any);
  for (const n of funded.notes) {
    if (/^(Finance held|There was only)/.test(n)) continue;
    warnings.push(n.replace(/^The chief executive's split gave/, "The chief executive's split gives").replace(/and its plan was cut to fit\./, "and its plan will be cut to fit.").replace(/^The chief financial officer held back/, "The chief financial officer is holding back"));
  }

  return { commitment: money, notes, warnings };
}

/** Which roles have filed, for the "who is still deciding" line. */
export const filedRoles = (decisions: TeamDecisions): Role[] =>
  (["ceo", "cmo", "cfo", "cto", "coo"] as Role[]).filter((r) => !!(decisions as any)[r]);


/**
 * A lever, said in this market's own words.
 *
 * The engine has one set of nouns for the things every market has, and it has
 * to: the arithmetic does not change between a restaurant and an MMO. What a
 * player reads should change, and until this existed it did not — a chain of
 * forty kitchens was asked to set its "Capacity", in units, and told that
 * customers above it would be "turned away".
 *
 * Only the labels and help move. The ids, the bounds and the steps are what
 * the engine and the validator agree on, and rewriting any of those per market
 * would be a way of quietly changing the game.
 *
 * Not every lever wants this. Borrowing is borrowing, and dressing it up in
 * trade idiom would make the one screen where precision matters harder to
 * read. The ones here are the ones whose engine word is genuinely the wrong
 * word on the ground.
 */
export function speak(field: LeverField, voice: NicheVoice): LeverField {
  const many = voice.customers;
  const one = voice.customer;
  const cap = voice.capacityShort;

  switch (field.id) {
    case "price":
      return {
        ...field,
        label: `Price ${voice.per}`,
        help: `What one ${one} pays ${voice.per}. Segments differ wildly in how much they care — some leave over a pound, others barely look.`,
      };
    case "capacityTarget":
      return {
        ...field,
        label: cap.charAt(0).toUpperCase() + cap.slice(1),
        help: `${voice.capacity.charAt(0).toUpperCase()}${voice.capacity.slice(1)} you build yourself; room your assets add comes on top. Win more than the two together and you get ${voice.turnedAway} — which costs reputation, not just revenue.`,
      };
    case "supportSpend":
      return { ...field, help: `${voice.service.charAt(0).toUpperCase()}${voice.service.slice(1)}. The segments that pay most are the ones that care about this most.` };
    case "featureSpend":
      return { ...field, help: `${voice.quality.charAt(0).toUpperCase()}${voice.quality.slice(1)}. Moves quality, and quality nobody has heard of moves nothing.` };
    case "brandSpend":
      return { ...field, help: `${voice.brand.charAt(0).toUpperCase()}${voice.brand.slice(1)}. Slow, compounding, and the thing that makes every other pound work harder.` };
    case "performanceSpend":
      return { ...field, help: `Buying ${many} now. Faster than brand and it stops the moment you stop paying.` };
    case "targetCities":
      return {
        ...field,
        label: `Which ${voice.places}`,
        help: `Only ${many} in a ${voice.place} you have opened can choose you, however good you are. Opening one costs money once and costs more to run for ever — spread faster than you can sell and you pay for reach you are not using.`,
      };
    default:
      return field;
  }
}
