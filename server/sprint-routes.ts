import type { Express } from "express";
import { storage } from "./storage";
import { db } from "./db";
import { projectMembers } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { requireFeature, requireCredits, getUserEntitlements, modelFor, coachingDirectiveFor, memoryLimitFor } from "./entitlements";
import { CREDIT_COSTS } from "@shared/plans";
import type { CofounderSprint } from "@shared/schema";
import OpenAI from "openai";
import { parseModelJson } from "./ai-json";
import { rateLimit } from "./moderation";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const _rawOpenAiBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const _openAiBaseURL = _rawOpenAiBase ? (_rawOpenAiBase.endsWith("/v1") ? _rawOpenAiBase : `${_rawOpenAiBase.replace(/\/$/,"")}/v1`) : undefined;
    _openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: _openAiBaseURL,
    });
  }
  return _openai;
}

const SPRINT_PHASES = ["setup", "ideation", "alignment", "building", "validation", "review", "completed"] as const;

type SprintDuration = "24h" | "72h";

function isDuration(value: unknown): value is SprintDuration {
  return value === "24h" || value === "72h";
}

/** Attaches both participants, since the client renders their names/avatars. */
async function withParticipants(sprint: CofounderSprint) {
  const [user1, user2] = await Promise.all([
    storage.getUser(sprint.user1Id),
    storage.getUser(sprint.user2Id),
  ]);
  return { ...sprint, user1, user2 };
}

/**
 * Nova's persona when standing in as a practice sprint partner.
 *
 * Deliberately opinionated: a partner who agrees with everything teaches
 * nothing, and the point of a practice sprint is rehearsing real co-founder
 * friction before doing it with a stranger.
 */
function novaPartnerSystemPrompt(sprint: CofounderSprint, directive: string): string {
  return `You are Nova, standing in as a co-founder partner in a practice sprint. You are NOT an assistant here — you are a peer building alongside this person.

SPRINT
- Product: ${sprint.productName || "not named yet"}
- Concept: ${sprint.productDescription || "not defined yet"}
- Style: ${sprint.productStyle || "modern"}
- Duration: ${sprint.duration}
- Current phase: ${sprint.status}
- Agreed problem: ${sprint.agreedProblem || "not agreed yet"}
- Agreed ICP: ${sprint.agreedIcp || "not agreed yet"}
- Agreed value prop: ${sprint.agreedValueProp || "not agreed yet"}

HOW TO BEHAVE
- Talk like a real co-founder: first person, direct, invested in the outcome.
- Have opinions. Push back when something is vague, too broad, or unvalidated.
- Bring your own ideas rather than only reacting to theirs.
- Keep it to 2-4 sentences unless asked for depth. This is a working chat.
- Never mention being an AI, a model, or a simulation.

COACHING DEPTH: ${directive}`;
}

function getNextPhase(current: string, duration: string): string | null {
  const idx = SPRINT_PHASES.indexOf(current as any);
  if (idx === -1 || idx >= SPRINT_PHASES.length - 1) return null;
  const next = SPRINT_PHASES[idx + 1];
  if (next === "validation" && duration === "24h") {
    return "review";
  }
  return next;
}

const SPRINT_24H_TASKS = [
  { title: "Agree on 1 core problem", description: "Discuss and align on the single most important problem your product solves", order: 1 },
  { title: "Define Ideal Customer Profile (ICP)", description: "Who is your target customer? Be specific about demographics, behaviors, and pain points", order: 2 },
  { title: "Write core value proposition", description: "Craft a clear, compelling statement of why customers should choose your product", order: 3 },
  { title: "Identify 3 validation questions", description: "What 3 questions, if answered, would confirm or deny your product's viability?", order: 4 },
  { title: "Compile and submit brief", description: "Combine all deliverables into a cohesive product brief document", order: 5 },
];

const SPRINT_72H_EXTRA_TASKS = [
  { title: "Draft outreach email template", description: "Write an email you could send to potential customers to validate your idea", order: 6 },
  { title: "Draft 2 community social media posts", description: "Create posts for relevant communities to test interest and gather feedback", order: 7 },
  { title: "Write 4 interview questions", description: "2 personal (getting to know the individual) + 2 for customer segmentation", order: 8 },
  { title: "Collect validation evidence", description: "Gather screenshots, summaries, or notes from any real-world validation you did", order: 9 },
  { title: "Compile final validation brief", description: "Combine all validation data into a comprehensive brief with insights", order: 10 },
];

const NOVA_DECISION_PREFIX = "[Nova AI Practice Partner]";

const STYLE_BRIEFS: Record<string, string> = {
  past: "Take something that existed before roughly 2010 — a gadget, a ritual, a service, a fad — and reimagine it for today. Think jukeboxes, video rental stores, pen pals, TV dinners, arcade cabinets, mixtapes, Blockbuster, drive-ins, encyclopedia salesmen.",
  modern: "Take something people put up with today and make it dramatically better or stranger. Think group chats, potlucks, gym memberships, dog parks, wedding planning, moving apartments, fantasy leagues, neighbourhood gossip.",
  futuristic: "Invent something that doesn't exist yet but plausibly could within 15 years. Think memory rental, mood-based city routing, sleep economies, pet translators, weather subscriptions, personal reputation escrow.",
};

/**
 * Prompt for the three-option idea picker.
 *
 * Written to fight two specific failure modes we hit in practice:
 *  1. The model reaching for tech-stack soup ("Next.js + Tailwind, GraphQL,
 *     Docker/Kubernetes templates"), which is unreadable and no fun to build.
 *  2. Bland, interchangeable SaaS dashboards.
 * Hence the hard bans and the demand for a concrete, surprising hook.
 */
function ideaOptionsPrompt(style: string, skills: string, interests: string): string {
  const brief = STYLE_BRIEFS[style] || STYLE_BRIEFS.modern;
  return `You are Nova, pitching sprint ideas to builders who have 24-72 hours and want to enjoy themselves.

THE BRIEF
${brief}

GENERATE EXACTLY 3 IDEAS. Each must be genuinely different from the other two — not three flavours of the same thing.

WHAT MAKES A GOOD IDEA HERE
- Fun first. If it sounds like homework, throw it out.
- Specific and concrete. "An app for pet owners" is nothing. "A translator that tells you what your cat's 3am screaming actually means" is something.
- Has a hook — one surprising twist a person would repeat to a friend.
- Buildable as a rough prototype in a weekend by two people.
- Slightly playful or absurd is good. Boring is the only real failure.

HARD RULES — breaking these makes the idea useless
- NEVER mention frameworks, languages, databases, cloud providers, or infrastructure. No React, Next.js, Tailwind, Node, Go, GraphQL, Postgres, Docker, Kubernetes, AWS. Not once.
- NEVER use these words: platform, solution, leverage, seamless, robust, scalable, ecosystem, synergy, empower, revolutionize, holistic, cutting-edge, state-of-the-art.
- No buzzword stacking. No em-dash-joined feature lists.
- Write like you're telling a friend at a bar, not writing a pitch deck.

FIELD RULES
- "name": 1-3 words. Memorable, sayable out loud. No CamelCase mashups like "HoloSprintCoach".
- "tagline": ONE short sentence, max 12 words. The hook.
- "pitch": 2 sentences MAX, plain English, under 40 words total. What it does and why someone would use it.
- "twist": ONE sentence on the part that makes people grin.
- "whoItsFor": 5-10 words describing a specific kind of person.
- "vibe": 1-3 words for the tone, e.g. "cozy chaos", "petty revenge", "wholesome".

Builder's skills: ${skills}
Builder's interests: ${interests}
(Nudge toward their interests where it fits naturally, but never at the cost of the idea being fun.)

Respond ONLY with valid JSON, no markdown or code fences:
{"ideas":[{"name":"","tagline":"","pitch":"","twist":"","whoItsFor":"","vibe":""}]}`;
}

interface SprintIdea {
  name: string;
  tagline: string;
  pitch: string;
  twist: string;
  whoItsFor: string;
  vibe: string;
}

/** Trims the model's output to the documented field limits. */
function normalizeIdeas(raw: any): SprintIdea[] {
  const list = Array.isArray(raw?.ideas) ? raw.ideas : Array.isArray(raw) ? raw : [];
  return list
    .slice(0, 3)
    .map((i: any) => ({
      name: String(i?.name || "").trim().slice(0, 60),
      tagline: String(i?.tagline || "").trim().slice(0, 140),
      pitch: String(i?.pitch || "").trim().slice(0, 400),
      twist: String(i?.twist || "").trim().slice(0, 240),
      whoItsFor: String(i?.whoItsFor || "").trim().slice(0, 120),
      vibe: String(i?.vibe || "").trim().slice(0, 40),
    }))
    .filter((i: SprintIdea) => i.name && i.pitch);
}

/** Flattens a chosen idea into the sprint's stored description. */
function ideaToDescription(idea: SprintIdea): string {
  return [idea.tagline, idea.pitch, idea.twist && `The twist: ${idea.twist}`]
    .filter(Boolean)
    .join(" ");
}

/**
 * Nova's ideation answers use `nova_`-prefixed question keys so the dashboard
 * can pair each one with the matching human answer, and carry isNova: true so
 * queries don't have to pattern-match on the key.
 */
const NOVA_KEY_PREFIX = "nova_";

export function novaQuestionKey(key: string): string {
  return key.startsWith(NOVA_KEY_PREFIX) ? key : `${NOVA_KEY_PREFIX}${key}`;
}

async function generatePracticeNovaContent(sprintId: string, phase: string, sprint: any, model: string) {
  const novaUserId = sprint.user1Id;

  if (phase === "ideation") {
    const questions = [
      { key: "real_problem", prompt: "What real problem does this product solve?" },
      { key: "target_user", prompt: "Who is the target user?" },
      { key: "riskiest_assumption", prompt: "What is the riskiest assumption?" },
      { key: "success_criteria", prompt: "What does success look like?" },
    ];
    try {
      const response = await getOpenAI().chat.completions.create({
        model,
        messages: [{
          role: "system",
          content: `You are Nova, an AI co-founder partner in a practice sprint for the product "${sprint.productName}": ${sprint.productDescription || ""}. Answer these ideation questions as a thoughtful, experienced co-founder would. Be specific, practical, and insightful. Respond with ONLY valid JSON: {"real_problem": "answer", "target_user": "answer", "riskiest_assumption": "answer", "success_criteria": "answer"}`
        }, {
          role: "user",
          content: questions.map(q => `${q.key}: ${q.prompt}`).join("\n")
        }],
        temperature: 0.7,
        max_completion_tokens: 2000,
      });
      const content = response.choices[0]?.message?.content || "";
      const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const answers = JSON.parse(cleaned);
      for (const q of questions) {
        if (answers[q.key]) {
          await storage.addSprintResponse({
            sprintId, userId: novaUserId, questionKey: novaQuestionKey(q.key),
            answer: answers[q.key], isNova: true,
          });
        }
      }
    } catch (err) {
      console.error("Nova ideation generation failed, seeding placeholders:", err);
      for (const q of questions) {
        await storage.addSprintResponse({
          sprintId, userId: novaUserId, questionKey: novaQuestionKey(q.key), isNova: true,
          answer: `[Nova couldn't answer "${q.prompt}" right now — try asking in chat.]`
        });
      }
    }
  }

  if (phase === "review") {
    try {
      await storage.addSprintDecision({
        sprintId, userId: novaUserId,
        decision: "proceed", reason: `${NOVA_DECISION_PREFIX} This concept has solid foundations worth pursuing further. The ideation and building phases showed clear thinking and good execution.`
      });
    } catch {}
  }
}

export function registerSprintRoutes(app: Express) {
  app.post("/api/sprints", isAuthenticated, async (req: any, res) => {
    try {
      const { partnerId, duration, productStyle } = req.body;
      if (!partnerId || !duration) {
        return res.status(400).json({ message: "Partner and duration are required" });
      }
      // Anyone can join a Sprint; starting your own is a Starter+ entitlement.
      if (!(await requireFeature(res, req.user.id, "createSprints", "Creating your own Sprints"))) return;
      const sprint = await storage.createSprint({
        user1Id: req.user.id,
        user2Id: partnerId,
        duration,
        status: "setup",
        productStyle: (["past", "modern", "futuristic"].includes(productStyle ?? "") ? productStyle : null) as "past" | "modern" | "futuristic" | null,
      });
      res.json(sprint);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create sprint" });
    }
  });

  /**
   * Three idea options for a style, so builders pick something they actually
   * want to build instead of accepting whatever the model produced first.
   *
   * Used by both the practice flow and the setup phase of a matched sprint;
   * one credit covers all three.
   */
  app.post("/api/sprints/idea-options", isAuthenticated, async (req: any, res) => {
    try {
      const { productStyle, partnerId } = req.body as { productStyle?: string; partnerId?: string };
      const style = productStyle && STYLE_BRIEFS[productStyle] ? productStyle : "modern";

      if (!(await requireFeature(res, req.user.id, "createSprints", "Nova sprint ideas"))) return;
      const ent = await requireCredits(res, req.user.id, CREDIT_COSTS.sprintIdeaSuggestion, "Nova sprint ideas");
      if (!ent) return;

      const [mine, theirs] = await Promise.all([
        storage.getUserProfile(req.user.id),
        partnerId ? storage.getUserProfile(partnerId) : null,
      ]);
      const skills = [...(mine?.skills || []), ...(theirs?.skills || [])].join(", ") || "general";
      const interests = [...(mine?.interests || []), ...(theirs?.interests || [])].join(", ") || "building things";

      const completion = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [
          { role: "system", content: ideaOptionsPrompt(style, skills, interests) },
          { role: "user", content: `Give me 3 ${style} sprint ideas. Make them fun.` },
        ],
        // High temperature on purpose: repeat visits should feel like a fresh
        // shuffle, not the same three ideas every time.
        temperature: 1,
        max_completion_tokens: 2000,
      });

      let ideas: SprintIdea[] = [];
      try {
        const raw = completion.choices[0]?.message?.content || "{}";
        const match = raw.match(/\{[\s\S]*\}/);
        ideas = normalizeIdeas(parseModelJson(raw));
      } catch (parseErr) {
        console.error("Idea options parse failed:", parseErr);
      }

      if (ideas.length === 0) {
        return res.status(502).json({ message: "Nova couldn't come up with anything good. Try again." });
      }

      await storage.deductCredits(req.user.id, CREDIT_COSTS.sprintIdeaSuggestion);
      res.json({ style, ideas, creditsCharged: CREDIT_COSTS.sprintIdeaSuggestion });
    } catch (error) {
      console.error("Idea options error:", error);
      res.status(500).json({ message: "Failed to generate ideas" });
    }
  });

  /** Locks a chosen idea onto a matched sprint during setup. */
  app.post("/api/sprints/:id/choose-idea", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      if (sprint.status !== "setup") {
        return res.status(400).json({ message: "The idea can only be set during setup" });
      }
      if (sprint.productName) {
        return res.status(409).json({ message: "This sprint already has a product" });
      }

      const { idea } = req.body as { idea?: SprintIdea };
      if (!idea?.name?.trim()) return res.status(400).json({ message: "An idea is required" });

      const updated = await storage.updateSprint(sprint.id, {
        productName: idea.name.trim().slice(0, 120),
        productDescription: ideaToDescription(idea).slice(0, 1000),
        // Both sides agreed by picking, so record it as the settled proposal.
        user1ProposedName: idea.name.trim().slice(0, 120),
        user2ProposedName: idea.name.trim().slice(0, 120),
      });
      res.json(updated);
    } catch (error) {
      console.error("Choose idea error:", error);
      res.status(500).json({ message: "Failed to set the sprint idea" });
    }
  });

  app.post("/api/sprints/practice", isAuthenticated, async (req: any, res) => {
    try {
      const { duration, productStyle, idea } = req.body as {
        duration?: string; productStyle?: string; idea?: SprintIdea;
      };
      if (!isDuration(duration)) {
        return res.status(400).json({ message: "duration must be 24h or 72h" });
      }

      if (!(await requireFeature(res, req.user.id, "createSprints", "Creating your own Sprints"))) return;
      const ent = await requireCredits(res, req.user.id, CREDIT_COSTS.practiceSprint, "a practice sprint");
      if (!ent) return;

      let productName: string;
      let productDescription: string;

      if (idea?.name?.trim()) {
        // The builder already picked from the three options, so don't spend
        // another call (or another credit) re-inventing one.
        productName = idea.name.trim().slice(0, 120);
        productDescription = ideaToDescription(idea).slice(0, 1000);
      } else {
        // No pick — fall back to generating options and taking the first.
        productName = "Practice Product";
        productDescription = "A practice sprint product idea.";
        try {
          const profile = await storage.getUserProfile(req.user.id);
          const style = productStyle && STYLE_BRIEFS[productStyle] ? productStyle : "modern";
          const response = await getOpenAI().chat.completions.create({
            model: modelFor(ent),
            messages: [
              {
                role: "system",
                content: ideaOptionsPrompt(
                  style,
                  profile?.skills?.join(", ") || "general",
                  profile?.interests?.join(", ") || "building things"
                ),
              },
              { role: "user", content: `Give me 3 ${style} sprint ideas. Make them fun.` },
            ],
            temperature: 1,
            max_completion_tokens: 2000,
          });
          // Charged only now, with the model's answer in hand. A failed call costs nothing.
          await storage.deductCredits(req.user.id, CREDIT_COSTS.practiceSprint);
          const raw = response.choices[0]?.message?.content || "{}";
          const match = raw.match(/\{[\s\S]*\}/);
          const [first] = normalizeIdeas(parseModelJson(raw));
          if (first) {
            productName = first.name;
            productDescription = ideaToDescription(first);
          }
        } catch (ideaErr) {
          console.error("Practice idea generation failed, using placeholder:", ideaErr);
        }
      }

      const sprint = await storage.createSprint({
        user1Id: req.user.id,
        // Practice sprints have no second human; Nova stands in as the partner
        // and its contributions are flagged with isNova.
        user2Id: req.user.id,
        duration,
        status: "setup",
        productStyle: (["past", "modern", "futuristic"].includes(productStyle ?? "") ? productStyle : null) as "past" | "modern" | "futuristic" | null,
        productName,
        productDescription,
        isPractice: true,
      });

      // Nova opens the conversation so the sprint doesn't start on an empty
      // chat — this is what makes it feel like a partner rather than a form.
      try {
        await storage.sendSprintMessage({
          sprintId: sprint.id,
          userId: req.user.id,
          isNova: true,
          content:
            `Hey — I'm in. I've been thinking about **${productName}**: ${productDescription}\n\n` +
            `Before we build anything, I want us to agree on the one problem this solves. ` +
            `What's your read on who feels this pain most acutely?`,
        } as any);
      } catch (msgErr) {
        console.error("Failed to seed Nova opening message (non-fatal):", msgErr);
      }

      res.json({ ...sprint, creditsCharged: CREDIT_COSTS.practiceSprint });
    } catch (error: any) {
      console.error("Practice sprint error:", error);
      res.status(500).json({ message: "Failed to create practice sprint" });
    }
  });

  /**
   * Nova replies as the practice partner.
   *
   * Only valid on practice sprints — on a real sprint the partner is a human
   * and Nova must not speak for them.
   */
  app.post("/api/sprints/:id/nova-reply", isAuthenticated, async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      if (!sprint.isPractice) {
        return res.status(400).json({ message: "Nova only stands in as a partner on practice sprints." });
      }

      const ent = await requireCredits(res, req.user.id, CREDIT_COSTS.novaPartnerReply, "a Nova partner reply");
      if (!ent) return;

      const history = await storage.getSprintMessages(req.params.id);
      // Nova's memory of the sprint conversation scales with the plan.
      const recent = history.slice(-memoryLimitFor(ent));

      const completion = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [
          { role: "system", content: novaPartnerSystemPrompt(sprint, coachingDirectiveFor(ent)) },
          ...recent.map((m: any) => ({
            role: (m.isNova ? "assistant" : "user") as "assistant" | "user",
            content: m.content,
          })),
        ],
        temperature: 0.8,
        max_completion_tokens: 1500,
      });

      const content = completion.choices[0]?.message?.content?.trim();
      if (!content) return res.status(502).json({ message: "Nova didn't respond. Try again." });

      const message = await storage.sendSprintMessage({
        sprintId: req.params.id,
        userId: req.user.id,
        isNova: true,
        content,
      } as any);

      await storage.deductCredits(req.user.id, CREDIT_COSTS.novaPartnerReply);
      res.json({ message, creditsCharged: CREDIT_COSTS.novaPartnerReply });
    } catch (error) {
      console.error("Nova reply error:", error);
      res.status(500).json({ message: "Failed to get a reply from Nova" });
    }
  });

  /**
   * Nova answers the current phase's ideation questions as the partner, so a
   * solo builder still has two sets of answers to align against.
   */
  app.post("/api/sprints/:id/nova-answers", isAuthenticated, async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      if (!sprint.isPractice) {
        return res.status(400).json({ message: "Nova only answers on practice sprints." });
      }

      const { questionKeys } = req.body as { questionKeys?: string[] };
      if (!Array.isArray(questionKeys) || questionKeys.length === 0) {
        return res.status(400).json({ message: "questionKeys is required" });
      }

      const ent = await requireCredits(res, req.user.id, CREDIT_COSTS.novaPartnerAnswers, "Nova's sprint answers");
      if (!ent) return;

      const existing = await storage.getSprintResponses(req.params.id);
      const mine = existing.filter((r: any) => !r.isNova);

      const completion = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [
          {
            role: "system",
            content: `${novaPartnerSystemPrompt(sprint, coachingDirectiveFor(ent))}

Answer each question as the partner would — concretely and with a point of view. Where you'd genuinely disagree with your partner's answer, say so; alignment is measured by comparing both sets of answers, and fake agreement makes that measurement worthless.

Respond ONLY with valid JSON (no markdown, no code fences):
{ "answers": [ { "questionKey": "<the exact key given>", "answer": "2-4 sentences" } ] }`,
          },
          {
            role: "user",
            content: [
              `QUESTION KEYS TO ANSWER\n${questionKeys.join("\n")}`,
              mine.length
                ? `YOUR PARTNER'S ANSWERS SO FAR\n${mine.map((r: any) => `${r.questionKey}: ${r.answer}`).join("\n")}`
                : "Your partner hasn't answered yet.",
            ].join("\n\n"),
          },
        ],
        temperature: 0.8,
      });

      let parsed: { answers?: { questionKey?: string; answer?: string }[] };
      try {
        const raw = completion.choices[0]?.message?.content || "{}";
        const match = raw.match(/\{[\s\S]*\}/);
        parsed = parseModelJson(raw);
      } catch (parseErr) {
        console.error("Nova answers parse failed:", parseErr);
        return res.status(502).json({ message: "Nova's answers came back unreadable. Try again." });
      }

      const allowed = new Set(questionKeys);
      const saved = [];
      for (const a of parsed.answers || []) {
        if (!a.questionKey || !a.answer || !allowed.has(a.questionKey)) continue;
        saved.push(
          await storage.addSprintResponse({
            sprintId: req.params.id,
            userId: req.user.id,
            // Prefixed so the dashboard pairs it with the human's answer.
            questionKey: novaQuestionKey(a.questionKey),
            answer: String(a.answer).slice(0, 4000),
            isNova: true,
          })
        );
      }

      if (saved.length === 0) {
        return res.status(502).json({ message: "Nova didn't return usable answers. Try again." });
      }

      await storage.deductCredits(req.user.id, CREDIT_COSTS.novaPartnerAnswers);
      res.json({ answers: saved, creditsCharged: CREDIT_COSTS.novaPartnerAnswers });
    } catch (error) {
      console.error("Nova answers error:", error);
      res.status(500).json({ message: "Failed to get Nova's answers" });
    }
  });

  app.get("/api/sprints", isAuthenticated, async (req: any, res) => {
    try {
      const sprints = await storage.getSprintsByUser(req.user.id);
      res.json(sprints);
    } catch (error) {
      res.status(500).json({ message: "Failed to get sprints" });
    }
  });

  app.get("/api/sprints/:id", isAuthenticated, async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant of this sprint" });
      }
      const [u1] = await Promise.all([
        storage.getUser(sprint.user1Id),
        storage.getUser(sprint.user2Id),
      ]);
      const user1 = await storage.getUser(sprint.user1Id);
      const user2 = await storage.getUser(sprint.user2Id);
      res.json({ ...sprint, user1, user2 });
    } catch (error) {
      res.status(500).json({ message: "Failed to get sprint" });
    }
  });

  app.post("/api/sprints/:id/advance", isAuthenticated, async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      const nextPhase = getNextPhase(sprint.status, sprint.duration);
      if (!nextPhase) return res.status(400).json({ message: "Sprint is already completed" });

      const updateData: any = { status: nextPhase };
      if (nextPhase === "ideation" && !sprint.startedAt) {
        updateData.startedAt = new Date();
      }
      if (nextPhase === "completed") {
        updateData.completedAt = new Date();
      }

      const updated = await storage.updateSprint(sprint.id, updateData);

      if (nextPhase === "building") {
        const tasks = sprint.duration === "72h"
          ? [...SPRINT_24H_TASKS, ...SPRINT_72H_EXTRA_TASKS]
          : SPRINT_24H_TASKS;
        for (const t of tasks) {
          await storage.createSprintTask({ sprintId: sprint.id, ...t });
        }
      }

      /*
       * On a practice sprint, Nova produces the partner's side of the new
       * phase. This runs in the background so advancing stays snappy, and the
       * credit is charged up front — if the builder can't afford it the phase
       * still advances, they just don't get Nova's contribution.
       */
      let novaCharged = 0;
      if (sprint.isPractice) {
        const ent = await getUserEntitlements(req.user.id);
        if (await storage.checkCredits(req.user.id, CREDIT_COSTS.novaPartnerAnswers)) {
          await storage.deductCredits(req.user.id, CREDIT_COSTS.novaPartnerAnswers);
          novaCharged = CREDIT_COSTS.novaPartnerAnswers;
          generatePracticeNovaContent(sprint.id, nextPhase, sprint, modelFor(ent)).catch(err =>
            console.error("Practice Nova content error:", err)
          );
        } else {
          console.log(`Skipping Nova phase content for sprint ${sprint.id}: insufficient credits`);
        }
      }

      res.json({ ...updated, novaCreditsCharged: novaCharged });
    } catch (error) {
      console.error("Advance sprint error:", error);
      res.status(500).json({ message: "Failed to advance sprint" });
    }
  });

  app.post("/api/sprints/:id/responses", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      const { questionKey, answer } = req.body;
      if (!questionKey || !answer) return res.status(400).json({ message: "Question key and answer required" });
      const response = await storage.addSprintResponse({
        sprintId: sprint.id, userId: req.user.id, questionKey, answer
      });
      res.json(response);
    } catch (error) {
      res.status(500).json({ message: "Failed to submit response" });
    }
  });

  app.get("/api/sprints/:id/responses", isAuthenticated, async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      const phaseIdx = SPRINT_PHASES.indexOf(sprint.status as any);
      const alignmentIdx = SPRINT_PHASES.indexOf("alignment");
      if (phaseIdx < alignmentIdx) {
        const responses = await storage.getSprintResponses(sprint.id, req.user.id);
        return res.json(responses);
      }
      const responses = await storage.getSprintResponses(sprint.id);
      res.json(responses);
    } catch (error) {
      res.status(500).json({ message: "Failed to get responses" });
    }
  });

  app.post("/api/sprints/:id/deliverables", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      const { type, content } = req.body;
      const deliverable = await storage.addSprintDeliverable({
        sprintId: sprint.id, type, content, userId: req.user.id
      });
      res.json(deliverable);
    } catch (error) {
      res.status(500).json({ message: "Failed to submit deliverable" });
    }
  });

  app.get("/api/sprints/:id/deliverables", isAuthenticated, async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      const deliverables = await storage.getSprintDeliverables(sprint.id);
      res.json(deliverables);
    } catch (error) {
      res.status(500).json({ message: "Failed to get deliverables" });
    }
  });

  app.post("/api/sprints/:id/messages", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      const msg = await storage.sendSprintMessage({
        sprintId: sprint.id, userId: req.user.id, content: req.body.content
      });
      res.json(msg);
    } catch (error) {
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  app.get("/api/sprints/:id/messages", isAuthenticated, async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      const messages = await storage.getSprintMessages(sprint.id);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ message: "Failed to get messages" });
    }
  });

  app.get("/api/sprints/:id/tasks", isAuthenticated, async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      const tasks = await storage.getSprintTasks(sprint.id);
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ message: "Failed to get tasks" });
    }
  });

  app.post("/api/sprints/:id/tasks", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      const task = await storage.createSprintTask({ sprintId: sprint.id, ...req.body });
      res.json(task);
    } catch (error) {
      res.status(500).json({ message: "Failed to create task" });
    }
  });

  app.patch("/api/sprints/:id/tasks/:taskId", isAuthenticated, async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      const task = await storage.updateSprintTask(req.params.taskId, req.body);
      res.json(task);
    } catch (error) {
      res.status(500).json({ message: "Failed to update task" });
    }
  });

  app.post("/api/sprints/:id/decisions", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      const { decision, reason } = req.body;
      if (!decision || !reason) return res.status(400).json({ message: "Decision and reason required" });
      const dec = await storage.addSprintDecision({
        sprintId: sprint.id, userId: req.user.id, decision, reason
      });
      res.json(dec);
    } catch (error) {
      res.status(500).json({ message: "Failed to submit decision" });
    }
  });

  app.post("/api/sprints/:id/ratings", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      const partnerId = sprint.user1Id === req.user.id ? sprint.user2Id : sprint.user1Id;
      const rating = await storage.addSprintRating({
        sprintId: sprint.id,
        raterId: req.user.id,
        rateeId: partnerId,
        ...req.body,
      });
      res.json(rating);
    } catch (error) {
      res.status(500).json({ message: "Failed to submit rating" });
    }
  });

  app.post("/api/sprints/:id/update-alignment", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      const { agreedProblem, agreedIcp, agreedValueProp, validationQuestions } = req.body;
      const updated = await storage.updateSprint(sprint.id, {
        agreedProblem, agreedIcp, agreedValueProp, validationQuestions
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update alignment" });
    }
  });

  app.post("/api/sprints/nova-suggest", isAuthenticated, async (req: any, res) => {
    try {
      const { productStyle, partnerId } = req.body;
      const ent = await requireCredits(res, req.user.id, CREDIT_COSTS.sprintIdeaSuggestion, "a Nova product idea");
      if (!ent) return;

      const [profile1, profile2] = await Promise.all([
        storage.getUserProfile(req.user.id),
        partnerId ? storage.getUserProfile(partnerId) : null,
      ]);

      const styleDesc = {
        past: "an innovative reimagining of a past product/concept that could be modernized",
        modern: "an improvement or innovation on a current modern-day product or service",
        futuristic: "a product that doesn't exist yet but could in the future",
      }[(["past", "modern", "futuristic"].includes(productStyle ?? "") ? productStyle : "modern") as "past" | "modern" | "futuristic"];

      const response = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [{
          role: "system",
          content: `You are Nova, a creative product ideation assistant. Suggest ${styleDesc}. Consider the builders' skills and interests. Respond with ONLY valid JSON: {"name": "Product Name", "description": "2-3 sentence description of the product idea"}`
        }, {
          role: "user",
          content: `Builder 1 skills: ${profile1?.skills?.join(", ") || "general"}. Interests: ${profile1?.interests?.join(", ") || "technology"}.\n${profile2 ? `Builder 2 skills: ${profile2.skills?.join(", ") || "general"}. Interests: ${profile2.interests?.join(", ") || "technology"}.` : ""}\nProduct style: ${productStyle || "modern"}`
        }],
        temperature: 0.9,
        max_completion_tokens: 1200,
      });
      // Charged only now, with the model's answer in hand. A failed call costs nothing.
      await storage.deductCredits(req.user.id, CREDIT_COSTS.sprintIdeaSuggestion);

      const content = response.choices[0]?.message?.content || "";
      try {
        const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const suggestion = JSON.parse(cleaned);
        res.json(suggestion);
      } catch {
        res.json({ name: "Innovative Product", description: content.substring(0, 200) });
      }
    } catch (error: any) {
      console.error("Nova suggest error:", error);
      res.status(500).json({ message: "Failed to generate suggestion" });
    }
  });

  app.post("/api/sprints/:id/generate-report", isAuthenticated, async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }

      const ent = await requireCredits(res, req.user.id, CREDIT_COSTS.sprintReport, "a sprint compatibility report");
      if (!ent) return;

      const [responses, deliverables, ratings, decisions, metrics, user1, user2] = await Promise.all([
        storage.getSprintResponses(sprint.id),
        storage.getSprintDeliverables(sprint.id),
        storage.getSprintRatings(sprint.id),
        storage.getSprintDecisions(sprint.id),
        storage.getSprintBehavioralMetrics(sprint.id),
        storage.getUser(sprint.user1Id),
        storage.getUser(sprint.user2Id),
      ]);

      const user1Name = user1?.firstName || "Builder 1";
      const user2Name = user2?.firstName || "Builder 2";

      const promptData = `
Sprint Duration: ${sprint.duration}
Product: ${sprint.productName || "N/A"} - ${sprint.productDescription || "N/A"}
Style: ${sprint.productStyle || "N/A"}

Private Responses (${user1Name}): ${JSON.stringify(responses.filter(r => r.userId === sprint.user1Id).map(r => ({ q: r.questionKey, a: r.answer })))}
Private Responses (${user2Name}): ${JSON.stringify(responses.filter(r => r.userId === sprint.user2Id).map(r => ({ q: r.questionKey, a: r.answer })))}

Agreed Problem: ${sprint.agreedProblem || "N/A"}
Agreed ICP: ${sprint.agreedIcp || "N/A"}
Agreed Value Prop: ${sprint.agreedValueProp || "N/A"}

Deliverables: ${JSON.stringify(deliverables.map(d => ({ type: d.type, content: d.content })))}

Decisions:
${decisions.map(d => `${d.userId === sprint.user1Id ? user1Name : user2Name}: ${d.decision} - ${d.reason}`).join("\n")}

Ratings:
${ratings.map(r => {
  const raterName = r.raterId === sprint.user1Id ? user1Name : user2Name;
  return `${raterName} rated partner: Communication ${r.communicationClarity}/5, Reliability ${r.reliability}/5, Would build long-term: ${r.wouldBuildLongTerm}, Stress: ${r.stressLevel}/5`;
}).join("\n")}

Behavioral Metrics:
${metrics.map(m => {
  const name = m.userId === sprint.user1Id ? user1Name : user2Name;
  return `${name}: Tasks ${m.tasksCompleted}/${m.totalTasks}, Avg response ${m.avgResponseTimeMinutes}min, Initiative ${m.initiativeScore}/100`;
}).join("\n")}`;

      const aiResponse = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [{
          role: "system",
          content: `You are Nova, a co-founder compatibility analyst. Analyze the sprint collaboration data and generate a compatibility report. Respond with ONLY valid JSON:
{
  "overallScore": <number 0-100>,
  "strengths": ["strength1", "strength2", "strength3"],
  "risks": ["risk1", "risk2"],
  "recommendation": "A 2-3 sentence recommendation about whether these builders should co-found together and what to watch out for."
}`
        }, {
          role: "user",
          content: promptData
        }],
        temperature: 0.7,
        max_completion_tokens: 2000,
      });
      // Charged only now, with the model's answer in hand. A failed call costs nothing.
      await storage.deductCredits(req.user.id, CREDIT_COSTS.sprintReport);

      const reportContent = aiResponse.choices[0]?.message?.content || "";
      let reportData;
      try {
        const cleaned = reportContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        reportData = JSON.parse(cleaned);
      } catch {
        reportData = { overallScore: 50, strengths: ["Completed the sprint"], risks: ["Insufficient data for full analysis"], recommendation: reportContent.substring(0, 300) };
      }

      const report = await storage.saveCompatibilityReport({
        sprintId: sprint.id,
        overallScore: reportData.overallScore,
        strengths: reportData.strengths,
        risks: reportData.risks,
        recommendation: reportData.recommendation,
      });

      res.json(report);
    } catch (error: any) {
      console.error("Report generation error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  app.get("/api/sprints/:id/report", isAuthenticated, async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      const report = await storage.getCompatibilityReport(sprint.id);
      res.json(report || null);
    } catch (error) {
      res.status(500).json({ message: "Failed to get report" });
    }
  });

  app.post("/api/sprints/:id/convert", isAuthenticated, async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      if (!sprint.productName) return res.status(400).json({ message: "No product defined" });

      const project = await storage.createProject({
        ownerId: req.user.id,
        title: sprint.productName,
        description: sprint.productDescription || "",
        category: "Web App",
        // A sprint exists to get a first version built, which is one path.
        goal: "ship_mvp",
        subcategory: "app",
        status: "planning",
        teamSize: 2,
        estimatedWeeks: 8,
      });

      const partnerId = sprint.user1Id === req.user.id ? sprint.user2Id : sprint.user1Id;
      await db.insert(projectMembers).values({ projectId: project.id, userId: partnerId, role: "Co-Founder" });

      if (sprint.agreedProblem) {
        await storage.updateProject(project.id, { problemStatement: sprint.agreedProblem });
      }
      if (sprint.agreedValueProp) {
        await storage.updateProject(project.id, { valueProposition: sprint.agreedValueProp });
      }
      if (sprint.agreedIcp) {
        await storage.updateProject(project.id, { targetCustomerProfile: sprint.agreedIcp });
      }

      res.json(project);
    } catch (error) {
      res.status(500).json({ message: "Failed to convert to project" });
    }
  });

  /** Join the matchmaking queue, attempting an immediate pairing. */
  app.post("/api/sprints/queue", isAuthenticated, async (req: any, res) => {
    try {
      const { duration, productStyle, projectId } = req.body;
      if (!isDuration(duration)) {
        return res.status(400).json({ message: "duration must be 24h or 72h" });
      }
      if (!(await requireFeature(res, req.user.id, "createSprints", "Starting a Sprint"))) return;

      // Only let someone bring a project they actually belong to.
      let sourceProjectId: string | null = null;
      if (projectId) {
        const project = await storage.getProject(projectId);
        const members = project ? await storage.getProjectMembers(projectId).catch(() => []) : [];
        const isMember = project && (project.ownerId === req.user.id || members.some((m) => m.userId === req.user.id));
        if (!isMember) return res.status(403).json({ message: "You're not a member of that project" });
        sourceProjectId = projectId;
      }

      // Drop abandoned rows first so we never pair with a closed tab.
      await storage.sweepStaleQueueEntries();
      await storage.joinMatchmakingQueue({ userId: req.user.id, duration, productStyle, projectId: sourceProjectId });

      const match = await storage.tryMatchInQueue(req.user.id);
      if (match) {
        const enriched = await withParticipants(match.sprint);
        // Both queue rows are already marked matched; clear ours now that we
        // know. The partner's row clears on their next poll.
        await storage.removeFromMatchmakingQueue(req.user.id);
        return res.json({ matched: true, sprint: enriched });
      }

      const stats = await storage.getQueueStats(req.user.id, duration);
      res.json({
        matched: false,
        message: "You're in the queue. We'll pair you as soon as a partner picks the same duration.",
        ...stats,
      });
    } catch (error) {
      console.error("Join queue error:", error);
      res.status(500).json({ message: "Failed to join queue" });
    }
  });

  /**
   * Polled by the waiting room. Doubles as the heartbeat that keeps the
   * caller's queue row alive, and reports position so waiting feels bounded.
   */
  app.get("/api/sprints/queue/status", isAuthenticated, async (req: any, res) => {
    try {
      const entry = await storage.getQueueEntry(req.user.id);
      if (!entry) return res.json({ inQueue: false, matched: false });

      // Someone else's tryMatchInQueue already paired us — hand over the sprint.
      if (entry.status === "matched" && entry.matchedSprintId) {
        const sprint = await storage.getSprint(entry.matchedSprintId);
        await storage.removeFromMatchmakingQueue(req.user.id);
        if (sprint) {
          return res.json({ inQueue: false, matched: true, sprint: await withParticipants(sprint) });
        }
        return res.json({ inQueue: false, matched: false });
      }

      await storage.touchQueueEntry(req.user.id);
      await storage.sweepStaleQueueEntries();

      // Try to pair on every poll, so two people waiting simultaneously get
      // matched even if neither joined after the other.
      const match = await storage.tryMatchInQueue(req.user.id);
      if (match) {
        await storage.removeFromMatchmakingQueue(req.user.id);
        return res.json({ inQueue: false, matched: true, sprint: await withParticipants(match.sprint) });
      }

      const stats = await storage.getQueueStats(req.user.id, entry.duration);
      res.json({
        inQueue: true,
        matched: false,
        entry,
        ...stats,
        waitingSeconds: Math.max(0, Math.floor((Date.now() - new Date(entry.createdAt).getTime()) / 1000)),
      });
    } catch (error) {
      console.error("Queue status error:", error);
      res.status(500).json({ message: "Failed to check queue" });
    }
  });

  app.delete("/api/sprints/queue", isAuthenticated, async (req: any, res) => {
    try {
      await storage.removeFromMatchmakingQueue(req.user.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to leave queue" });
    }
  });

  app.post("/api/sprints/:id/propose-name", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      if (sprint.status !== "setup") {
        return res.status(400).json({ message: "Can only propose names during setup" });
      }
      if (sprint.productName) {
        return res.status(400).json({ message: "Product name already selected" });
      }

      const { name } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ message: "Name required" });

      const isUser1 = sprint.user1Id === req.user.id;
      const updateData: any = isUser1
        ? { user1ProposedName: name.trim() }
        : { user2ProposedName: name.trim() };

      const otherProposed = isUser1 ? sprint.user2ProposedName : sprint.user1ProposedName;
      if (otherProposed) {
        const names = [name.trim(), otherProposed];
        const chosen = names[Math.floor(Math.random() * 2)];
        updateData.productName = chosen;
      }

      const updated = await storage.updateSprint(sprint.id, updateData);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to propose name" });
    }
  });

  app.get("/api/sprints/:id/decisions", isAuthenticated, async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      const decisions = await storage.getSprintDecisions(sprint.id);
      res.json(decisions);
    } catch (error) {
      res.status(500).json({ message: "Failed to get decisions" });
    }
  });

  app.get("/api/sprints/:id/ratings", isAuthenticated, async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.status !== "completed") {
        return res.status(400).json({ message: "Ratings only visible after sprint completion" });
      }
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      const ratings = await storage.getSprintRatings(sprint.id);
      res.json(ratings);
    } catch (error) {
      res.status(500).json({ message: "Failed to get ratings" });
    }
  });

  app.get("/api/sprints/:id/metrics", isAuthenticated, async (req: any, res) => {
    try {
      const sprint = await storage.getSprint(req.params.id);
      if (!sprint) return res.status(404).json({ message: "Sprint not found" });
      if (sprint.user1Id !== req.user.id && sprint.user2Id !== req.user.id) {
        return res.status(403).json({ message: "Not a participant" });
      }
      const metrics = await storage.getSprintBehavioralMetrics(sprint.id);
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ message: "Failed to get metrics" });
    }
  });
}
