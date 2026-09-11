/**
 * The editor bridge: Nova's side of the conversation with an agent that has
 * the working tree.
 *
 * The split this enforces, everywhere below: **Nova owns the plan, the path,
 * the artifacts and the verification; the editor-side agent owns the reading
 * and the editing.** Nothing here returns file contents for someone to write
 * out, and nothing here accepts a patch to apply. Nova hands back
 * specifications and verdicts; the agent hands back evidence.
 *
 * That's not modesty about what a server can do — it's where the information
 * is. The agent is sitting in the tree with a language server, a test runner
 * and the user's approval prompts. Nova has the plan, the history, and the
 * only defensible answer to "is this milestone actually done". Making the
 * server do the editing would mean working from a stale partial copy of a
 * tree someone else is already in.
 *
 * Every route is token-authenticated (`requireMcpToken`), member-checked, and
 * covered by the `mcp` kill switch mounted in routes.ts — so the whole bridge
 * can be turned off without touching the app it reads from.
 */
import type { Express, Response } from "express";
import { storage } from "./storage";
import { requireMcpToken, mintToken, listTokens, revokeToken } from "./mcp-tokens";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { requireCredits, requireFeature } from "./entitlements";
import { CREDIT_COSTS } from "@shared/plans";
import { NOVA_MCP_TOOLS, NOVA_MCP_INSTRUCTIONS, MCP_SNAPSHOT_LIMITS } from "@shared/mcp";
import {
  pathStatus, milestoneDetail, pathTaskContext, latestWork, saveWork, collectArtifacts,
  reconcileMilestones, refreshPace, chooseWork, createLoop, deleteLoop, createExpansion, expansionSource,
} from "./phase-trees";
import { workKindFor, resolveTree } from "@shared/phase-trees";
import { produceWork, draftExpansionSteps, draftArtifact } from "./phase-trees-nova";
import { buildOperableProjectState, applyProjectOperations } from "./project-operations";
import { snapshotFromFiles } from "./code-ingest";
import { buildCodeDigest } from "./code-digest";
import { probeRuntime } from "./runtime-probe";
import { VERIFIERS, verifyMilestonesFromAudit } from "./phase-tree-verifiers";
import { runCodeAudit } from "./code-audit-routes";
import { novaSuggest, validateNovaAsk } from "./nova-assist-routes";

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

async function isMember(userId: string, projectId: string): Promise<boolean> {
  const project = await storage.getProject(projectId);
  if (!project) return false;
  if (project.ownerId === userId) return true;
  const members = await storage.getProjectMembers(projectId).catch(() => []);
  return members.some((m) => m.userId === userId);
}

/** Membership, resolved once per request, with the project it resolved. */
async function member(req: any, res: Response) {
  const userId = req.user.id as string;
  const projectId = String(req.params.projectId);
  const project = await storage.getProject(projectId);
  if (!project || !(await isMember(userId, projectId))) {
    // Same answer for "doesn't exist" and "not yours": a token shouldn't be
    // able to map which project ids are real.
    res.status(404).json({ message: "No such project, or this token can't see it.", code: "no_project" });
    return null;
  }
  return { userId, projectId, project };
}

/** Files as the agent sent them, refused early if the request is obviously too big to be a source tree. */
function takeFiles(res: Response, raw: unknown): { path?: unknown; content?: unknown }[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    res.status(400).json({ message: "Send the files as an array of { path, content }.", code: "invalid_input", field: "files" });
    return null;
  }
  if (raw.length > MCP_SNAPSHOT_LIMITS.maxFiles) {
    res.status(413).json({
      message: `That's ${raw.length} files, over the ${MCP_SNAPSHOT_LIMITS.maxFiles} limit. Skip dependencies and build output — Nova ignores them anyway.`,
      code: "too_many_files",
    });
    return null;
  }
  return raw as { path?: unknown; content?: unknown }[];
}

/**
 * Whether this path works in loops, read from the tree rather than from what
 * exists yet.
 *
 * `pathStatus.loopTree` is built around the loops a project actually has, so
 * it is null until the first one is written — which made an empty ship-an-MVP
 * project look like a path that doesn't do loops at all, and left an agent
 * with nowhere to put the first one. The structure is in the authored tree and
 * doesn't depend on anyone having answered anything.
 */
function loopShape(project: { goal: string; subcategory: string }) {
  const all = resolveTree(project.goal as any, project.subcategory).flatMap((p) => p.milestones);
  const fanOut = all.find((m) => m.expandsFrom);
  if (!fanOut?.expandsFrom) return null;
  return {
    fanOutId: fanOut.id,
    fanOutTitle: fanOut.title,
    sourceId: fanOut.expandsFrom,
    sourceTitle: all.find((m) => m.id === fanOut.expandsFrom)?.title ?? "The core loop",
  };
}

/** Six loops is already a lot for one month; the cap lives in createLoop. */
const LOOP_CAP = 6;

export function registerMcpRoutes(app: Express) {
  // --- token management, from the web app ---------------------------------
  /*
   * These are the only routes in the file that use a session rather than a
   * token: a token can't be allowed to mint another token, or revoking the
   * leaked one wouldn't be the end of it.
   */
  app.get("/api/mcp-tokens", isAuthenticated, async (req: any, res) => {
    try {
      res.json({ tokens: await listTokens(req.user.id) });
    } catch (error) {
      console.error("MCP token list error:", error);
      res.status(500).json({ message: "Couldn't read your tokens" });
    }
  });

  app.post("/api/mcp-tokens", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const label = str(req.body?.label, 80);
      if (!label) return res.status(400).json({ message: "Give the token a name so you'll recognise it later.", code: "invalid_input", field: "label" });

      const projectId = str(req.body?.projectId, 64) || null;
      if (projectId && !(await isMember(req.user.id, projectId))) {
        return res.status(403).json({ message: "You're not a member of that project." });
      }
      const days = Number(req.body?.expiresInDays);
      const minted = await mintToken(req.user.id, {
        label, projectId,
        expiresInDays: Number.isFinite(days) && days > 0 ? Math.min(days, 365) : null,
      });
      // The one and only time the full token is returned. Said plainly,
      // because a user who assumes they can look it up again will lose it.
      res.status(201).json({ ...minted, notice: "Copy this now — it isn't shown again." });
    } catch (error) {
      console.error("MCP token mint error:", error);
      res.status(500).json({ message: "Couldn't create that token" });
    }
  });

  app.delete("/api/mcp-tokens/:id", isAuthenticated, async (req: any, res) => {
    try {
      const done = await revokeToken(req.user.id, req.params.id);
      res.json({ revoked: done });
    } catch (error) {
      console.error("MCP token revoke error:", error);
      res.status(500).json({ message: "Couldn't revoke that token" });
    }
  });

  // --- the bridge ----------------------------------------------------------
  app.use("/api/mcp", requireMcpToken);

  /**
   * What this Nova offers.
   *
   * The shim registers whatever comes back rather than a list compiled into
   * it, so a new tool ships with a deploy instead of an npm release and an
   * upgrade nobody performs. It doubles as the token check the shim runs at
   * startup, which is why it answers with who the token belongs to.
   */
  app.get("/api/mcp/manifest", async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.id).catch(() => null);
      res.json({
        version: 1,
        instructions: NOVA_MCP_INSTRUCTIONS,
        tools: NOVA_MCP_TOOLS,
        limits: MCP_SNAPSHOT_LIMITS,
        account: { userId: req.user.id, email: user?.email ?? null },
        /** Set when the token is pinned; the shim can default every call to it. */
        pinnedProjectId: req.mcpToken?.projectId ?? null,
      });
    } catch (error) {
      console.error("MCP manifest error:", error);
      res.status(500).json({ message: "Couldn't read the manifest" });
    }
  });

  app.get("/api/mcp/projects", async (req: any, res) => {
    try {
      const all = await storage.getUserProjects(req.user.id);
      const pinned = req.mcpToken?.projectId;
      const visible = pinned ? all.filter((p) => p.id === pinned) : all;
      res.json({
        projects: visible.map((p) => ({
          id: p.id, title: p.title, goal: p.goal, subcategory: p.subcategory,
          oneLiner: p.oneLiner ?? null, liveUrl: p.liveUrl ?? null, createdAt: p.createdAt,
        })),
      });
    } catch (error) {
      console.error("MCP projects error:", error);
      res.status(500).json({ message: "Couldn't read your projects" });
    }
  });

  /**
   * Where the project is, trimmed for an agent.
   *
   * The dashboard's `pathStatus` carries every milestone of every phase
   * because it draws a map. An agent needs the next action and enough
   * surrounding shape to talk about it; handing it the whole tree spends its
   * context on milestones it will never reach this session.
   */
  app.get("/api/mcp/projects/:projectId/status", async (req: any, res) => {
    try {
      const ctx = await member(req, res); if (!ctx) return;
      const status = await pathStatus(ctx.projectId);
      if (!status) return res.status(404).json({ message: "No such project.", code: "no_project" });
      if (!status.adopted) {
        return res.json({
          adopted: false, goal: status.goal, promise: status.promise,
          message: "This project isn't on a path yet. Someone needs to adopt one in SparkTower first — Nova builds the tree from the roadmap and reads what's already done.",
        });
      }
      const next = status.next;
      res.json({
        adopted: true,
        goal: status.goal, subcategory: status.subcategory, promise: status.promise, target: status.target,
        phase: status.current,
        phases: status.phases.map((p) => ({ id: p.id, title: p.title, done: p.done, total: p.total, optional: p.optional })),
        progress: status.mainLine,
        pace: status.pace ? {
          mode: status.pace.mode, state: status.pace.state, note: status.pace.note,
          projectedAt: status.pace.projectedAt, projectedLow: status.pace.projectedLow, projectedHigh: status.pace.projectedHigh,
        } : null,
        plan: status.plan,
        next: next ? {
          backboneId: next.id,
          title: next.title,
          description: next.description,
          // The actor is the load-bearing field for an agent: it says whether
          // this step is one it may act on at all.
          actor: next.step?.actor ?? next.actor,
          tier: next.tier,
          estimateMinutes: next.estimateMinutes,
          workTaskId: next.workTaskId,
          step: next.step ? { taskId: next.step.taskId, title: next.step.title, description: next.step.description } : null,
          /*
           * The loops behind this milestone, when it has any. Carried on the
           * next step rather than left to a separate call because on the
           * core-loop milestone they *are* the work — reading "define your
           * core loop" without being handed the loops is reading half of it.
           */
          loops: next.loops.map((l) => ({
            taskId: l.taskId, title: l.title, description: l.description,
            status: l.status, expanded: l.expanded,
          })),
          work: next.work ? { id: next.work.id, kind: next.work.kind, payload: next.work.payload, createdAt: next.work.createdAt } : null,
        } : null,
        complete: status.mainLine.done === status.mainLine.total,
      });
    } catch (error) {
      console.error("MCP status error:", error);
      res.status(500).json({ message: "Couldn't read the path" });
    }
  });

  /**
   * The whole tree: every phase, every milestone, and the state of each.
   *
   * `status` is trimmed because an agent pays for its context and only ever
   * acts on the next step. A sidebar draws the map, so it needs the map — and
   * needs it in one call, because a tree that fetches per expanded phase is a
   * tree that feels slow the first time someone opens three of them.
   */
  app.get("/api/mcp/projects/:projectId/phases", async (req: any, res) => {
    try {
      const ctx = await member(req, res); if (!ctx) return;
      const status = await pathStatus(ctx.projectId);
      if (!status) return res.status(404).json({ message: "No such project.", code: "no_project" });
      if (!status.adopted) return res.json({ adopted: false, phases: [] });

      res.json({
        adopted: true,
        currentPhaseId: status.current.id,
        nextBackboneId: status.next?.id ?? null,
        phases: status.phases.map((p) => ({
          id: p.id, title: p.title, optional: p.optional, checkpoint: p.checkpoint,
          done: p.done, total: p.total,
          milestones: p.milestones.map((m) => ({
            id: m.id, title: m.title, description: m.description,
            actor: m.actor, tier: m.tier, estimateMinutes: m.estimateMinutes,
            done: m.done, taskId: m.taskId, taskStatus: m.taskStatus, steps: m.steps,
          })),
          injected: p.injected,
        })),
      });
    } catch (error) {
      console.error("MCP phases error:", error);
      res.status(500).json({ message: "Couldn't read the path" });
    }
  });

  app.get("/api/mcp/projects/:projectId/milestones/:backboneId", async (req: any, res) => {
    try {
      const ctx = await member(req, res); if (!ctx) return;
      const detail = await milestoneDetail(ctx.projectId, String(req.params.backboneId));
      if (!detail) return res.status(404).json({ message: "That milestone isn't on this project's path.", code: "not_on_path" });
      res.json(detail);
    } catch (error) {
      console.error("MCP milestone error:", error);
      res.status(500).json({ message: "Couldn't read that milestone" });
    }
  });

  // --- loops ---------------------------------------------------------------
  //
  // A product's loops are the thing week 1 turns on: the sequence someone
  // actually repeats. They're not milestones, so none of the endpoints above
  // reach them — which meant an agent parked on the core-loop milestone could
  // read what it was being asked for and had no way to do any of it.

  /**
   * The loops, and how far each has got.
   *
   * `state` is the useful field: unwritten (a name and nothing else), written
   * (the sequence is described), planned/building/built (it has steps, and how
   * many are done). Whoever is helping needs to know which of those they're
   * looking at before proposing anything.
   */
  app.get("/api/mcp/projects/:projectId/loops", async (req: any, res) => {
    try {
      const ctx = await member(req, res); if (!ctx) return;
      const shape = loopShape(ctx.project);
      if (!shape) {
        // The funding and systemising trees have no fan-out milestone. Saying
        // so beats an empty list, which reads as "none yet".
        return res.json({ adopted: true, supported: false, loops: [], message: "This path doesn't work in loops." });
      }
      const status = await pathStatus(ctx.projectId);
      if (!status?.adopted) return res.json({ adopted: false, supported: true, loops: [] });

      const tree = status.loopTree;
      res.json({
        adopted: true,
        supported: true,
        ...shape,
        loops: tree?.loops ?? [],
        unassigned: tree?.unassigned ?? [],
        /** Titles the builder has already said aren't loops. Proposing them again is the mistake to avoid. */
        rejected: status.rejectedLoops,
        remaining: Math.max(0, LOOP_CAP - (tree?.loops.length ?? 0)),
      });
    } catch (error) {
      console.error("MCP loops error:", error);
      res.status(500).json({ message: "Couldn't read the loops" });
    }
  });

  app.post("/api/mcp/projects/:projectId/loops", rateLimit("post"), async (req: any, res) => {
    try {
      const ctx = await member(req, res); if (!ctx) return;
      const shape = loopShape(ctx.project);
      if (!shape) return res.status(400).json({ message: "This path doesn't work in loops.", code: "not_expandable" });
      const loop = await createLoop(ctx.projectId, str(req.body?.sourceId, 40) || shape.sourceId, {
        title: str(req.body?.title, 120),
        description: str(req.body?.description, 4000),
      });
      res.json({ taskId: loop.id, title: loop.title, description: loop.description ?? "" });
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code, field: error.field });
      console.error("MCP loop create error:", error);
      res.status(500).json({ message: "Couldn't add that loop" });
    }
  });

  /**
   * "Not a loop."
   *
   * Remembered, not just deleted: the title goes on the project's rejected
   * list so the next read doesn't propose it again under slightly different
   * words. Finished steps stay on the board as work that happened.
   */
  app.delete("/api/mcp/projects/:projectId/loops/:taskId", rateLimit("post"), async (req: any, res) => {
    try {
      const ctx = await member(req, res); if (!ctx) return;
      res.json(await deleteLoop(ctx.projectId, String(req.params.taskId)));
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code });
      console.error("MCP loop delete error:", error);
      res.status(500).json({ message: "Couldn't remove that loop" });
    }
  });

  /**
   * Breaking one loop into the steps that build it.
   *
   * Two branches, and which one runs depends on whether the loop has been
   * written up. With a description, Nova reads steps out of it. Without one
   * there is nothing to expand from — so rather than refusing, `draft: true`
   * has Nova write the sequence from the project and hand it back to edit.
   * Confirming sends it as `artifact`, which lands on the loop and becomes
   * what the steps are built from.
   */
  app.post("/api/mcp/projects/:projectId/loops/:taskId/steps", async (req: any, res) => {
    try {
      const ctx = await member(req, res); if (!ctx) return;
      const loopTaskId = String(req.params.taskId);
      const shape = loopShape(ctx.project);
      if (!shape) return res.status(400).json({ message: "This path doesn't break loops into steps.", code: "not_expandable" });

      const src = await expansionSource(ctx.projectId, shape.fanOutId, { loopTaskId, artifact: req.body?.artifact });

      if (!src.written) {
        if (req.body?.draft !== true) {
          return res.status(400).json({
            message: `Nothing is written under "${src.sourceTitle}" yet. Ask Nova to draft it (draft: true), or write the sequence into the loop yourself.`,
            code: "artifact_missing", sourceTitle: src.sourceTitle, loopTaskId,
          });
        }
        const ent = await requireCredits(res, ctx.userId, CREDIT_COSTS.novaGuide, "Nova drafting your loop");
        if (!ent) return;
        const state = await buildOperableProjectState(ctx.projectId, { includeIds: false, includeAudit: true });
        const draft = await draftArtifact(ent, {
          title: `The ${src.source!.title} loop`,
          description: "The 3–5 step sequence that delivers value in this loop.",
        }, state);
        await storage.deductCredits(ctx.userId, CREDIT_COSTS.novaGuide);
        // A draft, not a decision: it comes back for a person to edit and
        // send again, and nothing is written until they do.
        return res.json({ draft, sourceTitle: src.sourceTitle, loopTaskId, applied: false });
      }

      const ent = await requireCredits(res, ctx.userId, CREDIT_COSTS.taskAssist, "Nova breaking a loop into steps");
      if (!ent) return;
      if (src.source && str(req.body?.artifact, 4000)) {
        await storage.updateKanbanTask(src.source.id, { description: src.written } as any);
      }
      const steps = await draftExpansionSteps(ent, `${src.milestone.title} — ${src.source!.title}`, src.written);
      if (!steps.length) return res.status(502).json({ message: "Nova couldn't read steps out of that. Try adding a line or two." });
      const result = await createExpansion(ctx.projectId, shape.fanOutId, steps, { loopTaskId });
      await storage.deductCredits(ctx.userId, CREDIT_COSTS.taskAssist);
      res.json({
        applied: true,
        created: result.created.map((t: any) => ({ taskId: t.id, title: t.title, description: t.description ?? "", estimateHours: t.estimateHours })),
        // Already expanded: the existing steps come back rather than a second set.
        existing: result.existing.map((t: any) => ({ taskId: t.id, title: t.title, status: t.status })),
      });
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code });
      console.error("MCP loop steps error:", error);
      res.status(500).json({ message: "Couldn't break that loop into steps" });
    }
  });

  /**
   * Nova works the task and hands back the packet.
   *
   * The same call the app's own path UI makes, over a different transport —
   * so what the agent implements is what the builder would have seen in the
   * product, not a second, thinner Nova invented for editors.
   */
  app.post("/api/mcp/projects/:projectId/work", async (req: any, res) => {
    try {
      const ctx = await member(req, res); if (!ctx) return;
      const { userId, projectId, project } = ctx;

      let taskId = str(req.body?.taskId, 64);
      if (!taskId) {
        const status = await pathStatus(projectId);
        taskId = status?.adopted ? status.next?.workTaskId ?? "" : "";
        if (!taskId) return res.status(400).json({ message: "There's no next task on this path to work on.", code: "no_task" });
      }
      const taskCtx = await pathTaskContext(projectId, taskId);
      if (!taskCtx) return res.status(400).json({ message: "That task isn't on this project's path.", code: "not_on_path" });

      // Already worked. Handing back the existing packet rather than paying
      // for another one: an agent that retries shouldn't cost credits.
      const existing = await latestWork(taskCtx.task.id);
      if (existing && req.body?.fresh !== true) {
        return res.json({ id: existing.id, kind: existing.kind, payload: existing.payload, actor: taskCtx.actor, reused: true });
      }

      const ent = await requireCredits(res, userId, CREDIT_COSTS.taskAssist, "Nova working on a milestone");
      if (!ent) return;

      const [state, artifacts] = await Promise.all([
        buildOperableProjectState(projectId, { includeIds: false, includeAudit: true }),
        collectArtifacts(projectId),
      ]);
      const all = await storage.getProjectKanbanTasks(projectId);
      const loops = all
        .filter((t) => t.tags?.includes("kind:loop") && !t.tags.some((x) => x.startsWith("archived:")))
        .map((t) => ({ title: t.title, description: t.description ?? "", status: t.status }));

      const payload = await produceWork(
        ent, workKindFor(taskCtx.actor),
        { title: taskCtx.task.title, description: taskCtx.task.description ?? taskCtx.milestone?.description ?? "", tier: taskCtx.tier },
        { goal: taskCtx.project.goal, subcategory: taskCtx.project.subcategory, state, artifacts, loops, rejectedLoops: project.rejectedLoops ?? [] },
      );
      const row = await saveWork(projectId, taskCtx.task.id, payload);
      await storage.deductCredits(userId, CREDIT_COSTS.taskAssist);
      res.json({ id: row.id, kind: row.kind, payload: row.payload, actor: taskCtx.actor, reused: false, creditsCharged: CREDIT_COSTS.taskAssist });
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code });
      console.error("MCP work error:", error);
      res.status(502).json({ message: "Nova couldn't finish that. Try again in a moment." });
    }
  });

  /**
   * The packet already on a task, without paying for another one.
   *
   * The bridge's read side needs this because a UI is not a conversation: it
   * redraws, it reopens, and a person clicks the same milestone twice. An
   * agent gets the current packet free with the status; anything else has to
   * be able to ask for one by task without that costing a credit.
   */
  app.get("/api/mcp/projects/:projectId/work/:taskId", async (req: any, res) => {
    try {
      const ctx = await member(req, res); if (!ctx) return;
      const taskCtx = await pathTaskContext(ctx.projectId, String(req.params.taskId));
      if (!taskCtx) return res.status(404).json({ message: "That task isn't on this project's path.", code: "not_on_path" });
      const w = await latestWork(taskCtx.task.id);
      res.json({
        work: w ? { id: w.id, kind: w.kind, payload: w.payload, chosenIndex: w.chosenIndex, createdAt: w.createdAt } : null,
        actor: taskCtx.actor, tier: taskCtx.tier,
        task: { id: taskCtx.task.id, title: taskCtx.task.title, status: taskCtx.task.status },
      });
    } catch (error) {
      console.error("MCP work read error:", error);
      res.status(500).json({ message: "Couldn't read that work" });
    }
  });

  /**
   * The builder's answer to a packet: an option picked, or their own words.
   *
   * The same call the app's path UI makes. Note what it means for a build
   * packet — choosing records *what was built*, which is the artifact the rest
   * of the path reads. Whether the code is any good is still a separate
   * question, and `verify` is still the one that answers it.
   */
  app.post("/api/mcp/projects/:projectId/work/:workId/choose", rateLimit("post"), async (req: any, res) => {
    try {
      const ctx = await member(req, res); if (!ctx) return;
      const result = await chooseWork(ctx.projectId, String(req.params.workId), {
        index: Number.isInteger(req.body?.index) ? Number(req.body.index) : undefined,
        text: typeof req.body?.text === "string" ? req.body.text.slice(0, 8000) : undefined,
        done: req.body?.done,
      });
      res.json({ taskId: result.task.id, status: result.task.status, answer: result.answer });
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code });
      console.error("MCP choose error:", error);
      res.status(500).json({ message: "Couldn't save that" });
    }
  });

  /**
   * The agent's record of what it changed.
   *
   * Deliberately does not close the task. An agent reporting its own work as
   * complete is the failure this whole design exists to avoid: it would be
   * marking a milestone done on the strength of having tried. What it writes
   * here becomes the task's answer, which later Nova steps read; what makes
   * it *done* is verification, and that's the next route.
   */
  app.post("/api/mcp/projects/:projectId/submit", rateLimit("post"), async (req: any, res) => {
    try {
      const ctx = await member(req, res); if (!ctx) return;
      const taskId = str(req.body?.taskId, 64);
      const summary = str(req.body?.summary, 4000);
      if (!taskId) return res.status(400).json({ message: "Say which task this belongs to.", code: "invalid_input", field: "taskId" });
      if (!summary) return res.status(400).json({ message: "Say what you changed.", code: "invalid_input", field: "summary" });

      const taskCtx = await pathTaskContext(ctx.projectId, taskId);
      if (!taskCtx) return res.status(400).json({ message: "That task isn't on this project's path.", code: "not_on_path" });

      const files = (Array.isArray(req.body?.files) ? req.body.files : [])
        .map((f: any) => str(f?.path, 300)).filter(Boolean).slice(0, 200);
      const commit = str(req.body?.commit, 80);
      const notes = str(req.body?.notes, 2000);

      const record = [
        summary,
        files.length ? `\nFiles: ${files.join(", ")}` : "",
        commit ? `\nCommit: ${commit}` : "",
        notes ? `\nNotes: ${notes}` : "",
        `\n— reported from the editor, ${new Date().toISOString().slice(0, 10)}. Not verified.`,
      ].join("");

      const existing = (taskCtx.task.description ?? "").trim();
      const authored = (taskCtx.milestone?.description ?? "").trim();
      // Replace the authored boilerplate, append to a real answer: two
      // sessions on one task should read as two entries, not as the second
      // erasing the first.
      const description = !existing || existing === authored ? record : `${existing}\n\n${record}`;
      await storage.updateKanbanTask(taskCtx.task.id, { description } as any);

      res.json({
        recorded: true, taskId: taskCtx.task.id, tier: taskCtx.tier,
        next: taskCtx.tier === "verified"
          ? "This tier needs evidence from the code. Call nova_verify with the tree and Nova will decide whether it's done."
          : "Nova has the record. Completion for this tier is the builder's call — ask them before calling nova_mark.",
      });
    } catch (error) {
      console.error("MCP submit error:", error);
      res.status(500).json({ message: "Couldn't record that" });
    }
  });

  /**
   * Verification, from the working tree, deterministically.
   *
   * The rule from `phase-tree-verifiers.ts` holds here: Nova marks done only
   * what it can see for itself, and never un-marks — an audit that can't see
   * something is not proof it isn't there. What it can't prove comes back as
   * unproven with the reason, which is more useful to an agent than a bare
   * refusal, and honest in a way "the agent said so" isn't.
   *
   * Free, and no model call, so it can run after every change. The capability
   * inventory it leans on for two of the verifiers comes from the last full
   * audit, and is reported as such — stale capability data is exactly the kind
   * of thing that should be visible rather than quietly load-bearing.
   */
  app.post("/api/mcp/projects/:projectId/verify", rateLimit("post"), async (req: any, res) => {
    try {
      const ctx = await member(req, res); if (!ctx) return;
      const files = takeFiles(res, req.body?.files); if (!files) return;

      const snapshot = snapshotFromFiles(files, "worktree:verify");
      const digest = buildCodeDigest(snapshot);
      const runtime = await probeRuntime({ liveUrl: ctx.project.liveUrl, envVarNames: digest.signals.envVarNames }).catch(() => null);

      const lastAudit = await storage.getLatestCodeAudit(ctx.projectId).catch(() => undefined);
      const auditLike = {
        id: `tree:${Date.now()}`,
        signals: digest.signals,
        // Capabilities are a model's reading, not something the digest yields,
        // so they can only come from a real audit.
        findings: { capabilities: (lastAudit?.findings as any)?.capabilities ?? [] },
        runtime,
      };

      const { verified, marked } = await verifyMilestonesFromAudit(ctx.projectId, auditLike);

      // The same verifiers, run again for the report. Cheap, and it means the
      // agent is told why something didn't pass rather than just that it didn't.
      const tree = resolveTree(ctx.project.goal as any, ctx.project.subcategory);
      const onPath = new Set(tree.flatMap((p) => p.milestones).map((m) => m.id));
      const checks = Object.entries(VERIFIERS)
        .filter(([id]) => onPath.has(id))
        .map(([id, check]) => {
          const evidence = check(auditLike as any);
          return {
            backboneId: id,
            proven: !!evidence,
            evidence: evidence ?? null,
            markedNow: marked.includes(id),
          };
        });

      res.json({
        scanned: { files: snapshot.files.length, read: digest.signals.readCount, truncated: snapshot.truncated },
        verified, marked, checks,
        capabilitiesFrom: lastAudit ? { auditId: lastAudit.id, at: lastAudit.createdAt } : null,
        note: lastAudit
          ? "Verifiers that read the capability inventory used the last full audit. Run nova_audit if the codebase has moved a long way since."
          : "No full audit on this project yet, so capability-based milestones can't be proven. Run nova_audit for those.",
      });
    } catch (error) {
      console.error("MCP verify error:", error);
      res.status(500).json({ message: "Couldn't verify against that tree" });
    }
  });

  /**
   * The full audit, from the tree the builder is actually looking at.
   *
   * The interesting difference from the web app's version: this sees
   * uncommitted work. An audit of the last push judges a repository the
   * builder may have moved a long way past.
   */
  app.post("/api/mcp/projects/:projectId/audit", async (req: any, res) => {
    try {
      const ctx = await member(req, res); if (!ctx) return;
      const files = takeFiles(res, req.body?.files); if (!files) return;

      const ent = await requireFeature(res, ctx.userId, "aiMilestones", "Nova codebase audits");
      if (!ent) return;

      const snapshot = snapshotFromFiles(files, `worktree:${str(req.body?.label, 120) || "working tree"}`);
      // Charged once the tree is in hand, as on the web route.
      if (!(await requireCredits(res, ctx.userId, CREDIT_COSTS.codeAudit, "a codebase audit"))) return;

      await runCodeAudit({
        projectId: ctx.projectId, userId: ctx.userId, project: ctx.project, ent, res,
        snapshot, sourceKind: "worktree", repoMeta: null,
      });
    } catch (error: any) {
      console.error("MCP audit error:", error);
      const message = typeof error?.message === "string" && error.message.length < 400 ? error.message : "The audit failed. Please try again.";
      res.status(400).json({ message });
    }
  });

  app.post("/api/mcp/projects/:projectId/ask", async (req: any, res) => {
    try {
      const ctx = await member(req, res); if (!ctx) return;
      const input = {
        surface: str(req.body?.surface, 40),
        ask: str(req.body?.ask, 2000),
        entityId: str(req.body?.entityId, 64) || undefined,
      };
      const config = validateNovaAsk(input, res);
      if (!config) return;

      const ent = await requireFeature(res, ctx.userId, "aiMilestones", "Nova's assistant");
      if (!ent) return;
      if (!(await requireCredits(res, ctx.userId, CREDIT_COSTS.novaAssist, `Nova's help with ${config.label.toLowerCase()}`))) return;

      await novaSuggest(ctx.projectId, ctx.userId, input, ent, config, res);
    } catch (error) {
      console.error("MCP ask error:", error);
      res.status(500).json({ message: "Nova couldn't help with that" });
    }
  });

  app.post("/api/mcp/projects/:projectId/apply", rateLimit("post"), async (req: any, res) => {
    try {
      const ctx = await member(req, res); if (!ctx) return;
      const ent = await requireFeature(res, ctx.userId, "aiMilestones", "Nova's assistant");
      if (!ent) return;

      const operations = req.body?.operations;
      if (!Array.isArray(operations) || !operations.length) {
        return res.status(400).json({ message: "There's nothing to apply.", code: "invalid_input", field: "operations" });
      }
      const { changes, skipped } = await applyProjectOperations(ctx.projectId, ctx.userId, operations, {
        canEditMilestones: ent.aiMilestones,
        canEditRoadmap: ent.roadmapUpdates,
        maxOperations: 80,
      });
      if (!changes.length) return res.status(422).json({ message: "None of that could be applied.", skipped });
      res.json({ changes, skipped });
    } catch (error) {
      console.error("MCP apply error:", error);
      res.status(500).json({ message: "Couldn't apply that" });
    }
  });

  /**
   * The builder's own word, relayed.
   *
   * Recorded as `builder` rather than `nova`, so the map keeps showing the
   * difference between what was verified and what someone said. An agent
   * calling this on its own initiative is misuse — hence the tool description
   * saying so, and the evidence string being required to mean something.
   */
  app.post("/api/mcp/projects/:projectId/mark", rateLimit("post"), async (req: any, res) => {
    try {
      const ctx = await member(req, res); if (!ctx) return;
      const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map((i: unknown) => str(i, 40)).filter(Boolean).slice(0, 40) : [];
      if (!ids.length) return res.status(400).json({ message: "Say which milestones.", code: "invalid_input", field: "ids" });

      const evidence = str(req.body?.evidence, 600) || "marked done from the editor";
      const { marked } = await reconcileMilestones(ctx.projectId, ids.map((id) => ({ id, evidence })), "builder");
      if (marked.length) await refreshPace(ctx.projectId).catch(() => {});
      res.json({ marked, ignored: ids.filter((id) => !marked.includes(id)) });
    } catch (error) {
      console.error("MCP mark error:", error);
      res.status(500).json({ message: "Couldn't mark that" });
    }
  });
}
