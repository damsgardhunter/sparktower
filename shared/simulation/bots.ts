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
  const openable = role === "cfo" ? [] : fields.filter((f) => f.kind === "money" && Number(draft[f.id]) === 0);
  const budgetSeed = decisionSeed({ ventureId, year, role, field: "_budget" });
  const budget = openable.length
    ? Math.max(0, between(budgetSeed, 0.06, 0.18) * (Number(company.cash) || 0))
    : 0;
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
