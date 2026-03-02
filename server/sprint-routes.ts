import type { Express } from "express";
import { storage } from "./storage";
import { db } from "./db";
import { projectMembers } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import OpenAI from "openai";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return _openai;
}

const SPRINT_PHASES = ["setup", "ideation", "alignment", "building", "validation", "review", "completed"] as const;

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

export function registerSprintRoutes(app: Express) {
  app.post("/api/sprints", isAuthenticated, async (req: any, res) => {
    try {
      const { partnerId, duration, productStyle, productName, productDescription } = req.body;
      if (!partnerId || !duration) {
        return res.status(400).json({ message: "Partner and duration are required" });
      }
      const sprint = await storage.createSprint({
        user1Id: req.user.id,
        user2Id: partnerId,
        duration,
        status: "setup",
        productStyle: productStyle || null,
        productName: productName || null,
        productDescription: productDescription || null,
      });
      res.json(sprint);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create sprint" });
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

      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to advance sprint" });
    }
  });

  app.post("/api/sprints/:id/responses", isAuthenticated, async (req: any, res) => {
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

  app.post("/api/sprints/:id/deliverables", isAuthenticated, async (req: any, res) => {
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

  app.post("/api/sprints/:id/messages", isAuthenticated, async (req: any, res) => {
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

  app.post("/api/sprints/:id/tasks", isAuthenticated, async (req: any, res) => {
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

  app.post("/api/sprints/:id/decisions", isAuthenticated, async (req: any, res) => {
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

  app.post("/api/sprints/:id/ratings", isAuthenticated, async (req: any, res) => {
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

  app.post("/api/sprints/:id/update-alignment", isAuthenticated, async (req: any, res) => {
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
      const hasCredits = await storage.checkCredits(req.user.id, 1);
      if (!hasCredits) return res.status(403).json({ message: "Insufficient credits" });
      await storage.deductCredits(req.user.id, 1);

      const [profile1, profile2] = await Promise.all([
        storage.getUserProfile(req.user.id),
        partnerId ? storage.getUserProfile(partnerId) : null,
      ]);

      const styleDesc = {
        past: "an innovative reimagining of a past product/concept that could be modernized",
        modern: "an improvement or innovation on a current modern-day product or service",
        futuristic: "a product that doesn't exist yet but could in the future",
      }[productStyle || "modern"];

      const response = await getOpenAI().chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{
          role: "system",
          content: `You are Nova, a creative product ideation assistant. Suggest ${styleDesc}. Consider the builders' skills and interests. Respond with ONLY valid JSON: {"name": "Product Name", "description": "2-3 sentence description of the product idea"}`
        }, {
          role: "user",
          content: `Builder 1 skills: ${profile1?.skills?.join(", ") || "general"}. Interests: ${profile1?.interests?.join(", ") || "technology"}.\n${profile2 ? `Builder 2 skills: ${profile2.skills?.join(", ") || "general"}. Interests: ${profile2.interests?.join(", ") || "technology"}.` : ""}\nProduct style: ${productStyle || "modern"}`
        }],
        temperature: 0.9,
        max_tokens: 200,
      });

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

      const hasCredits = await storage.checkCredits(req.user.id, 1);
      if (!hasCredits) return res.status(403).json({ message: "Insufficient credits" });
      await storage.deductCredits(req.user.id, 1);

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
        model: "gpt-4o-mini",
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
        max_tokens: 500,
      });

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

  app.post("/api/sprints/queue", isAuthenticated, async (req: any, res) => {
    try {
      const { duration, productStyle } = req.body;
      if (!duration) return res.status(400).json({ message: "Duration required" });

      const partner = await storage.findMatchmakingPartner(req.user.id);
      if (partner) {
        await storage.removeFromMatchmakingQueue(partner.userId);
        await storage.removeFromMatchmakingQueue(req.user.id);
        const sprint = await storage.createSprint({
          user1Id: req.user.id,
          user2Id: partner.userId,
          duration: duration,
          status: "setup",
          productStyle: productStyle || partner.productStyle || null,
        });
        return res.json({ matched: true, sprint });
      }

      await storage.joinMatchmakingQueue({ userId: req.user.id, duration, productStyle });
      res.json({ matched: false, message: "Added to queue. Waiting for a partner..." });
    } catch (error) {
      res.status(500).json({ message: "Failed to join queue" });
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
