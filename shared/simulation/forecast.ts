/**
 * How many people will want you this year — roughly, and honestly roughly.
 *
 * ## The finance seat's classic job, which it did not have
 *
 * Capacity was a number the operations seat typed, with nothing to type it
 * against. Get it wrong low and customers were turned away; get it wrong high
 * and nothing happened at all, because capacity was free. So the safe move was
 * always "more", nobody ever had to estimate anything, and the one piece of
 * genuine business judgement the brief gives the table — how many people will
 * turn up — was never exercised.
 *
 * Now headroom binds both ways (see `idleCapacityCost` and the spill in
 * `allocate`), and this is what the table decides it against.
 *
 * ## How it is worked out
 *
 * The real market, run once, with this company as it would be if the draft on
 * the desk were filed: the drafted price, positioning and cities, and brand and
 * quality lifted by the drafted spend using the engine's own lift curves. The
 * rivals are held as they stand — their plans are private until the tick, and
 * a forecast that knew them would be a leak dressed as a feature. The company
 * is given unlimited room, so the answer is demand rather than a reflection of
 * whatever capacity was already set.
 *
 * ## Why it is a range
 *
 * Because the thing it cannot see — what eight rivals decide tonight — is most
 * of what decides the answer. A single number would be read as a promise, and
 * the first year it was wrong it would be read as a bug. The band is widest in
 * the first two years, when the company has no customers to anchor on and the
 * market has no memory of it, and narrows as the company settles.
 *
 * It is also a curve: demand at five prices around the drafted one, so the
 * screen can answer "what if we charged a bit more" while a hand is on the
 * price, without a round trip.
 */
import { annualPlans, fundYear } from "./responsibilities";
import { dataEffects } from "./product";
import { sanitiseDecisions } from "./decisions";
import type { Company, Economy, World } from "./types";
import { allocate, atScale } from "./market";
import { incumbentYear } from "./incumbents";
import { lift } from "./decisions";
import { brandLanding, staffing } from "./lag";
import type { TeamDecisions } from "./decisions";

export interface Forecast {
  /** The middle of the range: the likeliest number of customers at the drafted price. */
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

/** What the drafted spending does to the company before the market sees it. A sketch of the engine, not the engine. */
function projected(company: Company, d: TeamDecisions | undefined, innovationPace: number, per = 1): Company {
  /*
   * With the same lags the year itself applies (see `lag.ts`), or the forecast
   * would count brand and quality this year that will not arrive until next —
   * and be most wrong for exactly the team that planned ahead.
   */
  void innovationPace; // This year's shipping lands next year, so it does not move this year's demand.
  // Every threshold and ceiling scaled the way the engine scales them, or the
  // forecast would promise a quarter's spending a year's worth of brand.
  const brand = brandLanding(company, lift((d?.cmo?.brandSpend ?? 0) + (d?.cmo?.celebritySpend ?? 0) * 1.4, atScale(220_000, company.scale) * per, 16 * per), per);
  const brandGain = brand.now + lift(d?.cmo?.performanceSpend ?? 0, atScale(180_000, company.scale) * per, 9 * per);
  const qualityGain = Math.max(0, company.pipeline ?? 0) * per;
  const staff = staffing(company, d?.coo?.headcount ?? 0, per);
  const serviceGain = lift(
    (d?.coo?.supportSpend ?? 0) + (d?.cto?.reliabilitySpend ?? 0) * 0.5 + staff.supportEquivalent,
    150_000 * per, 15 * per,
  );
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  return {
    ...company,
    price: Math.max(1, d?.cmo?.price ?? company.price),
    // Tiers as drafted, and the annual plans on offer, since both change who stays and who comes.
    tiers: d?.cmo ? d.cmo.tiers : company.tiers,
    retention: annualPlans(d?.cfo?.annualDiscount).retention,
    brand: clamp(company.brand + brandGain - 4.5 * per),
    quality: clamp(company.quality + qualityGain - 3 * per),
    service: clamp(company.service + serviceGain - 3.5 * per),
    positioning: d?.ceo?.positioning ?? company.positioning,
    /*
     * Added to, never replaced — the same rule the engine applies. Somewhere
     * already open cannot be closed by leaving it off the list, and a forecast
     * that read an empty list as "sell nowhere" predicted zero customers for
     * every team that had not yet touched the cities lever.
     */
    cities: Array.isArray(company.cities)
      ? Array.from(new Set([...company.cities, ...(d?.cmo?.targetCities ?? [])]))
      : company.cities,
    capacity: Number.MAX_SAFE_INTEGER,
  };
}

/**
 * The incumbents as they will be when the market runs, not as they were.
 *
 * Holding them where they stood made this wildly optimistic from about year
 * three: an incumbent's capacity from last year, facing this year's demand,
 * looks full, and everything it would turn away spilled to the one company
 * with unlimited room — this one. A forecast of 1.1 million for a company that
 * then won 147,000, and an operations seat that believed it, paid to keep a
 * warehouse nine tenths empty.
 *
 * Their moves are deterministic and their posture is on every screen, so
 * playing them forward leaks nothing a player could not work out. The rival
 * *teams* stay as they stand: their plans are private until the tick.
 */
function withIncumbentMoves(world: World, me: Company, economy: Economy): Company[] {
  const players = world.companies.map((c) => (c.id === me.id ? me : c)).filter((c) => c.kind === "player");
  return world.companies.map((c) => {
    if (c.id === me.id) return me;
    if (c.kind !== "incumbent") return c;
    const moves = incumbentYear(c, players, world.niche, economy);
    return { ...c, price: moves.price, quality: moves.quality, brand: moves.brand, service: moves.service, capacity: moves.capacity };
  });
}

function demandAt(world: World, me: Company, year: number, economy: Economy): { total: number; bySegment: Record<string, number> } {
  const companies = withIncumbentMoves(world, me, economy);
  const { held } = allocate(companies, world.niche, year, economy, Math.max(1, Math.round(world.periodsPerYear ?? 1)));
  const mine = held[me.id] ?? {};
  return { total: Object.values(mine).reduce((sum, n) => sum + n, 0), bySegment: mine };
}

export function forecastDemand(input: {
  world: World;
  companyId: string;
  year: number;
  economy: Economy;
  /** The table's draft for this year. Anything not in it is taken as the company stands. */
  draft?: TeamDecisions;
}): Forecast | null {
  const { world, companyId, year, economy, draft } = input;
  const company = world.companies.find((c) => c.id === companyId);
  if (!company) return null;

  /*
   * The draft as it can actually be paid for. A plan the company cannot fund
   * is cut before the year runs (see `fundYear`); forecasting the uncut plan
   * predicted the customers a company with no money would have won with
   * marketing it was never going to be able to buy.
   */
  const funded = draft && company.kind === "player" ? sanitiseAndFund(company, draft, world.niche, economy) : draft;
  const me = projected(company, funded, world.niche.innovationPace, 1 / Math.max(1, Math.round(world.periodsPerYear ?? 1)));
  const at = demandAt(world, me, year, economy);

  const held = Object.values(company.customers).reduce((sum, n) => sum + n, 0);
  /*
   * Wide while there is nothing to anchor on, narrower once there is. A
   * company holding most of its forecast already is mostly forecasting
   * whether people stay, which is far easier than whether they arrive.
   */
  const anchored = at.total > 0 ? Math.min(1, held / at.total) : 0;
  // And narrower again for a company that has built up its analytics (see `dataEffects`).
  const band = Math.round((year <= 2 ? 0.35 : 0.25 - 0.1 * anchored) * dataEffects(company.data).band * 100) / 100;

  const curve = [0.8, 0.9, 1, 1.1, 1.2].map((m) => {
    const price = Math.max(1, Math.round(me.price * m));
    return { price, likely: m === 1 ? at.total : demandAt(world, { ...me, price }, year, economy).total };
  });

  return {
    likely: at.total,
    low: Math.round(at.total * (1 - band)),
    high: Math.round(at.total * (1 + band)),
    band,
    bySegment: world.niche.segments.map((s) => ({ segmentId: s.id, likely: at.bySegment[s.id] ?? 0 })),
    curve,
    price: Math.round(me.price),
  };
}

/**
 * What a capacity choice costs against the forecast, both ways, in money.
 *
 * The desk shows this next to the capacity lever so the bet is visible before
 * it is placed: build to the high end and pay for the empty shelves in an
 * ordinary year; build to the low end and hand the difference to a rival in a
 * good one.
 */
export function capacityRisk(input: { capacity: number; forecast: Forecast; price: number; idleCostPerUnit: number }): {
  /** Idle if demand comes in at the low end. */
  idleAtLow: number;
  idleCostAtLow: number;
  /** Turned away if demand comes in at the high end. */
  shortAtHigh: number;
  revenueLostAtHigh: number;
  verdict: "short" | "tight" | "balanced" | "generous" | "idle";
} {
  const { capacity, forecast, price, idleCostPerUnit } = input;
  const idleAtLow = Math.max(0, capacity - forecast.low);
  const shortAtHigh = Math.max(0, forecast.high - capacity);
  const verdict = capacity < forecast.low ? "short"
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

/** The draft, cleaned the way the engine cleans it and cut to what can be paid for. */
function sanitiseAndFund(company: Company, draft: TeamDecisions, niche: World["niche"], economy: Economy): TeamDecisions {
  return fundYear(company, sanitiseDecisions(draft), niche, economy).decisions;
}
