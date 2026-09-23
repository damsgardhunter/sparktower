import type { PathTree, IntakeQuestion } from "./types";
import { FUNDING_PHASES } from "./fund";

const h = (n: number) => n * 60;

/**
 * Where someone stands with money, asked as ranges to tap. "$0" is a first-class
 * answer: a lot of people start there, and the plan that follows is built for
 * it rather than around it.
 */
/**
 * The milestone that asks them, named so the capital profile can find the
 * answers — see `capitalAnswersFor` in server/phase-trees.ts.
 */
export const MONEY_POSITION_MILESTONE = "SYS.F1.1";

export const MONEY_POSITION_QUESTIONS: IntakeQuestion[] = [
  {
    id: "cash", prompt: "How much could you put into this business today?",
    help: "Savings you could actually use. A range is plenty.",
    options: [
      { id: "zero", label: "$0 — starting from nothing" },
      { id: "under_5k", label: "Under $5k" },
      { id: "5k_25k", label: "$5k–$25k" },
      { id: "25k_100k", label: "$25k–$100k" },
      { id: "100k_250k", label: "$100k–$250k" },
      { id: "250k_plus", label: "$250k+" },
      { id: "unsure", label: "Not sure yet" },
    ],
  },
  {
    id: "monthly", prompt: "How much free money do you have each month after bills?",
    options: [
      { id: "none", label: "Nothing right now" },
      { id: "under_250", label: "Under $250" },
      { id: "250_1k", label: "$250–$1,000" },
      { id: "1k_3k", label: "$1,000–$3,000" },
      { id: "3k_plus", label: "$3,000+" },
    ],
  },
  {
    id: "credit", prompt: "Where's your credit score?",
    help: "Lenders look at this first. Not knowing is common — checking it is free.",
    options: [
      { id: "unknown", label: "Not sure / never checked" },
      { id: "under_580", label: "Below 580" },
      { id: "580_669", label: "580–669" },
      { id: "670_739", label: "670–739" },
      { id: "740_plus", label: "740+" },
    ],
  },
  {
    id: "situation", prompt: "Which is closest to what you're doing?",
    options: [
      { id: "starting", label: "Starting a new business" },
      { id: "buying", label: "Buying an existing business" },
      { id: "running", label: "Already running one" },
      { id: "undecided", label: "Haven't decided" },
    ],
  },
  {
    id: "experience", prompt: "How much experience do you have in this industry?",
    options: [
      { id: "none", label: "None yet" },
      { id: "under_2", label: "Under 2 years" },
      { id: "2_5", label: "2–5 years" },
      { id: "5_plus", label: "5+ years" },
      { id: "managed", label: "I've managed or owned one" },
    ],
  },
  {
    id: "assets", prompt: "Anything else that could back a loan?", multi: true, optional: true,
    options: [
      { id: "home_equity", label: "Home equity" },
      { id: "retirement", label: "Retirement savings (401k/IRA)" },
      { id: "equipment", label: "Equipment or vehicles I own" },
      { id: "partner", label: "A partner putting money in" },
      { id: "family", label: "Family who might help" },
    ],
  },
];

export const MONEY_TARGET_QUESTIONS: IntakeQuestion[] = [
  {
    id: "raise", prompt: "How much are you looking to raise?",
    help: "If you don't know, say so — Nova works it out from what the business costs to open.",
    options: [
      { id: "unknown", label: "I don't know — work it out for me" },
      { id: "under_50k", label: "Under $50k" },
      { id: "50k_150k", label: "$50k–$150k" },
      { id: "150k_500k", label: "$150k–$500k" },
      { id: "500k_1m", label: "$500k–$1M" },
      { id: "1m_plus", label: "$1M+" },
    ],
  },
  {
    id: "when", prompt: "When do you need the money?",
    options: [
      { id: "0_3", label: "In the next 3 months" },
      { id: "3_6", label: "3–6 months" },
      { id: "6_12", label: "6–12 months" },
      { id: "12_plus", label: "More than a year out" },
      { id: "unsure", label: "Not sure" },
    ],
  },
];

export const ROADMAP_LENGTH_QUESTIONS: IntakeQuestion[] = [
  {
    id: "horizon", prompt: "How far out should your roadmap go?",
    options: [
      { id: "90d", label: "90 days — the next moves, week by week" },
      { id: "1y", label: "1 year — to open and the first months, month by month" },
      { id: "3y", label: "3 years — to the business you want, quarter by quarter" },
    ],
  },
];

/**
 * Part 3 — Systemize a business.
 *
 * Money first. Starting or buying a business is mostly a money problem before
 * it's an operations one, so the path opens with four weeks that end in a
 * financing plan someone could act on — what it costs, what one sale earns,
 * how cash holds until profit, where the money comes from, what makes the
 * person financeable, and a roadmap at the length they pick. The operating
 * weeks follow. Evidence tier: no codebase to check.
 */
export const SYSTEMIZE_TREE: PathTree = {
  goal: "systemize_business",
  promise: "Get the money right first — how fundable you are, the route to the money, and the plan — then build a business that runs without you in every step",
  target: "3 weeks to your numbers, then your capital profile and funding route, a roadmap, and 4 weeks to owner-independence tested",
  defaultTier: "evidence",
  phases: [
    {
      id: "money-1", title: "Week 1 — Know your numbers",
      checkpoint: "By the end of this week: what it costs to open, what one sale earns, how long until it pays for itself, and the one set of numbers everything after this uses.",
      milestones: [
        { id: "SYS.F1.1", title: "Where you stand", actor: "user-decides", estimateMinutes: 5, tier: "claimed", work: "intake", intake: MONEY_POSITION_QUESTIONS,
          description: "Tap the ranges that fit — cash you could put in, free money each month, credit, and experience. There are no wrong answers and $0 is a real starting point; the whole plan is built from here." },
        { id: "SYS.F1.2", title: "How much you need", actor: "user-decides", estimateMinutes: 5, tier: "claimed", work: "intake", intake: MONEY_TARGET_QUESTIONS,
          description: "How much you're looking to raise and when. “I don't know” is fine — the next step works the number out." },
        { id: "SYS.F1.3", title: "Startup costs and the raise", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan", sharedId: "SH-04",
          description: "Nova builds the sources and uses: everything it costs to open or buy, with realistic ranges, plus the working capital to survive the first months — and the raise that covers it. If you didn't know how much to raise, this is where the number comes from; if you did, Nova checks it against the costs and says plainly if it's short.",
          variants: {
            restaurant: { description: "Build-out or renovation, kitchen equipment, furniture, POS, permits and licences (liquor if you'll serve it), deposits, opening inventory, pre-opening payroll and training, marketing, and 3–6 months of working capital — with the raise that covers it. If you didn't know how much to raise, this is where the number comes from." },
            service: { description: "Equipment and software, licences and insurance, a vehicle if the work needs one, first hires or contractors before revenue, marketing to land the first clients, and 3–6 months of working capital — with the raise that covers it. If you didn't know how much to raise, this is where the number comes from." },
            retail: { description: "Fit-out, fixtures, POS, opening inventory (usually the biggest line), deposits, signage, e-commerce, and 3–6 months of working capital — with the raise that covers it. If you didn't know how much to raise, this is where the number comes from." },
          } },
        { id: "SYS.F1.4", title: "Unit economics", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
          description: "What one sale earns after it's paid for, what the month costs to run, and the volume that breaks even — with the arithmetic shown, so you can change a number and see what moves.",
          variants: {
            restaurant: { description: "Average check, covers per day by daypart, food and beverage cost %, labour %, occupancy, prime cost, and the covers per day it takes to break even — against the benchmarks lenders use (prime cost around 60%, rent under about 10% of sales)." },
            service: { description: "Price per job or retainer, billable hours and utilisation, delivery cost, gross margin per client, overhead, and the client count that breaks even." },
            retail: { description: "Average order value, gross margin, inventory turns and sell-through, rent and staffing, and the sales per day that break even." },
          } },
        { id: "SYS.F1.5", title: "Cash flow before profit", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
          description: "Month by month from signing to profit: the ramp-up, the months that lose money, the lowest the bank balance gets, and how each month is covered before the business pays for itself — reserves, deferred owner pay, a line of credit, presales or keeping other income. A business can be profitable on paper and still run out of cash; this is the part that stops that." },
        { id: "SYS.F1.6", title: "Lock the base case", actor: "user-decides", estimateMinutes: 10, tier: "artifact",
          description: "Nova lays out three versions of the numbers — cautious, likely and stretch — each with its raise, break-even month and lowest cash point. You pick the one to plan on. Every step after this uses it." },
      ],
    },
    {
      id: "money-2", title: "Week 2 — Where the money comes from",
      checkpoint: "Every realistic source of money for your situation, what each asks of you, and how much of the raise each could cover.",
      milestones: [
        { id: "SYS.F2.1", title: "Your equity", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
          description: "How much of your own money lenders and investors will expect in (often 10–30% of the total for a loan), measured against what you said you have. What counts toward it — cash, gifted funds with a gift letter, a retirement rollover, a partner's cash, equipment you own — and, if you're short or starting from zero, the size of the gap and the realistic ways to close it." },
        { id: "SYS.F2.2", title: "SBA loan readiness", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
          description: "Which SBA programmes fit — 7(a), 504, Microloan — and a checklist of what lenders look for against your answers: credit, equity in, industry experience, collateral, a personal guarantee, a business plan with projections, and cash flow that covers the payments. Each item marked met, not yet, or unknown, with what to do about the ones that aren't. Lenders differ; Nova names which to talk to." },
        { id: "SYS.F2.3", title: "Seller financing", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
          description: "Money from the other side of the deal. Buying: how a seller note works, what share of the price sellers commonly carry, how it sits alongside an SBA loan, and how to ask. Starting new: the same idea from landlords (build-out allowances, free rent), equipment vendors and leasing, franchisors, and supplier terms.",
          variants: {
            restaurant: { description: "Buying: how a seller note works, what share of the price sellers commonly carry, how it sits alongside an SBA loan, and how to ask. Starting new: landlord build-out allowances and free-rent months, kitchen equipment leasing, and food distributor terms — often worth more than people expect." },
          } },
        { id: "SYS.F2.4", title: "Investor structure", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
          description: "If loans and your own money don't cover the raise, how outside money comes in without costing you the business: friends-and-family loans, a silent partner, profit-share with a preferred return and a buyback, revenue-based financing — what each costs in ownership and control, and the structure that fits your gap. Nova flags where securities rules apply; an attorney papers the final version." },
      ],
    },
    {
      id: "money-3", title: "Week 3 — Become financeable",
      checkpoint: "Every gap in the plan named, and a dated plan that closes each one.",
      milestones: [
        { id: "SYS.F3.1", title: "Gap scan", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
          description: "Nova reads everything so far the way a lender or investor would and lists every weakness — credit, cash for equity, experience, collateral, numbers still guessed instead of quoted, holes in the plan — ranked by how much each one blocks the money." },
        { id: "SYS.F3.2", title: "Financeability plan", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
          description: "A dated action plan that closes each gap, built for where you actually are. Starting from zero or low credit, that means real steps with timelines: pulling and fixing your credit reports, a savings target from your monthly free money, getting experience in the industry, building a relationship with a lender, and starting smaller to prove demand. Every action says what it moves and when to re-check. Add them to your tasks and Nova tracks them with you.",
          variants: {
            restaurant: { description: "A dated action plan that closes each gap, built for where you actually are. Starting from zero or low credit: fixing credit, a savings target, working in or managing a kitchen, building a lender relationship, and proving demand smaller first — pop-ups, a food truck, catering, a shared or ghost kitchen. Every action says what it moves and when to re-check. Add them to your tasks and Nova tracks them with you." },
          } },
        { id: "SYS.F3.3", title: "Deal structure", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
          description: "The target structure, built out. Buying: a price range from the business's earnings, sources and uses, how the loan, seller note and your equity stack, the monthly payments, and whether cash flow covers them with room to spare. Starting new: which source pays for which cost, the payments the unit economics can carry, and the structure that closes the raise." },
      ],
    },
    /*
     * Where the funding path used to be. The scored capital profile tells a
     * person how fundable they are and exactly what raises it; the map lays
     * out every way the money could come; the route they pick unlocks its own
     * four-phase roadmap. Then the roadmap week turns all of it into dates.
     */
    ...FUNDING_PHASES,

    {
      id: "money-4", title: "Week 4 — Your roadmap",
      checkpoint: "A roadmap at the length you chose, and the first step on it done.",
      milestones: [
        { id: "SYS.F4.1", title: "Pick your roadmap", actor: "user-decides", estimateMinutes: 2, tier: "claimed", work: "intake", intake: ROADMAP_LENGTH_QUESTIONS,
          description: "90 days, 1 year or 3 years. Short keeps it concrete; long shows how today's steps add up." },
        { id: "SYS.F4.2", title: "Your money roadmap", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
          description: "Built from everything above, at the length you picked: by week for 90 days, by month for a year, by quarter for three. Each stretch has what gets done, the money milestone it reaches (a credit score, a savings balance, an application in, a lease signed, open), and how you'll know. Add it to your tasks." },
        { id: "SYS.F4.3", title: "Take the first step", actor: "user-does", estimateMinutes: 30, tier: "claimed",
          description: "The first action on your roadmap, done by you this week — pull your credit report, open the savings account, book the lender call, walk the space. Small and real beats big and planned." },
      ],
    },

    {
      id: "week-1", title: "Week 5 — See it clearly",
      milestones: [
        { id: "SYS.M1.1", title: "Time capture", actor: "user-does", estimateMinutes: 10, tier: "claimed",
          description: "Nova asks you once a day what took your time and categorizes the answer. Deliberately tiny — a full time audit is the kind of homework that ends a path in week one." },
        { id: "SYS.M1.2", title: "Only-me list", actor: "nova-drafts", estimateMinutes: 20, tier: "artifact",
          description: "Generated from the time log: every task that currently requires you. You correct it.",
          variants: {
            restaurant: { description: "Expect open/close, ordering, scheduling, recipe consistency, vendor calls." },
            service: { description: "Expect scoping, client comms, delivery, invoicing." },
            retail: { description: "Expect buying, merchandising, inventory, staffing." },
          } },
        { id: "SYS.M1.3", title: "Financial baseline", actor: "nova-drafts", estimateMinutes: 30, tier: "artifact",
          description: "Once it's trading: connect an account or upload statements, and Nova reads them against the numbers you planned on in week 1. No manual entry.",
          supersedes: ["Connect an account or upload statements; Nova reads and summarizes. No manual entry."] },
        { id: "SYS.M1.4", title: "Bottleneck ranking", actor: "nova-drafts", estimateMinutes: 15, tier: "artifact",
          description: "Which only-me task costs the most, with the arithmetic shown — hours times your effective rate, plus what it blocks." },
        { id: "SYS.M1.5", title: "Pick the first three", actor: "user-decides", estimateMinutes: 10, tier: "artifact",
          description: "The three to systemize this month." },
      ],
    },
    {
      id: "week-2", title: "Week 6 — Write it down",
      milestones: [
        { id: "SYS.M2.1", title: "Delivery SOP", actor: "nova-drafts", estimateMinutes: h(1), tier: "artifact",
          description: "Nova interviews you conversationally, then writes the document. This is the week that would otherwise never happen, because nobody writes their own SOPs.",
          variants: {
            restaurant: { description: "Prep, service, close. Recipes as specs with quantities and timings." },
            service: { description: "Intake through delivery through handoff." },
            retail: { description: "Open, floor, restock, close, cash handling." },
          } },
        { id: "SYS.M2.2", title: "Intake and sales SOP", actor: "nova-drafts", estimateMinutes: h(1), tier: "artifact", description: "How work comes in and how it's sold." },
        { id: "SYS.M2.3", title: "Onboarding SOP", actor: "nova-drafts", estimateMinutes: 45, tier: "artifact",
          description: "What happens after someone buys, or after a new staff member starts." },
        { id: "SYS.M2.4", title: "SOP test", actor: "user-does", estimateMinutes: h(1), tier: "evidence",
          description: "Someone else follows one unaided while you watch. Every question they have to ask is a gap." },
        { id: "SYS.M2.5", title: "Close the gaps", actor: "nova-drafts", estimateMinutes: 30, tier: "artifact", description: "From the test." },
      ],
    },
    {
      id: "week-3", title: "Week 7 — Instrument and delegate",
      milestones: [
        { id: "SYS.M3.1", title: "Operating metrics", actor: "nova-drafts", estimateMinutes: 20, tier: "artifact", sharedId: "SH-03",
          description: "Nova proposes the three to five numbers that matter for this shape of business.",
          variants: {
            restaurant: { description: "Covers, average check, food cost %, labor %." },
            service: { description: "Utilization, realized rate, pipeline, repeat rate." },
            retail: { description: "Units per transaction, margin, sell-through, shrink." },
          } },
        { id: "SYS.M3.2", title: "Where each number comes from", actor: "nova-drafts", estimateMinutes: 20, tier: "artifact",
          description: "Source mapping. Nova pulls what it can automatically." },
        { id: "SYS.M3.3", title: "Dashboard", actor: "nova-builds", estimateMinutes: h(1), tier: "artifact", description: "The metrics, live." },
        { id: "SYS.M3.4", title: "Review cadence", actor: "user-does", estimateMinutes: 5, tier: "claimed",
          description: "A recurring slot that exists in your calendar." },
        { id: "SYS.M3.5", title: "Role definition", actor: "nova-drafts", estimateMinutes: 30, tier: "artifact",
          description: "Built from the only-me list. What this person owns, what they decide, what escalates." },
        { id: "SYS.M3.6", title: "Hire, contract, or automate", actor: "user-decides", estimateMinutes: 20, tier: "artifact",
          description: "Nova costs all three against the bottleneck ranking." },
        { id: "SYS.M3.7", title: "Job post or automation spec", actor: "nova-drafts", estimateMinutes: 30, tier: "artifact", description: "Whichever you chose." },
        { id: "SYS.M3.8", title: "First handoff", actor: "user-does", estimateMinutes: null, tier: "evidence",
          description: "One process handed to one person, SOP attached, by you." },
      ],
    },
    {
      id: "week-4", title: "Week 8 — Remove the owner",
      milestones: [
        { id: "SYS.M4.1", title: "Automate the top two repetitive tasks", actor: "nova-builds", estimateMinutes: h(3), tier: "artifact",
          description: "The two that cost the most.",
          variants: {
            restaurant: { description: "Ordering triggers, scheduling, prep lists." },
            service: { description: "Proposals, invoicing, follow-up sequences." },
            retail: { description: "Reorder points, stock alerts." },
          } },
        { id: "SYS.M4.2", title: "Runbook for when automation breaks", actor: "nova-drafts", estimateMinutes: 30, tier: "artifact", description: "Because it will." },
        { id: "SYS.M4.3", title: "Pricing review", actor: "nova-drafts", estimateMinutes: 30, tier: "artifact", sharedId: "SH-02",
          description: "Systemizing usually surfaces that pricing hasn't moved in years." },
        { id: "SYS.M4.4", title: "Absence test", actor: "user-does", estimateMinutes: null, tier: "evidence",
          description: "You leave. Three days minimum, shortened from two weeks to fit the month. The three-day version is a first proof, not the finish line; the full test is a follow-on." },
        { id: "SYS.M4.5", title: "Gap list and fixes", actor: "nova-drafts", estimateMinutes: h(1), tier: "artifact", description: "What broke while you were out." },
        { id: "SYS.M4.6", title: "What's next", actor: "user-decides", estimateMinutes: 10, tier: "artifact",
          description: "Deeper systemizing, or Fund it to finance growth." },
      ],
    },
  ],
};
