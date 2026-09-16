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
import OpenAI from "openai";
import { modelFor, coachingDirectiveFor, type UserEntitlements } from "./entitlements";
import type { RepoFile } from "./code-ingest";
import { parseModelJson } from "./ai-json";
import { LOOP_TYPE_INFO, sanitizeLoopClosures, type LoopClosureRead, type LoopType } from "@shared/phase-trees";

const rawBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: rawBase ? (rawBase.endsWith("/v1") ? rawBase : `${rawBase.replace(/\/$/, "")}/v1`) : undefined,
});

export interface AuditLoop { key: string; taskId: string; title: string; type: LoopType; description: string; steps: { title: string; status: string }[] }

const STOP = new Set(["the", "and", "for", "with", "from", "into", "their", "your", "loop", "post", "get", "act", "see", "on", "a", "an", "to", "of", "it", "or"]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 4 && !STOP.has(w));
const PATH_RE = /(?:^|[\s`'"(\[|])((?:[\w@.-]+\/)+[\w@.-]+\.(?:tsx?|jsx?|mjs|md|sql|ya?ml|json))(?=$|[\s`'")\]|,:;])/g;
const isTest = (p: string) => /(^|\/)(test|tests|e2e|__tests__)\/|\.(test|spec)\.[tj]sx?$/.test(p);

/** Any /api path written in prose or code, as documentation names them. */
const ENDPOINT_RE = /(?:\b(GET|POST|PUT|PATCH|DELETE)\s+)?(\/api\/[\w:./-]+)/gi;
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
export function documentedEndpoints(texts: string[], routes: { label: string; file: string }[], max = 20): string[] {
  const registered = new Map<string, { label: string; file: string }>();
  for (const r of routes) {
    const path = /\s(\/\S+)$/.exec(r.label)?.[1] ?? r.label.split(" ").pop() ?? "";
    if (path.startsWith("/api/")) registered.set(shape(path), r);
  }
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const text of texts) {
    for (const m of String(text ?? "").matchAll(ENDPOINT_RE)) {
      const path = m[2].replace(/[.,;:)\]]+$/, "");
      const key = shape(path);
      if (!path.startsWith("/api/") || seen.has(key) || lines.length >= max) continue;
      seen.add(key);
      const hit = registered.get(key);
      lines.push(hit ? `${hit.label}  — registered in ${hit.file}` : `${(m[1] ?? "").toUpperCase()} ${path}`.trim() + "  — NOT REGISTERED anywhere in this repository");
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
  max = 16,
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
      return { f, about, score: (titleWords.length ? hitsTitle / titleWords.length : 0) * 2 + (stepWords.length ? hitsSteps / stepWords.length : 0) + about };
    })
    .filter((d) => d.score >= 1.2)
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
  for (const p of (citedBy[0] ?? []).filter((p) => !isTest(p)).slice(0, max - tests.length)) add(p);
  for (const p of firstPassEvidence) add(p);
  for (const p of tests) add(p);
  for (const p of citedBy.slice(1).flat()) add(p);
  // Files named after the loop ("safety" → safety-routes.ts, admin-safety.tsx),
  // the most specific names first: "artifact" says more than "path".
  const named = files
    .filter((f) => !/\.md$/i.test(f.path))
    .map((f) => { const name = f.path.toLowerCase().split("/").pop()!; return { f, hits: titleWords.filter((w) => name.includes(w)) }; })
    .filter((x) => x.hits.length);
  const commonness = (w: string) => named.filter((x) => x.hits.includes(w)).length;
  named.sort((a, b) => Math.min(...a.hits.map(commonness)) - Math.min(...b.hits.map(commonness)) || b.hits.length - a.hits.length);
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
  const named = documentedEndpoints([loop.description ?? "", ...allDocs.map((d) => d.content ?? ""), ...paths.map((p) => byPath.get(p)?.content ?? "")], routes);
  const kind = LOOP_TYPE_INFO[loop.type];

  try {
    const completion = await openai.chat.completions.create({
      model: modelFor(ent),
      messages: [
        { role: "system", content: `You are Nova, doing a close read of one loop in a builder's codebase: does it close? ${coachingDirectiveFor(ent)}
A loop is CLOSED only when the code carries a user through every step AND something in the code brings them — or the next person — back to the first step: a notification, a feed item, a card, a link, a scheduled review, a renewal. A sequence that works but ends is OPEN.
The first pass, from a sample of the repository, said: ${firstPass.closure}${firstPass.breaksAt ? ` — breaks at: ${firstPass.breaksAt}` : ""}. It may simply not have seen the files. You now have the full text of the files that should prove this loop, every route they register, and — separately — every endpoint this loop's own writing names, each marked with whether the repository registers it. An endpoint marked "registered in <file>" EXISTS: say so, even when that file's text isn't below. Only one marked "NOT REGISTERED" is missing. Judge from them only. Cite only paths from the FILES; a stage is built when a route, page or job in those files really does it. A test that exercises a stage end to end is strong evidence it's built.
Respond ONLY with JSON: {"closure":"closed"|"open"|"not-built","stages":[{"step":"","status":"built"|"partial"|"missing","evidence":["path"]}],"returnPath":{"mechanism":"","evidence":["path"]},"breaksAt":"for open: the exact step, and what's missing","fix":"for open: the concrete change"}` },
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
