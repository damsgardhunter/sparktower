/**
 * Nova's codebase audit.
 *
 * Answers one question the rest of the app cannot: *is the plan true?*
 * Milestones, tasks and MVP scope all describe intent. The repository is the
 * only record of what actually exists, so this ingests it, builds a
 * deterministic digest, and asks Nova to reconcile the two — then offers to
 * bring the board in line with reality through the same operations engine the
 * health check and Nova chat use.
 */
import { parseModelJson, answerUnreadable } from "./ai-json";
import type { Express, Response } from "express";
import OpenAI from "openai";
import { storage } from "./storage";
import { db } from "./db";
import { desc, eq, sql } from "drizzle-orm";
import { codeAuditRuns } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { requireCredits, requireFeature, modelFor, coachingDirectiveFor } from "./entitlements";
import { CREDIT_COSTS } from "@shared/plans";
import { formatProjectBriefForPrompt } from "@shared/project-sections";
import {
  applyProjectOperations, buildOperableProjectState, OPERATION_SCHEMA_INSTRUCTIONS,
} from "./project-operations";
import {
  parseGithubUrl, snapshotFromGithub, snapshotFromZip, MAX_ARCHIVE_BYTES,
  type RepoSnapshot,
} from "./code-ingest";
import { buildCodeDigest } from "./code-digest";
import { CAPABILITY_AREAS, sanitizeCapabilities } from "@shared/capabilities";
import { deepReadAll } from "./audit-deep-reads";
import { computeAuditDelta } from "@shared/audit-delta";
import { probeRuntime } from "./runtime-probe";
import { refreshDataShape, compareWithCode } from "./data-shape";
import { verifyMilestonesFromAudit } from "./phase-tree-verifiers";
import { refreshPace, loopsForAudit, renderLoopsForPrompt, backboneIdOf, renderPathForAudit } from "./phase-trees";
import {
  diffFileIndex, renderFileChanges, tidyCatchUp, summarizeCatchUp, describeOp, sameWork, SAFE_SECTIONS, CATCHUP_SECTIONS,
  type CatchUpSection, type AuditAutoApply,
} from "@shared/audit-catchup";
import { fetchCommitsSince } from "./code-ingest";
import { sanitizeLoopClosures } from "@shared/phase-trees";
import { rereadOpenLoops } from "./audit-loop-reads";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const raw = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const baseURL = raw ? (raw.endsWith("/v1") ? raw : `${raw.replace(/\/$/, "")}/v1`) : undefined;
    _openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL });
  }
  return _openai;
}

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const strList = (v: unknown, max = 20, len = 300): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, max) : [];

const SEVERITIES = ["low", "medium", "high"];

/** Loops that look like the same loop twice — which the catch-up should reconcile, not leave for the builder to notice. */
function duplicateLoops(loops: { key: string; taskId: string; title: string; type: string }[]): string | null {
  const pairs: string[] = [];
  for (let i = 0; i < loops.length; i++) for (let j = i + 1; j < loops.length; j++) {
    if (loops[i].type === loops[j].type && sameWork(loops[i].title, loops[j].title)) {
      pairs.push(`- ${loops[i].key} id=${loops[i].taskId} "${loops[i].title}" and ${loops[j].key} id=${loops[j].taskId} "${loops[j].title}"`);
    }
  }
  return pairs.length ? `POSSIBLE DUPLICATE LOOPS — the same cycle written twice; keep the better one and retire the other (or merge with update_loop)\n${pairs.join("\n")}` : null;
}

/** Short enough to read at a glance, and never cut mid-word: ends at the last full sentence that fits. */
export function clipToSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > max * 0.4 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

const AUDIT_SCHEMA = `Respond ONLY with valid JSON (no markdown, no code fences):
{
  "stage": "empty" | "scaffold" | "prototype" | "mvp" | "beta" | "production",
  "completionPercent": 0-100,
  "summary": "3-5 sentences: what this codebase actually is, how far along it really is, and the single most important thing it's missing. Address the builder directly.",
  "stackSummary": "one sentence naming what it's built with",
  "capabilities": [
    { "area": "auth" | "rateLimiting" | "moderation" | "payments" | "ai" | "analytics" | "data" | "tests" | "ci" | "deploy" | "mobile",
      "status": "built" | "partial" | "missing",
      "summary": "one or two sentences on what exists, using the code's own names",
      "evidence": [ { "file": "exact path from the digest", "route": "exact label from the route list, if one applies" } ],
      "missing": "for partial only: what still isn't there" }
  ],
  "built": [
    { "item": "a capability that demonstrably exists", "evidence": ["path/to/file.ts"] }
  ],
  "partial": [
    { "item": "", "exists": "what is there", "missing": "what still isn't", "evidence": ["path"] }
  ],
  "missing": [
    { "item": "something the plan calls for with no trace in the code", "matters": "one sentence on why it blocks progress" }
  ],
  "undocumented": [
    { "item": "something substantial in the code that appears nowhere in the plan", "evidence": ["path"] }
  ],
  "risks": [
    { "area": "e.g. Security, Testing, Data, Operability", "severity": "low"|"medium"|"high", "finding": "", "evidence": ["path"], "recommendation": "" }
  ],
  "taskReconciliation": {
    "looksDone": [ { "title": "an open task the code says is finished", "evidence": ["path"] } ],
    "notStarted": [ { "title": "a task marked done with no supporting code", "why": "" } ]
  },
  "milestones": [
    { "title": "", "verdict": "complete" | "in-progress" | "not-started", "why": "one sentence citing the code" }
  ],
  "loops": [
    { "key": "L1 — the key from THE BUSINESS'S LOOPS",
      "closure": "closed" | "open" | "not-built",
      "stages": [ { "step": "each step of the loop, in order", "status": "built" | "partial" | "missing", "evidence": ["exact path from the file tree"] } ],
      "returnPath": { "mechanism": "what brings the user (or the next user) back to the first step: the notification, email, feed item, share link, invite credit, renewal", "evidence": ["exact path"] },
      "breaksAt": "for open or not-built: the exact step where the cycle stops, and what's missing there",
      "fix": "for open or not-built: the concrete change that closes it" }
  ],
  "nextThreeThings": ["the three highest-leverage things to do next, in order"],
  "catchUpNote": "at most three short sentences, to the builder: what they've done since the last audit and where the project is heading now. Anything it says needs reconciling must also be in operations.",
  "operations": [ ... ]
}`;


/** The audit's system prompt, on its own so it can be exercised outside the route. */
export function auditSystemPrompt(ent: Parameters<typeof coachingDirectiveFor>[0]): string {
  return `You are Nova, auditing a builder's real codebase against the plan they've been working from. ${coachingDirectiveFor(ent)}

Your job is reconciliation, not code review. The plan says what they intend; the code says what exists. Where those disagree, the code wins and you say so.

Ground every claim in the digest. Cite file paths as evidence. If the digest doesn't show something, say it isn't there rather than assuming it is — and remember the digest is a partial view: it lists every file but only excerpts some, so absence of an excerpt is not absence of a file. Never invent a path.

Be specific and be honest. "No tests exist anywhere in the repository" is useful. "Consider adding tests" is not. If the project is further along than the board suggests, lead with that; if it's a scaffold with a README, say that plainly instead of being encouraging about it.

Judging progress:
- A route or page that exists and reads from real storage is built. A component with hardcoded sample data is partial.
- A capability in the plan with no matching file, route, model or dependency is missing.
- Something substantial in the code that the plan never mentions is worth flagging: it's either scope the builder forgot to write down, or work that isn't serving the goal.

THE CAPABILITY INVENTORY comes first and matters most. One entry for EVERY area listed below, no area skipped. "built" needs at least one file that is really in the digest's file tree and that you can see does the thing; "partial" says what exists and what is missing; "missing" means no file, route, model or dependency for it. Never cite a path that is not in the file tree, and never cite a route that is not in the route list — the inventory is validated against both and unsupported claims are downgraded. This is what every later plan reads to avoid re-proposing what exists, so it must be exact.
Areas and what counts:
${CAPABILITY_AREAS.map((a) => `- ${a.id} (${a.label}): ${a.counts}`).join("\n")}

THE LOOPS CHECK. If THE BUSINESS'S LOOPS are listed, report on EVERY one by its key (an empty "loops" array when none are listed). A loop is CLOSED only when the code carries a user through every step AND something in the code returns them — or the person they brought in — to the first step again: a notification or email that fires on the step's output, a feed that surfaces it, a share or invite link that lands a new user at the start, a subscription that renews on use. A sequence that works but ends is OPEN, and "breaksAt" names the step after which nothing brings anyone back. Judge each stage from the files: a route, a page and a table that really do the step is built; a UI with no write behind it is partial. Cite only paths in the file tree; "closed" without a cited file for every stage and for the return path will be downgraded to open. For every open or not-built loop, also propose one create-task operation titled "Close the <loop title> loop: <what's missing>".

CATCHING THE PROJECT UP. Builders work ahead: they ship features without writing tasks, change direction without touching the brief, finish work without moving the card. "operations" is the set of edits that brings the WHOLE project up to date with where the code shows it is and where it's heading — as briefly as possible:
- Start from WHAT CHANGED SINCE THE LAST AUDIT and THE COMMITS. That is what's new; the rest of the repo was already reconciled last time. On a first audit, work from the whole codebase.
- Shipped work nobody wrote down: ONE create_task with "status": "done" per FEATURE or piece of work a person would name ("Post pages with comments and reactions"), never one per file, route or commit. Put the evidence files in its description. At most 12; group smaller things into the feature they belong to. Never record something the board already has, in any wording — if the board has it open and the code shows it's finished, update_task it to done instead.
- Open tasks the code shows are finished: update_task to done. Only on unambiguous evidence.
- THE PATH is what the builder's dashboard shows, so keep it true. Open milestones the code shows are reached: complete_path_milestone with the evidence. Loop build steps the code shows are built: update_task to done by the step id. A loop being built through steps its list doesn't have: add_loop_steps, marking the built ones done.
- The brief, scope and tech stack: update_project / update_scope only where the code shows the project has moved — a new direction, a feature now core, a stack that changed, a live URL. Rewrite the field in the builder's voice; don't pad it.
- The core loops follow the product. When the code shows the product has changed direction — a loop now works differently, a new cycle has become central, an old one is gone — change them: update_loop to rewrite one (or change its kind), create_loop for a kind that isn't written, retire_loop for a loop the product no longer runs (never the last of its kind; rewrite that instead). Change a loop only on clear evidence in the code, say what changed in the steps, and never propose anything the builder REMOVED.
- THE BOARD MUST NOT CONTRADICT THE CODE OR THE BUILDER'S STANDING NOTES. When a task or loop build step is for something the code has removed or the standing notes say is retired, propose retire_task for it with the reason (for a whole loop, retire_loop). When a task is marked done but the code has no trace of it, propose update_task back to "todo" and list it under taskReconciliation.notStarted. These wait for the builder's OK, so propose them whenever the evidence is clear — naming the drift in a risk or note without these operations is a failed audit. Never retire a path milestone (a backbone: task).
- What's next: create_task for real gaps in the direction the builder is heading (at most 10), update_task where a task's scope changed. Milestones and roadmap phases only where they're plainly out of date.
- A note that names a problem with no operation for it is a failed audit. If catchUpNote says the direction needs reconciling — a loop that contradicts THE BUILDER'S STANDING NOTES, two loops that are the same loop (see POSSIBLE DUPLICATE LOOPS), a brief that describes a product the code has moved away from — operations must contain the edits that reconcile it: update_loop to rewrite, retire_loop to drop a duplicate or a dead loop, update_project for the brief.
- If nothing changed, return no operations. Never re-propose anything in DECLINED LAST TIME unless the code has changed in that exact area since.
- THE BUILDER'S STANDING NOTES override the code's suggestions about direction.

${OPERATION_SCHEMA_INSTRUCTIONS}

${AUDIT_SCHEMA}`;
}

/**
 * Everything the audit does once the code is in hand.
 *
 * Extracted from the route because the code can now arrive two ways: uploaded
 * or fetched by the web app, or handed over by an editor-side agent that
 * already has the working tree on disk. The second one is the interesting
 * case — it audits what the builder is actually looking at, uncommitted work
 * included, rather than the last thing they pushed. Both must produce the same
 * audit, so there is one of these and not two.
 *
 * The caller charges: `requireCredits` sits at each route, right after the
 * code is in hand, so the route table can still answer "what does this cost
 * and what stops it". This deducts on success.
 *
 * Takes `res` because the entitlement checks answer on it directly; throws
 * otherwise, and the caller's handler owns the error shape.
 */
// --- Runs: an audit while it's under way ---------------------------------------

/** A run older than this that never finished (a restart mid-audit) is over, not running. */
export const AUDIT_RUN_STALE_MS = 15 * 60_000;

export type AuditRunStage = "fetching" | "reading" | "saving";
export interface AuditRunHandle { id: string; stage: (s: AuditRunStage) => Promise<void>; finish: (outcome: { auditId?: string | null; error?: string | null }) => Promise<void> }

/** Records that an audit started, so everyone looking at the project can see it running. Never throws: tracking is not the audit. */
export async function startAuditRun(projectId: string, userId: string, source: string, stage: AuditRunStage = "fetching"): Promise<AuditRunHandle> {
  let id = "";
  try {
    const [row] = await db.insert(codeAuditRuns).values({ projectId, startedById: userId, source: source.slice(0, 200), stage }).returning({ id: codeAuditRuns.id });
    id = row.id;
  } catch (err) { console.error("[audit-run] couldn't record the start (non-fatal):", err); }
  let done = false;
  return {
    id,
    stage: async (s) => { if (id && !done) await db.update(codeAuditRuns).set({ stage: s }).where(eq(codeAuditRuns.id, id)).catch(() => {}); },
    finish: async ({ auditId = null, error = null }) => {
      if (!id || done) return;
      done = true;
      await db.update(codeAuditRuns).set({ finishedAt: new Date(), auditId, error: error ? error.slice(0, 400) : null }).where(eq(codeAuditRuns.id, id)).catch(() => {});
    },
  };
}

/** What's running on a project now, and how the last run ended. */
export async function auditRunStatus(projectId: string) {
  // Ages are worked out by the database: its timestamps read back into JS are off by the server's timezone.
  const rows = await db.select({
    run: codeAuditRuns,
    ageSeconds: sql<number>`extract(epoch from (now() - ${codeAuditRuns.startedAt}))::int`,
  }).from(codeAuditRuns).where(eq(codeAuditRuns.projectId, projectId)).orderBy(desc(codeAuditRuns.startedAt)).limit(5);
  const runningRow = rows.find((r) => !r.run.finishedAt && Number(r.ageSeconds) * 1000 < AUDIT_RUN_STALE_MS) ?? null;
  const running = runningRow?.run ?? null;
  const last = rows.find((r) => r.run.finishedAt)?.run ?? null;
  const starter = running ? await storage.getUser(running.startedById).catch(() => undefined) : undefined;
  return {
    running: running ? {
      id: running.id, source: running.source, stage: running.stage, startedAt: running.startedAt,
      startedBy: starter ? { id: starter.id, firstName: starter.firstName ?? null } : null,
      elapsedSeconds: Math.max(0, Number(runningRow!.ageSeconds)),
    } : null,
    last: last ? { id: last.id, source: last.source, finishedAt: last.finishedAt, auditId: last.auditId, error: last.error } : null,
  };
}

export async function runCodeAudit(opts: {
  projectId: string;
  userId: string;
  project: any;
  ent: Awaited<ReturnType<typeof requireFeature>> & {};
  res: Response;
  snapshot: RepoSnapshot;
  sourceKind: "github" | "upload" | "worktree";
  repoMeta: Awaited<ReturnType<typeof import("./code-ingest").fetchRepoMeta>> | null;
  /** Used for this request only, to read commits since the last audit. Never stored. */
  githubToken?: string;
  /** The run the route started before fetching the code; one is started here when absent. */
  run?: AuditRunHandle;
}): Promise<Response | void> {
  const run = opts.run ?? await startAuditRun(opts.projectId, opts.userId, opts.snapshot.source, "reading");
  let auditId: string | null = null;
  try {
    await run.stage("reading");
    const result = await runCodeAuditInner({ ...opts, onSaved: (id) => { auditId = id; }, onStage: run.stage });
    await run.finish(auditId ? { auditId } : { error: opts.res.statusCode >= 400 ? "Nova's read of the code couldn't be used. Try again." : "The audit didn't finish." });
    return result;
  } catch (err: any) {
    await run.finish({ error: typeof err?.message === "string" ? err.message : "The audit failed." });
    throw err;
  }
}

async function runCodeAuditInner(opts: Parameters<typeof runCodeAudit>[0] & { onSaved: (auditId: string) => void; onStage: (s: AuditRunStage) => Promise<void> }): Promise<Response | void> {
  const { projectId, userId, project, ent, res, snapshot, sourceKind, repoMeta } = opts;
  const digest = buildCodeDigest(snapshot);
  // What's new since last time, from the code itself: fingerprints, and the builder's commit messages.
  const previous = await storage.getLatestCodeAudit(projectId).catch(() => undefined);
  const fileChanges = diffFileIndex((previous?.signals as any)?.fileIndex, digest.signals.fileIndex ?? {});
  const since = previous ? new Date(previous.createdAt) : null;
  const branch = snapshot.source.match(/@([^@]+)$/)?.[1] ?? repoMeta?.defaultBranch ?? "main";
  const commits = sourceKind === "github" && repoMeta && since ? await fetchCommitsSince(repoMeta.fullName, branch, since, opts.githubToken) : [];
  const declined = ((previous?.operations as any[]) ?? []).filter((o) => o?._status === "declined").map((o) => describeOp(o)).slice(0, 40);

  // --- the plan, for reconciliation ------------------------------------
  const [state, completions, milestones, loopRead] = await Promise.all([
    /*
     * Without the previous audit. A fresh audit has to judge the code on
     * its own merits — handed its predecessor's verdict it anchors on it
     * and reproduces the old conclusion instead of reading what's there.
     * The history list is where comparisons belong.
     */
    buildOperableProjectState(projectId, { includeAudit: false }),
    storage.getProjectTaskCompletions(projectId, 40).catch(() => []),
    storage.getProjectMilestones(projectId).catch(() => []),
    loopsForAudit(projectId).catch(() => null),
  ]);
  const pathText = await renderPathForAudit(projectId).catch(() => null);
  const auditLoops = loopRead?.loops.filter((l) => l.description || l.status === "done") ?? [];

  const completion = await getOpenAI().chat.completions.create({
    model: modelFor(ent),
    messages: [
      {
        role: "system",
        content: auditSystemPrompt(ent),
      },
      {
        role: "user",
        content: [
          `THE PLAN\n${formatProjectBriefForPrompt(project)}`,
          `MILESTONE COUNT: ${milestones.length}`,
          completions.length
            ? `TASKS THE BUILDER HAS ALREADY COMPLETED (${completions.length})\n${completions.slice(0, 30).map((c) => `- ${c.title}`).join("\n")}`
            : "TASKS ALREADY COMPLETED\nNone recorded.",
          `CURRENT BOARD AND PLAN STATE (use these ids for operations)\n${state}`,
          auditLoops.length
            ? `THE BUSINESS'S LOOPS (check each one closes in the code; ids are for update_loop)\n${renderLoopsForPrompt(auditLoops)}\n${auditLoops.map((l) => `${l.key} id=${l.taskId}`).join(", ")}`
            : "THE BUSINESS'S LOOPS\nNone written yet.",
          duplicateLoops(auditLoops),
          loopRead?.coverage.missing.length || loopRead?.coverage.unwritten.length
            ? `LOOP KINDS NOT WRITTEN YET: ${[...(loopRead?.coverage.missing ?? []), ...(loopRead?.coverage.unwritten ?? [])].join(", ")}`
            : null,
          pathText,
          renderFileChanges(fileChanges, since ? since.toISOString().slice(0, 10) : null),
          commits.length ? `THE COMMITS SINCE THEN (${commits.length}, newest first)\n${commits.slice(0, 60).map((c) => `- ${c.message}`).join("\n")}` : null,
          declined.length ? `DECLINED LAST TIME — the builder chose not to apply these; don't propose them again\n${declined.map((d) => `- ${d}`).join("\n")}` : null,
          `THE ACTUAL CODEBASE\n${digest.prompt}`,
        ].filter(Boolean).join("\n\n"),
      },
    ],
  });

  let parsed: any;
  try {
    parsed = parseModelJson(completion.choices[0].message.content, "audit");
  } catch (err) {
    return answerUnreadable(res, err, "audit");
  }

  // The live database, when the owner has said where it is, read before
  // the second reads so "built but unused" can be judged from rows.
  let dataShape = await refreshDataShape(projectId).catch(() => null);
  if (dataShape && !dataShape.error) dataShape = compareWithCode(dataShape, digest.signals.dataModels);

  // Second reads: one narrow question per built or partial area, against
  // the full text of its evidence files and the exact route coverage.
  // Independent and fault-tolerant; a failed read leaves the first-pass
  // verdict, which is honest.
  const capabilities = await deepReadAll(
    ent,
    sanitizeCapabilities(parsed.capabilities, {
      files: new Set(snapshot.files.map((f) => f.path)),
      routes: new Set(digest.signals.routes.map((r) => r.label)),
    }),
    snapshot.files,
    digest.signals.routeCoverage,
    dataShape,
  );
  const findings = {
    stackSummary: str(parsed.stackSummary, 400),
    capabilities,
    built: (Array.isArray(parsed.built) ? parsed.built : []).slice(0, 30).map((b: any) => ({
      item: str(b?.item, 300), evidence: strList(b?.evidence, 8, 200),
    })).filter((b: any) => b.item),
    partial: (Array.isArray(parsed.partial) ? parsed.partial : []).slice(0, 25).map((b: any) => ({
      item: str(b?.item, 300), exists: str(b?.exists, 400),
      missing: str(b?.missing, 400), evidence: strList(b?.evidence, 8, 200),
    })).filter((b: any) => b.item),
    missing: (Array.isArray(parsed.missing) ? parsed.missing : []).slice(0, 30).map((b: any) => ({
      item: str(b?.item, 300), matters: str(b?.matters, 400),
    })).filter((b: any) => b.item),
    undocumented: (Array.isArray(parsed.undocumented) ? parsed.undocumented : []).slice(0, 20).map((b: any) => ({
      item: str(b?.item, 300), evidence: strList(b?.evidence, 6, 200),
    })).filter((b: any) => b.item),
    risks: (Array.isArray(parsed.risks) ? parsed.risks : []).slice(0, 20).map((r: any) => ({
      area: str(r?.area, 80),
      severity: SEVERITIES.includes(r?.severity) ? r.severity : "medium",
      finding: str(r?.finding, 800),
      evidence: strList(r?.evidence, 6, 200),
      recommendation: str(r?.recommendation, 600),
    })).filter((r: any) => r.finding),
    taskReconciliation: {
      looksDone: (Array.isArray(parsed.taskReconciliation?.looksDone) ? parsed.taskReconciliation.looksDone : [])
        .slice(0, 30).map((t: any) => ({ title: str(t?.title, 200), evidence: strList(t?.evidence, 6, 200) }))
        .filter((t: any) => t.title),
      notStarted: (Array.isArray(parsed.taskReconciliation?.notStarted) ? parsed.taskReconciliation.notStarted : [])
        .slice(0, 30).map((t: any) => ({ title: str(t?.title, 200), why: str(t?.why, 400) }))
        .filter((t: any) => t.title),
    },
    milestones: (Array.isArray(parsed.milestones) ? parsed.milestones : []).slice(0, 25).map((m: any) => ({
      title: str(m?.title, 200),
      verdict: ["complete", "in-progress", "not-started"].includes(m?.verdict) ? m.verdict : "not-started",
      why: str(m?.why, 400),
    })).filter((m: any) => m.title),
    /** Whether each written loop closes in the code, held to cited files — open ones read again, closely. */
    loops: await rereadOpenLoops(ent, auditLoops, sanitizeLoopClosures(parsed.loops, auditLoops, new Set(snapshot.files.map((f) => f.path))), snapshot.files, digest.signals.routes),
    nextThreeThings: strList(parsed.nextThreeThings, 5, 400),
    /** Scan facts the builder should see even if the model ignored them. */
    scan: {
      fileCount: digest.signals.fileCount,
      readCount: digest.signals.readCount,
      linesOfCode: digest.signals.linesOfCode,
      languages: digest.signals.languages,
      stack: digest.signals.stack,
      routeCount: digest.signals.routes.length,
      routes: digest.signals.routes.slice(0, 60),
      dataModels: digest.signals.dataModels.slice(0, 40),
      testFiles: digest.signals.testFiles,
      testFrameworks: digest.signals.testFrameworks,
      hasCi: digest.signals.hasCi,
      hasDocker: digest.signals.hasDocker,
      hasReadme: digest.signals.hasReadme,
      hasEnvExample: digest.signals.hasEnvExample,
      envVarCount: digest.signals.envVarNames.length,
      todoCount: digest.signals.todoCount,
      consoleCount: digest.signals.consoleCount,
      suspectedSecrets: digest.signals.suspectedSecrets,
      authSignals: digest.signals.authSignals,
      dependencyCount: digest.signals.dependencyCount,
      truncated: snapshot.truncated,
      skipped: snapshot.skipped,
    },
    repo: repoMeta,
  };

  // The catch-up: the audit's edits, down to what's new and worth doing.
  const board = await storage.getProjectKanbanTasks(projectId).catch(() => []);
  const tidied = tidyCatchUp(parsed.operations, {
    project,
    tasks: board.map((t) => ({ id: t.id, title: t.title, status: t.status, tags: t.tags })),
    loops: (loopRead?.loops ?? []).map((l) => ({ id: l.taskId, title: l.title, description: l.description, type: l.type, steps: l.steps })),
    rejectedLoops: project.rejectedLoops ?? [],
    pathDone: new Set(board.filter((t) => t.status === "done").map((t) => backboneIdOf(t.tags)).filter(Boolean) as string[]),
    declined,
  });
  (findings as any).catchUp = {
    note: clipToSentence(str(parsed.catchUpNote, 2000), 900),
    summary: summarizeCatchUp(tidied.operations),
    since: since?.toISOString() ?? null,
    files: fileChanges ? { added: fileChanges.added.length, modified: fileChanges.modified.length, removed: fileChanges.removed.length } : null,
    commits: { count: commits.length, recent: commits.slice(0, 8).map((c) => c.message) },
    dropped: tidied.dropped,
    applied: [] as string[],
  };

  // The snapshot's velocity and its runtime, alongside what the code contains.
  const runtime = await probeRuntime({ liveUrl: project.liveUrl, envVarNames: digest.signals.envVarNames });
  const completionPercent = Math.max(0, Math.min(100, Math.round(Number(parsed.completionPercent) || 0)));
  const delta = computeAuditDelta(previous ?? null, { id: "pending", createdAt: new Date(), completionPercent, signals: digest.signals, findings });

  await opts.onStage("saving");
  const audit = await storage.createCodeAudit({
    projectId,
    createdById: userId,
    source: snapshot.source,
    sourceKind,
    stage: str(parsed.stage, 40) || "prototype",
    completionPercent,
    summary: str(parsed.summary, 2000),
    signals: digest.signals as any,
    findings: findings as any,
    delta: delta as any,
    runtime: runtime as any,
    dataShape: dataShape as any,
    operations: tidied.operations as any,
  } as any);

  // What the builder lets an audit do on its own: record finished work, or everything.
  const mode = ((project.auditAutoApply as AuditAutoApply | undefined) ?? "safe");
  const autoSections = mode === "all" ? CATCHUP_SECTIONS.map((x) => x.id) : mode === "safe" ? [...SAFE_SECTIONS] : [];
  const autoApplied = autoSections.length && tidied.operations.some((o) => autoSections.includes(o._section))
    ? await applyAuditSections(audit.id, userId, ent, autoSections, { declineOthers: false }).catch((e) => { console.error("[audit] auto-apply failed:", e); return null; })
    : null;

  // Code that moved is activity, and a few milestones are verified by what the audit saw.
  const verified = await verifyMilestonesFromAudit(projectId, { id: audit.id, signals: digest.signals, findings, runtime }).catch((e) => { console.error("[audit] verifiers failed:", e); return { verified: [], marked: [] }; });
  if (delta.changed) await refreshPace(projectId, { taskId: audit.id, backboneId: null, title: `Audit: +${delta.routes.added.length} routes, +${delta.tables.added.length} tables since ${delta.daysSince}d ago`, estimateMinutes: null, actualMinutes: null }).catch(() => {});

  await storage.deductCredits(userId, CREDIT_COSTS.codeAudit);
  await storage.logActivity({
    projectId, userId,
    action: "ran a codebase audit",
    entityType: "project", entityId: projectId,
    metadata: { source: snapshot.source, stage: audit.stage },
  }).catch(() => {});

  opts.onSaved(audit.id);
  res.json({
    audit: autoApplied ? await storage.getCodeAudit(audit.id) : audit,
    creditsCharged: CREDIT_COSTS.codeAudit, verifiedMilestones: verified,
    autoApplied: autoApplied ? { changes: autoApplied.changes.map((c) => c.description), skipped: autoApplied.skipped } : null,
  });
}

/**
 * Applying an audit's catch-up, a section at a time. Each edit is marked
 * applied as it goes; with `declineOthers`, the pending ones outside the chosen
 * sections are marked declined — which is how the next audit knows not to
 * propose them again. The audit counts as applied once nothing is pending.
 */
export async function applyAuditSections(
  auditId: string, userId: string, ent: { aiMilestones?: boolean; roadmapUpdates?: boolean },
  sections: readonly string[], opts: { declineOthers: boolean },
) {
  const audit = await storage.getCodeAudit(auditId);
  if (!audit) throw Object.assign(new Error("Audit not found"), { status: 404 });
  const ops = ((audit.operations as any[]) ?? []).map((o) => ({ ...o }));
  const pending = (o: any) => !o._status || o._status === "pending";
  const changes: Awaited<ReturnType<typeof applyProjectOperations>>["changes"] = [];
  const skipped: string[] = [];
  /*
   * One edit at a time, so each is marked with what really happened to it. As
   * a batch, an edit the engine skipped (a loop kind already written, a task
   * that's gone) was marked applied along with the rest — and the card said
   * the project was up to date when part of it wasn't.
   */
  for (const o of ops) {
    if (!pending(o)) continue;
    if (!sections.includes(o._section ?? "plan")) {
      if (opts.declineOthers) o._status = "declined";
      continue;
    }
    const { _section, _status, _label, _reason, ...op } = o;
    const r = await applyProjectOperations(audit.projectId, userId, [op], {
      canEditMilestones: ent.aiMilestones, canEditRoadmap: ent.roadmapUpdates, maxOperations: 1, source: "audit",
    });
    changes.push(...r.changes);
    if (r.changes.length) o._status = "applied";
    else { o._status = "skipped"; o._reason = r.skipped[0] ?? "Nothing changed."; skipped.push(`${o._label ?? op.op}: ${o._reason}`); }
  }
  const findings = (audit.findings as any) ?? {};
  if (findings.catchUp) {
    findings.catchUp.applied = [...(findings.catchUp.applied ?? []), ...changes.map((c) => c.description)].slice(-200);
    findings.catchUp.skipped = [...(findings.catchUp.skipped ?? []), ...skipped].slice(-100);
  }
  await storage.updateCodeAudit(audit.id, {
    operations: ops, findings,
    ...(ops.some(pending) ? {} : { appliedAt: new Date() }),
  } as any);
  if (changes.length) await refreshPace(audit.projectId).catch(() => {});
  return { changes, skipped };
}

export function registerCodeAuditRoutes(app: Express) {
  /**
   * Whether an audit is running on the project right now — started here, from
   * the editor bridge or by a teammate — with its stage, and how the last one
   * ended. Cheap enough to poll every few seconds.
   */
  app.get("/api/projects/:id/code-audit/status", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Unauthorized" });
      res.json(await auditRunStatus(req.params.id));
    } catch (error) {
      console.error("Audit status error:", error);
      res.status(500).json({ message: "Couldn't read the audit status" });
    }
  });

  /** Audits on record, newest first. Bodies trimmed for the list view. */
  app.get("/api/projects/:id/code-audits", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isMember(userId, req.params.id))) return res.status(403).json({ message: "Unauthorized" });
      const audits = await storage.getCodeAudits(req.params.id);
      res.json(audits.map((a) => ({
        id: a.id, source: a.source, sourceKind: a.sourceKind,
        stage: a.stage, completionPercent: a.completionPercent,
        summary: a.summary, appliedAt: a.appliedAt, createdAt: a.createdAt,
        operationCount: Array.isArray(a.operations) ? (a.operations as unknown[]).length : 0,
      })));
    } catch (error) {
      console.error("List code audits error:", error);
      res.status(500).json({ message: "Failed to load audits" });
    }
  });

  app.get("/api/code-audits/:auditId", isAuthenticated, async (req: any, res) => {
    try {
      const audit = await storage.getCodeAudit(req.params.auditId);
      if (!audit) return res.status(404).json({ message: "Audit not found" });
      if (!(await isMember((req.user as any).id, audit.projectId))) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      res.json(audit);
    } catch (error) {
      res.status(500).json({ message: "Failed to load that audit" });
    }
  });

  /**
   * Checks a repository is reachable before the builder commits credits to it.
   *
   * A typo'd URL or a private repo without a token should cost nothing and say
   * so plainly, rather than failing halfway through a paid audit.
   */
  app.post("/api/projects/:id/code-audit/check-repo", isAuthenticated, rateLimit("external"), async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isMember(userId, req.params.id))) return res.status(403).json({ message: "Unauthorized" });

      const { repoUrl, token } = req.body as { repoUrl?: string; token?: string };
      const ref = parseGithubUrl(str(repoUrl, 400));
      if (!ref) {
        return res.status(400).json({ message: "That doesn't look like a GitHub repository URL." });
      }

      const { fetchRepoMeta } = await import("./code-ingest");
      const meta = await fetchRepoMeta(ref, token?.trim() || undefined);
      res.json({ ok: true, ...meta, ref: ref.ref || meta.defaultBranch });
    } catch (error: any) {
      // The message from fetchRepoMeta is written for the user.
      res.status(400).json({ message: error?.message || "Couldn't reach that repository." });
    }
  });

  /**
   * Runs the audit.
   *
   * Source is either a GitHub repository or a zip the builder already uploaded
   * through the normal object-storage flow. A token for a private repository is
   * used for this request and never stored.
   */
  app.post("/api/projects/:id/code-audit", isAuthenticated, async (req: any, res) => {
    // metering: checked here; charged in runCodeAudit only after the audit is parsed and saved (test/unit/ai-metering.test.ts holds the helper to the same order)
    let run: AuditRunHandle | undefined;
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;
      if (!(await isMember(userId, projectId))) return res.status(403).json({ message: "Unauthorized" });

      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const ent = await requireFeature(res, userId, "aiMilestones", "Nova codebase audits");
      if (!ent) return;

      const { repoUrl, token, objectPath, fileName } = req.body as {
        repoUrl?: string; token?: string; objectPath?: string; fileName?: string;
      };
      if (!objectPath && !repoUrl) return res.status(400).json({ message: "Give Nova a GitHub repository or a zip to audit." });
      // Visible from the start: fetching a big repository is the slow part.
      run = await startAuditRun(projectId, userId, objectPath ? `upload:${str(fileName, 120) || "archive.zip"}` : `github:${str(repoUrl, 200).replace(/^https?:\/\/(www\.)?github\.com\//, "")}`, "fetching");

      // --- ingest ----------------------------------------------------------
      let snapshot: RepoSnapshot;
      let sourceKind: "github" | "upload";
      let repoMeta: Awaited<ReturnType<typeof import("./code-ingest").fetchRepoMeta>> | null = null;

      if (objectPath) {
        sourceKind = "upload";
        if (!objectPath.startsWith("/objects/")) {
          return res.status(400).json({ message: "That doesn't look like an uploaded file." });
        }
        const { ObjectStorageService } = await import("./replit_integrations/object_storage");
        let file: { buffer: Buffer; size: number };
        try {
          file = await new ObjectStorageService().readObjectBuffer(objectPath, MAX_ARCHIVE_BYTES);
        } catch (err: any) {
          console.error("Audit upload read failed:", err?.message || err);
          return res.status(400).json({ message: "We couldn't read that upload. Try uploading it again." });
        }
        snapshot = snapshotFromZip(file.buffer, `upload:${str(fileName, 120) || "archive.zip"}`);
      } else if (repoUrl) {
        sourceKind = "github";
        const ref = parseGithubUrl(str(repoUrl, 400));
        if (!ref) return res.status(400).json({ message: "That doesn't look like a GitHub repository URL." });
        const result = await snapshotFromGithub(ref, token?.trim() || undefined);
        snapshot = result.snapshot;
        repoMeta = result.meta;
      } else {
        return res.status(400).json({ message: "Give Nova a GitHub repository or a zip to audit." });
      }

      // Charged only once the code is in hand — a repo that can't be fetched
      // costs nothing. Kept at the route rather than inside the run, so what
      // this endpoint costs and what stops it is readable from the route table.
      if (!(await requireCredits(res, userId, CREDIT_COSTS.codeAudit, "a codebase audit"))) { await run?.finish({ error: "Not enough credits for an audit." }); return; }

      await runCodeAudit({ projectId, userId, project, ent, res, snapshot, sourceKind, repoMeta, githubToken: token?.trim() || undefined, run });
    } catch (error: any) {
      console.error("Code audit error:", error);
      // Ingest errors carry messages written for the user; keep them.
      const message = typeof error?.message === "string" && error.message.length < 400
        ? error.message
        : "The audit failed. Please try again.";
      await run?.finish({ error: message });
      if (!res.headersSent) res.status(400).json({ message });
    } finally {
      // Any early return after the run started (a bad upload, a URL that isn't GitHub) ends it too.
      if (run && res.statusCode >= 400) await run.finish({ error: "The audit didn't start." });
    }
  });

  /**
   * Brings the project in line with the audit: the sections the builder chose
   * (all pending ones when none are named). Pending edits outside a named
   * choice are declined, and the next audit won't propose them again.
   */
  app.post("/api/code-audits/:auditId/apply", isAuthenticated, rateLimit("external"), async (req: any, res) => {
    try {
      const audit = await storage.getCodeAudit(req.params.auditId);
      if (!audit) return res.status(404).json({ message: "Audit not found" });

      const userId = (req.user as any).id;
      if (!(await isMember(userId, audit.projectId))) return res.status(403).json({ message: "Unauthorized" });
      const operations = audit.operations as any[];
      const pending = (Array.isArray(operations) ? operations : []).filter((o) => !o?._status || o._status === "pending");
      if (!pending.length) {
        return res.status(409).json({ message: "Nothing from this audit is waiting. Run a new one to pick up changes since." });
      }

      const ent = await requireFeature(res, userId, "aiMilestones", "Nova codebase audits");
      if (!ent) return;

      const named = Array.isArray(req.body?.sections) ? req.body.sections.map(String).filter((x: string) => CATCHUP_SECTIONS.some((c) => c.id === x)) : null;
      const sections = named ?? CATCHUP_SECTIONS.map((c) => c.id);
      const { changes, skipped } = await applyAuditSections(audit.id, userId, ent, sections, { declineOthers: !!named });
      if (!changes.length && pending.some((o) => sections.includes(o._section ?? "plan"))) {
        return res.status(422).json({ message: "None of those changes could be applied.", skipped });
      }
      res.json({ changes, skipped });
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message });
      console.error("Code audit apply error:", error);
      res.status(500).json({ message: "Couldn't apply those changes" });
    }
  });

  /** What an audit may change on its own for this project. */
  app.put("/api/projects/:id/audit-settings", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isMember(userId, req.params.id))) return res.status(403).json({ message: "Unauthorized" });
      const mode = String(req.body?.autoApply ?? "");
      if (!(["all", "safe", "off"] as const).includes(mode as AuditAutoApply)) {
        return res.status(400).json({ message: "autoApply must be all, safe or off.", code: "invalid_input", field: "autoApply" });
      }
      await storage.updateProject(req.params.id, { auditAutoApply: mode } as any);
      res.json({ autoApply: mode });
    } catch (error) {
      console.error("Audit settings error:", error);
      res.status(500).json({ message: "Couldn't save that" });
    }
  });

  app.delete("/api/code-audits/:auditId", isAuthenticated, async (req: any, res) => {
    try {
      const audit = await storage.getCodeAudit(req.params.auditId);
      if (!audit) return res.status(404).json({ message: "Audit not found" });
      if (!(await isMember((req.user as any).id, audit.projectId))) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      await storage.deleteCodeAudit(audit.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete that audit" });
    }
  });
}

async function isMember(userId: string, projectId: string): Promise<boolean> {
  const project = await storage.getProject(projectId);
  if (!project) return false;
  if (project.ownerId === userId) return true;
  const members = await storage.getProjectMembers(projectId).catch(() => []);
  return members.some((m) => m.userId === userId);
}
