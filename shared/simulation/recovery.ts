/**
 * What a company in trouble can do about it.
 *
 * The brief was explicit that running out of money must not end the season,
 * and it is right for a reason worth writing down: a team knocked out on day
 * three has eleven days of nothing, and a player with eleven days of nothing
 * does not come back for the next season either. The engine already refuses to
 * eliminate anyone. This file is the other half — having somewhere to go.
 *
 * ## The shape of it
 *
 * Every move here costs something real. That is not harshness, it is the only
 * thing that keeps the rest of the game honest: if a bad year could be undone
 * for free, then no year would matter, the teams playing carefully would be
 * playing for nothing, and the marketplace would have no buyers because
 * nobody would ever be forced to sell.
 *
 * So the options are trades, and mostly unpleasant ones — sell what makes you
 * good at things, dilute the people who built it, promise a creditor you will
 * stop spending. A team that takes them survives smaller. A team that trades
 * well can still climb back, and the climb is the story they remember.
 *
 * ## The arc
 *
 * Distress is a state you are *in*, not a punishment you receive. It has
 * stages, each with its own moves, and — the part that makes it an arc rather
 * than a hole — a way out that the team can see from inside it: two
 * consecutive years of meeting a creditor's terms and the terms lift. Being
 * told exactly what would get you out is what makes the eleven remaining days
 * worth playing.
 */
import type { Company, CompanyAsset } from "./types";
import { resaleValue } from "./assets";

export type Distress = "healthy" | "strained" | "distressed" | "insolvent";

/**
 * How much trouble a company is in.
 *
 * Four states rather than a solvent/insolvent switch, because the interesting
 * moment is the one before the wall: a team told "you are strained" in year
 * five has a year to act, and acting is the game. A team that learns about it
 * when the engine marks them bankrupt has only the consequences.
 */
export function distressOf(company: Company): Distress {
  if (company.bankruptSince !== undefined) return "insolvent";

  const headroom = company.cash + Math.max(0, company.creditLimit - company.debt);
  const yearOfCosts = 1_100_000;

  if (headroom <= 0) return "insolvent";
  if (headroom < yearOfCosts * 0.75) return "distressed";
  if (headroom < yearOfCosts * 1.5 || company.debt > company.creditLimit * 0.85) return "strained";
  return "healthy";
}

/** Said to the team, in the words they would use themselves. */
export const DISTRESS_COPY: Record<Distress, { title: string; body: string }> = {
  healthy: {
    title: "Solid",
    body: "Enough behind you to take a bad year without it deciding anything.",
  },
  strained: {
    title: "Stretched",
    body: "Still standing, with not much between you and a bad year. This is the point at which the moves below are cheap — they get expensive later.",
  },
  distressed: {
    title: "In trouble",
    body: "Less than a year of costs in reach. Something has to change, and the sooner it changes the more of the company survives it.",
  },
  insolvent: {
    title: "Insolvent",
    body: "Out of money and out of credit. You are not out of the season — nobody is removed from this game — but the way back runs through the moves below, and all of them cost something.",
  },
};

export type RecoveryKind = "restructure" | "fire_sale" | "dissolve_seat" | "rescue_raise";

export interface RecoveryOption {
  kind: RecoveryKind;
  title: string;
  /** What it does, plainly. */
  body: string;
  /** What it costs, said out loud before they choose it. */
  cost: string;
  /** Roughly what it frees up, so the choice can be arithmetic rather than vibes. */
  raises: number;
  /** The states in which this is worth offering. */
  from: Distress[];
}

/** What the creditor wants in exchange for easier terms. */
export interface Covenant {
  /** The year it was agreed. */
  since: number;
  /** Discretionary spend may not exceed this. */
  spendCap: number;
  /** Consecutive years met so far. Two and it lifts. */
  met: number;
  /** Interest relief while it holds. */
  rateRelief: number;
}

export const COVENANT_YEARS = 2;

/**
 * What a company in this position can do.
 *
 * Ordered by how much of the company survives the move: sell the least
 * important thing first, dissolve a seat before diluting the people in them,
 * and take the rescue money last because it is the most expensive of all.
 */
export function recoveryOptions(company: Company, year: number): RecoveryOption[] {
  const state = distressOf(company);
  if (state === "healthy") return [];

  const sellable = company.assets.reduce((sum, a) => sum + resaleValue(a, { forced: state !== "strained" }), 0);
  const options: RecoveryOption[] = [];

  if (company.assets.length > 0) {
    options.push({
      kind: "fire_sale",
      title: "Sell what you own",
      body: `Put ${company.assets.length === 1 ? "it" : "them"} on the market now, at what a buyer will pay today rather than what you paid.`,
      cost: "Whatever those assets were doing for you, they stop doing. A rival will probably be the one doing it instead.",
      raises: sellable,
      from: ["strained", "distressed", "insolvent"],
    });
  }

  if (company.debt > 0) {
    options.push({
      kind: "restructure",
      title: "Restructure the debt",
      body: "Ask the creditor for a lower rate and more time. They will give it to you, with conditions.",
      cost: `A cap on what the company may spend for ${COVENANT_YEARS} years, and a reputation hit for having asked. Meet the terms twice and the cap lifts.`,
      raises: Math.round(company.debt * 0.04),
      from: ["strained", "distressed", "insolvent"],
    });
  }

  if (company.seats.length > 2) {
    options.push({
      kind: "dissolve_seat",
      title: "Dissolve a seat",
      body: "Fold one of the five jobs into the others. The salary stops immediately.",
      cost: "That seat's decisions stop being made by anybody. It is the cheapest money here and the only one you cannot undo.",
      raises: 140_000,
      from: ["distressed", "insolvent"],
    });
  }

  options.push({
    kind: "rescue_raise",
    title: "Take rescue money",
    body: "An investor who specialises in companies with no alternatives. The money is real and it arrives immediately.",
    cost: "A third of the company, at a price that reflects the position you are in. It is the most expensive money on this page and the reason it is listed last.",
    raises: Math.max(1_500_000, Math.round(company.creditLimit * 0.9)),
    from: ["distressed", "insolvent"],
  });

  return options.filter((o) => o.from.includes(state));
}

export interface RecoveryOutcome {
  company: Company;
  notes: string[];
  /** Assets the move put on the market, for the marketplace to sell. */
  released: CompanyAsset[];
}

/**
 * Carry out a recovery move.
 *
 * Returns a new company rather than mutating one, like the rest of the engine,
 * so a year can be resolved twice and land in the same place.
 */
export function applyRecovery(input: {
  company: Company;
  kind: RecoveryKind;
  year: number;
  /** For dissolve_seat: which one. */
  seat?: string;
}): RecoveryOutcome {
  const { company, kind, year, seat } = input;
  const state = distressOf(company);
  const forced = state !== "strained";

  if (kind === "fire_sale") {
    const proceeds = company.assets.reduce((sum, a) => sum + resaleValue(a, { forced }), 0);
    return {
      company: { ...company, assets: [], cash: company.cash + proceeds },
      released: company.assets,
      notes: [
        `Sold everything the company owned for ${proceeds.toLocaleString()}${forced ? ", at what a forced seller gets rather than what it was worth" : ""}. The capability goes with it.`,
      ],
    };
  }

  if (kind === "restructure") {
    /*
     * The covenant is the arc. A cap on spending is genuinely painful — it is
     * the thing that stops a team spending their way out — and it comes with a
     * stated, reachable end: two years of meeting it and the creditor lets go.
     * A punishment with no visible exit is one players stop playing under.
     */
    const cap = Math.max(400_000, Math.round(company.cash * 0.35));
    return {
      company: {
        ...company,
        reputation: Math.max(0, company.reputation - 6),
        covenant: { since: year, spendCap: cap, met: 0, rateRelief: 0.03 },
      } as Company,
      released: [],
      notes: [
        `The creditor agreed: a lower rate, and a cap of ${cap.toLocaleString()} on discretionary spending. Meet it for ${COVENANT_YEARS} years and the cap lifts. Word got around, which cost some reputation.`,
      ],
    };
  }

  if (kind === "dissolve_seat") {
    const dropped = seat && company.seats.includes(seat as any) ? seat : company.seats[company.seats.length - 1];
    return {
      company: { ...company, seats: company.seats.filter((s) => s !== dropped) as Company["seats"] },
      released: [],
      notes: [
        `The ${dropped} seat is gone. That salary stops, and so do that seat's decisions — nobody makes them now, this year or any year after.`,
      ],
    };
  }

  const amount = Math.max(1_500_000, Math.round(company.creditLimit * 0.9));
  return {
    company: {
      ...company,
      cash: company.cash + amount,
      // The money clears the immediate hole, which is the point of it.
      bankruptSince: undefined,
      reputation: Math.max(0, company.reputation - 3),
    },
    released: [],
    notes: [
      `Took ${amount.toLocaleString()} in rescue funding for a third of the company. The doors stay open; a third of whatever you build from here belongs to somebody who was not in the room.`,
    ],
  };
}

/**
 * How a covenant fares over a year, and whether it lifts.
 *
 * Checked against what the team actually spent rather than what they planned,
 * because a plan is not a promise kept.
 */
export function reviewCovenant(covenant: Covenant | undefined, spent: number): {
  covenant: Covenant | undefined;
  note: string | null;
} {
  if (!covenant) return { covenant: undefined, note: null };

  if (spent > covenant.spendCap) {
    return {
      covenant: { ...covenant, met: 0 },
      note: `The spending cap was broken — ${Math.round(spent).toLocaleString()} against ${covenant.spendCap.toLocaleString()}. The creditor reset the clock; ${COVENANT_YEARS} clear years from here.`,
    };
  }

  const met = covenant.met + 1;
  if (met >= COVENANT_YEARS) {
    return {
      covenant: undefined,
      note: "Two years inside the cap. The creditor lifted it — the company spends its own money again.",
    };
  }

  return {
    covenant: { ...covenant, met },
    note: `A year inside the cap. One more and it lifts.`,
  };
}

/**
 * Whether a company is actually climbing, rather than merely still alive.
 *
 * Used to tell a struggling team something true and encouraging when it is
 * true, and to say nothing when it is not. Praise a team that is still sinking
 * and they stop believing anything the screen says.
 */
export function climbing(before: Company, after: Company): boolean {
  const headroom = (c: Company) => c.cash + Math.max(0, c.creditLimit - c.debt);
  return headroom(after) > headroom(before) && after.debt <= before.debt;
}
