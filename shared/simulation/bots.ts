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
import type { City, Company, Niche } from "./types";
import { assetEffects } from "./assets";
import { isUnlocked, buildCostPerUnit } from "./responsibilities";
import { EXECUTIVE } from "./decisions";
import { researchCost } from "./world";
import { bestPrice, bestSegment, regionsWorthKeeping } from "./bot-play";
import { automationCost, SHIFT_MAX, SHIFT_RATE, STOCK_RATE } from "./factory";
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
/**
 * How well a bot company plays.
 *
 * `filler` is what bots have always been: a warm body in a seat somebody did
 * not take, filing the obvious number so the company moves. It is the right
 * behaviour for a seat nobody wanted, and deliberately not an opponent.
 *
 * `survivor` is a company that is actually trying. It exists because of what
 * a filler cannot teach. A season opened where a real project is — no money,
 * no customers, nobody has heard of you — is the one people most want to
 * play, and watching every rival in it shrink from eighteen thousand
 * customers to one thousand teaches nothing about entering a market. The
 * lesson is supposed to be *how you survive*, and a table can only learn it
 * from companies that demonstrate it.
 *
 * A survivor does the three things a person does and a filler never does:
 * prices to win a foothold while nobody has heard of it, puts its marketing
 * in one place instead of spreading it thin, and protects the spending that
 * stops customers leaving when money is short. It is still bound by the same
 * levers, the same validator and the same money.
 */
export type BotSkill = "filler" | "survivor";

export function botAmbition(ventureId: string): number {
  return between(`bot:${ventureId}:ambition`, 0.75, 1.4);
}

/**
 * How a bot makes one call: the sensible one about half the time, and any of
 * the others the rest of the time.
 *
 * Bots used to answer every standing question the same way for fourteen years
 * — no offer, no research, in house, thirty days — which made five bot
 * companies in a season five copies of one company, and made the answers
 * themselves invisible: a lever nobody ever moves teaches a player nothing.
 *
 * A coin, seeded on the venture, the year and the field, so the same company
 * makes the same call in the same year and two companies make different ones.
 * The sensible answer comes up about half the time, which is roughly how often
 * a person gets these right, and the rest of the time the bot does something
 * defensible and wrong — which is the part worth playing against.
 */
function call<T>(seed: string, best: T, options: readonly T[]): T {
  if (options.length === 0) return best;
  return between(`${seed}:coin`, 0, 1) < 0.5 ? best : pick(`${seed}:among`, options);
}

/**
 * A hundred points of effort, divided by weight and snapped to the step the
 * control moves in, so a bot's split is one a person could have filed.
 */
function split(parts: { id: string; weight: number }[]): Record<string, number> {
  const total = parts.reduce((sum, p) => sum + Math.max(0, p.weight), 0);
  if (total <= 0) return {};
  const out: Record<string, number> = {};
  let left = 100;
  parts.forEach((p, i) => {
    const share = i === parts.length - 1 ? left : Math.min(left, Math.round((Math.max(0, p.weight) / total) * 20) * 5);
    if (share > 0) out[p.id] = share;
    left -= share;
  });
  return out;
}

/** Everything the company sold last year, at this year's price — its size, roughly. */
function turnoverOf(company: Company): number {
  const customers = Object.values(company.customers ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
  return Math.max(0, customers * (Number(company.price) || 0));
}

/**
 * What this company's plant could earn before anything is spent selling it:
 * the margin on one unit, times the units it has room for.
 *
 * Potential rather than actual, deliberately. In year one a bot has no
 * customers, so an actual figure would be zero, and a company that spends
 * nothing never starts.
 */
function grossPotential(company: Company): number {
  const margin = Math.max(0, (Number(company.price) || 0) - (Number(company.unitCost) || 0));
  return margin * Math.max(0, Number(company.capacity) || 0);
}

/**
 * What one seat may spend, as a share of what the plant could earn.
 *
 * Every company starts with the same cash in every market; what that cash can
 * earn is not the same. Measured across the seven, the gross profit available
 * at full capacity in the first year ran from £0.57m to £2.36m. A bot
 * anchored to its bank balance therefore spent like a dating app in a market
 * that returns a fifth as much, and lost — so spending is anchored to the
 * return instead, which is the judgement the old cap was reaching for.
 */
export const BOT_SPEND_OF_GROSS = 0.05;

/**
 * Spending harder is *not* what makes a bot good, and measuring it was the
 * only way to find that out.
 *
 * The obvious fix for "skill does not matter" was to let a survivor invest
 * like an operator — a fifth of what the market could return instead of a
 * twentieth. It made the survivor demonstrably better at running a company
 * (brand 94 against 85, quality 93 against 89) and demonstrably worse at
 * owning one: median cash fell from £70m to £33m and it started dying more
 * often than the weak bot.
 *
 * The reason is that a pound of brand or product buys customers, and a
 * company already running at 85% of its plant cannot serve them. What makes a
 * survivor good is *room* — see `botCapacity` — and knowing that being good
 * earns the right to charge more, which is `priceLicence` in `market.ts`.
 * Both are kept; this is not.
 */
export const spendOfGross = (_skill: BotSkill): number => BOT_SPEND_OF_GROSS;

/**
 * And what it will still spend out of the bank when the year has gone badly.
 *
 * The want below falls with turnover, and turnover falls when customers
 * leave, so a bad year cut the marketing that would have won them back and
 * made the next year worse. Measured, that feedback was most of the game:
 * companies either compounded into tens of millions or spiralled to nothing,
 * with very little in between.
 *
 * Four seats, so about a sixth of the cash between them — enough to keep
 * selling through a bad year, not enough to empty the account in one.
 */
export const BOT_DEFENCE_OF_CASH = 0.04;

/** How long a company can still be described as early, for the purpose of raising. */
export const RESCUE_UNTIL_YEAR = 6;

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
  /**
   * The market, when the caller has it. Without it a bot still files a legal
   * year; with it, it can price what a choice costs and aim its marketing at
   * real places and real people rather than spraying it.
   */
  niche?: Niche;
  /**
   * Everyone else in this market, for the decisions that are only decisions
   * against somebody: what to charge, and who to aim at. Without them a bot
   * files what it always did.
   */
  rivals?: Company[];
  /**
   * How well this company plays. See `BotSkill`.
   *
   * Absent means `filler`, which is what bots have always been and what a
   * seat somebody walked away from should stay.
   */
  skill?: BotSkill;
  /**
   * How many decisions make a year: 1, 4 or 12.
   *
   * Every budget below is an annual one — a share of the cash and of the
   * year's takings — so a bot asked four times a year has to file a quarter
   * of it each time. Without this a bot company spent its whole year's
   * marketing every month and was bankrupt by the spring, and the humans were
   * playing against a market of corpses.
   */
  periods?: number;
}): Record<string, any> {
  const { ventureId, year, role, company, previous, niche, rivals, skill = "filler", periods = 1 } = input;
  const perPeriod = 1 / Math.max(1, Math.round(periods));
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
    if (f.kind === "money" && draft[f.id] === undefined && isUnlocked(role, f.id, year, periods)) draft[f.id] = 0;
  }
  const ambition = botAmbition(ventureId);
  // The chief executive's money is never spent by a bot on a human's behalf, and
  // a lever the seat has not been handed yet is not one it can spend on.
  const money = role === "cfo" || role === "ceo" ? [] : fields.filter((f) => f.kind === "money" && isUnlocked(role, f.id, year, periods));
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
  const appetite = between(budgetSeed, 0.05, 0.12);
  const want = money.length
    ? ambition * appetite * ((Number(company.cash) || 0) + turnoverOf(company))
    : 0;
  /*
   * Bounded by what the market could pay back, and floored by what defending
   * a position costs — so a company neither spends like a market it is not in
   * nor goes quiet the moment it has a bad year.
   */
  const defending = Math.max(0, (Number(company.cash) || 0)) * BOT_DEFENCE_OF_CASH;
  /*
   * A company trying to get in protects the one seat that decides whether
   * anybody hears of it.
   *
   * Brand is what stops customers leaving, and it is the first thing a
   * company under pressure cuts — which is why a filler's customers fall
   * every year once money is tight. A survivor lets the marketing seat spend
   * against what the market could return rather than against what is left in
   * the bank, and takes it out of the seats whose work can wait a year.
   */
  const trying = skill === "survivor" && (Number(company.brand) || 0) < 25;
  const ofGross = spendOfGross(skill);
  const share = trying
    ? (role === "cmo" ? ofGross * 2.2 : ofGross * 0.6)
    : ofGross;
  const ceiling = Math.max(grossPotential(company) * share, defending);
  /*
   * A period's share of it. The caps are stocks — what the company has and
   * what the market could return — so they are compared at full size and the
   * answer is divided, rather than the other way round.
   */
  const budget = Math.max(0, Math.min(Math.max(want, defending), headroom(company) * 0.25, ceiling)) * perPeriod;
  /*
   * The same money, tracked as it is committed.
   *
   * The standing choices below — opening a region, automating, a second
   * shift, buying research — cost real money that never went through the
   * budget above, so a bot could choose four of them in a year it could not
   * pay for and leave the engine to cut everybody. Each one takes what it
   * costs out of the purse and is simply not available once the purse cannot
   * cover it, and what is left is what the spending levers divide up.
   */
  let purse = budget;
  const afford = (cost: number) => cost > 0 && cost <= purse;
  const commit = (cost: number) => { purse = Math.max(0, purse - cost); };

  const held = Object.values(company.customers ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const room = Math.max(0, Number(company.capacity) || 0) + assetEffects(company.assets ?? []).capacity;
  const load = room > 0 ? held / room : 0;
  const perField = openable.length ? budget / openable.length : 0;

  for (const field of fields) {
    const value = draft[field.id];
    const seed = decisionSeed({ ventureId, year, role, field: field.id });

    // A lever the seat does not have yet is not filed at all (see UNLOCKS).
    if (!isUnlocked(role, field.id, year, periods)) { delete draft[field.id]; continue; }

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
    /*
     * Where the marketing goes.
     *
     * Spreading it evenly is not neutral — it is a decision to be equally
     * unremarkable in a region holding a quarter of the market and one holding
     * a fortieth. The sensible call is to put it where the customers are; the
     * other half of the time the bot backs a region for its own reasons.
     */
    if (field.id === "regionFocus") {
      const open = (company.cities ?? []).map((id) => niche?.cities.find((c) => c.id === id)).filter(Boolean) as City[];
      if (!niche || open.length < 2) { delete draft[field.id]; continue; }
      const byWeight = split(open.map((c) => ({ id: c.id, weight: Math.max(0.01, c.weight) })));
      const byWhim = split(open.map((c) => ({ id: c.id, weight: between(`${seed}:${c.id}`, 0.2, 1) })));
      draft[field.id] = call(seed, byWeight, [byWeight, byWhim]);
      continue;
    }
    if (field.id === "budget" || field.id === "tiers") {
      delete draft[field.id];
      continue;
    }
    // A bot never pays the money out: it keeps it in the company it is running.
    if (field.id === "dividendPct") { draft[field.id] = 0; continue; }
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
    /*
     * Pay. The going rate keeps the engineers you have; under it, the market
     * takes them. A bot pays the rate or a little over, and sometimes tries
     * its luck under it.
     */
    if (field.id === "engineerPay") {
      draft[field.id] = call(seed, 105, [90, 95, 100, 105, 110, 115]);
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
    /*
     * A bot table never votes on the announced region, because a bot
     * operations seat never puts one up: bot companies open regions through
     * `targetCities` below, on their own purse. A vote on a proposal that
     * cannot exist is noise in the filed decision.
     */
    if (field.id === "expandVote") { delete draft[field.id]; continue; }
    if (field.id === "shockAnswer") { draft[field.id] = "statement"; continue; }
    /*
     * An offer wins the people who watch the price, and costs margin on
     * everybody. The sensible call is to make one while there is room to fill
     * and stop once the plant is full.
     */
    if (field.id === "promo") {
      draft[field.id] = call(seed, load < 0.6 ? "free_month" : "none", ["none", "free_month", "january"]);
      continue;
    }
    /* Research is worth buying while the year is still winnable, and it is money. */
    if (field.id === "research") {
      const cost = niche ? researchCost(niche) : Infinity;
      const options = afford(cost) ? ["none", "expectations", "rivals"] : ["none"];
      const chosen = call(seed, afford(cost) ? "expectations" : "none", options);
      if (chosen !== "none") commit(cost);
      draft[field.id] = chosen;
      continue;
    }
    /*
     * Insurance is a premium on revenue against a year going wrong. Breaches
     * are the common ruin, so that is the sensible cover — and "everything",
     * at about twice the price of any one, is the defensible mistake.
     */
    if (field.id === "insurance") {
      draft[field.id] = call(seed, "breach", ["none", "breach", "lawsuit", "poaching", "all"]);
      continue;
    }
    if (field.id === "programme" || field.id === "expand") { draft[field.id] = ""; continue; }
    /*
     * Going and finding a niche is not a bot's call.
     *
     * It costs a year of research money and commits the company to a corner
     * of the market for the rest of the season — a decision about what this
     * company is for, which is the table's to make. A bot choosing one would
     * be spending somebody else's money on a hunch, which is the line every
     * other strategic lever here sits on the right side of.
     */
    if (field.id === "openNiche") { draft[field.id] = ""; continue; }
    /*
     * The plant and the balance sheet: a bot keeps what it has. Automating,
     * running a second shift, holding stock, selling what it is owed and
     * buying the company back are all calls with a shape a person should
     * choose — and a bot that made them would be spending a human table's
     * money on a hunch.
     */
    /*
     * Automating pays for itself on a plant that is running, and is money
     * spent on rigidity on one that is not. A bot automates in steps it can
     * pay for, and only while the room it has is being used.
     */
    if (field.id === "automationTarget") {
      const now = Math.round(company.automation ?? 0);
      const step = (to: number) => niche
        ? automationCost({ from: now, to, capacity: Number(company.capacity) || 0, niche })
        : Infinity;
      const steps = [now + 5, now + 10, now + 20].filter((t) => t <= 100 && afford(step(t)));
      const best = load > 0.7 && steps.length ? steps[0] : now;
      const chosen = call(seed, best, [now, ...steps]);
      if (chosen > now) commit(step(chosen));
      draft[field.id] = chosen;
      continue;
    }
    /*
     * A second shift is room for this year only, at a premium and at the cost
     * of service. Worth it when the plant is full and people are being turned
     * away; a waste otherwise.
     */
    if (field.id === "shiftCapacity") {
      const built = Math.max(0, Number(company.capacity) || 0);
      const unit = niche ? buildCostPerUnit(niche) * SHIFT_RATE : Infinity;
      const short = Math.max(0, held - room);
      const sizes = [Math.round(built * 0.1), Math.round(built * 0.25), Math.round(built * SHIFT_MAX)]
        .filter((u) => u > 0 && afford(u * unit));
      const best = load > 0.95 && sizes.length
        ? sizes.find((u) => u >= short) ?? sizes[sizes.length - 1]
        : 0;
      const chosen = call(seed, best, [0, ...sizes]);
      if (chosen > 0) commit(chosen * unit);
      draft[field.id] = chosen;
      continue;
    }
    /*
     * Stock is insurance against a year nobody forecast: bought now, it serves
     * next year's surprise. A bot holds a little when it is already full, and
     * none when it is not.
     */
    if (field.id === "stockTarget") {
      const unit = niche ? buildCostPerUnit(niche) * STOCK_RATE : Infinity;
      const sizes = [Math.round(held * 0.05), Math.round(held * 0.1)].filter((u) => u > 0 && afford(u * unit));
      const best = load > 0.9 && sizes.length ? sizes[0] : 0;
      const chosen = call(seed, best, [0, ...sizes]);
      if (chosen > 0) commit(chosen * unit);
      draft[field.id] = chosen;
      continue;
    }
    /*
     * Selling what you are owed, refinancing and buying the company back are
     * left alone. Each is a call about the shape of the company rather than
     * its year, and a bot that made them would be spending a table's money on
     * a hunch.
     */
    if (field.id === "factorPct" || field.id === "refinance" || field.id === "buyback") {
      draft[field.id] = 0;
      continue;
    }
    /*
     * Making it yourself costs a fixed overhead and is three points better at
     * the thing itself; buying it in trades that for a variable cost. The
     * sensible call is to keep doing what the company already does — changing
     * how you make it is not an annual decision.
     */
    if (field.id === "sourcing") {
      draft[field.id] = call(seed, company.sourcing ?? "in_house", ["in_house", "outsourced"]);
      continue;
    }
    /*
     * As the company already bills, as a string — the lever's answers are
     * strings, and a number here failed validation, which threw away the whole
     * draft and left the seat filing bare defaults for the rest of the season.
     */
    /*
     * Terms are appeal bought with cash flow. A company with money in the bank
     * can afford to be easy to buy from; one that is short cannot, whatever it
     * would buy.
     */
    if (field.id === "terms") {
      const flush = (Number(company.cash) || 0) > turnoverOf(company) * 0.5;
      draft[field.id] = call(seed, flush ? "30" : "0", ["0", "30", "60", "90"]);
      continue;
    }
    /*
     * Who the marketing is for. The sensible call is the segment that holds
     * the most customers; the other half is a bot betting on a niche.
     */
    if (field.id === "segmentFocus") {
      if (!niche || niche.segments.length < 2) { delete draft[field.id]; continue; }
      const bySize = split(niche.segments.map((g) => ({ id: g.id, weight: Math.max(1, g.size) })));
      const byWhim = split(niche.segments.map((g) => ({ id: g.id, weight: between(`${seed}:${g.id}`, 0.2, 1) })));
      draft[field.id] = call(seed, bySize, [bySize, byWhim]);
      continue;
    }
    if (field.id === "featureBet") { draft[field.id] = ""; continue; }
    if (field.id === "featureMode") { draft[field.id] = "build"; continue; }
    if (field.id === "borrowTerm") {
      // The line moves with the rating and can be repaid whenever; a fixed
      // loan is cheaper and cannot. The line is the safe answer.
      draft[field.id] = call(seed, "short", ["short", "long"]);
      continue;
    }
    if (field.id === "holdBackSeat") { draft[field.id] = "all"; continue; }
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
      draft[field.id] = botCapacity({ seed, company, step: field.step, min: field.min, max: field.max, skill });
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
  if (money.length && purse > 0) {
    const spent = money.reduce((sum, f) => sum + (Number(draft[f.id]) || 0), 0);
    const short = purse - spent;
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
   * Opening another region.
   *
   * A bot never opened one, so a bot company spent fourteen years in the
   * region it was given while the market moved around it. Now, once its own
   * region is full enough to be worth leaving, it opens one more — the
   * biggest it can pay for, about half the time, and somewhere it can afford
   * the rest — and only ever one in a year, because entry is paid in cash.
   */
  if (role === "cmo" && niche && Array.isArray(draft.targetCities)) {
    const open: string[] = draft.targetCities.map(String);
    const shut = niche.cities.filter((c) => !open.includes(c.id) && afford(c.entryCost));
    if (load > 0.8 && shut.length > 0) {
      const biggest = [...shut].sort((a, b) => b.weight - a.weight)[0];
      const chosen = call(decisionSeed({ ventureId, year, role, field: "_open" }), biggest, shut);
      if (chosen && afford(chosen.entryCost)) {
        commit(chosen.entryCost);
        draft.targetCities = [...open, chosen.id];
      }
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

  /*
   * The finance seat keeps the company solvent, and does nothing else.
   *
   * A bot chief financial officer files nothing for money on purpose:
   * borrowing and raising are decisions, and a bot inventing a loan is a bot
   * making one with somebody else's company. But refusing to borrow while
   * the company runs out of money is also a decision, and a worse one —
   * measured, a company opened where a real project actually is, with no cash
   * and a bot in the finance seat, survived one time in sixteen. It was not
   * losing the argument; nobody was having it.
   *
   * So it draws what is needed to cover the year ahead and not a penny more.
   * Never to spend, never to speculate, and never past what the line allows:
   * the difference between a seat that will not gamble and a seat that will
   * not act.
   */
  /*
   * A company that is actually trying to get in.
   *
   * Three moves, all of them things a person makes and a filler never does,
   * and all of them only while the company is still a newcomer: once it is
   * established these become ordinary decisions with ordinary trade-offs,
   * and a bot should not keep playing the opening for fourteen years.
   */
  if (skill === "survivor" && role === "cmo" && niche) {
    const held = Object.values(company.customers ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
    const unknown = (Number(company.brand) || 0) < 25;
    const aim = bestSegment(company, niche);

    /*
     * What to charge, worked out rather than inherited.
     *
     * A bot's price has always been last year's number nudged, which means
     * the most powerful lever in the game is the one nobody in a bot company
     * ever touches. This is share against the companies actually here, times
     * what each customer is worth, maximised — see `bestPrice`.
     */
    if (aim && isUnlocked("cmo", "price", year, periods) && rivals?.length) {
      const field = fields.find((f) => f.id === "price");
      const want = bestPrice(company, aim, rivals);
      draft.price = snap(want, field?.step, field?.min, field?.max, Number(draft.price) || want);
    }

    /*
     * And who to aim at. A newcomer is unknown, so it should sell to the
     * people who care least about that — which is what `bestSegment` works
     * out, rather than chasing whichever segment is biggest.
     */
    if (aim && isUnlocked("cmo", "segmentFocus", year, periods)) {
      draft.segmentFocus = { [aim.id]: 100 };
    }

    /*
     * And put the marketing in one place. A newcomer's budget spread across
     * six regions is invisible in all six; the same money in the biggest one
     * it sells in is a company people there have heard of. A filler splits
     * by regional weight, which is the reasonable-looking answer that loses.
     */
    if (isUnlocked("cmo", "regionFocus", year, periods)) {
      const open = (company.cities ?? [])
        .map((id) => niche.cities.find((c) => c.id === id))
        .filter(Boolean) as City[];
      if (open.length >= 2 && (unknown || held === 0)) {
        const keep = regionsWorthKeeping(open, aim, 1)[0];
        if (keep) draft.regionFocus = { [keep]: 100 };
      }
    }
  }

  if (role === "cfo" && isUnlocked("cfo", "borrow", year, periods)) {
    const needed = runwayShortfall(company);
    if (needed > 0) {
      const room = Math.max(0, (Number(company.creditLimit) || 0) - (Number(company.debt) || 0));
      const borrowField = fields.find((f) => f.id === "borrow");
      const borrowed = Math.min(needed, room);
      if (borrowed > 0) draft.borrow = snap(borrowed, borrowField?.step, borrowField?.min, borrowField?.max, 0);

      /*
       * And what the line will not cover is raised, not gone without.
       *
       * A company with no trading history has almost no credit — measured, a
       * season opened where a real project actually is had a £200,000 line
       * against £700,000 of salaries, borrowed all of it in year one, and
       * then watched the line shrink every year as it weakened. Debt is what
       * a company with a record uses. A company without one sells equity,
       * which is what every early-stage founder actually does and what the
       * `raiseAmount` lever is for.
       *
       * Dilution is the cost and the engine prices it against what the
       * company is worth, so this is expensive exactly when the company is
       * weak — which is the lesson, not a loophole.
       */
      const short = needed - borrowed;
      if (short > 0 && isUnlocked("cfo", "raiseAmount", year, periods) && investable(company, year)) {
        const raiseField = fields.find((f) => f.id === "raiseAmount");
        draft.raiseAmount = snap(short, raiseField?.step, raiseField?.min, raiseField?.max, 0);
      }
    }
  }

  const checked = validateDecision(role, draft, company);
  return checked.ok ? draft : base;
}

/**
 * How short of a year's own costs a company is.
 *
 * A year of the salaries it cannot avoid, against the cash it has. Not a
 * forecast and not a plan — the arithmetic of whether the doors stay open,
 * which is the one piece of finance a bot should be trusted with.
 */
/**
 * Whether anybody would still put money in.
 *
 * The first version of this raised whatever the credit line would not cover,
 * every year, for ever — which fixed the two markets nobody could survive and
 * broke the other five, because a company that can always top up can never
 * fail. Measured, survival went from 62% to 94% and five of the seven markets
 * became impossible to lose. A game you cannot lose is a slideshow.
 *
 * Investors are not a tap. They fund a company that is going somewhere, and
 * they stop when it keeps missing what it promised — which the engine already
 * tracks as strikes. Two is the point at which the story has stopped being
 * "early" and started being "not working".
 *
 * And they fund a going concern. A company past its first couple of years
 * with nobody buying anything is not an early-stage bet, it is a company with
 * no customers, and the honest outcome of that is the one it gets.
 */
function investable(company: Company, year: number): boolean {
  /*
   * Patience runs out faster the longer the company has had. Somebody backing
   * a business in its first few years expects misses and says so; somebody
   * backing one in its tenth has stopped calling them early.
   */
  /*
   * Early-stage money is early-stage. Somebody backing a business in its
   * first years expects misses and says so; nobody is writing a seed cheque
   * to a company in its eleventh. Bounding it by year is what lets a company
   * that opened with nothing get going without making a funded one in year
   * twelve impossible to kill — which is exactly what happened when the
   * rescue had no bound: survival went to 94% and five markets became
   * unloseable.
   */
  if (year > RESCUE_UNTIL_YEAR) return false;
  const patience = year <= 5 ? 3 : 2;
  if ((company.investors?.strikes ?? 0) >= patience) return false;
  if (year <= 2) return true;
  return Object.values(company.customers ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0) > 0;
}

function runwayShortfall(company: Company): number {
  const seats = Math.max(1, (company.seats ?? []).length);
  const scale = Number(company.scale) || 1;
  const yearOfSalaries = seats * EXECUTIVE * scale;
  const cash = Math.max(0, Number(company.cash) || 0);
  return Math.max(0, yearOfSalaries - cash);
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
/**
 * How much room to have.
 *
 * This is the decision the whole game turns on and it used to be the same
 * decision at every skill, which is most of why skill did not matter. A
 * company running at 85% of its plant cannot use another customer, so every
 * pound it puts into brand, product or service buys demand it then turns
 * away — and spending nothing beats spending well. Measured on a fixed plan
 * over ten years, room built generously returned £32.1m against £13.1m for
 * room that followed demand: the same money, more than twice the company.
 *
 * So a survivor keeps real headroom and a filler keeps following. It is the
 * one lever where being right early compounds for the rest of the season.
 */
export function botCapacity(input: { seed: string; company: Company; step?: number; min?: number; max?: number; skill?: BotSkill }): number {
  const { seed, company, step, min, max, skill = "filler" } = input;
  const ahead = skill === "survivor";
  const built = Math.max(0, Number(company.capacity) || 0);
  const held = Object.values(company.customers ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const assets = company.assets ?? [];
  const room = built + assetEffects(assets).capacity;
  const load = room > 0 ? held / room : 1;

  if (load < 0.5) {
    /*
     * Mostly idle — and idle room is not free. A company serving a third of
     * what it built pays every year to keep the rest ready, so trimming five
     * per cent of it is not an operations decision, it is a shrug: the seat
     * that is supposed to hold the company's costs down watched a quarter of
     * a million pounds a year go on empty room and gave back a rounding
     * error.
     *
     * So it gives back what it cannot foresee using, down to half as much
     * again as it serves now, and never more than half the plant in one year
     * — room sold back goes at a loss, and a good year would have to buy it
     * again. A company that has not opened yet is left alone: nought
     * customers is not an empty plant, it is a plant waiting for its first
     * year.
     */
    if (held <= 0) return snap(built, step, min, max, built);
    const keep = Math.max(held * (ahead ? 1.9 : 1.5), built * 0.5);
    return snap(Math.min(built, keep), step, min, max, built);
  }
  if (load < 0.85) {
    /*
     * Comfortable: hold, or edge up. Never a cut on a busy operation.
     *
     * A survivor does not wait to be full before it builds — by the time the
     * plant is full the year is already lost, because room ordered now opens
     * a year from now. It keeps about a third more than it is using.
     */
    if (ahead) {
      const wantedAhead = held * (1 + between(`${seed}:ahead`, 0.3, 0.45));
      return snap(Math.min(Math.max(built, wantedAhead), built * 1.6 + 10_000), step, min, max, built);
    }
    return snap(built * (1 + between(`${seed}:edge`, 0, 0.08)), step, min, max, built);
  }
  const assetsNextYear = assetEffects(assets.filter((a) => a.expiresIn === undefined || a.expiresIn > 1)).capacity;
  const wanted = held * (1 + between(`${seed}:ahead`, ahead ? 0.35 : 0.1, ahead ? 0.55 : 0.25)) - assetsNextYear;
  // Room for growth, but not a factory five times the size in a year.
  return snap(Math.min(Math.max(built, wanted), built * 1.6 + 10_000), step, min, max, built);
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
