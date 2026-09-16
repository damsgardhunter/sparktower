/**
 * The last thing between a model's claim and a builder's afternoon.
 *
 * Every audit failure worth fixing this week has been the same failure: the
 * audit turned a gap in *its own evidence* into a statement about the code.
 *
 *  - "POST /api/artifacts/:id/publish is NOT REGISTERED in this repository" —
 *    registered at server/routes.ts:386, driven end to end by a test. The read
 *    had been shown a wildcard it couldn't resolve.
 *  - "not every stage has code behind it" on a loop whose every file exists —
 *    the read had described the mechanism instead of citing it.
 *  - "no test names this route" about routes with tests, back when the test
 *    list was clipped.
 *
 * Each was fixed where it happened. This is the general case: before a claim
 * reaches a person, if it says something does not exist, check whether it does.
 * The repository is right there. A model's absence claim is a hypothesis; the
 * file tree and the route scan are facts.
 *
 * Deliberately narrow, because a false correction is as bad as a false claim:
 * it only fires when one sentence both (a) asserts absence in so many words and
 * (b) names a route or file that is demonstrably present. Everything else —
 * judgement, severity, priorities, "this is thin", "this needs a test" — passes
 * through untouched. This does not make the audit nicer. It makes it stop
 * saying things that aren't true.
 */
import type { RouteCoverageRow } from "./route-coverage";

export interface ClaimIndex {
  /** Route shapes ("post /api/projects/:p/backings") → where they're registered. */
  routes: Map<string, { label: string; file: string; mounted: boolean }>;
  /** Every path in the tree, for file claims. */
  files: Set<string>;
}

/** `/api/users/:id/follow` and `/api/users/:userId/follow` are the same endpoint. */
const shape = (path: string) => path.replace(/:[\w-]+/g, ":p").replace(/\/+$/, "").toLowerCase();

export function buildClaimIndex(files: { path: string }[], routes: RouteCoverageRow[]): ClaimIndex {
  const index: ClaimIndex = { routes: new Map(), files: new Set(files.map((f) => f.path)) };
  for (const r of routes) {
    const key = `${r.method.toLowerCase()} ${shape(r.path)}`;
    if (!index.routes.has(key) || r.mounted) {
      index.routes.set(key, { label: `${r.method} ${r.path}`, file: r.file, mounted: r.mounted !== false });
    }
    // Also without the method, for prose that names a path and no verb.
    const bare = shape(r.path);
    if (!index.routes.has(bare) || r.mounted) {
      index.routes.set(bare, { label: `${r.method} ${r.path}`, file: r.file, mounted: r.mounted !== false });
    }
  }
  return index;
}

/**
 * Sentences that assert something isn't there, split by what kind of thing the
 * phrase can even be about.
 *
 * A file is never "registered" and a route is never "in the repository" as a
 * file is, and keeping these apart is what stops the checker correcting a
 * sentence it misread. "The client calls POST /api/artifacts/:id/publish in
 * continue-path-card.tsx, but /api/artifacts/ is NOT REGISTERED" is a claim
 * about a route; the file is only the scene of the crime, and annotating it
 * would be noise on top of a real finding.
 */
const ROUTE_ABSENCE = /\b(?:not registered|never registered|not mounted|never mounted|not wired|registers no|no such route|no such endpoint|unregistered|NOT REGISTERED)\b/gi;
/*
 * "X is missing" means X isn't there. "X is missing an auth check" means X is
 * right there and lacks something — a fair finding about a route that exists,
 * and one this checker must not contradict. The difference is whether anything
 * follows, so absence only counts when "missing" ends the clause or hands off
 * to "from"/"in".
 */
const THING_ABSENCE = /\b(?:does ?n[o']t exist|do ?n[o']t exist|did ?n[o']t exist|(?:is|are|were|was) missing(?=\s*(?:from\b|in\b|[.,;:)]|$))|missing from|not present|not found|NOT FOUND|nowhere in|absent from|no such file)\b/gi;

/** An /api path, or a repository file path, as prose writes them. */
const API_PATH = /(?:\b(GET|POST|PUT|PATCH|DELETE)\s+)?(\/api\/[\w:./{}*-]+)/gi;
const FILE_PATH = /(?:^|[\s`'"(\[])((?:[\w@.-]+\/)+[\w@.-]+\.(?:tsx?|jsx?|mjs|cjs|md|sql|ya?ml|json))(?=$|[\s`'")\],:;])/g;

/** How far from the phrase a name can sit and still be its subject. */
const BEFORE = 90;
const AFTER = 50;

export interface Contradiction {
  /** What the sentence said was missing. */
  claimed: string;
  /** What the repository says instead. */
  found: string;
  /** The sentence it came from, trimmed. */
  sentence: string;
}

/**
 * Where a sentence claiming absence names something that is present.
 *
 * Only the thing the phrase is *about* is checked: the nearest name before it,
 * or one immediately after ("no such route: /api/x"). A sentence that mentions
 * five paths and says one of them is unregistered produces one correction, not
 * five — and a sentence that says a file "does not itself refuse to boot" names
 * a file next to an absence word but claims nothing about its existence, so the
 * window keeps it out.
 *
 * Nothing here judges whether the *rest* of the sentence is right: a route can
 * exist and still be untested, unguarded or wrong. The only claim contradicted
 * is existence.
 */
export function contradictions(text: unknown, index: ClaimIndex): Contradiction[] {
  const value = typeof text === "string" ? text : "";
  if (!value) return [];
  const out: Contradiction[] = [];

  for (const sentence of value.split(/(?<=[.!?;])\s+|\n+/)) {
    const routeOnly = [...sentence.matchAll(ROUTE_ABSENCE)].map((m) => ({ at: m.index!, end: m.index! + m[0].length, routesOnly: true }));
    const anything = [...sentence.matchAll(THING_ABSENCE)].map((m) => ({ at: m.index!, end: m.index! + m[0].length, routesOnly: false }));
    const phrases = [...routeOnly, ...anything];
    if (!phrases.length) continue;

    /** Candidates with their position, so "the subject of this phrase" is answerable. */
    const candidates: { at: number; end: number; check: () => Contradiction | null }[] = [];

    for (const m of sentence.matchAll(API_PATH)) {
      const raw = m[2].replace(/[.,;:)\]]+$/, "");
      const method = (m[1] ?? "").toLowerCase();
      candidates.push({
        at: m.index!, end: m.index! + m[0].length,
        check: () => {
          // A wildcard or a prefix is a family: present if anything is registered under it.
          if (/[*]$/.test(raw) || raw.endsWith("/")) {
            const prefix = shape(raw.replace(/[*]$/, ""));
            const family = [...index.routes.entries()].filter(([k, v]) => k.startsWith(prefix) && v.mounted);
            return family.length
              ? { claimed: raw, found: `${family.length} routes are registered under it, e.g. ${family[0][1].label} in ${family[0][1].file}`, sentence: sentence.trim().slice(0, 300) }
              : null;
          }
          const hit = index.routes.get(`${method} ${shape(raw)}`) ?? index.routes.get(shape(raw));
          return hit?.mounted
            ? { claimed: `${m[1] ? `${m[1].toUpperCase()} ` : ""}${raw}`, found: `${hit.label} is registered in ${hit.file}`, sentence: sentence.trim().slice(0, 300) }
            : null;
        },
      });
    }

    for (const m of sentence.matchAll(FILE_PATH)) {
      const path = m[1];
      candidates.push({
        at: m.index!, end: m.index! + m[0].length,
        // Files are only checked for phrases that can be about a file at all.
        check: () => (index.files.has(path)
          ? { claimed: path, found: `${path} is in the repository`, sentence: sentence.trim().slice(0, 300) }
          : null),
      });
    }

    const isRoute = (c: typeof candidates[number]) => /\/api\//.test(sentence.slice(c.at, c.end));

    for (const phrase of phrases) {
      /*
       * "…but server/index.ts does not itself refuse to boot when they are
       * missing" — the thing said to be missing is "they", the environment
       * variables, and the nearest name before it is an innocent bystander.
       * A pronoun immediately before the phrase means the subject isn't the
       * name we found.
       */
      if (/\b(they|it|these|those|which|that|them|any|some|both|all)\s*$/i.test(sentence.slice(Math.max(0, phrase.at - 16), phrase.at))) continue;

      const eligible = candidates.filter((c) => (phrase.routesOnly ? isRoute(c) : true));
      // The nearest name before the phrase is its subject; failing that, one right after it.
      const before = eligible.filter((c) => c.end <= phrase.at && phrase.at - c.end <= BEFORE).sort((a, b) => b.end - a.end)[0];
      const after = eligible.filter((c) => c.at >= phrase.end && c.at - phrase.end <= AFTER).sort((a, b) => a.at - b.at)[0];
      const found = (before ?? after)?.check();
      if (found) out.push(found);
    }
  }
  return out;
}

/**
 * The claim, with the correction attached where a reader will see it.
 *
 * The claim is kept rather than deleted. The model may have meant something
 * true and said it badly — "not registered" for "not tested", say — and
 * deleting the sentence would hide a real finding. Appending the fact lets a
 * builder judge, and costs them one line instead of an afternoon.
 */
export function correct(text: unknown, index: ClaimIndex): { text: string; corrections: Contradiction[] } {
  const value = typeof text === "string" ? text : "";
  const found = contradictions(value, index);
  if (!found.length) return { text: value, corrections: [] };
  const seen = new Set<string>();
  const notes = found.filter((c) => !seen.has(c.claimed) && seen.add(c.claimed))
    .map((c) => `${c.claimed}: ${c.found}`);
  return {
    text: `${value} [CHECKED AGAINST THE REPOSITORY — ${notes.join("; ")}. Confirm before writing anything new.]`,
    corrections: found,
  };
}

/** Every place in an audit's findings where a claim can hide. */
const CLAIM_FIELDS = ["item", "matters", "missing", "exists", "finding", "detail", "why", "fix", "breaksAt", "note", "summary", "coverage", "mechanism"];

/**
 * Walks a whole findings object and corrects every absence claim in it.
 *
 * Structure-agnostic on purpose: the audit's shape has changed four times and
 * a verifier that knows the shape rots into a verifier that checks two of the
 * six places claims appear. Strings in known claim fields get checked; plain
 * strings in arrays (nextThreeThings) do too.
 */
export function verifyFindings(findings: unknown, index: ClaimIndex): { corrected: number; corrections: Contradiction[] } {
  const corrections: Contradiction[] = [];

  const walk = (node: any, key?: string): any => {
    if (typeof node === "string") {
      if (!key || CLAIM_FIELDS.includes(key) || key === "__item") {
        const { text, corrections: found } = correct(node, index);
        corrections.push(...found);
        return text;
      }
      return node;
    }
    if (Array.isArray(node)) return node.map((v) => walk(v, typeof v === "string" ? "__item" : key));
    if (node && typeof node === "object") {
      for (const k of Object.keys(node)) node[k] = walk(node[k], k);
      return node;
    }
    return node;
  };

  walk(findings);
  return { corrected: corrections.length, corrections };
}
