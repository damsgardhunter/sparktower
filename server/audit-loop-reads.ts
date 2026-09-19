/**
 * A second, close read of each loop the audit couldn't prove closed.
 *
 * The first pass judges every loop from the digest, and the digest is a
 * sample: a capped route list, a capped test list, a couple of dozen excerpts.
 * On a large repository the files that close a loop are often not in it, and
 * the verdict comes back "not evidenced" for a loop that is built and tested —
 * which is exactly what the admin safety loop and the feedback loop got.
 *
 * So, like the capability deep reads, each open loop gets one narrow question
 * against the full text of the files that should prove it: the files named by
 * the builder's own doc for that loop, the files the first pass cited, and the
 * files named after the loop — with every route those files register, read
 * off the source rather than from the capped list. The closure rules are the
 * same (`sanitizeLoopClosures`): "closed" still needs a real file for every
 * stage and for the way back.
 */
import { modelFor, coachingDirectiveFor, type UserEntitlements } from "./entitlements";
import type { RepoFile } from "./code-ingest";
import { parseModelJson } from "./ai-json";
import { LOOP_TYPE_INFO, sanitizeLoopClosures, type LoopClosureRead, type LoopType } from "@shared/phase-trees";

// Built on first use, never at import: server/openai-client.ts.
import { openai } from "./openai-client";

export interface AuditLoop { key: string; taskId: string; title: string; type: LoopType; description: string; steps: { title: string; status: string }[] }

const STOP = new Set(["the", "and", "for", "with", "from", "into", "their", "your", "loop", "post", "get", "act", "see", "on", "a", "an", "to", "of", "it", "or"]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 4 && !STOP.has(w));
const PATH_RE = /(?:^|[\s`'"(\[|])((?:[\w@.-]+\/)+[\w@.-]+\.(?:tsx?|jsx?|mjs|md|sql|ya?ml|json))(?=$|[\s`'")\]|,:;])/g;
const isTest = (p: string) => /(^|\/)(test|tests|e2e|__tests__)\/|\.(test|spec)\.[tj]sx?$/.test(p);

/** Any /api path written in prose or code, as documentation names them. */
const ENDPOINT_RE = /(?:\b(GET|POST|PUT|PATCH|DELETE)\s+)?(\/api\/[\w:./-]+\*?)/gi;
/** The file where a path literally appears, params ignored — evidence it exists even when the route list missed it. */
function handWritten(path: string, files: RepoFile[]): string | null {
  const pattern = path.split("/").map((seg) => (seg.startsWith(":") ? "[^/`'\"]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/");
  const re = new RegExp(pattern);
  const hit = files.find((f) => f.content && !isTest(f.path) && !/^(client|mobile)\//.test(f.path) && re.test(f.content));
  return hit?.path ?? null;
}

/** `/api/users/:id/follow` and `/api/users/:userId/follow` are the same endpoint. */
const shape = (path: string) => path.replace(/:[\w-]+/g, ":p").replace(/\/+$/, "").toLowerCase();

/**
 * The endpoints a loop's own documentation names, each marked with whether the
 * repository actually registers it.
 *
 * A loop's proof files are the ones named for it, which on a large codebase
 * often aren't where its routes live — follow, connect and message are all
 * registered in one enormous `routes.ts` that no loop is named after. Without
 * this, a read of the Explore loop can only say the documented endpoints
 * "cannot be evidenced from the provided files", which is a fact about the
 * prompt rather than the code. Checked against every route in the repository,
 * so "not registered" is also a real finding.
 */
export function documentedEndpoints(
  texts: string[],
  routes: { label: string; file: string }[],
  files: RepoFile[] = [],
  max = 20,
): string[] {
  const registered = new Map<string, { label: string; file: string }>();
  /** Every registered route for a path shape, so the method somebody named can be honoured. */
  const byShape = new Map<string, { label: string; file: string; method: string }[]>();
  for (const r of routes) {
    const path = /\s(\/\S+)$/.exec(r.label)?.[1] ?? r.label.split(" ").pop() ?? "";
    if (!path.startsWith("/api/")) continue;
    const key = shape(path);
    if (!registered.has(key)) registered.set(key, r);
    byShape.set(key, [...(byShape.get(key) ?? []), { ...r, method: r.label.split(" ")[0] }]);
  }
  /** Routes under a prefix, for a mention like `/api/artifacts/*`. */
  const under = (prefix: string) =>
    [...byShape.keys()].filter((k) => k.startsWith(prefix)).flatMap((k) => byShape.get(k) ?? []);
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const text of texts) {
    for (const m of String(text ?? "").matchAll(ENDPOINT_RE)) {
      const path = m[2].replace(/[.,;:)\]]+$/, "");
      const key = shape(path);
      if (!path.startsWith("/api/") || seen.has(key) || lines.length >= max) continue;
      seen.add(key);

      /*
       * `/api/artifacts/*` is a family, not an endpoint, and so is a mention
       * that trails off in a slash. Looking one up as though it were a path
       * finds nothing and prints "not in the route list" — directly above the
       * line that correctly reports the real route as registered. A read of
       * this codebase's path loop took that as proof the artifact routes did
       * not exist and told the builder to write them again. They were already
       * there, mounted at server/routes.ts.
       */
      if (/[*]$/.test(path) || (/\/$/.test(m[2]) && !registered.has(key))) {
        const prefix = shape(path.replace(/\*$/, ""));
        const family = under(prefix);
        lines.push(family.length
          ? `${path}  — a family, not one endpoint: ${family.length} registered (${family.slice(0, 4).map((r) => r.label).join(", ")}${family.length > 4 ? ", …" : ""})`
          : `${path}  — a family, and NOT ONE route is registered under it`);
        continue;
      }

      // The method somebody wrote, when that exact route exists; otherwise whatever is registered at that shape.
      const named = (m[1] ?? "").toUpperCase();
      const exact = named ? (byShape.get(key) ?? []).find((r) => r.method === named) : undefined;
      const hit = exact ?? registered.get(key);
      if (hit) { lines.push(`${hit.label}  — registered in ${hit.file}`); continue; }
      /*
       * Not in the route list — which is a list, not the repository. Before
       * saying a route doesn't exist, look for it in the code: a route table
       * can be clipped, or a shape the detector doesn't know. Saying "missing"
       * about something that is right there sends a builder to write it twice,
       * so the weaker claim is the honest one.
       */
      const written = handWritten(path, files);
      lines.push(`${(m[1] ?? "").toUpperCase()} ${path}`.trim() + (written
        ? `  — not in the route list, but this path is written in ${written} (check how it's mounted)`
        : "  — NOT FOUND anywhere in the files read"));
    }
  }
  return lines;
}

/**
 * The files that should prove a loop, most telling first. Pure, so which files
 * a loop is judged on is tested without a model.
 */
export function pickLoopEvidence(
  loop: Pick<AuditLoop, "title" | "description"> & { type?: LoopType },
  files: RepoFile[],
  firstPassEvidence: string[] = [],
  /*
   * Sixteen was enough when the loop docs were shorter. As they grew — more
   * client surfaces, more shared modules — the files at the end of a doc's own
   * citation list started falling off the budget, and for the revenue loop that
   * was `server/billing-credits.ts`, where the spending actually happens.
   * Widening the budget was the honest fix; reordering to favour server code
   * bought the same slot by dropping the pages that show the loop, which other
   * loops need.
   */
  max = 20,
): { paths: string[]; docs: string[] } {
  const byPath = new Map(files.filter((f) => typeof f.content === "string").map((f) => [f.path, f]));
  const titleWords = [...new Set(words(loop.title))];
  const stepWords = [...new Set(words(loop.description))];
  const out: string[] = [];
  const add = (p: string) => { if (byPath.has(p) && !out.includes(p) && out.length < max) out.push(p); };

  // The builder's doc for this loop: a markdown file that talks about it, whose
  // cited paths are the builder's own map of where the loop lives. A long plan
  // mentions every word of every loop, so a doc that is *about* this loop — its
  // title in the doc's heading, or named for the loop's kind ("growth-loop.md")
  // — outranks one that merely contains the words.
  const docs = files
    .filter((f) => /\.md$/i.test(f.path) && typeof f.content === "string")
    .map((f) => {
      const text = f.content!.toLowerCase();
      const hitsTitle = titleWords.filter((w) => text.includes(w)).length;
      const hitsSteps = stepWords.filter((w) => text.includes(w)).length;
      const heading = (/^#\s+(.+)$/m.exec(f.content!)?.[1] ?? "").toLowerCase();
      const headingHits = titleWords.length ? titleWords.filter((w) => heading.includes(w)).length / titleWords.length : 0;
      const name = f.path.toLowerCase().split("/").pop()!;
      const namedForKind = !!loop.type && name === `${loop.type}-loop.md`;
      const about = (headingHits >= 0.99 ? 1.5 : headingHits >= 0.5 ? 0.5 : 0) + (namedForKind && hitsTitle ? 1 : 0);
      return { f, about, hitsSteps, score: (titleWords.length ? hitsTitle / titleWords.length : 0) * 2 + (stepWords.length ? hitsSteps / stepWords.length : 0) + about };
    })
    /*
     * Enough score, and not by coincidence. Title words alone are cheap: a
     * short title shares two ordinary words with any long document, and then
     * that document's cited paths lead the read — ahead of what the first pass
     * actually found. (A runbook about connecting a domain was picked this way,
     * off "something" and "entirely", and its paths displaced the evidence.)
     * So a doc must also say something about the loop's *steps*, or be headed
     * with the loop's own name / named for its kind, which is what `about` is.
     */
    .filter((d) => d.score >= 1.2 && (d.about > 0 || d.hitsSteps > 0))
    .sort((a, b) => b.score - a.score);
  // A second doc only when it's about this loop nearly as much as the first; a
  // plan that mentions every loop in passing crowds out the one that maps this one.
  const kept = docs.filter((d, i) => i === 0 || (i === 1 && d.score >= docs[0].score * 0.85 && !(docs[0].about >= 1.5 && d.about < 1)));
  const citedBy = kept.map((d) => [...new Set([...d.f.content!.matchAll(PATH_RE)].map((m) => m[1]).filter((p) => byPath.has(p)))]);
  // The best doc's code, then what the first pass cited, then the best doc's
  // tests (the proof), then anything a second doc adds.
  // Tests: an end-to-end spec proves the most, then integration, then unit — and a few say enough.
  const testRank = (p: string) => (/^e2e\//.test(p) ? 0 : /integration/.test(p) ? 1 : 2);
  const tests = (citedBy[0] ?? []).filter(isTest).sort((a, b) => testRank(a) - testRank(b)).slice(0, 4);
  /*
   * Files named after the loop ("safety" → safety-routes.ts, admin-safety.tsx),
   * the most specific names first: "artifact" says more than "path".
   *
   * The words of the *steps* count, not only the title's. This comment used to
   * claim the artifact case while the code matched titles alone — and the path
   * loop's title is "follow a goal path (Ship/Systemize/Raise)", so "Raise"
   * pulled in fund, capital and investment files while `artifact-routes.ts` and
   * the test that publishes one were never shown to the read at all. It then
   * reported the artifact routes as unregistered and told the builder to write
   * them a second time. A noun in the steps is how a loop names its own parts.
   */
  /*
   * A word matches a *part* of the file's name, not any substring of it.
   * Substring matching made "land" match `landing.tsx`, "share" match
   * `shared.ts` and "build" match `document-builder.tsx` — and since each of
   * those accidents matched exactly one file, the rarity sort promoted them
   * above `artifact-routes.ts`, which six files genuinely share. Coincidences
   * are always rare; that is what made them win.
   */
  const partsOf = (path: string) => path.toLowerCase().split("/").pop()!.split(/[^a-z0-9]+/).filter(Boolean);
  const namesPart = (parts: string[], w: string) => parts.some((p) => p === w || p === `${w}s` || `${p}s` === w);
  const named = files
    // The generic UI kit is buttons, selects and progress bars. `select.tsx` matching the word
    // "select" in a loop's steps is a coincidence, and it was taking a reserved slot.
    .filter((f) => !/\.md$/i.test(f.path) && !/(^|\/)components\/ui\//.test(f.path))
    .map((f) => {
      const parts = partsOf(f.path);
      return {
        f,
        hits: titleWords.filter((w) => namesPart(parts, w)),
        stepHits: stepWords.filter((w) => !titleWords.includes(w) && namesPart(parts, w)),
      };
    })
    .filter((x) => x.hits.length || x.stepHits.length);
  const all = (x: typeof named[number]) => [...x.hits, ...x.stepHits];
  const commonness = (w: string) => named.filter((x) => all(x).includes(w)).length;
  /*
   * Rarest word first, wherever it came from. Weighting title words above step
   * words undoes the whole point: this loop's title carries "path", which names
   * a dozen files, while its steps carry "artifact", which names three — and
   * the three are the ones that answer the question.
   */
  named.sort((a, b) =>
    Math.min(...all(a).map(commonness)) - Math.min(...all(b).map(commonness)) ||
    all(b).length - all(a).length);
  /*
   * Reserved, not appended. Ranking these better achieved nothing while they
   * were added last: the doc's own citations filled all sixteen slots first,
   * and the files named for the loop's parts never fit. A few slots are held
   * for them before the rest of the budget is spent.
   */
  const RESERVED = 2;
  /*
   * Two, and never a file the doc already cites — a reserved slot spent on
   * something that was coming anyway is a slot taken from the doc's own list,
   * which is the stronger evidence. Reserving three cost the revenue loop
   * `server/billing-credits.ts`, which its doc cites and which is where the
   * spending actually happens.
   */
  const alreadyCited = new Set(citedBy.flat());
  const reserved = named.filter((x) => !alreadyCited.has(x.f.path)).slice(0, RESERVED).map((x) => x.f.path);

  for (const p of (citedBy[0] ?? []).filter((p) => !isTest(p)).slice(0, Math.max(0, max - tests.length - reserved.length))) add(p);
  for (const p of firstPassEvidence) add(p);
  for (const p of reserved) add(p);
  for (const p of tests) add(p);
  for (const p of citedBy.slice(1).flat()) add(p);
  for (const { f } of named) {
    if (out.length >= max) break;
    add(f.path);
  }
  return { paths: out, docs: kept.map((d) => d.f.path) };
}

/** One loop, read closely. Never throws: a failed read keeps the first-pass verdict. */
export async function readLoopClosure(
  ent: UserEntitlements, loop: AuditLoop, firstPass: LoopClosureRead, files: RepoFile[],
  routes: { label: string; file: string }[], opts: { maxCharsPerFile?: number; timeoutMs?: number } = {},
): Promise<LoopClosureRead | null> {
  const firstEvidence = [...firstPass.stages.flatMap((s) => s.evidence), ...(firstPass.returnPath?.evidence ?? [])];
  const { paths, docs } = pickLoopEvidence(loop, files, firstEvidence);
  if (!paths.length) return null;
  const byPath = new Map(files.map((f) => [f.path, f]));
  const maxChars = opts.maxCharsPerFile ?? 30_000;
  const allDocs = docs.map((d) => byPath.get(d)!).filter(Boolean);
  // Tests read shorter: what they assert is near the top, and the code is what's being judged.
  const text = [...allDocs, ...paths.map((p) => byPath.get(p)!)]
    .map((f) => { const cap = isTest(f.path) ? Math.min(maxChars, 12_000) : maxChars; return `### ${f.path}\n${f.content!.slice(0, cap)}${f.content!.length > cap ? "\n… (truncated)" : ""}`; }).join("\n\n");
  const chosen = new Set(paths);
  const loopRoutes = routes.filter((r) => chosen.has(r.file));
  // The endpoints this loop's own writing names, and whether they exist — wherever they're registered.
  const named = documentedEndpoints([loop.description ?? "", ...allDocs.map((d) => d.content ?? ""), ...paths.map((p) => byPath.get(p)?.content ?? "")], routes, files);
  const kind = LOOP_TYPE_INFO[loop.type];

  try {
    const completion = await openai.chat.completions.create({
      model: modelFor(ent),
      messages: [
        { role: "system", content: `You are Nova, doing a close read of one loop in a builder's codebase: does it close? ${coachingDirectiveFor(ent)}
A loop is CLOSED only when the code carries a user through every step AND something in the code brings them — or the next person — back to the first step: a notification, a feed item, a card, a link, a scheduled review, a renewal. A sequence that works but ends is OPEN.
The first pass, from a sample of the repository, said: ${firstPass.closure}${firstPass.breaksAt ? ` — breaks at: ${firstPass.breaksAt}` : ""}. It may simply not have seen the files. You now have the full text of the files that should prove this loop, every route they register, and — separately — every endpoint this loop's own writing names, each marked with whether the repository registers it. An endpoint marked "registered in <file>" EXISTS: say so, even when that file's text isn't below. Only one marked "NOT REGISTERED" is missing. Judge from them only. Cite only paths from the FILES; a stage is built when a route, page or job in those files really does it. A test that exercises a stage end to end is strong evidence it's built.
Every stage you call built, and the return path, MUST carry at least one path in its "evidence" list — copied exactly from the FILES above. A stage described in prose with an empty evidence list is discarded and the loop is reported open, which wastes the whole read: describing a mechanism is not citing it.\nRespond ONLY with JSON: {"closure":"closed"|"open"|"not-built","stages":[{"step":"","status":"built"|"partial"|"missing","evidence":["path"]}],"returnPath":{"mechanism":"","evidence":["path"]},"breaksAt":"for open: the exact step, and what's missing","fix":"for open: the concrete change"}` },
        { role: "user", content: `THE LOOP — ${kind.label}: "${loop.title}"\nWritten as: ${loop.description || "(not written)"}\nCloses when: ${kind.closes}\n${loop.steps.length ? `Build steps: ${loop.steps.map((s) => `${s.title} (${s.status})`).join("; ")}\n` : ""}\nROUTES IN THESE FILES (${loopRoutes.length}, read off the source)\n${loopRoutes.map((r) => `- ${r.label}  [${r.file}]`).join("\n") || "(none)"}\n\nENDPOINTS THIS LOOP'S WRITING NAMES (${named.length}, checked against every route in the repository)\n${named.map((l) => `- ${l}`).join("\n") || "(none named)"}\n\nFILES\n${text}` },
      ],
    }, { timeout: opts.timeoutMs ?? 120_000 });
    const parsed = parseModelJson(completion.choices[0]?.message?.content ?? "", "loop read");
    const [read] = sanitizeLoopClosures([{ ...parsed, key: loop.key }], [loop], new Set(files.map((f) => f.path)));
    return read ? { ...read, note: read.note ? `${read.note} (close read)` : undefined } : null;
  } catch (err) {
    console.error(`[audit] loop read failed for ${loop.title}:`, (err as Error)?.message ?? err);
    return null;
  }
}

/**
 * Close reads for every loop the first pass didn't find closed, in parallel.
 * A close read only replaces the first pass when it came back — and it can
 * open a loop as well as close one: it's a better read, not an appeal.
 */
export async function rereadOpenLoops(
  ent: UserEntitlements, loops: AuditLoop[], firstPass: LoopClosureRead[], files: RepoFile[], routes: { label: string; file: string }[],
  max = 8,
): Promise<LoopClosureRead[]> {
  const open = firstPass.filter((r) => r.closure !== "closed").slice(0, max);
  const reread = new Map<string, LoopClosureRead>();
  await Promise.all(open.map(async (r) => {
    const loop = loops.find((l) => l.taskId === r.loopTaskId);
    if (!loop) return;
    const read = await readLoopClosure(ent, loop, r, files, routes);
    if (read) reread.set(r.loopTaskId, read);
  }));
  return firstPass.map((r) => reread.get(r.loopTaskId) ?? r);
}
