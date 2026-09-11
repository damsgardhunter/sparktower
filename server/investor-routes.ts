/**
 * Investor readiness suite.
 *
 * Four related tools, all Builder-tier and above, all grounded in the project
 * brief so the output is about *this* project rather than generic advice:
 *   - Pitch deck outline (8 credits)
 *   - Investor readiness score (5 credits)
 *   - Mock investor interview (1 credit per question, 2 to grade an answer)
 *   - Pitch critique (5 credits)
 */
import type { Express, Response } from "express";
import OpenAI from "openai";
import { storage } from "./storage";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { requireFeature, requireCredits, modelFor, coachingDirectiveFor } from "./entitlements";
import { CREDIT_COSTS } from "@shared/plans";
import { formatProjectBriefForPrompt } from "@shared/project-sections";
import type { Project } from "@shared/schema";
import { rateLimit } from "./moderation";
import { parseModelJson, ModelResponseError, answerUnreadable } from "./ai-json";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const raw = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const baseURL = raw ? (raw.endsWith("/v1") ? raw : `${raw.replace(/\/$/, "")}/v1`) : undefined;
    _openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL });
  }
  return _openai;
}

/** Parses a JSON object out of a model response that may be fenced. */
function parseJsonObject(raw: string): any {
  const match = raw.match(/\{[\s\S]*\}/);
  return parseModelJson(raw);
}

const INVESTOR_PERSONAS = [
  { id: "seed_generalist", label: "Seed generalist", brief: "A pragmatic seed investor who writes $250k-$1M checks. Cares about founder-market fit, whether the problem is real, and whether this can get to a Series A story." },
  { id: "technical_vc", label: "Technical VC", brief: "A former engineer turned investor. Pushes hard on how it actually works, what's genuinely difficult, and why a competitor can't rebuild it in a month." },
  { id: "growth_focused", label: "Growth-focused", brief: "Obsessed with distribution and unit economics. Wants channels, CAC, retention curves, and evidence you can acquire users repeatably." },
  { id: "skeptical_angel", label: "Skeptical angel", brief: "An operator-angel who has seen a hundred versions of this. Blunt, allergic to hand-waving, and will name the thing you're avoiding." },
];

const DIFFICULTY_BRIEFS: Record<string, string> = {
  friendly: "Be encouraging but still substantive. Ask real questions; accept a reasonable answer without piling on.",
  skeptical: "Be genuinely skeptical. Probe weak answers with a follow-up. Don't accept vague claims — ask for the number or the evidence.",
  brutal: "Be relentless. Interrupt hand-waving, name evasions directly, and go straight at the weakest part of the story. Never cruel, but never let anything slide.",
};

/** Loads the project and verifies membership. Writes the error response itself. */
async function loadProjectForMember(
  res: Response,
  userId: string,
  projectId: string
): Promise<Project | null> {
  const project = await storage.getProject(projectId);
  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return null;
  }
  const members = await storage.getProjectMembers(projectId).catch(() => []);
  const isMember = project.ownerId === userId || members.some((m) => m.userId === userId);
  if (!isMember) {
    res.status(403).json({ message: "Not a project member" });
    return null;
  }
  return project;
}

export function registerInvestorRoutes(app: Express) {
  /** Everything the suite has produced for a project. */
  app.get("/api/projects/:id/investor-artifacts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const project = await loadProjectForMember(res, userId, req.params.id);
      if (!project) return;

      const [artifacts, interviews] = await Promise.all([
        storage.getInvestorArtifacts(req.params.id),
        storage.getMockInterviews(req.params.id, userId),
      ]);
      res.json({ artifacts, interviews, costs: CREDIT_COSTS });
    } catch (error) {
      console.error("Investor artifacts error:", error);
      res.status(500).json({ message: "Failed to load investor tools" });
    }
  });

  // -----------------------------------------------------------------------
  // Pitch deck outline — 8 credits
  // -----------------------------------------------------------------------
  app.post("/api/projects/:id/pitch-deck", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const project = await loadProjectForMember(res, userId, req.params.id);
      if (!project) return;

      const ent = await requireFeature(res, userId, "aiRoadmap", "Pitch deck outlines");
      if (!ent) return;
      if (!(await requireCredits(res, userId, CREDIT_COSTS.pitchDeckOutline, "a pitch deck outline"))) return;

      const roadmap = await storage.getProjectRoadmap(req.params.id).catch(() => undefined);

      const completion = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [
          {
            role: "system",
            content: `You are Nova, outlining a seed pitch deck for a real founder. ${coachingDirectiveFor(ent)}

Produce 10-12 slides in the order they should be presented. For each slide give the headline the founder should literally put on it, the 2-4 bullets that belong on it, and a short note on what to say out loud.

Be specific to THIS project. Where the brief doesn't give you what a slide needs (traction numbers, market size, team credentials), say plainly what they need to go find — do not invent figures.

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "summary": "2-3 sentences on the story this deck tells.",
  "slides": [
    {
      "number": 1,
      "purpose": "e.g. Title, Problem, Solution, Market, Traction, Business Model, Competition, Team, Roadmap, Ask",
      "headline": "The actual headline for the slide",
      "bullets": ["", ""],
      "speakerNote": "One or two sentences on delivery.",
      "missingData": "What they need to gather for this slide, or null"
    }
  ]
}`,
          },
          {
            role: "user",
            content: [
              `PROJECT BRIEF\n${formatProjectBriefForPrompt(project)}`,
              roadmap ? `ROADMAP\nGoal: ${roadmap.goal}\n${roadmap.phases.map((p) => `- ${p.title} [${p.status}]`).join("\n")}` : "",
            ].filter(Boolean).join("\n\n"),
          },
        ],
      });

      let parsed: any;
      try {
        parsed = parseJsonObject(completion.choices[0].message.content ?? "");
      } catch (err) {
        console.error("Pitch deck parse failed:", err);
        return res.status(502).json({ message: "Nova's outline came back unreadable. Try again." });
      }

      const slides = (Array.isArray(parsed.slides) ? parsed.slides : []).slice(0, 14).map((s: any, i: number) => ({
        number: Number(s?.number) || i + 1,
        purpose: String(s?.purpose || "").slice(0, 80),
        headline: String(s?.headline || "").slice(0, 200),
        bullets: Array.isArray(s?.bullets) ? s.bullets.map(String).slice(0, 5) : [],
        speakerNote: String(s?.speakerNote || "").slice(0, 500),
        missingData: s?.missingData ? String(s.missingData).slice(0, 300) : null,
      })).filter((s: any) => s.headline);

      if (slides.length === 0) {
        return res.status(502).json({ message: "Nova couldn't build an outline. Try again." });
      }

      const artifact = await storage.createInvestorArtifact({
        projectId: req.params.id,
        userId,
        kind: "deck_outline",
        summary: String(parsed.summary || ""),
        content: { slides },
        creditsCharged: CREDIT_COSTS.pitchDeckOutline,
      });

      await storage.deductCredits(userId, CREDIT_COSTS.pitchDeckOutline);
      res.json({ artifact, creditsCharged: CREDIT_COSTS.pitchDeckOutline });
    } catch (error) {
      console.error("Pitch deck error:", error);
      res.status(500).json({ message: "Failed to build a pitch deck outline" });
    }
  });

  // -----------------------------------------------------------------------
  // Investor readiness score — 5 credits
  // -----------------------------------------------------------------------
  app.post("/api/projects/:id/readiness-score", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const project = await loadProjectForMember(res, userId, req.params.id);
      if (!project) return;

      const ent = await requireFeature(res, userId, "aiRoadmap", "Investor readiness scoring");
      if (!ent) return;
      if (!(await requireCredits(res, userId, CREDIT_COSTS.investorReadinessScore, "an investor readiness score"))) return;

      const [roadmap, milestones, members, tasks] = await Promise.all([
        storage.getProjectRoadmap(req.params.id).catch(() => undefined),
        storage.getProjectMilestones(req.params.id).catch(() => []),
        storage.getProjectMembers(req.params.id).catch(() => []),
        storage.getProjectKanbanTasks(req.params.id).catch(() => []),
      ]);

      const completion = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [
          {
            role: "system",
            content: `You are Nova, scoring how ready a project is to raise from investors. ${coachingDirectiveFor(ent)}

Be honest. An inflated score is worse than useless — it sends founders into meetings unprepared. Most early projects should land between 20 and 55.

Score these six categories 0-100 each, then give an overall score. Overall is NOT a simple average: weight Problem clarity and Evidence highest, because those are what kill seed conversations.

Categories: "Problem clarity", "Solution differentiation", "Market understanding", "Evidence & traction", "Team", "Narrative & ask".

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "overall": 0-100,
  "verdict": "not-ready" | "early" | "getting-close" | "ready",
  "summary": "2-3 blunt sentences on where they stand.",
  "categories": [ { "name": "", "score": 0-100, "finding": "What's true today.", "toImprove": "The single most valuable thing to fix." } ],
  "blockers": ["The 2-3 things that would sink a real investor meeting right now."]
}`,
          },
          {
            role: "user",
            content: [
              `PROJECT BRIEF\n${formatProjectBriefForPrompt(project)}`,
              `TEAM\n${members.length} of ${project.teamSize ?? "?"} seats filled`,
              `EXECUTION\n${tasks.length} tasks (${tasks.filter((t: any) => t.status === "done").length} done), ${milestones.length} milestones`,
              roadmap ? `ROADMAP\nGoal: ${roadmap.goal}\n${roadmap.phases.map((p) => `- ${p.title} [${p.status}]`).join("\n")}` : "ROADMAP\nnone",
              `LINKS\nRepo: ${project.repoUrl || "none"} · Live: ${project.liveUrl || "none"} · Traction: ${(project as any).externalTractionUrl || "none"}`,
            ].join("\n\n"),
          },
        ],
      });

      let parsed: any;
      try {
        // No `|| "{}"`: an empty answer is unreadable, not an empty result — it used to parse as {} and be charged.
        parsed = parseJsonObject(completion.choices[0].message.content ?? "");
      } catch (err) {
        console.error("Readiness score parse failed:", err);
        return res.status(502).json({ message: "Nova's score came back unreadable. Try again.", code: "model_unreadable" });
      }

      const overall = Math.max(0, Math.min(100, Number(parsed.overall) || 0));
      const artifact = await storage.createInvestorArtifact({
        projectId: req.params.id,
        userId,
        kind: "readiness_score",
        score: overall,
        summary: String(parsed.summary || ""),
        content: {
          verdict: ["not-ready", "early", "getting-close", "ready"].includes(parsed.verdict) ? parsed.verdict : "early",
          categories: (Array.isArray(parsed.categories) ? parsed.categories : []).slice(0, 8).map((c: any) => ({
            name: String(c?.name || "").slice(0, 60),
            score: Math.max(0, Math.min(100, Number(c?.score) || 0)),
            finding: String(c?.finding || "").slice(0, 500),
            toImprove: String(c?.toImprove || "").slice(0, 500),
          })),
          blockers: (Array.isArray(parsed.blockers) ? parsed.blockers : []).map(String).slice(0, 5),
        },
        creditsCharged: CREDIT_COSTS.investorReadinessScore,
      });

      await storage.deductCredits(userId, CREDIT_COSTS.investorReadinessScore);
      res.json({ artifact, creditsCharged: CREDIT_COSTS.investorReadinessScore });
    } catch (error) {
      console.error("Readiness score error:", error);
      res.status(500).json({ message: "Failed to score investor readiness" });
    }
  });

  // -----------------------------------------------------------------------
  // Pitch critique — 5 credits
  // -----------------------------------------------------------------------
  app.post("/api/projects/:id/pitch-critique", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const project = await loadProjectForMember(res, userId, req.params.id);
      if (!project) return;

      const { pitch } = req.body as { pitch?: string };
      if (!pitch?.trim()) {
        return res.status(400).json({ message: "Paste the pitch you want critiqued." });
      }
      if (pitch.length > 8000) {
        return res.status(400).json({ message: "That pitch is too long — trim it to 8000 characters." });
      }

      const ent = await requireFeature(res, userId, "aiRoadmap", "Pitch critiques");
      if (!ent) return;
      if (!(await requireCredits(res, userId, CREDIT_COSTS.pitchCritique, "a pitch critique"))) return;

      const completion = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [
          {
            role: "system",
            content: `You are Nova, critiquing a founder's pitch the way a good investor would after the meeting — direct, specific, and actually useful. ${coachingDirectiveFor(ent)}

Quote their actual words when pointing at a problem. Vague feedback ("be clearer") is worthless; show them the sentence that lost you and say what it should do instead.

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "score": 0-100,
  "summary": "2-3 sentences: would this hold a real investor's attention, and why.",
  "worksWell": ["Specific things that land, quoting their words."],
  "problems": [ { "quote": "The exact phrase that fails", "issue": "Why it fails", "fix": "What to say instead" } ],
  "questionsTheyWillAsk": ["The 3 questions this pitch invites that the founder isn't ready for."],
  "rewrittenOpener": "A stronger 2-sentence opening they could use verbatim."
}`,
          },
          {
            role: "user",
            content: `PROJECT BRIEF\n${formatProjectBriefForPrompt(project)}\n\nTHEIR PITCH\n${pitch.trim()}`,
          },
        ],
      });

      let parsed: any;
      try {
        parsed = parseJsonObject(completion.choices[0].message.content ?? "");
      } catch (err) {
        console.error("Pitch critique parse failed:", err);
        return res.status(502).json({ message: "Nova's critique came back unreadable. Try again." });
      }

      const artifact = await storage.createInvestorArtifact({
        projectId: req.params.id,
        userId,
        kind: "pitch_critique",
        score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
        summary: String(parsed.summary || ""),
        content: {
          pitch: pitch.trim(),
          worksWell: (Array.isArray(parsed.worksWell) ? parsed.worksWell : []).map(String).slice(0, 6),
          problems: (Array.isArray(parsed.problems) ? parsed.problems : []).slice(0, 8).map((p: any) => ({
            quote: String(p?.quote || "").slice(0, 400),
            issue: String(p?.issue || "").slice(0, 500),
            fix: String(p?.fix || "").slice(0, 500),
          })),
          questionsTheyWillAsk: (Array.isArray(parsed.questionsTheyWillAsk) ? parsed.questionsTheyWillAsk : []).map(String).slice(0, 5),
          rewrittenOpener: String(parsed.rewrittenOpener || "").slice(0, 1000),
        },
        creditsCharged: CREDIT_COSTS.pitchCritique,
      });

      await storage.deductCredits(userId, CREDIT_COSTS.pitchCritique);
      res.json({ artifact, creditsCharged: CREDIT_COSTS.pitchCritique });
    } catch (error) {
      console.error("Pitch critique error:", error);
      res.status(500).json({ message: "Failed to critique the pitch" });
    }
  });

  // -----------------------------------------------------------------------
  // Pricing analysis — 5 credits
  // -----------------------------------------------------------------------
  app.post("/api/projects/:id/pricing-analysis", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const project = await loadProjectForMember(res, userId, req.params.id);
      if (!project) return;

      const ent = await requireFeature(res, userId, "aiRoadmap", "Pricing analysis");
      if (!ent) return;
      if (!(await requireCredits(res, userId, CREDIT_COSTS.pricingAnalysis, "a pricing analysis"))) return;

      const tiers = await storage.getProjectPricingTiers(req.params.id).catch(() => []);

      const completion = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [
          {
            role: "system",
            content: `You are Nova, pressure-testing a founder's pricing. ${coachingDirectiveFor(ent)}

Judge the pricing against who they say they're for and what that person can realistically pay. Students, for instance, will not pay enterprise prices no matter how good the product is.

If they have no pricing yet, propose a starting structure. If they do, say plainly whether it's too low, too high, or wrong in shape.

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "verdict": "One blunt sentence on their pricing today.",
  "willingnessToPay": "What this specific customer will actually pay, and why.",
  "recommended": [ { "name": "", "price": "e.g. $4/month", "forWho": "", "rationale": "" } ],
  "risks": ["The 2-3 ways this pricing could go wrong."],
  "howToValidate": ["2-3 concrete tests to run before committing."]
}`,
          },
          {
            role: "user",
            content: [
              `PROJECT BRIEF\n${formatProjectBriefForPrompt(project)}`,
              tiers.length
                ? `CURRENT PRICING\n${tiers.map((t: any) => `- ${t.name}: $${(t.price / 100).toFixed(2)}/${t.billingPeriod}`).join("\n")}`
                : "CURRENT PRICING\nNone set yet.",
            ].join("\n\n"),
          },
        ],
      });

      let parsed: any;
      try {
        // No `|| "{}"`: an empty answer is unreadable, not an empty result — it used to parse as {} and be charged.
        parsed = parseJsonObject(completion.choices[0].message.content ?? "");
      } catch (err) {
        console.error("Pricing analysis parse failed:", err);
        return res.status(502).json({ message: "Nova's analysis came back unreadable. Try again.", code: "model_unreadable" });
      }

      const artifact = await storage.createInvestorArtifact({
        projectId: req.params.id,
        userId,
        kind: "pricing_analysis",
        summary: String(parsed.verdict || ""),
        content: {
          willingnessToPay: String(parsed.willingnessToPay || ""),
          recommended: (Array.isArray(parsed.recommended) ? parsed.recommended : []).slice(0, 5).map((t: any) => ({
            name: String(t?.name || "").slice(0, 80),
            price: String(t?.price || "").slice(0, 60),
            forWho: String(t?.forWho || "").slice(0, 200),
            rationale: String(t?.rationale || "").slice(0, 400),
          })),
          risks: (Array.isArray(parsed.risks) ? parsed.risks : []).map(String).slice(0, 5),
          howToValidate: (Array.isArray(parsed.howToValidate) ? parsed.howToValidate : []).map(String).slice(0, 5),
        },
        creditsCharged: CREDIT_COSTS.pricingAnalysis,
      });

      await storage.deductCredits(userId, CREDIT_COSTS.pricingAnalysis);
      res.json({ artifact, creditsCharged: CREDIT_COSTS.pricingAnalysis });
    } catch (error) {
      console.error("Pricing analysis error:", error);
      res.status(500).json({ message: "Failed to analyse pricing" });
    }
  });

  // -----------------------------------------------------------------------
  // Mock investor interview — 1 credit per question, 2 to grade an answer
  // -----------------------------------------------------------------------

  /** Starts a session and asks the first question. */
  app.post("/api/projects/:id/mock-interview", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const project = await loadProjectForMember(res, userId, req.params.id);
      if (!project) return;

      const ent = await requireFeature(res, userId, "aiRoadmap", "Mock investor interviews");
      if (!ent) return;
      if (!(await requireCredits(res, userId, CREDIT_COSTS.mockInterviewQuestion, "a mock interview"))) return;

      const { persona: personaId, difficulty } = req.body as { persona?: string; difficulty?: string };
      const persona = INVESTOR_PERSONAS.find((p) => p.id === personaId) || INVESTOR_PERSONAS[0];
      const level = ["friendly", "skeptical", "brutal"].includes(difficulty || "") ? difficulty! : "skeptical";

      const interview = await storage.createMockInterview({
        projectId: req.params.id,
        userId,
        persona: persona.id,
        difficulty: level as any,
        status: "active",
        creditsCharged: CREDIT_COSTS.mockInterviewQuestion,
      });

      let question;
      try {
        question = await askNextQuestion(interview.id, project, persona, level, ent, []);
      } catch (err) {
        // No first question, no interview: close it uncharged rather than
        // leave an empty one open claiming a credit it never took.
        await storage.updateMockInterview(interview.id, { status: "completed", creditsCharged: 0, completedAt: new Date() }).catch(() => {});
        if (err instanceof ModelResponseError) return answerUnreadable(res, err, "interview question");
        throw err;
      }
      await storage.deductCredits(userId, CREDIT_COSTS.mockInterviewQuestion);

      res.json({
        interview: { ...interview, turns: [question] },
        persona: { id: persona.id, label: persona.label },
        creditsCharged: CREDIT_COSTS.mockInterviewQuestion,
      });
    } catch (error) {
      console.error("Mock interview start error:", error);
      res.status(500).json({ message: "Failed to start the interview" });
    }
  });

  app.get("/api/mock-interviews/:id", isAuthenticated, async (req: any, res) => {
    try {
      const interview = await storage.getMockInterview(req.params.id);
      if (!interview || interview.userId !== req.user.id) {
        return res.status(404).json({ message: "Interview not found" });
      }
      const persona = INVESTOR_PERSONAS.find((p) => p.id === interview.persona);
      res.json({ interview, persona: persona ? { id: persona.id, label: persona.label } : null });
    } catch (error) {
      console.error("Get mock interview error:", error);
      res.status(500).json({ message: "Failed to load the interview" });
    }
  });

  /**
   * Submits an answer. Nova grades it, then asks the next question — the
   * grading and the follow-up are one exchange, charged together.
   */
  app.post("/api/mock-interviews/:id/answer", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const interview = await storage.getMockInterview(req.params.id);
      if (!interview || interview.userId !== userId) {
        return res.status(404).json({ message: "Interview not found" });
      }
      if (interview.status !== "active") {
        return res.status(400).json({ message: "This interview is already finished." });
      }

      const { answer } = req.body as { answer?: string };
      if (!answer?.trim()) return res.status(400).json({ message: "An answer is required" });

      const pending = interview.turns.find((t) => !t.answer);
      if (!pending) return res.status(400).json({ message: "There's no question waiting for an answer." });

      const ent = await requireCredits(res, userId, CREDIT_COSTS.mockInterviewGrading, "grading your answer");
      if (!ent) return;

      const project = await storage.getProject(interview.projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const persona = INVESTOR_PERSONAS.find((p) => p.id === interview.persona) || INVESTOR_PERSONAS[0];

      // Grade the answer.
      const grading = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [
          {
            role: "system",
            content: `You are ${persona.label}: ${persona.brief}
${DIFFICULTY_BRIEFS[interview.difficulty]}

Grade the founder's answer to your question. Be a fair but demanding grader — most real answers to hard questions land between 40 and 70. Reserve 85+ for an answer with specifics and evidence.

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "score": 0-100,
  "verdict": "One blunt sentence on the answer.",
  "strong": ["What genuinely worked."],
  "weak": ["What a real investor would not accept."],
  "wouldPushOn": "The follow-up a real investor would ask right now."
}`,
          },
          {
            role: "user",
            content: `PROJECT BRIEF\n${formatProjectBriefForPrompt(project)}\n\nYOUR QUESTION\n${pending.question}\n\nTHEIR ANSWER\n${answer.trim()}`,
          },
        ],
      });

      let graded: any;
      try {
        graded = parseJsonObject(grading.choices[0].message.content || "{}");
      } catch (err) {
        console.error("Interview grading parse failed:", err);
        return res.status(502).json({ message: "Nova's grading came back unreadable. Try again." });
      }

      const score = Math.max(0, Math.min(100, Number(graded.score) || 0));
      const updatedTurn = await storage.updateInterviewTurn(pending.id, {
        answer: answer.trim().slice(0, 6000),
        score,
        feedback: {
          verdict: String(graded.verdict || "").slice(0, 500),
          strong: (Array.isArray(graded.strong) ? graded.strong : []).map(String).slice(0, 4),
          weak: (Array.isArray(graded.weak) ? graded.weak : []).map(String).slice(0, 4),
          wouldPushOn: String(graded.wouldPushOn || "").slice(0, 500),
        },
        answeredAt: new Date(),
      });

      // Rolling average across every graded turn.
      const answered = [...interview.turns.filter((t) => t.id !== pending.id && t.score != null), updatedTurn];
      const averageScore = Math.round(
        answered.reduce((sum, t) => sum + (t.score || 0), 0) / Math.max(1, answered.length)
      );
      await storage.updateMockInterview(interview.id, {
        averageScore,
        creditsCharged: interview.creditsCharged + CREDIT_COSTS.mockInterviewGrading,
      });

      await storage.deductCredits(userId, CREDIT_COSTS.mockInterviewGrading);

      // Ask the next question unless we've hit the session cap.
      const MAX_QUESTIONS = 8;
      let nextQuestion = null;
      let nextCharged = 0;
      if (answered.length < MAX_QUESTIONS) {
        if (await storage.checkCredits(userId, CREDIT_COSTS.mockInterviewQuestion)) {
          try {
            nextQuestion = await askNextQuestion(
              interview.id, project, persona, interview.difficulty, ent,
              answered.map((t) => ({ question: t.question, answer: t.answer || "", score: t.score || 0 }))
            );
            await storage.deductCredits(userId, CREDIT_COSTS.mockInterviewQuestion);
            nextCharged = CREDIT_COSTS.mockInterviewQuestion;
          } catch (err) {
            // The grading stands, and was charged; the follow-up failed, so it isn't.
            console.error("Follow-up interview question failed (not charged):", err);
          }
        }
      }

      res.json({
        turn: updatedTurn,
        nextQuestion,
        averageScore,
        questionsAnswered: answered.length,
        maxQuestions: MAX_QUESTIONS,
        creditsCharged: CREDIT_COSTS.mockInterviewGrading + nextCharged,
      });
    } catch (error) {
      console.error("Mock interview answer error:", error);
      res.status(500).json({ message: "Failed to grade your answer" });
    }
  });

  /** Ends the session and produces a closing verdict. */
  app.post("/api/mock-interviews/:id/finish", isAuthenticated, rateLimit("ai"), async (req: any, res) => {
    try {
      const userId = req.user.id;
      const interview = await storage.getMockInterview(req.params.id);
      if (!interview || interview.userId !== userId) {
        return res.status(404).json({ message: "Interview not found" });
      }

      // Once. The verdict is free because the questions were paid for — so
      // finishing again returns the stored one. It used to run the model again,
      // unmetered, every time finish was called.
      if (interview.status === "completed") {
        return res.json({ interview, questionsAnswered: interview.turns.filter((t) => t.score != null).length, alreadyFinished: true });
      }

      const answered = interview.turns.filter((t) => t.score != null);
      const persona = INVESTOR_PERSONAS.find((p) => p.id === interview.persona) || INVESTOR_PERSONAS[0];

      let verdict = "Not enough answers to judge.";
      if (answered.length > 0) {
        try {
          const completion = await getOpenAI().chat.completions.create({
            model: modelFor(await requireVerdictEnt(userId)),
            messages: [
              {
                role: "system",
                content: `You are ${persona.label}. Write your honest post-meeting verdict in 3-4 sentences: would you take a second meeting, and what single thing would change your mind. Plain prose, no JSON.`,
              },
              {
                role: "user",
                content: answered.map((t, i) => `Q${i + 1}: ${t.question}\nA: ${t.answer}\nScore: ${t.score}`).join("\n\n"),
              },
            ],
          });
          verdict = completion.choices[0].message.content?.trim() || verdict;
        } catch (err) {
          console.error("Verdict generation failed (non-fatal):", err);
        }
      }

      const updated = await storage.updateMockInterview(interview.id, {
        status: "completed",
        verdict,
        completedAt: new Date(),
      });
      res.json({ interview: updated, questionsAnswered: answered.length });
    } catch (error) {
      console.error("Mock interview finish error:", error);
      res.status(500).json({ message: "Failed to finish the interview" });
    }
  });

  /** The closing verdict is free, so it only needs the tier's model choice. */
  async function requireVerdictEnt(userId: string) {
    const { getUserEntitlements } = await import("./entitlements");
    return getUserEntitlements(userId);
  }

  /** Generates and stores the next interview question. */
  async function askNextQuestion(
    interviewId: string,
    project: Project,
    persona: (typeof INVESTOR_PERSONAS)[number],
    difficulty: string,
    ent: { priorityAi: boolean; novaCoaching: any },
    history: { question: string; answer: string; score: number }[]
  ) {
    const completion = await getOpenAI().chat.completions.create({
      model: modelFor(ent),
      messages: [
        {
          role: "system",
          content: `You are ${persona.label}: ${persona.brief}
${DIFFICULTY_BRIEFS[difficulty] || DIFFICULTY_BRIEFS.skeptical}

Ask ONE question. Rules:
- Get harder as the conversation goes. If their last answer was weak, follow up on that exact weakness rather than moving on.
- Ask about this specific project, never a generic template question.
- One question only. No preamble, no "great, thanks". Just the question.
- Keep it under 40 words.

Reply with the question text alone — no JSON, no quotes.`,
        },
        {
          role: "user",
          content: [
            `PROJECT BRIEF\n${formatProjectBriefForPrompt(project)}`,
            history.length
              ? `SO FAR\n${history.map((h, i) => `Q${i + 1}: ${h.question}\nA: ${h.answer}\n(you scored that ${h.score}/100)`).join("\n\n")}`
              : "This is your first question.",
          ].join("\n\n"),
        },
      ],
    });

    const question = completion.choices[0].message.content?.trim().replace(/^["']|["']$/g, "");
    // An empty answer is a failed call, not a question: no stock question,
    // and nothing charged for one.
    if (!question) throw new ModelResponseError("interview question");

    return storage.createInterviewTurn({
      interviewId,
      order: history.length,
      question: question.slice(0, 1000),
    });
  }

  /** The investor personas the client offers. */
  app.get("/api/investor-personas", isAuthenticated, (_req, res) => {
    res.json({
      personas: INVESTOR_PERSONAS.map((p) => ({ id: p.id, label: p.label, brief: p.brief })),
      difficulties: Object.entries(DIFFICULTY_BRIEFS).map(([id, brief]) => ({ id, brief })),
    });
  });
}
