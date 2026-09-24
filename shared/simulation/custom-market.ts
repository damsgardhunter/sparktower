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
export const MIN_SEGMENTS = 2, MAX_SEGMENTS = 5;
export const MIN_REGIONS = 3, MAX_REGIONS = 10;
export const MIN_INCUMBENTS = 2, MAX_INCUMBENTS = 5;
/** Incumbents hold most of the market at year zero, never all of it. */
export const INCUMBENT_SHARE_TOTAL = 0.88;

const POSTURES: IncumbentPosture[] = ["fortress", "brawler", "coaster", "innovator"];

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
    referencePrice: Math.max(1, Math.round(num(s?.referencePrice, 1, 100_000, 40))),
  }));
}

function cleanRegions(raw: unknown, segmentIds: string[]): City[] | null {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_REGIONS) : [];
  if (list.length < MIN_REGIONS) return null;
  const ids = unique(list.map((c: any, i) => slug(c?.id ?? c?.name, `region_${i + 1}`)));
  const weights = normalise(list.map((c: any) => num(c?.weight, 0.01, 1, 0.1)), 1);
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
      entryCost: Math.round(num(c?.entryCost, 10_000, 5_000_000, 250_000)),
      note: str(c?.note, 200, "A place this market exists."),
      ...(Object.keys(mix).length ? { segmentMix: mix } : {}),
    } as City;
  });
}

function cleanIncumbents(raw: unknown): IncumbentSeed[] | null {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_INCUMBENTS) : [];
  if (list.length < MIN_INCUMBENTS) return null;
  const ids = unique(list.map((x: any, i) => slug(x?.id ?? x?.name, `rival_${i + 1}`)));
  const shares = normalise(list.map((x: any) => num(x?.startingShare, 0.02, 0.8, 0.2)), INCUMBENT_SHARE_TOTAL);
  return list.map((x: any, i): IncumbentSeed => ({
    id: ids[i],
    name: str(x?.name, 60, `Rival ${i + 1}`),
    posture: POSTURES.includes(x?.posture) ? x.posture : POSTURES[i % POSTURES.length],
    startingShare: shares[i],
    quality: num(x?.quality, 10, 95, 55),
    brand: num(x?.brand, 5, 95, 50),
    service: num(x?.service, 10, 95, 55),
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
    };
  });
  // Two kinds at least, or it is not a mix and the generic one is better.
  return kinds.length >= 2 ? kinds : undefined;
}

function cleanVoice(raw: unknown): NicheVoice {
  const v = (raw ?? {}) as Record<string, unknown>;
  const word = (k: string, fallback: string) => str(v[k], 40, fallback);
  return {
    customer: word("customer", "customer"),
    customers: word("customers", "customers"),
    unit: word("unit", "sale"),
    per: word("per", "per customer"),
    capacity: word("capacity", "capacity"),
    place: word("place", "region"),
    places: word("places", "regions"),
    quality: word("quality", "quality"),
    brand: word("brand", "brand"),
  } as NicheVoice;
}

/**
 * A market from whatever the model said, or null if there is not one in there.
 *
 * Null is a real answer and the caller must have somewhere to go with it: the
 * seven markets still exist, and falling back to the closest one is a better
 * outcome than a season that cannot be played.
 */
export function buildCustomMarket(raw: unknown, fallbackId: string): Niche | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;

  const segments = cleanSegments(m.segments);
  if (!segments) return null;
  const cities = cleanRegions(m.regions ?? m.cities, segments.map((s) => s.id));
  if (!cities) return null;
  const incumbents = cleanIncumbents(m.incumbents);
  if (!incumbents) return null;

  return {
    id: slug(m.id ?? m.name, fallbackId),
    name: str(m.name, 80, "Your market"),
    premise: str(m.premise, 600, "The market this company is actually in."),
    segments,
    incumbents,
    cities,
    baseUnitCost: Math.round(num(m.baseUnitCost, 1, 50_000, 20)),
    innovationPace: num(m.innovationPace, 0.4, 2.2, 1),
    voice: cleanVoice(m.voice),
    workforce: cleanWorkforce(m.workforce),
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
