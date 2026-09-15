import type { PathTree, BackbonePhase } from "./types";
import {
  OWNERSHIP_GOAL_QUESTIONS, MONEY_TODAY_QUESTIONS, EXPERIENCE_QUESTIONS, BUSINESS_HISTORY_QUESTIONS,
  CAPITAL_GOAL_QUESTIONS, ROUTE_CHOICE_QUESTIONS,
} from "../capital";

const h = (n: number) => n * 60;

/**
 * Part 4 — Raise funding.
 *
 * Two weeks that everyone walks — who they are to a funder (the capital
 * profile and its score) and every way the money could come (the capital
 * map) — then a route they choose: debt, seller financing, investors, a
 * hybrid, or self-funding. Only the chosen route's phases appear, and each is
 * a real roadmap: four phases from where the person stands today to money in
 * the bank, built to take the weeks it actually takes.
 *
 * The milestones that put someone in front of funders are marked `inMarket`;
 * once one is done the dashboard switches to pipeline mode, because outcomes
 * depend on other people from there.
 */

const PROFILE: BackbonePhase = {
  id: "capital-1", title: "Week 1 — Your capital profile",
  checkpoint: "Who you are to a funder today, as a score you can watch move, and exactly what raises it.",
  milestones: [
    { id: "FUND.C1.1", title: "Why you want to own a business", actor: "user-decides", estimateMinutes: 3, tier: "claimed", work: "intake", intake: OWNERSHIP_GOAL_QUESTIONS,
      description: "Tap what's true. What you want from owning it — income, wealth, freedom, a sale one day — decides which money fits: an investor wants an exit, a lender wants steady cash flow, and self-funding wants patience." },
    { id: "FUND.C1.2", title: "Your money today", actor: "user-decides", estimateMinutes: 4, tier: "claimed", work: "intake", intake: MONEY_TODAY_QUESTIONS,
      description: "Cash you could put in, credit, income, debt payments and what you own — as ranges. It's the first thing every funder looks at, and $0 or low credit is a starting point the plan is built for, not a dead end." },
    { id: "FUND.C1.3", title: "Your experience", actor: "user-decides", estimateMinutes: 3, tier: "claimed", work: "intake", intake: EXPERIENCE_QUESTIONS,
      description: "Time in the industry you're going into, the most senior role you've held, people you've managed, and whether you've owned a budget. Lenders and investors weigh this almost as heavily as money." },
    { id: "FUND.C1.4", title: "Your business history", actor: "user-decides", estimateMinutes: 5, tier: "claimed", work: "intake", intake: BUSINESS_HISTORY_QUESTIONS, prefill: "resume",
      description: "Whether you've owned a business before and, if you have, how it went — what it did, how long, revenue, profit, people, customers, what it owned and where it is now. If your résumé is on your profile, Nova fills in what it shows for you to check." },
    { id: "FUND.C1.5", title: "Your capital goal", actor: "user-decides", estimateMinutes: 4, tier: "claimed", work: "intake", intake: CAPITAL_GOAL_QUESTIONS,
      description: "How much you need (or “work it out”), what it buys, when, and your lines in the sand: equity you'd give up, debt you'd take, and how much of the business you want to keep." },
    { id: "FUND.C1.6", title: "Your capital profile", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan", sharedId: "SH-04",
      description: "Your fundability score, part by part — cash for the raise, credit, income against debt, assets, experience, track record, and how clear the ask is — and Nova's read of it the way a lender and an investor would each see it: what's strong, what's holding it back, and the specific moves that raise it most, in order." },
  ],
};

const MAP: BackbonePhase = {
  id: "capital-2", title: "Week 2 — Your capital map",
  checkpoint: "Every route to the money, how well each fits you today, and the one you're taking.",
  milestones: [
    { id: "FUND.C2.1", title: "Your capital map", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
      description: "Every way the money could come, measured against your profile: debt, seller financing, investors, a hybrid stack, and self-funding. For each — how much it could realistically cover, what it costs you (interest, equity, control, time), what it asks of you, how well it fits today, and what would change the fit. If you didn't know how much you need, the number is worked out here." },
    { id: "FUND.C2.2", title: "Choose your route", actor: "user-decides", estimateMinutes: 5, tier: "claimed", work: "intake", intake: ROUTE_CHOICE_QUESTIONS, routeQuestion: "route",
      description: "Pick the route to build out. Its roadmap appears as soon as you choose, starting from where you stand today. You can switch later — anything you'd done on a route comes back if you return to it." },
  ],
};

// ---------------------------------------------------------------- debt

const DEBT: BackbonePhase[] = [
  {
    id: "debt-1", route: "debt", title: "Debt — Get lender-ready",
    checkpoint: "A credit, cash and paperwork position a lender can say yes to.",
    milestones: [
      { id: "FUND.D1.1", title: "Credit plan", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "Where your credit needs to be for the loans that fit you, and a dated plan to get it there: pulling all three reports, disputing errors, utilisation targets per card, what to pay first, what not to do while you apply, and the score you should see by when." },
      { id: "FUND.D1.2", title: "Personal financial statement", actor: "nova-drafts", estimateMinutes: 45, tier: "artifact",
        description: "Nova drafts the personal financial statement every lender asks for (the SBA's is Form 413) from your capital profile — assets, liabilities, income, contingent liabilities — with the gaps marked for you to fill in exact figures." },
      { id: "FUND.D1.3", title: "Your equity injection", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "How much of your own money the loan will need in (often 10–20% of the project, more for a start-up), what counts toward it — savings, gifted funds with a gift letter, a partner, a seller note on full standby, a retirement rollover — how to document each so it's accepted, and a savings plan if you're short." },
      { id: "FUND.D1.4", title: "Collateral and guarantees", actor: "nova-builds", estimateMinutes: 20, tier: "artifact", work: "plan",
        description: "What a lender will take as security from what you own and what the loan buys, how personal guarantees work for owners, what happens to your home if it's pledged, and how to limit your exposure." },
      { id: "FUND.D1.5", title: "Gather the documents", actor: "user-does", estimateMinutes: h(3), tier: "evidence",
        description: "You pull together what only you can get: three years of personal tax returns, recent bank and brokerage statements, ID, your résumé, any business returns and licences. Nova's checklist says exactly which, and where each comes from." },
    ],
  },
  {
    id: "debt-2", route: "debt", title: "Debt — Pick the right loan",
    checkpoint: "The loan type, size and payment your business can actually carry.",
    milestones: [
      { id: "FUND.D2.1", title: "Loan options", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
        description: "Every loan that could fit your raise, compared: SBA 7(a), SBA 504, SBA Microloan, CDFI loans, bank term loans, equipment financing, a line of credit, and USDA or state programmes where they apply — typical amounts, rates, terms, down payment, collateral, time to fund, and whether you'd qualify today." },
      { id: "FUND.D2.2", title: "Size the loan", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
        description: "The monthly payment at realistic rates and terms, the cash flow the business needs to cover it with room to spare (lenders look for about 1.25× coverage), and the largest loan your numbers support — so you ask for an amount that gets approved." },
      { id: "FUND.D2.3", title: "Choose the loan", actor: "user-decides", estimateMinutes: 15, tier: "artifact",
        description: "Nova lays out the two or three loan structures that fit, each with its payment, what you put in, and what it asks of you. You pick the one to apply for." },
    ],
  },
  {
    id: "debt-3", route: "debt", title: "Debt — Build the loan package",
    checkpoint: "A complete package a loan officer can take to credit committee.",
    milestones: [
      { id: "FUND.D3.1", title: "Business plan", actor: "nova-builds", estimateMinutes: h(2), tier: "artifact", work: "plan",
        description: "The plan a lender reads: the business, the market and competition, how it makes money, the management team, the operating plan, and the risks with how you'll handle them — written from your profile and grounded in your numbers." },
      { id: "FUND.D3.2", title: "Financial projections", actor: "nova-builds", estimateMinutes: h(2), tier: "artifact", work: "plan",
        description: "Three years of projections, month by month for the first year: revenue build, costs, the loan payment, cash flow and debt-service coverage — with every assumption stated, and a cautious case beside the likely one." },
      { id: "FUND.D3.3", title: "Sources and uses", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "Where every dollar comes from and where it goes, to the line: the loan, your injection and anything else, against each cost. Lenders check this adds up before they read anything else." },
      { id: "FUND.D3.4", title: "Loan request summary", actor: "nova-drafts", estimateMinutes: 30, tier: "artifact",
        description: "The one-page request that opens the package: how much, for what, the term, how it's repaid, the collateral, your injection, and why you." },
    ],
  },
  {
    id: "debt-4", route: "debt", title: "Debt — Apply and close",
    checkpoint: "In front of lenders, offers compared, and the loan closed.",
    milestones: [
      { id: "FUND.D4.1", title: "Lender list", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
        description: "Eight to twelve lenders to approach, in order: SBA preferred lenders active in your industry, local banks and credit unions, and CDFIs if your credit or cash is thin — each with why they fit and who to ask for." },
      { id: "FUND.D4.2", title: "Lender outreach", actor: "nova-drafts", estimateMinutes: 30, tier: "artifact",
        description: "The first email and the call script, written for your loan and your story, with the follow-up." },
      { id: "FUND.D4.3", title: "Apply", actor: "user-does", estimateMinutes: h(4), tier: "claimed", inMarket: true,
        description: "You send the package to your first three lenders and take the calls. Nova keeps the log: who, when, what they asked for, and what's next." },
      { id: "FUND.D4.4", title: "Compare the offers", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "Term sheets side by side: rate, fees, term, payment, collateral, guarantees, covenants, prepayment penalties — the true cost of each and the terms worth negotiating." },
      { id: "FUND.D4.5", title: "Close the loan", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "Everything between approval and money in the account: conditions to clear, insurance, entity and lease paperwork, the closing documents to have an attorney read, and the first payment date." },
    ],
  },
];

// -------------------------------------------------------------- seller

const SELLER: BackbonePhase[] = [
  {
    id: "seller-1", route: "seller", title: "Seller — Find the right business",
    checkpoint: "Clear criteria and a pipeline of real businesses to look at.",
    milestones: [
      { id: "FUND.S1.1", title: "Acquisition criteria", actor: "nova-drafts", estimateMinutes: 30, tier: "artifact",
        description: "What you're buying, written down: industry, location, size by earnings, price range from what you can finance, owner involvement, and the deal-breakers. Nova drafts three versions — cautious, balanced, ambitious — from your profile." },
      { id: "FUND.S1.2", title: "Deal sourcing plan", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
        description: "Where the businesses are: brokers in your area and industry, listing sites, direct letters to owners nearing retirement, accountants and attorneys who hear first, industry associations — with weekly targets for each." },
      { id: "FUND.S1.3", title: "Letter to owners", actor: "nova-drafts", estimateMinutes: 20, tier: "artifact",
        description: "The direct letter to owners who haven't listed: who you are, why their business, and that you'd consider a seller-financed deal that pays them over time." },
      { id: "FUND.S1.4", title: "Screen the first ten", actor: "user-does", estimateMinutes: h(4), tier: "claimed",
        description: "You look at ten real listings or conversations with Nova's scorecard — earnings, owner dependence, customer concentration, lease, why they're selling — and shortlist the best two or three." },
    ],
  },
  {
    id: "seller-2", route: "seller", title: "Seller — Value it and check it",
    checkpoint: "What the business is really worth, and nothing hidden.",
    milestones: [
      { id: "FUND.S2.1", title: "Value the business", actor: "nova-builds", estimateMinutes: h(1), tier: "artifact", work: "plan",
        description: "Recast the owner's earnings (seller's discretionary earnings), apply the multiples businesses like it sell for, and set a price range — with what would push it up or down, and the most you should pay given what you can finance." },
      { id: "FUND.S2.2", title: "Due diligence list", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "Everything to ask for and check: three years of tax returns and financials, bank statements matched to reported sales, customer and supplier contracts, the lease, employees, licences, liabilities and litigation — with what each could reveal." },
      { id: "FUND.S2.3", title: "Red flags review", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "The deal-killers to look for in what the seller sends, and what each one does to the price, the structure, or whether to walk away." },
    ],
  },
  {
    id: "seller-3", route: "seller", title: "Seller — Structure the deal",
    checkpoint: "A deal the seller accepts and the business can pay for.",
    milestones: [
      { id: "FUND.S3.1", title: "Seller note terms", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
        description: "How much of the price to ask the seller to carry, at what rate and term, whether payments start at once or after a standby period, how it sits beside a bank or SBA loan, and what sellers usually accept and why." },
      { id: "FUND.S3.2", title: "Deal structures", actor: "user-decides", estimateMinutes: 20, tier: "artifact",
        description: "Nova lays out three structures — mostly seller-financed, seller note plus an SBA loan, and one with an earn-out — each with your cash in, monthly payments, what the seller receives and when, and the risk to each side. You choose the one to offer." },
      { id: "FUND.S3.3", title: "Letter of intent", actor: "nova-drafts", estimateMinutes: 45, tier: "artifact",
        description: "The letter of intent: price, structure, the seller note, due diligence period, exclusivity, transition help and conditions. A draft for an attorney to finalise, not a final contract." },
      { id: "FUND.S3.4", title: "Make the offer", actor: "user-does", estimateMinutes: h(2), tier: "claimed", inMarket: true,
        description: "You present the offer to the seller and negotiate, with Nova's script for the conversation and the objections sellers raise about carrying a note." },
    ],
  },
  {
    id: "seller-4", route: "seller", title: "Seller — Close and take over",
    checkpoint: "The deal closed and the business running under you.",
    milestones: [
      { id: "FUND.S4.1", title: "Fill the financing gap", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
        description: "Whatever the seller note and your cash don't cover — an SBA loan, a partner, the seller's equipment on lease — and the order to line them up so they close together." },
      { id: "FUND.S4.2", title: "Transition agreement", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "How the seller hands over: training period, introductions to customers and suppliers, a consulting agreement, a non-compete — what to ask for and what's normal." },
      { id: "FUND.S4.3", title: "Closing checklist", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "Entity, lease assignment, licences and permits transferred, insurance, bank accounts, payroll, the purchase agreement and note reviewed by an attorney, and the day-of steps." },
      { id: "FUND.S4.4", title: "Your first 90 days", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
        description: "What to change and what to leave alone, keeping customers and staff through the handover, and hitting the cash flow the note depends on from month one." },
    ],
  },
];

// ------------------------------------------------------------ investor

const INVESTOR: BackbonePhase[] = [
  {
    id: "investor-1", route: "investor", title: "Investors — Be investable",
    checkpoint: "A clear deal to offer: what investors get, what you keep, and it's legal to offer.",
    milestones: [
      { id: "FUND.I1.1", title: "The ownership math", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
        description: "How much to raise, at what valuation or terms, and what you keep — checked against the ownership you want. Rounds after this one, and what they'd do to your share." },
      { id: "FUND.I1.2", title: "Choose the structure", actor: "user-decides", estimateMinutes: 20, tier: "artifact",
        description: "Nova lays out the structures that fit your business — priced equity, a SAFE or convertible note, LLC units with a preferred return, a profit share with a buy-back, revenue-based financing — with what each gives an investor and costs you. You pick one." },
      { id: "FUND.I1.3", title: "Raising legally", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "Selling a share of a business is selling a security. The rules that apply — accredited investors, Regulation D exemptions, Regulation Crowdfunding, state filings — what each lets you do and not do (like public advertising), and what to have a securities attorney handle." },
      { id: "FUND.I1.4", title: "Data room", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "The folder investors ask for, with what goes in it: formation documents, cap table, financials and projections, contracts, IP, team — and which of these you still need to create." },
    ],
  },
  {
    id: "investor-2", route: "investor", title: "Investors — Your materials",
    checkpoint: "A story and numbers an investor can say yes to.",
    milestones: [
      { id: "FUND.I2.1", title: "Pitch deck", actor: "nova-builds", estimateMinutes: h(2), tier: "artifact", work: "plan",
        description: "The deck, slide by slide: problem, solution, market, traction, business model, competition, team, financials, the ask and use of funds — written from your profile, with what to show on each slide." },
      { id: "FUND.I2.2", title: "One-pager", actor: "nova-drafts", estimateMinutes: 30, tier: "artifact",
        description: "The one page that gets you the meeting. Nova drafts three with different leads — the traction, the team, the market." },
      { id: "FUND.I2.3", title: "Investor model", actor: "nova-builds", estimateMinutes: h(2), tier: "artifact", work: "plan",
        description: "Projections investors read for: growth, margins, when it's profitable, how much capital it needs until then, and what their share could be worth at an exit." },
      { id: "FUND.I2.4", title: "Use of funds", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "Exactly what the money buys, by milestone, and what the business will have proven when it's spent." },
    ],
  },
  {
    id: "investor-3", route: "investor", title: "Investors — Build the pipeline",
    checkpoint: "Investors who fit, warm ways in, and applications open on your project page.",
    milestones: [
      { id: "FUND.I3.1", title: "Investor list", actor: "nova-builds", estimateMinutes: h(1), tier: "artifact", work: "plan",
        description: "Forty to sixty investors who back businesses like yours at your stage and size — local angels and networks, family offices, industry insiders, strategic partners, and crowdfunding if it fits — tiered so the practice conversations come first." },
      { id: "FUND.I3.2", title: "Warm introductions", actor: "user-does", estimateMinutes: h(2), tier: "claimed",
        description: "You map who you know who knows them — past colleagues, customers, advisors, your accountant and banker — using Nova's template, and ask for the first five introductions." },
      { id: "FUND.I3.3", title: "Outreach sequence", actor: "nova-drafts", estimateMinutes: 30, tier: "artifact",
        description: "The intro request, the first email, and two follow-ups, written in your voice for your raise." },
      { id: "FUND.I3.4", title: "Open investment applications", actor: "user-does", estimateMinutes: 20, tier: "claimed",
        description: "You turn on investment applications on your project page and write the ask, so anyone who finds you can apply to invest and you can review them in one place. Check the securities rules from this route before you advertise the raise publicly." },
    ],
  },
  {
    id: "investor-4", route: "investor", title: "Investors — Meetings to money",
    checkpoint: "Meetings run, terms agreed, and the round closed.",
    milestones: [
      { id: "FUND.I4.1", title: "The hard questions", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
        description: "The questions your numbers and profile will draw, with strong answers — and the ones you should ask investors back." },
      { id: "FUND.I4.2", title: "Take the meetings", actor: "user-does", estimateMinutes: h(6), tier: "claimed", inMarket: true,
        description: "You run the meetings. After each, Nova structures your notes: interest, concerns, next step, follow-up date." },
      { id: "FUND.I4.3", title: "Review the terms", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
        description: "A term sheet explained line by line — valuation, liquidation preference, board seats, pro-rata, vesting, protective provisions — what's standard, what to push back on, and what to have your attorney negotiate." },
      { id: "FUND.I4.4", title: "Close the round", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "Closing documents, signatures, the updated cap table, filings, and the first investor update — so the relationship starts well." },
    ],
  },
];

// -------------------------------------------------------------- hybrid

const HYBRID: BackbonePhase[] = [
  {
    id: "hybrid-1", route: "hybrid", title: "Hybrid — Design the capital stack",
    checkpoint: "Every layer of the money named, sized and in the right order.",
    milestones: [
      { id: "FUND.H1.1", title: "Capital stack", actor: "nova-builds", estimateMinutes: h(1), tier: "artifact", work: "plan",
        description: "The layers that cover the raise between them — your cash, a loan, a seller note, a partner or investor, grants — each sized, with what it costs, what it's secured by, and who gets paid first." },
      { id: "FUND.H1.2", title: "Choose your stack", actor: "user-decides", estimateMinutes: 20, tier: "artifact",
        description: "Nova lays out three stacks — debt-heavy, balanced, equity-heavy — each with your ownership, monthly payments and risk. You pick the one to build." },
      { id: "FUND.H1.3", title: "Sequence the layers", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
        description: "The order to line them up, because each unlocks the next: equity commitments that satisfy a lender's injection, a seller note on standby, a loan approval that gives investors confidence — with a dated timeline to close them together." },
    ],
  },
  {
    id: "hybrid-2", route: "hybrid", title: "Hybrid — The equity layer",
    checkpoint: "Your cash and any partners' or investors' money committed, on paper.",
    milestones: [
      { id: "FUND.H2.1", title: "Partner and investor terms", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
        description: "What partners or investors get for their layer — equity, a preferred return, a profit share with a buy-back — how it fits the lender's rules, and what you keep." },
      { id: "FUND.H2.2", title: "Operating agreement outline", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
        description: "Ownership, who decides what, distributions, what happens if someone wants out or can't contribute, and how a buy-back works — an outline for your attorney to draft from." },
      { id: "FUND.H2.3", title: "Open investment applications", actor: "user-does", estimateMinutes: 20, tier: "claimed",
        description: "You turn on investment applications on your project page with the equity layer's ask, so interested investors can apply and you can review them in one place. Check the securities rules before advertising publicly." },
      { id: "FUND.H2.4", title: "Secure commitments", actor: "user-does", estimateMinutes: h(4), tier: "claimed", inMarket: true,
        description: "You get the equity layer committed in writing — your injection documented, partners' and investors' letters of commitment — with Nova's follow-up log." },
    ],
  },
  {
    id: "hybrid-3", route: "hybrid", title: "Hybrid — The debt and seller layers",
    checkpoint: "The loan and seller note agreed, and fitting together.",
    milestones: [
      { id: "FUND.H3.1", title: "Loan package", actor: "nova-builds", estimateMinutes: h(2), tier: "artifact", work: "plan",
        description: "The lender's package for your layer — plan, projections with every layer's payments, sources and uses showing the full stack — and the lenders to take it to." },
      { id: "FUND.H3.2", title: "Seller note, if there's a seller", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "The seller note terms that fit behind the loan — standby periods, subordination, rate and term — and how to put it to the seller." },
      { id: "FUND.H3.3", title: "Coverage across the stack", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "Every layer's payments against the business's cash flow, month by month: coverage, the tightest month, and what gives first if sales come in low." },
    ],
  },
  {
    id: "hybrid-4", route: "hybrid", title: "Hybrid — Close it together",
    checkpoint: "Every layer closed and funded on the same timeline.",
    milestones: [
      { id: "FUND.H4.1", title: "Closing timeline", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "One timeline for every party — lender, seller, investors, landlord, attorneys — with the conditions each is waiting on, so nothing closes early and leaves another layer hanging." },
      { id: "FUND.H4.2", title: "Conditions checklist", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "Every closing condition across the stack and who clears it: injections verified, standby agreements signed, insurance, entity and lease." },
      { id: "FUND.H4.3", title: "Reporting to your capital partners", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "What each funder expects to hear and when — lender covenants, investor updates, the seller's payments — as one monthly routine." },
    ],
  },
];

// ---------------------------------------------------------------- self

const SELF: BackbonePhase[] = [
  {
    id: "self-1", route: "self", title: "Self-funded — Your runway",
    checkpoint: "How long you can fund it, and the smallest version that starts earning.",
    milestones: [
      { id: "FUND.F1.1", title: "Personal runway", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
        description: "Your budget, what you can save each month, how many months of personal expenses to keep untouched, and how much that leaves to put into the business — and when." },
      { id: "FUND.F1.2", title: "Keep an income", actor: "user-decides", estimateMinutes: 15, tier: "artifact",
        description: "Nova lays out the ways to keep money coming in while it starts — staying full-time, going part-time, contract work in the industry, a partner's income — each with the time it leaves you and how long it lets the business take." },
      { id: "FUND.F1.3", title: "Smallest version that earns", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
        description: "The minimum launch: the version of the business that can take a first dollar soonest, what it costs, what it proves, and what it grows into." },
    ],
  },
  {
    id: "self-2", route: "self", title: "Self-funded — Earn before you spend",
    checkpoint: "Customers paying before the big costs land.",
    milestones: [
      { id: "FUND.F2.1", title: "Presales and deposits", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
        description: "Getting paid first: founding-member offers, deposits, prepaid packages, gift cards, pre-orders — what to offer, at what price, and how many it takes to fund the next step." },
      { id: "FUND.F2.2", title: "Your first offer", actor: "nova-drafts", estimateMinutes: 30, tier: "artifact",
        description: "The offer itself, in three versions, written to sell to your first customers." },
      { id: "FUND.F2.3", title: "Lean costs", actor: "nova-builds", estimateMinutes: 45, tier: "artifact", work: "plan",
        description: "Every cost you can shrink or delay: used equipment, leasing, shared or part-time space, vendor terms, doing it yourself before hiring — with what each saves." },
      { id: "FUND.F2.4", title: "Sell the first ten", actor: "user-does", estimateMinutes: h(4), tier: "claimed", inMarket: true,
        description: "You sell the first ten presales or first customers, using Nova's script, and log who bought and why." },
    ],
  },
  {
    id: "self-3", route: "self", title: "Self-funded — Reinvest and grow",
    checkpoint: "The business funding its own growth, and the point where outside money would help.",
    milestones: [
      { id: "FUND.F3.1", title: "Reinvestment rules", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "How much of each month's profit goes back in, how much you pay yourself, and the reserve you never touch — as rules you can follow without deciding every month." },
      { id: "FUND.F3.2", title: "Growth milestones", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "The revenue, profit and time-in-business marks where the business can fund its next step itself, and where a loan or partner would speed it up — so you know when to look again." },
      { id: "FUND.F3.3", title: "Retirement money, carefully", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "If you're thinking of using retirement savings — a rollover into the business (ROBS), a 401(k) loan, an early withdrawal — how each works, what it costs, the risks, and what to confirm with a tax professional before you touch it." },
    ],
  },
  {
    id: "self-4", route: "self", title: "Self-funded — Build fundability as you go",
    checkpoint: "A business record that opens every other route when you want it.",
    milestones: [
      { id: "FUND.F4.1", title: "Business credit", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "Separating business from personal: the entity, an EIN, a business bank account, vendor trade lines that report, and a business credit profile — so a lender sees a business, not just you." },
      { id: "FUND.F4.2", title: "Books a funder can read", actor: "nova-builds", estimateMinutes: 30, tier: "artifact", work: "plan",
        description: "Bookkeeping set up the way lenders and investors read it: monthly statements, clean categories, sales that match the bank — from the first month." },
      { id: "FUND.F4.3", title: "Re-check your score", actor: "user-does", estimateMinutes: 15, tier: "claimed",
        description: "You update your capital profile answers after six months of trading and see what the score and your routes look like now." },
    ],
  },
];

export const FUND_TREE: PathTree = {
  goal: "raise_funding",
  promise: "Know how fundable you are, pick the route to the money, and build it out step by step",
  target: "2 weeks to a capital profile and route, then the route's roadmap",
  defaultTier: "artifact",
  phases: [PROFILE, MAP, ...DEBT, ...SELLER, ...INVESTOR, ...HYBRID, ...SELF],
};
