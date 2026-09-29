/**
 * Niches a company makes, rather than ones the market came with.
 *
 * A market is written with three or four segments, and that is a useful lie.
 * Real markets have dozens, and most of them did not exist until somebody
 * went looking for them: a company notices that a slice of a segment wants
 * something slightly different, names it, builds for it, and for a while owns
 * it outright because nobody else is even describing those people that way.
 *
 * That is the move this file makes possible, and it is the one thing the
 * simulation could not express. A team could serve the segments it was given
 * better or worse than the incumbents. It could not go and find people.
 *
 * ## What opening a niche actually is
 *
 * Finding the people who want what you are good at. A niche is carved out of
 * a segment that already exists — the buyers do not appear from nowhere — and
 * the people in it weigh things slightly differently from the rest of that
 * segment, shifted toward whatever the company that found them does well.
 *
 * So the advantage is real and it is earned rather than granted: you are not
 * given a bonus, you are given the customers who happen to want what you
 * already built. It also means a company that opens a niche it is not
 * actually good at gets very little, which is correct.
 *
 * ## Why they live on the world
 *
 * A market is rebuilt from code at the start of every year, on purpose, so
 * that balance edits reach seasons already running (see `simulation-scope`).
 * Anything a season *invented* would be wiped by that. So opened niches are
 * stored on the world and composed back onto the market each year, in the one
 * place the engine reads it.
 */
import type { Company, Niche, Segment } from "./types";

/** A niche somebody went and found. */
export interface OpenedNiche {
  /** The id of the segment this becomes. */
  id: string;
  name: string;
  /** The segment its people were always part of. */
  parentId: string;
  /**
   * Who found them.
   *
   * Usually one company. More than one when two tables went looking in the
   * same segment and came back with people who are, in every way the engine
   * can see, the same people — see `mergeSimilar`.
   */
  openedBy: string;
  /** Anybody else who found the same people, and when. */
  alsoFoundBy?: { companyId: string; year: number }[];
  openedInYear: number;
  /**
   * The share of the parent segment that turns out to be these people.
   *
   * Small on purpose. A niche is a slice, and a company that could carve off
   * half a segment by naming it would be redrawing the market rather than
   * finding a corner of it.
   */
  share: number;
  /** How these people differ from the rest of the segment they came from. */
  shift: Partial<Record<"priceSensitivity" | "qualityFocus" | "brandFocus" | "serviceFocus" | "loyalty", number>>;
  /** What they will pay, against the parent segment's reference. */
  priceIndex: number;
}

/** The most of a segment one niche can be. */
export const NICHE_MAX_SHARE = 0.22;
/** And the least, below which it is not a market, it is a rounding error. */
export const NICHE_MIN_SHARE = 0.05;
/** How many niches one market can hold before it stops being a market and starts being a list. */
export const NICHE_LIMIT = 12;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const unit = (n: number | undefined) => Math.max(0, Math.min(1, (Number(n) || 0) / 100));

/**
 * What a company would find, if it went looking inside this segment.
 *
 * The people in it weigh what this company is good at more heavily than the
 * rest of the segment does, and weigh its weaknesses less. That is the whole
 * mechanic: opening a niche is not inventing demand, it is noticing that some
 * of the demand already suits you.
 *
 * The size of the shift is bounded, so this is an advantage rather than a
 * private market — and it is proportional to how distinctive the company
 * actually is. A company that is middling at everything finds a niche that is
 * barely different from the segment it came from, which is the honest
 * outcome.
 */
export function nicheFor(input: {
  company: Company;
  parent: Segment;
  year: number;
  name?: string;
}): OpenedNiche {
  const { company, parent, year } = input;

  /*
   * Where this company is unusual. Measured against the middle rather than
   * against rivals: a company with quality 80 and brand 10 is a quality
   * company, and the people who care about quality and not about brand are
   * the ones it should go and find.
   */
  const edge = {
    qualityFocus: unit(company.quality) - 0.5,
    brandFocus: unit(company.brand) - 0.5,
    serviceFocus: unit(company.service) - 0.5,
  };
  const spread = Math.max(...Object.values(edge).map(Math.abs));
  // How far the niche's people lean, in total. Bounded, and earned.
  const lean = Math.min(0.28, 0.1 + spread * 0.4);

  const shift: OpenedNiche["shift"] = {
    qualityFocus: clamp01(parent.qualityFocus + Math.sign(edge.qualityFocus) * lean),
    brandFocus: clamp01(parent.brandFocus + Math.sign(edge.brandFocus) * lean),
    serviceFocus: clamp01(parent.serviceFocus + Math.sign(edge.serviceFocus) * lean),
    /*
     * People who have been sought out are less price-led and stickier than
     * the segment they came from. That is what having been found does: they
     * chose something specific, so the next offer has to be specific too.
     */
    priceSensitivity: clamp01(parent.priceSensitivity - 0.12),
    loyalty: clamp01(parent.loyalty + 0.1),
  };

  return {
    id: `${parent.id}__${slug(input.name ?? company.name)}`.slice(0, 60),
    name: input.name?.trim() || `${company.name}'s ${parent.name.toLowerCase()}`,
    parentId: parent.id,
    openedBy: company.id,
    openedInYear: year,
    share: NICHE_MIN_SHARE + Math.min(NICHE_MAX_SHARE - NICHE_MIN_SHARE, spread * 0.3),
    shift,
    // Sought-out people pay a little more, because the alternative does not fit them.
    priceIndex: 1.08,
  };
}

/**
 * The market with the niches this season has opened in it.
 *
 * Called in the one place the engine reads its market, so every one of the
 * forty-odd things that walk the segment list — demand, appeal, allocation,
 * the desk, the bots — see the opened niches without knowing they exist.
 *
 * The arithmetic that matters: a niche's people are *taken from* the segment
 * they came from, never added to the market. Opening a niche does not create
 * buyers, and a company that opens one has not grown the market, it has
 * described part of it more precisely than anybody else.
 */
export function withOpenedNiches(niche: Niche, opened: OpenedNiche[] | undefined): Niche {
  if (!opened?.length) return niche;

  const byParent = new Map<string, OpenedNiche[]>();
  for (const o of opened.slice(0, NICHE_LIMIT)) {
    if (!niche.segments.some((s) => s.id === o.parentId)) continue;
    byParent.set(o.parentId, [...(byParent.get(o.parentId) ?? []), o]);
  }
  if (!byParent.size) return niche;

  const segments: Segment[] = [];
  for (const parent of niche.segments) {
    const mine = byParent.get(parent.id) ?? [];
    if (!mine.length) { segments.push(parent); continue; }

    /*
     * Never all of it. However many niches are found inside one segment,
     * most of that segment remains people who were not looking for anything
     * in particular — which is true of every real market.
     */
    const totalShare = Math.min(0.6, mine.reduce((sum, o) => sum + o.share, 0));
    const scale = totalShare / mine.reduce((sum, o) => sum + o.share, 0);

    segments.push({ ...parent, size: Math.round(parent.size * (1 - totalShare)) });
    for (const o of mine) {
      const share = o.share * scale;
      segments.push({
        ...parent,
        ...o.shift,
        id: o.id,
        name: o.name,
        description: `${parent.description} These were found rather than waited for.`,
        size: Math.max(1, Math.round(parent.size * share)),
        referencePrice: Math.max(1, Math.round(parent.referencePrice * o.priceIndex)),
        foundBy: [o.openedBy, ...(o.alsoFoundBy ?? []).map((a) => a.companyId)],
        foundInYear: o.openedInYear,
      });
    }
  }
  return { ...niche, segments };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "niche";


/**
 * How alike two niches are, to the engine.
 *
 * Two tables competing in the same season will think of similar things,
 * because they are looking at the same market and the good ideas in it are
 * not infinite. If both are handed a private corner, each gets a run at
 * people the other is also selling to — which is not a niche, it is the same
 * niche twice, and the head start each has against the other is nonsense.
 *
 * Alike means the same people. Not the same name — a name is what a team
 * calls something and two teams will call the same thing different things —
 * but the same segment, wanting the same things, at about the same price.
 * That is measurable, so the engine decides it rather than asking anybody.
 *
 * Returns 0 to 1, where 1 is indistinguishable.
 */
export function similarity(a: OpenedNiche, b: OpenedNiche): number {
  if (a.parentId !== b.parentId) return 0;
  const axes = ["priceSensitivity", "qualityFocus", "brandFocus", "serviceFocus", "loyalty"] as const;
  /*
   * Mean absolute difference across the five things a segment weighs. Each is
   * 0 to 1, so the distance is too, and a difference of a tenth on every axis
   * is a tenth apart overall.
   */
  const distance = axes.reduce((sum, axis) => sum + Math.abs((a.shift[axis] ?? 0) - (b.shift[axis] ?? 0)), 0) / axes.length;
  const priceGap = Math.abs(a.priceIndex - b.priceIndex);
  return Math.max(0, 1 - distance * 2.2 - priceGap * 1.5);
}

/** Above this, two niches are the same niche and the engine says so. */
export const SAME_NICHE_AT = 0.88;

/**
 * The season's niches, with the ones that turned out to be the same thing
 * folded together.
 *
 * Run after a year, so a table that opens a niche gets a year of it being
 * theirs before anybody discovers somebody else had the same idea — which is
 * both kinder and truer than deciding it the moment they file.
 *
 * The earliest opener keeps the naming, because they were first; everybody
 * else is recorded as having found the same people. The merged niche is a
 * little larger than either alone, since two companies looking found more of
 * them than one would have, but never larger than the two apart.
 */
export function mergeSimilar(opened: OpenedNiche[], at = SAME_NICHE_AT): OpenedNiche[] {
  const out: OpenedNiche[] = [];
  for (const niche of [...opened].sort((a, b) => a.openedInYear - b.openedInYear)) {
    const twin = out.find((kept) => similarity(kept, niche) >= at);
    if (!twin) { out.push(niche); continue; }

    /*
     * The same company arriving at the same people twice is not two niches,
     * it is one — so it folds in and is not recorded as somebody else. Only a
     * different company becomes a second finder, and only once.
     */
    const owners = [twin.openedBy, ...(twin.alsoFoundBy ?? []).map((a) => a.companyId)];
    if (owners.includes(niche.openedBy)) continue;

    twin.alsoFoundBy = [...(twin.alsoFoundBy ?? []), { companyId: niche.openedBy, year: niche.openedInYear }];
    // Two companies looking found more of these people than one would have.
    twin.share = Math.min(NICHE_MAX_SHARE, twin.share + niche.share * 0.35);
  }
  return out;
}
