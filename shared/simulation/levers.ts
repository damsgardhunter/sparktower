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
import type { Company, Niche, Role } from "./types";
import type { TeamDecisions } from "./decisions";
import { interlock, fixedCosts } from "./decisions";
import { reachOf } from "./market";

/** How a lever is presented and bounded. */
export interface LeverField {
  /** Key inside the role's decision object. */
  id: string;
  label: string;
  /** One line on what moving it actually does. */
  help: string;
  kind: "money" | "price" | "count" | "choice" | "cities" | "segment";
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string; help: string }[];
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
      help: "What one customer pays. Segments differ wildly in how much they care — the bargain hunters leave over a pound, the coached athletes barely look." },
    { id: "brandSpend", label: "Brand marketing", kind: "money", min: 0, step: 50_000,
      help: "Being known. Slow, compounding, and the thing that makes every other pound work harder." },
    { id: "performanceSpend", label: "Performance marketing", kind: "money", min: 0, step: 50_000,
      help: "Buying customers now. Faster than brand and it stops the moment you stop paying." },
    { id: "celebritySpend", label: "Sponsorship", kind: "money", min: 0, step: 100_000,
      help: "A shortcut to being known, at a premium. Worth more than the same money on brand, and it does not repeat itself." },
    { id: "targetCities", label: "Where you sell", kind: "cities",
      help: "Only people in a city you have opened can choose you, however good you are. Opening one costs money once and costs more to run for ever — spread faster than you can sell and you pay for reach you are not using." },
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
  ],
  cfo: [
    { id: "borrow", label: "Draw down", kind: "money", min: 0, step: 100_000,
      help: "Money now against interest every year after. Bounded by what the company can borrow, which rises with reputation." },
    { id: "repay", label: "Repay", kind: "money", min: 0, step: 100_000,
      help: "Less owed, less interest, less cash. The boring move that keeps a bad year from being fatal." },
    { id: "cashBuffer", label: "Cash to hold back", kind: "money", min: 0, step: 100_000,
      help: "What you refuse to let the others spend. A statement of intent rather than a lock." },
    { id: "raiseAmount", label: "Raise from investors", kind: "money", min: 0, step: 500_000,
      help: "Money that never has to be repaid, bought with a permanent share of everything the company becomes. Raising while the company is worth little is the most expensive money in the game." },
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
  ],
};

/** A sensible starting position for a seat, from last year rather than from zero. */
export function defaultDraft(role: Role, company: Company, previous?: any): Record<string, any> {
  if (previous) {
    // What they did last year, minus the moves that should never repeat by default.
    const carried = { ...previous };
    if (role === "cfo") { carried.borrow = 0; carried.repay = 0; delete carried.raise; }
    if (role === "cmo") carried.celebritySpend = 0;
    if (role === "ceo") { delete carried.offer; delete carried.dissolveSeats; }
    return carried;
  }

  switch (role) {
    case "cmo": return { price: company.price, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: company.cities ?? [] };
    case "cto": return { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0, researchSpend: 0 };
    case "coo": return { capacityTarget: company.capacity, supportSpend: 0, efficiencySpend: 0, headcount: 0 };
    case "cfo": return { borrow: 0, repay: 0, cashBuffer: 0, raiseAmount: 0 };
    case "ceo": return { focus: "growth", positioning: company.positioning ?? "", rehire: "" };
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
): Record<string, any> {
  const source = payload ?? {};
  const clean: Record<string, any> = {};
  for (const field of LEVER_FIELDS[role]) {
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
      default: {
        const n = Number(raw);
        clean[field.id] = Number.isFinite(n) ? n : 0;
      }
    }
  }
  return clean;
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
export function commitment(company: Company, decisions: TeamDecisions, economy: { costIndex: number }, niche?: Niche): Commitment {
  const bySeat: { role: Role; spend: number }[] = [
    { role: "cmo", spend: (decisions.cmo?.brandSpend ?? 0) + (decisions.cmo?.performanceSpend ?? 0) + (decisions.cmo?.celebritySpend ?? 0) },
    { role: "cto", spend: (decisions.cto?.featureSpend ?? 0) + (decisions.cto?.reliabilitySpend ?? 0) + (decisions.cto?.techDebtPaydown ?? 0) + (decisions.cto?.researchSpend ?? 0) },
    { role: "coo", spend: (decisions.coo?.supportSpend ?? 0) + (decisions.coo?.efficiencySpend ?? 0) },
    { role: "cfo", spend: Math.max(0, decisions.cfo?.repay ?? 0) },
    { role: "ceo", spend: 0 },
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
  );
  const borrowable = Math.max(0, company.creditLimit - company.debt);
  const available = Math.max(0,
    company.cash + (decisions.cfo?.borrow ?? 0) + borrowable - (decisions.cfo?.cashBuffer ?? 0));

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

  return { commitment: money, notes, warnings };
}

/** Which roles have filed, for the "who is still deciding" line. */
export const filedRoles = (decisions: TeamDecisions): Role[] =>
  (["ceo", "cmo", "cfo", "cto", "coo"] as Role[]).filter((r) => !!(decisions as any)[r]);
