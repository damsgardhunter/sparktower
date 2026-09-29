/**
 * Targeted second reads. The first pass says whether an area exists; these
 * ask one narrow question per area against the full text of the files that
 * prove it, plus the exact route coverage, and come back with a quantified
 * coverage line and the specific gaps. This is what turns "rate limiting:
 * built" into "covers 14 of 19 writes; comments and uploads are not".
 */
import { modelFor, coachingDirectiveFor, type UserEntitlements } from "./entitlements";
import type { RepoFile } from "./code-ingest";
import type { RouteCoverage } from "./route-coverage";
import { renderRouteCoverage } from "./route-coverage";
import { renderDataShape, tablesExercisedByTests, type DataShape } from "@shared/data-shape";
import { CAPABILITY_AREAS, sanitizeDeepRead, type CapabilityEntry, type CapabilityArea, type CapabilityDetail } from "@shared/capabilities";
import { parseModelJson } from "./ai-json";
import { fingerprintOf, recallArea, rememberArea } from "./audit-memory";
import { isTest, summarizeTestInventory, summarizeMobileScreens, summarizeWebScreens, summarizeAuthEndpoints, summarizeEnforcementFilters, summarizeUntestedRoutes } from "./audit-evidence";

// Built on first use, never at import: server/openai-client.ts.
import { openai } from "./openai-client";

/** The one question each area is asked. Quantified answers, named gaps. */
export const AREA_QUESTIONS: Record<CapabilityArea, string> = {
  auth: "Which routes can be reached without auth that shouldn't be? How are sessions or tokens issued, refreshed and revoked, and is the password path hashed? Name any route or flow that trusts the client.",
  rateLimiting: "Which write and costly routes are rate-limited and which are not (use the ROUTE COVERAGE list and the code)? Is the limit durable across instances? What error shape does a limited request get, and is Retry-After sent?",
  moderation: "Is the chain report → queue → action → enforcement in reads → undo complete? Name each step's file and any step that is UI-only or missing. Is the log immutable?",
  payments: "Is every webhook verified against a signature? Are events idempotent? What syncs entitlements after payment, and what happens on failure or refund?",
  ai: "Which AI routes are metered by credits and which are not? Is there a per-user burst limit? How are model errors and unparseable responses handled, and is the user charged on failure?",
  analytics: "Which events are captured and where? What can the owner see, is it gated to the owner, and is the data retention or deletion handled?",
  data: "How is the schema applied (migrations vs push)? Which tables carry user content, and which columns could hold secrets or PII? Is there any destructive operation without a guard? If DATA IN USE is given: which tables are empty, and which features does that make built-but-unused?",
  tests: "What do the tests actually cover — list areas with a test file for each — and what important paths have none? Is there a test database strategy, and do tests run in CI?",
  ci: "What does the pipeline run (typecheck, lint, tests, E2E, secrets scan)? What is missing? Are results required before merge, as far as the code shows?",
  deploy: "How is the app deployed and configured? Is there a health check, an environment contract, kill switches, and production-only enforcement (e.g. session secret)? What would break on a fresh deploy?",
  mobile: "Which screens exist and which API routes do they call? Does the mobile auth flow match the web one? Which of the product's loops are reachable on mobile and which are not?",
};

const RELEVANT_TO_COVERAGE = new Set<CapabilityArea>(["auth", "rateLimiting", "ai", "moderation", "deploy"]);

/** Where each area's code usually lives, by file name. Added to the evidence files for the read. */
const AREA_FILE_HINTS: Partial<Record<CapabilityArea, RegExp>> = {
  auth: /auth|session|passport|token|login/i,
  rateLimiting: /moderation|rate-?limit|limiter|entitle|plans/i,
  moderation: /moderation|report|admin/i,
  payments: /stripe|billing|payment|webhook|subscription|entitle/i,
  ai: /openai|nova|ai-?models|prompt|entitle|plans|ai-json|ai-metering|moderation/i,
  analytics: /analytics|metrics|track/i,
  data: /schema|storage|db\b|migrat/i,
  tests: /vitest|playwright|test\/setup|test\/helpers|test\/integration|test\/unit|e2e\//i,
  ci: /\.github\/workflows|ci-stability|release-checklist|ci-gate|branch-protection|dependabot/i,
  deploy: /index\.ts$|app\.ts$|surfaces|health|env-contract|\.replit|Dockerfile/i,
  mobile: /^mobile\/(app|src)\/|mobile-auth/i,
};

/**
 * The file an area's question is really about, kept in the read whatever else
 * competes for the ten slots.
 *
 * Name-matching alone put `server/webhookHandlers.ts` behind a dozen other
 * files matching /stripe|billing/, and a payments read without it can only say
 * "the claim-before-side-effects mechanism isn't in the files provided" — a
 * statement about the prompt, not the code. These go in first.
 */
const AREA_MUST_READ: Partial<Record<CapabilityArea, RegExp>> = {
  payments: /(^|\/)(webhookHandlers|billing-credits)\.ts$/,
  auth: /(^|\/)(mobile-auth|mfa|replitAuth)\.ts$/,
  rateLimiting: /(^|\/)moderation\.ts$/,
  moderation: /(^|\/)(moderation|moderation-log-rules)\.ts$/,
  mobile: /(^|\/)mobile-auth\.ts$/,
  // entitlements.ts holds requireCredits and reserveOptionalAi; moderation.ts holds the limiter both of them call.
  ai: /(^|\/)(entitlements|moderation)\.ts$/,
  // The gate is a GitHub setting, so the repository's evidence for it is the written contract and the script that checks it.
  ci: /(^|\/)ci-gate\.md$|(^|\/)check-branch-protection\.mjs$/,
};

/** The matrix rows this area's question is about, one compact line each, so "which routes" is answerable from evidence. */
export function rowsForArea(area: CapabilityArea, cov: RouteCoverage, max = 140): string | null {
  const rows = cov.rows.filter((r) => r.mounted !== false);
  const pick = area === "rateLimiting" ? rows.filter((r) => r.write || r.cost)
    : area === "auth" ? rows.filter((r) => r.write || r.privileged)
    : area === "ai" ? rows.filter((r) => r.cost)
    : area === "moderation" ? rows.filter((r) => /report|moderat|admin|ban|suspend|hide|comment|feed/i.test(r.path))
    : area === "deploy" ? rows.filter((r) => r.surface || /health|surfaces|admin/i.test(r.path))
    : [];
  if (!pick.length) return null;
  const line = (r: typeof pick[number]) => `${r.method} ${r.path}  auth:${r.auth ? "y" : "n"} limit:${r.rateLimited ? "y" : r.floor ? "floor" : "n"} credits:${r.credits ? "y" : "n"}${r.surface ? ` surface:${r.surface}` : ""}${r.privileged ? " privileged" : ""}  [${r.file}]`;
  return `ROUTES RELEVANT TO THIS AREA (${pick.length}${pick.length > max ? `, first ${max}` : ""}; read off the source, exact)\n${pick.slice(0, max).map(line).join("\n")}`;
}


/**
 * A file too long to send whole, cut around the question being asked rather
 * than at the first 60,000 characters.
 *
 * `server/moderation.ts` is 85kB and the undo handler starts at character
 * 72,603 — so the read got the first 70% of the file and honestly reported
 * that it could not confirm the undo handler, because the undo handler was
 * not in what it was given. Taking the head is the right default for a file
 * whose shape is at the top; it is the wrong one for a 2,000-line routes file
 * where the answer is wherever the route happens to sit.
 *
 * So: the head, always, because that is where the module says what it is —
 * and then the parts that mention what the area was asked about, in file
 * order, with the cuts marked so nothing reads as contiguous code that isn't.
 */
export function clipToQuestion(content: string, maxChars: number, question: string): string {
  if (content.length <= maxChars) return content;
  const head = Math.floor(maxChars * 0.45);
  const terms = [...new Set((question.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []))]
    .filter((w) => !STOP_WORDS.has(w));

  const lines = content.split("\n");
  /** Where the head ends, in lines, so a region never starts mid-way through it. */
  let used = 0, headLines = 0;
  for (const line of lines) { if (used + line.length + 1 > head) break; used += line.length + 1; headLines += 1; }

  /*
   * A rare word is worth more than a common one. "report" appears on two
   * hundred lines of a moderation file and says nothing about which of them
   * matters; "undo" appears on twenty and points straight at the handler the
   * question was about. Weighting by how often the term occurs is what stops
   * the densest paragraph in the file eating the whole budget.
   */
  const lower = content.toLowerCase();
  const weight = new Map(terms.map((t) => {
    const hits = lower.split(t).length - 1;
    return [t, hits > 0 ? 1 / Math.log2(2 + hits) : 0];
  }));
  const scored = lines.map((line, i) => {
    if (i < headLines) return 0;
    const text = line.toLowerCase();
    return terms.reduce((n, t) => n + (text.includes(t) ? weight.get(t)! : 0), 0);
  });
  const wanted = new Set<number>();
  let budget = maxChars - used;
  /* Whole neighbourhoods rather than single lines: a route's guard and its body are 40 lines apart. */
  const order = scored.map((score, i) => ({ score, i })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i);
  for (const { i } of order) {
    if (budget <= 0) break;
    for (let j = Math.max(headLines, i - 12); j <= Math.min(lines.length - 1, i + 28); j++) {
      if (wanted.has(j)) continue;
      const cost = lines[j].length + 1;
      if (cost > budget) continue;
      wanted.add(j); budget -= cost;
    }
  }

  const out: string[] = lines.slice(0, headLines);
  let lastKept = headLines - 1;
  for (const i of [...wanted].sort((a, b) => a - b)) {
    if (i > lastKept + 1) out.push(`… (${i - lastKept - 1} lines not shown)`);
    out.push(lines[i]);
    lastKept = i;
  }
  if (lastKept < lines.length - 1) out.push(`… (${lines.length - 1 - lastKept} lines not shown)`);
  return out.join("\n");
}

/** Words in a question that say nothing about where an answer lives. */
const STOP_WORDS = new Set([
  "each", "step", "name", "that", "this", "with", "from", "what", "which", "does", "have", "into",
  "only", "else", "there", "where", "when", "they", "them", "then", "than", "about", "every", "some",
  "complete", "missing", "chain", "anything",
]);

/**
 * One area, read properly. Given the full text of its evidence files (and
 * a few obvious relatives), the route coverage where it matters, and the
 * area's question. Never throws: a failed read leaves the area at its
 * first-pass verdict, which is honest, rather than failing the audit.
 */
export async function deepReadArea(
  ent: UserEntitlements, entry: CapabilityEntry, files: RepoFile[], coverage: RouteCoverage | null,
  opts: {
    maxFiles?: number; maxCharsPerFile?: number; timeoutMs?: number; dataShape?: DataShape | null;
    /** Whose codebase, so an area whose files have not changed is not read again. */
    projectId?: string;
    /** Told when an area was answered from memory rather than from the model. */
    onRecall?: (area: string) => void;
  } = {},
): Promise<CapabilityDetail | null> {
  const area = CAPABILITY_AREAS.find((a) => a.id === entry.area);
  if (!area) return null;
  // Whole files for the ones that matter: a mechanism cut off mid-function
  // reads as "cannot be verified", which is worse than a longer prompt.
  const maxFiles = opts.maxFiles ?? 10, maxChars = opts.maxCharsPerFile ?? 60000;
  const byPath = new Map(files.map((f) => [f.path, f]));
  const chosen: RepoFile[] = [];
  // The mechanism files first: they answer the area's question, and losing them to the cap costs the whole verdict.
  const mustRead = AREA_MUST_READ[entry.area];
  if (mustRead) for (const f of files) {
    if (chosen.length >= maxFiles) break;
    if (f.content && !isTest(f.path) && mustRead.test(f.path) && !chosen.includes(f)) chosen.push(f);
  }
  for (const e of entry.evidence) { const f = byPath.get(e.file); if (f?.content && !chosen.includes(f)) chosen.push(f); if (chosen.length >= maxFiles) break; }
  // Files the area's question is about, by name, so "not present in the
  // files provided" stops being the answer when the file exists.
  const hint = AREA_FILE_HINTS[entry.area];
  // For the testing and CI areas the test harness and the pipeline ARE the evidence; elsewhere tests stay out of the full text.
  const testsAreTheSubject = entry.area === "tests" || entry.area === "ci";
  if (testsAreTheSubject) {
    for (const f of files) {
      if (chosen.length >= maxFiles) break;
      if (f.content && !chosen.includes(f) && /(^|\/)\.github\/workflows\/|(^|\/)(vitest|playwright)\.config\.|(^|\/)test\/(setup|helpers)\//.test(f.path)) chosen.push(f);
    }
  }
  if (hint) for (const f of files) {
    if (chosen.length >= maxFiles) break;
    if (f.content && !chosen.includes(f) && hint.test(f.path) && (testsAreTheSubject || !isTest(f.path))) chosen.push(f);
  }
  if (!chosen.length) return null;
  /*
   * The text as the model will see it, built once and then hashed.
   *
   * Hashing what is actually sent rather than the files on disk means a change
   * past the per-file cap — which the model never saw and could not have
   * reasoned about — correctly does not invalidate the conclusion.
   */
  const sent = chosen.map((f) => ({
    path: f.path,
    text: `${f.content!.slice(0, maxChars)}${f.content!.length > maxChars ? "\n… (truncated)" : ""}`,
  }));
  const fileText = sent.map((f) => `### ${f.path}\n${f.text}`).join("\n\n");

  /*
   * If this area would read exactly the bytes it read last time, it already
   * knows the answer. No model call, no tokens, and the same verdict it would
   * have reached — because the input is identical.
   */
  const fingerprint = fingerprintOf(sent);
  if (opts.projectId) {
    const remembered = await recallArea(opts.projectId, entry.area, fingerprint);
    if (remembered) { opts.onRecall?.(entry.area); return remembered; }
  }
  const cov = [
    RELEVANT_TO_COVERAGE.has(entry.area) && coverage ? [renderRouteCoverage(coverage, 40), rowsForArea(entry.area, coverage)].filter(Boolean).join("\n\n") : null,
    // With the test files to hand, an empty table can be reported as unused rather than unproven.
    opts.dataShape ? renderDataShape(opts.dataShape, 40, tablesExercisedByTests(files, opts.dataShape.tables.map((t) => t.name))) : null,
    // Every test file's path — all of them for the testing and CI areas, the ones named for this area elsewhere — so
    // "is this tested?" is answered from the repository, not from the handful of files whose full text fits.
    summarizeTestInventory(files.map((f) => f.path), testsAreTheSubject ? null : hint ?? null),
    /*
     * The phone's screens, for mobile and for moderation.
     *
     * Reporting is something a person does, so "can they do it from the app"
     * is part of whether the chain is real — and the moderation read had no
     * way to see the phone at all, so it correctly said it could not confirm
     * parity and a reader took that for a gap. (The report button is in
     * mobile/src/components/FeedParts.tsx; the review queue is deliberately
     * web-only, which is a different sentence from "not found".)
     */
    entry.area === "mobile" || entry.area === "moderation" ? summarizeMobileScreens(files) : null,
    // The web's routes with their gating: for auth, because "which screens does a signed-out
    // person reach" is the question; for mobile, because the two apps are only comparable together.
    entry.area === "auth" || entry.area === "mobile" ? summarizeWebScreens(files) : null,
    // Both ends of the app's sign-in, so "same auth as the web" is checked rather than taken from a comment.
    entry.area === "mobile" && coverage ? summarizeAuthEndpoints(coverage.rows) : null,
    // The chain's last step: where hidden content and suspended accounts are filtered out of reads.
    entry.area === "moderation" ? summarizeEnforcementFilters(files) : null,
    // For the testing areas: which routes no test names, so "what isn't covered" is answered from the repository.
    testsAreTheSubject && coverage ? summarizeUntestedRoutes(files, coverage.rows) : null,
  ].filter(Boolean).join("\n\n") || null;
  const allowed = new Set(files.map((f) => f.path));

  try {
    const completion = await openai.chat.completions.create({
      model: modelFor(ent),
      /*
       * Ordered so a re-run of the same repository is mostly cached.
       *
       * A prompt caches by exact prefix, so whatever varies between two
       * audits has to come after whatever does not. The rules are identical
       * every time; the area and its question are identical for that area;
       * the files are identical until the code changes — and the files are
       * almost all of the bill. What genuinely moves run to run is the
       * first-pass verdict and the route coverage, so those go last.
       *
       * Auditing the same repository twice used to re-buy every file at full
       * price. This is the whole reason the verdict is not in the system
       * message any more: one changing sentence at the top made the several
       * hundred thousand tokens beneath it uncacheable.
       */
      messages: [
        { role: "system", content: DEEP_READ_RULES },
        { role: "user", content: `AREA: ${area.label}. What counts: ${area.counts}.\nQUESTION\n${AREA_QUESTIONS[entry.area]}\n\nFILES\n${fileText}\n\n${cov ? `${cov}\n\n` : ""}FIRST-PASS VERDICT: ${entry.status}${entry.summary ? ` — ${entry.summary}` : ""}.\n${coachingDirectiveFor(ent)}` },
      ],
    }, { timeout: opts.timeoutMs ?? 120_000 });
    const detail = sanitizeDeepRead(parseModelJson(completion.choices[0]?.message?.content ?? "{}"), allowed);
    // Remembered against the bytes that produced it, so the next audit can skip it.
    if (detail && opts.projectId) await rememberArea(opts.projectId, entry.area, fingerprint, detail);
    return detail;
  } catch (err) {
    console.error(`[audit] deep read failed for ${entry.area}:`, (err as Error)?.message ?? err);
    return null;
  }
}

/** Second reads for every built or partial area, in parallel, each independent. */
/**
 * What a close read is, said the same way every time.
 *
 * Module-level and free of interpolation on purpose: this is the cached
 * prefix every deep read shares, so it must be byte-identical across areas,
 * across runs and across users. Anything that varies — the area, the files,
 * last pass's verdict — belongs in the user message, in that order.
 */
const DEEP_READ_RULES = `You are Nova, doing a close read of one area of a builder's codebase.
Answer the question from the FILES, the ROUTE COVERAGE and the TEST FILES, MOBILE SCREENS and WEB SCREENS lists only. Those lists are complete (every test in the repository, or every one named for this area; every mobile route file; every web route declared in the client router): a file on them exists even when its full text isn't in FILES — never call it missing, and count from the lists. Quantify wherever the code lets you ("14 of 19 write routes"). Name gaps as concrete things to change, each with the file it lives in when you can point at one — only paths that appear in the files given or the coverage list. No advice, no generalities: if it isn't in the code in front of you, say it isn't there.
Respond ONLY with JSON: {"coverage":"one or two sentences, quantified","gaps":[{"item":"","file":"path or omit","severity":"low|medium|high"}],"strengths":["what is done well, one line each, at most three"]}`;

/** Whether an area has files worth opening, which is what makes a second read of a "missing" one worth paying for. */
export function hasCandidateFiles(area: CapabilityArea, files: RepoFile[]): boolean {
  const must = AREA_MUST_READ[area], hint = AREA_FILE_HINTS[area];
  return files.some((f) => !!f.content && ((must?.test(f.path) ?? false) || (!!hint && hint.test(f.path) && !isTest(f.path))));
}

/**
 * Second reads, in parallel, each independent.
 *
 * Built and partial areas are read to put numbers and named gaps behind a
 * verdict. Areas called **missing** are read for a different reason: to find
 * out whether they are missing at all. That verdict is the one a builder acts
 * on hardest — it says write this from scratch — and it was the one verdict
 * nothing ever checked, because second reads ran only where the first pass had
 * already found something. A close read that says otherwise moves the area to
 * partial and says, in the note, which read to believe.
 *
 * The recall half is the other branch's: an area whose files have not changed
 * since the last audit is answered from memory rather than from the model, and
 * `recalled` names the ones that were. The two features meet here because they
 * both decide whether a given area costs a model call — one adds calls that
 * were never made, the other removes calls already paid for — so they have to
 * agree in a single pass rather than each re-walking the list.
 */
export async function deepReadAll(
  ent: UserEntitlements, caps: CapabilityEntry[], files: RepoFile[], coverage: RouteCoverage | null,
  dataShape: DataShape | null = null,
  opts: {
    /** Whose codebase. Without it every area is read from scratch, as it always was. */
    projectId?: string;
    /** The one read, injectable so the rules around it can be tested without a model. */
    readArea?: typeof deepReadArea;
  } = {},
): Promise<{ caps: CapabilityEntry[]; recalled: string[] }> {
  const { projectId } = opts;
  const readArea = opts.readArea ?? deepReadArea;
  const recalled: string[] = [];
  const caps2 = await Promise.all(caps.map(async (c) => {
    const rereadMissing = c.status === "missing" && hasCandidateFiles(c.area, files);
    if (c.status !== "built" && c.status !== "partial" && !rereadMissing) return c;
    const detail = await readArea(ent, c, files, coverage, {
      dataShape, projectId, onRecall: (area) => recalled.push(area),
    });
    if (!detail) return c;
    if (c.status === "missing" && detail.present) {
      return {
        ...c,
        status: "partial" as const,
        detail,
        note: `The first pass called this missing from a digest of excerpts; a close read of the area's own files found it. ${c.note ? `${c.note} ` : ""}What follows is the close read.`,
      };
    }
    return { ...c, detail };
  }));
  return { caps: caps2, recalled };
}
