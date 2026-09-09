/**
 * Nova's part of the injected layer: turning an artifact into loop steps,
 * and reading a project's artifacts to propose what a phase is missing.
 * Everything here is a proposal — server/phase-trees.ts decides what is
 * admitted, so the cap and the grounding rule do not depend on the model.
 */
import OpenAI from "openai";
import { modelFor, coachingDirectiveFor, type UserEntitlements } from "./entitlements";
import type { Artifact, InjectionProposal, WorkPayload, WorkKind } from "@shared/phase-trees";

const rawBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: rawBase ? (rawBase.endsWith("/v1") ? rawBase : `${rawBase.replace(/\/$/, "")}/v1`) : undefined,
});

function parseJson(raw: string): any {
  const match = raw.match(/[\[{][\s\S]*[\]}]/);
  return JSON.parse(match ? match[0] : raw);
}

/** 3–5 steps from the written core loop (or whatever the parent milestone answered). */
export async function draftExpansionSteps(ent: UserEntitlements, milestoneTitle: string, artifact: string) {
  const completion = await openai.chat.completions.create({
    model: modelFor(ent),
    messages: [
      { role: "system", content: `You are Nova, turning a builder's written answer into the steps that build it. ${coachingDirectiveFor(ent)}
Return between 3 and 5 steps, in build order, each a 1–3 hour unit that Nova builds and the builder runs. Every step names the concrete thing that exists when it is done.
Respond ONLY with JSON: {"steps":[{"title":"","description":"","estimateHours":1}]}` },
      { role: "user", content: `Milestone: ${milestoneTitle}\n\nWhat the builder wrote:\n${artifact.slice(0, 3000)}` },
    ],
    temperature: 0.4,
  });
  const parsed = parseJson(completion.choices[0]?.message?.content ?? "{}");
  return Array.isArray(parsed.steps) ? parsed.steps as { title: string; description: string; estimateHours?: number }[] : [];
}

/** Up to `room` tasks for a phase, each naming the artifact that motivated it. */
export async function proposeInjections(ent: UserEntitlements, phaseTitle: string, backbone: string[], artifacts: Artifact[], room: number): Promise<InjectionProposal[]> {
  if (room <= 0 || artifacts.length === 0) return [];
  const completion = await openai.chat.completions.create({
    model: modelFor(ent),
    messages: [
      { role: "system", content: `You are Nova, adding project-specific tasks to a phase of a builder's path. ${coachingDirectiveFor(ent)}
The phase already has its authored milestones (listed). Propose at most ${room} additional tasks that THIS project needs and the backbone doesn't cover, each motivated by one of the artifacts listed — quote its label exactly in "artifact". If nothing in the artifacts calls for a task, return an empty list. Never propose a task you cannot ground in an artifact.
Respond ONLY with JSON: {"tasks":[{"title":"","description":"","artifact":"<exact label>","estimateHours":1}]}` },
      { role: "user", content: `Phase: ${phaseTitle}\nAuthored milestones:\n- ${backbone.join("\n- ")}\n\nArtifacts:\n${artifacts.map((a) => `[${a.label}] ${a.text}`).join("\n")}` },
    ],
    temperature: 0.4,
  });
  const parsed = parseJson(completion.choices[0]?.message?.content ?? "{}");
  return Array.isArray(parsed.tasks) ? parsed.tasks : [];
}

/**
 * Reads a project's existing state — tasks done, audit, check-ins — against
 * the backbone and says which milestones are already done, each with the
 * evidence. Only ids from the backbone are accepted; the caller checks.
 */
export async function readExistingProgress(ent: UserEntitlements, backbone: { id: string; title: string; description: string }[], state: string) {
  const completion = await openai.chat.completions.create({
    model: modelFor(ent),
    messages: [
      { role: "system", content: `You are Nova, placing a project that already exists onto its path. ${coachingDirectiveFor(ent)}
You are given the path's milestones and the project's real state: its tasks (with status), milestones, roadmap, latest codebase audit and check-ins. Decide which path milestones are ALREADY DONE on that evidence. Be generous where the evidence is concrete (a deployed URL, a finished task that clearly is the milestone, an audit that says the thing exists) and strict where it is absent — never mark something done because it "probably" is. For each, quote the evidence in one line.
Respond ONLY with JSON: {"done":[{"id":"<milestone id>","evidence":"<one line>"}],"read":"<two sentences: where this project actually is and what the next real step is>"}` },
      { role: "user", content: `PATH MILESTONES\n${backbone.map((m) => `${m.id} — ${m.title}: ${m.description}`).join("\n")}\n\nPROJECT STATE\n${state.slice(0, 24000)}` },
    ],
    temperature: 0.2,
  });
  const parsed = parseJson(completion.choices[0]?.message?.content ?? "{}");
  const ids = new Set(backbone.map((m) => m.id));
  const done = (Array.isArray(parsed.done) ? parsed.done : [])
    .filter((d: any) => d && ids.has(String(d.id)))
    .map((d: any) => ({ id: String(d.id), evidence: String(d.evidence ?? "").slice(0, 300) }));
  return { done, read: String(parsed.read ?? "").slice(0, 600) };
}

/** Drafts the missing artifact (the core loop, say) from what the project already shows. */
export async function draftArtifact(ent: UserEntitlements, milestone: { title: string; description: string }, state: string) {
  const completion = await openai.chat.completions.create({
    model: modelFor(ent),
    messages: [
      { role: "system", content: `You are Nova, writing a builder's answer to a milestone for them, from what their project already shows. ${coachingDirectiveFor(ent)}
Write it as they would: concrete, in their product's own terms, 3–5 numbered lines at most. No preamble, no options, no questions. If the project state is thin, write the most plausible version and say in a final line what you assumed.` },
      { role: "user", content: `Milestone: ${milestone.title}\nWhat it asks for: ${milestone.description}\n\nPROJECT STATE\n${state.slice(0, 16000)}` },
    ],
    temperature: 0.4,
  });
  return (completion.choices[0]?.message?.content ?? "").trim().slice(0, 3000);
}

/**
 * Nova doing the milestone. The kind follows the actor: options for drafts
 * and decisions, a build packet for nova-builds, a template for user-does.
 * Grounded in the project's state and the answers written so far, so the
 * data model it writes matches the loop they chose and the copy uses their
 * product's words.
 */
export async function produceWork(
  ent: UserEntitlements, kind: WorkKind,
  task: { title: string; description: string; tier: string },
  context: { goal: string; subcategory: string; state: string; artifacts: Artifact[] },
): Promise<WorkPayload> {
  const shape = kind === "options"
    ? `{"kind":"options","intro":"one sentence on how these differ","options":[{"title":"","body":"the full text they would keep — complete, not a summary","why":"one line"}]}
Give exactly three options with genuinely different emphases, never three rewordings. Each body must be usable as-is.`
    : kind === "build"
    ? `{"kind":"build","summary":"2–3 sentences: what this builds and where it goes","files":[{"path":"relative/path","language":"ts","content":"complete file contents","purpose":"one line"}],"runSteps":["exact commands or clicks, in order"],"verify":"the one check that proves it works","assumptions":["anything you had to assume about their stack or repo"]}
Write real, complete code for their stack — not pseudocode, not placeholders, no '...'. Match the data model and loop written in the artifacts. Keep it to the files this milestone needs (usually 1–4). If the milestone is not code (a deploy, an analytics wiring), files may be config and runSteps carry the work.`
    : `{"kind":"template","intro":"one sentence","template":"the thing they will use — a message, a list structure, an observation sheet — complete and in their product's words","whatNovaDid":"one line","whatIsLeft":"one line: the part only they can do"}`;

  const completion = await openai.chat.completions.create({
    model: modelFor(ent),
    messages: [
      { role: "system", content: `You are Nova, doing a milestone on a builder's path — not describing it, doing it. ${coachingDirectiveFor(ent)}
Path: ${context.goal} · type: ${context.subcategory}. Verification: ${task.tier}.
Use the ANSWERS SO FAR as ground truth; they were chosen by the builder. Use the PROJECT STATE for stack, names and what already exists — do not rebuild what exists.
Respond ONLY with valid JSON of exactly this shape (no markdown fences):
${shape}` },
      { role: "user", content: `MILESTONE: ${task.title}\n${task.description}\n\nANSWERS SO FAR\n${context.artifacts.length ? context.artifacts.map((a) => `[${a.label}] ${a.text}`).join("\n") : "(none yet)"}\n\nPROJECT STATE\n${context.state.slice(0, 20000)}` },
    ],
    temperature: kind === "build" ? 0.2 : 0.5,
    max_completion_tokens: 8000,
  });
  const parsed = parseJson(completion.choices[0]?.message?.content ?? "{}");
  if (kind === "options") {
    const options = (Array.isArray(parsed.options) ? parsed.options : []).slice(0, 3)
      .map((o: any) => ({ title: String(o.title ?? "").slice(0, 120), body: String(o.body ?? "").slice(0, 4000), why: o.why ? String(o.why).slice(0, 300) : undefined }))
      .filter((o: any) => o.body);
    if (!options.length) throw Object.assign(new Error("Nova didn't come back with usable options. Try again."), { status: 502 });
    return { kind: "options", intro: String(parsed.intro ?? "").slice(0, 400), options };
  }
  if (kind === "build") {
    const files = (Array.isArray(parsed.files) ? parsed.files : []).slice(0, 8)
      .map((f: any) => ({ path: String(f.path ?? "file").slice(0, 200), language: String(f.language ?? "").slice(0, 20), content: String(f.content ?? ""), purpose: f.purpose ? String(f.purpose).slice(0, 200) : undefined }))
      .filter((f: any) => f.content);
    const runSteps = (Array.isArray(parsed.runSteps) ? parsed.runSteps : []).map(String).slice(0, 12);
    if (!files.length && !runSteps.length) throw Object.assign(new Error("Nova didn't produce a build. Try again."), { status: 502 });
    return { kind: "build", summary: String(parsed.summary ?? "").slice(0, 1200), files, runSteps, verify: String(parsed.verify ?? "").slice(0, 400), assumptions: (Array.isArray(parsed.assumptions) ? parsed.assumptions : []).map(String).slice(0, 6) };
  }
  const template = String(parsed.template ?? "");
  if (!template) throw Object.assign(new Error("Nova didn't produce a template. Try again."), { status: 502 });
  return { kind: "template", intro: String(parsed.intro ?? "").slice(0, 400), template: template.slice(0, 6000), whatNovaDid: String(parsed.whatNovaDid ?? "").slice(0, 300), whatIsLeft: String(parsed.whatIsLeft ?? "").slice(0, 300) };
}
