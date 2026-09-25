/**
 * Things a company owns, and the market it buys and sells them in.
 *
 * Assets were declared from the start and did nothing: they carried an
 * `effect` the engine never read, so owning a distribution deal made a company
 * no better at anything — it only raised what a bank would lend against it.
 * This file makes them real, and gives them somewhere to come from and
 * somewhere to go.
 *
 * ## Why a sealed bid rather than a buy button
 *
 * Each year a handful of things come up for sale, and every team in the season
 * sees the same list. If the first team to press the button got it, the market
 * would be a test of who is awake — a fourteen-day game decided by time zones.
 *
 * So purchases are sealed bids, resolved on the tick: everyone commits a
 * number without seeing anyone else's, the highest offer wins, and the losers
 * keep their money. That is a decision with a real shape — how much is this
 * worth to *us*, and how badly does the team two seats over want it — rather
 * than a race. It is also the part players will talk to each other about,
 * which is the thing that makes a fortnight-long game worth staying in.
 *
 * ## Why a forced sale hurts
 *
 * A company that needs cash today sells into a market that knows it. The
 * discount is the entire economic engine of the recovery arc: it is what makes
 * distress genuinely costly, what makes a rival's collapse an opportunity
 * rather than a spectator sport, and what a struggling team is trading away
 * when it buys itself another year. Without it, bankruptcy would be an
 * inconvenience and nobody would fear it.
 */
import { CATALOGUES } from "./catalogues";
import type { Company, CompanyAsset, Niche } from "./types";
import { hash, rng, sample } from "./random";
import { marketScale } from "./world";

/** What an asset does while you hold it, applied on top of what the company built itself. */
export interface AssetEffect {
  brand: number;
  quality: number;
  service: number;
  /** Extra units the company can serve. */
  capacity: number;
  /** A multiplier on unit cost — below 1 is cheaper. */
  unitCost: number;
}

const NOTHING: AssetEffect = { brand: 0, quality: 0, service: 0, capacity: 0, unitCost: 1 };

/**
 * Everything the company's assets add up to.
 *
 * Multiplicative on cost and additive on the rest, which is how the fields are
 * written. Two distribution deals are better than one; two cost programmes
 * stack but with each one working on what the last one left.
 */
export function assetEffects(assets: CompanyAsset[]): AssetEffect {
  return assets.reduce<AssetEffect>((total, a) => ({
    brand: total.brand + (a.effect.brand ?? 0),
    quality: total.quality + (a.effect.quality ?? 0),
    service: total.service + (a.effect.service ?? 0),
    capacity: total.capacity + (a.effect.capacity ?? 0),
    unitCost: total.unitCost * (a.effect.unitCost ?? 1),
  }), { ...NOTHING });
}

/**
 * The room a company can actually serve from: what it built, plus what its
 * assets add. The engine has always served customers from both (see
 * `effectiveOf` in resolve.ts); anything that reads `company.capacity` alone
 * is reading the part the company built, and will call a company with a
 * distribution deal "at its limit" while it is serving comfortably.
 */
export function servingCapacity(company: Pick<Company, "capacity" | "assets">): number {
  return company.capacity + assetEffects(company.assets ?? []).capacity;
}

/**
 * A year passing over the things a company owns.
 *
 * `expiresIn` is the years of use left, this one included: a five-year
 * licence works for five years, and one with `expiresIn: 1` works this year
 * and is gone when it ends. That is what every screen says ("One year, then
 * it lapses"), and what the team is told the year before.
 *
 * It used to count down before the year was played and retire anything that
 * reached nought — so a five-year asset worked for four, and the one the team
 * had been told "expires at the end of next year" stopped working at the
 * start of it, taking its capacity with it while the desk still counted it.
 *
 * So this runs at the start of the year and returns what works *this* year,
 * each a year shorter. Ones that reach nought still work now, and are dropped
 * when the year settles (`stillHeld`). `expired` only ever holds something
 * already spent — a stored asset from before this was fixed.
 */
export function ageAssets(assets: CompanyAsset[]): { assets: CompanyAsset[]; expired: CompanyAsset[]; notes: string[] } {
  const working: CompanyAsset[] = [];
  const expired: CompanyAsset[] = [];
  const notes: string[] = [];

  for (const asset of assets) {
    if (asset.expiresIn === undefined) { working.push(asset); continue; }
    if (asset.expiresIn <= 0) {
      expired.push(asset);
      notes.push(`${asset.name} has run out. Whatever it was doing for you, it stopped doing this year.`);
      continue;
    }
    const left = asset.expiresIn - 1;
    working.push({ ...asset, expiresIn: left });
    if (left === 0) notes.push(`This is ${asset.name}'s last year. It keeps working until the year ends, then it is gone.`);
    if (left === 1) notes.push(`${asset.name} expires at the end of next year.`);
  }

  return { assets: working, expired, notes };
}

/** What a company still owns once a year is over: anything whose last year that was has gone. */
export function stillHeld(assets: CompanyAsset[]): CompanyAsset[] {
  return assets.filter((a) => a.expiresIn === undefined || a.expiresIn > 0);
}

/** The things that can come up for sale, before a season decides which ones do. */
interface AssetTemplate {
  kind: CompanyAsset["kind"];
  name: string;
  /** What it does, scaled by how big the market is where it matters. */
  effect: (niche: Niche) => CompanyAsset["effect"];
  /** Roughly what it is worth, as a multiple of a year's fixed costs. */
  weight: number;
  life?: number;
  /** One line a player can decide from. */
  blurb: string;
}

/**
 * The nine slots every market's marketplace is built from: what each thing
 * costs, how long it lasts, and what it does.
 *
 * The names and blurbs here are only the fallback for a market with no
 * catalogue of its own. Each market's actual wording comes from
 * `CATALOGUES` in `catalogues.ts`, matched to these slots by position — a
 * dating app gets a moderation centre where this says operations centre, and
 * it does exactly the same thing.
 */
const SLOTS: AssetTemplate[] = [
  {
    kind: "distribution", name: "Retail shelf agreement", weight: 1.6, life: 4,
    effect: (n) => ({ capacity: Math.round(marketSize(n) * 0.04), brand: 4 }),
    blurb: "Somebody else's shelves. More people can reach you without you building anything.",
  },
  {
    kind: "distribution", name: "Carrier bundle", weight: 2.2, life: 3,
    effect: (n) => ({ capacity: Math.round(marketSize(n) * 0.06), brand: 6 }),
    blurb: "You arrive already installed. Expensive, short, and very hard to argue with while it lasts.",
  },
  {
    kind: "celebrity", name: "Three-year ambassador", weight: 1.9, life: 3,
    effect: () => ({ brand: 14 }),
    blurb: "A face people already trust. Works immediately and leaves with them when it ends.",
  },
  {
    kind: "patent", name: "Core process patent", weight: 2.4,
    effect: () => ({ quality: 9, unitCost: 0.93 }),
    blurb: "Yours permanently, and not theirs. The rare thing here that does not expire.",
  },
  {
    kind: "patent", name: "Interface patent portfolio", weight: 1.4,
    effect: () => ({ quality: 6 }),
    blurb: "A fence around the part customers actually touch.",
  },
  {
    kind: "facility", name: "Second operations centre", weight: 2.0, life: 6,
    effect: (n) => ({ capacity: Math.round(marketSize(n) * 0.05), service: 6, unitCost: 0.96 }),
    blurb: "Room to serve more people and somewhere to answer the phone from.",
  },
  {
    kind: "facility", name: "Automated fulfilment line", weight: 1.7, life: 5,
    effect: (n) => ({ capacity: Math.round(marketSize(n) * 0.03), unitCost: 0.88 }),
    blurb: "Cuts what every unit costs, permanently, for as long as you keep it running.",
  },
  {
    kind: "brand_licence", name: "Sports federation licence", weight: 1.5, life: 4,
    effect: () => ({ brand: 10, service: 3 }),
    blurb: "Borrowed credibility with the people who care most about it.",
  },
  {
    kind: "brand_licence", name: "Publisher partnership", weight: 1.1, life: 3,
    effect: () => ({ brand: 7 }),
    blurb: "A quieter name than a celebrity, and it does not have opinions in public.",
  },
];

const marketSize = (niche: Niche): number => niche.segments.reduce((sum, s) => sum + s.size, 0);

/**
 * This market's things for sale: the slots' numbers under this market's words.
 *
 * Falls back to a slot's own wording when a market has no catalogue, or when
 * a catalogue entry's kind disagrees with its slot — a licence re-skinned as a
 * facility would carry a licence's effect under a building's name, which is
 * worse than a generic label.
 */
export function templatesFor(niche: Niche): AssetTemplate[] {
  /*
   * The market's own words first, then the catalogue, then the generic slot.
   *
   * A market Nova wrote has no catalogue entry, so a founder rehearsing a SaaS
   * business was offered a retail shelf agreement and a carrier bundle — the
   * generic names, which are retail's. `niche.assets` is that market naming
   * its own, and it wins over the catalogue because a market that came with
   * its own vocabulary is more specific than an id lookup that missed.
   */
  const catalogue = CATALOGUES[niche.id];
  const written = niche.assets;
  if (!catalogue && !written) return SLOTS;

  /*
   * A written market's entries are taken by kind, in order, rather than by
   * position. A catalogue is hand-written and lines up by construction; a
   * model's answer is not, and one entry dropped for naming the wrong kind
   * would shift every later one onto the wrong slot — a patent's economics
   * under a warehouse's name. Queueing per kind means a bad entry costs its
   * own slot and nothing else's.
   */
  const queue = new Map<string, { name: string; blurb: string }[]>();
  for (const entry of written ?? []) {
    if (!entry?.name) continue;
    const list = queue.get(entry.kind) ?? [];
    list.push({ name: entry.name, blurb: entry.blurb });
    queue.set(entry.kind, list);
  }

  return SLOTS.map((slot, i) => {
    const mine = queue.get(slot.kind)?.shift();
    if (mine) return { ...slot, name: mine.name, blurb: mine.blurb || slot.blurb };
    const entry = catalogue?.[i];
    return entry && entry.kind === slot.kind ? { ...slot, name: entry.name, blurb: entry.blurb } : slot;
  });
}

/** The slots themselves, for the test that holds catalogues in step with them. */
export const ASSET_SLOTS: readonly AssetTemplate[] = SLOTS;

/** An asset on offer, with what it would take to get it. */
export interface Listing {
  id: string;
  asset: CompanyAsset;
  blurb: string;
  /** What the seller will not go below. A bid under this buys nothing. */
  reserve: number;
  /** Null for the open market; a venture id when a team is selling its own. */
  sellerId: string | null;
}

/**
 * Roughly a year of payroll in one of the seven catalogue markets.
 *
 * Pricing assets against the salary bill rather than a flat number was the
 * intention and this was the flat number: a constant, applied whole to every
 * market including the ones Nova writes for a startup. Those run at a
 * hundredth of a catalogue market, so a founder holding £46,000 was shown
 * three things to buy at £1.4m, £1.6m and £2.5m, each labelled "more than the
 * company can back" — a shop with nothing in it they could afford, every year,
 * for the whole season.
 *
 * `yearOfCosts` is the figure the comment always described. Unchanged for the
 * seven, which are all sized around this.
 */
const YEAR_OF_COSTS = 1_100_000;

/**
 * A year of payroll in *this* market.
 *
 * The same `marketScale` the opening bank, the salaries and the challenge
 * rewards are all sized by, so an asset costs what it should relative to the
 * company that might buy it rather than relative to a market it is not in.
 */
const yearOfCosts = (niche: Niche): number => YEAR_OF_COSTS * marketScale(niche);

/**
 * What the open market is offering this year.
 *
 * Deterministic from the season and year, so every team sees the same three
 * things and a re-run of the tick deals the same hand. Three rather than ten:
 * a marketplace with everything in it is a shopping list, and a marketplace
 * with three things in it is an argument about which one.
 */
/** `year` counts periods; `periods` is how many make one, because a licence's life is written in years. */
export function marketListings(input: {
  seasonId: string; year: number; niche: Niche; count?: number; periods?: number;
  /**
   * Names this company already owns, which are not worth offering it again.
   *
   * A second copy of a patent it holds is not a second patent — `applyAsset`
   * would stack two of the same effect, and a team spending a year's cash on
   * something it already has is a trap rather than a decision. The pool is
   * still the whole market's, so removing what one company holds does not
   * change what the others are shown; it only stops this one being offered
   * its own shelf back.
   */
  owned?: string[];
}): Listing[] {
  const { seasonId, year, niche, count = 5, periods = 1 } = input;
  const seed = `${seasonId}:${year}:market`;
  /*
   * Dealt first, hidden second — and that order is not a detail.
   *
   * Settlement (`settleAuctions`) deals this same hand from the same seed to
   * decide who won what, and it has no company to filter for. Removing a
   * template *before* the sample would make one company's screen show
   * listings that do not exist in the settlement's set, so a bid would be
   * placed against an id nothing would ever settle. The pool stays whole; a
   * company simply is not shown the thing it already owns.
   */
  const held = new Set(input.owned ?? []);
  const chosen = sample(seed, templatesFor(niche), count)
    .filter((t) => !held.has(t.name));

  return chosen.map((template, i) => {
    /*
     * Seeded on the template, not on its position in the list.
     *
     * With the index in the seed, hiding one listing from a company shifted
     * every later one up a place and repriced it — so the same asset had one
     * price on the screen and another at settlement. What a thing costs is a
     * fact about the thing, not about how many rows are above it.
     */
    const jitter = 0.85 + rng(`${seed}:${template.name}:price`)() * 0.35;
    /*
     * Rounded to something that reads like a price, at the size of this
     * market. A flat £50,000 step made every listing in a startup market
     * round to the same number — or to nothing at all.
     */
    const step = Math.max(500, Math.round((yearOfCosts(niche) / 22) / 500) * 500);
    const price = Math.max(step, Math.round((template.weight * yearOfCosts(niche) * jitter) / step) * step);
    return {
      id: `mkt_${hash(`${seed}:${template.name}`).toString(36)}`,
      blurb: template.blurb,
      reserve: price,
      sellerId: null,
      asset: {
        id: `ast_${hash(`${seed}:${template.name}:asset`).toString(36)}`,
        kind: template.kind,
        name: template.name,
        effect: template.effect(niche),
        bookValue: price,
        // `expiresIn` is counted down once a tick, and a life is written in
        // years, so a five-year licence is sixty months.
        expiresIn: template.life === undefined ? undefined : template.life * Math.max(1, periods),
      },
    };
  });
}

/**
 * What a company gets for selling something it owns.
 *
 * Never the book value. A sale is a discount even when nobody is forcing it —
 * a second-hand licence is worth less than a new one — and a company selling
 * because it cannot pay its bills gets considerably less, because the market
 * can see the position it is in.
 *
 * This discount is the whole reason distress is expensive. A team that sells
 * its way out of a bad year comes back smaller, and the rival who bought the
 * thing got it cheaply. Both halves of that are the point.
 */
export function resaleValue(asset: CompanyAsset, opts: { forced: boolean }): number {
  const wear = asset.expiresIn === undefined ? 0.85 : Math.max(0.35, Math.min(0.8, 0.28 + asset.expiresIn * 0.13));
  const distress = opts.forced ? 0.6 : 1;
  return Math.round(asset.bookValue * wear * distress);
}

export interface Bid {
  ventureId: string;
  listingId: string;
  amount: number;
}

export interface Award {
  listingId: string;
  /** Null when nothing cleared the reserve. */
  winnerId: string | null;
  price: number;
  /** Everyone who bid, so the screen can say how close it was without naming numbers. */
  bidderCount: number;
  /**
   * Teams whose bid cleared the reserve and was set aside because they had
   * already spent the money on an earlier lot. They are owed an explanation:
   * from where they sit, a winning bid took nothing and said nothing.
   */
  couldNotAfford: string[];
  note: string;
}

/**
 * Who gets what, once the bids are in.
 *
 * Highest bid over the reserve takes it, and pays what they bid. A second-price
 * auction would be kinder to the winner and much harder to explain, and a
 * marketplace nobody can explain to their teammates is one they stop using.
 *
 * Ties break on the venture id, which is arbitrary and, crucially, stable: the
 * same tick re-run awards the same asset to the same team. An arbitrary rule
 * everyone can check beats a fair-sounding one that changes its mind.
 *
 * ## One pot of money, spent once
 *
 * The lots are settled one after another against a running balance, not each
 * one independently against the opening one. Independently was what this did,
 * and it meant a team with a million pounds could bid a million on three
 * separate lots, win all three, and pay three million. Bids are sealed, so
 * nothing on any screen would have warned them, and nothing afterwards
 * recorded a borrowing — the company simply came out of the year two million
 * overdrawn with no debt against its name and no insolvency until the
 * following year noticed.
 *
 * Bidding on more than you can afford is a perfectly reasonable thing to do
 * against sealed bids: you do not know which you will win. So it is allowed,
 * and the consequence is that winning an early lot can take you out of the
 * running for a later one — which is the actual decision the marketplace is
 * meant to pose. The team is told exactly that, by name, rather than left to
 * work out why a bid that cleared the reserve took nothing.
 */
export function resolveBids(listings: Listing[], bids: Bid[], funds: Record<string, number>): Award[] {
  /*
   * A working copy. The caller's record is what the companies actually hold
   * and mutating it would make this function's result depend on whether it had
   * been called before.
   */
  const left: Record<string, number> = { ...funds };

  return listings.map((listing) => {
    const short: string[] = [];
    const contenders = bids
      .filter((b) => b.listingId === listing.id && b.amount >= listing.reserve)
      // A bid nobody can pay for is not a bid. Checked here rather than when
      // it was made, because the money may have gone somewhere else since —
      // including, now, to an earlier lot in this same auction.
      .filter((b) => {
        if ((left[b.ventureId] ?? 0) >= b.amount) return true;
        short.push(b.ventureId);
        return false;
      })
      .sort((a, b) => b.amount - a.amount || (a.ventureId < b.ventureId ? -1 : 1));

    const all = bids.filter((b) => b.listingId === listing.id).length;
    const winner = contenders[0];

    if (!winner) {
      return {
        listingId: listing.id,
        winnerId: null,
        price: 0,
        bidderCount: all,
        couldNotAfford: short,
        note: all > 0
          ? `${listing.asset.name} went unsold — nothing on the table cleared the reserve.`
          : `${listing.asset.name} went unsold. Nobody bid.`,
      };
    }

    // Spent. The next lot is bid for with what is left, not with what was there.
    left[winner.ventureId] = (left[winner.ventureId] ?? 0) - winner.amount;

    const runnerUp = contenders[1];
    return {
      listingId: listing.id,
      winnerId: winner.ventureId,
      price: winner.amount,
      bidderCount: all,
      couldNotAfford: short,
      note: runnerUp
        ? `${listing.asset.name} sold for ${winner.amount.toLocaleString()}, against ${contenders.length - 1} other bid${contenders.length === 2 ? "" : "s"}.`
        : `${listing.asset.name} sold for ${winner.amount.toLocaleString()}. Nobody else bid for it.`,
    };
  });
}

/** What a venture can actually commit to bids, given everything else it has promised. */
export const biddableFunds = (company: Company): number =>
  Math.max(0, company.cash + Math.max(0, company.creditLimit - company.debt));

/**
 * A company's own things, offered to everyone else.
 *
 * Priced by the seller rather than by the market: they set a reserve, and
 * whether anybody meets it is the answer to whether they priced it honestly.
 */
export function ownListing(company: Company, assetId: string, reserve: number): Listing | null {
  const asset = company.assets.find((a) => a.id === assetId);
  if (!asset) return null;
  return {
    id: `own_${company.id}_${asset.id}`,
    asset,
    blurb: `Second-hand, from ${company.name}.`,
    reserve: Math.max(0, Math.round(reserve)),
    sellerId: company.id,
  };
}
