/**
 * The capital profile: what someone brings to a funding conversation, and how
 * a funder would likely see it today.
 *
 * Everything here is deterministic, on purpose. The fundability score is a
 * number people will act on and come back to watch move, so it has to be the
 * same number for the same answers every time, explainable line by line, and
 * testable — Nova writes the profile around it, but never makes the number up.
 *
 * It measures how fundable the person looks right now, from what they've told
 * us. It is not the odds of approval, and every part of it says what raises it.
 */
import type { IntakeQuestion } from "./phase-trees/types";
import type { ProfileExperience } from "./schema";

export type IntakeAnswers = Record<string, string[]>;

// ------------------------------------------------------------------ routes

export const CAPITAL_ROUTES = [
  { id: "debt", label: "Debt", blurb: "Borrow it — SBA and bank loans, CDFIs, equipment financing. You keep all of the business and pay it back with interest." },
  { id: "seller", label: "Seller financing", blurb: "Buy an existing business and have the seller carry part of the price as a note you pay from the business's cash flow." },
  { id: "investor", label: "Investors", blurb: "Sell a share of the business, or of its profits, to people who back you. Less to repay; less of it is yours." },
  { id: "hybrid", label: "Hybrid", blurb: "Stack them — your cash, a loan, a seller note, a partner — each covering the part it's best at." },
  { id: "self", label: "Self-funded", blurb: "Your savings, your income and the business's own revenue. Slower, and everything stays yours." },
] as const;

export type CapitalRoute = (typeof CAPITAL_ROUTES)[number]["id"];
export const CAPITAL_ROUTE_IDS = CAPITAL_ROUTES.map((r) => r.id) as readonly string[];
export const isCapitalRoute = (v: unknown): v is CapitalRoute => typeof v === "string" && CAPITAL_ROUTE_IDS.includes(v);

// --------------------------------------------------------------- questions

export const OWNERSHIP_GOAL_QUESTIONS: IntakeQuestion[] = [
  {
    id: "why", prompt: "Why do you want to own a business?", multi: true,
    help: "Pick every one that's true. It changes which money fits.",
    options: [
      { id: "income", label: "Replace my income" },
      { id: "wealth", label: "Build long-term wealth" },
      { id: "freedom", label: "Freedom over my time" },
      { id: "legacy", label: "Something to pass on" },
      { id: "scale_exit", label: "Grow it big and sell it" },
      { id: "community", label: "Serve my community" },
      { id: "passion", label: "Do work I love" },
    ],
  },
  {
    id: "path", prompt: "How are you getting the business?",
    options: [
      { id: "start", label: "Start a new one" },
      { id: "buy", label: "Buy an existing one" },
      { id: "franchise", label: "Buy a franchise" },
      { id: "grow", label: "Grow one I already own" },
      { id: "undecided", label: "Not decided" },
    ],
  },
  {
    id: "role", prompt: "How involved will you be?",
    options: [
      { id: "operator", label: "Full-time — I'll run it" },
      { id: "part_time", label: "Part-time, alongside a job" },
      { id: "owner_investor", label: "Owner, with a manager running it" },
    ],
  },
  {
    id: "horizon", prompt: "How long do you see yourself owning it?",
    options: [
      { id: "forever", label: "For good" },
      { id: "10y", label: "About 10 years" },
      { id: "5y", label: "About 5 years, then sell" },
      { id: "unsure", label: "Not sure" },
    ],
  },
];

export const MONEY_TODAY_QUESTIONS: IntakeQuestion[] = [
  {
    id: "cash", prompt: "How much cash could you put in?",
    help: "Savings you could actually use. $0 is a real starting point.",
    options: [
      { id: "0", label: "$0" }, { id: "lt5k", label: "Under $5k" }, { id: "5k_25k", label: "$5k–$25k" },
      { id: "25k_100k", label: "$25k–$100k" }, { id: "100k_250k", label: "$100k–$250k" },
      { id: "250k_500k", label: "$250k–$500k" }, { id: "500k_plus", label: "$500k+" },
    ],
  },
  {
    id: "credit", prompt: "Where's your credit score?",
    options: [
      { id: "unknown", label: "Not sure" }, { id: "lt580", label: "Below 580" }, { id: "580_669", label: "580–669" },
      { id: "670_739", label: "670–739" }, { id: "740_799", label: "740–799" }, { id: "800_plus", label: "800+" },
    ],
  },
  {
    id: "income", prompt: "Your household income a year, before tax?",
    options: [
      { id: "0", label: "None right now" }, { id: "lt30k", label: "Under $30k" }, { id: "30k_60k", label: "$30k–$60k" },
      { id: "60k_100k", label: "$60k–$100k" }, { id: "100k_200k", label: "$100k–$200k" }, { id: "200k_plus", label: "$200k+" },
    ],
  },
  {
    id: "debt", prompt: "What do your debt payments come to each month?",
    help: "Mortgage or rent-to-own, car, student loans, cards — the minimums.",
    options: [
      { id: "0", label: "None" }, { id: "lt500", label: "Under $500" }, { id: "500_1500", label: "$500–$1,500" },
      { id: "1500_3000", label: "$1,500–$3,000" }, { id: "3000_plus", label: "$3,000+" },
    ],
  },
  {
    id: "assets", prompt: "What else do you own that has value?", multi: true, optional: true,
    options: [
      { id: "home_equity", label: "Equity in a home" }, { id: "real_estate", label: "Other real estate" },
      { id: "retirement", label: "Retirement accounts" }, { id: "investments", label: "Stocks or investments" },
      { id: "equipment", label: "Vehicles or equipment" }, { id: "none", label: "Nothing major" },
    ],
  },
];

export const EXPERIENCE_QUESTIONS: IntakeQuestion[] = [
  {
    id: "industry_years", prompt: "How long have you worked in the industry you're going into?",
    options: [
      { id: "0", label: "Not at all" }, { id: "lt2", label: "Under 2 years" }, { id: "2_5", label: "2–5 years" },
      { id: "5_10", label: "5–10 years" }, { id: "10_plus", label: "10+ years" },
    ],
  },
  {
    id: "level", prompt: "The most senior role you've held in it?",
    options: [
      { id: "none", label: "None yet" }, { id: "staff", label: "Staff" }, { id: "lead", label: "Lead or supervisor" },
      { id: "manager", label: "Manager" }, { id: "gm", label: "General manager or director" }, { id: "owner", label: "Owner" },
    ],
  },
  {
    id: "managed", prompt: "The most people you've managed?",
    options: [
      { id: "0", label: "None" }, { id: "1_5", label: "1–5" }, { id: "6_20", label: "6–20" }, { id: "20_plus", label: "More than 20" },
    ],
  },
  {
    id: "pnl", prompt: "Have you been responsible for a budget or P&L?",
    options: [
      { id: "no", label: "No" }, { id: "some", label: "Part of one" }, { id: "yes", label: "Yes, the whole thing" },
    ],
  },
];

export const BUSINESS_HISTORY_QUESTIONS: IntakeQuestion[] = [
  {
    id: "owned", prompt: "Have you owned a business before?",
    options: [
      { id: "never", label: "No, this is my first" }, { id: "once", label: "Yes, one" },
      { id: "several", label: "Yes, more than one" }, { id: "current", label: "I own one now" },
    ],
  },
  { id: "idea", prompt: "In a line, what did it do?", kind: "text", optional: true, options: [], placeholder: "e.g. Commercial cleaning for offices in Tulsa", showIf: { question: "owned", in: ["once", "several", "current"] } },
  {
    id: "industry", prompt: "What kind of business was it?", showIf: { question: "owned", in: ["once", "several", "current"] },
    options: [
      { id: "food", label: "Food & hospitality" }, { id: "retail", label: "Retail or e-commerce" }, { id: "services", label: "Professional services" },
      { id: "trades", label: "Trades & home services" }, { id: "health", label: "Health & wellness" }, { id: "tech", label: "Tech or software" },
      { id: "other", label: "Something else" },
    ],
  },
  {
    id: "age", prompt: "How long did you run it?", showIf: { question: "owned", in: ["once", "several", "current"] },
    options: [
      { id: "lt1", label: "Under a year" }, { id: "1_3", label: "1–3 years" }, { id: "3_5", label: "3–5 years" },
      { id: "5_10", label: "5–10 years" }, { id: "10_plus", label: "10+ years" },
    ],
  },
  {
    id: "revenue", prompt: "Its revenue in its best year?", showIf: { question: "owned", in: ["once", "several", "current"] },
    options: [
      { id: "lt50k", label: "Under $50k" }, { id: "50k_250k", label: "$50k–$250k" }, { id: "250k_1m", label: "$250k–$1M" },
      { id: "1m_5m", label: "$1M–$5M" }, { id: "5m_plus", label: "$5M+" }, { id: "unsure", label: "Not sure" },
    ],
  },
  {
    id: "profit", prompt: "Was it profitable?", showIf: { question: "owned", in: ["once", "several", "current"] },
    options: [
      { id: "loss", label: "It lost money" }, { id: "even", label: "About break-even" }, { id: "lt50k", label: "Profit under $50k a year" },
      { id: "50k_250k", label: "$50k–$250k a year" }, { id: "250k_plus", label: "$250k+ a year" },
    ],
  },
  {
    id: "employees", prompt: "How many people worked there?", showIf: { question: "owned", in: ["once", "several", "current"] },
    options: [
      { id: "solo", label: "Just me" }, { id: "2_5", label: "2–5" }, { id: "6_20", label: "6–20" }, { id: "21_50", label: "21–50" }, { id: "50_plus", label: "50+" },
    ],
  },
  {
    id: "customers", prompt: "How many customers did it have?", showIf: { question: "owned", in: ["once", "several", "current"] },
    options: [
      { id: "lt50", label: "Under 50" }, { id: "50_500", label: "50–500" }, { id: "500_5k", label: "500–5,000" }, { id: "5k_plus", label: "5,000+" },
    ],
  },
  {
    id: "biz_assets", prompt: "What did it own?", multi: true, optional: true, showIf: { question: "owned", in: ["once", "several", "current"] },
    options: [
      { id: "property", label: "Property" }, { id: "equipment", label: "Equipment or vehicles" }, { id: "inventory", label: "Inventory" },
      { id: "brand", label: "A brand, IP or contracts" }, { id: "none", label: "Not much" },
    ],
  },
  {
    id: "outcome", prompt: "Where is it now?", showIf: { question: "owned", in: ["once", "several", "current"] },
    options: [
      { id: "running", label: "Still running" }, { id: "sold", label: "I sold it" }, { id: "handed", label: "Handed it on" }, { id: "closed", label: "Closed it" },
    ],
  },
];

export const CAPITAL_GOAL_QUESTIONS: IntakeQuestion[] = [
  {
    id: "amount", prompt: "How much money do you need?",
    options: [
      { id: "unknown", label: "I don't know — work it out" }, { id: "lt50k", label: "Under $50k" }, { id: "50k_150k", label: "$50k–$150k" },
      { id: "150k_500k", label: "$150k–$500k" }, { id: "500k_1m", label: "$500k–$1M" }, { id: "1m_5m", label: "$1M–$5M" }, { id: "5m_plus", label: "$5M+" },
    ],
  },
  {
    id: "uses", prompt: "What will the money buy?", multi: true,
    options: [
      { id: "acquisition", label: "The business itself" }, { id: "franchise_fee", label: "A franchise fee" }, { id: "build_out", label: "Build-out or real estate" },
      { id: "equipment", label: "Equipment" }, { id: "inventory", label: "Inventory" }, { id: "working_capital", label: "Working capital" },
      { id: "hiring", label: "Hiring" }, { id: "marketing", label: "Marketing" }, { id: "refinance", label: "Paying off debt" },
    ],
  },
  {
    id: "timeline", prompt: "When do you need it?",
    options: [
      { id: "now", label: "Within 3 months" }, { id: "3_6", label: "3–6 months" }, { id: "6_12", label: "6–12 months" }, { id: "12_plus", label: "More than a year" },
    ],
  },
  {
    id: "equity", prompt: "Would you give up part of the business for it?",
    options: [
      { id: "none", label: "No — I keep it all" }, { id: "lt10", label: "Up to 10%" }, { id: "10_25", label: "10–25%" },
      { id: "25_49", label: "25–49%" }, { id: "majority_ok", label: "More, if that's what it takes" },
    ],
  },
  {
    id: "debt_ok", prompt: "Would you take on debt for it?",
    options: [
      { id: "no", label: "No debt" }, { id: "no_guarantee", label: "Yes, but not personally guaranteed" },
      { id: "guarantee", label: "Yes, with a personal guarantee" }, { id: "collateral", label: "Yes, and I'd pledge my home or assets" },
    ],
  },
  {
    id: "ownership", prompt: "How much of the business do you want to own afterwards?",
    options: [
      { id: "100", label: "All of it" }, { id: "75_plus", label: "At least 75%" }, { id: "51_plus", label: "A controlling 51%" }, { id: "minority_ok", label: "A minority is fine" },
    ],
  },
];

export const ROUTE_CHOICE_QUESTIONS: IntakeQuestion[] = [
  {
    id: "route", prompt: "Which route do you want to take?",
    help: "You can change it later. Your capital map shows how well each fits.",
    options: CAPITAL_ROUTES.map((r) => ({ id: r.id, label: r.label })),
  },
];

/** The five steps' answers, by the milestone they're asked on. */
export interface CapitalAnswers {
  goal?: IntakeAnswers;
  money?: IntakeAnswers;
  experience?: IntakeAnswers;
  history?: IntakeAnswers;
  target?: IntakeAnswers;
}

/**
 * The money questions the Systemize path opens with, in the words this file
 * scores in.
 *
 * `SYS.F1.1` ("Where you stand") is the first thing a builder on the Systemize
 * path answers — six questions about cash, credit and experience, asked in the
 * very first minute. The fundability score reads `FUND.C1.1`–`C1.5`, which are
 * asked later, so the opening answers counted for nothing: a builder could
 * answer "cash $25k–$100k, credit 740+, eleven years in the industry" and
 * watch the Fundability card say "Not fundable yet — not answered yet" on
 * every part. The same three subjects were then asked again, in different
 * words, further down the path.
 *
 * Both sets stay — the later ones ask more (income, debt payments, the most
 * senior role held) and the score needs that detail. What this does is carry
 * the first answers forward so they count until the fuller ones arrive, and so
 * the second asking starts from what was already said.
 *
 * ## Why the vocabularies differ, and what that costs
 *
 * The two sets were written apart and their option ids never matched: `zero`
 * against `0`, `under_5k` against `lt5k`, `740_plus` against `740_799` and
 * `800_plus`. Where a band in the opening set spans two in the scorer's, the
 * lower is taken — a score that flatters somebody into an application they
 * will fail is worse than one that waits for the precise answer. Anything
 * genuinely ambiguous ("Not sure yet", "I've managed or owned one", which is
 * about a role rather than years) is left out entirely: the later step asks it
 * properly, and a guess written into somebody's fundability is a guess they
 * will never know was made.
 */
const FROM_MONEY_POSITION: Record<string, Record<string, Record<string, string>>> = {
  // money-position question id → capital group → { its option id → the scorer's }
  cash: { money: { zero: "0", under_5k: "lt5k", "5k_25k": "5k_25k", "25k_100k": "25k_100k", "100k_250k": "100k_250k", "250k_plus": "250k_500k" } },
  credit: { money: { unknown: "unknown", under_580: "lt580", "580_669": "580_669", "670_739": "670_739", "740_plus": "740_799" } },
  assets: { money: { home_equity: "home_equity", retirement: "retirement", equipment: "equipment" } },
  experience: { experience: { none: "0", under_2: "lt2", "2_5": "2_5", "5_plus": "5_10" } },
};

/** The question each translated answer lands on, when it isn't the same id. */
const LANDS_ON: Record<string, string> = { experience: "industry_years" };

/**
 * What the opening money questions say, in the scorer's terms. Answers it
 * cannot translate without guessing are dropped rather than approximated.
 */
export function capitalAnswersFromMoneyPosition(answers: IntakeAnswers | undefined): CapitalAnswers {
  if (!answers) return {};
  const out: CapitalAnswers = {};
  for (const [asked, groups] of Object.entries(FROM_MONEY_POSITION)) {
    const given = answers[asked];
    if (!given?.length) continue;
    for (const [group, ids] of Object.entries(groups)) {
      const translated = given.map((id) => ids[id]).filter(Boolean);
      if (!translated.length) continue;
      const question = LANDS_ON[asked] ?? asked;
      (out as any)[group] = { ...((out as any)[group] ?? {}), [question]: translated };
    }
  }
  return out;
}

/**
 * Two sets of answers, the later winning question by question.
 *
 * Question by question rather than group by group: somebody who has answered
 * two of the five questions in "Your money today" should keep the cash and
 * credit they gave at the start for the three they haven't reached yet.
 */
export function mergeCapitalAnswers(base: CapitalAnswers, over: CapitalAnswers): CapitalAnswers {
  const out: CapitalAnswers = { ...base };
  for (const group of Object.keys(over) as (keyof CapitalAnswers)[]) {
    const later = over[group];
    if (!later) continue;
    const earlier = out[group] ?? {};
    const merged: IntakeAnswers = { ...earlier };
    for (const [question, value] of Object.entries(later)) {
      // An empty array is "asked and left blank", which must not erase what was said earlier.
      if (value?.length) merged[question] = value;
    }
    out[group] = merged;
  }
  return out;
}

/** Which milestone holds which set. */
export const CAPITAL_MILESTONES = {
  goal: "FUND.C1.1",
  money: "FUND.C1.2",
  experience: "FUND.C1.3",
  history: "FUND.C1.4",
  target: "FUND.C1.5",
  route: "FUND.C2.2",
} as const;

// ----------------------------------------------------------------- scoring

const one = (a: IntakeAnswers | undefined, q: string): string | null => a?.[q]?.[0] ?? null;
const many = (a: IntakeAnswers | undefined, q: string): string[] => a?.[q] ?? [];

/** A range answer's working midpoint, in dollars. */
const CASH_MID: Record<string, number> = { "0": 0, lt5k: 2500, "5k_25k": 15000, "25k_100k": 60000, "100k_250k": 175000, "250k_500k": 375000, "500k_plus": 750000 };
const AMOUNT_MID: Record<string, number> = { lt50k: 35000, "50k_150k": 100000, "150k_500k": 325000, "500k_1m": 750000, "1m_5m": 2500000, "5m_plus": 7500000 };
const INCOME_MID: Record<string, number> = { "0": 0, lt30k: 20000, "30k_60k": 45000, "60k_100k": 80000, "100k_200k": 150000, "200k_plus": 275000 };
const DEBT_MID: Record<string, number> = { "0": 0, lt500: 300, "500_1500": 1000, "1500_3000": 2250, "3000_plus": 4000 };

export interface ScorePart { key: string; label: string; score: number; max: number; why: string; raise: string | null }
export interface RouteFit { route: CapitalRoute; label: string; score: number; why: string }
export interface CapitalProfile {
  /** 0–100. */
  score: number;
  band: { id: "not_yet" | "early" | "with_work" | "strong" | "very_strong"; label: string };
  parts: ScorePart[];
  routeFit: RouteFit[];
  /** How many of the five steps are answered. */
  answered: number;
  /** Plain facts derived from the answers, for Nova and the page. */
  facts: { cashMid: number | null; amountMid: number | null; cashToAmount: number | null; debtToIncome: number | null };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function bandFor(score: number): CapitalProfile["band"] {
  if (score >= 90) return { id: "very_strong", label: "Very strong" };
  if (score >= 75) return { id: "strong", label: "Strong" };
  if (score >= 60) return { id: "with_work", label: "Fundable with work" };
  if (score >= 40) return { id: "early", label: "Early" };
  return { id: "not_yet", label: "Not fundable yet" };
}

/**
 * The fundability score and route fit. Seven parts, 100 points:
 * cash for the raise 20, credit 20, income against debt 15, assets 10,
 * industry experience 15, business track record 15, a clear goal 5.
 * A part with nothing answered scores nothing — unknown isn't counted as good.
 */
export function capitalProfile(a: CapitalAnswers): CapitalProfile {
  const cash = one(a.money, "cash");
  const cashMid = cash != null ? CASH_MID[cash] ?? null : null;
  const amount = one(a.target, "amount");
  const amountMid = amount && amount !== "unknown" ? AMOUNT_MID[amount] ?? null : null;
  const cashToAmount = cashMid != null && amountMid ? cashMid / amountMid : null;

  // Cash for the raise — lenders commonly want 10–30% in; investors want skin in the game.
  let cashScore = 0;
  if (cashToAmount != null) cashScore = cashToAmount >= 0.3 ? 20 : cashToAmount >= 0.2 ? 16 : cashToAmount >= 0.1 ? 12 : cashToAmount >= 0.05 ? 7 : cashToAmount > 0 ? 3 : 0;
  else if (cashMid != null) cashScore = cashMid === 0 ? 0 : cashMid < 5000 ? 3 : cashMid < 25000 ? 8 : cashMid < 100000 ? 13 : cashMid < 250000 ? 17 : 20;
  const cashPart: ScorePart = {
    key: "cash", label: "Cash for the raise", score: cashScore, max: 20,
    why: cash == null ? "Not answered yet." : cashToAmount != null ? `About ${Math.round(cashToAmount * 100)}% of what you need, from your own cash.` : cashMid === 0 ? "No cash to put in yet." : "Cash in hand; the share of the raise it covers depends on the amount.",
    raise: cashScore >= 20 ? null : cashToAmount != null && cashToAmount < 0.1 ? "Get to 10% of the raise in cash — savings, a partner's cash, or gifted funds with a letter." : "Every extra dollar you can put in raises this part and lowers what you have to borrow.",
  };

  const credit = one(a.money, "credit");
  const creditScore = credit == null ? 0 : ({ unknown: 4, lt580: 2, "580_669": 9, "670_739": 15, "740_799": 19, "800_plus": 20 } as Record<string, number>)[credit] ?? 0;
  const creditPart: ScorePart = {
    key: "credit", label: "Credit", score: creditScore, max: 20,
    why: credit == null ? "Not answered yet." : credit === "unknown" ? "Unknown — a funder will pull it, so you should first." : credit === "lt580" ? "Below what most lenders will consider." : credit === "580_669" ? "Workable for some lenders and CDFIs, hard for banks." : "Strong enough for most lenders.",
    raise: creditScore >= 19 ? null : credit === "unknown" ? "Pull all three reports this week (free) and fix any errors." : "Pay cards below 30% of their limits and dispute errors — both move a score within months.",
  };

  const income = one(a.money, "income");
  const debt = one(a.money, "debt");
  const incomeMid = income != null ? INCOME_MID[income] ?? null : null;
  const debtMid = debt != null ? DEBT_MID[debt] ?? null : null;
  const debtToIncome = incomeMid && debtMid != null ? debtMid / (incomeMid / 12) : incomeMid === 0 && debtMid ? Infinity : null;
  let incomeScore = income == null ? 0 : ({ "0": 0, lt30k: 3, "30k_60k": 6, "60k_100k": 9, "100k_200k": 12, "200k_plus": 15 } as Record<string, number>)[income] ?? 0;
  if (debtToIncome != null) incomeScore -= debtToIncome > 0.5 ? 6 : debtToIncome > 0.36 ? 3 : 0;
  incomeScore = clamp(incomeScore, 0, 15);
  const incomePart: ScorePart = {
    key: "income", label: "Income against debt", score: incomeScore, max: 15,
    why: income == null || debt == null ? "Not answered yet." : debtToIncome == null ? "Income with no debt payments." : !Number.isFinite(debtToIncome) ? "Debt payments with no income to cover them." : `Debt payments are about ${Math.round(debtToIncome * 100)}% of monthly income${debtToIncome > 0.36 ? " — above the 36% lenders like" : ""}.`,
    raise: incomeScore >= 15 ? null : debtToIncome != null && debtToIncome > 0.36 ? "Pay down the smallest debts first to get payments under 36% of income." : "Keeping a steady income while you start is itself a funding source — lenders count it.",
  };

  const assets = many(a.money, "assets");
  const assetScore = clamp(assets.reduce((n, x) => n + (({ home_equity: 4, real_estate: 4, retirement: 2, investments: 3, equipment: 2 } as Record<string, number>)[x] ?? 0), 0), 0, 10);
  const assetPart: ScorePart = {
    key: "assets", label: "Assets and collateral", score: assetScore, max: 10,
    why: !assets.length || assets.includes("none") ? "Nothing to secure a loan with yet." : "Assets that can back a loan or be pledged.",
    raise: assetScore >= 10 ? null : "Not required — but equipment the loan buys can secure it, and a co-signer or partner can add collateral.",
  };

  const years = one(a.experience, "industry_years");
  const level = one(a.experience, "level");
  let expScore = years == null ? 0 : ({ "0": 0, lt2: 4, "2_5": 8, "5_10": 12, "10_plus": 15 } as Record<string, number>)[years] ?? 0;
  expScore += level === "manager" ? 2 : level === "gm" || level === "owner" ? 3 : 0;
  if (one(a.experience, "pnl") === "yes") expScore += 2;
  expScore = clamp(expScore, 0, 15);
  const expPart: ScorePart = {
    key: "experience", label: "Industry experience", score: expScore, max: 15,
    why: years == null ? "Not answered yet." : years === "0" ? "No time in this industry yet — the first thing lenders and investors ask about." : "Time in the industry you're entering.",
    raise: expScore >= 15 ? null : years === "0" || years === "lt2" ? "Work in the industry, even part-time, or bring in a partner or manager who has — lenders accept either." : "A management role or P&L responsibility counts for more than years alone.",
  };

  const owned = one(a.history, "owned");
  let trackScore = 0;
  if (owned && owned !== "never") {
    trackScore = owned === "several" ? 8 : 6;
    const profit = one(a.history, "profit");
    trackScore += profit === "50k_250k" || profit === "250k_plus" ? 5 : profit === "lt50k" ? 3 : profit === "even" ? 1 : 0;
    const age = one(a.history, "age");
    if (age === "3_5" || age === "5_10" || age === "10_plus") trackScore += 2;
    const outcome = one(a.history, "outcome");
    if (outcome === "sold") trackScore += 2;
    if (owned === "current" || outcome === "running") trackScore += 2;
    if (outcome === "closed" && profit === "loss") trackScore -= 2;
    trackScore = clamp(trackScore, 0, 15);
  }
  const trackPart: ScorePart = {
    key: "track_record", label: "Business track record", score: trackScore, max: 15,
    why: owned == null ? "Not answered yet." : owned === "never" ? "A first business — normal, and the part funders weigh experience against." : "Having run a business before, and how it went.",
    raise: trackScore >= 15 ? null : owned === "never" ? "Prove it small first: a side version, a pop-up, a first ten customers — a record of your own." : "Clean financials from the business you ran are the evidence here; have them ready.",
  };

  const why = many(a.goal, "why");
  const uses = many(a.target, "uses");
  const clarity = (why.length ? 1 : 0) + (one(a.goal, "path") && one(a.goal, "path") !== "undecided" ? 1 : 0) + (amountMid ? 1 : 0) + (uses.length ? 1 : 0) + (one(a.target, "timeline") ? 1 : 0);
  const clarityPart: ScorePart = {
    key: "clarity", label: "A clear goal", score: clarity, max: 5,
    why: clarity === 5 ? "You know what you want, how much, for what, and when." : "Funders back a specific ask.",
    raise: clarity >= 5 ? null : !amountMid ? "Pin down the amount — your capital map works it out if you don't know it." : "Decide how you're getting the business and what the money buys.",
  };

  const parts = [cashPart, creditPart, incomePart, assetPart, expPart, trackPart, clarityPart];
  const score = parts.reduce((n, p) => n + p.score, 0);
  const pct = (p: ScorePart) => p.score / p.max;
  const path = one(a.goal, "path");
  const equity = one(a.target, "equity");
  const debtOk = one(a.target, "debt_ok");
  const ownership = one(a.target, "ownership");

  const fit = (route: CapitalRoute, raw: number, cap: number | null, capWhy: string | null, why: string): RouteFit => {
    const label = CAPITAL_ROUTES.find((r) => r.id === route)!.label;
    const scoreRaw = Math.round(clamp(raw, 0, 100));
    return cap != null && scoreRaw > cap ? { route, label, score: cap, why: capWhy! } : { route, label, score: scoreRaw, why };
  };

  const debtFit = fit("debt",
    100 * (0.35 * pct(creditPart) + 0.25 * pct(cashPart) + 0.2 * pct(incomePart) + 0.15 * pct(expPart) + 0.05 * pct(assetPart)),
    debtOk === "no" ? 15 : null, "You said no debt.",
    "Lenders weigh credit, cash in, income against debt and experience — in that order.");
  const buying = path === "buy" || path === "franchise";
  const sellerFit = fit("seller",
    (buying ? 30 : 5) + 100 * (0.3 * pct(expPart) + 0.2 * pct(cashPart) + 0.1 * pct(creditPart) + 0.1 * pct(trackPart)),
    !buying ? 25 : debtOk === "no" ? 20 : null, !buying ? "Only if you buy an existing business." : "A seller note is still debt.",
    "Sellers finance buyers who can run what they're buying and put some cash down.");
  const investorFit = fit("investor",
    100 * (0.35 * pct(trackPart) + 0.2 * pct(expPart) + 0.15 * pct(clarityPart) + 0.1 * pct(cashPart)) + (why.includes("scale_exit") ? 15 : 0) + (amountMid && amountMid >= 500000 ? 5 : 0),
    equity === "none" || ownership === "100" ? 15 : null, "You'd rather keep all of it.",
    "Investors back a record, a team and a business that can grow enough to pay them back several times.");
  const incomeRoom = debtToIncome == null ? pct(incomePart) : clamp(1 - debtToIncome, 0, 1);
  const selfFit = fit("self",
    100 * (0.5 * (cashToAmount != null ? clamp(cashToAmount, 0, 1) : pct(cashPart)) + 0.3 * pct(incomePart) + 0.2 * incomeRoom),
    amountMid && amountMid >= 1000000 && (cashToAmount ?? 0) < 0.5 ? 25 : null, "Hard to self-fund a raise this size.",
    "Self-funding works when your cash and income can carry the business until it pays for itself.");
  const top2 = [debtFit, sellerFit, investorFit, selfFit].map((f) => f.score).sort((x, y) => y - x).slice(0, 2);
  // The average of your two strongest routes: a stack is as good as its layers, and never better than the best one alone.
  const hybridFit = fit("hybrid", (top2[0] + top2[1]) / 2, null, null, "Combines your two strongest routes, each covering the part it's best at.");

  const answered = [a.goal, a.money, a.experience, a.history, a.target].filter((x) => x && Object.keys(x).length).length;
  return {
    score, band: bandFor(score), parts,
    routeFit: [debtFit, sellerFit, investorFit, hybridFit, selfFit].sort((x, y) => y.score - x.score),
    answered,
    facts: { cashMid, amountMid, cashToAmount, debtToIncome: debtToIncome != null && Number.isFinite(debtToIncome) ? Math.round(debtToIncome * 100) / 100 : null },
  };
}

/** The profile as lines Nova builds from. */
export function renderCapitalProfile(p: CapitalProfile): string {
  return [
    `Fundability score: ${p.score}/100 (${p.band.label}), from ${p.answered} of 5 steps answered.`,
    ...p.parts.map((x) => `- ${x.label}: ${x.score}/${x.max}. ${x.why}${x.raise ? ` Raises it: ${x.raise}` : ""}`),
    `Route fit: ${p.routeFit.map((r) => `${r.label} ${r.score} (${r.why})`).join("; ")}.`,
  ].join("\n");
}

// ------------------------------------------------------------------ résumé

const OWNER_TITLE = /\b(owner|co-?owner|founder|co-?founder|proprietor|self[- ]employed|franchisee|managing member|sole trader)\b/i;

const yearsBetween = (start: string | null, end: string | null, current: boolean, now = new Date()): number | null => {
  const s = start ? new Date(start) : null;
  if (!s || Number.isNaN(s.getTime())) return null;
  const e = current || !end ? now : new Date(end);
  if (Number.isNaN(e.getTime())) return null;
  return Math.max(0, (e.getTime() - s.getTime()) / (365.25 * 86_400_000));
};

/**
 * What a résumé says about owning a business, as suggested answers to the
 * business-history step. Only what the résumé actually shows — a title that
 * names ownership — and never revenue or profit, which résumés don't carry.
 */
export function businessHistoryFromResume(experience: ProfileExperience[] | null | undefined, now = new Date()): { answers: IntakeAnswers; found: string[] } | null {
  const roles = (experience ?? []).filter((e) => OWNER_TITLE.test(e.title ?? ""));
  if (!roles.length) return null;
  const latest = roles[0];
  const current = roles.some((r) => r.current);
  const answers: IntakeAnswers = { owned: [current ? "current" : roles.length > 1 ? "several" : "once"] };
  const idea = [latest.company, latest.description].filter(Boolean).join(" — ").slice(0, 300);
  if (idea) answers.idea = [idea];
  const years = yearsBetween(latest.startDate ?? null, latest.endDate ?? null, !!latest.current, now);
  if (years != null) answers.age = [years < 1 ? "lt1" : years < 3 ? "1_3" : years < 5 ? "3_5" : years < 10 ? "5_10" : "10_plus"];
  if (latest.current) answers.outcome = ["running"];
  return { answers, found: roles.map((r) => `${r.title}${r.company ? `, ${r.company}` : ""}`) };
}
