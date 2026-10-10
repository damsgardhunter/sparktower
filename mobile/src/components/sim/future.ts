/**
 * What is coming, on a phone.
 *
 * Mirrors `capacityRisk` and `Forecast` in `shared/simulation/forecast.ts`, and
 * the price-curve read inside `ForecastCard` in
 * `client/src/pages/simulation-desk.tsx`. Checked against the engine's own
 * `capacityRisk` by `test/unit/mobile-mirror.test.ts`.
 *
 * The gap this fills is the sharpest one left on the phone. The server has
 * always sent `desk.forecast` and `desk.idleCostPerUnit` and nothing in
 * `mobile/` read either, so a phone operations seat set capacity with no idea
 * how many customers were coming — against a web player looking at the range,
 * the room, what the empty shelves cost if the year came in low and what walks
 * to a rival if it came in high. Capacity is the one lever that binds in both
 * directions and it was the one lever the phone asked people to guess at.
 *
 * No React Native imports here, so the mirror test can load it.
 */

/** Mirrors `Forecast` in shared/simulation/forecast.ts. */
export interface Forecast {
  likely: number;
  low: number;
  high: number;
  /** How wide the band is either side of `likely`, 0–1. */
  band: number;
  bySegment: { segmentId: string; likely: number }[];
  /** Demand at prices around the drafted one. */
  curve: { price: number; likely: number }[];
  /** The price the forecast was worked out at. */
  price: number;
}

export type CapacityVerdict = "short" | "tight" | "balanced" | "generous" | "idle";

export interface CapacityRisk {
  idleAtLow: number;
  idleCostAtLow: number;
  shortAtHigh: number;
  revenueLostAtHigh: number;
  verdict: CapacityVerdict;
}

const whole = (n: number | undefined): number => (Number.isFinite(Number(n)) ? Number(n) : 0);

/**
 * The bet capacity makes against the forecast.
 *
 * A line-for-line copy of `capacityRisk` in shared/simulation/forecast.ts,
 * including the 1.3× threshold between "generous" and "idle". If that number
 * moves in the engine it has to move here, which is what the mirror test is
 * for — a phone that draws a different verdict from the web about the same
 * numbers is worse than a phone that draws none.
 */
export function capacityRisk(input: {
  capacity: number;
  forecast: Forecast;
  price: number;
  idleCostPerUnit: number;
}): CapacityRisk {
  const { capacity, forecast, price, idleCostPerUnit } = input;
  const idleAtLow = Math.max(0, capacity - forecast.low);
  const shortAtHigh = Math.max(0, forecast.high - capacity);
  const verdict: CapacityVerdict = capacity < forecast.low ? "short"
    : capacity < forecast.likely ? "tight"
    : capacity <= forecast.high ? "balanced"
    : capacity <= forecast.high * 1.3 ? "generous"
    : "idle";
  return {
    idleAtLow,
    idleCostAtLow: Math.round(idleAtLow * idleCostPerUnit),
    shortAtHigh,
    revenueLostAtHigh: Math.round(shortAtHigh * price),
    verdict,
  };
}

/**
 * Demand at a price the forecast was not worked out at.
 *
 * The forecast carries a curve of five prices around the drafted one, so moving
 * the price moves the range while a hand is still on the lever. Linear between
 * the points it has and flat outside them — extrapolating past the ends would
 * invent demand at a price nobody modelled, and the honest answer at the edge
 * is the edge.
 *
 * Mirrors the `at()` helper inside the web's `ForecastCard`.
 */
export function demandAtPrice(forecast: Forecast, price: number): number {
  const curve = [...(forecast.curve ?? [])].sort((a, b) => a.price - b.price);
  if (!Number.isFinite(Number(price)) || curve.length === 0) return forecast.likely;
  if (price <= curve[0].price) return curve[0].likely;
  if (price >= curve[curve.length - 1].price) return curve[curve.length - 1].likely;
  for (let i = 1; i < curve.length; i++) {
    if (price <= curve[i].price) {
      const a = curve[i - 1];
      const b = curve[i];
      const t = (price - a.price) / Math.max(1, b.price - a.price);
      return Math.round(a.likely + (b.likely - a.likely) * t);
    }
  }
  return forecast.likely;
}

/**
 * The forecast as it stands at the price on the table, band and all.
 *
 * The band is a fraction of the middle rather than a fixed spread, so a range
 * read at a different price has to be rebuilt rather than shifted.
 */
export function forecastAtPrice(forecast: Forecast, price: number): Forecast {
  const likely = demandAtPrice(forecast, price);
  return {
    ...forecast,
    likely,
    low: Math.round(likely * (1 - forecast.band)),
    high: Math.round(likely * (1 + forecast.band)),
  };
}

/**
 * The verdict in words, which is the part that has to not be a colour.
 *
 * Every one of these says which way the risk runs, because "tight" and
 * "generous" are the same word to somebody who has not read the manual, and a
 * red chip on its own does not say whether the problem is too much room or too
 * little.
 */
export const VERDICT_READ: Record<CapacityVerdict, { title: string; means: string }> = {
  short: { title: "Not enough room", means: "Even a quiet year turns people away." },
  tight: { title: "Tight", means: "An ordinary year turns some people away." },
  balanced: { title: "About right", means: "The room covers the range this year could land in." },
  generous: { title: "Room to spare", means: "Headroom for a good year, paid for either way." },
  idle: { title: "More room than anyone could fill", means: "Empty space costs the same as full space." },
};

/**
 * How far above the top of the range an *order* has to be before it is a
 * mistake worth interrupting.
 *
 * Mirrors `ORDER_FAR_TOO_MUCH` in the web's `ForecastCard`, and the reasoning
 * is worth carrying across rather than just the number: `capacityRisk`'s "idle"
 * verdict fires at 1.3× the top of the range, which is the right line for room
 * a company *has* and the wrong line for room it is *ordering* — ordered room
 * opens next period, into a market that has grown and into reach the company
 * may have just bought. Measured on a freight market over sixteen quarters, a
 * plant held at 1.25× what the company serves never turns a profit and one at
 * 2× ends worth five and a half times as much, so warning at 1.3× would tell a
 * founder their only winning move was a mistake. Three times still catches the
 * founder who ordered 3,000 seats against 87 customers.
 */
export const ORDER_FAR_TOO_MUCH = 3;

export function overOrdering(capacityNext: number, forecast: Forecast): boolean {
  return whole(capacityNext) > Math.max(1, forecast.high) * ORDER_FAR_TOO_MUCH;
}

export interface ComingRow {
  id: string;
  label: string;
  value: string;
  when: string;
  warn?: boolean;
}

/**
 * What is already paid for and has not arrived yet — the lag, made visible.
 *
 * Mirrors the "On its way" table on the web's Future tab. Worth its own reading
 * rather than a row of tiles because the useful part is *when*: a seat that
 * cannot see that this year's engineering lands next year reads a flat quality
 * score as money wasted, and stops spending it.
 */
export function comingUp(company: {
  pipeline?: number;
  pipelineLater?: number;
  brandPipeline?: number;
  techDebt?: number;
  techDebtCost?: { product: number; unitCost: number };
}): ComingRow[] {
  const rows: ComingRow[] = [];
  if (whole(company.pipeline) > 0) {
    rows.push({ id: "quality", label: "Quality", value: `+${Math.round(whole(company.pipeline))}`, when: "lands next year" });
  }
  if (whole(company.pipelineLater) > 0) {
    rows.push({ id: "research", label: "Research", value: `+${Math.round(whole(company.pipelineLater))}`, when: "lands in two years" });
  }
  if (whole(company.brandPipeline) > 0) {
    rows.push({ id: "brand", label: "Brand", value: `+${Math.round(whole(company.brandPipeline))}`, when: "the rest of this year's campaign" });
  }
  if (whole(company.techDebt) > 0) {
    const product = whole(company.techDebtCost?.product);
    rows.push({
      id: "techDebt",
      label: "Technical debt",
      value: `${Math.round(whole(company.techDebt))}`,
      when: product > 0 ? `product work buys ${product}% less` : "nothing to worry about yet",
      warn: whole(company.techDebt) > 55,
    });
  }
  return rows;
}

/**
 * Which of the five seats this screen is addressed to.
 *
 * The forecast is the argument between marketing and operations — one moves the
 * demand, the other builds to it — so the screen says which lever is yours
 * rather than leaving a seat to work out why it is being shown a range.
 */
export function whoseBet(role: string | null | undefined): "capacity" | "price" | null {
  if (role === "coo") return "capacity";
  if (role === "cmo") return "price";
  return null;
}
