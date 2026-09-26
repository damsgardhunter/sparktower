import { formatMoney, OUTCOME_PRICE_CENTS } from "./plans";
/**
 * The customer console: what an operator may do to somebody else's account,
 * written down in one place.
 *
 * ## Why a catalogue rather than a route each
 *
 * Every entry here is a power over a person who is not in the room. The list
 * being short, named, and readable is the control — an operator, a reviewer
 * and an auditor can all see the whole of it at once, and adding to it is a
 * visible edit to a file called `admin-console` rather than one more route in
 * a thousand-line file.
 *
 * It also makes three rules impossible to forget, because they are properties
 * of the entry rather than something each handler remembers:
 *
 *   - **Who may.** Money and ownership are the owner's alone; the rest an
 *     admin can do, so support can be handed to somebody without handing them
 *     the bank.
 *   - **Why.** Every action takes a reason, and the reason is stored. An
 *     administrative change nobody can account for afterwards is
 *     indistinguishable from an intrusion.
 *   - **Whether it can be taken back.** Reversible actions say so, and the log
 *     keeps the state from before, so undo restores what was actually there
 *     rather than what someone assumes was there.
 *
 * ## What is deliberately not here
 *
 * Reading somebody's work. The console answers "what has this account got,
 * and what has been done to it" — balances, passes, project names, the
 * ledger — and stops there. Support does not need to read a customer's
 * business plan to refund them a dollar, and a console that could would be a
 * reason not to trust the product with anything.
 *
 * Deleting things, too. Nothing here removes a person's data: suspension and
 * takedown already exist in the moderation queue, where the reasons and the
 * appeal path live.
 */

/** Who has to be signed in as what. `owner` is the single PLATFORM_OWNER_EMAIL address. */
export type ConsoleRole = "admin" | "owner";

export const CONSOLE_ACTIONS = [
  "credit",
  "day_pass",
  "image_pass",
  "reset_allowance",
  "verify_email",
  "build_pass",
  "project_privacy",
  "transfer_project",
] as const;
export type ConsoleAction = (typeof CONSOLE_ACTIONS)[number];

export interface ConsoleActionDef {
  id: ConsoleAction;
  /** What the button says. */
  label: string;
  /** What it does, in the words an operator would use to a customer. */
  blurb: string;
  role: ConsoleRole;
  /** Whether `undo` can put it back from the log's `previousState`. */
  reversible: boolean;
  /** What it acts on, which decides whether the form asks for a project. */
  subject: "user" | "project";
}

export const CONSOLE_ACTION_DEFS: Record<ConsoleAction, ConsoleActionDef> = {
  credit: {
    id: "credit", label: "Add to their balance", role: "owner", reversible: true, subject: "user",
    blurb: "Goodwill money, for a generation that failed or a charge that shouldn't have happened. Shows on their statement like any other top-up.",
  },
  day_pass: {
    id: "day_pass", label: "Give a day pass", role: "admin", reversible: true, subject: "user",
    blurb: "Unlimited small Nova actions for a day, without taking anything from their balance.",
  },
  image_pass: {
    id: "image_pass", label: "Give an image pass", role: "admin", reversible: true, subject: "user",
    blurb: "A day of image generation. The pass images need, which the ordinary day pass doesn't cover.",
  },
  reset_allowance: {
    id: "reset_allowance", label: "Reset this month's free actions", role: "admin", reversible: true, subject: "user",
    blurb: "Puts the monthly allowance back to full. For somebody whose month was eaten by something that went wrong.",
  },
  verify_email: {
    id: "verify_email", label: "Mark their email verified", role: "admin", reversible: true, subject: "user",
    blurb: "For a customer whose confirmation mail never arrived. It does not prove the address — only that you decided to trust it.",
  },
  build_pass: {
    id: "build_pass", label: "Grant the whole-business build", role: "owner", reversible: true, subject: "project",
    /* The price is read rather than written: it has changed once already. */
    blurb: `Marks one project as having bought the whole-business build (${formatMoney(OUTCOME_PRICE_CENTS.business)}), so every priced outcome on it is already paid for.`,
  },
  project_privacy: {
    id: "project_privacy", label: "Change who can see the project", role: "admin", reversible: true, subject: "project",
    blurb: "Public or private. For somebody who published by accident, or who cannot find the switch.",
  },
  transfer_project: {
    id: "transfer_project", label: "Move the project to another account", role: "owner", reversible: true, subject: "project",
    blurb: "For a duplicate sign-up, or a handover between two people who both asked. The old owner loses it.",
  },
};

export const isConsoleAction = (v: unknown): v is ConsoleAction =>
  typeof v === "string" && (CONSOLE_ACTIONS as readonly string[]).includes(v);

/**
 * How much money one action may move, and how much in a day.
 *
 * Not because an operator is expected to be careless — because a console with
 * no ceiling is one where a slipped decimal point, or a stolen session that
 * got past a second factor, is unbounded. $200 covers every real support case
 * on this price list — comfortably more than the dearest single thing on it,
 * whatever that is this month — and nothing larger happens by accident.
 */
export const MAX_GRANT_CENTS = 20_000;
export const MAX_GRANT_CENTS_PER_DAY = 50_000;

/** A pass can be handed over for a few days at most; anything longer is a plan, not support. */
export const MAX_PASS_DAYS = 14;

/**
 * Long enough to be a sentence.
 *
 * A reason box that accepts "ok" collects "ok", and a log full of "ok" is a
 * log that answers nothing six months later when somebody asks why an account
 * has $200 on it.
 */
export const MIN_REASON = 8;
export const MAX_REASON = 300;

/** Every console action is logged under this prefix, so the audit reads as one story. */
export const CONSOLE_LOG_PREFIX = "console:";
export const consoleLogAction = (action: ConsoleAction) => `${CONSOLE_LOG_PREFIX}${action}`;
export const isConsoleLogAction = (action: string) => action.startsWith(CONSOLE_LOG_PREFIX);
