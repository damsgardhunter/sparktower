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
import { AREA_TERMS, areaLabel, type CapabilityArea, type CapabilityEntry } from "@shared/capabilities";

export interface ClaimIndex {
  /** Route shapes ("post /api/projects/:p/backings") → where they're registered. */
  routes: Map<string, { label: string; file: string; mounted: boolean }>;
  /** Every path in the tree, for file claims. */
  files: Set<string>;
  /**
   * Bare filenames to the one file that carries them.
   *
   * Prose names a file both ways — "server/webhookHandlers.ts" and "the
   * webhookHandlers.ts file" — and only the first was ever checked, so half of
   * "X does not exist" survived by being written the shorter way. Only unique
   * names are here: two files called `index.ts` make the sentence ambiguous,
   * and an ambiguous subject is one this must not correct.
   */
  basenames: Map<string, string>;
}

/** `/api/users/:id/follow` and `/api/users/:userId/follow` are the same endpoint. */
const shape = (path: string) => path.replace(/:[\w-]+/g, ":p").replace(/\/+$/, "").toLowerCase();

export function buildClaimIndex(files: { path: string }[], routes: RouteCoverageRow[]): ClaimIndex {
  const index: ClaimIndex = { routes: new Map(), files: new Set(files.map((f) => f.path)), basenames: new Map() };
  const seen = new Map<string, string | null>();
  for (const f of files) {
    const base = f.path.split("/").pop() ?? "";
    if (!base) continue;
    seen.set(base, seen.has(base) ? null : f.path);
  }
  for (const [base, path] of seen) if (path) index.basenames.set(base, path);
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
/*
 * The third family: phrases whose subject can only be what comes after them.
 *
 * "there is no server/email.ts" and "no trace of shared/surfaces.ts" are the
 * commonest way an audit says something isn't there, and neither was checked,
 * because both families above look backwards for their subject. Looking
 * backwards from these would be actively wrong — the name before "there is no"
 * is the place being searched, not the thing said to be missing.
 *
 * The window after them is tiny and the gap has to be empty (or a word like
 * "file"), so "there is no rate limit in server/routes.ts" resolves to nothing
 * rather than contradicting a sentence that never claimed the file was absent.
 */
const AFTER_ABSENCE = /\b(?:there (?:is|are|'s) no|no trace of|(?:found|find) no|could ?n[o']t find|can ?n[o']t find|cannot find|no sign of|nothing (?:named|called))\b/gi;
/** What may sit between one of those phrases and its subject, and nothing else. */
const AFTER_GAP = /^[\s:;,"'`(\[]*(?:such\s+)?(?:an?\s+|any\s+)?(?:file|route|endpoint|module|script)?[\s:;,"'`(\[]*$/i;

const THING_ABSENCE = /\b(?:does ?n[o']t exist|do ?n[o']t exist|did ?n[o']t exist|(?:is|are|were|was) missing(?=\s*(?:from\b|in\b|[.,;:)]|$))|missing from|not present|not found|NOT FOUND|nowhere in|absent from|no such file)\b/gi;

/** An /api path, or a repository file path, as prose writes them. */
const API_PATH = /(?:\b(GET|POST|PUT|PATCH|DELETE)\s+)?(\/api\/[\w:./{}*-]+)/gi;
const FILE_PATH = /(?:^|[\s`'"(\[])((?:[\w@.-]+\/)+[\w@.-]+\.(?:tsx?|jsx?|mjs|cjs|md|sql|ya?ml|json))(?=$|[\s`'")\],:;.])/g;
/** The same file named without its directory: "the webhookHandlers.ts file". */
const BARE_FILE = /(?:^|[\s`'"(\[])([\w@.-]+\.(?:tsx?|jsx?|mjs|cjs|sql|ya?ml))(?=$|[\s`'")\],:;.])/g;

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
    const routeOnly = [...sentence.matchAll(ROUTE_ABSENCE)].map((m) => ({ at: m.index!, end: m.index! + m[0].length, routesOnly: true, afterOnly: false }));
    const anything = [...sentence.matchAll(THING_ABSENCE)].map((m) => ({ at: m.index!, end: m.index! + m[0].length, routesOnly: false, afterOnly: false }));
    const forward = [...sentence.matchAll(AFTER_ABSENCE)].map((m) => ({ at: m.index!, end: m.index! + m[0].length, routesOnly: false, afterOnly: true }));
    const phrases = [...routeOnly, ...anything, ...forward];
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

    for (const m of sentence.matchAll(BARE_FILE)) {
      const named = index.basenames.get(m[1]);
      if (!named) continue;
      candidates.push({
        at: m.index!, end: m.index! + m[0].length,
        check: () => ({ claimed: m[1], found: `${named} is in the repository`, sentence: sentence.trim().slice(0, 300) }),
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
      if (!phrase.afterOnly && /\b(they|it|these|those|which|that|them|any|some|both|all)\s*$/i.test(sentence.slice(Math.max(0, phrase.at - 16), phrase.at))) continue;

      const eligible = candidates.filter((c) => (phrase.routesOnly ? isRoute(c) : true));

      /*
       * "there is no X": only X, and only when it follows immediately. The
       * name before the phrase is where the audit looked, not what it says is
       * missing, so this family never reads backwards.
       */
      if (phrase.afterOnly) {
        const next = eligible.filter((c) => c.at >= phrase.end).sort((a, b) => a.at - b.at)[0];
        const gap = next ? sentence.slice(phrase.end, next.at) : null;
        const found = next && gap !== null && AFTER_GAP.test(gap) ? next.check() : null;
        if (found) out.push(found);
        continue;
      }
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
const CLAIM_FIELDS = [
  "item", "matters", "missing", "exists", "finding", "detail", "why", "fix", "breaksAt", "note", "summary", "coverage", "mechanism",
  /*
   * Added after reading what the fields actually carry: `recommendation` is
   * the sentence a builder acts on ("add the route, it isn't registered"),
   * `title` heads a security-plan entry and a reconciled task, and `_reason` /
   * `_label` are the catch-up cards' own prose. All four could assert absence
   * and none of them was ever read by this.
   */
  "recommendation", "title", "_reason", "_label",
];

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

// --- The other half: what the audit did not read ------------------------------
//
// Everything above corrects a sentence that names something present. This
// corrects the subtler failure, the one that cost three audits this week: the
// audit graded an area it never read, and wrote "missing".
//
// The digest is a view of the repository — lists clipped, most files excerpts,
// an archive cut to a byte budget. When that view is partial, "I did not find
// it" is a fact about the read and nothing at all about the code. A model
// cannot be trusted to police this about itself (asked what it didn't see, it
// guesses), so the rule is applied here, deterministically, after the answer
// comes back: a partial read cannot produce a "missing" verdict.


/** What the audit had in front of it, as far as absence claims are concerned. */
export interface ReadView {
  /** The archive was cut, or files were listed and not read. Either way, a view. */
  partial: boolean;
  fileCount: number;
  readCount: number;
}

export interface UnreadDowngrade {
  area: CapabilityArea;
  from: "missing";
  reason: string;
}

/**
 * Turns every "missing" into "unknown" when the read was partial.
 *
 * Blunt on purpose. The finer rule — "downgrade only when *this area's* files
 * went unread" — needs a map from an area to the files that would prove it,
 * and the audit doesn't have one for an area it found nothing for: the files
 * it would name are precisely the ones it never saw. So the trigger is the one
 * fact that is known for certain, whether the digest was complete, and a
 * complete read keeps its "missing" verdicts untouched.
 *
 * "built" and "partial" are left alone in both cases. They are claims about
 * something the audit did read, and they carry their own evidence.
 */
export function downgradeUnreadCapabilities(
  capabilities: CapabilityEntry[],
  view: ReadView,
): { capabilities: CapabilityEntry[]; downgraded: UnreadDowngrade[] } {
  if (!view.partial) return { capabilities, downgraded: [] };
  const downgraded: UnreadDowngrade[] = [];
  const why = `This audit read ${view.readCount} of ${view.fileCount} files, so the codebase was only partly in view. Nothing was found for this area in what was read — which is not the same as it not being there. Confirm before building it.`;

  const next = capabilities.map((c) => {
    if (c.status !== "missing") return c;
    downgraded.push({ area: c.area, from: "missing", reason: why });
    return { ...c, status: "unknown" as const, note: c.note ? `${c.note} ${why}` : why };
  });
  return { capabilities: next, downgraded };
}

/**
 * A recommendation must not be to build what already exists.
 *
 * When an area is unknown rather than missing, "add Stripe checkout" is advice
 * founded on nothing — the audit has no idea whether checkout is there. The
 * sentence is kept and the fact is attached, exactly as absence claims are
 * handled above: the model may be right, and the builder can tell in a minute
 * what the audit could not tell in a whole read.
 */
export function noteUnreadRecommendations(
  findings: any,
  unknownAreas: CapabilityArea[],
): number {
  if (!unknownAreas.length || !findings) return 0;
  let noted = 0;

  const annotate = (text: unknown): string => {
    const value = typeof text === "string" ? text : "";
    if (!value || /could not read/i.test(value)) return value;
    const lower = value.toLowerCase();
    const hit = unknownAreas.find((a) => (AREA_TERMS[a] ?? []).some((term) => lower.includes(term)));
    if (!hit) return value;
    noted++;
    return `${value} [Confirm whether this exists first — ${areaLabel(hit)} is UNKNOWN in this audit, not missing: the read was partial and never covered it.]`;
  };

  if (Array.isArray(findings.nextThreeThings)) {
    findings.nextThreeThings = findings.nextThreeThings.map(annotate);
  }
  for (const risk of Array.isArray(findings.risks) ? findings.risks : []) {
    if (risk && typeof risk === "object") risk.recommendation = annotate(risk.recommendation);
  }
  for (const item of Array.isArray(findings.missing) ? findings.missing : []) {
    if (item && typeof item === "object") item.matters = annotate(item.matters);
  }
  return noted;
}

/* ------------------------------------------------------------------------- *
 * Two lists that asserted things and cited nothing.
 *
 * Capability evidence is held to the digest's files, the security plan's files
 * are filtered to real paths, loop stages are discarded when their evidence
 * isn't real. Risks and the missing list were the two that skipped all of that
 * — and between them they are most of what a builder reads as "what's wrong
 * with my codebase". A risk could name a path that has never existed and sort
 * to the top of the page on severity alone; a missing entry asserted absence
 * and had no evidence field at all to be wrong about.
 * ------------------------------------------------------------------------- */

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const clipList = (v: unknown, n: number, each: number) =>
  (Array.isArray(v) ? v : []).map((x) => clip(x, each)).filter(Boolean).slice(0, n);

export interface AuditRisk { area: string; severity: "low" | "medium" | "high"; finding: string; evidence: string[]; recommendation: string }
export interface AuditMissing { item: string; matters: string; searched: string[] }

/** The inventories the audit is handed whole, so "the route list" is a real answer to where it looked. */
export const KNOWN_LISTS = /^(?:the\s+)?(?:route (?:list|inventory|coverage)|routes and pages|test (?:list|inventory)|file tree|data models?|web screens|mobile screens|commits?(?: messages)?|package\.json|README(?:\.md)?)$/i;

/**
 * Risks, with their citations held to the repository.
 *
 * Unreal paths are dropped rather than shown as though a builder could open
 * them, and a risk that cited only unreal paths says so in its own text. A
 * high one is held at medium until something real is behind it: severity is
 * what orders the page, and an unevidenced claim must not outrank a finding
 * that names code.
 */
export function sanitizeRisks(raw: unknown, isRealFile: (path: string) => boolean): AuditRisk[] {
  const severities = ["low", "medium", "high"];
  return (Array.isArray(raw) ? raw : []).slice(0, 20).map((r: any) => {
    const cited = clipList(r?.evidence, 6, 200);
    const evidence = cited.filter(isRealFile);
    const claimed = (severities.includes(r?.severity) ? r.severity : "medium") as AuditRisk["severity"];
    const unverified = cited.length > 0 && evidence.length === 0;
    return {
      area: clip(r?.area, 80),
      severity: unverified && claimed === "high" ? "medium" : claimed,
      finding: unverified
        ? `${clip(r?.finding, 800)} [Cited ${cited.slice(0, 3).join(", ")}, ${cited.length === 1 ? "which is not" : "none of which are"} in this repository${claimed === "high" ? "; held at medium until something real is cited" : ""}.]`
        : clip(r?.finding, 800),
      evidence,
      recommendation: clip(r?.recommendation, 600),
    };
  }).filter((r) => r.finding);
}

/**
 * The missing list, made falsifiable.
 *
 * It now has to say where it looked, those places are held to the repository
 * like every other citation, and an entry that looked nowhere carries that on
 * its face. The entry is kept either way: the audit may well be right, and the
 * builder is the one who gets to decide — which is only possible if they can
 * see what it is based on.
 */
export function sanitizeMissing(raw: unknown, isRealFile: (path: string) => boolean): AuditMissing[] {
  return (Array.isArray(raw) ? raw : []).slice(0, 30).map((b: any) => {
    const searched = clipList(b?.searched, 6, 200).filter((f) => isRealFile(f) || KNOWN_LISTS.test(f));
    const matters = clip(b?.matters, 400);
    return {
      item: clip(b?.item, 300),
      matters: searched.length
        ? matters
        : `${matters} [The audit did not say where it looked for this. The first pass reads excerpts, not the whole repository — check before writing anything new.]`.trim(),
      searched,
    };
  }).filter((b) => b.item);
}

/**
 * Claims about what a file does, made about a file nobody opened.
 *
 * The absence checker above answers "does this exist". This answers the other
 * half, and it is the half that produced the worst finding this audit has
 * given anyone: *"signed-in web / is still feed-first (client/src/pages/home.tsx)"*
 * — named the file, was wrong about it, and led the report. The page had led
 * with the path card for a fortnight. The read had never seen it: the digest
 * excerpts a couple of dozen files out of thousands, and the rest are paths in
 * a tree. From inside that read there is nothing to distinguish a file it
 * studied from a file it only knows the name of.
 *
 * So where a claim names a file the audit did not read, it says so. The claim
 * stays — plenty of them are right, and some are drawn from the route list or
 * the screen inventory, which are real evidence — but a builder gets to see
 * which judgements came from reading code and which came from a filename.
 *
 * Deliberately not applied to the close reads (`capabilities[].detail`, the
 * loop closures): those are given whole files, and annotating them would be a
 * lie in the other direction.
 */
export function flagUnreadFiles(
  findings: any,
  opts: { read: Set<string>; inRepo: Set<string>; skip?: string[] },
): number {
  const skip = new Set(opts.skip ?? ["capabilities", "loops", "scan", "security"]);
  let flagged = 0;

  /** The first file in the sentence that is in the repository and wasn't read. A full path only: a bare name is too often ambiguous to accuse a sentence over. */
  const unreadIn = (text: string): string | null => {
    for (const m of text.matchAll(FILE_PATH)) {
      if (opts.inRepo.has(m[1]) && !opts.read.has(m[1])) return m[1];
    }
    return null;
  };

  const walk = (node: any, key?: string): any => {
    if (typeof node === "string") {
      if (!key || CLAIM_FIELDS.includes(key) || key === "__item") {
        const unread = unreadIn(node);
        if (unread && !node.includes("was not read by this audit")) {
          flagged += 1;
          return `${node} [${unread} was not read by this audit — only its path was in view. Check the file before acting on this.]`;
        }
      }
      return node;
    }
    if (Array.isArray(node)) return node.map((v) => walk(v, typeof v === "string" ? "__item" : key));
    if (node && typeof node === "object") {
      for (const k of Object.keys(node)) if (!skip.has(k)) node[k] = walk(node[k], k);
      return node;
    }
    return node;
  };

  walk(findings);
  return flagged;
}
