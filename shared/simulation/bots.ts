/**
 * The players the product supplies when there aren't enough people.
 *
 * A simulation lobby needs five to be a company and three to start at all, and
 * it waits fifteen minutes to find them. Early on it usually doesn't: the
 * person who did turn up watches a clock run down and then gets told there was
 * no game. That is the worst possible first experience of the feature, and it
 * happens precisely when there are fewest people to lose.
 *
 * So after a minute of waiting, the empty seats are filled by bots. They take
 * whatever roles the humans didn't want, and they file a decision every year
 * so the company they're part of actually moves.
 *
 * Three rules they're built to:
 *
 *   - **They are always labelled.** See `shared/bots.ts`, which owns the cast
 *     and the rules that come with it.
 *   - **They never win by playing better.** Their decisions come from the same
 *     `defaultDraft` a person's form is pre-filled with, nudged slightly. A
 *     bot is a warm body, not an opponent tuned to be beaten.
 *   - **They are deterministic.** Every choice is seeded from the venture, the
 *     year and the role, so a season replays identically and a surprising
 *     result can be traced rather than shrugged at.
 *
 * Pure: no database, no clock. `server/simulation-bots.ts` does the writing.
 */
import { between, pick } from "./random";
import { biddableFunds, type Bid, type Listing } from "./assets";
import { BOT_POOL_SIZE, botsFor } from "../bots";
import { LEVER_FIELDS, defaultDraft, validateDecision } from "./levers";
import type { Company } from "./types";
import type { Role } from "./types";

/*
 * Who the bots are — the cast, the wait, the label — lives in `shared/bots.ts`
 * and is shared with the sprint queue. Re-exported here so this module stays
 * the one place the simulation needs to look.
 */
export {
  BOT_FILL_AFTER_SECONDS, BOT_LABEL, BOT_POOL_SIZE,
  botDisplayName, botIdentity, botsNeeded, type BotIdentity,
} from "../bots";

/** The cast for one venture. See `botsFor`. */
export const botsForVenture = (ventureId: string, count: number, poolSize = BOT_POOL_SIZE) =>
  botsFor(ventureId, count, poolSize);

// ─── Decisions ───────────────────────────────────────────────────────────────

/**
 * How far a bot strays from the obvious choice.
 *
 * Small on purpose. The ask was "a hint of randomness", and that is the right
 * amount: enough that five bot-run companies don't file identical numbers and
 * finish in a dead heat, not so much that a bot bankrupts a company somebody
 * else is sitting in. ±12% moves a result without deciding it.
 */
export const BOT_JITTER = 0.12;

/**
 * One numeric lever, nudged.
 *
 * Seeded on the venture, year, role and field together, so the same company in
 * the same year always files the same number — and two roles never move in
 * lockstep because they happened to share a seed.
 *
 * Clamped to the field's own bounds where they're known: a bot must not file
 * something a person would be refused for, or the validator becomes a rule
 * that only applies to humans.
 */
export function jitter(input: {
  seed: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  amount?: number;
}): number {
  const { seed, value, min, max, step, amount = BOT_JITTER } = input;
  if (!Number.isFinite(value)) return value;
  const factor = 1 + between(seed, -amount, amount);
  return snap(value * factor, step, min, max, value);
}

/**
 * A number as a form could have produced it.
 *
 * Rounded to the lever's own step, then held inside its bounds. Without the
 * step a bot files 47,312 against a control that moves in fifty-thousands,
 * which is the detail that gives away that nobody chose it.
 */
export function snap(raw: number, step?: number, min?: number, max?: number, like?: number): number {
  if (!Number.isFinite(raw)) return raw;
  let out = raw;
  /*
   * Only snap a value that is worth at least one step. A capacity of 1,000
   * against a step of 10,000 rounds to zero, which is not a tidier number —
   * it is the company shutting its factory because a bot nudged a slider.
   */
  if (step && step > 0 && Math.abs(raw) >= step) out = Math.round(out / step) * step;
  else if (Number.isInteger(like ?? raw)) out = Math.round(out);
  else out = Math.round(out * 100) / 100;
  if (typeof min === "number") out = Math.max(min, out);
  if (typeof max === "number") out = Math.min(max, out);
  return out;
}

/** A choice from a fixed set, by seed — for levers that are a pick, not a number. */
export function jitterChoice<T>(seed: string, options: readonly T[], fallback: T): T {
  return options.length ? pick(seed, options) : fallback;
}

/**
 * The seed for one bot's decision.
 *
 * Every part matters: the venture so two companies differ, the year so a bot
 * doesn't file the same thing forever, the role so the CFO and the CTO aren't
 * moving together, and the field so one lever going up doesn't drag the rest
 * with it.
 */
export const decisionSeed = (input: { ventureId: string; year: number; role: Role; field: string }) =>
  `bot:${input.ventureId}:${input.year}:${input.role}:${input.field}`;

/**
 * How hard a bot-run company pushes, fixed for the whole season.
 *
 * Bots used to carry last year's plan forward and nudge it ±12%, which meant a
 * company that opened on a modest budget stayed on that budget for fourteen
 * years while the people next door doubled their spending out of a growing
 * balance. The bots weren't losing the argument; they were never in it.
 *
 * So each bot company gets an appetite, seeded once on the venture: a timid
 * one spends a little under the obvious amount, a pushy one a good deal over.
 * It scales what the seats spend, how much room operations builds, and what
 * the chief executive will pay at auction — so two bot companies in the same
 * market grow at visibly different rates, and the pushy one is worth beating.
 *
 * It is still not a tuned opponent: every number goes through the same levers,
 * the same validator and the same money a person has.
 */
export function botAmbition(ventureId: string): number {
  return between(`bot:${ventureId}:ambition`, 0.75, 1.4);
}

/** Everything the company sold last year, at this year's price — its size, roughly. */
function turnoverOf(company: Company): number {
  const customers = Object.values(company.customers ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
  return Math.max(0, customers * (Number(company.price) || 0));
}

/** Cash plus what the bank would still lend — what a bot is allowed to think with. */
function headroom(company: Company): number {
  return Math.max(0, (Number(company.cash) || 0)) + Math.max(0, (Number(company.creditLimit) || 0) - (Number(company.debt) || 0));
}

/**
 * What a bot files for one seat, one year.
 *
 * Built from the same `defaultDraft` a person's form is pre-filled with, then
 * nudged field by field. That is the whole design: a bot plays the obvious
 * move, slightly differently each time, so the company it sits in keeps
 * moving without the bot being an opponent anybody has to beat.
 *
 * Each field is nudged within its own declared bounds (`LEVER_FIELDS`), and
 * the result is put through the same validator a person's submission goes
 * through. If it somehow fails, the plain default is filed instead — an
 * un-jittered decision is always legal, and a bot that files nothing stalls
 * the year for four other people.
 */
export function botDecision(input: {
  ventureId: string;
  year: number;
  role: Role;
  company: Company;
  previous?: Record<string, any>;
}): Record<string, any> {
  const { ventureId, year, role, company, previous } = input;
  const base = defaultDraft(role, company, previous);
  const draft: Record<string, any> = { ...base };
  const fields = LEVER_FIELDS[role] ?? [];

  /*
   * What this bot is willing to spend on running the company this year.
   *
   * A share of the cash on hand, seeded so it varies between companies and
   * years without ever being most of the balance. Split across whichever
   * operating levers are sitting at zero, because a spend that starts at zero
   * stays at zero under a multiplier — and a lobby of bots filing nothing is a
   * season where nothing happens.
   *
   * The chief financial officer is excluded on purpose. Its levers are
   * borrowing, repaying and raising, and `defaultDraft` resets them to zero
   * every year precisely because they should not repeat by accident. A bot
   * inventing a loan is a bot making a decision, which is more than one should
   * do.
   */
  const ambition = botAmbition(ventureId);
  const money = role === "cfo" ? [] : fields.filter((f) => f.kind === "money");
  const openable = money.filter((f) => Number(draft[f.id]) === 0);
  const budgetSeed = decisionSeed({ ventureId, year, role, field: "_budget" });
  /*
   * What this seat will spend this year, measured against the company rather
   * than against what it spent last year — a share of the cash and of the
   * year's takings, scaled by the company's appetite. That is the part that
   * lets a bot company grow: as it sells more, it spends more, the way the
   * team next door does.
   *
   * Capped at a quarter of cash-plus-credit so an enthusiastic seed cannot
   * spend a company into the ground on its own, and the chief financial
   * officer is still excluded — borrowing and raising are decisions, and a
   * bot inventing a loan is a bot making one.
   */
  const want = money.length
    ? ambition * between(budgetSeed, 0.05, 0.12) * ((Number(company.cash) || 0) + turnoverOf(company))
    : 0;
  const budget = Math.max(0, Math.min(want, headroom(company) * 0.25));
  const perField = openable.length ? budget / openable.length : 0;

  for (const field of fields) {
    const value = draft[field.id];
    const seed = decisionSeed({ ventureId, year, role, field: field.id });

    if (field.kind === "choice" && field.options?.length) {
      draft[field.id] = jitterChoice(seed, field.options.map((o) => o.value), value);
      continue;
    }

    if (openable.includes(field)) {
      // Snapped to the field's own step: a person's control moves in 50,000s,
      // so a bot filing 47,312 reads as something no form could have produced.
      draft[field.id] = snap(perField * between(`${seed}:share`, 0.5, 1.5), field.step, field.min, field.max);
      continue;
    }

    if (typeof value === "number") {
      draft[field.id] = jitter({ seed, value, min: field.min, max: field.max, step: field.step });
    }
  }

  /*
   * Last year's plan, brought up to this year's size.
   *
   * `defaultDraft` carries the previous decision forward, so from year two the
   * numbers above are last year's ±12%. If the company has grown since, that
   * is a seat quietly spending less of the business every year. The shortfall
   * against the budget is spread over this seat's money levers.
   */
  if (money.length && budget > 0) {
    const spent = money.reduce((sum, f) => sum + (Number(draft[f.id]) || 0), 0);
    const short = budget - spent;
    if (short > 0) {
      /*
       * Uneven, but adding up: each lever draws a weight and the weights are
       * normalised, so one seat's levers get different shares of the top-up
       * without the seat as a whole spending more than its budget. Weighting
       * each independently overspent by however high the draws happened to
       * land, which is the bot deciding to spend money it was not given.
       */
      const weights = money.map((f) => between(`${decisionSeed({ ventureId, year, role, field: f.id })}:grow`, 0.5, 1.5));
      const total = weights.reduce((sum, w) => sum + w, 0) || money.length;
      money.forEach((field, i) => {
        const bumped = (Number(draft[field.id]) || 0) + short * (weights[i] / total);
        draft[field.id] = snap(bumped, field.step, field.min, field.max);
      });
    }
  }

  /*
   * Room for the customers it has, plus room to take more.
   *
   * Operations carried last year's capacity target forward, so a bot company
   * that filled its capacity stayed exactly that size for the rest of the
   * season and turned everybody else away. It now builds for what it is
   * serving plus a margin, and the margin is the company's appetite. Growth is
   * capped at half again a year: capacity ordered has to be paid for, and a
   * bot must not build a factory it cannot afford.
   */
  if (role === "coo") {
    const field = fields.find((f) => f.id === "capacityTarget");
    const served = Object.values(company.customers ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
    if (field && served > 0) {
      const wanted = served * between(decisionSeed({ ventureId, year, role, field: "_room" }), 1.05, 1.25) * ambition;
      const capped = Math.min(Math.max(wanted, Number(draft[field.id]) || 0), (Number(company.capacity) || 0) * 1.5);
      draft[field.id] = snap(capped, field.step, field.min, field.max);
    }
  }

  /*
   * What the year is for. A company with no cash left stops the bleeding
   * whatever its appetite says, and a pushy one goes for share rather than
   * taking a seeded pick among four equals.
   */
  if (role === "ceo" && typeof draft.focus === "string") {
    if ((Number(company.cash) || 0) <= 0) draft.focus = "survival";
    else if (ambition >= 1.15) draft.focus = "growth";
  }

  /*
   * A year in which nothing was spent.
   *
   * Each share is snapped to its lever's step, and several small shares can
   * each round to zero — leaving a bot that decided to spend filing a year of
   * doing nothing. One lever is opened to a single step so the company at
   * least moves, provided it can be afforded.
   */
  if (openable.length && budget > 0 && openable.every((f) => Number(draft[f.id]) === 0)) {
    const field = jitterChoice(`${budgetSeed}:fallback`, openable, openable[0]);
    const one = field.step && field.step > 0 ? field.step : Math.round(perField);
    if (one > 0 && one <= (Number(company.cash) || 0)) draft[field.id] = one;
  }

  const checked = validateDecision(role, draft, company);
  return checked.ok ? draft : base;
}

// ─── The marketplace ─────────────────────────────────────────────────────────

/**
 * What a bot-run company bids for, and how much it offers.
 *
 * Nothing bid for the assets on sale but the teams with a person in the chief
 * executive's chair. Every year three things came up, the people bid against
 * nobody, and a company run by bots never bought the distribution deal that
 * would have let it serve the customers it was turning away. The market was a
 * shop with one customer.
 *
 * Bids are sealed, so this is the same decision a person makes: what is this
 * worth to us, given what we could spend. The offer is near the reserve —
 * a little under it for a timid company, a third over for a pushy one — so a
 * bot can win a lot that nobody else wanted and can be outbid by anyone who
 * wants it properly. It bids for at most two things, and never commits more
 * than a third of what it could raise.
 *
 * Deterministic, like every other bot decision: the same venture in the same
 * year bids the same numbers.
 */
export function botBids(input: {
  ventureId: string;
  year: number;
  company: Company;
  listings: Listing[];
}): Bid[] {
  const { ventureId, year, company, listings } = input;
  const mine = listings.filter((l) => l.sellerId !== ventureId && l.reserve > 0);
  if (mine.length === 0) return [];

  // A company in the red buys nothing. It has a recovery to be getting on with.
  const cash = Number(company.cash) || 0;
  if (cash <= 0) return [];

  const ambition = botAmbition(ventureId);
  const purse = Math.max(0, Math.min(cash * 0.6, biddableFunds(company) * 0.33) * ambition);
  if (purse <= 0) return [];

  /* Which of the three it likes, seeded — so two bot companies don't all want the same thing. */
  const ranked = [...mine].sort((a, b) =>
    between(`bot:${ventureId}:${year}:want:${b.id}`, 0, 1) - between(`bot:${ventureId}:${year}:want:${a.id}`, 0, 1));

  const bids: Bid[] = [];
  let left = purse;
  for (const listing of ranked.slice(0, 2)) {
    const offer = Math.round(listing.reserve * between(`bot:${ventureId}:${year}:bid:${listing.id}`, 0.95, 1.35) * ambition);
    if (offer < listing.reserve || offer > left) continue;
    bids.push({ ventureId, listingId: listing.id, amount: offer });
    left -= offer;
  }
  return bids;
}
