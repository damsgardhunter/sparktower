/**
 * The operations seat's depth: how the thing gets made, and what that costs.
 *
 * Capacity was one number — how many you can serve — and every way of getting
 * more of it was the same way. Real operations is a set of standing choices
 * about *how* you make it: a plant automated until it is cheap and rigid, a
 * second shift that buys a year of room at a premium, stock on a shelf against
 * a year you cannot predict, and the make-or-buy that trades a fixed cost for
 * a variable one.
 *
 * Each of these is slow, and that is the point. Automation lands next year and
 * cannot be undone cheaply; a shift is this year only; stock is bought a year
 * before the demand it meets. The operations seat is the one that has to think
 * a year ahead and be held to it.
 */
import type { Niche } from "./types";
import { buildCostPerUnit } from "./responsibilities";

// ─── Automation ──────────────────────────────────────────────────────────────

export const AUTOMATION_MIN = 0;
export const AUTOMATION_MAX = 100;

/**
 * What a point of automation costs to install, per unit of capacity.
 *
 * Priced against building the capacity in the first place: taking a plant from
 * nothing to fully automated costs about six tenths of what the plant cost to
 * build. Paid in the year it is ordered, like the plant.
 */
export const AUTOMATION_RATE = 0.006;

export function automationCost(input: { from: number; to: number; capacity: number; niche: Niche }): number {
  const step = Math.max(0, Math.min(AUTOMATION_MAX, input.to) - Math.max(0, input.from));
  if (step <= 0) return 0;
  return step * Math.max(0, input.capacity) * buildCostPerUnit(input.niche) * AUTOMATION_RATE;
}

/**
 * What automation does once it is in.
 *
 * Every unit is cheaper to make — up to a quarter off at full automation — and
 * the plant is that much harder to change: building new room costs more,
 * because an automated line is not a room with people in it. It also makes the
 * product harder to change: the technology seat's work buys less while the
 * line is set up for what it already makes.
 */
export function automationEffect(level: number | undefined): { unitCost: number; buildCost: number; product: number } {
  const a = Math.max(0, Math.min(AUTOMATION_MAX, Number(level) || 0)) / 100;
  return {
    unitCost: 1 - 0.25 * a,
    buildCost: 1 + 0.5 * a,
    product: 1 - 0.12 * a,
  };
}

/** Automation lands the year after it is ordered, like everything else built. */
export function automationNext(current: number | undefined, target: number | undefined): { now: number; next: number; building: number } {
  const from = Math.max(0, Math.min(AUTOMATION_MAX, Number(current) || 0));
  const to = Math.max(0, Math.min(AUTOMATION_MAX, Number(target ?? current) || 0));
  // Taking it out is immediate: you can always run a line with more hands on it.
  return { now: Math.min(from, to), next: to, building: Math.max(0, to - from) };
}

// ─── A second shift ──────────────────────────────────────────────────────────

/** The most a second shift can add, as a share of the room already built. */
export const SHIFT_MAX = 0.5;
/** What shift capacity costs per unit, against building it: dearer than building, cheaper than leasing. */
export const SHIFT_RATE = 0.22;

/**
 * Running the plant longer rather than building more of it.
 *
 * Immediate, up to half as much again, and it costs more per unit than
 * building would have — overtime, nights, and a tired operation. It also costs
 * service: a company running flat out answers the phone worse. Unlike leased
 * room it uses the plant you own, so it is cheaper than leasing and capped by
 * what you have.
 */
export function shiftCapacity(input: { capacity: number; requested: number | undefined; niche: Niche }): { units: number; cost: number; service: number } {
  const room = Math.max(0, input.capacity);
  const units = Math.max(0, Math.min(room * SHIFT_MAX, Math.round(Number(input.requested) || 0)));
  const share = room > 0 ? units / room : 0;
  return {
    units,
    cost: units * buildCostPerUnit(input.niche) * SHIFT_RATE,
    // Up to four points of service at a full second shift.
    service: share * 8,
  };
}

// ─── Stock ───────────────────────────────────────────────────────────────────

/** What holding one unit of stock for a year costs, against what building the room cost. */
export const STOCK_RATE = 0.18;

/**
 * Stock held against a year you cannot predict.
 *
 * Bought this year, it serves customers next year that capacity alone would
 * have turned away — the demand you did not forecast. It costs to hold and it
 * is worth nothing if the year comes in quiet, which is the trade: insurance
 * against being short, paid for whether or not you needed it.
 */
export function stockCost(units: number | undefined, niche: Niche): number {
  return Math.max(0, Math.round(Number(units) || 0)) * buildCostPerUnit(niche) * STOCK_RATE;
}

// ─── Make or buy ─────────────────────────────────────────────────────────────

export type Sourcing = "in_house" | "outsourced";

/**
 * Where the work is done.
 *
 * In house is what the company has always done: the fixed cost of the people
 * who do it, and the quality of doing it yourself. Outsourced turns that fixed
 * cost into a variable one — cheaper when the company is small, dearer per
 * unit, and a little worse at the thing itself, because the people doing it
 * work for somebody else.
 */
export const SOURCING = {
  in_house: { fixed: 1, unitCost: 1, quality: 0 },
  outsourced: { fixed: 0.82, unitCost: 1.09, quality: -3 },
} as const;

export const sourcingOf = (s: string | undefined) => SOURCING[(s as Sourcing) in SOURCING ? (s as Sourcing) : "in_house"];
