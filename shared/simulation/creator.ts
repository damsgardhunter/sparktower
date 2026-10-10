/**
 * A market whose customers do not pay: a channel, a show, a feed.
 *
 * The engine was written for businesses that sell something. A customer
 * chooses you, pays your price, and you can serve only as many as your
 * capacity holds — which is a fair model of a gym or a delivery company and a
 * strange one of a YouTube channel. A golf comedy channel was being played as
 * a subscription: viewers paying three dollars a year each, and "subscribers
 * you turn away" once the uploads per week were full.
 *
 * In an audience market (`niche.model === "audience"`):
 *
 *   - **Subscribing is free.** Viewers choose a channel on rewatchability,
 *     recognition, reputation — and on how much of every video is an ad read.
 *     Price plays no part in who subscribes (`audienceMarket`).
 *   - **Capacity is production, not a door.** Nobody is turned away. A
 *     channel whose audience outgrows what it can make gets fewer views per
 *     subscriber instead: the same uploads spread thinner (`viewsFor`). So
 *     building production, the founders "recording two at a time", and a
 *     collaboration's extra output all still pay — as views.
 *   - **Money comes from three places.** Ads on views once the channel is
 *     big enough to be in the partner programme; sponsors, who have a fixed
 *     budget a year and choose between every channel in the market — the
 *     incumbents included — on views, fit and reputation; and memberships,
 *     which is what the price lever now sets.
 *   - **Growth is a journey.** Each milestone is a moment in the report, and
 *     two of them change the business: ads switch on, and sponsors start
 *     looking.
 *
 * Pure: everything here takes numbers and returns numbers, so the engine,
 * the forecast and the tests read the same rules.
 */
import type { Company, Niche, Segment } from "./types";
import { priceFor } from "./responsibilities";
import { hash } from "./random";

/** A brand with money to spend on this market's audience. */
export interface Sponsor {
  id: string;
  name: string;
  /** What they sell, said plainly: "golf balls", "a betting app". */
  sells: string;
  /** The segment whose attention they are buying. */
  segment: string;
  /** What they spend on this market in a year, across every channel. */
  budget: number;
  /** What they pay per thousand views of a video carrying their read. */
  cpm: number;
}

export interface Milestone {
  /** Subscribers. */
  at: number;
  name: string;
  /** What reaching it changes, or what it means, in one line. */
  means: string;
}

export interface AudienceModel {
  /** Share of subscribers who watch a typical upload. */
  viewShare: number;
  /** Uploads in a year at the market's ordinary pace. */
  uploadsPerYear: number;
  /** What a thousand views earn in ads, by segment (RPM). */
  rpm: Record<string, number>;
  /** Subscribers before ads pay anything: the partner programme. */
  partnerAt: number;
  /** Subscribers before a sponsor will look at you. */
  sponsorsFrom: number;
  sponsors: Sponsor[];
  /** Of a segment's subscribers, the share who would join at its expected price. */
  memberRate: number;
  milestones: Milestone[];
  /** Words for this trade: "views" or "downloads", "uploads" or "episodes". */
  words?: { views: string; upload: string; uploads: string; members: string; read: string };
}

export const isAudience = (niche: Pick<Niche, "model">): boolean => niche.model === "audience";

/** What a market's words are when the model leaves them unsaid. */
export const AUDIENCE_WORDS = { views: "views", upload: "upload", uploads: "uploads", members: "members", read: "sponsor read" };
export const wordsOf = (niche: Pick<Niche, "audience">) => ({ ...AUDIENCE_WORDS, ...(niche.audience?.words ?? {}) });

/** Sponsor reads per video, as filed, and the default for a company that has not said. */
export const READS_DEFAULT = 1;
export const READS_MAX = 3;
/**
 * What each read past the first costs in how watchable the videos are.
 *
 * A read is sixty seconds nobody came for. One is the price of the channel
 * existing; three is a channel people start skipping through.
 */
export const READ_FATIGUE = 0.07;

/**
 * What making the content costs per subscriber it reaches, as a share of the
 * unit cost. A subscriber pays nothing and costs nearly nothing; this is the
 * editing, the hosting and the kit that more audience asks for.
 */
export const AUDIENCE_SERVE_COST = 0.06;

/** How much of a segment's weight on brand survives in a recommendation feed. */
export const BRAND_IN_FEED = 0.35;

/** The price every channel is given inside the market copy, so price decides nothing. */
const NEUTRAL_PRICE = 1;

/**
 * The market as viewers see it: nobody charges, nobody is out of room.
 *
 * Used for allocation only. Segments stop weighing price, every company is
 * priced the same and never "raised its price", and capacity is unlimited so
 * nobody is turned away or spilled to a rival. Quality is what the viewer
 * actually gets — less for every sponsor read past the first.
 */
/**
 * What being in several places at once costs a channel's appeal.
 *
 * Opening somewhere new is free in an audience market (`entryCostOf`), because
 * an audience in another country is a setting rather than a lease. Free is not
 * the same as consequence-free, though, and `spreadOf` above already makes
 * each upload thinner in each place. This is the other half: a channel spread
 * across four audiences is a slightly worse fit for each of them than one made
 * for a single audience, because it is trying to be two shows.
 *
 * Deliberately small — five points per extra region, and it stops at four
 * fifths. The reach effect is the main cost of breadth and this is the
 * seasoning; a heavy appeal penalty would say the show got *worse*, which is
 * not what happens. What happens is that it fits each audience less exactly.
 */
/**
 * How much of a channel's new audience is people adding it rather than
 * swapping to it.
 *
 * "Some subscribers may want to watch both" — and until now none of them
 * could: every new subscriber came out of a named rival's list, as though
 * attention were a fixed number of people handed around. Somebody who finds a
 * second golf channel they like keeps the first one, and a market where that
 * cannot happen is one where every channel's growth is another's decline.
 *
 * A third, so the majority of a gain is still taken from somebody — the market
 * is still contested, and taking share still means taking it — but a real
 * slice of growth is the audience getting bigger rather than changing hands.
 * Used by the feed block in `resolveYear`, which also caps a segment at its
 * own demand plus this, so "they watch both" does not become "everybody holds
 * everybody".
 */
export const OVERLAP = 1 / 3;

export const SPREAD_APPEAL = 0.05;
export const SPREAD_APPEAL_FLOOR = 0.8;

export const spreadAppeal = (open: number): number =>
  Math.max(SPREAD_APPEAL_FLOOR, 1 - SPREAD_APPEAL * Math.max(0, open - 1));

/**
 * Where an incumbent is already strong, and nobody is taking it easily.
 *
 * The owner's ask: each competitor should still have strongholds. An audience
 * market has no per-region holdings to be strong in — the allocator works at
 * segment level with a regional reach factor, not a map of who owns what — so
 * inventing per-region state for one bonus would be a large change for a small
 * idea. Instead each incumbent is treated as having come from somewhere, and is
 * a little harder to beat in the kinds of viewer that somewhere over-indexes on.
 *
 * The home region is *derived* from the incumbent's own id rather than stored:
 * the same channel is strong in the same place every period of every run,
 * nothing has to be migrated, and a market generated tomorrow gets its own
 * answer for free. `City.mix` is the market's own statement about which viewers a
 * region has more of than its share.
 *
 * 1.10, and bounded by what it is beside: a company that *chooses* a segment
 * gets 1.18 (`POSITIONING_BONUS`). An advantage nobody chose and nobody earned
 * must sit below one somebody did, or declaring a position is a worse move than
 * being old.
 */
export const STRONGHOLD = 1.10;
export const STRONGHOLD_FROM_MIX = 1.02;

export function strongholdsFor(company: Company, niche: Niche): Record<string, number> | undefined {
  if (company.kind !== "incumbent" || !niche.cities.length) return undefined;
  const home = niche.cities[hash(`${niche.id}:${company.id}:home`) % niche.cities.length];
  const mix = home.mix ?? {};
  const out: Record<string, number> = {};
  for (const segment of niche.segments) {
    if ((Number(mix[segment.id]) || 1) >= STRONGHOLD_FROM_MIX) out[segment.id] = STRONGHOLD;
  }
  return Object.keys(out).length ? out : undefined;
}

export function audienceMarket(
  companies: Company[],
  niche: Niche,
  readsOf: (c: Company) => number,
): { companies: Company[]; niche: Niche } {
  /*
   * And the algorithm, not the name, decides who gets watched.
   *
   * A segment that weighs brand heavily is a segment whose viewers stick with
   * names they know — but a recommendation feed shows a video to people who
   * have never heard of the channel, on how well it holds the people it was
   * shown to. Left at its sales weight, a new channel's brand of eight made it
   * nearly invisible whatever it made, and it shrank for two years. Most of
   * brand's weight moves to rewatchability; some stays, because recognition
   * still makes a thumbnail get clicked.
   */
  const free: Niche = {
    ...niche,
    /*
     * Said on the niche so the allocator's shrink pass knows this segment may
     * hold more subscriptions than it has people — see `OVERLAP` and the
     * `canHold` note in `allocate`.
     */
    overlap: OVERLAP,
    segments: niche.segments.map((s) => ({
      ...s,
      priceSensitivity: 0,
      /*
       * And a subscription is sticky. Nobody unsubscribes from a channel
       * because a rival posted a better video this week; they watch both.
       */
      loyalty: 0.5 + s.loyalty * 0.5,
      brandFocus: s.brandFocus * BRAND_IN_FEED,
      qualityFocus: s.qualityFocus + s.brandFocus * (1 - BRAND_IN_FEED),
    })),
  };
  const viewed = companies.map((c) => {
    const reads = Math.max(0, Math.min(READS_MAX, readsOf(c)));
    const fatigue = 1 - READ_FATIGUE * Math.max(0, reads - 1);
    /*
     * Breadth costs a little fit, and age buys a little home advantage. See
     * `spreadAppeal` and `strongholdsFor`.
     */
    const spread = c.kind === "player" ? spreadAppeal((c.cities ?? []).length) : 1;
    return {
      ...c,
      focusPush: (c.focusPush ?? 1) * spread,
      strongholds: strongholdsFor(c, niche),
      price: NEUTRAL_PRICE,
      tiers: undefined,
      priceWas: NEUTRAL_PRICE,
      capacity: Number.POSITIVE_INFINITY,
      quality: Math.max(0, c.quality * fatigue),
    } as Company;
  });
  return { companies: viewed, niche: free };
}

/** The reads a company is running: its filing, or one. Incumbents run one. */
export function readsFor(company: Company, filed?: number): number {
  if (company.kind !== "player") return READS_DEFAULT;
  const n = Number(filed);
  return Number.isFinite(n) ? Math.max(0, Math.min(READS_MAX, Math.round(n))) : READS_DEFAULT;
}

const total = (bySeg: Record<string, number>): number =>
  Object.values(bySeg).reduce((sum, n) => sum + Math.max(0, n), 0);

/**
 * Views in a period, by segment.
 *
 * Subscribers × the share who watch an upload (loyal segments watch more) ×
 * uploads in the period × how rewatchable the videos are × how far the name
 * carries beyond the subscriber list — and all of it thinned when the
 * audience has outgrown production.
 */
export function viewsFor(input: {
  company: Pick<Company, "quality" | "brand" | "capacity">;
  subscribers: Record<string, number>;
  segments: Segment[];
  model: AudienceModel;
  reads: number;
  /** A period's share of a year. */
  per: number;
}): { total: number; bySegment: Record<string, number>; perUpload: number; stretched: number } {
  const { company, subscribers, segments, model, reads, per } = input;
  const subs = total(subscribers);
  const uploads = Math.max(1, model.uploadsPerYear * per);
  const rewatch = 0.5 + Math.max(0, Math.min(100, company.quality)) / 100;
  const reach = 1 + 0.3 * Math.max(0, Math.min(100, company.brand)) / 100;
  /* Production the audience has outgrown: the same output, spread over more people. */
  const stretched = subs > 0 && company.capacity < subs ? Math.sqrt(Math.max(0, company.capacity) / subs) : 1;
  const skip = 1 - READ_FATIGUE * Math.max(0, reads - 1);
  const bySegment: Record<string, number> = {};
  let sum = 0;
  for (const s of segments) {
    const n = Math.max(0, subscribers[s.id] ?? 0);
    const v = n * model.viewShare * (0.6 + 0.6 * s.loyalty) * uploads * rewatch * reach * stretched * skip;
    bySegment[s.id] = v;
    sum += v;
  }
  return { total: sum, bySegment, perUpload: sum / uploads, stretched };
}

/** Ad revenue on a period's views, once the channel is in the partner programme. */
export function adRevenueFor(views: Record<string, number>, model: AudienceModel, subscribers: number): number {
  if (subscribers < model.partnerAt) return 0;
  return Object.entries(views).reduce((sum, [seg, v]) => sum + (v / 1000) * (model.rpm[seg] ?? 0), 0);
}

/**
 * Members: the subscribers who pay to be closer.
 *
 * The share who join is the market's member rate, more of it in loyal
 * segments, and moved by the price against what each segment expects — so the
 * price lever is still a real decision, about this and nothing else. Price
 * nought means no memberships at all.
 */
export function membersFor(input: {
  company: Pick<Company, "price" | "tiers" | "positioning">;
  subscribers: Record<string, number>;
  segments: Segment[];
  model: AudienceModel;
  expected: (s: Segment) => number;
}): { members: number; revenue: number; bySegment: Record<string, number> } {
  const { company, subscribers, segments, model, expected } = input;
  let members = 0;
  let revenue = 0;
  const bySegment: Record<string, number> = {};
  for (const s of segments) {
    const price = priceFor(company, s.id);
    const n = Math.max(0, subscribers[s.id] ?? 0);
    if (price <= 0 || n === 0) { bySegment[s.id] = 0; continue; }
    const ratio = price / Math.max(0.01, expected(s));
    const take = Math.max(0, Math.min(1.4, 1 - Math.max(0.3, s.priceSensitivity) * (ratio - 1) * 1.5));
    const m = n * model.memberRate * (0.5 + s.loyalty) * take * (input.company.positioning === s.id ? POSITIONED_MEMBERS : 1);
    bySegment[s.id] = m;
    members += m;
    revenue += m * price;
  }
  return { members, revenue, bySegment };
}

/** A channel as the sponsors see it. */
export interface Channel {
  id: string;
  subscribers: Record<string, number>;
  /** Views per upload this period. */
  perUpload: number;
  uploads: number;
  reads: number;
  reputation: number;
}

export interface SponsorDeal { sponsorId: string; name: string; sells: string; amount: number; reads: number }

/**
 * Who the sponsors pay this period.
 *
 * Each sponsor has a year's budget and spends a period's share of it across
 * every channel big enough to look at, in proportion to what it is getting:
 * the channel's views per upload, the share of its audience that is the
 * sponsor's segment, and whether it can be trusted with a brand — raised a
 * little past proportional (`SPONSOR_CONCENTRATION`), because sponsors do
 * concentrate on the best fit, but not so far that a growing channel is
 * priced out by one giant. Squared, a 27,000-subscriber channel with four
 * sponsors was paid $146 a month while the leader took half of every budget. A channel is
 * paid no more than its reads are worth at the sponsor's rate; whatever it
 * cannot carry goes to the next channel in line rather than being wasted, and
 * whatever nobody can carry stays with the sponsor.
 *
 * This is where channels compete for money. Every sponsor's budget is fixed,
 * and an incumbent with five times the views takes most of it unless a
 * smaller channel is the closer fit for that sponsor's people.
 */
export function sponsorMarket(input: { channels: Channel[]; model: AudienceModel; per: number; demand?: number }): Map<string, SponsorDeal[]> {
  const { channels, model, per } = input;
  const deals = new Map<string, SponsorDeal[]>();
  const slotsLeft = new Map(channels.map((c) => [c.id, c.uploads * c.reads]));
  for (const sponsor of model.sponsors) {
    let budget = sponsor.budget * per * (input.demand ?? 1);
    const eligible = channels.filter((c) => total(c.subscribers) >= model.sponsorsFrom && c.reads > 0);
    for (let round = 0; round < 3 && budget > 1; round++) {
      const open = eligible.filter((c) => (slotsLeft.get(c.id) ?? 0) > 0.01);
      if (!open.length) break;
      const scored = open.map((c) => {
        const subs = total(c.subscribers) || 1;
        const fit = 0.25 + 0.75 * (Math.max(0, c.subscribers[sponsor.segment] ?? 0) / subs);
        const trust = 0.5 + 0.5 * Math.max(0, Math.min(100, c.reputation)) / 100;
        return { c, score: Math.pow(c.perUpload * fit * trust, SPONSOR_CONCENTRATION) };
      });
      const sum = scored.reduce((a, x) => a + x.score, 0);
      if (sum <= 0) break;
      let spent = 0;
      for (const { c, score } of scored) {
        const offered = budget * (score / sum);
        const perRead = (c.perUpload / 1000) * sponsor.cpm;
        if (perRead <= 0) continue;
        const reads = Math.min(slotsLeft.get(c.id) ?? 0, offered / perRead);
        const amount = reads * perRead;
        if (amount < 1) continue;
        slotsLeft.set(c.id, (slotsLeft.get(c.id) ?? 0) - reads);
        spent += amount;
        const list = deals.get(c.id) ?? [];
        const prior = list.find((d) => d.sponsorId === sponsor.id);
        if (prior) { prior.amount += amount; prior.reads += reads; }
        else list.push({ sponsorId: sponsor.id, name: sponsor.name, sells: sponsor.sells, amount, reads });
        deals.set(c.id, list);
      }
      budget -= spent;
      if (spent <= 0) break;
    }
  }
  return deals;
}

/** How far sponsors favour the strongest channels over a straight proportional split. */
export const SPONSOR_CONCENTRATION = 1;

/** Milestones crossed between two subscriber counts, in order. */
export function milestonesCrossed(model: AudienceModel, before: number, after: number): Milestone[] {
  return model.milestones.filter((m) => before < m.at && after >= m.at).sort((a, b) => a.at - b.at);
}

/** The next milestone ahead of a channel, if any. */
export const nextMilestone = (model: AudienceModel, subscribers: number): Milestone | null =>
  [...model.milestones].sort((a, b) => a.at - b.at).find((m) => m.at > subscribers) ?? null;

/** YouTube's own thresholds: the ones every creator knows. */
export const CHANNEL_MILESTONES: Milestone[] = [
  { at: 1_000, name: "The partner programme", means: "Ads start paying on every view." },
  { at: 5_000, name: "On the sponsors' lists", means: "Small brands start sending offers." },
  { at: 10_000, name: "Ten thousand", means: "Big enough that sponsors compare you with the established channels." },
  { at: 100_000, name: "Silver Play Button", means: "A real channel. The bigger brands take your calls." },
  { at: 1_000_000, name: "Gold Play Button", means: "A household name in your corner of the internet." },
];

/** What one period's audience did, for the report and the desk. */
export interface CreatorReport {
  subscribers: number;
  views: number;
  /** Subscribers the feed brought in this period. */
  discovered: number;
  /** Uploads that broke out of the usual audience this period: 0 or 1. See `breakout.ts`. */
  breakouts: number;
  /** The one that did, and how far it went. */
  breakout?: { tier: string; views: number };
  viewsPerUpload: number;
  uploads: number;
  reads: number;
  adRevenue: number;
  sponsorRevenue: number;
  memberRevenue: number;
  members: number;
  monetised: boolean;
  sponsored: boolean;
  deals: SponsorDeal[];
  /** Below one when the audience has outgrown production. */
  stretched: number;
  milestones: Milestone[];
  next: Milestone | null;
}

/**
 * Sponsors for a market that did not name any: one per segment, each spending
 * what that segment's attention is worth across the whole market.
 *
 * A written market should name its own — a golf ball, a betting app — and
 * this is the fallback for one written before sponsors existed.
 */
export function defaultSponsors(niche: Pick<Niche, "segments">, rpm: Record<string, number>): Sponsor[] {
  return niche.segments.map((s, i) => ({
    id: `sponsor_${i + 1}`,
    name: `A brand for ${s.name.toLowerCase()}`,
    sells: "something these viewers buy",
    segment: s.id,
    budget: Math.round(s.size * Math.max(1, rpm[s.id] ?? 4) * 0.15),
    cpm: Math.round(Math.max(10, (rpm[s.id] ?? 4) * 5)),
  }));
}

/**
 * An audience model filled in from whatever a market said, with the gaps
 * closed so the engine never meets an undefined rate.
 */
export function audienceModelFor(niche: Pick<Niche, "segments" | "audience">): AudienceModel {
  const given = niche.audience ?? ({} as Partial<AudienceModel>);
  const rpm: Record<string, number> = {};
  for (const s of niche.segments) {
    const r = Number(given.rpm?.[s.id]);
    rpm[s.id] = Number.isFinite(r) && r >= 0 ? Math.min(60, r) : 4;
  }
  const num = (v: unknown, lo: number, hi: number, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
  };
  const ids = new Set(niche.segments.map((s) => s.id));
  const sponsors = (Array.isArray(given.sponsors) ? given.sponsors : [])
    .filter((s) => s && typeof s.name === "string" && ids.has(s.segment))
    .slice(0, 8)
    .map((s, i) => ({
      id: typeof s.id === "string" && s.id ? s.id : `sponsor_${i + 1}`,
      name: String(s.name).slice(0, 60),
      sells: String(s.sells ?? "").slice(0, 80) || "something these viewers buy",
      segment: s.segment,
      budget: num(s.budget, 0, 1e9, 0),
      cpm: num(s.cpm, 1, 200, 20),
    }))
    .filter((s) => s.budget > 0);
  const milestones = (Array.isArray(given.milestones) && given.milestones.length ? given.milestones : CHANNEL_MILESTONES)
    .filter((m) => m && Number.isFinite(Number(m.at)) && Number(m.at) > 0)
    .map((m) => ({ at: Number(m.at), name: String(m.name ?? "").slice(0, 60), means: String(m.means ?? "").slice(0, 120) }));
  return {
    viewShare: num(given.viewShare, 0.02, 1, 0.25),
    uploadsPerYear: num(given.uploadsPerYear, 4, 730, 104),
    rpm,
    partnerAt: num(given.partnerAt, 0, 1e9, 1_000),
    sponsorsFrom: num(given.sponsorsFrom, 0, 1e9, 5_000),
    sponsors: sponsors.length ? sponsors : defaultSponsors(niche, rpm),
    memberRate: num(given.memberRate, 0, 0.2, 0.015),
    milestones,
    ...(given.words ? { words: { ...AUDIENCE_WORDS, ...given.words } } : {}),
  };
}

/** Of the people a video is shown to, the share who watch it at rewatchability 100. */
export const CLICK_THROUGH = 0.09;
/** Of those who watch, the share who subscribe at rewatchability 100. */
export const SUBSCRIBE_RATE = 0.05;
/** Impressions an upload gets from the feed, as a share of the whole market, before quality. */
export const FEED_SHARE = 0.02;
/**
 * Strangers reached per view from a subscriber: shares, group chats, the
 * "people also watched" shelf. This is what compounds — a bigger audience is a
 * bigger door, which is why channels grow slowly and then quickly.
 */
export const SHARE_REACH = 0.3;
/**
 * The most of any one channel's audience the feed can move to others in a
 * year: attention drifts, it does not stampede.
 */
export const FEED_DRAIN = 0.3;
/**
 * What paid promotion can do to an upload's reach at the most: four times it.
 * Paired with a word of mouth that only compounds slowly, so that money buys
 * growth — a channel that pays to be seen grows faster than one waiting to be
 * shared, which is how the platforms actually work.
 */
export const PROMOTION_REACH = 1.5;
/**
 * What being in several regions does to an upload's reach, against being in
 * the biggest of them alone.
 *
 * More regions is more people the feed can find for you, so reach grows — and
 * every upload is one video spread across all of them, so it grows by the
 * square root of how many there are, not in proportion. Two regions the same
 * size reach about 1.4 times as far; four, twice. Measured against the
 * largest open region rather than the whole market, so a channel in one place
 * reaches exactly as it did before regions cost nothing to enter.
 */
export function spreadOf(open?: { weight: number }[]): number {
  const weights = (open ?? []).map((c) => Math.max(0, c.weight)).filter((w) => w > 0);
  if (weights.length <= 1) return 1;
  const total = weights.reduce((a, w) => a + w, 0);
  return total / Math.sqrt(weights.length) / Math.max(...weights);
}

/** How much better a channel that has named its audience turns viewers into subscribers. */
export const POSITIONED_CONVERSION = 1.3;
/** And how much more of that audience pays for a membership. */
export const POSITIONED_MEMBERS = 1.5;
/** How often a video breaks out, at rewatchability 100, per upload. */
export const VIRAL_CHANCE = 0.03;
/** What a breakout multiplies that upload's reach by. */
export const VIRAL_REACH = 12;

/**
 * New subscribers from the feed: the way a channel actually grows.
 *
 * The market's own allocation shares a fixed audience between channels on
 * appeal, which is right for who stays and wrong for who arrives — a new
 * channel does not take viewers off an incumbent by being better on average,
 * it is shown to strangers one upload at a time and some of them subscribe.
 * So each upload is shown to a slice of the market (more for a rewatchable
 * channel, a known name and paid promotion), a share click, a share of those
 * subscribe. Squared on rewatchability because the feed rewards what holds
 * people with more impressions *and* converts them better.
 *
 * `roll`, when given, is the chance machinery for a breakout video: the real
 * year has one, a projection does not, because a forecast that included luck
 * would be a forecast of luck.
 */
export function discoveryFor(input: {
  company: Pick<Company, "quality" | "brand" | "positioning">;
  segments: Segment[];
  model: AudienceModel;
  per: number;
  /** 0–1: how much paid promotion is lifting reach. */
  promotion: number;
  /** Views this period from people already subscribed, which spill outward. */
  subscriberViews?: number;
  /**
   * The regions the company is open in, by their share of the market. Each
   * one is more people the feed can show you to, and each upload is spread
   * across all of them — see `spreadOf`. Absent, the channel reaches as it
   * always has.
   */
  open?: { weight: number }[];
  /**
   * The chief executive's focus, as a push on reach: a growth month has the
   * whole company promoting every upload, a margin or survival month does not.
   * Squared on the way in, because the feed rewards a push twice — more
   * impressions, and more of them from the people it already knows will click.
   */
  push?: number;
  roll?: () => number;
}): { gains: Record<string, number>; views: number; breakout: number } {
  const { company, segments, model, per, promotion, roll } = input;
  const market = segments.reduce((a, s) => a + s.size, 0) || 1;
  const q = Math.max(0, Math.min(100, company.quality)) / 100;
  const uploads = Math.max(1, model.uploadsPerYear * per);
  let breakout = 0;
  if (roll) for (let i = 0; i < Math.round(uploads); i++) if (roll() < VIRAL_CHANCE * q) breakout += 1;
  /*
   * Craft first. The feed rewards what holds people, so rewatchability is the
   * biggest term; recognition and paid promotion help, and neither can
   * substitute for it. Squaring quality and dividing brand by sixty was
   * tried and made money the only route: a channel with no budget ended on a
   * tenth of a funded one's audience however good its videos were.
   */
  const reachPerUpload = market * FEED_SHARE * (0.3 + 0.7 * q) * (1 + Math.max(0, Math.min(100, company.brand)) / 150) * (1 + PROMOTION_REACH * promotion);
  const push = Math.pow(Math.max(0, input.push ?? 1), 2);
  const shown = (reachPerUpload * spreadOf(input.open) * (uploads + breakout * (VIRAL_REACH - 1)) + (input.subscriberViews ?? 0) * SHARE_REACH * (0.3 + q)) * push;
  const views = shown * CLICK_THROUGH * (0.3 + q);
  /*
   * A channel that knows who it is for converts better: the stranger it finds
   * is more often the person it was made for. Paid for in reach — see the
   * weights below, where everybody else sees less of it.
   */
  const subscribed = views * SUBSCRIBE_RATE * (0.4 + q) * (company.positioning ? POSITIONED_CONVERSION : 1);
  /* Being for somebody: the feed shows a channel that knows its audience to more of exactly them. */
  const weight = (s: Segment) => s.size * (0.5 + s.qualityFocus) * (company.positioning === s.id ? 3 : company.positioning ? 0.8 : 1);
  const total = segments.reduce((a, s) => a + weight(s), 0) || 1;
  const gains = Object.fromEntries(segments.map((s) => [s.id, subscribed * (weight(s) / total)]));
  return { gains, views, breakout };
}

/**
 * A channel market written before this model existed, made into one.
 *
 * Its `referencePrice` was what one subscriber was worth a year — single
 * digits — and here it is what a member pays, so a figure that small is lifted
 * to a membership's size. Everything else the market said is kept; what it
 * never said (rates, sponsors) is filled in by `audienceModelFor`.
 */
export function asAudience(niche: Niche): Niche {
  if (niche.model === "audience") return niche;
  const segments = niche.segments.map((s) => s.referencePrice >= 20 ? s : {
    ...s,
    referencePrice: Math.round(Math.max(24, Math.min(180, s.referencePrice * 8))),
  });
  return { ...niche, segments, model: "audience", audience: audienceModelFor({ segments, audience: niche.audience }) };
}

/** A project whose market should be played as an audience rather than a sale. */
export const AUDIENCE_SUBCATEGORIES: ReadonlySet<string> = new Set(["channel"]);

/**
 * What a year of this market's audience is worth, all of it, to whoever holds it.
 *
 * For a market that sells this is customers at their price; for an audience
 * it is the views the ads pay for, the members' fees and the sponsors'
 * budgets. It decides what a company here costs to run (`marketScale`), so
 * pricing an audience as though every listener paid the membership made a
 * podcast network carry the payroll of a business ten times its size.
 */
export function audienceValue(niche: Pick<Niche, "segments" | "audience">): number {
  const m = audienceModelFor(niche);
  let views = 0;
  let members = 0;
  for (const s of niche.segments) {
    views += s.size * m.viewShare * (0.6 + 0.6 * s.loyalty) * m.uploadsPerYear * (m.rpm[s.id] ?? 0) / 1000;
    members += s.size * m.memberRate * (0.5 + s.loyalty) * s.referencePrice;
  }
  const sponsors = m.sponsors.reduce((a, sp) => a + sp.budget, 0);
  return views + members + sponsors;
}
