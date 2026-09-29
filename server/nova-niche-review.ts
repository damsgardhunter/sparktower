/**
 * Nova's read on whether two niches are the same idea.
 *
 * The engine already merges the ones that are the same *people*: same
 * segment, wanting the same things, at about the same price. That is
 * measurable, so it is decided by arithmetic and needs nobody's judgement
 * (see `mergeSimilar`).
 *
 * What arithmetic cannot see is two niches that are numerically a little
 * apart and obviously the same idea to anybody reading them — "Weekend
 * players" and "Casual Saturday users" describing the same people in
 * different words. A table that meets the other one and is told they are
 * separate markets will not believe it, and they will be right.
 *
 * So the borderline cases are read. Only the borderline ones: pairs the
 * engine already merged need no opinion, and pairs that are far apart on
 * every axis are not close calls whatever they are called. That keeps this to
 * a handful of short questions a season rather than one every year, which
 * matters because it is a model call and those are the thing this codebase
 * has spent a week learning to be careful with.
 *
 * Never required. A season with no model reachable merges on the arithmetic
 * alone and plays perfectly well; this makes it better, not possible.
 */
import { parseModelJson } from "./ai-json";
import { similarity, SAME_NICHE_AT, type OpenedNiche } from "@shared/simulation/niche-openings";

/** Below this, two niches are not a close call and nobody needs to read them. */
export const REVIEW_FROM = 0.62;

export interface NichePair {
  a: OpenedNiche;
  b: OpenedNiche;
  /** What the arithmetic made of them, for the prompt and for the log. */
  closeness: number;
}

/**
 * The pairs worth asking about: alike enough to be arguable, not alike enough
 * to have been merged already.
 */
export function pairsToReview(opened: OpenedNiche[]): NichePair[] {
  const pairs: NichePair[] = [];
  for (let i = 0; i < opened.length; i++) {
    for (let j = i + 1; j < opened.length; j++) {
      const a = opened[i], b = opened[j];
      if (a.parentId !== b.parentId) continue;
      if (a.openedBy === b.openedBy) continue;
      const closeness = similarity(a, b);
      if (closeness >= SAME_NICHE_AT) continue;   // the engine has already said so
      if (closeness < REVIEW_FROM) continue;      // not a close call
      pairs.push({ a, b, closeness });
    }
  }
  return pairs;
}

export function buildNicheReviewPrompt(pairs: NichePair[]): { system: string; user: string } {
  return {
    system: [
      "Two teams in the same market each went looking for a niche and named what they found.",
      "Say whether they are describing the same people.",
      "",
      "The question is not whether the names are similar. It is whether a customer could be in",
      "both, and whether a person who knew this market would call them one group or two. Two teams",
      "who have found the same people in different words should be told so; two teams who have",
      "genuinely found different corners should be left alone.",
      "",
      "Lean towards leaving them alone. Being wrongly told your idea is somebody else's is worse",
      "than being wrongly left with your own, because the first takes something away.",
      "",
      'Answer as JSON only: {"verdicts":[{"pair":0,"same":true,"name":"what to call the shared one","why":"one line"}]}',
    ].join("\n"),
    user: pairs.map((p, i) => [
      `PAIR ${i}`,
      `A: "${p.a.name}" — found by looking inside the same segment, leaning ${lean(p.a)}.`,
      `B: "${p.b.name}" — same segment, leaning ${lean(p.b)}.`,
    ].join("\n")).join("\n\n"),
  };
}

/** What a niche's people care about, in words rather than numbers. */
function lean(n: OpenedNiche): string {
  const said: string[] = [];
  const say = (v: number | undefined, high: string, low: string) => {
    if (v === undefined) return;
    if (v >= 0.6) said.push(high);
    else if (v <= 0.3) said.push(low);
  };
  say(n.shift.qualityFocus, "hard on quality", "not fussy about quality");
  say(n.shift.brandFocus, "brand-led", "indifferent to brand");
  say(n.shift.serviceFocus, "demanding on service", "low-touch");
  say(n.shift.priceSensitivity, "price-led", "not price-led");
  return said.join(", ") || "unremarkable on every axis";
}

export interface NicheVerdict { pair: number; same: boolean; name?: string; why?: string }

/**
 * What came back, made safe. Anything unreadable is "leave them alone",
 * because the failure that matters is taking somebody's niche away on the
 * strength of a malformed answer.
 */
export function parseNicheVerdicts(raw: string, pairs: NichePair[]): NicheVerdict[] {
  let parsed: any;
  try {
    parsed = parseModelJson(raw, "niche review");
  } catch {
    return [];
  }
  const list = Array.isArray(parsed?.verdicts) ? parsed.verdicts : [];
  return list
    .map((v: any): NicheVerdict => ({
      pair: Math.round(Number(v?.pair)),
      same: v?.same === true,
      name: typeof v?.name === "string" ? v.name.trim().slice(0, 80) : undefined,
      why: typeof v?.why === "string" ? v.why.trim().slice(0, 200) : undefined,
    }))
    .filter((v: NicheVerdict) => Number.isInteger(v.pair) && v.pair >= 0 && v.pair < pairs.length && v.same);
}

/**
 * The niches, with the pairs a reader judged to be one idea folded together.
 *
 * The same shape `mergeSimilar` produces, so the engine cannot tell whether a
 * merge came from arithmetic or from judgement — which is the point. The
 * earliest opener keeps the naming unless a better one was suggested.
 */
export function applyVerdicts(opened: OpenedNiche[], pairs: NichePair[], verdicts: NicheVerdict[]): OpenedNiche[] {
  if (!verdicts.length) return opened;
  const out = opened.map((n) => ({ ...n }));
  const find = (id: string) => out.find((n) => n.id === id);

  for (const verdict of verdicts) {
    const pair = pairs[verdict.pair];
    const first = find(pair.a.openedInYear <= pair.b.openedInYear ? pair.a.id : pair.b.id);
    const second = find(pair.a.openedInYear <= pair.b.openedInYear ? pair.b.id : pair.a.id);
    if (!first || !second || first === second) continue;
    // Already folded in by an earlier verdict in the same pass.
    if ((first.alsoFoundBy ?? []).some((a) => a.companyId === second.openedBy)) continue;

    first.alsoFoundBy = [...(first.alsoFoundBy ?? []), { companyId: second.openedBy, year: second.openedInYear }];
    if (verdict.name) first.name = verdict.name;
    const i = out.indexOf(second);
    if (i >= 0) out.splice(i, 1);
  }
  return out;
}
