/**
 * Five new companies, from nothing, with the asset market running.
 *
 * Run: npx tsx script/new-companies.ts
 *      CAPITAL=2000,60000,500000 npx tsx script/new-companies.ts
 *
 * ## Why this exists and `simulation-report.ts` was not enough
 *
 * That report opens a company on the funded default and plays it a year at a
 * time with no auction in it, because `resolveYear` has no auction in it — the
 * asset market lives in the server tick (`simListings`, `simBids`,
 * `resolveBids`). Every "capital does not matter" figure I produced came out of
 * a harness with the one capital-sensitive mechanism switched off, and I
 * reported it as a property of the game. It was a property of the harness.
 *
 * So this runs the auction. Each year the shelf is dealt (`marketListings`),
 * the player bids the way `server/simulation-nova-plan.ts` now bids, the bots
 * bid the way they always have (`botBids`), `resolveBids` settles it, and the
 * winner pays — from cash first and from credit after, which is how the tick
 * does it. `ASSET_SLOTS` is a fixed pool and the patent does not expire, so
 * what one company buys is gone for everybody else.
 *
 * Then the same five businesses are run at several opening balances, which is
 * the comparison that was worthless before.
 *
 * ## From nothing
 *
 * `opening: "actual"` at `progress: 0.05` — the band `opening.ts` calls "an
 * idea, and the work so far": no cash, no trading history, no customers, and a
 * plant scaled to the stage. Not the funded opening, which hands a one-van
 * business five hundred customers before anybody decides anything.
 */
import { buildCustomMarket } from "../shared/simulation/custom-market";
import { buildWorld, economyFor } from "../shared/simulation/season";
import { resolveYear } from "../shared/simulation/resolve";
import { optimise } from "../shared/simulation/optimiser";
import { marketListings, resolveBids, biddableFunds, type Bid, type Listing } from "../shared/simulation/assets";
import { botBids } from "../shared/simulation/bots";
import { winnabilityOf } from "../shared/simulation/winnable";
import { distressOf } from "../shared/simulation/recovery";
import { valuation } from "../shared/simulation/mergers";
import { periodsPerYear } from "../shared/simulation/cadence";
import { ROLES, type World, type Niche, type Company } from "../shared/simulation/types";

const money = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${n < 0 ? "-" : ""}£${(a / 1_000_000).toFixed(2)}m`;
  if (a >= 1_000) return `${n < 0 ? "-" : ""}£${(a / 1_000).toFixed(0)}k`;
  return `${n < 0 ? "-" : ""}£${a.toFixed(0)}`;
};
const pad = (s: string, n: number) => s.padEnd(n);
const rp = (s: string, n: number) => s.padStart(n);

/* ── Five businesses nobody has measured before ───────────────────────────── */

const SPECS: { label: string; note: string; spec: any }[] = [
  {
    label: "dog daycare",
    note: "a unit on an industrial estate, forty dogs a day, every owner on first-name terms",
    spec: {
      name: "A dog daycare", premise: "Daytime care and training for dogs whose owners are at work.",
      segments: [
        { id: "regulars", name: "Weekday regulars", description: "Four days a week, same dog, same slot, cancel only when they move house.", size: 4_200, growth: 0.06, priceSensitivity: 0.45, qualityFocus: 0.7, brandFocus: 0.25, serviceFocus: 0.85, loyalty: 0.8, referencePrice: 1_900 },
        { id: "occasional", name: "Occasional users", description: "A few days a month when something comes up.", size: 11_000, growth: 0.04, priceSensitivity: 0.75, qualityFocus: 0.5, brandFocus: 0.3, serviceFocus: 0.6, loyalty: 0.3, referencePrice: 420 },
      ],
      regions: [
        { id: "town", name: "The town", weight: 0.5, entryCost: 9_000, note: "One unit, one van, twenty minutes' drive." },
        { id: "north", name: "The north of the county", weight: 0.3, entryCost: 26_000, note: "Second unit or a long collection round." },
        { id: "city", name: "The city", weight: 0.2, entryCost: 70_000, note: "Three competitors and no parking." },
      ],
      incumbents: [
        { id: "kennels", name: "The old boarding kennels", posture: "coaster", startingShare: 0.46, quality: 45, brand: 62, service: 38, priceIndex: 0.9 },
        { id: "chain", name: "A franchise that just opened", posture: "shark", startingShare: 0.3, quality: 58, brand: 70, service: 50, priceIndex: 1.2 },
      ],
      baseUnitCost: 240, innovationPace: 0.4,
      voice: { customer: "owner", customers: "owners", unit: "placement", capacity: "dog days" },
      workforce: [
        { id: "handlers", name: "handlers", one: "a handler", does: "room", pay: 0.8, share: 0.75, serves: 90 },
        { id: "trainers", name: "trainers", one: "a trainer", does: "product", pay: 1.2, share: 0.25 },
      ],
    },
  },
  {
    label: "payroll saas",
    note: "boring software for payroll bureaus, sold once and kept for a decade",
    spec: {
      name: "Payroll software for bureaus", premise: "The system small accountancy practices run their clients' payroll on.",
      segments: [
        { id: "bureaus", name: "Payroll bureaus", description: "Twenty to two hundred client companies each. Switching costs them a quarter of a year.", size: 6_800, growth: 0.05, priceSensitivity: 0.35, qualityFocus: 0.8, brandFocus: 0.3, serviceFocus: 0.85, loyalty: 0.88, referencePrice: 4_200 },
        { id: "practices", name: "Small practices", description: "Do payroll reluctantly, as a favour to tax clients.", size: 24_000, growth: 0.03, priceSensitivity: 0.7, qualityFocus: 0.6, brandFocus: 0.2, serviceFocus: 0.7, loyalty: 0.65, referencePrice: 680 },
      ],
      regions: [
        { id: "uk", name: "UK", weight: 0.55, entryCost: 40_000, note: "One set of legislation, and it changes every April." },
        { id: "ie", name: "Ireland", weight: 0.2, entryCost: 55_000, note: "Different rules, same customers' accountants." },
        { id: "anz", name: "Australia & NZ", weight: 0.25, entryCost: 120_000, note: "A rewrite of the tax engine, and nobody there has heard of you." },
      ],
      incumbents: [
        { id: "legacy", name: "The desktop incumbent", posture: "fortress", startingShare: 0.58, quality: 52, brand: 78, service: 44, priceIndex: 1.1 },
        { id: "cloudco", name: "A cloud challenger", posture: "innovator", startingShare: 0.24, quality: 74, brand: 48, service: 66, priceIndex: 0.95 },
      ],
      baseUnitCost: 310, innovationPace: 0.9,
      voice: { customer: "bureau", customers: "bureaus", unit: "licence", capacity: "client companies" },
      workforce: [
        { id: "support", name: "support staff", one: "a support specialist", does: "room", pay: 0.9, share: 0.55, serves: 110 },
        { id: "engineers", name: "engineers", one: "an engineer", does: "product", pay: 1.7, share: 0.45 },
      ],
    },
  },
  {
    label: "sourdough bakery",
    note: "one oven, two staff, sold out by eleven and still barely profitable",
    spec: {
      name: "A sourdough bakery", premise: "A single-oven bakery selling at the door and to a handful of cafés.",
      segments: [
        { id: "locals", name: "The door trade", description: "Walk past, buy a loaf, do it again on Saturday.", size: 31_000, growth: 0.05, priceSensitivity: 0.7, qualityFocus: 0.75, brandFocus: 0.3, serviceFocus: 0.35, loyalty: 0.45, referencePrice: 6 },
        { id: "wholesale", name: "Cafés and delis", description: "A standing order, a tight delivery window, and they drop you over one bad week.", size: 2_100, growth: 0.07, priceSensitivity: 0.8, qualityFocus: 0.7, brandFocus: 0.2, serviceFocus: 0.8, loyalty: 0.4, referencePrice: 190 },
      ],
      regions: [
        { id: "town", name: "The town", weight: 0.55, entryCost: 3_500, note: "The shop front, and a bike." },
        { id: "county", name: "The county", weight: 0.3, entryCost: 14_000, note: "A van, and a 4am start." },
        { id: "city", name: "The city", weight: 0.15, entryCost: 48_000, note: "Four bakeries doing it already, two of them better." },
      ],
      incumbents: [
        { id: "supermarket", name: "The supermarket's in-store oven", posture: "shark", startingShare: 0.62, quality: 30, brand: 72, service: 25, priceIndex: 0.45 },
        { id: "artisan", name: "The established artisan bakery", posture: "coaster", startingShare: 0.24, quality: 72, brand: 58, service: 48, priceIndex: 1.25 },
      ],
      baseUnitCost: 2, innovationPace: 0.3,
      voice: { customer: "customer", customers: "customers", unit: "loaf", capacity: "loaves a week" },
      workforce: [
        { id: "bakers", name: "bakers", one: "a baker", does: "room", pay: 0.85, share: 0.7, serves: 9_000 },
        { id: "counter", name: "counter staff", one: "a counter assistant", does: "service", pay: 0.6, share: 0.3 },
      ],
    },
  },
  {
    label: "physio clinic",
    note: "two rooms, two physios, and a waiting list it cannot serve",
    spec: {
      name: "A physiotherapy clinic", premise: "Musculoskeletal physiotherapy, self-referral and insurer work, in two treatment rooms.",
      segments: [
        { id: "selfpay", name: "Self-paying patients", description: "Back pain, a course of six, and they tell their running club.", size: 18_000, growth: 0.06, priceSensitivity: 0.55, qualityFocus: 0.8, brandFocus: 0.3, serviceFocus: 0.7, loyalty: 0.4, referencePrice: 290 },
        { id: "insurers", name: "Insurer panels", description: "Steady volume, slow payment, and they set the price.", size: 7_500, growth: 0.04, priceSensitivity: 0.85, qualityFocus: 0.65, brandFocus: 0.15, serviceFocus: 0.55, loyalty: 0.75, referencePrice: 185 },
      ],
      regions: [
        { id: "town", name: "The town", weight: 0.5, entryCost: 12_000, note: "The two rooms you already rent." },
        { id: "ring", name: "The ring of villages", weight: 0.3, entryCost: 30_000, note: "A second site, one day a week." },
        { id: "city", name: "The city", weight: 0.2, entryCost: 85_000, note: "A hospital outpatient department and six private clinics." },
      ],
      incumbents: [
        { id: "nhs", name: "The hospital outpatient list", posture: "coaster", startingShare: 0.5, quality: 60, brand: 80, service: 30, priceIndex: 0.3 },
        { id: "group", name: "A clinic group", posture: "fortress", startingShare: 0.3, quality: 68, brand: 64, service: 62, priceIndex: 1.15 },
      ],
      baseUnitCost: 42, innovationPace: 0.5,
      voice: { customer: "patient", customers: "patients", unit: "course of treatment", capacity: "appointments a week" },
      workforce: [
        { id: "physios", name: "physiotherapists", one: "a physiotherapist", does: "room", pay: 1.3, share: 0.8, serves: 260 },
        { id: "reception", name: "reception", one: "a receptionist", does: "service", pay: 0.6, share: 0.2 },
      ],
    },
  },
  {
    label: "farm shop",
    note: "a barn, a card reader, and whatever the weather allows",
    spec: {
      name: "A farm shop and veg box round", premise: "Selling the farm's own produce at the gate and by weekly box.",
      segments: [
        { id: "boxes", name: "Box subscribers", description: "A box every Thursday, and they notice when the carrots are small.", size: 9_400, growth: 0.07, priceSensitivity: 0.6, qualityFocus: 0.75, brandFocus: 0.35, serviceFocus: 0.65, loyalty: 0.6, referencePrice: 780 },
        { id: "gate", name: "Gate trade", description: "Sunday drivers and people who forgot something.", size: 26_000, growth: 0.03, priceSensitivity: 0.8, qualityFocus: 0.5, brandFocus: 0.3, serviceFocus: 0.3, loyalty: 0.2, referencePrice: 34 },
      ],
      regions: [
        { id: "local", name: "Within ten miles", weight: 0.55, entryCost: 4_000, note: "The barn, and a chalkboard." },
        { id: "county", name: "The county", weight: 0.3, entryCost: 18_000, note: "A refrigerated van and a round that takes all day." },
        { id: "city", name: "The city", weight: 0.15, entryCost: 55_000, note: "Two established box schemes with better software." },
      ],
      incumbents: [
        { id: "supermarket", name: "The supermarket", posture: "shark", startingShare: 0.64, quality: 38, brand: 85, service: 30, priceIndex: 0.5 },
        { id: "boxco", name: "A national box scheme", posture: "innovator", startingShare: 0.26, quality: 66, brand: 60, service: 58, priceIndex: 1.1 },
      ],
      baseUnitCost: 14, innovationPace: 0.25,
      voice: { customer: "household", customers: "households", unit: "box", capacity: "boxes a week" },
      workforce: [
        { id: "pickers", name: "pickers and packers", one: "a picker", does: "room", pay: 0.7, share: 0.75, serves: 700 },
        { id: "growers", name: "growers", one: "a grower", does: "product", pay: 1, share: 0.25 },
      ],
    },
  },
];

const CAPITAL = (process.env.CAPITAL ?? "2000,60000,500000").split(",").map((n) => Number(n.trim()));
const YEARS = 14;

interface Run {
  capital: number;
  value: number;
  cash: number;
  customers: number;
  revenue: number;
  profit: number;
  quality: number;
  assets: string[];
  wonBy: number[];
  bankruptFrom: number | null;
  closedIn: number;
}

/**
 * One season, with the auction in it.
 *
 * `resolveYear` knows nothing about the asset market, so the auction is run
 * here between years exactly as `server/simulation-tick.ts` runs it: deal the
 * shelf, take the bids, settle, and make the winner pay from cash and then
 * from credit.
 */
function play(niche: Niche, seasonId: string, capital: number): Run {
  const built = buildWorld({
    seasonId, niche,
    teams: [
      { id: "us", name: "Us", seats: [...ROLES], standing: { progress: 0.05, people: 1 } },
      { id: "rivalA", name: "Rival A", seats: [...ROLES], botRun: true },
      { id: "rivalB", name: "Rival B", seats: [...ROLES], botRun: true },
    ],
    opening: "actual",
  });
  let world: World = {
    ...built,
    companies: built.companies.map((c) => (c.id === "us" ? { ...c, cash: capital } : c)),
  };
  const periods = periodsPerYear(null);
  const wonBy: number[] = [];
  let lastRevenue = 0;
  let lastProfit = 0;

  for (let year = 1; year <= YEARS; year++) {
    const us = world.companies.find((c) => c.id === "us");
    if (!us || us.closed) return done(world, capital, wonBy, lastRevenue, lastProfit, year);

    const plan = optimise({ world, companyId: "us", year, economy: economyFor(seasonId, year, periods), periods, totalYears: YEARS });
    if (!plan) return done(world, capital, wonBy, lastRevenue, lastProfit, year);

    const out = resolveYear({ ...world, year }, [plan.decisions as never], economyFor(seasonId, year, periods));
    const report: any = out.reports.find((r: any) => r.companyId === "us");
    lastRevenue = report?.revenue ?? lastRevenue;
    lastProfit = report?.profit ?? lastProfit;
    world = out.world;

    /* ── The auction, which `resolveYear` does not run ───────────────────── */
    const me = world.companies.find((c) => c.id === "us");
    if (!me) return done(world, capital, wonBy, lastRevenue, lastProfit, year);
    const shelf: Listing[] = marketListings({
      seasonId, year, niche, periods,
      owned: (me.assets ?? []).map((a) => a.name),
    });
    if (!shelf.length) continue;

    const bids: Bid[] = [];
    /* Ours, weighed the way `server/simulation-nova-plan.ts` weighs it. */
    const purse = Math.max(0, Math.min((me.cash ?? 0) * 0.6, biddableFunds(me) * 0.33));
    if (purse > 0) {
      const sold = Object.values(me.customers ?? {}).reduce((a: number, b: any) => a + Number(b), 0);
      const perUnit = Math.max(0, (me.price ?? 0) - (me.unitCost ?? 0));
      const weigh = (l: Listing) => {
        const e = l.asset.effect ?? {};
        return (e.quality ?? 0) * 3 + (e.brand ?? 0) * 2 + (e.service ?? 0) * 2
          + (e.capacity ?? 0) * perUnit * 0.0002
          + (1 - (e.unitCost ?? 1)) * Math.max(sold, 1) * (me.unitCost ?? 0) * 0.002
          + (l.asset.expiresIn === undefined ? 12 : 0);
      };
      const best = [...shelf].sort((a, b) => weigh(b) - weigh(a))[0];
      const amount = Math.round(Math.min(purse, best.reserve * 1.15));
      if (best.reserve > 0 && amount >= best.reserve) bids.push({ ventureId: "us", listingId: best.id, amount });
    }
    /* And the bots', exactly as they have always bid. */
    for (const bot of world.companies.filter((c) => c.id.startsWith("rival"))) {
      bids.push(...botBids({ ventureId: bot.id, year, company: bot, listings: shelf }));
    }

    const funds: Record<string, number> = {};
    for (const c of world.companies) funds[c.id] = biddableFunds(c);
    for (const award of resolveBids(shelf, bids, funds)) {
      if (!award.winnerId) continue;
      const listing = shelf.find((l) => l.id === award.listingId)!;
      if (award.winnerId === "us") wonBy.push(year);
      world = {
        ...world,
        companies: world.companies.map((c) => {
          if (c.id !== award.winnerId) return c;
          const fromCash = Math.min(Math.max(0, c.cash), award.price);
          return {
            ...c,
            cash: c.cash - fromCash,
            debt: c.debt + (award.price - fromCash),
            assets: [...c.assets, listing.asset],
          };
        }),
      };
    }
  }
  return done(world, capital, wonBy, lastRevenue, lastProfit, 0);
}

function done(world: World, capital: number, wonBy: number[], revenue: number, profit: number, closedIn: number): Run {
  const us = world.companies.find((c) => c.id === "us") as Company | undefined;
  return {
    capital,
    value: us ? valuation(us).fair : 0,
    cash: us?.cash ?? 0,
    customers: us ? Object.values(us.customers ?? {}).reduce((a: number, b: any) => a + Number(b), 0) : 0,
    revenue, profit,
    quality: Math.round((us as any)?.quality ?? 0),
    assets: (us?.assets ?? []).map((a) => a.name),
    wonBy,
    bankruptFrom: us?.bankruptSince ?? null,
    closedIn,
  };
}

console.log("\n" + "=".repeat(116));
console.log("  FIVE NEW COMPANIES, FROM NOTHING, WITH THE ASSET MARKET RUNNING");
console.log("=".repeat(116));
console.log(`\n  Opened at the earliest "actual" band — no cash of their own, no customers, a plant scaled to the stage.`);
console.log(`  Each run at ${CAPITAL.map(money).join(", ")} of starting capital, against two bot-run rivals, over ${YEARS} years.\n`);

for (const s of SPECS) {
  const niche = buildCustomMarket(s.spec, `new-${s.label.replace(/\s+/g, "-")}`, { fresh: true });
  if (!niche) { console.log(`  !! ${s.label}: buildCustomMarket refused it`); continue; }
  const w = winnabilityOf(niche);

  console.log("-".repeat(116));
  console.log(`  ${s.label.toUpperCase()}  —  ${s.note}`);
  console.log(`  ${niche.segments.map((x) => `${x.name.toLowerCase()} ${x.size.toLocaleString()} @ ${money(x.referencePrice)}`).join("   ·   ")}`);
  console.log(`  unit cost ${money(niche.baseUnitCost)}   one worker serves ${(s.spec.workforce.find((k: any) => k.does === "room")?.serves ?? 0).toLocaleString()}   winnable: ${w.ok ? "yes" : `NO — ${w.problems[0]?.slice(0, 50)}`}\n`);
  console.log("    " + pad("capital", 10) + rp("ends worth", 12) + rp("×", 7) + rp("cash", 10) + rp("customers", 11)
    + rp("revenue", 10) + rp("margin", 9) + rp("quality", 9) + rp("assets won", 12) + "  state");

  const runs = CAPITAL.map((c) => play(niche, `new-${niche.id}`, c));
  for (const r of runs) {
    const margin = r.revenue > 0 ? `${((r.profit / r.revenue) * 100).toFixed(1)}%` : "—";
    const state = r.closedIn ? `closed y${r.closedIn}` : r.bankruptFrom ? `insolvent y${r.bankruptFrom}` : "trading";
    console.log("    " + pad(money(r.capital), 10) + rp(money(r.value), 12)
      + rp(r.capital > 0 ? `${(r.value / r.capital).toFixed(0)}×` : "—", 7)
      + rp(money(r.cash), 10) + rp(r.customers.toLocaleString(), 11) + rp(money(r.revenue), 10)
      + rp(margin, 9) + rp(String(r.quality), 9)
      + rp(r.wonBy.length ? `${r.wonBy.length} (y${r.wonBy.join(",y")})` : "none", 12) + "  " + state);
  }
  /* The question the old harness could not answer. */
  const low = runs[0], high = runs[runs.length - 1];
  if (low && high && low.value > 0) {
    const gap = ((high.value - low.value) / low.value) * 100;
    console.log(`    capital's worth here: ${money(high.capital)} finishes ${gap >= 0 ? "+" : ""}${gap.toFixed(1)}% above ${money(low.capital)}`
      + `   ·   assets won: ${low.wonBy.length} on the small purse, ${high.wonBy.length} on the large`);
  }
  console.log("");
}
