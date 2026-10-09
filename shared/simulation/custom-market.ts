/**
 * A market written for one business, rather than chosen from the seven.
 *
 * The seven markets in `niches.ts` are hand-balanced worlds. They cover a lot,
 * and they do not cover everybody: a person building a tool for veterinary
 * practices in one country is told to go and play at dating apps, which
 * teaches the mechanics and not their business. So Nova can write a market
 * instead — its segments, its regions, the companies already there, and the
 * words it uses for customers and capacity.
 *
 * Everything the engine reads it reads by shape, so a written market plays
 * exactly like a hand-made one. What it does not get is the balancing: the
 * seven are tuned against each other and against fourteen years of play, and
 * this is one model's best guess. So the numbers are not taken on trust.
 *
 * ## The rule this file exists for
 *
 * A market that is wrong is worse than no market. Not because it is unfair —
 * a hard market is fine — but because a market whose weights do not sum, or
 * whose incumbents own 140% of it, produces an engine that divides by zero or
 * a first year where nothing a team does can matter. Both read as "the game is
 * broken", and neither is something a player can see coming.
 *
 * So every number is clamped to a range the engine is known to survive, the
 * shares are normalised rather than rejected, and anything missing is filled
 * with a sane default. `buildCustomMarket` cannot fail: it either returns a
 * playable market or it returns null, and null means "use one of the seven".
 */
import type { City, IncumbentSeed, Niche, NicheVoice, Segment, IncumbentPosture } from "./types";
import type { WorkKind } from "./workforce";
import { ASSET_SLOTS } from "./assets";
import { marketScale } from "./world";
import { officerCost, SALARY } from "./decisions";
import { TRULY_OPEN_SHARE } from "./incumbents";

/** What a small market is allowed to be. Below this the maths has nothing to work with. */
export const MIN_SEGMENT_SIZE = 2_000;
/**
 * And what it cannot exceed.
 *
 * Not a balance rule — a model asked about "enterprise CRM" will happily write
 * a market of four hundred million, which makes the first year's share
 * unreadable and every later decision cosmetic. The cap keeps a written market
 * in the same order of magnitude as the seven, so the same levers move it.
 */
export const MAX_SEGMENT_SIZE = 4_000_000;

/**
 * The most one sale may be worth.
 *
 * This was an unnamed `100_000` inside the parse, and it quietly destroyed
 * every business whose customers pay more than that. A launch company written
 * as 40 operators at £4.5m and 260 research payloads at £600k came out as two
 * *identical* segments at £100,000 — the contrast the market was written to
 * have, erased — and then could not survive its own payroll, because the unit
 * cost stayed where it was while the price it was allowed to charge fell by
 * a factor of forty-five.
 *
 * Ten million, because a sale really can be worth that: a dedicated small
 * launch, an enterprise licence, a building, a ship. Not unbounded, for the
 * same reason `MAX_SEGMENT_SIZE` is not — a model asked about "enterprise
 * software" will write a number with no relation to anything, and
 * `marketScale` caps at 1 anyway, so past a point the extra zeros buy nothing
 * but an unreadable first year.
 */
export const MAX_REFERENCE_PRICE = 10_000_000;

/**
 * How much revenue one person on the payroll may be credited with, as a
 * multiple of an ordinary salary.
 *
 * `serves` — how many customers one worker looks after — is market content, and
 * the engine is now properly sensitive to it: a consultancy whose consultants
 * cover eight clients each finishes a season on a 14% net margin, which is what
 * a consultancy earns. The same engine with an editor covering sixty thousand
 * viewers finishes on 55%, because `price x serves` is the revenue one person is
 * held to produce and sixty thousand viewers at £12 is £720,000 a head.
 *
 * So the figure is believed and bounded, exactly as `affordableUnitCost` bounds
 * what the model says a sale costs. Nobody employs a person who brings in less
 * than about one and a half times their salary, and almost nobody — outside a
 * business with barely any people in it — runs above six.
 *
 * The bound does the work a guess cannot: it is applied to what the market
 * actually says rather than replacing it, so a market that knows its trade
 * keeps its own number and only an implausible one is pulled back.
 */
export const MIN_REVENUE_PER_HEAD = 1.5;
export const MAX_REVENUE_PER_HEAD = 6;
export const MIN_SEGMENTS = 2, MAX_SEGMENTS = 5;
export const MIN_REGIONS = 3, MAX_REGIONS = 10;
export const MIN_INCUMBENTS = 2, MAX_INCUMBENTS = 5;

/**
 * How many rivals a season Nova customises for one project comes with.
 *
 * Four, exactly, and not the two-to-five the general builder allows. A
 * customised season is read before it is played — the point of it is the
 * screen that says "here is who already has this market and here is what is
 * left for you" — and that screen is a comparison. Two rivals is not a market
 * anybody recognises, five is a list nobody finishes, and a number that moved
 * between seasons would make two runs of the same project incomparable.
 *
 * It is also the whole competition: a customised season seats no bot companies
 * beside these four, so what you see on that screen is what you are playing
 * against.
 */
export const RIVALS_IN_A_CUSTOM_SEASON = 4;

/**
 * Who holds this market today, and what is left for the person about to enter it.
 *
 * Worked out here rather than asked for, because a model asked to predict a
 * share will give you a number that sounds right and cannot be checked against
 * anything. These come from the market it actually wrote: the rivals' own
 * `startingShare`, normalised if they add up to more than all of it, and the
 * remainder — which is the room the engine will really allocate in year one.
 *
 * So the screen somebody reads before they play and the world they then play
 * are the same arithmetic, and a rival who looks unbeatable on that screen is
 * unbeatable for a reason they can point at.
 */
export function marketShares(niche: Pick<Niche, "incumbents">): {
  rivals: { id: string; name: string; share: number; posture: string; knock: string }[];
  /** What no incumbent holds — the newcomer's ceiling in year one, 0–1. */
  open: number;
} {
  const held = niche.incumbents.reduce((sum, i) => sum + Math.max(0, i.startingShare), 0);
  /*
   * Normalised only when they have overshot. A model that hands back four
   * rivals holding 0.9 between them has left a tenth open and meant to; one
   * that hands back four holding 1.4 has not thought about it, and scaling
   * them back to 0.95 keeps their *relative* sizes — which is the part it did
   * think about — while leaving a door.
   */
  const scale = held > 0.95 ? 0.95 / held : 1;
  const rivals = niche.incumbents.map((i) => ({
    id: i.id,
    name: i.name,
    share: Math.max(0, i.startingShare) * scale,
    posture: i.posture,
    knock: i.persona.knock,
  }));
  const open = Math.max(0, 1 - rivals.reduce((sum, r) => sum + r.share, 0));
  return { rivals, open };
}
/**
 * How much of the market the incumbents hold between them at year zero.
 *
 * This was a single number, and every market Nova wrote was renormalised onto
 * it — so a trade with two sleepy local operators and a trade with four
 * entrenched giants came out identical at 88% held, and the only difference
 * left between them was how good the incumbents were at defending it. The
 * thing a founder most wants to know before entering a market — *is there
 * room* — was a constant. Two completely different businesses I built seasons
 * for both reported "12% is open", because 12% was what 1 − 0.88 came to.
 *
 * So it is a band. What Nova wrote stands when it falls inside, because how
 * contested a market is, is a real fact about it and the model is being asked
 * to know it. Outside the band it is scaled to the nearer edge:
 *
 *   - The ceiling, because a market held outright has no way in, and a season
 *     whose first year can only fail is not a season.
 *   - The floor, because an "emerging" market where the incumbents hold a
 *     tenth between them is not a market anybody is competing in — it is a
 *     greenfield, and it makes every decision in the game weightless.
 *
 * Relative sizes are kept either way: who is biggest is the part the model
 * thought hardest about.
 */
export const INCUMBENT_SHARE_MIN = 0.35;
export const INCUMBENT_SHARE_MAX = 0.88;
/** @deprecated The ceiling of the band. Kept as the old name for callers that meant "the most they hold". */
export const INCUMBENT_SHARE_TOTAL = INCUMBENT_SHARE_MAX;

/**
 * How strong the field is allowed to be, on average, before it is pulled back.
 *
 * The share a market's incumbents hold is banded (see `INCUMBENT_SHARE_MIN`)
 * and how *good* they are was not, so Nova could write four rivals at ninety
 * for quality and brand and the market was decided before anybody sat down. A
 * company opens at quality 38 and brand 8; four years of good play reaches
 * about 64 and 57. Against a field averaging ninety, nothing a founder does
 * changes the ordering, and a season whose first period can only fail is not a
 * season — the same argument the share band is built on.
 *
 * It is a ceiling on the *mean*, not on any one rival, because the market
 * leader being excellent is the point. A single fortress at 88 with three
 * ordinary rivals behind it is a hard market and a real one, and it passes
 * here untouched. Both markets in `docs/simulation-playtest.md` average in the
 * fifties, as do all seven catalogue markets, so nothing anybody has played
 * moves.
 *
 * Scaled rather than clipped, so the relative ordering survives: who is best
 * stays best, and the gaps between them keep their proportions.
 */
export const INCUMBENT_STRENGTH_MEAN_MAX = 70;

const POSTURES: IncumbentPosture[] = ["fortress", "brawler", "coaster", "innovator"];

/**
 * Pull a field of ratings back until its average sits under the ceiling.
 *
 * Multiplied by one factor, so nobody is reordered and nobody is singled out.
 */
function withinStrength(values: number[]): number[] {
  if (!values.length) return values;
  const mean = values.reduce((sum, n) => sum + n, 0) / values.length;
  if (mean <= INCUMBENT_STRENGTH_MEAN_MAX) return values;
  const factor = INCUMBENT_STRENGTH_MEAN_MAX / mean;
  /* Floored, not rounded: rounding a scaled field back up can leave the mean a shade over the ceiling. */
  return values.map((v) => Math.floor(v * factor));
}

const num = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};
const str = (v: unknown, max: number, fallback = ""): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return (s || fallback).slice(0, max);
};
/** An id the engine and the database can both hold: lowercase, no surprises. */
const slug = (v: unknown, fallback: string): string => {
  const s = str(v, 40).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return s || fallback;
};

/** Ids have to be unique inside a market, or a lookup silently picks the wrong one. */
function unique(ids: string[]): string[] {
  const seen = new Set<string>();
  return ids.map((id, i) => {
    let candidate = id;
    let n = 2;
    while (seen.has(candidate)) candidate = `${id}_${n++}`;
    seen.add(candidate);
    return candidate || `item_${i + 1}`;
  });
}

/** Shares that must sum to a total, made to. */
function normalise(values: number[], total: number): number[] {
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum <= 0) return values.map(() => total / Math.max(1, values.length));
  return values.map((v) => (v / sum) * total);
}

function cleanSegments(raw: unknown): Segment[] | null {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_SEGMENTS) : [];
  if (list.length < MIN_SEGMENTS) return null;
  const ids = unique(list.map((s: any, i) => slug(s?.id ?? s?.name, `segment_${i + 1}`)));
  return list.map((s: any, i): Segment => ({
    id: ids[i],
    name: str(s?.name, 60, `Segment ${i + 1}`),
    description: str(s?.description, 240, "People in this market."),
    size: Math.round(num(s?.size, MIN_SEGMENT_SIZE, MAX_SEGMENT_SIZE, 50_000)),
    growth: num(s?.growth, -0.15, 0.4, 0.05),
    priceSensitivity: num(s?.priceSensitivity, 0, 1, 0.5),
    qualityFocus: num(s?.qualityFocus, 0, 1, 0.5),
    brandFocus: num(s?.brandFocus, 0, 1, 0.4),
    serviceFocus: num(s?.serviceFocus, 0, 1, 0.4),
    loyalty: num(s?.loyalty, 0, 0.9, 0.4),
    // A price of zero divides by zero downstream; a pound is the floor.
    referencePrice: Math.max(1, Math.round(num(s?.referencePrice, 1, MAX_REFERENCE_PRICE, 40))),
  }));
}

/**
 * The most a region may cost to open, as a share of what that region is worth
 * in a year.
 *
 * Entry costs are the one number Nova writes in absolute money that nothing
 * scaled afterwards, and the model writes them for a company that does not
 * exist: £15,000 to £90,000, which sounds modest until it is set against a
 * founder's bank. Measured, the seven hand-written markets price a region at
 * **0.75% to 2.0%** of that region's own annual worth, every one of them, and
 * a market Nova wrote priced it at **7% to 33%** — up to thirty times dearer
 * relative to the business doing the buying.
 *
 * What that did to a season: expanding, at any point, bankrupted the company.
 * A four-year run that opened one extra region ended with nothing and 269
 * customers; the same run that never expanded ended with money and 244. The
 * main growth lever in the game was strictly worse than not touching it, so
 * the answer to "how do I get bigger than one region" was "you do not".
 *
 * The ceiling is the top of the range the catalogue already uses, so a market
 * written inside it is untouched. Past it, every region is pulled back by the
 * same factor rather than clipped one by one: "the US costs more than its size
 * alone would say" is a real thing about a market and the model was asked
 * about it, so the shape it wrote survives and only the scale moves.
 */
export const ENTRY_COST_MAX_SHARE = 0.02;

function cleanRegions(raw: unknown, segmentIds: string[], marketValue: number): City[] | null {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_REGIONS) : [];
  if (list.length < MIN_REGIONS) return null;
  const ids = unique(list.map((c: any, i) => slug(c?.id ?? c?.name, `region_${i + 1}`)));
  const weights = normalise(list.map((c: any) => num(c?.weight, 0.01, 1, 0.1)), 1);
  /*
   * Entry costs, pulled back together if any of them is past what a region of
   * that size is worth. One factor for all of them, so "the US is dearer than
   * its size alone would say" — a real thing the model knows and was asked
   * about — survives. See `ENTRY_COST_MAX_SHARE`.
   */
  /*
   * What Nova wrote, floored and defaulted at the size of *this* market.
   *
   * These used to be clamped to at least £10,000, with £250,000 standing in
   * when the model left the field out — figures from the catalogue, where a
   * market turns over £400m. Asked about a stocktake app for bottle shops,
   * Nova wrote a market worth £210,000 a year and entry costs of 5,000, 7,000
   * and 4,000: three regions, deliberately different, the cheapest being the
   * small one. All three were lifted to the £10,000 floor, came out identical,
   * and every distinction the model had drawn was gone before anybody saw it.
   *
   * A tenth of a per cent of what a region turns over is a floor that means
   * the same thing in any market, and the ceiling below does the rest.
   */
  const entryFloor = (weight: number) => Math.max(1, marketValue * weight * 0.001);
  const asked = list.map((c: any, i: number) =>
    num(c?.entryCost, entryFloor(weights[i]), 5_000_000, marketValue * weights[i] * ENTRY_COST_MAX_SHARE));
  const worst = Math.max(...asked.map((cost, i) => cost / Math.max(1, marketValue * weights[i] * ENTRY_COST_MAX_SHARE)));
  const affordable = worst > 1 ? 1 / worst : 1;
  return list.map((c: any, i): City => {
    // Only segments that exist, or the engine looks up a multiplier for nobody.
    const mix: Record<string, number> = {};
    const given = c?.segmentMix;
    if (given && typeof given === "object" && !Array.isArray(given)) {
      for (const [k, v] of Object.entries(given)) {
        const id = slug(k, "");
        if (segmentIds.includes(id)) mix[id] = num(v, 0.4, 2.0, 1);
      }
    }
    return {
      id: ids[i],
      name: str(c?.name, 60, `Region ${i + 1}`),
      weight: weights[i],
      entryCost: Math.max(1, Math.round(asked[i] * affordable)),
      note: str(c?.note, 200, "A place this market exists."),
      ...(Object.keys(mix).length ? { segmentMix: mix } : {}),
    } as City;
  });
}

function cleanIncumbents(raw: unknown): IncumbentSeed[] | null {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_INCUMBENTS) : [];
  if (list.length < MIN_INCUMBENTS) return null;
  const ids = unique(list.map((x: any, i) => slug(x?.id ?? x?.name, `rival_${i + 1}`)));
  /*
   * Taken as written when it is a market anybody would recognise, and pulled
   * to the nearer edge of the band when it is not. See INCUMBENT_SHARE_MIN.
   */
  const asWritten = list.map((x: any) => num(x?.startingShare, 0.02, 0.8, 0.2));
  const held = asWritten.reduce((sum, n) => sum + n, 0);
  const target = Math.min(INCUMBENT_SHARE_MAX, Math.max(INCUMBENT_SHARE_MIN, held));
  const shares = normalise(asWritten, target);
  /*
   * And how good they are, banded the same way the share is — a field nobody
   * could out-build decides the season before it starts. See
   * `INCUMBENT_STRENGTH_MEAN_MAX`.
   */
  const quality = withinStrength(list.map((x: any) => num(x?.quality, 10, 95, 55)));
  const brand = withinStrength(list.map((x: any) => num(x?.brand, 5, 95, 50)));
  const service = withinStrength(list.map((x: any) => num(x?.service, 10, 95, 55)));
  return list.map((x: any, i): IncumbentSeed => ({
    id: ids[i],
    name: str(x?.name, 60, `Rival ${i + 1}`),
    posture: POSTURES.includes(x?.posture) ? x.posture : POSTURES[i % POSTURES.length],
    startingShare: shares[i],
    quality: quality[i],
    brand: brand[i],
    service: service[i],
    priceIndex: num(x?.priceIndex, 0.5, 2.5, 1),
    persona: {
      tagline: str(x?.persona?.tagline, 160, "The one everyone has heard of."),
      boss: str(x?.persona?.boss, 200, "A chief executive who has been here a long time."),
      character: str(x?.persona?.character, 500, "They believe what worked before will keep working."),
      known: str(x?.persona?.known, 80, "Being first"),
      knock: str(x?.persona?.knock, 200, "Nobody has ever been excited about them."),
      voice: str(x?.persona?.voice, 200, "They have seen newcomers before."),
    },
  }));
}

/**
 * The people this business employs, as Nova described them.
 *
 * Anything missing or nonsensical falls back to the generic mix rather than
 * failing the market: a season that cannot start because a model left a field
 * out is a worse outcome than one whose people are called "operators".
 */
function cleanWorkforce(raw: unknown): WorkKind[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const kinds = raw.slice(0, 4).map((x, i) => {
    const k = (x ?? {}) as Record<string, unknown>;
    const does = k.does === "product" || k.does === "service" ? k.does : "room";
    return {
      id: str(k.id, 40, `kind_${i + 1}`).replace(/[^a-z0-9_]/gi, "_").toLowerCase(),
      name: str(k.name, 60, "staff"),
      one: str(k.one, 60, "a member of staff"),
      does: does as WorkKind["does"],
      // Nobody is free and nobody is worth ten times an ordinary salary.
      pay: Math.max(0.4, Math.min(2.5, Number(k.pay) || 1)),
      share: Math.max(0.01, Math.min(1, Number(k.share) || 0.25)),
      /*
       * How many customers one of them looks after, which is the number that
       * decides what a company here costs to run.
       *
       * This was dropped on the way in. `servesPerHead` prefers what the
       * market says and only guesses when nothing is said; nothing was ever
       * said, because the field never survived the parse — so every written
       * market fell to a guess of one worker per fifty customers, whether a
       * customer pays £2 a year or £173,400 a launch. A consultancy turning
       * over £62.9m was staffed with five people and finished a season on a
       * 60% net margin.
       *
       * Only for the kinds that serve customers: `servesPerHead` reads it off
       * the "room" share and a figure on a product engineer means nothing.
       * Undefined when unsaid, because `servesPerHead` distinguishes "said" from
       * "not said" and a zero would read as "serves nobody".
       */
      ...(does === "room" && Number(k.serves) > 0
        ? { serves: Math.max(1, Math.min(500_000, Math.round(Number(k.serves)))) }
        : {}),
    };
  });
  // Two kinds at least, or it is not a mix and the generic one is better.
  return kinds.length >= 2 ? kinds : undefined;
}

/**
 * The workforce, with any `serves` figure held to a believable revenue per head.
 *
 * See `MIN_REVENUE_PER_HEAD`. One worker covering sixty thousand viewers at £12
 * apiece is £720,000 of revenue a head, which is not a business with employees
 * in it — and the margin it produces is the difference between a season that
 * teaches something and one that mints money.
 *
 * Only ever narrows what the market said, and only on the kinds that serve
 * customers. A market that knows its trade — eight clients to a consultant —
 * passes through untouched.
 */
function staffable(mix: WorkKind[] | undefined, segments: Segment[]): WorkKind[] | undefined {
  if (!mix?.length || !segments.length) return mix;
  const people = segments.reduce((sum, s) => sum + s.size, 0);
  if (people <= 0) return mix;
  /* What the average customer pays, weighted by how many of them there are. */
  const perCustomer = segments.reduce((sum, s) => sum + s.referencePrice * s.size, 0) / people;
  if (!(perCustomer > 0)) return mix;

  const most = Math.max(1, Math.round((SALARY * MAX_REVENUE_PER_HEAD) / perCustomer));
  const least = Math.max(1, Math.round((SALARY * MIN_REVENUE_PER_HEAD) / perCustomer));
  return mix.map((k) => (k.serves && k.serves > 0
    ? { ...k, serves: Math.max(least, Math.min(most, k.serves)) }
    : k));
}

/**
 * Every word a market needs, whether or not the model said it.
 *
 * This used to fill nine of the fourteen and end with `as NicheVoice`, and the
 * cast was the bug: the five it left out were `undefined` at runtime on a type
 * that promised strings. Nothing noticed for a long time because the levers
 * that read them belong to the operations and technology desks, and the seat
 * looking at the screen only ever gets its own desk's levers — so a Nova-built
 * season crashed for the chief operating officer and nobody else, and only
 * when they opened it. A founder holding all five desks at once found it
 * immediately: `voice.capacityShort.charAt` on undefined, 500, every poll.
 *
 * Derived from what the model *did* say rather than defaulted to generic
 * words, because "capacity" is already in its vocabulary for this market and
 * "capacity you can serve" reads better than "capacity". No cast at the end,
 * so leaving a field out is now a compile error rather than a crash months
 * later on one desk.
 */
function cleanVoice(raw: unknown): NicheVoice {
  const v = (raw ?? {}) as Record<string, unknown>;
  const word = (k: string, fallback: string) => str(v[k], 40, fallback);
  const customers = word("customers", "customers");
  const capacity = word("capacity", "capacity");
  return {
    customer: word("customer", "customer"),
    customers,
    unit: word("unit", "sale"),
    per: word("per", "per customer"),
    capacity,
    /* A label on a count of customers served in a year — see the note on the field. */
    capacityShort: word("capacityShort", `${customers} you can serve`),
    place: word("place", "region"),
    places: word("places", "regions"),
    quality: word("quality", "quality"),
    brand: word("brand", "brand"),
    service: word("service", "service"),
    turnedAway: word("turnedAway", `${customers} you turn away`),
    market: word("market", "the market"),
    rivals: word("rivals", "rivals"),
  };
}

/**
 * What this market calls each of the nine things a company can buy.
 *
 * Matched to `ASSET_SLOTS` by position and kind, exactly as a catalogue is,
 * and anything that does not line up is dropped rather than bent into place:
 * a patent's economics attached to something called a warehouse is worse than
 * the generic name it would have replaced. Undefined when the model said
 * nothing usable, which puts the market back on the generic slots.
 */
function cleanAssets(raw: unknown): { kind: string; name: string; blurb: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  /*
   * Kept if the kind is one of the nine, wherever it appears in the answer.
   *
   * Not checked against the slot at the same index: a model that returns the
   * kinds in a different order, or omits one, is answering imperfectly rather
   * than uselessly, and `templatesFor` places these by kind anyway. Validating
   * positionally here threw away good entries for the sin of being in the
   * wrong row.
   */
  const kinds = new Set<string>(ASSET_SLOTS.map((s) => s.kind));
  const out: { kind: string; name: string; blurb: string }[] = [];
  for (const entry of raw.slice(0, ASSET_SLOTS.length * 2)) {
    const e = (entry ?? {}) as Record<string, unknown>;
    const kind = str(e.kind, 40, "");
    const name = str(e.name, 60, "");
    if (name && kinds.has(kind)) out.push({ kind, name, blurb: str(e.blurb, 200, "") });
  }
  return out.length ? out : undefined;
}

/**
 * What it costs to serve one customer, capped so somebody can be served.
 *
 * The model is asked for a unit cost and given no relationship to hold it
 * against, so it answers with a plausible-sounding number and nothing checks
 * it against the prices it also invented. One market came back with a unit
 * cost of 18 and segments paying 12, 7, 29 and 119 — two of the four could
 * never be sold to at any volume, at any price the segment would accept, in
 * any year of the season. The desk said so, plainly and repeatedly: "every
 * unit sold at 17 costs 18 to make". It was right, and there was nothing the
 * player could do about it.
 *
 * Capped at 70% of the cheapest segment's reference price, so the thinnest
 * customer in the market is still worth having at a price they would pay. Not
 * a floor on margin — a market can be brutal, and a cheap segment that is
 * barely worth serving is a real thing to discover. What it rules out is the
 * market that is arithmetically unplayable before anybody sits down.
 *
 * Deliberately not scaled to the dearest segment: a market with one premium
 * tier and three cheap ones would let a unit cost through that only the
 * premium tier could ever cover, which is the same bug wearing a hat.
 */
const MAX_UNIT_COST_OF_CHEAPEST_PRICE = 0.7;

function affordableUnitCost(asked: number, segments: Segment[]): number {
  const cheapest = Math.min(...segments.map((s) => s.referencePrice));
  if (!Number.isFinite(cheapest) || cheapest <= 0) return Math.round(asked);
  return Math.max(1, Math.round(Math.min(asked, cheapest * MAX_UNIT_COST_OF_CHEAPEST_PRICE)));
}

/**
 * A market from whatever the model said, or null if there is not one in there.
 *
 * Null is a real answer and the caller must have somewhere to go with it: the
 * seven markets still exist, and falling back to the closest one is a better
 * outcome than a season that cannot be played.
 */

/**
 * How much of a market has to be unspoken for before a business is possible in it.
 *
 * The seven hand-written markets all leave about a tenth, and a tenth is
 * plenty when the market has millions of people in it. Nova is asked to write
 * small — a booking site for spare kiln firings, a rota swap for bank staff —
 * and a tenth of a small market, split again by region, is not a business.
 *
 * Measured, before this existed: kilnshare, 9,000 people and £235,000 a year
 * across five regions, left its founder a home region with **270 unowned
 * customers** and a break-even of 181. A founder there was never once
 * profitable — not in sixteen quarters, not on any season seed, and not at any
 * rate of spending from nothing to a quarter of the bank each period. The most
 * anybody reached was 104 customers of 9,000. It was not a hard market, it was
 * an impossible one, and nothing in the cleaner noticed, because every rule
 * here checks a market's *shape* and none of them checked whether a company
 * could live in it.
 *
 * So the open share is set from what the market costs to operate in: enough
 * unowned customers in the home region to clear break-even `ROOM_FOR_A_BUSINESS`
 * times over. Markets that are already big enough keep the usual tenth — the
 * three markets Nova wrote for real projects, run through this, leave rotaread
 * exactly where it was and raise only the two that could not be played.
 *
 * Capped, because a market with no incumbents worth the name is not the game
 * either. What the cap cannot reach is still improved by it.
 */
export const ROOM_FOR_A_BUSINESS = 70;

/**
 * The thinner bar the *prices* are lifted to, when opening the market up was
 * not enough on its own.
 *
 * The two levers do not cost the same. How much of a market is unowned is a
 * number nobody wrote down and nobody will miss — Nova is not asked for it,
 * and a young market being mostly unserved is true. A price is something Nova
 * *said*, and moving it rewrites the market's own description of itself. So
 * the open share is taken as far as it will go first, and the prices only make
 * up whatever that could not reach.
 *
 * Measured, the difference is not small: holding both to the same bar lifted a
 * sea-swimming app's prices 246-fold, from GBP 1 a year to GBP 246. Splitting
 * them gets the same eight markets to the same place with a 35-fold lift, and
 * it is the open share doing the work instead.
 *
 * Raised from 25 to 28 when `allocate` stopped losing the overflow. Closing
 * that leak took `SPILL_TOPUP_MAX` from 8 to 3, and the two smallest markets
 * lived on that top-up: parish-council minutes lost three of its eight
 * playable seeds. Twenty-eight is the least that gives them back, and it is
 * chosen against what it costs the fiction — at 40 the same swimming app goes
 * to GBP 121 a year, which is not a swimming app any more.
 */
export const PRICE_ROOM_FOR_A_BUSINESS = 28;
export const OPEN_SHARE_MAX = 0.35;

export function openShareFor(input: { segments: Segment[]; cities: City[]; baseUnitCost: number }): number {
  const { segments, cities, baseUnitCost } = input;
  const people = segments.reduce((sum, s) => sum + s.size, 0);
  const biggest = [...segments].sort((a, b) => b.size - a.size)[0];
  if (!biggest || people <= 0 || !cities.length) return TRULY_OPEN_SHARE;
  /* The price the opening defaults sell at, which is the biggest segment's. */
  const contribution = Math.max(1, biggest.referencePrice - baseUnitCost);
  const payroll = officerCost({ officers: 1, scale: marketScale({ segments }) });
  const breakEven = payroll / contribution;
  /* The home region is the biggest one a founder can open in. */
  const home = Math.max(...cities.map((c) => c.weight));
  const needed = (breakEven * ROOM_FOR_A_BUSINESS) / Math.max(1, people * home);
  return Math.min(OPEN_SHARE_MAX, Math.max(TRULY_OPEN_SHARE, needed));
}

/**
 * Prices that can pay for the business being run in the market.
 *
 * `openShareFor` opens a small market up until there is room for a company,
 * and it runs out of room at `OPEN_SHARE_MAX` — a market still has to have
 * incumbents in it. What it cannot fix is a market whose customers do not pay
 * enough to be worth having.
 *
 * Nova wrote one: a tide-and-water-quality app for sea swimmers, 50,000 people
 * and £130,000 a year, whose biggest segment pays **£1 a year against a £1
 * unit cost**. Contribution per customer was nothing, so no number of
 * customers covered the founder's own salary — not at any spend, including
 * spending nothing, on any season seed. `MAX_UNIT_COST_OF_CHEAPEST_PRICE` is
 * supposed to leave a margin and cannot here, because `num` floors a unit cost
 * at 1 and the price was 1.
 *
 * So the prices come up until the segment the opening defaults sell at earns
 * enough, across the customers a founder can actually reach, to clear
 * break-even `ROOM_FOR_A_BUSINESS` times over — the same bar `openShareFor`
 * uses, reached from the other side. Raising the prices raises what the market
 * is worth, which raises what its people cost, so it is solved by iterating
 * rather than in one step.
 *
 * Every price moves together, so what Nova said about the *shape* of the
 * market — who pays more than whom, and by how much — survives. Only the
 * absolute figures move, and only in the markets that could not otherwise be
 * played: none of the seven hand-written markets, and none of the generated
 * ones already earning enough.
 */
export const MAX_PRICE_LIFT = 250;

export function pricedForABusiness(input: { segments: Segment[]; cities: City[]; baseUnitCost: number; openShare: number }): Segment[] {
  const { cities, baseUnitCost, openShare } = input;
  let segments = input.segments;
  const people = segments.reduce((sum, s) => sum + s.size, 0);
  const home = cities.length ? Math.max(...cities.map((c) => c.weight)) : 0;
  const reach = people * home * openShare;
  if (reach <= 0) return segments;

  /*
   * Twelve passes, not four. Raising the prices raises what the market is
   * worth, which raises what its people cost, so each pass only closes part of
   * the gap — and four of them stopped about 5% short of the bar rather than
   * at it. Converging properly is what lets the bar mean what it says.
   */
  let lifted = 1;
  for (let pass = 0; pass < 12; pass++) {
    const biggest = [...segments].sort((a, b) => b.size - a.size)[0];
    if (!biggest || biggest.referencePrice <= 0) break;
    const payroll = officerCost({ officers: 1, scale: marketScale({ segments }) });
    const needed = (payroll * PRICE_ROOM_FOR_A_BUSINESS) / reach;
    const earns = biggest.referencePrice - baseUnitCost;
    if (earns >= needed) break;
    const lift = Math.min((needed + baseUnitCost) / biggest.referencePrice, MAX_PRICE_LIFT / lifted);
    if (!(lift > 1.001)) break;
    lifted *= lift;
    segments = segments.map((s) => ({ ...s, referencePrice: Math.max(1, Math.round(s.referencePrice * lift)) }));
  }
  return segments;
}

/**
 * Whether this is a market being written for the first time, or one being read
 * back.
 *
 * `openShareFor` and `pricedForABusiness` do not clamp a market, they *change*
 * it — they open it up and they raise its prices until a business is possible
 * in it. Every other rule here is a bound, and running a bound twice is
 * harmless; running these twice is not the danger either, because both stop
 * once their bar is met. The danger is running them at all on a season that is
 * already being played.
 *
 * A season stores its market and `marketOf` rebuilds it through this function
 * on **every read**, deliberately, because the row may have been written by an
 * older version. That was safe while this only clamped. Measured against
 * markets stored before these rules existed, a read would have moved them:
 *
 *     kiln firings     prices x6.3   open share 0.10 -> 0.35
 *     sea swimming     prices x35.0
 *     parish minutes   prices x4.9
 *     shift swapping   prices x1.0   open share 0.10 -> 0.21
 *
 * A company that had priced at 20 against a reference of 15 would come back to
 * find itself priced at 20 against 95 — cheap beyond anything it chose, with
 * every expectation and ceiling in its market moved, in the middle of a season
 * it was halfway through. Nobody gets to change the game under the people
 * playing it.
 *
 * So the two transformations happen when a market is written and never again.
 * A read gets all the validation and none of the rewriting, which means a
 * season keeps the market it started with and a new one gets the rules.
 */
export interface BuildOptions {
  /** True when Nova has just written this market and it has never been played. */
  fresh?: boolean;
}

export function buildCustomMarket(raw: unknown, fallbackId: string, options: BuildOptions = {}): Niche | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;

  const segments = cleanSegments(m.segments);
  if (!segments) return null;
  /*
   * What the whole market turns over in a year, at the prices its own segments
   * expect. Regions are priced against it — see `ENTRY_COST_MAX_SHARE`.
   */
  const marketValue = segments.reduce((sum, seg) => sum + seg.size * seg.referencePrice, 0);
  const cities = cleanRegions(m.regions ?? m.cities, segments.map((s) => s.id), marketValue);
  if (!cities) return null;
  const incumbents = cleanIncumbents(m.incumbents);
  if (!incumbents) return null;

  const baseUnitCost = affordableUnitCost(num(m.baseUnitCost, 1, 50_000, 20), segments);
  /*
   * Written once, then kept. A market being read back carries whatever it was
   * given when it was written — see `BuildOptions`.
   */
  const written = typeof (m.openShare) === "number" && (m.openShare as number) > 0 ? (m.openShare as number) : null;
  const openShare = options.fresh ? openShareFor({ segments, cities, baseUnitCost }) : (written ?? TRULY_OPEN_SHARE);
  const priced = options.fresh ? pricedForABusiness({ segments, cities, baseUnitCost, openShare }) : segments;
  return {
    id: slug(m.id ?? m.name, fallbackId),
    name: str(m.name, 80, "Your market"),
    premise: str(m.premise, 600, "The market this company is actually in."),
    segments: priced,
    incumbents,
    cities,
    baseUnitCost,
    /* Enough of it unowned that a company can live here at all. See `openShareFor`. */
    openShare,
    innovationPace: num(m.innovationPace, 0.4, 2.2, 1),
    voice: cleanVoice(m.voice),
    workforce: staffable(cleanWorkforce(m.workforce), priced),
    assets: cleanAssets(m.assets),
  };
}

/**
 * Whether a written market is playable, and what is wrong if not.
 *
 * `buildCustomMarket` already guarantees these — this is the assertion that it
 * does, for tests and for anything that reads a market back out of the
 * database, where a row could have been written by an older version.
 */
export function marketProblems(niche: Niche): string[] {
  const bad: string[] = [];
  if (niche.segments.length < MIN_SEGMENTS) bad.push("too few segments");
  if (niche.cities.length < MIN_REGIONS) bad.push("too few regions");
  if (niche.incumbents.length < MIN_INCUMBENTS) bad.push("too few incumbents");

  const weight = niche.cities.reduce((s, c) => s + c.weight, 0);
  if (Math.abs(weight - 1) > 0.01) bad.push(`region weights sum to ${weight.toFixed(3)}, not 1`);

  const share = niche.incumbents.reduce((s, i) => s + i.startingShare, 0);
  if (share >= 1) bad.push(`incumbents hold ${(share * 100).toFixed(0)}% of the market`);

  if (niche.segments.some((s) => s.referencePrice < 1)) bad.push("a segment prices at nothing");
  if (niche.segments.some((s) => s.size < MIN_SEGMENT_SIZE)) bad.push("a segment has nobody in it");
  if (new Set(niche.segments.map((s) => s.id)).size !== niche.segments.length) bad.push("two segments share an id");
  if (new Set(niche.cities.map((c) => c.id)).size !== niche.cities.length) bad.push("two regions share an id");
  return bad;
}
