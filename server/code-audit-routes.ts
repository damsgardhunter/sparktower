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
import type { Express } from "express";
import OpenAI from "openai";
import { storage } from "./storage";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
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

const AUDIT_SCHEMA = `Respond ONLY with valid JSON (no markdown, no code fences):
{
  "stage": "empty" | "scaffold" | "prototype" | "mvp" | "beta" | "production",
  "completionPercent": 0-100,
  "summary": "3-5 sentences: what this codebase actually is, how far along it really is, and the single most important thing it's missing. Address the builder directly.",
  "stackSummary": "one sentence naming what it's built with",
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
  "nextThreeThings": ["the three highest-leverage things to do next, in order"],
  "operations": [ ... ]
}`;

export function registerCodeAuditRoutes(app: Express) {
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
  app.post("/api/projects/:id/code-audit/check-repo", isAuthenticated, async (req: any, res) => {
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

      const digest = buildCodeDigest(snapshot);

      // Charged only once the code is in hand — a repo that can't be fetched
      // costs nothing.
      if (!(await requireCredits(res, userId, CREDIT_COSTS.codeAudit, "a codebase audit"))) return;

      // --- the plan, for reconciliation ------------------------------------
      const [state, completions, milestones] = await Promise.all([
        /*
         * Without the previous audit. A fresh audit has to judge the code on
         * its own merits — handed its predecessor's verdict it anchors on it
         * and reproduces the old conclusion instead of reading what's there.
         * The history list is where comparisons belong.
         */
        buildOperableProjectState(projectId, { includeAudit: false }),
        storage.getProjectTaskCompletions(projectId, 40).catch(() => []),
        storage.getProjectMilestones(projectId).catch(() => []),
      ]);

      const completion = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [
          {
            role: "system",
            content: `You are Nova, auditing a builder's real codebase against the plan they've been working from. ${coachingDirectiveFor(ent)}

Your job is reconciliation, not code review. The plan says what they intend; the code says what exists. Where those disagree, the code wins and you say so.

Ground every claim in the digest. Cite file paths as evidence. If the digest doesn't show something, say it isn't there rather than assuming it is — and remember the digest is a partial view: it lists every file but only excerpts some, so absence of an excerpt is not absence of a file. Never invent a path.

Be specific and be honest. "No tests exist anywhere in the repository" is useful. "Consider adding tests" is not. If the project is further along than the board suggests, lead with that; if it's a scaffold with a README, say that plainly instead of being encouraging about it.

Judging progress:
- A route or page that exists and reads from real storage is built. A component with hardcoded sample data is partial.
- A capability in the plan with no matching file, route, model or dependency is missing.
- Something substantial in the code that the plan never mentions is worth flagging: it's either scope the builder forgot to write down, or work that isn't serving the goal.

For "operations", propose the changes that would make the board match the code: move tasks that are demonstrably finished to done, and create tasks for real gaps you found. Be conservative — only move a task to done when the evidence is unambiguous. Do not touch anything you're unsure about.

${OPERATION_SCHEMA_INSTRUCTIONS}

${AUDIT_SCHEMA}`,
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
              `THE ACTUAL CODEBASE\n${digest.prompt}`,
            ].join("\n\n"),
          },
        ],
      });

      let parsed: any;
      try {
        const raw = completion.choices[0].message.content || "{}";
        const match = raw.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(match ? match[0] : raw);
      } catch (err) {
        console.error("Code audit parse failed:", err);
        return res.status(502).json({ message: "Nova returned an unreadable audit. Please try again." });
      }

      const findings = {
        stackSummary: str(parsed.stackSummary, 400),
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

      const audit = await storage.createCodeAudit({
        projectId,
        createdById: userId,
        source: snapshot.source,
        sourceKind,
        stage: str(parsed.stage, 40) || "prototype",
        completionPercent: Math.max(0, Math.min(100, Math.round(Number(parsed.completionPercent) || 0))),
        summary: str(parsed.summary, 2000),
        signals: digest.signals as any,
        findings: findings as any,
        operations: (Array.isArray(parsed.operations) ? parsed.operations : []).slice(0, 60) as any,
      } as any);

      await storage.deductCredits(userId, CREDIT_COSTS.codeAudit);
      await storage.logActivity({
        projectId, userId,
        action: "ran a codebase audit",
        entityType: "project", entityId: projectId,
        metadata: { source: snapshot.source, stage: audit.stage },
      }).catch(() => {});

      res.json({ audit, creditsCharged: CREDIT_COSTS.codeAudit });
    } catch (error: any) {
      console.error("Code audit error:", error);
      // Ingest errors carry messages written for the user; keep them.
      const message = typeof error?.message === "string" && error.message.length < 400
        ? error.message
        : "The audit failed. Please try again.";
      res.status(400).json({ message });
    }
  });

  /**
   * Brings the board in line with the audit.
   *
   * Marked applied afterwards so the same audit can't be run twice, which
   * would re-create tasks it already created.
   */
  app.post("/api/code-audits/:auditId/apply", isAuthenticated, async (req: any, res) => {
    try {
      const audit = await storage.getCodeAudit(req.params.auditId);
      if (!audit) return res.status(404).json({ message: "Audit not found" });

      const userId = (req.user as any).id;
      if (!(await isMember(userId, audit.projectId))) return res.status(403).json({ message: "Unauthorized" });
      if (audit.appliedAt) {
        return res.status(409).json({ message: "This audit has already been applied. Run a new one to pick up changes since." });
      }

      const ent = await requireFeature(res, userId, "aiMilestones", "Nova codebase audits");
      if (!ent) return;

      const operations = audit.operations as unknown;
      if (!Array.isArray(operations) || !operations.length) {
        return res.status(400).json({ message: "This audit didn't propose any changes." });
      }

      const { changes, skipped } = await applyProjectOperations(audit.projectId, userId, operations, {
        canEditMilestones: ent.aiMilestones,
        canEditRoadmap: ent.roadmapUpdates,
        maxOperations: 80,
      });
      if (!changes.length) {
        return res.status(422).json({ message: "None of those changes could be applied.", skipped });
      }

      await storage.updateCodeAudit(audit.id, { appliedAt: new Date() } as any);
      res.json({ changes, skipped });
    } catch (error) {
      console.error("Code audit apply error:", error);
      res.status(500).json({ message: "Couldn't apply those changes" });
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
