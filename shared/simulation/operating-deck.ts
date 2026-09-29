/**
 * Where money goes in a business that already exists.
 *
 * The ten-year outlook asks an owner what they would do with a sum of money
 * and a year, and then says where that leaves them. It was asking with the
 * sprint game's deck — the one written for five strangers inventing a software
 * company in an afternoon. So the owner of two coffee shops, whose numbers the
 * page had just read off their own check-ins, was offered "a senior engineer",
 * "two juniors", "a designer" and "building the product", and told that the
 * salesperson was "useless if the product isn't ready for them to sell".
 *
 * Every line here is something a real operating business can actually buy, and
 * carries what not funding it costs, in the same spirit as the sprint deck:
 * a budget screen where every choice sounds good is a slot machine.
 *
 * ## The money is theirs, not a round number
 *
 * The sprint hands everybody the same imaginary million, which is right for a
 * game where the point is that five people argue about the same budget. It is
 * wrong here. A café turning over £430,000 will never be handed a million
 * dollars, and being asked to spend one teaches them nothing about their
 * business; it teaches them about somebody else's. `budgetFor` scales the
 * question to what the business could plausibly put to work in a year.
 *
 * ## `runway` keeps its id
 *
 * Leaving money in the bank is a real answer and the budget maths knows that
 * line by name (`summariseBudget` counts everything else as deployed). The
 * label is written for an owner rather than a founder; the id is the contract.
 */
import type { SpendOption } from "../sprints/cards";
import type { SpendDeck } from "../sprints/budget";

export const OPERATING_OPTIONS: SpendOption[] = [
  // ─── People ───────────────────────────────────────────────────────────────
  {
    id: "manager", label: "A manager who can run it without you", group: "People",
    detail: "Someone who does the rotas, the ordering and the day-to-day decisions you make now.",
    consequence: "The only line here that buys back your own week. Costs real money before it saves you anything, and takes months before they are trusted with the parts that matter.",
    step: 2_500, minimumUseful: 30_000,
  },
  {
    id: "more-hands", label: "More people on the floor", group: "People",
    detail: "Front-line staff — serving, making, delivering, whatever the business actually does.",
    consequence: "Raises what you can handle at once, and shows up in the wage bill from week one whether the extra trade arrives or not.",
    step: 2_500, minimumUseful: 15_000,
  },
  {
    id: "someone-selling", label: "Someone whose job is bringing work in", group: "People",
    detail: "Sales, business development, accounts — one person responsible for where next month's revenue comes from.",
    consequence: "The line most likely to pay for itself, and the one most likely to be judged too early. Give it two quarters or don't fund it.",
    step: 2_500, minimumUseful: 25_000,
  },
  {
    id: "back-office", label: "Bookkeeping and admin off your desk", group: "People",
    detail: "A bookkeeper, a VA, a payroll service — the evening work.",
    consequence: "Cheap, unglamorous, and the reason owners stop working Sundays. Buys no revenue at all.",
    step: 1_000, minimumUseful: 6_000,
  },

  // ─── Places and kit ───────────────────────────────────────────────────────
  {
    id: "another-site", label: "Another site", group: "Places and kit",
    detail: "A second (or third) location: the lease, the fit-out, the opening stock.",
    consequence: "The biggest number on this page and the one that most often takes the business with it. Nothing else here can lose you the company; this can.",
    step: 10_000, minimumUseful: 40_000,
  },
  {
    id: "fix-the-place", label: "Fixing the place you have", group: "Places and kit",
    detail: "Refit, repair, more seats, a better layout — the site you already pay rent on.",
    consequence: "Less exciting than a new site and usually a better return per pound. Closes you for a while.",
    step: 2_500, minimumUseful: 10_000,
  },
  {
    id: "kit", label: "Equipment that raises what you can make", group: "Places and kit",
    detail: "The machine, the oven, the van, the second line — capacity you do not currently have.",
    consequence: "Worth it only if you are turning work away. If you are not at capacity, this buys a bigger idle business.",
    step: 2_500, minimumUseful: 10_000,
  },

  // ─── Getting customers ────────────────────────────────────────────────────
  {
    id: "local-marketing", label: "Getting known locally", group: "Getting customers",
    detail: "Signage, local press, sponsorship, paid social, the things that reach people within a few miles.",
    consequence: "The first few thousand buys far more than the fifth. Easy to keep funding long after it has stopped working.",
    step: 1_000, minimumUseful: 5_000,
  },
  {
    id: "come-back", label: "Making people come back", group: "Getting customers",
    detail: "Loyalty, bookings, a list you can email, the reasons a customer is a customer twice.",
    consequence: "Cheaper than finding new people and slower to show. The line that decides whether growth compounds or leaks.",
    step: 1_000, minimumUseful: 4_000,
  },
  {
    id: "bigger-customers", label: "Going after bigger customers", group: "Getting customers",
    detail: "Wholesale, contracts, trade accounts — fewer customers, larger orders, longer payment terms.",
    consequence: "Changes what the business is. Steadier revenue, worse cash flow, and one customer who can hurt you by leaving.",
    step: 2_500, minimumUseful: 15_000,
  },

  // ─── Keeping it standing ──────────────────────────────────────────────────
  {
    id: "pay-down-debt", label: "Paying down what you owe", group: "Keeping it standing",
    detail: "Clearing loans, finance agreements and the expensive borrowing first.",
    consequence: "Buys nothing and earns its keep anyway: every pound off the balance is interest you stop paying and room you get back.",
    step: 2_500, minimumUseful: 5_000,
  },
  {
    id: "systems", label: "Systems that run without you", group: "Keeping it standing",
    detail: "Software, process, the written-down way of doing it — stock, rotas, invoicing, handover.",
    consequence: "The unglamorous half of a business that runs itself. Nobody notices it working; everybody notices its absence.",
    step: 1_000, minimumUseful: 4_000,
  },
  {
    id: "runway", label: "Leave it in the bank", group: "Keeping it standing",
    detail: "Money that does nothing until you need it.",
    consequence: "Not a wasted line. It is the difference between a bad quarter and a closed business, and the only thing on this page that is worth more the worse things get.",
    step: 2_500, minimumUseful: 0,
  },
];

/**
 * The same question, for a business with no premises and no van.
 *
 * `OPERATING_OPTIONS` was written for a business you can stand in: more people
 * on the floor, another site, equipment that raises what you can make, getting
 * known within a few miles. That is the right deck for a café, a garage or a
 * shop, and it is the wrong one for a web app sold to the whole world — which
 * is the same mistake, pointed the other way, that the comment at the top of
 * this file was written about. A one-person SaaS with 200,000 possible
 * customers and no floor was being asked how much to spend on front-line staff
 * serving and delivering, and offered "reach people within a few miles" as its
 * only way of finding customers.
 *
 * Ids are shared with the deck above wherever the line genuinely is the same
 * thing (`someone-selling`, `back-office`, `come-back`, `bigger-customers`,
 * `pay-down-debt`, `systems`, `runway`), so an allocation keeps its meaning if
 * a project is reclassified. `runway` keeps its id for the reason given above:
 * `summariseBudget` counts everything else as deployed.
 */
export const SOFTWARE_OPTIONS: SpendOption[] = [
  // ─── People ───────────────────────────────────────────────────────────────
  {
    id: "someone-building", label: "Another pair of hands on the product", group: "People",
    detail: "An engineer, a designer — someone who makes the thing you sell.",
    consequence: "The line founders fund first and the one that most often makes the product later rather than sooner: a new person costs you a month of your own before they give one back.",
    step: 2_500, minimumUseful: 30_000,
  },
  {
    id: "someone-selling", label: "Someone whose job is bringing work in", group: "People",
    detail: "Sales, partnerships, outbound — one person responsible for where next month's customers come from.",
    consequence: "The line most likely to pay for itself, and the one most likely to be judged too early. Give it two quarters or don't fund it.",
    step: 2_500, minimumUseful: 25_000,
  },
  {
    id: "support", label: "Someone answering customers", group: "People",
    detail: "Support, onboarding, the inbox — the person who replies when it breaks or confuses somebody.",
    consequence: "Buys no new customers and keeps the ones you have. The cheapest thing on this page that moves churn, and the first thing a founder wrongly keeps doing themselves.",
    step: 1_000, minimumUseful: 12_000,
  },
  {
    id: "back-office", label: "Bookkeeping and admin off your desk", group: "People",
    detail: "A bookkeeper, a VA, a payroll service — the evening work.",
    consequence: "Cheap, unglamorous, and the reason owners stop working Sundays. Buys no revenue at all.",
    step: 1_000, minimumUseful: 6_000,
  },

  // ─── The product ──────────────────────────────────────────────────────────
  {
    id: "next-thing", label: "Building the next thing", group: "The product",
    detail: "A second product, or a version large enough to sell to people who say no to this one.",
    consequence: "The biggest number on this page and the one most often funded out of boredom with the thing that works. Nothing else here can cost you the business; a year spent on the wrong second product can.",
    step: 10_000, minimumUseful: 40_000,
  },
  {
    id: "reliability", label: "Making it stop breaking", group: "The product",
    detail: "The tests, the monitoring, the rewrite of the part everybody is afraid of.",
    consequence: "Invisible when it works. Deferred long enough it stops being a choice and becomes the only thing anyone is doing.",
    step: 2_500, minimumUseful: 10_000,
  },
  {
    id: "infrastructure", label: "Room to take the load", group: "The product",
    detail: "Hosting, capacity, the parts of the bill that grow with customers.",
    consequence: "Worth it only if the load is actually coming. Bought early, it is a bigger idle bill every month.",
    step: 1_000, minimumUseful: 4_000,
  },

  // ─── Getting customers ────────────────────────────────────────────────────
  {
    id: "getting-found", label: "Getting found", group: "Getting customers",
    detail: "Ads, content, launches, the places this kind of buyer already looks.",
    consequence: "The first few thousand buys far more than the fifth. Easy to keep funding long after it has stopped working — the number to watch is what one customer costs, not how many came.",
    step: 1_000, minimumUseful: 5_000,
  },
  {
    id: "come-back", label: "Making people stay", group: "Getting customers",
    detail: "Onboarding, the first week, the reasons somebody is still paying in month six.",
    consequence: "Cheaper than finding new people and slower to show. The line that decides whether growth compounds or leaks — at 5% leaving a month you replace your whole customer base every twenty months.",
    step: 1_000, minimumUseful: 4_000,
  },
  {
    id: "bigger-customers", label: "Going after bigger customers", group: "Getting customers",
    detail: "Larger accounts, annual contracts, the security review and the invoice terms that come with them.",
    consequence: "Changes what the business is. Steadier revenue, worse cash flow, and one customer who can hurt you by leaving.",
    step: 2_500, minimumUseful: 15_000,
  },

  // ─── Keeping it standing ──────────────────────────────────────────────────
  {
    id: "pay-down-debt", label: "Paying down what you owe", group: "Keeping it standing",
    detail: "Clearing loans, finance agreements and the expensive borrowing first.",
    consequence: "Buys nothing and earns its keep anyway: every pound off the balance is interest you stop paying and room you get back.",
    step: 2_500, minimumUseful: 5_000,
  },
  {
    id: "systems", label: "Systems that run without you", group: "Keeping it standing",
    detail: "Billing, provisioning, the written-down way of doing it — the work that happens whether or not you are at the desk.",
    consequence: "The unglamorous half of a business that runs itself. Nobody notices it working; everybody notices its absence.",
    step: 1_000, minimumUseful: 4_000,
  },
  {
    id: "runway", label: "Leave it in the bank", group: "Keeping it standing",
    detail: "Money that does nothing until you need it.",
    consequence: "Not a wasted line. It is the difference between a bad quarter and a closed business, and the only thing on this page that is worth more the worse things get.",
    step: 2_500, minimumUseful: 0,
  },
];

/** The smallest and largest sums this exercise will ever ask about. */
const FLOOR = 50_000;
const CEILING = 1_000_000;

/**
 * What to hand this business for the year.
 *
 * One year's revenue, rounded to something a person would say out loud. It is
 * a stretch — most businesses cannot raise a year's turnover — and that is the
 * point: the question is meant to be bigger than the next decision, and small
 * enough that the answer is about this business rather than a fantasy. Clamped
 * at both ends so a business with no numbers still gets a sensible question and
 * a large one doesn't get an amount nobody can reason about.
 */
export function budgetFor(monthlyRevenue: number): number {
  const year = Math.max(0, Math.round(monthlyRevenue)) * 12;
  /*
   * Nothing coming in yet. The floor, not the ceiling — this used to hand a
   * founder with no revenue, no savings and an idea the full million, which is
   * the fantasy this function exists to stop. What somebody starting from
   * nothing needs to think about is the small sum they might actually scrape
   * together, and every answer they give against it is a real decision.
   */
  if (!year) return FLOOR;
  const clamped = Math.min(CEILING, Math.max(FLOOR, year));
  // To 2 significant figures: 429,600 → 430,000; 1,240 → 1,200.
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(clamped)) - 1);
  return Math.round(clamped / magnitude) * magnitude;
}

/**
 * The deck this business is actually offered.
 *
 * `software` picks between a business with a floor and one without; see
 * `SOFTWARE_OPTIONS`. It defaults to the premises deck because that is the one
 * every caller got before there was a choice, and because being offered a van
 * you do not need is a smaller wrong than being offered nothing you recognise.
 */
export const operatingDeck = (monthlyRevenue: number, software = false): SpendDeck => ({
  options: software ? SOFTWARE_OPTIONS : OPERATING_OPTIONS,
  total: budgetFor(monthlyRevenue),
});
