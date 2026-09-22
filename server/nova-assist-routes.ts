/**
 * One Nova action endpoint, shared by every surface.
 *
 * The alternative was a bespoke AI route per tab — one for milestones, one for
 * interviews, one for pricing — each with its own prompt, its own parsing and
 * its own drift. Instead the surface is a parameter: it selects the guidance
 * and the extra context, and everything else (the operations vocabulary, the
 * preview-then-apply flow, the id scoping, the credit accounting) is shared.
 *
 * Every surface is preview-first. Nova proposes, the builder reads it, and
 * nothing is written until they say yes — the same contract as the task
 * planner and the health-check fixes.
 */
import type { Express, Response } from "express";
import OpenAI from "openai";
import { storage } from "./storage";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { requireCredits, requireFeature, modelFor, coachingDirectiveFor, type UserEntitlements } from "./entitlements";
import { CREDIT_COSTS , CHARGEABLE} from "@shared/plans";
import { formatProjectBriefForPrompt } from "@shared/project-sections";
import {
  applyProjectOperations, buildOperableProjectState, renderLatestAudit,
  stripIdFragments, collectProjectIds, OPERATION_SCHEMA_INSTRUCTIONS,
  parseOperation, knownIdsFor,
} from "./project-operations";
import { describeOp } from "@shared/audit-catchup";
import { applyOperationsOnce, idempotencyKeyFor } from "./operation-idempotency";
import { NOVA_SURFACES, type NovaSurfaceId, type NovaSurfaceConfig } from "@shared/nova-surfaces";
import { parseModelJson, respondToAiError } from "./ai-json";
import { rateLimit } from "./moderation";
import { packFor } from "@shared/nova-prompt-packs";
import { firstPlanFor } from "./nova-first-plan";

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

/** Per-surface prompt guidance. The part that actually differs. */
const SURFACE_GUIDANCE: Record<NovaSurfaceId, string> = {
  milestones: `You are working on this project's MILESTONES.

A milestone is a checkpoint with an observable definition of done — not a phase of work and not a task. Good: "50 builders have posted a second project update". Bad: "Build the feed".

Create milestones with create_milestone and give each a real definition of done in its description. Attach the tasks that serve it with update_task's milestoneId. Set target dates only when the project's own dates justify one; an invented deadline is worse than none.`,

  roadmap: `You are working on this project's ROADMAP.

You may reword phases, sharpen their outcomes and correct their status with update_phase, and turn a phase into a milestone with create_milestone. You cannot create or delete phases — generating a roadmap is a separate, deliberate action the builder takes.

An outcome is a finished thing that can be pointed at, with a number where a number sharpens it.`,

  research: `You are working on this project's CUSTOMER RESEARCH.

Interviews and experiments are for reducing a specific uncertainty, so start from the riskiest assumption in the brief and design backwards from it.

For interviews (create_interview): name the ROLE to talk to rather than inventing a person, and put the actual questions in "notes", one per line. Questions must be about past behaviour, not hypotheticals — "tell me about the last time you abandoned a side project" beats "would you use this".

For experiments (create_experiment): the hypothesis has to be falsifiable, and "metrics" must name the number and the threshold that decides it. An experiment with no failure condition isn't an experiment.`,

  strategy: `You are working on this project's STRATEGY and INVESTOR READINESS.

Be the sceptical reader. An investor's first question is always the one the plan avoids, so name that question and what would answer it.

Where the strategy needs a decision recorded, write it into the brief with update_project. Where it needs work done, create tasks. Where a claim needs evidence, create the interview or experiment that would produce it.

Do not invent traction, market sizes or comparables. If a number is needed and you don't have it, say what it is and how the builder should get it.`,

  pricing: `You are working on this project's PRICING.

Price against the value to the target customer and what comparable products charge, not against cost. Say your reasoning for each number.

Propose tiers with create_pricing_tier: usually three, each with a clear reason to exist and a reason to upgrade. Features are short benefit phrases, not feature dumps. Mark one tier featured only if it's genuinely the one most people should pick.

If the brief doesn't establish who the customer is well enough to price for them, say so — that's the finding — and propose the work that would settle it.`,

  analytics: `You are working on this project's MEASUREMENT.

Define the smallest set of events that would tell the builder whether the product works, mapped to the success metrics already in the brief. Every event must map to a decision someone would actually make.

Where instrumentation is missing, create the tasks to add it. Where the brief's success metrics are vague, sharpen them with update_project.`,

  tasks: `You are working on this project's TASK BOARD.

Every task gets a whole-hour estimate a real person could hit, ordered so prerequisites come first. Between 5 and 10 tasks per milestone — more than that is a backlog, not a plan.`,
};

export interface NovaAsk { surface?: string; ask?: string; entityId?: string }

/**
 * Checks an ask before anything is spent on it. Answers on `res` and returns
 * null when it's no good, so a caller reads as `if (!config) return`.
 *
 * Separate from the call below so both callers can validate first and charge
 * second — an unknown surface or an empty ask shouldn't cost a credit or a
 * slot in the per-minute budget.
 */
export function validateNovaAsk(input: NovaAsk, res: Response): NovaSurfaceConfig | null {
  const config = NOVA_SURFACES[input.surface as NovaSurfaceId];
  if (!config) {
    res.status(400).json({ message: `Unknown surface. Expected one of: ${Object.keys(NOVA_SURFACES).join(", ")}.` });
    return null;
  }
  if (!input.ask?.trim()) {
    res.status(400).json({ message: "Tell Nova what you want help with." });
    return null;
  }
  if (input.ask.length > 2000) {
    res.status(400).json({ message: "That's a lot to ask at once — trim it down." });
    return null;
  }
  return config;
}

/**
 * Nova's proposal for one surface. Writes nothing — the operations come back
 * for a person to look at, and `applyProjectOperations` is what commits them.
 *
 * A function rather than a route body because the editor bridge asks the same
 * question over its own transport. The two callers differ in how they
 * authenticate and in nothing else, and a second copy of this prompt would
 * start telling a different Nova to the one in the app within a release.
 *
 * The entitlement and the credit check are the caller's, deliberately: a
 * guard that only appears three files deep is one the route coverage can't
 * see, and "which routes cost money and what stops them" is a question that
 * has to be answerable from the route table.
 */
export async function novaSuggest(
  projectId: string,
  userId: string,
  input: NovaAsk,
  ent: UserEntitlements,
  config: NovaSurfaceConfig,
  res: Response,
): Promise<Response | void> {
  const project = await storage.getProject(projectId);
  if (!project) return res.status(404).json({ message: "Project not found" });

  const { surface, ask, entityId } = input;

  const extra = await buildSurfaceContext(projectId, surface as NovaSurfaceId);
  const [state, auditText] = await Promise.all([
    buildOperableProjectState(projectId),
    renderLatestAudit(projectId),
  ]);

  const completion = await getOpenAI().chat.completions.create({
    model: modelFor(ent),
    messages: [
      {
        role: "system",
        content: `You are Nova, working alongside a builder inside SparkTower. ${coachingDirectiveFor(ent)}

${SURFACE_GUIDANCE[surface as NovaSurfaceId]}

Rules that always apply:
- Ground everything in this project's real details. Never invent a metric, a date, a customer name or a funding number.
- Propose the smallest set of changes that actually helps. Ten mediocre items is worse than three good ones.
- Respect what exists. Update rather than duplicate.
- If a CODEBASE AUDIT appears in the context, it is the evidence for what's already built and it overrides the board.
- If the ask is outside this surface, say so in "summary", return no operations, and point them at the right place rather than doing it badly here.
- Never put an id in "summary" or in any "label"/"detail" text. Refer to things by title.

${OPERATION_SCHEMA_INSTRUCTIONS}

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "summary": "2-4 sentences: what you're proposing and why it's the right next move here.",
  "items": [
{ "label": "one line naming the change", "detail": "one or two sentences of reasoning" }
  ],
  "operations": [ ... ]
}
"items" must describe the same changes as "operations", in the same order, so the builder can read the plan before applying it.`,
      },
      {
        role: "user",
        content: [
          `WHAT THE BUILDER ASKED FOR\n${(ask ?? "").trim()}`,
          `SURFACE: ${config.label}`,
          entityId ? `THEY HAVE THIS SELECTED: ${entityId}` : null,
          `PROJECT BRIEF\n${formatProjectBriefForPrompt(project)}`,
          extra,
          auditText,
          `CURRENT STATE (use these ids for operations)\n${state}`,
        ].filter(Boolean).join("\n\n"),
      },
    ],
  });

  let parsed: any;
  try {
    const raw = completion.choices[0].message.content ?? "";
    parsed = parseModelJson(raw);
  } catch (err) {
    console.error("Nova assist parse failed (%s):", String(surface).replace(/[\r\n]+/g, " ").slice(0, 60), err);
    return res.status(502).json({ message: "Nova returned an unreadable answer. Please try again." });
  }

  await storage.deductCredits(userId, CREDIT_COSTS.novaAssist);

  // Ids belong in operations, never in the text the builder reads.
  const knownIds = await collectProjectIds(projectId).catch(() => []);
  /*
   * The model's operations are checked before anyone is shown them.
   *
   * This used to forward up to sixty arbitrary objects straight through, with
   * the readable "items" as a parallel array that nothing compared against
   * them. A verb that doesn't exist, an id from another project, a task with
   * no title: all shown as changes about to be made, approved by the builder,
   * then quietly dropped by the apply engine. The plan they read and the plan
   * that ran were different plans, and the difference was invisible.
   *
   * So: parse every operation against the same vocabulary the apply engine
   * uses, drop what can't run or names an unknown id, and build the items
   * shown from the operations that survived — the model's own wording where it
   * gave one for that operation, the vocabulary's description otherwise.
   */
  const ids = await knownIdsFor(projectId).catch(() => undefined);
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const kept = (Array.isArray(parsed.operations) ? parsed.operations : []).slice(0, 60)
    .map((o: unknown, i: number) => ({ op: parseOperation(o, ids), item: rawItems[i] }))
    .filter((x: any) => x.op);
  const dropped = (Array.isArray(parsed.operations) ? parsed.operations.slice(0, 60).length : 0) - kept.length;
  res.json({
    surface,
    summary: stripIdFragments(str(parsed.summary, 1500), knownIds),
    items: kept.slice(0, 25).map(({ op, item }: any) => ({
      label: stripIdFragments(str(item?.label, 300), knownIds) || stripIdFragments(str(describeOp(op), 300), knownIds),
      detail: stripIdFragments(str(item?.detail, 600), knownIds),
    })).filter((i: any) => i.label),
    operations: kept.map((x: any) => x.op),
    /** How many of Nova's proposals couldn't be run and were left out. */
    dropped,
    creditsCharged: CHARGEABLE,
  });
}

export function registerNovaAssistRoutes(app: Express) {
  /**
   * Nova proposes changes for one surface. Writes nothing.
   */
  app.post("/api/projects/:id/nova/suggest", isAuthenticated, async (req: any, res) => {
    // metering: checked here; charged in novaSuggest only after the answer is parsed
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;
      if (!(await isMember(userId, projectId))) return res.status(403).json({ message: "Not a project member" });

      const input = (req.body ?? {}) as NovaAsk;
      const config = validateNovaAsk(input, res);
      if (!config) return;

      const ent = await requireFeature(res, userId, "aiMilestones", "Nova's assistant");
      if (!ent) return;
      if (!(await requireCredits(res, userId, CREDIT_COSTS.novaAssist, `Nova's help with ${config.label.toLowerCase()}`))) return;

      await novaSuggest(projectId, userId, input, ent, config, res);
    } catch (error) {
      console.error("Nova assist error:", error);
      respondToAiError(res, error, "Nova couldn't help with that");
    }
  });

  /**
   * The first plan for a new project, from its goal and subcategory's prompt
   * pack (shared/nova-prompt-packs.ts). GET returns the questions to ask;
   * POST writes the plan, and saves it to the board only when told to.
   */
  app.get("/api/projects/:id/nova/first-plan", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isMember(userId, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      const pack = packFor(project.goal, project.subcategory);
      res.json({ pack: { key: pack.key, status: pack.status, version: pack.version }, questions: pack.questions });
    } catch (error) {
      console.error("Nova first-plan questions error:", error);
      res.status(500).json({ message: "Couldn't load those questions" });
    }
  });

  app.post("/api/projects/:id/nova/first-plan", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    // metering: checked here, like every other AI route; charged in firstPlanFor only after the answer parses
    try {
      const userId = (req.user as any).id;
      if (!(await isMember(userId, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const ent = await requireFeature(res, userId, "aiMilestones", "Nova's first plan");
      if (!ent) return;
      if (!(await requireCredits(res, userId, CREDIT_COSTS.novaAssist, "Nova's first plan"))) return;
      await firstPlanFor(req.params.id, userId, (req.body ?? {}) as { answers?: Record<string, string>; save?: boolean }, ent, res);
    } catch (error) {
      console.error("Nova first-plan error:", error);
      respondToAiError(res, error, "Nova couldn't write that plan");
    }
  });

  /**
   * Applies a reviewed suggestion. No AI call, so no second charge.
   */
  app.post("/api/projects/:id/nova/apply", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;
      if (!(await isMember(userId, projectId))) return res.status(403).json({ message: "Not a project member" });

      const ent = await requireFeature(res, userId, "aiMilestones", "Nova's assistant");
      if (!ent) return;

      const { operations } = req.body as { operations?: unknown };
      if (!Array.isArray(operations) || !operations.length) {
        return res.status(400).json({ message: "There's nothing to apply." });
      }

      /*
       * Applied once. A double click, or a client retrying a slow apply, used
       * to run the whole batch a second time — duplicate tasks and milestones,
       * and an update_scope replaying a stale array over work added since.
       */
      const result = await applyOperationsOnce({
        projectId, userId, operations, source: "nova-assist",
        key: idempotencyKeyFor(req, operations),
        apply: { canEditMilestones: ent.aiMilestones, canEditRoadmap: ent.roadmapUpdates, maxOperations: 80 },
      });
      if (result.replayed) {
        return res.status(409).json({ message: "That was already applied.", changes: result.changes, skipped: result.skipped, replayed: true });
      }
      if (!result.changes.length) {
        return res.status(422).json({ message: "None of that could be applied.", skipped: result.skipped });
      }
      res.json({ changes: result.changes, skipped: result.skipped });
    } catch (error) {
      console.error("Nova apply error:", error);
      res.status(500).json({ message: "Couldn't apply that" });
    }
  });
}

/**
 * The extra context a surface needs beyond the shared project state.
 *
 * Kept out of buildOperableProjectState because a pricing question has no use
 * for the interview list and vice versa — and every unnecessary section is
 * budget the model spends not reasoning.
 */
async function buildSurfaceContext(projectId: string, surface: NovaSurfaceId): Promise<string> {
  switch (surface) {
    case "research": {
      const [interviews, experiments, personas] = await Promise.all([
        storage.getProjectInterviews(projectId).catch(() => []),
        storage.getProjectExperiments(projectId).catch(() => []),
        storage.getProjectPersonas(projectId).catch(() => []),
      ]);
      return [
        `EXISTING INTERVIEWS (${interviews.length})\n${interviews.length
          ? interviews.slice(0, 20).map((i) => `- ${i.intervieweeName}${i.intervieweeRole ? ` (${i.intervieweeRole})` : ""} [${i.status}]${i.keyInsights ? ` — ${i.keyInsights.slice(0, 160)}` : ""}`).join("\n")
          : "- none. No customer conversations have been recorded."}`,
        `EXISTING EXPERIMENTS (${experiments.length})\n${experiments.length
          ? experiments.slice(0, 20).map((e) => `- ${e.hypothesis.slice(0, 160)} [${e.status}]${e.result ? ` → ${e.result.slice(0, 120)}` : ""}`).join("\n")
          : "- none."}`,
        personas.length
          ? `PERSONAS (${personas.length})\n${personas.slice(0, 10).map((p) => `- ${p.name}${p.occupation ? ` (${p.occupation})` : ""}: ${(p.bio || "").slice(0, 160)}`).join("\n")}`
          : null,
      ].filter(Boolean).join("\n\n");
    }

    case "pricing":
    case "strategy": {
      const [tiers, artifacts] = await Promise.all([
        storage.getProjectPricingTiers(projectId).catch(() => []),
        storage.getInvestorArtifacts(projectId).catch(() => []),
      ]);
      return [
        `EXISTING PRICING TIERS (${tiers.length})\n${tiers.length
          ? tiers.map((t) => `- ${t.name}: ${t.price}/${t.billingPeriod}${t.isFeatured ? " (featured)" : ""} — ${((t.features as string[]) || []).join(", ")}`).join("\n")
          : "- none. Nothing has been priced yet."}`,
        artifacts.length
          ? `INVESTOR WORK ON RECORD\n${artifacts.slice(0, 10).map((a) => `- ${a.kind} (${new Date(a.createdAt).toISOString().slice(0, 10)})`).join("\n")}`
          : "INVESTOR WORK ON RECORD\n- none.",
      ].join("\n\n");
    }

    case "analytics": {
      const events = await storage.getProjectAnalyticsEvents(projectId).catch(() => []);
      return `ANALYTICS EVENTS BEING TRACKED (${events.length})\n${events.length
        ? events.slice(0, 30).map((e) => `- ${e.eventName} [${e.category || "uncategorised"}]${e.trackingStatus ? ` — ${e.trackingStatus}` : ""}`).join("\n")
        : "- none. Nothing is instrumented, so no metric in the brief is currently measurable."}`;
    }

    default:
      return "";
  }
}

async function isMember(userId: string, projectId: string): Promise<boolean> {
  const project = await storage.getProject(projectId);
  if (!project) return false;
  if (project.ownerId === userId) return true;
  const members = await storage.getProjectMembers(projectId).catch(() => []);
  return members.some((m) => m.userId === userId);
}
