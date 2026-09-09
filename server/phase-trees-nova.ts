/**
 * Nova's part of the injected layer: turning an artifact into loop steps,
 * and reading a project's artifacts to propose what a phase is missing.
 * Everything here is a proposal — server/phase-trees.ts decides what is
 * admitted, so the cap and the grounding rule do not depend on the model.
 */
import OpenAI from "openai";
import { modelFor, coachingDirectiveFor, type UserEntitlements } from "./entitlements";
import type { Artifact, InjectionProposal } from "@shared/phase-trees";

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
