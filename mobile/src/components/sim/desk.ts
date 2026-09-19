/**
 * The decision desk's arithmetic: the shapes GET /api/sim/ventures/:id/desk
 * sends, and the one sum that has to be right.
 *
 * Metro can't resolve the web app's `@shared` alias, so everything the server
 * sends is restated here rather than imported — the same arrangement as
 * lobby.ts, which says more about why. Where a constant is copied rather than
 * sent, the file it mirrors is named on the line above it, because a number
 * that drifts out of step with the engine is a number that lies to five people
 * at once.
 *
 * ## Why the phone does the sum at all
 *
 * The server already returns `preview.commitment`, and it is authoritative.
 * But it is a *poll* behind: a CMO who types two million into brand marketing
 * would see the table's total change two and a half seconds later, or — since
 * they haven't filed yet — not until they do. That is exactly backwards. The
 * whole point of showing the total is to change someone's mind *while their
 * thumb is still on the number*, so the phone recomputes it as they type and
 * the server's answer replaces it on the next poll.
 *
 * Which means this file has to match `commitment()` in
 * shared/simulation/levers.ts exactly. Not approximately: a local total that
 * reads 0.94 while the server resolves 1.07 is worse than no local total,
 * because it is the same failure the feature exists to prevent, wearing the
 * badge of the thing that was meant to prevent it. Hence desk.test.ts.
 */

// --- What the desk sends -------------------------------------------------
// Mirrors the response of GET /api/sim/ventures/:id/desk in
// server/simulation-desk-routes.ts.

/** Mirrors Role in shared/simulation/types.ts. */
export type DeskRole = "ceo" | "cmo" | "cfo" | "cto" | "coo";

/** The order seats are listed in, everywhere. Mirrors filedRoles() in shared/simulation/levers.ts. */
export const ROLE_ORDER: DeskRole[] = ["ceo", "cmo", "cfo", "cto", "coo"];

/** Mirrors LeverField in shared/simulation/levers.ts. */
export interface LeverField {
  id: string;
  label: string;
  help: string;
  kind: "money" | "price" | "count" | "choice" | "cities" | "segment";
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string; help: string }[];
}

/** Mirrors Commitment in shared/simulation/levers.ts. */
export interface Commitment {
  spend: number;
  fixed: number;
  available: number;
  ratio: number;
  bySeat: { role: DeskRole; spend: number }[];
  /**
   * Of the marketing seat's spend, the one-off cost of opening somewhere new.
   *
   * Inside `spend` and inside the CMO's line, and broken out here because it
   * is the one item on the meter that buys no customers this year — it buys
   * permission to have some.
   */
  openingCost: number;
}

/** Mirrors DraftPreview in shared/simulation/levers.ts. */
export interface DraftPreview {
  commitment: Commitment;
  notes: string[];
  warnings: string[];
}

/** The subset of Company the desk sends. Mirrors Company in shared/simulation/types.ts. */
export interface DeskCompany {
  cash: number;
  debt: number;
  creditLimit: number;
  reputation: number;
  quality: number;
  brand: number;
  service: number;
  capacity: number;
  unitCost: number;
  price: number;
  customers: number;
  bankruptSince: number | null;
  /** The seats the engine still charges an executive salary for. Mirrors Company in shared/simulation/types.ts. */
  seats: DeskRole[];
  /**
   * What the founders still own, 0-1. Mirrors Company in shared/simulation/types.ts.
   *
   * Starts whole and only ever goes down: raising money is bought with this,
   * and it is now the thing the league table is ordered by. A team can win a
   * market and own a third of it.
   */
  founderShare?: number;
  /**
   * Research finished and not yet shipped, in quality points.
   *
   * Lands in full next year whatever happens, which is why a company can look
   * flat for a year and then move further in one than anyone could have
   * bought. Mirrors `pipeline` in shared/simulation/types.ts.
   */
  pipeline?: number;
  /** The segment the company has declared itself for, or null for everybody. */
  positioning?: string | null;
  /**
   * What the product owes itself, 0–100. Mirrors `techDebt` in
   * shared/simulation/types.ts.
   *
   * Shipping features runs it up; reliability work does not. Carrying it is
   * never dramatic in one year, which is exactly why a table lets it run.
   */
  techDebt?: number;
  /**
   * What carrying it costs right now, as whole percentages, worked out by the
   * engine before it is sent. Mirrors the `techDebtCost` block the route
   * builds from debtDrag() — server/simulation-desk-routes.ts.
   *
   * Sent rather than derived, and used here rather than recomputed: the shape
   * of the drag is the engine's to own, and a phone that reimplemented it
   * would eventually tell five people a number the tick disagrees with.
   * `product` is how much *less* product spending buys; `unitCost` is how much
   * *more* each unit costs.
   */
  techDebtCost?: { product: number; unitCost: number };
}

/**
 * One place the market exists in, as the desk sends it.
 *
 * Mirrors City in shared/simulation/types.ts, plus the `open` flag the route
 * adds. `open` is the whole reason this is not just a list of options: a city
 * the company already sells in cannot be closed — there is no closing lever —
 * so it is a fact about the company rather than a choice on the form.
 */
export interface DeskCity {
  id: string;
  name: string;
  /** This city's share of the niche's customers. The weights sum to 1. */
  weight: number;
  /** One-off cost of opening here, charged in the year it happens. */
  entryCost: number;
  note: string;
  /** True when the company already sells here. Cannot be deselected. */
  open: boolean;
}

/** Mirrors Economy in shared/simulation/types.ts, plus the sentence the route adds. */
export interface DeskEconomy {
  demand: number;
  interestRate: number;
  costIndex: number;
  outlook: "expansion" | "steady" | "tightening";
  outlookMeans: string;
}

export interface DeskSegment {
  id: string;
  name: string;
  description: string;
  referencePrice: number;
  loyalty: number;
  /** Customers of this segment you currently hold. */
  yours: number;
}

export interface DeskTableSeat {
  userId: string;
  name: string;
  role: DeskRole | null;
  title: string | null;
  filed: boolean;
  /** A seat the product is playing. Labelled here as it is in the lobby. */
  isBot?: boolean;
  isYou: boolean;
}

export interface DeskRival {
  id: string;
  name: string;
  kind: "player" | "incumbent";
  price: number;
  customers: number;
  posture: string | null;
  posturedAs: string | null;
}

/** Mirrors CompanyReport in shared/simulation/types.ts. */
export interface CompanyReport {
  companyId: string;
  name: string;
  year: number;
  customers: number;
  marketShare: number;
  shareChange: number;
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
  /**
   * Where the company stands — ordered by founder-owned value, not customers.
   *
   * Mirrors `rank` in shared/simulation/resolve.ts. Ranking by volume told a
   * small, highly profitable team it was losing every day and made selling
   * more of everything the only strategy; the three fields below are what
   * replaced it.
   */
  rank: number;
  /** What the business is worth: a bit over a year of sales, plus what it owns, less what it owes. */
  value?: number;
  /** That value times the share the founders still hold. What the table is ordered by. */
  founderValue?: number;
  /** 0-1. Optional because reports written before the scoreboard changed have none. */
  founderShare?: number;
  /** The year's prose. Market outcomes are not in here — they have their own field. */
  notes: string[];
  /**
   * What the year's sealed bids did, typed rather than described.
   *
   * Filled in by the tick rather than the engine (settlement happens after a
   * year resolves), and typed so a won bid can be shown differently from a
   * lost one without any client pattern-matching the sentence. Absent on a
   * year with no bids, and on any report written before the field existed.
   */
  market?: ReportMarketNote[];
  /**
   * The year's news, typed.
   *
   * Still prepended into `notes` as prose as well, and deliberately not
   * deduplicated against it: recognising a sentence in order to remove it is
   * the same pattern-matching this field exists to avoid, and it fails
   * silently the first time the copy is edited. The card leads with this and
   * lets the note stand.
   */
  event?: ReportEvent;
  bankrupt: boolean;
}

/**
 * What happened this year, as the report carries it.
 *
 * Mirrors CompanyReport["event"] in shared/simulation/resolve.ts. `mine` is
 * true for anything market-wide and for a company event that landed on this
 * company; `advice` is written to be shown, because there is always something
 * a team can do about it.
 *
 * Worth knowing for the copy around it: events are drawn from the state of the
 * market rather than out of the air — the company with a poor reputation gets
 * the scandal, the one that has been quietly excellent gets the write-up. The
 * dice choose which of the things you had coming arrives, never whether you
 * deserved one. And none of them fire in year one.
 */
export interface ReportEvent {
  headline: string;
  body: string;
  /** What can be done about it. Always present, always worth the room. */
  advice: string;
  scope: "market" | "company";
  /** True when it happened to you — every market event, and your own company's. */
  mine: boolean;
}

/**
 * One settled bid, as the report carries it.
 *
 * Mirrors CompanyReport["market"] in shared/simulation/resolve.ts. `lost`
 * covers both being outbid and nothing clearing the reserve: the company's
 * position is identical either way — no asset, money untouched — and the
 * sentence in `text` still says which of the two happened.
 */
export interface ReportMarketNote {
  kind: "won" | "lost" | "sold" | "unsold";
  text: string;
}

/** One year's decisions from every seat. Mirrors TeamDecisions in shared/simulation/decisions.ts. */
export type FiledDecisions = { companyId?: string } & Partial<Record<DeskRole, Record<string, any>>>;

export interface DeskView {
  /**
   * `over` is a season that closed before year one — too few people in the
   * market. It used to arrive as `not_started`, which is a wait, and the wait
   * never ended because there was nothing left to wait for.
   */
  phase: "not_started" | "over" | "running" | "finished";
  ventureId: string;
  name: string | null;
  product?: string | null;
  niche?: { id: string; name: string; premise: string };
  year?: number;
  totalYears?: number;
  /** ISO timestamp this year resolves at, or null once the season has finished. */
  resolvesAt?: string | null;
  yourRole: DeskRole | null;
  yourTitle?: string | null;
  yourLevers?: string[];
  fields?: LeverField[];
  draft?: Record<string, any> | null;
  submitted?: boolean;
  company?: DeskCompany;
  /** Everywhere this market exists, with the ones the company already sells in flagged. */
  cities?: DeskCity[];
  /**
   * What the company is worth today, floored at 500,000 — the number a raise
   * is priced against.
   *
   * Mirrors the `valuation` sum in server/simulation-desk-routes.ts, which is
   * the engine's own. Sent rather than derived because a guess about how much
   * of your company you are selling is not a thing to put in front of anyone.
   */
  valuation?: number;
  /** How fast quality moves in this market. Mirrors Niche.innovationPace. */
  innovationPace?: number;
  /** Seats nobody holds, for the chief executive's rehire lever. Mirrors the root field of the same name. */
  dissolvedSeats?: string[];
  segments?: DeskSegment[];
  economy?: DeskEconomy;
  table?: DeskTableSeat[];
  filed?: FiledDecisions;
  preview?: DraftPreview;
  lastYear?: CompanyReport | null;
  rivals?: DeskRival[];
  /** This seat's own objective for the year, or null before one is set. */
  challenge?: Challenge | null;
  /** How last year's went. Null in year one. */
  lastChallenge?: ChallengeResult | null;
  /** How much trouble the company is in, and what can be done about it. */
  distress?: DeskDistress;
}

/** What POST /api/sim/ventures/:id/decisions answers with. */
export interface FileDecisionResult {
  ok: boolean;
  year: number;
  draft: Record<string, any>;
  preview: DraftPreview;
}

// --- The sum -------------------------------------------------------------

/** Mirrors fixedCosts() in shared/simulation/decisions.ts. */
export const SALARY_PER_HEAD = 85_000;
/** Mirrors fixedCosts() in shared/simulation/decisions.ts: one salary per filled seat. */
export const EXECUTIVE_SALARY = 140_000;

/**
 * Mirrors fixedCosts() in shared/simulation/decisions.ts.
 *
 * Both halves are now computable on the phone: the desk sends `company.seats`,
 * which is the engine's own seat list and not the same thing as the `table`
 * array — a dissolved seat leaves the table but stops costing a salary, so the
 * two can diverge and only one of them is the bill.
 */
export function fixedCosts(headcount: number, costIndex: number, seatCount: number, reach = 1): number {
  const salaries = num(headcount) * SALARY_PER_HEAD * (Number.isFinite(costIndex) ? costIndex : 1);
  return (salaries + Math.max(0, num(seatCount)) * EXECUTIVE_SALARY) * footprint(reach);
}

/**
 * What selling in more places does to the fixed bill.
 *
 * Mirrors the `footprint` term of fixedCosts() in
 * shared/simulation/decisions.ts: 0.4 of the bill is owed wherever you sell,
 * and the other 0.6 scales with how much of the market you have opened. A
 * one-city company is not a national company with fewer customers — it is a
 * cheaper company — and a preview that assumed a national cost base would
 * overstate the year by more than half.
 *
 * Note which cities count: the ones the company is *already* open in. Opening
 * a new one costs its entry fee this year and only raises this base from next
 * year, which is exactly how the engine charges it.
 */
export const footprint = (reach: number): number =>
  0.4 + 0.6 * clamp01(Number.isFinite(reach) ? reach : 1);

/** Inside 0 and 1, for the fractions the engine keeps there. */
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** A value that may have arrived as a string from a text input, as a number. */
function num(value: any): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * What the table has committed, and what it has.
 *
 * Mirrors commitment() in shared/simulation/levers.ts, term for term —
 * including the details that look like accidents and aren't: the CEO
 * contributes nothing, the CFO's contribution is the *repayment* (money that
 * leaves) and never the drawdown (money that arrives, which is why `borrow`
 * shows up in `available` instead), the COO's headcount is a fixed cost rather
 * than discretionary spend, and `available` counts the unused credit line as
 * money the company has — because it is, and a team that only sees cash
 * over-reads its own danger and under-spends the whole season.
 */
export function commitment(input: {
  company: Pick<DeskCompany, "cash" | "debt" | "creditLimit" | "seats">;
  decisions: FiledDecisions;
  costIndex: number;
  /**
   * How much of the market the company is open in, 0-1 — `reachOf(cities)`.
   * Defaults to the whole market, which is what a company from before cities
   * existed is treated as, and what an incumbent is.
   */
  reach?: number;
  /**
   * The market's map, so the cost of opening somewhere lands on the marketing
   * seat's line. Without it the table's largest single movement of cash is
   * missing from the total the meter exists to show.
   */
  cities?: DeskCity[];
}): Commitment {
  const { company, decisions, costIndex, reach, cities } = input;
  const cmo = decisions.cmo ?? {};
  const cto = decisions.cto ?? {};
  const coo = decisions.coo ?? {};
  const cfo = decisions.cfo ?? {};

  const bySeat: { role: DeskRole; spend: number }[] = [
    { role: "cmo", spend: num(cmo.brandSpend) + num(cmo.performanceSpend) + num(cmo.celebritySpend) },
    // Research is committed money like any other, even though it buys nothing
    // until next year. Mirrors commitment() in shared/simulation/levers.ts.
    { role: "cto", spend: num(cto.featureSpend) + num(cto.reliabilitySpend) + num(cto.techDebtPaydown) + num(cto.researchSpend) },
    { role: "coo", spend: num(coo.supportSpend) + num(coo.efficiencySpend) },
    { role: "cfo", spend: Math.max(0, num(cfo.repay)) },
    { role: "ceo", spend: 0 },
  ];

  /*
   * Opening a city, on the seat that decided to.
   *
   * Charged once, in the year it happens, and it buys no customers at all this
   * year — it buys permission to have some. Mirrors the `openingCost` term in
   * commitment() in shared/simulation/levers.ts, including which list it
   * compares against: what the draft asks for, against where the company
   * already is.
   */
  const opening = openingCost(cities, cmo.targetCities);
  if (opening > 0) {
    const marketing = bySeat.find((s) => s.role === "cmo")!;
    marketing.spend += opening;
  }

  const spend = bySeat.reduce((sum, s) => sum + s.spend, 0);
  const fixed = fixedCosts(num(coo.headcount), costIndex, company.seats?.length ?? 0, reach ?? 1);
  const borrowable = Math.max(0, company.creditLimit - company.debt);
  // A drawdown counts only up to the line, as commitment() and resolve() both
  // clamp it: asking the bank for fifty million against a two-million line
  // brings in two, and a meter that counted the fifty would show a table
  // funded by money that is never coming.
  // The line left after this drawdown, so borrowed money isn't counted twice — the engine's rule.
  const drawn = drawdown(cfo.borrow, company);
  const available = Math.max(0, company.cash + drawn + Math.max(0, borrowable - drawn) - num(cfo.cashBuffer));

  return {
    spend, fixed, available,
    ratio: available > 0 ? (spend + fixed) / available : Infinity,
    bySeat,
    openingCost: opening,
  };
}

/**
 * Everyone's filed decisions, with your unsaved edits standing in for yours.
 *
 * The point of the live total: what you are *about* to commit counts against
 * the table immediately, not when you press the button. A seat with no role
 * changes nothing.
 */
export function withYourDraft(filed: FiledDecisions | undefined, role: DeskRole | null, draft: Record<string, any> | null): FiledDecisions {
  const base: FiledDecisions = { ...(filed ?? {}) };
  if (!role || !draft) return base;
  return { ...base, [role]: draft };
}

/** How over-committed the table is, and how loudly to say so. */
export type CommitmentLevel = "clear" | "tight" | "over";

/**
 * Thresholds mirror the warnings draftPreview() raises in
 * shared/simulation/levers.ts — 0.9 is "almost everything", above 1 the year
 * runs on credit — so the colour on the phone and the sentence from the server
 * can never contradict each other.
 */
export function commitmentLevel(ratio: number): CommitmentLevel {
  if (!Number.isFinite(ratio) || ratio > 1) return "over";
  if (ratio > 0.9) return "tight";
  return "clear";
}

/** How short the table is, or how much is left. Positive means short. */
export const shortfall = (c: Commitment): number => c.spend + c.fixed - c.available;

/**
 * The spend a covenant's cap and a "without spending your way there" target
 * both mean.
 *
 * Mirrors `readMetric("spend")` in shared/simulation/challenges.ts and the sum
 * the tick reviews a covenant against (server/simulation-tick.ts) term for
 * term — the two are deliberately the same number, because a cap and a target
 * that meant different things would make one of them a lie.
 *
 * Read from the decisions rather than from the commitment meter's `bySeat`,
 * because the meter also carries the cost of opening a city, which the
 * engine charges against cash rather than counting as spend here. The
 * covenant adds that fee back on its own — see covenantSpend() below.
 *
 * Research is in it. It was left out here after the engine had put it back:
 * the engine's comment on its own sum explains why (a company under a
 * creditor's cap could pour money into next year's product and stay
 * "compliant"), and the phone kept telling a CTO under a cap they had room
 * the tick would then say they did not. It is also in the sum the finance
 * seat's buffer cuts, so bufferCut() below was under-reading the cut too.
 */
export const discretionarySpend = (decisions: FiledDecisions): number => (
  num(decisions.cmo?.brandSpend) + num(decisions.cmo?.performanceSpend) + num(decisions.cmo?.celebritySpend) +
  num(decisions.cto?.featureSpend) + num(decisions.cto?.reliabilitySpend) + num(decisions.cto?.techDebtPaydown) +
  num(decisions.cto?.researchSpend) +
  num(decisions.coo?.supportSpend) + num(decisions.coo?.efficiencySpend)
);

/**
 * What a creditor's spending cap is reviewed against.
 *
 * Mirrors the covenant review in server/simulation-tick.ts: the discretionary
 * sum above plus the entry fee for every city this year's draft opens. A cap
 * that ignored the fee would let a team under one open half the country and
 * meet the creditor's terms on paper. A challenge's "spend" target does not
 * add the fee (readMetric in shared/simulation/challenges.ts), which is why
 * this is its own function rather than a change to the one above.
 */
export const covenantSpend = (decisions: FiledDecisions, cities: DeskCity[] | undefined): number =>
  discretionarySpend(decisions) + openingCost(cities, decisions.cmo?.targetCities);

/**
 * The part of a drawdown the bank will actually lend.
 *
 * Mirrors the clamp in resolve() (shared/simulation/resolve.ts): whatever the
 * finance seat asks for, what arrives is at most the credit line's unused
 * room. A company from a payload without the line reads as unclamped, which
 * is the old behaviour rather than a made-up limit.
 */
export function drawdown(borrow: any, company: { debt?: number; creditLimit?: number }): number {
  const asked = Math.max(0, num(borrow));
  const limit = Number(company.creditLimit);
  if (!Number.isFinite(limit)) return asked;
  return Math.min(asked, Math.max(0, limit - num(company.debt)));
}

// --- What the product owes itself ----------------------------------------

/**
 * How loudly to say a company's technical debt out loud.
 *
 * Four states rather than a number, because 62 means nothing to four of the
 * five people at the table and "everything the product seat spends buys
 * noticeably less" means something to all of them.
 *
 * The two thresholds are borrowed rather than invented. 40 is where the web
 * desk starts telling the technology seat, and it is roughly where the drag
 * stops being a rounding error (product work buying a fifth less). 55 is the
 * engine's own line: crossing it is the year resolve() writes the company a
 * note about it — shared/simulation/resolve.ts — so a phone that called 60
 * "fine" would be contradicting the report on the same screen.
 */
export type DebtSeverity = "none" | "noted" | "costly" | "severe";

export const DEBT_COSTLY = 40;
export const DEBT_SEVERE = 55;

export function debtSeverity(techDebt: number | undefined): DebtSeverity {
  const held = num(techDebt);
  if (held <= 0) return "none";
  if (held > DEBT_SEVERE) return "severe";
  if (held > DEBT_COSTLY) return "costly";
  return "noted";
}

/**
 * Whether the seat holding the paydown lever should be told, next to it.
 *
 * Same line the web draws, so a table split across a laptop and two phones is
 * not arguing about whether the problem exists.
 */
export const debtWorthSaying = (techDebt: number | undefined): boolean => {
  const level = debtSeverity(techDebt);
  return level === "costly" || level === "severe";
};

/**
 * The two percentages as one sentence, in the terms a marketing seat can
 * argue with.
 *
 * Both numbers come down from the server already whole — see `techDebtCost` on
 * DeskCompany — so this only decides which of them is worth a clause. A debt
 * small enough to round both to zero gets a sentence that says so rather than
 * "buys 0% less", which reads as a bug.
 */
export function debtCostRead(cost: DeskCompany["techDebtCost"] | undefined): string {
  const product = Math.max(0, Math.round(num(cost?.product)));
  const unitCost = Math.max(0, Math.round(num(cost?.unitCost)));
  if (product <= 0 && unitCost <= 0) return "It isn't costing anything you'd notice yet.";
  if (product <= 0) return `Every unit costs ${unitCost}% more to make and serve.`;
  if (unitCost <= 0) return `Product spending buys ${product}% less than it would.`;
  return `Product spending buys ${product}% less than it would, and every unit costs ${unitCost}% more.`;
}

// --- The finance seat's ring-fence ---------------------------------------

/**
 * What the buffer would do to this table's year, if the year ran now.
 *
 * `cashBuffer` used to be read by the commitment preview and by nothing else:
 * a finance seat could ring-fence the company's last two million, watch the
 * number move on their own screen, and watch it be spent anyway. It now binds
 * — spending above it is cut back, every seat's by the same fraction — so it
 * is worth the phone saying whose year is about to get smaller.
 *
 * Mirrors the `allowed` term in resolve() (shared/simulation/resolve.ts) term
 * for term, and note the two places it deliberately disagrees with the
 * commitment meter directly above it:
 *
 * - **The credit line is in it, the same way the engine counts it**: cash,
 *   plus what the finance seat draws down (clamped to the line), plus the
 *   credit still unused, less the buffer. This used to leave the unused
 *   credit out, on the belief that the engine did — it does not, and the
 *   phone was warning tables about cuts the year would never make. It still
 *   differs from the meter in what it measures against: the meter counts the
 *   fixed bill and the cost of opening a city, and the cut does not.
 * - **What gets cut is the sum a challenge's spend target counts**:
 *   marketing, product (research included) and ops. Not the fee for opening a
 *   city, not a repayment, and not the fixed bill — salaries are owed
 *   whatever anybody decided.
 *
 * Returns null when nothing would be cut, which is the ordinary case.
 */
export interface BufferCut {
  /** What finance is holding back. */
  buffer: number;
  /** What the table has asked to spend out of the money the cut applies to. */
  wanted: number;
  /** What is left for them to spend after the buffer. */
  spendable: number;
  /** The fraction of every seat's spend that survives, 0–1. */
  allowed: number;
  /** How much of the table's year disappears. */
  cut: number;
}

export function bufferCut(input: {
  /** Debt and the line are optional so an old payload reads as "no credit", not as NaN. */
  company: Pick<DeskCompany, "cash"> & Partial<Pick<DeskCompany, "debt" | "creditLimit">>;
  decisions: FiledDecisions;
}): BufferCut | null {
  const { company, decisions } = input;
  const buffer = Math.max(0, num(decisions.cfo?.cashBuffer));
  const unused = Math.max(0, num(company.creditLimit) - num(company.debt));
  const drawn = drawdown(decisions.cfo?.borrow, company);
  const spendable = Math.max(0, num(company.cash) + drawn + Math.max(0, unused - drawn) - buffer);
  const wanted = discretionarySpend(decisions);
  if (wanted <= 0 || wanted <= spendable) return null;
  const allowed = spendable / wanted;
  return { buffer, wanted, spendable, allowed, cut: wanted - wanted * allowed };
}

/**
 * What one seat's own draft becomes after the cut.
 *
 * The table's total is the mechanic; this is the number the person reading it
 * is actually deciding about. Zero for a seat that spends nothing the cut
 * touches — the chief executive, and a finance seat whose only outgoing is a
 * repayment — which is why it is worth showing "nothing of yours" rather than
 * hiding the warning from them.
 */
export function seatShare(role: DeskRole | null | undefined, draft: Record<string, any> | null | undefined): number {
  if (!role || !draft) return 0;
  return discretionarySpend({ [role]: draft } as FiledDecisions);
}

// --- The clock -----------------------------------------------------------

/**
 * Seconds until the year resolves, from an ISO timestamp.
 *
 * Unlike the lobby's `secondsLeft`, the desk sends an absolute time, so the
 * phone's clock is the one doing the arithmetic. That is fine at this scale —
 * being ninety seconds out on a deadline twenty hours away changes nothing,
 * where in a two-minute claiming phase it would change everything — but it is
 * the reason this is a different function rather than the lobby's reused.
 */
export function secondsUntil(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, (at - nowMs) / 1000);
}

/**
 * "1d 23h", "3h 25m", "12:04", "9s".
 *
 * Mirrors longCountdown() in shared/simulation/lobby-copy.ts, thresholds
 * included. The lobby's mm:ss is right for a phase that lasts minutes and
 * wrong for a year that lasts a day — it rendered a deadline as "2878:46" on
 * web, which is technically minutes and seconds and means nothing to anyone.
 * Past an hour the units get spelled out; inside one, seconds still matter
 * because that is when people are actually watching the number.
 */
export function formatUntil(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return `${safe}s`;

  const minutes = Math.floor(safe / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (hours < 1) return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
  if (days < 1) return `${hours}h ${minutes % 60}m`;
  return `${days}d ${hours % 24}h`;
}

/** Inside the last half hour, filing stops being a plan and starts being a deadline. */
export const resolveIsImminent = (seconds: number | null): boolean =>
  seconds != null && Number.isFinite(seconds) && seconds <= 30 * 60;

// --- The form ------------------------------------------------------------

/** What a stepper moves by when the field doesn't say. */
export function stepFor(field: LeverField): number {
  if (field.step && field.step > 0) return field.step;
  return field.kind === "money" ? 50_000 : 1;
}

/**
 * One tap of + or −, clamped to the field's own bounds.
 *
 * Typing 1500000 on a phone keyboard is how a CMO commits ten times what they
 * meant to, so the steppers are the primary control and the keyboard is the
 * fallback. Stepping lands on multiples of the step from zero rather than from
 * wherever the value happened to be, so a draft carried over from last year
 * tidies itself up instead of staying at 1,237,000 forever.
 */
export function bump(field: LeverField, value: any, direction: 1 | -1): number {
  const step = stepFor(field);
  const current = num(value);
  const snapped = direction > 0
    ? Math.floor(current / step + 1e-9) * step + step
    : Math.ceil(current / step - 1e-9) * step - step;
  return clampToField(field, snapped);
}

/** Inside min/max, and never a fractional count of people. */
export function clampToField(field: LeverField, value: number): number {
  let n = Number.isFinite(value) ? value : 0;
  if (field.kind === "count") n = Math.round(n);
  if (field.min !== undefined) n = Math.max(field.min, n);
  if (field.max !== undefined) n = Math.min(field.max, n);
  return n;
}

// --- Where you sell ------------------------------------------------------
// Mirrors the `cities` lever in shared/simulation/levers.ts, the entry charge
// in shared/simulation/resolve.ts, and reachOf() in shared/simulation/market.ts.
//
// This is the biggest lever on the desk and the only one whose effect is
// categorical rather than gradual: a person who lives somewhere the company
// has not opened cannot choose it, however good the product is, however loud
// the marketing. Everything else on this screen is a multiplier on a number
// that is zero until a city is open.

/**
 * The cities a draft is asking for, with the already-open ones kept.
 *
 * An open city cannot be given up — there is no closing lever, and the engine
 * unions what you send with where you already are — so the honest reading of
 * any draft is "everywhere I am, plus whatever else is ticked". Returned in
 * the payload's own order so two equal selections are never two different
 * arrays.
 */
export function selectedCities(cities: DeskCity[] | undefined, value: any): string[] {
  const all = cities ?? [];
  const asked = new Set((Array.isArray(value) ? value : []).map(String));
  return all.filter((city) => city.open || asked.has(city.id)).map((city) => city.id);
}

/**
 * Ticking or unticking one city.
 *
 * An open city is a no-op rather than an error: the control is rendered
 * locked, and a tap that silently did nothing is better than one that removed
 * a city from the payload the server would put straight back.
 */
export function toggleCity(cities: DeskCity[] | undefined, value: any, id: string): string[] {
  const all = cities ?? [];
  const city = all.find((c) => c.id === id);
  if (!city || city.open) return selectedCities(all, value);
  const chosen = new Set(selectedCities(all, value));
  if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
  return all.filter((c) => c.open || chosen.has(c.id)).map((c) => c.id);
}

/** The cities this draft would open that aren't open already — what the entry fee is for. */
export function citiesOpening(cities: DeskCity[] | undefined, value: any): DeskCity[] {
  const chosen = new Set(selectedCities(cities, value));
  return (cities ?? []).filter((city) => !city.open && chosen.has(city.id));
}

/**
 * What opening them costs, once.
 *
 * Part of `commitment()` — it lands on the marketing seat's line, as it does
 * on the server. Whether the engine books it as discretionary spend or as a
 * cash movement is bookkeeping; it is the same money leaving, and a table that
 * opened three cities for 1.7m while the meter stayed comfortable found out at
 * the tick. Still computed on its own as well, so the picker can show what a
 * particular selection costs while somebody is still choosing.
 */
export const openingCost = (cities: DeskCity[] | undefined, value: any): number =>
  citiesOpening(cities, value).reduce((sum, city) => sum + (Number.isFinite(city.entryCost) ? city.entryCost : 0), 0);

/**
 * The fraction of the market that can even consider you.
 *
 * Mirrors reachOf() in shared/simulation/market.ts. With no argument it reads
 * the open cities, which is what the fixed-cost base is charged against today;
 * pass a draft's selection to see what this year's decision would buy.
 */
export function reachOf(cities: DeskCity[] | undefined, ids?: string[]): number {
  const all = cities ?? [];
  if (all.length === 0) return 1;
  const open = new Set(ids ?? all.filter((c) => c.open).map((c) => c.id));
  return clamp01(all.filter((c) => open.has(c.id)).reduce((sum, c) => sum + (Number.isFinite(c.weight) ? c.weight : 0), 0));
}

/**
 * Reach as a sentence, because the percentage alone reads as a score.
 *
 * It isn't one. It is a ceiling: the share of people who are allowed to pick
 * you at all, before anything about the product is considered.
 */
export function reachRead(reach: number): string {
  const pct = clamp01(Number.isFinite(reach) ? reach : 0) * 100;
  if (pct >= 99.5) return "Everyone in the market can buy from you.";
  return `${pct < 1 ? "<1" : Math.round(pct)}% of the market can buy from you at all. The rest can't choose you however good you are.`;
}

// --- Raising money -------------------------------------------------------

/**
 * What a raise costs in ownership.
 *
 * Mirrors the dilution in shared/simulation/resolve.ts: an investor buys a
 * share of everything the company becomes, priced against what it is worth
 * *now*, with a floor of 500,000 under that valuation. Which is the whole
 * point of the lever and the part a number says better than any sentence —
 * raising 2m against a company worth 2m gives away half of it.
 *
 * The valuation is the desk's own `valuation` field, which is the engine's
 * arithmetic rather than a client's guess, and it is there in year one — which
 * is exactly when raising is most expensive and the warning matters most.
 */
export const RAISE_VALUATION_FLOOR = 500_000;

export function dilutionPreview(input: {
  /** What the founders hold now, 0-1. */
  founderShare: number;
  /** What the business is worth — the desk's `valuation`. */
  worth: number | null | undefined;
  raise: number;
}): { nextShare: number; given: number } | null {
  const raise = num(input.raise);
  const share = Number.isFinite(input.founderShare) ? clamp01(input.founderShare) : 1;
  if (raise <= 0 || input.worth == null || !Number.isFinite(input.worth)) return null;
  const worth = Math.max(RAISE_VALUATION_FLOOR, input.worth);
  const nextShare = Math.max(0.05, share * (worth / (worth + raise)));
  return { nextShare, given: Math.max(0, share - nextShare) };
}

// --- Research ------------------------------------------------------------

/**
 * Diminishing returns, as the engine draws them.
 *
 * Mirrors `saturate` in shared/simulation/market.ts: money buys half the
 * ceiling at the half-way spend and never quite reaches the ceiling, which is
 * why the fourth million of research is worth so much less than the first.
 */
export const saturate = (value: number, half: number): number => (value <= 0 ? 0 : value / (value + half));

/** Mirrors lift() in shared/simulation/decisions.ts. */
export const lift = (spend: number, half: number, ceiling: number): number =>
  saturate(Math.max(0, num(spend)), half) * ceiling;

/** Mirrors the research half-spend and ceiling in shared/simulation/resolve.ts. */
export const RESEARCH_HALF = 150_000;
export const RESEARCH_CEILING = 24;

/**
 * The quality this year's research will land next year.
 *
 * Mirrors `lift(researchSpend, 150_000, 24) * niche.innovationPace` in
 * shared/simulation/resolve.ts exactly rather than approximately — the whole
 * value of the number is that a CTO can weigh "nothing this year" against
 * something specific, and a number that is nearly right is a number that will
 * be wrong on next year's report with nobody able to say why.
 */
export const researchLanding = (spend: any, innovationPace: number | undefined): number =>
  lift(num(spend), RESEARCH_HALF, RESEARCH_CEILING) * (Number.isFinite(innovationPace) ? (innovationPace as number) : 1);

/** One decimal, and no trailing zero: quality points are read as "+7.4", not "+7.40". */
export const qualityRead = (points: number): string =>
  !Number.isFinite(points) ? "—" : trim((Math.round(points * 10) / 10).toFixed(1));

/**
 * "62%" — ownership, at the precision people argue at.
 *
 * A whole number above one per cent, because "61.7%" invites an argument about
 * a tenth of a point that no decision in this game turns on; below that, one
 * decimal, since the difference between 0.4% and 0.9% of a company is the
 * difference between a footnote and a founder.
 */
export function shareOwnedRead(share: number | null | undefined): string {
  if (share == null || !Number.isFinite(share)) return "—";
  const pct = clamp01(share) * 100;
  if (pct > 0 && pct < 1) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

/**
 * Whether this draft is submittable, and why not.
 *
 * Mirrors validateDecision() in shared/simulation/levers.ts — deliberately
 * including what it *doesn't* check. An expensive year is not an invalid one:
 * spending more than the company has is a decision the table is allowed to
 * make, and saying what it costs is the commitment meter's job. A form that
 * refuses the risky answer is a form that plays the game for you.
 *
 * The server validates again and wins; this only exists so the errors appear
 * under the right control before a round trip, and so the button can be honest
 * about being disabled.
 */
export function validateDraft(
  fields: LeverField[],
  draft: Record<string, any>,
  company: Pick<DeskCompany, "debt"> & Partial<Pick<DeskCompany, "creditLimit">>,
  role: DeskRole | null,
): { ok: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const value = draft?.[field.id];

    /*
     * The one choice that has to be answered. Mirrors the `focus` special case
     * in validateDecision(): every other choice on the desk is allowed to be
     * left alone, and only the chief executive's focus is a question the year
     * cannot run without.
     */
    if (field.kind === "choice" && field.id === "focus") {
      if (!field.options?.some((o) => o.value === value)) errors[field.id] = "Pick one.";
      continue;
    }

    if (field.kind === "choice") {
      // A choice the season has nothing to offer for — no dissolved seats to
      // rehire — is skipped rather than refused. The screen says so in words;
      // an error under an empty control would be the form blaming somebody for
      // not answering a question it never asked.
      if ((field.options?.length ?? 0) === 0) continue;
      if (value !== undefined && value !== null && value !== "" && !field.options!.some((o) => o.value === value)) {
        errors[field.id] = "Pick one.";
      }
      continue;
    }

    // A list of places, and an empty one is a real answer — the company still
    // sells wherever it is already open.
    if (field.kind === "cities") {
      if (value !== undefined && !Array.isArray(value)) errors[field.id] = "Pick the places you sell.";
      continue;
    }

    // A company is allowed to be for everybody, which is what "" means.
    if (field.kind === "segment") {
      if (value !== undefined && value !== null && value !== "" && typeof value !== "string") {
        errors[field.id] = "Pick one, or none.";
      }
      continue;
    }

    if (value === undefined || value === null || value === "") { errors[field.id] = "Needs a number."; continue; }
    const n = Number(value);
    if (!Number.isFinite(n)) { errors[field.id] = "Needs a number."; continue; }
    if (field.min !== undefined && n < field.min) errors[field.id] = `Can't go below ${field.min}.`;
    if (field.max !== undefined && n > field.max) errors[field.id] = `Can't go above ${field.max}.`;
  }

  // The one hard stop the server keeps: you cannot repay money you do not owe.
  if (role === "cfo" && Number(draft?.repay) > company.debt) {
    errors.repay = `You only owe ${Math.round(company.debt).toLocaleString()}.`;
  }

  /*
   * And the other: you cannot draw down credit the bank has not extended.
   * Mirrors the borrow check in validateDecision(), message included, so the
   * words under the box are the ones the server would send back. Skipped when
   * the payload carries no credit line, rather than inventing one.
   */
  if (role === "cfo" && Number.isFinite(Number(company.creditLimit))) {
    const room = Math.max(0, Number(company.creditLimit) - company.debt);
    if (Number(draft?.borrow) > room) {
      errors.borrow = room > 0
        ? `The bank will lend at most ${Math.round(room).toLocaleString()} more.`
        : "The credit line is fully drawn. Repay some of it, or raise from investors.";
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

/** True when nothing has been touched since the last file, so the button can say "Filed". */
export function draftMatches(a: Record<string, any> | null | undefined, b: Record<string, any> | null | undefined): boolean {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const l = a[key];
    const r = b[key];
    // No lever sends a list today; kept because the comparison is cheap and a
    // silent false-equal on one would show "nothing to change" over a real edit.
    if (Array.isArray(l) || Array.isArray(r)) {
      if (JSON.stringify(l ?? []) !== JSON.stringify(r ?? [])) return false;
      continue;
    }
    if (typeof l === "number" || typeof r === "number") {
      if (num(l) !== num(r)) return false;
      continue;
    }
    if ((l ?? null) !== (r ?? null)) return false;
  }
  return true;
}

// --- Reading the numbers -------------------------------------------------

/**
 * "6.2m", "850k", "−1.4m".
 *
 * No currency symbol, because the engine's own warnings don't use one and a
 * screen that says "£6,200,000" beside a server sentence that says "6,200,000"
 * reads as two different numbers.
 */
export function money(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return `${sign}${m >= 10 ? Math.round(m) : trim(m.toFixed(1))}m`;
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    return `${sign}${k >= 10 ? Math.round(k) : trim(k.toFixed(1))}k`;
  }
  return `${sign}${Math.round(abs)}`;
}

const trim = (s: string) => (s.endsWith(".0") ? s.slice(0, -2) : s);

/** The exact figure, for the places where rounding to "6.2m" would hide the point. */
export const exact = (n: number): string => (Number.isFinite(n) ? Math.round(n).toLocaleString() : "—");

/** A signed number, for changes that read better with the direction in front. */
export const signed = (n: number, digits = 0): string =>
  !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}`;

/** "12.4%" from a 0–1 share. */
export const percent = (fraction: number, digits = 1): string =>
  Number.isFinite(fraction) ? `${(fraction * 100).toFixed(digits)}%` : "—";

/**
 * What the coming weather means, in a word, when the server's sentence is too
 * long for a pill. Mirrors the outlooks in shared/simulation/types.ts.
 */
export const OUTLOOK_LABEL: Record<DeskEconomy["outlook"], string> = {
  expansion: "Busier next year",
  steady: "Steady next year",
  tightening: "Thinner next year",
};

/** Who the table is still waiting on, in seat order. */
export function waitingOn(table: DeskTableSeat[] | undefined): DeskTableSeat[] {
  const seats = table ?? [];
  const rank = (r: DeskRole | null) => (r ? ROLE_ORDER.indexOf(r) : ROLE_ORDER.length);
  return seats.filter((s) => !s.filed).sort((a, b) => rank(a.role) - rank(b.role));
}

/**
 * The one line about where the table is.
 *
 * Said in terms of people rather than counts — "waiting on Priya and Sam" is
 * something you can act on in the group chat; "3/5 filed" is a progress bar.
 */
export function tableStatus(table: DeskTableSeat[] | undefined): string {
  const seats = table ?? [];
  if (seats.length === 0) return "Nobody at the table yet.";

  const pending = waitingOn(seats);
  if (pending.length === 0) return "Everyone has filed. The year resolves on the tick.";

  const others = pending.filter((s) => !s.isYou).map((s) => s.name);
  if (others.length === 0) return "You're the only one who hasn't filed.";

  const list = others.length === 1
    ? others[0]
    : `${others.slice(0, -1).join(", ")} and ${others[others.length - 1]}`;

  return pending.some((s) => s.isYou) ? `Waiting on ${list} — and on you.` : `Waiting on ${list}.`;
}

// --- Your own year, inside five people's company -------------------------
// Mirrors shared/simulation/challenges.ts. The challenge is the one thing on
// this screen that is *yours*: the company's result is four other people too,
// and a seat that was dealt at random needs its own answer to "did I play this
// well". Which is also why none of it is paraphrased here — the server writes
// the brief against the company's actual position, and a screen that
// summarises it away turns a sentence written for you into a status line.

/** Mirrors MetricId in shared/simulation/challenges.ts. */
export type MetricId =
  | "customers" | "market_share" | "revenue" | "profit" | "reputation" | "quality"
  | "brand" | "service" | "price" | "unit_cost" | "cash" | "debt" | "turned_away"
  | "capacity" | "spend";

/** Mirrors Target in shared/simulation/challenges.ts. */
export interface Target {
  id: string;
  label: string;
  goal: number;
  compare: "at_least" | "at_most";
  metric: MetricId;
}

/** Mirrors Reward in shared/simulation/challenges.ts. */
export interface Reward {
  kind: "reputation" | "cash" | "capacity" | "credit";
  amount: number;
  label: string;
}

/** Mirrors Challenge in shared/simulation/challenges.ts. */
export interface Challenge {
  id: string;
  role: DeskRole;
  year: number;
  title: string;
  brief: string;
  targets: Target[];
  reward: Reward;
  partialReward: Reward;
}

/** Mirrors TargetResult in shared/simulation/challenges.ts. */
export interface TargetResult extends Target {
  actual: number;
  met: boolean;
}

/** Mirrors ChallengeResult in shared/simulation/challenges.ts. */
export interface ChallengeResult {
  challengeId: string;
  role: DeskRole;
  year: number;
  outcome: "met" | "partial" | "missed";
  targets: TargetResult[];
  note: string;
  reward: Reward | null;
}

/**
 * Where a target's number can be read from today.
 *
 * `now` is the company as it stands — a live figure the player can act on.
 * `committed` is this year's draft spending, which is a real number about the
 * year in progress rather than a guess at its outcome. `unknown` is the honest
 * answer for everything the year has to actually *run* to produce.
 */
export type ProgressSource = "now" | "committed" | "unknown";

export interface TargetProgress {
  target: Target;
  /** Null when the number can't be known before the tick. */
  actual: number | null;
  source: ProgressSource;
  /** Whether it would pass if the year ended on today's figure. Null when unknown. */
  met: boolean | null;
  /** 0–1 for a bar. Null when unknown. */
  fraction: number | null;
}

/** The metrics the desk payload already carries a live value for. */
const LIVE_METRICS: Partial<Record<MetricId, (c: DeskCompany) => number>> = {
  customers: (c) => c.customers,
  reputation: (c) => c.reputation,
  quality: (c) => c.quality,
  brand: (c) => c.brand,
  service: (c) => c.service,
  price: (c) => c.price,
  unit_cost: (c) => c.unitCost,
  cash: (c) => c.cash,
  debt: (c) => c.debt,
  capacity: (c) => c.capacity,
};

/**
 * Why a target has no number yet, said as a fact rather than an apology.
 *
 * These four are outcomes of the year rather than states of the company:
 * nothing the phone holds could produce them, and inventing a stand-in — last
 * year's profit shown under this year's target — would be a screen quietly
 * telling somebody they were 40% of the way to something they hadn't started.
 */
export const METRIC_PENDING: Partial<Record<MetricId, string>> = {
  market_share: "Known when the year resolves",
  revenue: "Known when the year resolves",
  profit: "Known when the year resolves",
  turned_away: "Known when the year resolves",
};

/**
 * How far along one target is, from what the desk already knows.
 *
 * `spend` is the interesting case: it is not a state of the company, but it
 * *is* this year's committed discretionary spending, which the phone computes
 * anyway for the commitment meter. So a "without spending your way there"
 * target can be answered live, from the same sum — the CMO who is about to
 * break their own ceiling finds out while their thumb is on the number.
 */
export function targetProgress(target: Target, from: {
  company?: Pick<DeskCompany, "customers" | "reputation" | "quality" | "brand" | "service" | "price" | "unitCost" | "cash" | "debt" | "capacity"> | null;
  /** This year's discretionary spend, as the commitment meter computes it. */
  committedSpend?: number | null;
  /**
   * The price in the marketing seat's draft.
   *
   * A price target is judged on the price the year was sold at — readMetric()
   * reads the company after the year, whose price is the one the CMO filed —
   * so measuring it against today's price told a CMO who had just typed the
   * right number that they were still missing the target, and the reverse.
   */
  draftedPrice?: number | null;
}): TargetProgress {
  const read = LIVE_METRICS[target.metric];
  let actual: number | null = null;
  let source: ProgressSource = "unknown";

  if (target.metric === "spend" && from.committedSpend != null && Number.isFinite(from.committedSpend)) {
    actual = from.committedSpend;
    source = "committed";
  } else if (target.metric === "price" && from.draftedPrice != null && from.draftedPrice !== ("" as any) && Number.isFinite(Number(from.draftedPrice))) {
    actual = Number(from.draftedPrice);
    source = "committed";
  } else if (read && from.company) {
    const value = read(from.company as DeskCompany);
    if (Number.isFinite(value)) { actual = value; source = "now"; }
  }

  if (actual == null) return { target, actual: null, source: "unknown", met: null, fraction: null };

  const met = target.compare === "at_least" ? actual >= target.goal : actual <= target.goal;
  return { target, actual, source, met, fraction: fractionOf(target, actual) };
}

/**
 * The bar, for targets that have one.
 *
 * An "at most" target is drawn as room left rather than distance travelled —
 * full while you are inside it, and shrinking as you approach the ceiling —
 * because "don't go above 24" is a budget, and a budget bar that fills up as
 * you spend is the one everybody already knows how to read.
 */
function fractionOf(target: Target, actual: number): number {
  if (target.compare === "at_least") {
    if (target.goal <= 0) return actual >= target.goal ? 1 : 0;
    return clamp01(actual / target.goal);
  }
  if (actual <= target.goal) return 1;
  if (target.goal <= 0 || actual <= 0) return 0;
  return clamp01(target.goal / actual);
}

/** Every target, in the order the challenge lists them. */
export const challengeProgress = (
  challenge: Challenge,
  from: Parameters<typeof targetProgress>[1],
): TargetProgress[] => challenge.targets.map((t) => targetProgress(t, from));

/**
 * Where the challenge stands, counted rather than judged.
 *
 * `pending` matters as much as `met`: "one of two, one still to settle" is a
 * true sentence, where "one of two" alone reads as a half-failure to somebody
 * whose other target simply cannot be known until the tick.
 */
export function challengeStanding(progress: TargetProgress[]): {
  met: number; missing: number; pending: number; of: number; line: string;
} {
  const met = progress.filter((p) => p.met === true).length;
  const missing = progress.filter((p) => p.met === false).length;
  const pending = progress.filter((p) => p.met == null).length;
  const of = progress.length;

  const line = of === 0 ? "Nothing set this year."
    : pending === of ? "Both settle when the year runs."
      : missing === 0 && pending === 0 ? "On both, as things stand."
        : met === 0 && pending === 0 ? "Neither, on today's numbers."
          : `${met} of ${of} on today's numbers${pending > 0 ? `, ${pending} still to settle` : ""}.`;

  return { met, missing, pending, of, line };
}

/**
 * A metric's value, in the units that metric is actually read in.
 *
 * Mirrors fmt() in shared/simulation/challenges.ts closely enough that the
 * server's own note ("got 23.40") and the number above it agree. A unit cost
 * of 23.4 shown as "23" beside a goal of 23.15 would be a screen telling
 * somebody they had hit a target they had missed.
 */
/** "23.40" → "23.4", "24.00" → "24". The pennies only when there are any. */
const trimZeros = (s: string): string => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

export function metricRead(metric: MetricId, value: number): string {
  if (!Number.isFinite(value)) return "—";
  switch (metric) {
    case "market_share": return `${value.toFixed(1)}%`;
    case "price":
    case "unit_cost": return Math.abs(value) >= 1_000 ? exact(value) : trimZeros(value.toFixed(2));
    case "reputation":
    case "quality":
    case "brand":
    case "service": return String(Math.round(value));
    default: return money(value);
  }
}

/** "at least 45,000" / "at most 24.20", as the target would be said aloud. */
export const targetGoalRead = (target: Target): string =>
  `${target.compare === "at_least" ? "at least" : "at most"} ${metricRead(target.metric, target.goal)}`;

/**
 * The prize, in four words.
 *
 * The reward's own `label` is the sentence and stays the sentence; this is the
 * badge that goes beside the title, because "+750k credit" is what a player
 * compares against the risk of missing.
 */
export function rewardRead(reward: Reward): string {
  switch (reward.kind) {
    case "reputation": return `+${Math.round(reward.amount)} reputation`;
    case "capacity": return `+${Math.round(reward.amount * 100)}% capacity`;
    case "cash": return `+${money(reward.amount)} cash`;
    case "credit": return `+${money(reward.amount)} credit`;
  }
}

/** How a finished challenge is coloured and named. Mirrors the outcomes in checkChallenge(). */
export const OUTCOME_LABEL: Record<ChallengeResult["outcome"], string> = {
  met: "Done",
  partial: "Half of it",
  missed: "Missed",
};

// --- Trouble, and the way out of it --------------------------------------
// Mirrors shared/simulation/recovery.ts. The copy there is written to be read
// before choosing — every option states what it costs in the same breath as
// what it raises — so this file carries the shapes and the arithmetic and
// leaves every sentence to the server.

/** Mirrors Distress in shared/simulation/recovery.ts. */
export type Distress = "healthy" | "strained" | "distressed" | "insolvent";

/** Mirrors RecoveryKind in shared/simulation/recovery.ts. */
export type RecoveryKind = "restructure" | "fire_sale" | "dissolve_seat" | "rescue_raise";

/** Mirrors RecoveryOption in shared/simulation/recovery.ts. */
export interface RecoveryOption {
  kind: RecoveryKind;
  title: string;
  body: string;
  /** What it costs, said out loud before they choose it. Never summarised away. */
  cost: string;
  raises: number;
  from: Distress[];
}

/** Mirrors Covenant in shared/simulation/recovery.ts. */
export interface Covenant {
  since: number;
  spendCap: number;
  /** Consecutive years met so far. */
  met: number;
  rateRelief: number;
}

/** What GET /api/sim/ventures/:id/desk sends under `distress`. */
export interface DeskDistress {
  level: Distress;
  title: string;
  body: string;
  options: RecoveryOption[];
  covenant: Covenant | null;
  filed: { kind: RecoveryKind; seat: string | null } | null;
}

/** Mirrors COVENANT_YEARS in shared/simulation/recovery.ts. */
export const COVENANT_YEARS = 2;

/** Worst first, so a comparison between two states is an ordering and not a lookup. */
export const DISTRESS_RANK: Record<Distress, number> = { healthy: 0, strained: 1, distressed: 2, insolvent: 3 };

/** True when the state is worth putting at the top of the desk. */
export const inTrouble = (level: Distress | undefined): boolean => !!level && level !== "healthy";

/** Only the chief executive files one — see the 403 in server/simulation-market-routes.ts. */
export const canFileRecovery = (role: DeskRole | null | undefined): boolean => role === "ceo";

/** The one move that needs an answer before it can be filed. */
export const recoveryNeedsSeat = (kind: RecoveryKind): boolean => kind === "dissolve_seat";

/**
 * The seats that can be dissolved: every filled one except the chair.
 *
 * The server refuses `ceo` with a 400, and a picker that offers a choice the
 * server will refuse is a picker that teaches people to distrust it.
 */
export const dissolvableSeats = (seats: DeskRole[] | undefined): DeskRole[] =>
  (seats ?? []).filter((s) => s !== "ceo").sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));

/**
 * Whether this move can be filed, and what to say instead.
 *
 * Mirrors the checks in POST /api/sim/ventures/:id/recovery, in the order the
 * server applies them, so the reason shown before the request is the reason
 * that would come back from it.
 */
export function validateRecovery(input: {
  kind: RecoveryKind | null;
  seat: DeskRole | null;
  options: RecoveryOption[];
  seats: DeskRole[] | undefined;
  role: DeskRole | null;
}): { ok: boolean; error: string | null } {
  const { kind, seat, options, seats, role } = input;
  if (!canFileRecovery(role)) {
    return { ok: false, error: "These change what the company is. They're the chief executive's call." };
  }
  if (!kind) return { ok: false, error: null };
  if (!options.some((o) => o.kind === kind)) {
    return { ok: false, error: "That move isn't available in this position." };
  }
  if (recoveryNeedsSeat(kind)) {
    if (!seat) return { ok: false, error: "Pick the seat to dissolve." };
    if (seat === "ceo") return { ok: false, error: "You can't dissolve your own chair." };
    if (!(seats ?? []).includes(seat)) return { ok: false, error: "That seat isn't filled." };
  }
  return { ok: true, error: null };
}

/**
 * How far through the covenant the company is, and what is left of it.
 *
 * This is the visible way out, and it is the thing that makes distress an arc
 * rather than a hole: two years inside the cap and the creditor lets go. So it
 * is drawn as progress — met/2 — rather than reported as a restriction.
 */
export function covenantProgress(covenant: Covenant): {
  met: number; of: number; remaining: number; fraction: number; line: string;
} {
  const met = Math.max(0, Math.min(COVENANT_YEARS, Math.round(covenant.met)));
  const remaining = Math.max(0, COVENANT_YEARS - met);
  return {
    met,
    of: COVENANT_YEARS,
    remaining,
    fraction: met / COVENANT_YEARS,
    line: remaining === 0
      ? "The terms are met. The cap lifts."
      : met === 0
        ? `${COVENANT_YEARS} clear years inside the cap and it lifts.`
        : `One more year inside the cap and it lifts.`,
  };
}

/**
 * How much of the spending cap this year's draft has used.
 *
 * The cap is on discretionary spend — what the four spending seats commit,
 * plus whatever opening a city costs — and the covenant is reviewed against
 * what was actually spent. Pass covenantSpend(), which is that sum; the
 * commitment meter's total also carries the fixed bill and is not it.
 */
export function capUse(spend: number, covenant: Covenant | null | undefined): {
  over: boolean; fraction: number; left: number;
} | null {
  if (!covenant) return null;
  const cap = Math.max(0, covenant.spendCap);
  const used = Math.max(0, Number.isFinite(spend) ? spend : 0);
  return {
    over: used > cap,
    fraction: cap > 0 ? used / cap : used > 0 ? Infinity : 0,
    left: cap - used,
  };
}
