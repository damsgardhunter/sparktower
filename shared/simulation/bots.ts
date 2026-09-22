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
import { BOT_POOL_SIZE, botsFor } from "../bots";
import { LEVER_FIELDS, defaultDraft, validateDecision } from "./levers";
import type { Company } from "./types";
import { assetEffects } from "./assets";
import { isUnlocked } from "./responsibilities";
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
  // A money lever that has only just arrived starts at nought, like any other.
  for (const f of fields) {
    if (f.kind === "money" && draft[f.id] === undefined && isUnlocked(role, f.id, year)) draft[f.id] = 0;
  }
  const openable = role === "cfo" ? [] : fields.filter((f) => f.kind === "money" && Number(draft[f.id]) === 0 && isUnlocked(role, f.id, year)
    // The chief executive's money is never spent by a bot on a human's behalf.
    && role !== "ceo");
  const budgetSeed = decisionSeed({ ventureId, year, role, field: "_budget" });
  const budget = openable.length
    ? Math.max(0, between(budgetSeed, 0.06, 0.18) * (Number(company.cash) || 0))
    : 0;
  const perField = openable.length ? budget / openable.length : 0;

  for (const field of fields) {
    const value = draft[field.id];
    const seed = decisionSeed({ ventureId, year, role, field: field.id });

    // A lever the seat does not have yet is not filed at all (see UNLOCKS).
    if (!isUnlocked(role, field.id, year)) { delete draft[field.id]; continue; }

    /*
     * The newer levers each get a considered value rather than a random one.
     * A bot is a teammate a person has to live with: it forecasts honestly,
     * rents room only when the company is already full, borrows on the
     * ordinary line, and never imposes a budget split, a hold-back or price
     * tiers on the humans at its table.
     */
    if (field.id === "forecast") {
      const held = Object.values(company.customers ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
      draft[field.id] = held > 0 ? snap(held * between(`${seed}:growth`, 0.95, 1.2), field.step, 0) : 0;
      continue;
    }
    if (field.id === "leaseCapacity") {
      const held = Object.values(company.customers ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
      const room = (Number(company.capacity) || 0) + assetEffects(company.assets ?? []).capacity;
      draft[field.id] = room > 0 && held >= room * 0.98 ? snap(held * 0.1, field.step, 0) : 0;
      continue;
    }
    // A bot spreads its marketing evenly: concentration is a call, not a default.
    if (field.id === "regionFocus") { delete draft[field.id]; continue; }
    if (field.id === "budget" || field.id === "tiers") {
      delete draft[field.id];
      continue;
    }
    if (field.id === "holdBack" || field.id === "costReview" || field.id === "bonusPool" || field.id === "replaceBid") {
      draft[field.id] = 0;
      continue;
    }
    /*
     * A bot chief executive manages people gently: fair targets for everyone,
     * and it never overrules or fires a human. Those are decisions a person
     * should only ever have made to them by another person.
     */
    if (field.id === "targets") {
      draft[field.id] = Object.fromEntries((company.seats ?? ["cmo", "cfo", "cto", "coo"]).filter((r) => r !== "ceo").map((r) => [r, "fair"]));
      continue;
    }
    if (field.id === "overrule" || field.id === "replaceSeat") {
      draft[field.id] = "";
      continue;
    }
    if (field.id === "engineerPay") {
      draft[field.id] = 100;
      continue;
    }
    /*
     * A bot keeps a balanced pace and places no feature bets: the menu is the
     * season's, and a bet is the kind of call a table should see a person make.
     */
    if (field.id === "pace") { draft[field.id] = "balanced"; continue; }
    /*
     * The world's offers are filled in by the server, which knows the season
     * and so knows what was offered (see `fileBotDecisions`). A bot chief
     * executive puts every offer to the table rather than deciding alone: the
     * humans at the table should get the call.
     */
    if (field.id === "deals" || field.id === "dealVotes") { delete draft[field.id]; continue; }
    if (field.id === "shockAnswer") { draft[field.id] = "statement"; continue; }
    if (field.id === "promo") { draft[field.id] = "none"; continue; }
    if (field.id === "research") { draft[field.id] = "none"; continue; }
    if (field.id === "insurance") { draft[field.id] = "breach"; continue; }
    if (field.id === "programme" || field.id === "expand") { draft[field.id] = ""; continue; }
    /*
     * The plant and the balance sheet: a bot keeps what it has. Automating,
     * running a second shift, holding stock, selling what it is owed and
     * buying the company back are all calls with a shape a person should
     * choose — and a bot that made them would be spending a human table's
     * money on a hunch.
     */
    if (field.id === "automationTarget") { draft[field.id] = Math.round(company.automation ?? 0); continue; }
    if (field.id === "shiftCapacity" || field.id === "stockTarget" || field.id === "factorPct"
      || field.id === "refinance" || field.id === "buyback") { draft[field.id] = 0; continue; }
    if (field.id === "sourcing") { draft[field.id] = company.sourcing ?? "in_house"; continue; }
    if (field.id === "terms") { draft[field.id] = company.terms ?? 30; continue; }
    if (field.id === "segmentFocus") { delete draft[field.id]; continue; }
    if (field.id === "featureBet") { draft[field.id] = ""; continue; }
    if (field.id === "featureMode") { draft[field.id] = "build"; continue; }
    if (field.id === "borrowTerm" || field.id === "holdBackSeat") {
      draft[field.id] = field.id === "borrowTerm" ? "short" : "all";
      continue;
    }
    if (field.id === "annualDiscount") {
      // A modest discount, some years: never a quarter of the revenue on a whim.
      draft[field.id] = between(`${seed}:plans`, 0, 1) < 0.5 ? 0 : 10;
      continue;
    }

    if (field.kind === "choice" && field.options?.length) {
      draft[field.id] = jitterChoice(seed, field.options.map((o) => o.value), value);
      continue;
    }

    if (field.id === "capacityTarget") {
      draft[field.id] = botCapacity({ seed, company, step: field.step, min: field.min, max: field.max });
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

/**
 * What an operations bot builds: enough room for the customers it has.
 *
 * Capacity used to be jittered like any other number — up or down by as much
 * as 12% at random. That is a coin toss on the one lever where the direction
 * matters most: a cut takes effect at once, growth a year later, so a bot
 * that rolled a cut while half a million people were being turned away made
 * the company smaller in the year it most needed to be bigger.
 *
 * So it looks at how full the company is, counting room its assets add, and
 * builds toward next year: a little more than it serves now, less whatever
 * assets will still be adding then (the ones in their last year won't be).
 * It only ever cuts when the company is mostly empty, and never by much.
 */
export function botCapacity(input: { seed: string; company: Company; step?: number; min?: number; max?: number }): number {
  const { seed, company, step, min, max } = input;
  const built = Math.max(0, Number(company.capacity) || 0);
  const held = Object.values(company.customers ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const assets = company.assets ?? [];
  const room = built + assetEffects(assets).capacity;
  const load = room > 0 ? held / room : 1;

  if (load < 0.5) {
    // Mostly idle: trim, gently.
    return snap(built * (1 - between(`${seed}:trim`, 0, 0.1)), step, min, max, built);
  }
  if (load < 0.85) {
    // Comfortable: hold, or edge up. Never a cut on a busy operation.
    return snap(built * (1 + between(`${seed}:edge`, 0, 0.08)), step, min, max, built);
  }
  const assetsNextYear = assetEffects(assets.filter((a) => a.expiresIn === undefined || a.expiresIn > 1)).capacity;
  const wanted = held * (1 + between(`${seed}:ahead`, 0.1, 0.25)) - assetsNextYear;
  // Room for growth, but not a factory five times the size in a year.
  return snap(Math.min(Math.max(built, wanted), built * 1.6 + 10_000), step, min, max, built);
}
