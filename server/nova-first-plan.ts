/**
 * A project's first plan, written from the questions its kind of project turns on.
 *
 * The prompt pack (shared/nova-prompt-packs.ts) decides what Nova asks and what
 * a good answer looks like; this turns the answers into steps and, when the
 * builder says so, puts them on the board as real tasks. Preview first, like
 * every other Nova surface here: nothing is written until `save` is set, so a
 * plan nobody liked costs a look rather than a cleanup.
 *
 * The steps are created through the shared operations vocabulary rather than
 * inserting tasks directly, so they get the same validation, id scoping and
 * audit trail as every other write Nova makes.
 */
import type { Response } from "express";
import { getOpenAI } from "./openai-client";
import { storage } from "./storage";
import { modelFor, coachingDirectiveFor, type UserEntitlements } from "./entitlements";
import { CREDIT_COSTS , CHARGEABLE} from "@shared/plans";
import { packFor, NOVA_PACK_VERSION, type NovaPromptPack } from "@shared/nova-prompt-packs";
import { applyProjectOperations, buildOperableProjectState, stripIdFragments, collectProjectIds } from "./project-operations";
import { parseModelJson } from "./ai-json";
import { PROSE_STYLE_RULE, tidyProse } from "./prose-style";

/*
 * The shared client, not a second one built here: see server/openai-client.ts.
 * Each of these files used to construct its own, duplicating the base-URL rule
 * and — once there was a default ceiling on every answer — quietly opting out
 * of it.
 */

export interface FirstPlanStep { title: string; done: string; why?: string }
export interface FirstPlan { summary: string; steps: FirstPlanStep[] }

/*
 * Tidied before it is cut: these strings reach a `<p>`, not a Markdown
 * renderer, so a heading's hashes are read as punctuation. server/prose-style.ts.
 */
const str = (v: unknown, max: number) => (typeof v === "string" ? tidyProse(v).slice(0, max) : "");

/** The answers a builder gave to the pack's questions, as text Nova can read. */
export function renderAnswers(pack: NovaPromptPack, answers: Record<string, string> | undefined): string {
  const lines = pack.questions.map((q) => {
    const said = str(answers?.[q.id], 600);
    return `- ${q.ask}\n  ${said || "(not answered — plan around not knowing this yet, and make finding out a step)"}`;
  });
  return lines.join("\n");
}

export function firstPlanPrompt(pack: NovaPromptPack, project: { title?: string | null; description?: string | null }, state: string, answers?: Record<string, string>): { system: string; user: string } {
  return {
    system: `You are Nova, writing the first plan for a builder's project. ${pack.guidance}

${pack.shape}

Between four and seven steps. Each step is something a person starts and finishes, with an observable "done". No step is a category ("marketing", "design"); no step is "plan the plan".

${PROSE_STYLE_RULE}
Respond ONLY with valid JSON (no markdown, no code fences):
{"summary":"two sentences on what this plan gets them to","steps":[{"title":"the step","done":"the observable thing that proves it's finished","why":"one line, only when the order isn't obvious"}]}`,
    user: `PROJECT\n${str(project.title, 200) || "(untitled)"} — ${str(project.description, 1000) || "(no description)"}\n\nWHAT THEY TOLD ME\n${renderAnswers(pack, answers)}\n\nWHAT'S ALREADY THERE\n${state.slice(0, 6000)}`,
  };
}

export function parseFirstPlan(raw: string, knownIds: string[] = []): FirstPlan | null {
  const parsed: any = parseModelJson(raw, "first plan");
  const steps = (Array.isArray(parsed?.steps) ? parsed.steps : [])
    .map((s: any) => ({
      title: stripIdFragments(str(s?.title, 200), knownIds),
      done: stripIdFragments(str(s?.done, 300), knownIds),
      why: stripIdFragments(str(s?.why, 200), knownIds) || undefined,
    }))
    .filter((s: FirstPlanStep) => s.title)
    .slice(0, 7);
  if (!steps.length) return null;
  return { summary: stripIdFragments(str(parsed?.summary, 600), knownIds), steps };
}

/**
 * Asks for the plan, and saves it when told to. Charges once, after the answer
 * has been read: an unreadable answer costs nothing, as everywhere else.
 */
export async function firstPlanFor(
  projectId: string,
  userId: string,
  body: { answers?: Record<string, string>; save?: boolean },
  ent: UserEntitlements,
  res: Response,
): Promise<void> {
  const project = await storage.getProject(projectId);
  if (!project) { res.status(404).json({ message: "Project not found" }); return; }

  const pack = packFor(project.goal, project.subcategory);
  const state = await buildOperableProjectState(projectId, { includeIds: false });
  const { system, user } = firstPlanPrompt(pack, project, state, body.answers);
  const completion = await getOpenAI().chat.completions.create({
    model: modelFor(ent),
    messages: [{ role: "system", content: `${system}\n${coachingDirectiveFor(ent)}` }, { role: "user", content: user }],
  });

  const knownIds = await collectProjectIds(projectId).catch(() => []);
  const plan = parseFirstPlan(completion.choices[0]?.message?.content ?? "", knownIds);
  if (!plan) { res.status(502).json({ message: "Nova returned an unreadable answer. Please try again.", code: "model_unreadable" }); return; }

  await storage.deductCredits(userId, CREDIT_COSTS.novaAssist);

  // Saved only when asked: preview first, like every other Nova surface.
  let saved: { created: number } | null = null;
  if (body.save) {
    const operations = plan.steps.map((s) => ({
      op: "create_task" as const,
      title: s.title,
      description: s.done ? `Done when: ${s.done}${s.why ? `\n\nWhy now: ${s.why}` : ""}` : s.why ?? "",
      tags: ["nova-first-plan", `pack:${pack.key}`, `pack-version:${NOVA_PACK_VERSION}`],
    }));
    // "chat" is the source for a write a builder asked for in the moment, as against an audit's batch.
    const applied = await applyProjectOperations(projectId, userId, operations, { source: "chat" });
    saved = { created: applied.changes.length };
  }

  res.json({
    pack: { key: pack.key, status: pack.status, version: pack.version },
    questions: pack.questions,
    plan,
    saved,
    creditsCharged: CHARGEABLE,
  });
}
