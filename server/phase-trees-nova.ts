/**
 * Nova's part of the injected layer: turning an artifact into loop steps,
 * and reading a project's artifacts to propose what a phase is missing.
 * Everything here is a proposal — server/phase-trees.ts decides what is
 * admitted, so the cap and the grounding rule do not depend on the model.
 */
import OpenAI from "openai";
import { modelFor, coachingDirectiveFor, type UserEntitlements } from "./entitlements";
import { CODE_MODEL, CODE_REASONING_EFFORT } from "./aiModels";
import type { Artifact, InjectionProposal, WorkPayload, WorkKind } from "@shared/phase-trees";
import { sanitizePlan } from "@shared/phase-trees";
import { flattenRunGroups, groupRunSteps, sanitizeRunGroups, isLoopType, LOOP_TYPE_INFO, LOOP_ORDER, MAX_PRODUCT_LOOPS, LOOP_CAP, type LoopType } from "@shared/phase-trees";
import { parseModelJson } from "./ai-json";

const rawBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: rawBase ? (rawBase.endsWith("/v1") ? rawBase : `${rawBase.replace(/\/$/, "")}/v1`) : undefined,
});


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
  const parsed = parseModelJson(completion.choices[0]?.message?.content ?? "");
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
  const parsed = parseModelJson(completion.choices[0]?.message?.content ?? "");
  return Array.isArray(parsed.tasks) ? parsed.tasks : [];
}

/**
 * Reads a project's existing state — tasks done, audit, check-ins — against
 * the backbone and says which milestones are already done, each with the
 * evidence. Only ids from the backbone are accepted; the caller checks.
 */
export async function readExistingProgress(ent: UserEntitlements, backbone: { id: string; title: string; description: string }[], state: string, opts: { findLoops?: boolean; knownLoops?: string[]; rejectedLoops?: string[] } = {}) {
  const completion = await openai.chat.completions.create({
    model: modelFor(ent),
    messages: [
      { role: "system", content: `You are Nova, placing a project that already exists onto its path. ${coachingDirectiveFor(ent)}
You are given the path's milestones and the project's real state: its brief fields, scope, tech stack, tasks (with status), milestones, roadmap, latest codebase audit and check-ins. Decide which path milestones are ALREADY DONE on that evidence. Be generous where the evidence is concrete (a deployed URL, a finished task that clearly is the milestone, an audit that says the thing exists, a brief field that is the milestone's content) and strict where it is absent — never mark something done because it "probably" is.
For each done milestone, also write out its ANSWER: the milestone's actual content as the project already states it — the product statement from the brief's one-liner or value proposition, the stack from the stated tech stack or the audit, the scope cut from the scope lists, the data model from the audit's schema, the deploy from the live URL. Quote and assemble from the sources; do not invent. If the sources hold nothing for it, leave "answer" empty and say so in the evidence.
${opts.findLoops ? `
Also identify the business's LOOPS. A business runs on five kinds, and you report each kind in "type":
${LOOP_ORDER.map((t) => `- ${t} — ${LOOP_TYPE_INFO[t].asks} It closes when: ${LOOP_TYPE_INFO[t].closes}`).join("\n")}
Report exactly one growth, one retention, one revenue and one referral loop — the one this business actually runs or plainly intends, even if it's only partly built or only "planned" — and between one and ${MAX_PRODUCT_LOOPS} product loops. If the evidence holds nothing at all for a kind, still report it as "planned", with the most plausible version for this business in "steps" and "no evidence yet" in "evidence".
A PRODUCT loop is what ONE kind of user does over and over and gets value from each time — the 3–5 step cycle they come back for. It is not a feature, not a code path, not a tool, not the onboarding or setup path, and not a summary of several things at once. The test: could this user do exactly this every week and be glad each time? "Post a weekly update → get comments → post again" is a loop; "generate documents" is a feature; "create project → pick a goal" is setup, not a loop; "three-path journey" is a description of the product, not a loop. The same test holds for the other four kinds: each must feed its own start again, or it's a funnel.
If THE BUILDER'S OWN DOCS appear in the state, they are the primary source for loops and they WIN over the brief, the board and the code when they disagree: the docs are current intent, the brief and tasks may be stale, and the code may contain things being removed. Take the loops from the docs by name, then use the code and audit only to judge each one's state. If the docs describe distinct paths, journeys or modes a user picks and walks repeatedly (e.g. "ship an MVP", "systemize a business", "raise funding"), each of those IS a product loop — output ONE ENTRY PER PATH, type "product", named after the path, with that path's own steps. Never merge paths into a single "path-based" or "choose a goal" loop; that is the one mistake to avoid. Only add a loop the docs don't mention when the code clearly shows a cycle the docs forgot.
If THE BUILDER'S STANDING NOTES appear, obey them over everything else: if they say something is being removed or is not a loop, it is not a loop.
${opts.rejectedLoops?.length ? `The builder has REMOVED these as not loops — never propose them again, under any name, and do not fold them into another loop: ${opts.rejectedLoops.join("; ")}.` : ""}
Work it out in two passes before answering. First, list the kinds of user the product has (e.g. builder, backer, reviewer, visitor). Second, for each kind, ask what they come back to do repeatedly — that is their loop; a kind of user with nothing to come back for has no loop. Then check every candidate against the test above and drop the ones that fail.
Name each loop in 2–5 words by what the user is doing ("Ship an MVP", "Explore builders", "Back a project", "Share a check-in") — the steps go in "steps", never in the title. One user per loop. Keep loops SEPARATE: never fold two cycles for different users or motivations into one entry, and never pad the product loops. State on the evidence — "built" (the cycle works end to end), "partly", or "planned". ${opts.knownLoops?.length ? `Loops ALREADY RECORDED — do not list these again, under any name, and do not fold them into new ones; only return loops that are missing from this list (a kind already recorded doesn't need reporting again, except product loops, which can be several): ${opts.knownLoops.join("; ")}.` : ""}` : ""}
Respond ONLY with JSON: {"done":[{"id":"<milestone id>","evidence":"<one line>","answer":"<the content, or empty>"}]${opts.findLoops ? `,"loops":[{"type":"product|growth|retention|revenue|referral","title":"","steps":"","state":"built|partly|planned","evidence":"one line"}]` : ""},"read":"<two sentences: where this project actually is and what the next real step is>"}` },
      { role: "user", content: `PATH MILESTONES\n${backbone.map((m) => `${m.id} — ${m.title}: ${m.description}`).join("\n")}\n\nPROJECT STATE\n${state.slice(0, 24000)}` },
    ],
    temperature: 0.2,
  });
  const parsed = parseModelJson(completion.choices[0]?.message?.content ?? "");
  const ids = new Set(backbone.map((m) => m.id));
  const done = (Array.isArray(parsed.done) ? parsed.done : [])
    .filter((d: any) => d && ids.has(String(d.id)))
    .map((d: any) => ({ id: String(d.id), evidence: String(d.evidence ?? "").slice(0, 300), answer: d.answer ? String(d.answer).slice(0, 4000) : undefined }));
  const loops = (Array.isArray(parsed.loops) ? parsed.loops : [])
    .map((l: any) => ({ type: (isLoopType(l.type) ? l.type : "product") as LoopType, title: String(l.title ?? "").trim().slice(0, 80), steps: String(l.steps ?? "").trim().slice(0, 1000), state: (["built", "partly", "planned"].includes(l.state) ? l.state : "planned") as "built" | "partly" | "planned", evidence: String(l.evidence ?? "").slice(0, 300) }))
    .filter((l: any) => l.title)
    .slice(0, LOOP_CAP);
  return { done, loops, read: String(parsed.read ?? "").slice(0, 600) };
}

/**
 * Nova's competitive read of the loops: who the builder's customers use today,
 * how those products run the equivalent loop, and how likely each of this
 * project's loops is to actually turn against them. Returns the model's answer
 * unsanitized; the route reduces it with sanitizeLoopAudit.
 */
export async function auditLoopsAgainstCompetition(ent: UserEntitlements, brief: string, loops: string) {
  const model = modelFor(ent);
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: `You are Nova, auditing a new business's loops against the products its customers already use. ${coachingDirectiveFor(ent)}
A business runs on five kinds of loop: product (the core thing a user repeats), growth (how strangers find it), retention (why users come back), revenue (how use turns into money and money into more use) and referral (how a user deliberately brings in another). A loop only counts when its output restarts it; a sequence that ends is a funnel.

First, name the 3–5 products or habits this project's customers use TODAY for the same job — direct competitors, the incumbent, and the do-nothing alternative (a spreadsheet, a group chat) where that's the real rival. Name only products you are confident exist; never invent one. If the market is too new to name any, say so in "competitors" with the closest analogues.

Then, for EACH loop by its key, judge how effective it will be against those competitors:
- competitors: the 1–3 whose equivalent loop matters most here, and in one or two sentences how theirs actually works.
- score 0–100: how likely this loop is to keep turning with real users, given what those competitors already give them. 70+ means it has a real edge; 45–69 means it holds up but doesn't win; under 45 means it probably won't turn. Be calibrated — most first drafts are 40–65. An unwritten or vague loop scores under 30.
- advantage: the concrete thing this loop does that theirs doesn't. Empty if nothing.
- gap: where theirs is plainly better, specifically.
- breakRisk: the exact step where this loop is most likely to stop turning, and why.
- recommendation: the one change that would raise the score most, concrete enough to build.

Be specific and honest. "Linear's cycle view notifies the whole team when a cycle closes, which is the retention trigger this loop lacks" is useful. "Consider improving engagement" is not.
Respond ONLY with JSON: {"competitors":[{"name":"","why":"one line: why customers would pick it instead"}],"summary":"3–4 sentences: how this set of loops stacks up as a business, and the one to fix first","loops":[{"key":"L1","competitors":[{"name":"","howTheirLoopWorks":""}],"score":0,"advantage":"","gap":"","breakRisk":"","recommendation":""}],"caveat":"one line on what you couldn't judge"}` },
      { role: "user", content: `THE BUSINESS\n${brief.slice(0, 8000)}\n\nITS LOOPS\n${loops.slice(0, 12000)}` },
    ],
    temperature: 0.3,
  });
  return { parsed: parseModelJson(completion.choices[0]?.message?.content ?? "", "loop audit"), model };
}

/**
 * Nova writing the builder's loops for them: every unwritten loop (by key) and
 * every missing kind (by type), as one consistent set, in the product's own
 * terms. The written loops are context, never rewritten.
 */
export async function draftLoops(ent: UserEntitlements, input: { state: string; loops: string; missingTypes: LoopType[]; toWrite: string[] }) {
  const model = modelFor(ent);
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: `You are Nova, writing a builder's business loops for them because they asked you to. ${coachingDirectiveFor(ent)}
A business runs on five kinds of loop:
${LOOP_ORDER.map((t) => `- ${t} — ${LOOP_TYPE_INFO[t].asks} It closes when: ${LOOP_TYPE_INFO[t].closes} e.g. ${LOOP_TYPE_INFO[t].example}`).join("\n")}
Write ONLY the loops asked for below. Each is 3–5 steps in the product's own words — the screens, actions and names it actually has or plainly will have — ending with the step that restarts the first. Use the loops already written as ground truth and make the new ones fit with them; never contradict them. If THE BUILDER'S STANDING NOTES appear in the state, obey them. Name each loop in 2–5 words by what the user does. Never write a generic loop that could belong to any product.
Respond ONLY with JSON: {"loops":[{"key":"L3 for an existing loop, or empty for a missing kind","type":"product|growth|retention|revenue|referral","title":"","steps":"1. … 2. … 3. …","closes":"one line: the exact thing that sends the user back to step 1"}]}` },
      { role: "user", content: `LOOPS ON THE PROJECT\n${input.loops || "(none)"}\n\nWRITE THESE\n${[...input.toWrite.map((k) => `- the loop at ${k}`), ...input.missingTypes.map((t) => `- a new ${LOOP_TYPE_INFO[t].label.toLowerCase()} (type "${t}", no key)`)].join("\n")}\n\nPROJECT STATE\n${input.state.slice(0, 16000)}` },
    ],
    temperature: 0.4,
  });
  const parsed = parseModelJson(completion.choices[0]?.message?.content ?? "", "loops");
  return (Array.isArray(parsed.loops) ? parsed.loops : []).slice(0, LOOP_CAP) as { key?: string; type?: string; title?: string; steps?: string; closes?: string }[];
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
 * One JSON-producing call, routed by what's being produced.
 *
 * Code goes to the coding model, on the Responses API it's served from.
 * Everything else — options to pick from, templates for the human part — stays
 * on the general model, where a better sentence is what matters.
 *
 * The fallback is for the model being *refused* (no access on this account, a
 * proxy that doesn't carry it, an outage): the packet still arrives, from the
 * general model, and the log says so. It is deliberately not a retry on a bad
 * answer. An unreadable reply is a 502 the builder isn't charged for, same as
 * every other AI route; quietly spending a second model call to paper over it
 * would hide the thing worth knowing.
 */
async function complete(ent: UserEntitlements, kind: WorkKind, system: string, user: string): Promise<{ text: string; model: string }> {
  if (kind === "build") {
    try {
      const response = await openai.responses.create({
        model: CODE_MODEL,
        instructions: system,
        input: user,
        reasoning: { effort: CODE_REASONING_EFFORT },
        // Reasoning tokens count against this too, and a packet is whole files.
        max_output_tokens: 32000,
      });
      if (response.output_text?.trim()) return { text: response.output_text, model: CODE_MODEL };
      console.warn(`[nova] ${CODE_MODEL} returned no text (status ${response.status}); using ${modelFor(ent)}`);
    } catch (error: any) {
      console.warn(`[nova] ${CODE_MODEL} unavailable (${error?.status ?? "no status"}: ${String(error?.message ?? error).slice(0, 160)}); using ${modelFor(ent)}`);
    }
  }
  const model = modelFor(ent);
  const completion = await openai.chat.completions.create({
    model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: kind === "build" ? 0.2 : 0.5,
    max_completion_tokens: 8000,
  });
  return { text: completion.choices[0]?.message?.content ?? "{}", model };
}

/**
 * Nova doing the milestone. The kind follows the actor: options for drafts
 * and decisions, a build packet for nova-builds, a template for user-does.
 * Grounded in the project's state and the answers written so far, so the
 * data model it writes matches the loop they chose and the copy uses their
 * product's words.
 */
/**
 * Nova building a money plan: numbers with the arithmetic behind them, the
 * tables that hold them, what it assumed, what's weak, and the dated actions
 * that follow. Written for the person's real position — including $0 and low
 * credit — and honest about what no plan can promise.
 */
async function producePlan(
  ent: UserEntitlements,
  task: { title: string; description: string },
  context: { goal: string; subcategory: string; state: string; artifacts: Artifact[] },
): Promise<WorkPayload> {
  const system = `You are Nova, building one part of a founder's money plan for their business — not describing it, building it. ${coachingDirectiveFor(ent)}
Path: ${context.goal} · business type: ${context.subcategory}.

Ground everything in THE ANSWERS SO FAR: the founder's tapped answers (cash they could put in, monthly free money, income and debt payments, credit range, whether they're starting, buying or running, industry experience, business history, what could back a loan, how much they want to raise, what it buys, when, and their limits on equity, debt and ownership, roadmap length), their scored capital profile and chosen route where those appear, and every plan already locked. The fundability score and route fit are computed from the answers — use those exact numbers, never invent a different score. Treat those as facts. When an answer is "Not sure yet" or "I don't know", work it out from the business type and the numbers so far, and say you did. Never ask them a question back; make the plan.

How to build it:
- Use real, current, typical ranges for this kind of business and say they're typical ranges, not quotes. Show the arithmetic for every headline number (e.g. "$18 average check × 140 covers × 26 days = $65,520/month").
- Be concrete: dollar amounts, percentages, months, dates relative to today ("week 3", "month 4"). No "consider", no "it depends" without the number it depends on.
- Build for where they actually are. Starting from $0 or with low or unknown credit is a normal starting point: plan the steps that make them financeable, with realistic timelines — never shame, never pretend the gap isn't there.
- Name specific programmes and instruments where they apply (SBA 7(a), 504, Microloan, CDFIs, seller notes, equipment leasing, landlord build-out allowances, gift letters, retirement rollovers) and what each really requires. Lender and programme rules vary and change: say which to confirm, and with whom.
- Never promise approval, funding or success, and never use the words "guaranteed" or "guarantee" about an outcome. The plan's strength is that every gap it finds has a dated step against it.
- Where securities law, tax or contracts are involved, say so in one line and keep going.
- Actions are what the founder does next, each with when, and what it moves ("credit 590 → 640", "+$6k equity", "application-ready").

Respond ONLY with valid JSON of exactly this shape (no markdown fences):
{"summary":"3–5 sentences: the answer to this step, with the key numbers","figures":[{"label":"","value":"","note":"optional, one line"}],"tables":[{"title":"","columns":[""],"rows":[[""]]}],"sections":[{"heading":"","body":"the reasoning and detail, with the arithmetic"}],"assumptions":["each thing assumed, with the number"],"gaps":["each weakness this step found, plainly"],"actions":[{"title":"","detail":"exactly what to do","when":"e.g. this week, week 2, month 3, Q2 year 1","moves":"what it changes"}],"verifyWith":"one line: who should check this before they rely on it"}
4–8 figures. 1–3 tables (sources and uses, a month-by-month cash flow, a checklist with met/not yet/unknown, a timeline — whatever this step needs). 3–12 actions.`;
  const user = `STEP: ${task.title}\n${task.description}\n\nTHE ANSWERS SO FAR\n${context.artifacts.length ? context.artifacts.map((a) => `[${a.label}] ${a.text}`).join("\n") : "(none yet)"}\n\nPROJECT STATE\n${context.state.slice(0, 16000)}`;
  const model = modelFor(ent);
  const completion = await openai.chat.completions.create({
    model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: 0.3,
    max_completion_tokens: 8000,
  });
  return sanitizePlan(parseModelJson(completion.choices[0]?.message?.content ?? "", "plan"));
}

export async function produceWork(
  ent: UserEntitlements, kind: WorkKind,
  task: { title: string; description: string; tier: string },
  context: { goal: string; subcategory: string; state: string; artifacts: Artifact[]; loops?: { title: string; description: string; status: string; type?: LoopType }[]; rejectedLoops?: string[] },
): Promise<WorkPayload> {
  if (kind === "plan") return producePlan(ent, task, context);
  if (kind === "intake") throw Object.assign(new Error("This step is answered by choosing — Nova reads your answers on the next one."), { status: 400, code: "invalid_input" });
  const shape = kind === "options"
    ? `{"kind":"options","existing":"one line: what the CAPABILITY INVENTORY and the code already have for this milestone, with files — or 'nothing yet'","intro":"one sentence on how these differ","options":[{"title":"","body":"the full text they would keep — complete, not a summary","why":"one line"}]}
Give exactly three options with genuinely different emphases, never three rewordings. Each body must be usable as-is.`
    : kind === "build"
    ? `{"kind":"build","existing":"one line: what the CAPABILITY INVENTORY and the code already have for this milestone, with files — or 'nothing yet'. Answer this BEFORE planning; the build must extend it.","summary":"2–3 sentences: what this builds and where it goes","files":[{"path":"relative/path","language":"ts","content":"complete file contents","purpose":"one line"}],"runGroups":[{"where":"terminal | new-terminal | browser-console | browser | manual","cwd":"folder relative to the repo root — only when not the root","label":"one short line","commands":["one runnable line each, verbatim"],"note":"what to adjust or wait for, if anything","longRunning":false}],"verify":"the one check that proves it works","assumptions":["anything you had to assume about their stack or repo"]}
Write real, complete code for their stack — not pseudocode, not placeholders, no '...'. Match the data model and loop written in the artifacts. Keep it to the files this milestone needs (usually 1–4). If the milestone is not code (a deploy, an analytics wiring), files may be config and runGroups carry the work.
runGroups: split what to run by where it runs. Commands that run together go in one terminal group, one command per line, so they can be pasted at once. A command that keeps running (a dev server) sets longRunning:true and ends its group; anything after it that needs a terminal is a new-terminal group. Browser console snippets go in one browser-console group, one expression per line, in the order they must run. Something to do rather than run (open a page, click a button) is a manual group with the instruction as its label and no commands. Never put prose, backticks or comments inside commands.
Read LAYOUT FACTS and MECHANISMS ALREADY IN CODE first. If the thing this milestone asks for is listed there, the build is the change that wires, extends or verifies the existing one in the file named — never a new implementation beside it. Every file path you write must sit under the real top-level layout, and every command must use the real package manager and a real script name.
Never write "unknown", "needs inventory" or "not derivable" about the codebase: the PROJECT STATE carries the audit's route list, file tree, guards and env vars. Use those exact paths and names. If something truly isn't in the state, say which file to open to find it, in one line, and build the rest.`
    : `{"kind":"template","intro":"one sentence","template":"the thing they will use — a message, a list structure, an observation sheet — complete and in their product's words","whatNovaDid":"one line","whatIsLeft":"one line: the part only they can do"}`;

  const system = `You are Nova, doing a milestone on a builder's path — not describing it, doing it. ${coachingDirectiveFor(ent)}
Path: ${context.goal} · type: ${context.subcategory}. Verification: ${task.tier}.
Use the ANSWERS SO FAR as ground truth; they were chosen by the builder. Use the PROJECT STATE for stack, names and what already exists — do not rebuild what exists.
If THE BUILDER'S STANDING NOTES appear in the state, obey them over everything else in it, including the brief, the board and the audit.
${context.loops?.length ? `THE PRODUCT'S LOOPS, as recorded on the path (these ARE the loops — never invent a different "core loop", never reframe the product around anything else):\n${context.loops.map((l) => `- ${LOOP_TYPE_INFO[l.type ?? "product"].label} — ${l.title}${l.description ? `: ${l.description}` : ""} [${l.status === "done" ? "written" : "not written yet"}]`).join("\n")}
A business runs on five kinds of loop — product, growth, retention, revenue, referral — and each must close: its last step has to restart its first. When writing or building any loop, name what closes it.` : ""}
${context.rejectedLoops?.length ? `NOT loops, by the builder's decision — never build an option, a step or a plan around these: ${context.rejectedLoops.join("; ")}.` : ""}
Respond ONLY with valid JSON of exactly this shape (no markdown fences):
${shape}`;
  const user = `MILESTONE: ${task.title}\n${task.description}\n\nANSWERS SO FAR\n${context.artifacts.length ? context.artifacts.map((a) => `[${a.label}] ${a.text}`).join("\n") : "(none yet)"}\n\nPROJECT STATE\n${context.state.slice(0, 20000)}`;
  const { text, model } = await complete(ent, kind, system, user);
  const parsed = parseModelJson(text);
  if (kind === "options") {
    const options = (Array.isArray(parsed.options) ? parsed.options : []).slice(0, 3)
      .map((o: any) => ({ title: String(o.title ?? "").slice(0, 120), body: String(o.body ?? "").slice(0, 4000), why: o.why ? String(o.why).slice(0, 300) : undefined }))
      .filter((o: any) => o.body);
    if (!options.length) throw Object.assign(new Error("Nova didn't come back with usable options. Try again."), { status: 502 });
    return { kind: "options", existing: String(parsed.existing ?? "").slice(0, 400) || undefined, intro: String(parsed.intro ?? "").slice(0, 400), options };
  }
  if (kind === "build") {
    const files = (Array.isArray(parsed.files) ? parsed.files : []).slice(0, 8)
      .map((f: any) => ({ path: String(f.path ?? "file").slice(0, 200), language: String(f.language ?? "").slice(0, 20), content: String(f.content ?? ""), purpose: f.purpose ? String(f.purpose).slice(0, 200) : undefined }))
      .filter((f: any) => f.content);
    // Grouped run steps are what's asked for; a model on the old habit (or the
    // general-model fallback) may still send a flat list, which is grouped here.
    const asked = sanitizeRunGroups(parsed.runGroups);
    const legacy = (Array.isArray(parsed.runSteps) ? parsed.runSteps : []).map(String).slice(0, 12);
    const runGroups = asked.length ? asked : groupRunSteps(legacy);
    const runSteps = asked.length ? flattenRunGroups(asked) : legacy;
    if (!files.length && !runSteps.length) throw Object.assign(new Error("Nova didn't produce a build. Try again."), { status: 502 });
    return { kind: "build", model, existing: String(parsed.existing ?? "").slice(0, 400) || undefined, summary: String(parsed.summary ?? "").slice(0, 1200), files, runSteps, runGroups, verify: String(parsed.verify ?? "").slice(0, 400), assumptions: (Array.isArray(parsed.assumptions) ? parsed.assumptions : []).map(String).slice(0, 6) };
  }
  const template = String(parsed.template ?? "");
  if (!template) throw Object.assign(new Error("Nova didn't produce a template. Try again."), { status: 502 });
  return { kind: "template", intro: String(parsed.intro ?? "").slice(0, 400), template: template.slice(0, 6000), whatNovaDid: String(parsed.whatNovaDid ?? "").slice(0, 300), whatIsLeft: String(parsed.whatIsLeft ?? "").slice(0, 300) };
}
