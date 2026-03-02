import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { users, projectMembers, projects, userProfiles } from "@shared/schema";
import { setupAuth, isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { registerAuthRoutes } from "./replit_integrations/auth/routes";
import { registerObjectStorageRoutes, ObjectStorageService } from "./replit_integrations/object_storage";
import { insertUserProfileSchema, insertProjectSchema, insertDonationSchema, insertContestSchema, insertProjectLiveChatMessageSchema, insertWaitlistEntrySchema, insertInterviewSchema, insertExperimentSchema, insertPricingTierSchema, insertAnalyticsEventSchema, insertLegalDocSchema, insertDeployChecklistItemSchema, insertSupportTicketSchema, insertLaunchTaskSchema } from "@shared/schema";
import { z } from "zod";
import OpenAI from "openai";
import { eq, ne, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { calculateUserReputation } from "./reputation";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";

function getFeaturesForTier(tier: string): string[] {
  const features: Record<string, string[]> = {
    spark_pro: ["100 AI credits/month", "Create public projects", "Priority support", "Community access"],
    spark_business: ["250 AI credits/month", "Private projects", "Priority support", "Advanced analytics"],
    spark_unlimited: ["Unlimited AI credits", "Private projects", "AI roadmap generation", "Premium support", "All features"],
  };
  return features[tier] || ["20 AI credits/month", "Create public projects", "Join contests", "Community access"];
}

async function isProjectMember(userId: string, projectId: string): Promise<boolean> {
  const project = await storage.getProject(projectId);
  if (!project) return false;
  if (project.ownerId === userId) return true;
  const members = await storage.getProjectMembers(projectId);
  return members.some(m => m.userId === userId);
}

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

function generateFallbackScenes(style: string): { prompt: string; caption: string; imageUrl: string }[] {
  const colors: Record<string, { bg1: string; bg2: string; accent: string; text: string }> = {
    professional: { bg1: "#1a1a2e", bg2: "#16213e", accent: "#4a90d9", text: "#ffffff" },
    futuristic: { bg1: "#0a0a0a", bg2: "#1a0033", accent: "#00fff5", text: "#ffffff" },
    funny: { bg1: "#FFE066", bg2: "#FF6B35", accent: "#FF1493", text: "#333333" },
    cartoon: { bg1: "#87CEEB", bg2: "#98FB98", accent: "#FF6347", text: "#333333" },
  };
  const c = colors[style] || colors.professional;
  const captions = ["Welcome to the Project", "Core Features", "Technical Architecture", "User Experience", "Join Us Today"];
  const icons = [
    `<circle cx="640" cy="300" r="80" fill="${c.accent}" opacity="0.3"/><circle cx="640" cy="300" r="50" fill="${c.accent}" opacity="0.6"/><polygon points="620,275 620,325 670,300" fill="${c.text}"/>`,
    `<rect x="540" y="250" width="60" height="120" rx="5" fill="${c.accent}" opacity="0.7"/><rect x="610" y="210" width="60" height="160" rx="5" fill="${c.accent}" opacity="0.85"/><rect x="680" y="280" width="60" height="90" rx="5" fill="${c.accent}" opacity="0.55"/>`,
    `<circle cx="640" cy="300" r="60" fill="none" stroke="${c.accent}" stroke-width="3"/><circle cx="540" cy="250" r="30" fill="none" stroke="${c.accent}" stroke-width="2" opacity="0.6"/><circle cx="740" cy="250" r="30" fill="none" stroke="${c.accent}" stroke-width="2" opacity="0.6"/><line x1="600" y1="280" x2="565" y2="265" stroke="${c.accent}" stroke-width="2" opacity="0.5"/><line x1="680" y1="280" x2="715" y2="265" stroke="${c.accent}" stroke-width="2" opacity="0.5"/>`,
    `<rect x="570" y="240" width="140" height="100" rx="10" fill="none" stroke="${c.accent}" stroke-width="3"/><circle cx="610" cy="275" r="8" fill="${c.accent}"/><rect x="630" y="270" width="60" height="4" rx="2" fill="${c.accent}" opacity="0.5"/><rect x="630" y="282" width="40" height="4" rx="2" fill="${c.accent}" opacity="0.3"/>`,
    `<polygon points="640,240 680,310 600,310" fill="${c.accent}" opacity="0.8"/><rect x="615" y="320" width="50" height="6" rx="3" fill="${c.accent}" opacity="0.4"/>`,
  ];
  return captions.map((caption, i) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><defs><linearGradient id="bg${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c.bg1}"/><stop offset="100%" stop-color="${c.bg2}"/></linearGradient></defs><rect width="1280" height="720" fill="url(#bg${i})"/>${icons[i]}<text x="640" y="440" text-anchor="middle" fill="${c.text}" font-size="36" font-family="sans-serif" font-weight="bold">${caption}</text><text x="640" y="480" text-anchor="middle" fill="${c.text}" font-size="18" font-family="sans-serif" opacity="0.6">Scene ${i + 1} of 5</text></svg>`;
    return {
      prompt: caption,
      caption,
      imageUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    };
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);
  registerObjectStorageRoutes(app);

  // User Profile
  app.get("/api/profile", isAuthenticated, async (req: any, res) => {
    const profile = await storage.getUserProfile((req.user as any).id);
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    res.json(profile);
  });

  app.post("/api/profile", isAuthenticated, async (req: any, res) => {
    const userId = (req.user as any).id;
    const validated = insertUserProfileSchema.parse({ ...req.body, userId });
    const profile = await storage.upsertUserProfile(validated);
    res.json(profile);
  });

  app.post("/api/profile/complete-onboarding", isAuthenticated, async (req: any, res) => {
    await storage.completeOnboarding((req.user as any).id);
    res.json({ success: true });
  });

  // General AI Chat for project creation (no project ID needed yet)
  app.post("/api/chat", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const hasCredits = await storage.checkCredits(userId, 1);
      if (!hasCredits) {
        const sub = await storage.getUserSubscription(userId);
        return res.status(403).json({ message: "Insufficient credits", creditsRemaining: sub.creditsRemaining, tier: sub.tier });
      }

      const { message, history = [] } = req.body;
      if (!message) return res.status(400).json({ message: "Message is required" });

      const systemPrompt = `You are Nova, SparkTower's AI project partner. You have a friendly, knowledgeable personality. You always refer to yourself as "Nova" and use an encouraging, collaborative tone.

IMPORTANT FORMATTING RULES:
- Use emojis naturally throughout your responses (🚀 💡 🎯 ⚡ 🔧 📊 🎨 ✨ 💪 🌟 etc.)
- Use **bold text** for key terms, project names, and important concepts
- When presenting project summaries or suggestions, use a clean structured format with bold labels

Your guided flow:
1. First, understand what kind of project the user wants to build. Ask about their vision. 🚀
2. Ask clarifying questions about scope, **target audience**, and key features.
3. Ask what **tools and platforms** they're using or planning to use (GitHub, Replit, Google Colab, Figma, etc.). If they have existing repos or live demos, ask for links.
4. Ask about their **target audience** — who will use this? What problem does it solve?
5. Work through potential challenges: "🤔 Let me think about what could be tricky here..."
6. Provide estimates: team size, timeline, roles needed, and a polished description.
7. Present a structured summary using this format:
   🚀 **Project Title**: ...
   📝 **Description**: ...
   🎯 **Category**: ...
   🧑‍💻 **Roles Needed**: ...
   👥 **Team Size**: ...
   📅 **Timeline**: ... weeks
   🔗 **Repository**: ... (if provided)
   🌐 **Live URL**: ... (if provided)
8. IMPORTANT: When recommending timeline and team details, always encourage the user to add their **GitHub profile, portfolio, or previous work links**. Say something like: "💡 **Pro tip**: Adding your GitHub or portfolio link will help you gain traction and attract collaborators who can see your track record!"
9. Confirm with the user before they create the project.

As the conversation progresses, extract and suggest:
- A clear project title
- A concise description (2-3 sentences, professional)
- Specific roles needed for the team (as an array). Choose from: Frontend Developer, Backend Developer, Full Stack Developer, UI/UX Designer, Graphic Designer, Product Manager, Project Manager, Data Analyst, Data Scientist, ML Engineer, DevOps Engineer, QA Tester, Technical Writer, Content Creator, Marketing Specialist, Business Analyst, Community Manager, Mobile Developer, Game Developer, Security Engineer, Cloud Architect, Video Editor, Illustrator, Copywriter, SEO Specialist, Growth Hacker, Researcher, Legal Advisor, Financial Analyst
- Team size needed
- Estimated weeks to complete
- Category (Web App, Mobile App, AI/ML, SaaS, Fintech, Sustainability, IoT, Design, Data Analytics, Marketing, E-Commerce, Education, Healthcare, Social Media, Gaming, Blockchain, Content Creation, DevOps, Research, Nonprofit, Other)
- Tech stack being used (e.g. React, Python, Node.js, Firebase, etc.) as an array of strings
- GitHub/repo URL if mentioned (repoUrl)
- Live demo/deployment URL if mentioned (liveUrl)

IMPORTANT: When suggesting roles, be specific and encouraging. Help the user see their project as achievable by breaking it into concrete roles that real people can fill. This gives them a sense of purpose and direction.

When presenting the final summary, end with an encouraging note like "✨ This is a solid plan — you've got what it takes to make this real!" or similar motivational closing.

After each user message, respond conversationally AND include a JSON block in your response with any updates you can extract.

Format: Respond with your conversational message, then on a new line include:
<project_update>{"title": "...", "description": "...", "rolesNeeded": [...], "techStack": [...], "teamSize": 2, "estimatedWeeks": 8, "category": "...", "repoUrl": "...", "liveUrl": "..."}</project_update>

Only include fields you have enough info to fill. Start empty if needed.`;

      const messages = [
        { role: "system" as const, content: systemPrompt },
        ...history.map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user" as const, content: message }
      ];

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages,
      });

      const rawReply = response.choices[0].message.content || "I'd love to help! Tell me more about your project idea.";
      
      // Extract project updates from response
      const updateMatch = rawReply.match(/<project_update>([\s\S]*?)<\/project_update>/);
      let projectUpdates = null;
      let reply = rawReply;
      
      if (updateMatch) {
        try {
          projectUpdates = JSON.parse(updateMatch[1]);
          reply = rawReply.replace(/<project_update>[\s\S]*?<\/project_update>/, "").trim();
        } catch {}
      }

      await storage.deductCredits(userId, 1);
      res.json({ reply, projectUpdates });
    } catch (error) {
      console.error("Chat error:", error);
      res.status(500).json({ message: "AI chat failed" });
    }
  });

  // Projects
  app.get("/api/projects", async (req, res) => {
    const { category, status } = req.query;
    const filters = {
      category: category as string,
      status: status as string,
    };
    const projects = await storage.getProjects(filters);
    res.json(projects);
  });

  app.post("/api/projects", isAuthenticated, async (req: any, res) => {
    const ownerId = (req.user as any).id;
    const validated = insertProjectSchema.parse({ ...req.body, ownerId });
    const project = await storage.createProject(validated);
    res.json(project);
  });

  app.get("/api/projects/:id", async (req, res) => {
    const project = await storage.getProject(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });
    await storage.incrementProjectViews(req.params.id);
    res.json(project);
  });

  app.get("/api/projects/:id/members", async (req, res) => {
    const members = await storage.getProjectMembers(req.params.id);
    res.json(members);
  });

  // --- Project Applications ---
  app.post("/api/projects/:id/apply", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;
      const { resumeUrl, answers, message } = req.body;
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId === userId) return res.status(400).json({ message: "Cannot apply to your own project" });
      const members = await storage.getProjectMembers(projectId);
      if (members.some(m => m.userId === userId)) return res.status(400).json({ message: "Already a member" });
      const existing = await storage.getUserApplications(userId);
      if (existing.some(a => a.projectId === projectId && a.status === "pending")) return res.status(400).json({ message: "Already applied" });
      const app = await storage.createApplication({ projectId, userId, resumeUrl, answers, message });
      res.json(app);
    } catch (error) {
      console.error("Apply error:", error);
      res.status(500).json({ message: "Failed to submit application" });
    }
  });

  app.get("/api/projects/:id/applications", isAuthenticated, async (req: any, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== (req.user as any).id) return res.status(403).json({ message: "Only the project owner can view applications" });
      const apps = await storage.getProjectApplications(req.params.id);
      res.json(apps);
    } catch (error) {
      console.error("Get applications error:", error);
      res.status(500).json({ message: "Failed to get applications" });
    }
  });

  app.get("/api/user/applications", isAuthenticated, async (req: any, res) => {
    try {
      const apps = await storage.getUserApplications((req.user as any).id);
      res.json(apps);
    } catch (error) {
      console.error("Get user applications error:", error);
      res.status(500).json({ message: "Failed to get applications" });
    }
  });

  app.post("/api/applications/:id/accept", isAuthenticated, async (req: any, res) => {
    try {
      const application = await storage.getApplication(req.params.id);
      if (!application) return res.status(404).json({ message: "Application not found" });
      const project = await storage.getProject(application.projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== (req.user as any).id) return res.status(403).json({ message: "Only the project owner can accept applications" });
      if (application.status !== "pending") return res.status(400).json({ message: "Application is not pending" });
      const updated = await storage.updateApplicationStatus(req.params.id, "accepted");
      await db.insert(projectMembers).values({ projectId: application.projectId, userId: application.userId, role: req.body.role || "member" });
      res.json(updated);
    } catch (error) {
      console.error("Accept application error:", error);
      res.status(500).json({ message: "Failed to accept application" });
    }
  });

  app.post("/api/applications/:id/reject", isAuthenticated, async (req: any, res) => {
    try {
      const application = await storage.getApplication(req.params.id);
      if (!application) return res.status(404).json({ message: "Application not found" });
      const project = await storage.getProject(application.projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== (req.user as any).id) return res.status(403).json({ message: "Only the project owner can reject applications" });
      if (application.status !== "pending") return res.status(400).json({ message: "Application is not pending" });
      const updated = await storage.updateApplicationStatus(req.params.id, "rejected");
      res.json(updated);
    } catch (error) {
      console.error("Reject application error:", error);
      res.status(500).json({ message: "Failed to reject application" });
    }
  });

  // --- Project Follows ---
  app.post("/api/projects/:id/follow", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;
      const following = await storage.isFollowing(userId, projectId);
      if (following) {
        await storage.unfollowProject(userId, projectId);
        res.json({ following: false });
      } else {
        await storage.followProject(userId, projectId);
        res.json({ following: true });
      }
    } catch (error) {
      console.error("Follow error:", error);
      res.status(500).json({ message: "Failed to toggle follow" });
    }
  });

  app.get("/api/projects/:id/follow-status", isAuthenticated, async (req: any, res) => {
    try {
      const following = await storage.isFollowing((req.user as any).id, req.params.id);
      const count = await storage.getProjectFollowerCount(req.params.id);
      res.json({ following, count });
    } catch (error) {
      res.status(500).json({ message: "Failed to get follow status" });
    }
  });

  app.get("/api/user/followed-projects", isAuthenticated, async (req: any, res) => {
    try {
      const followed = await storage.getUserFollowedProjects((req.user as any).id);
      res.json(followed);
    } catch (error) {
      console.error("Get followed projects error:", error);
      res.status(500).json({ message: "Failed to get followed projects" });
    }
  });

  // --- Kanban Tasks ---
  app.get("/api/projects/:id/kanban", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isProjectMember(userId, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const tasks = await storage.getProjectKanbanTasks(req.params.id);
      res.json(tasks);
    } catch (error) {
      console.error("Get kanban tasks error:", error);
      res.status(500).json({ message: "Failed to get tasks" });
    }
  });

  app.post("/api/projects/:id/kanban", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isProjectMember(userId, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const { title, description, status, assigneeId, priority, dueDate, order } = req.body;
      if (!title) return res.status(400).json({ message: "Title is required" });
      const task = await storage.createKanbanTask({
        projectId: req.params.id, title, description, status: status || "todo",
        assigneeId: assigneeId || null, priority: priority || "medium",
        dueDate: dueDate ? new Date(dueDate) : null, order: order || 0,
      });
      res.json(task);
    } catch (error) {
      console.error("Create kanban task error:", error);
      res.status(500).json({ message: "Failed to create task" });
    }
  });

  app.patch("/api/kanban/:taskId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const existingTask = await storage.getKanbanTask(req.params.taskId);
      if (!existingTask) return res.status(404).json({ message: "Task not found" });
      if (!(await isProjectMember(userId, existingTask.projectId))) return res.status(403).json({ message: "Not a project member" });
      const updates: any = {};
      const { title, description, status, assigneeId, priority, dueDate, order } = req.body;
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (status !== undefined) updates.status = status;
      if (assigneeId !== undefined) updates.assigneeId = assigneeId;
      if (priority !== undefined) updates.priority = priority;
      if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;
      if (order !== undefined) updates.order = order;
      const task = await storage.updateKanbanTask(req.params.taskId, updates);
      res.json(task);
    } catch (error) {
      console.error("Update kanban task error:", error);
      res.status(500).json({ message: "Failed to update task" });
    }
  });

  app.delete("/api/kanban/:taskId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const existingTask = await storage.getKanbanTask(req.params.taskId);
      if (!existingTask) return res.status(404).json({ message: "Task not found" });
      if (!(await isProjectMember(userId, existingTask.projectId))) return res.status(403).json({ message: "Not a project member" });
      await storage.deleteKanbanTask(req.params.taskId);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete kanban task error:", error);
      res.status(500).json({ message: "Failed to delete task" });
    }
  });

  app.post("/api/projects/:id/kanban/ai-generate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      await storage.resetCreditsIfNeeded(userId);
      const hasCredits = await storage.checkCredits(userId, 1);
      if (!hasCredits) return res.status(403).json({ message: "Insufficient credits" });
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      const members = await storage.getProjectMembers(req.params.id);

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{
          role: "system",
          content: `You are Nova, a project management AI. Generate a Kanban board breakdown for the project. You MUST respond with ONLY a valid JSON object (no markdown, no code fences) with a "tasks" array. Each task should have: title, description, status ("todo"), priority ("low"/"medium"/"high"), and suggested_role (which team role should handle it). Break the project into 8-12 actionable tasks covering planning, development, testing, and launch phases.`
        }, {
          role: "user",
          content: `Project: "${project.title}"\nDescription: ${project.description}\nCategory: ${project.category}\nTech Stack: ${(project.techStack || []).join(", ")}\nRoles: ${(project.rolesNeeded || []).join(", ")}\nTeam Size: ${project.teamSize}\nTimeline: ${project.estimatedWeeks} weeks\nTeam Members: ${members.map(m => `${m.profile?.displayName || m.user.firstName || "Member"} (${m.role})`).join(", ")}`
        }],
        temperature: 0.7,
      });

      await storage.deductCredits(userId, 1);

      const rawContent = completion.choices[0].message.content || "{}";
      const cleaned = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const content = JSON.parse(cleaned);
      const tasks = content.tasks || content;
      const created = [];
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const task = await storage.createKanbanTask({
          projectId: req.params.id,
          title: t.title,
          description: t.description || "",
          status: "todo",
          priority: t.priority || "medium",
          assigneeId: null,
          dueDate: null,
          order: i,
        });
        created.push(task);
      }
      res.json(created);
    } catch (error) {
      console.error("AI kanban generate error:", error);
      res.status(500).json({ message: "Failed to generate tasks" });
    }
  });

  // --- Personas ---
  app.get("/api/projects/:id/personas", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isProjectMember(userId, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const personas = await storage.getProjectPersonas(req.params.id);
      res.json(personas);
    } catch (error) {
      console.error("Get personas error:", error);
      res.status(500).json({ message: "Failed to get personas" });
    }
  });

  app.post("/api/projects/:id/personas", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isProjectMember(userId, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const { name, age, occupation, bio, goals, painPoints, quote, avatarDescription } = req.body;
      if (!name) return res.status(400).json({ message: "Name is required" });
      const persona = await storage.createPersona({
        projectId: req.params.id, name, age, occupation, bio,
        goals: goals || [], painPoints: painPoints || [],
        quote, avatarDescription, isAiGenerated: false,
      });
      res.json(persona);
    } catch (error) {
      console.error("Create persona error:", error);
      res.status(500).json({ message: "Failed to create persona" });
    }
  });

  app.post("/api/projects/:id/personas/generate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isProjectMember(userId, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      await storage.resetCreditsIfNeeded(userId);
      const hasCredits = await storage.checkCredits(userId, 1);
      if (!hasCredits) return res.status(403).json({ message: "Insufficient credits" });
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{
          role: "system",
          content: `You are a UX research expert. Generate a realistic customer persona for the given project. You MUST respond with ONLY a valid JSON object (no markdown, no code fences) with these fields: name (string), age (number), occupation (string), bio (string, 2-3 sentences), goals (array of 3 strings), painPoints (array of 3 strings), quote (string, a memorable quote from this persona), avatarDescription (string, brief physical/style description for illustration).`
        }, {
          role: "user",
          content: `Project: "${project.title}"\nDescription: ${project.description}\nCategory: ${project.category}\n${req.body.context ? `Additional context: ${req.body.context}` : ""}`
        }],
        temperature: 0.9,
      });

      await storage.deductCredits(userId, 1);

      const rawContent = completion.choices[0].message.content || "{}";
      const cleaned = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const personaData = JSON.parse(cleaned);
      const persona = await storage.createPersona({
        projectId: req.params.id,
        name: personaData.name,
        age: personaData.age,
        occupation: personaData.occupation,
        bio: personaData.bio,
        goals: personaData.goals || [],
        painPoints: personaData.painPoints || [],
        quote: personaData.quote,
        avatarDescription: personaData.avatarDescription,
        isAiGenerated: true,
      });
      res.json(persona);
    } catch (error) {
      console.error("Generate persona error:", error);
      res.status(500).json({ message: "Failed to generate persona" });
    }
  });

  app.delete("/api/personas/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const persona = await storage.getPersona(req.params.id);
      if (!persona) return res.status(404).json({ message: "Persona not found" });
      if (!(await isProjectMember(userId, persona.projectId))) return res.status(403).json({ message: "Not a project member" });
      await storage.deletePersona(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete persona error:", error);
      res.status(500).json({ message: "Failed to delete persona" });
    }
  });

  // --- AI People Recommendations ---
  app.post("/api/projects/:id/recommend-people", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isProjectMember(userId, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      await storage.resetCreditsIfNeeded(userId);
      const hasCredits = await storage.checkCredits(userId, 1);
      if (!hasCredits) return res.status(403).json({ message: "Insufficient credits" });
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const allProfiles = await db.select().from(userProfiles).where(and(ne(userProfiles.userId, userId), eq(userProfiles.isOnboarded, true)));
      const profileSummaries = allProfiles.slice(0, 50).map(p => ({
        userId: p.userId,
        name: p.displayName || p.username || "User",
        skills: (p.skills || []).join(", "),
        interests: (p.interests || []).join(", "),
        experience: p.experienceLevel,
        headline: p.headline,
      }));

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{
          role: "system",
          content: `You are a talent matching expert. Given a project's needs and a list of users, recommend the top 5 most suitable people. You MUST respond with ONLY a valid JSON object (no markdown, no code fences) with a "recommendations" array, each with: userId (string), reason (string, 1-2 sentences explaining why they're a good fit), matchStrength ("strong"/"moderate"/"good").`
        }, {
          role: "user",
          content: `Project: "${project.title}"\nDescription: ${project.description}\nRoles Needed: ${(project.rolesNeeded || []).join(", ")}\nTech Stack: ${(project.techStack || []).join(", ")}\n\nAvailable Users:\n${JSON.stringify(profileSummaries)}`
        }],
        temperature: 0.7,
      });

      await storage.deductCredits(userId, 1);

      const rawContent = completion.choices[0].message.content || "{}";
      const cleaned = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const content = JSON.parse(cleaned);
      const recs = content.recommendations || [];
      const enriched = await Promise.all(recs.map(async (r: any) => {
        const [user] = await db.select().from(users).where(eq(users.id, r.userId));
        const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, r.userId));
        return { ...r, user, profile };
      }));
      res.json(enriched.filter((r: any) => r.user));
    } catch (error) {
      console.error("Recommend people error:", error);
      res.status(500).json({ message: "Failed to recommend people" });
    }
  });

  // --- Business Plan ---
  app.post("/api/projects/:id/business-plan", isAuthenticated, async (req: any, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== (req.user as any).id) return res.status(403).json({ message: "Only the owner can update the business plan" });
      const updated = await storage.updateProject(req.params.id, { businessPlanUrl: req.body.businessPlanUrl });
      res.json(updated);
    } catch (error) {
      console.error("Business plan error:", error);
      res.status(500).json({ message: "Failed to update business plan" });
    }
  });

  // --- Application Questions ---
  app.post("/api/projects/:id/application-questions", isAuthenticated, async (req: any, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== (req.user as any).id) return res.status(403).json({ message: "Only the owner can set application questions" });
      const updated = await storage.updateProject(req.params.id, { applicationQuestions: req.body.questions });
      res.json(updated);
    } catch (error) {
      console.error("Application questions error:", error);
      res.status(500).json({ message: "Failed to update application questions" });
    }
  });

  app.patch("/api/projects/:id", isAuthenticated, async (req: any, res) => {
    const project = await storage.getProject(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });
    if (project.ownerId !== (req.user as any).id) return res.status(403).json({ message: "Unauthorized" });
    
    const validated = insertProjectSchema.partial().parse(req.body);
    const updated = await storage.updateProject(req.params.id, validated);
    res.json(updated);
  });

  // Project Chat
  // Nova Guide AI - Onboarding & Persistent Assistant
  app.get("/api/projects/:id/nova-guide", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isProjectMember(userId, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const messages = await storage.getNovaGuideMessages(req.params.id);
      res.json(messages);
    } catch (e) { res.status(500).json({ message: "Failed to get Nova guide messages" }); }
  });

  app.post("/api/projects/:id/nova-guide", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;
      if (!(await isProjectMember(userId, projectId))) return res.status(403).json({ message: "Not a project member" });

      const hasCredits = await storage.checkCredits(userId, 1);
      if (!hasCredits) {
        const sub = await storage.getUserSubscription(userId);
        return res.status(403).json({ message: "Insufficient credits", creditsRemaining: sub.creditsRemaining, tier: sub.tier });
      }

      const { message, currentTab } = req.body;
      if (!message || typeof message !== "string") return res.status(400).json({ message: "Message is required" });
      if (message.length > 5000) return res.status(400).json({ message: "Message too long (max 5000 chars)" });

      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const members = await storage.getProjectMembers(projectId);
      const sub = await storage.getUserSubscription(userId);
      const isPremium = sub.tier !== "free";

      await storage.addNovaGuideMessage({ projectId, role: "user", content: message, actionsTaken: [] });

      const history = await storage.getNovaGuideMessages(projectId);

      const projectContext = `
PROJECT CONTEXT:
- Title: ${project.title}
- Description: ${project.description || "Not set"}
- Category: ${project.category}
- Status: ${project.status}
- One-Liner: ${(project as any).oneLiner || "Not set"}
- Value Proposition: ${(project as any).valueProposition || "Not set"}
- Target Customer: ${(project as any).targetCustomerProfile || "Not set"}
- Problem Statement: ${project.problemStatement || "Not set"}
- Target User: ${project.targetUser || "Not set"}
- Success Metrics: ${project.successMetrics || "Not set"}
- Team Size: ${project.teamSize}
- Timeline: ${project.estimatedWeeks} weeks
- Tech Stack: ${(project.techStack || []).join(", ") || "Not set"}
- Roles Needed: ${(project.rolesNeeded || []).join(", ") || "Not set"}
- Scope: ${JSON.stringify(project.scope) || "Not set"}
- Team Members: ${members.length}
- Onboarding Complete: ${(project as any).novaOnboardingComplete ? "Yes" : "No"}
- User Tier: ${sub.tier} (${isPremium ? "Premium" : "Free"})
- Current Tab: ${currentTab || "setup"}`;

      const systemPrompt = `You are Nova, SparkTower's AI project partner. You have a warm, encouraging, knowledgeable personality. You always refer to yourself as "Nova" and use emojis naturally.

YOUR ROLE: You are the user's dedicated project advisor. You guide them through building their project from the ground up — from defining their vision to launching their product.

${projectContext}

CONVERSATION GUIDELINES:
- Be warm, supportive, and encouraging. Starting a project is scary!
- Be concise but thorough. Don't overwhelm with too much at once.
- Ask ONE focused question at a time to guide the user
- Remember context from earlier in the conversation
- If information is already filled in (not "Not set"), acknowledge it and build on it
- Adapt to the user's current tab context and help with relevant tasks

GUIDED ONBOARDING FLOW (for new projects):
1. Welcome them warmly, acknowledge their project "${project.title}"
2. Help define their ONE-LINER positioning (who they help, what they do, how)
3. Help articulate their VALUE PROPOSITION and TARGET CUSTOMER
4. Work through their PROBLEM STATEMENT and SUCCESS METRICS
5. Help define their SCOPE (MVP features vs nice-to-have)
6. Create initial TASKS to get started
7. ${isPremium ? "Create MILESTONES/ROADMAP for their journey" : "Suggest upgrading to premium for AI-powered roadmap creation"}
8. Ask what they want to FOCUS ON FIRST

CONTEXT-AWARE ASSISTANCE (based on current tab):
- Setup tab: Help with brief, positioning, scope, links
- Kanban tab: Help create/prioritize tasks, suggest what to work on next
- Milestones tab: ${isPremium ? "Help create milestones and roadmap" : "Explain milestones, suggest upgrading for AI roadmap creation"}
- Team tab: Advise on roles needed, team structure
- Research tab: Help plan user interviews, design experiments
- Strategy tab: Help with pricing strategy, legal document templates
- Launch tab: Help with landing page copy, waitlist strategy, deploy checklist, launch plan
- Analytics tab: Suggest key metrics to track for their type of project
- Support tab: Help set up support workflow

TAKING ACTIONS:
You can take actions to update the project. When you want to take an action, include it in your response using this format:
<nova_action>{"type": "ACTION_TYPE", "data": {...}}</nova_action>

Available actions:
1. update_project: Update project fields
   <nova_action>{"type": "update_project", "data": {"oneLiner": "...", "valueProposition": "...", "targetCustomerProfile": "...", "problemStatement": "...", "targetUser": "...", "successMetrics": "..."}}</nova_action>
   Only include fields you're updating. Valid fields: oneLiner, valueProposition, targetCustomerProfile, problemStatement, targetUser, successMetrics

2. update_scope: Update project scope
   <nova_action>{"type": "update_scope", "data": {"mvp": ["feature1", "feature2"], "niceToHave": ["feature3"]}}</nova_action>

3. create_tasks: Create kanban tasks
   <nova_action>{"type": "create_tasks", "data": {"tasks": [{"title": "...", "description": "...", "priority": "high|medium|low"}]}}</nova_action>

4. create_milestones: Create project milestones (${isPremium ? "AVAILABLE - user is premium" : "NOT AVAILABLE - user is free tier. Mention they can upgrade for this feature."})
   <nova_action>{"type": "create_milestones", "data": {"milestones": [{"title": "...", "description": "...", "targetDate": "YYYY-MM-DD"}]}}</nova_action>

5. complete_onboarding: Mark onboarding as complete
   <nova_action>{"type": "complete_onboarding", "data": {}}</nova_action>

RULES:
- Always explain what you're about to do before taking an action
- After taking an action, confirm what was done
- Don't take too many actions at once — guide the user step by step
- When creating tasks, create 3-5 actionable, specific tasks
- Present information you've extracted for the user to confirm before saving
- Use markdown formatting: **bold** for key terms, bullet points for lists`;

      const messages = [
        { role: "system" as const, content: systemPrompt },
        ...history.slice(0, -1).map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user" as const, content: message }
      ];

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        temperature: 0.7,
      });

      const rawReply = response.choices[0].message.content || "I'm here to help! Tell me more about your project.";

      const actionMatches = [...rawReply.matchAll(/<nova_action>([\s\S]*?)<\/nova_action>/g)];
      const actionsTaken: any[] = [];
      let cleanReply = rawReply;

      for (const match of actionMatches) {
        try {
          const action = JSON.parse(match[1]);
          cleanReply = cleanReply.replace(match[0], "");

          switch (action.type) {
            case "update_project": {
              const allowedFields = ["oneLiner", "valueProposition", "targetCustomerProfile", "problemStatement", "targetUser", "successMetrics"];
              const updateData: any = {};
              for (const field of allowedFields) {
                if (action.data[field] !== undefined && typeof action.data[field] === "string" && action.data[field].length <= 2000) {
                  updateData[field] = action.data[field];
                }
              }
              if (Object.keys(updateData).length > 0) {
                await storage.updateProject(projectId, updateData);
                actionsTaken.push({ type: "update_project", data: updateData });
              }
              break;
            }
            case "update_scope": {
              const scopeData: any = {};
              if (Array.isArray(action.data.mvp)) scopeData.mvp = action.data.mvp.filter((s: any) => typeof s === "string").slice(0, 20);
              if (Array.isArray(action.data.niceToHave)) scopeData.niceToHave = action.data.niceToHave.filter((s: any) => typeof s === "string").slice(0, 20);
              if (Object.keys(scopeData).length > 0) {
                await storage.updateProject(projectId, { scope: scopeData });
                actionsTaken.push({ type: "update_scope", data: scopeData });
              }
              break;
            }
            case "create_tasks": {
              if (Array.isArray(action.data.tasks)) {
                const tasks = action.data.tasks.slice(0, 12);
                const created = [];
                for (let i = 0; i < tasks.length; i++) {
                  const t = tasks[i];
                  if (!t.title || typeof t.title !== "string") continue;
                  const task = await storage.createKanbanTask({
                    projectId,
                    title: t.title.slice(0, 200),
                    description: (t.description || "").slice(0, 1000),
                    status: "todo",
                    priority: ["low", "medium", "high"].includes(t.priority) ? t.priority : "medium",
                    assigneeId: null,
                    dueDate: null,
                    order: i,
                  });
                  created.push(task);
                }
                actionsTaken.push({ type: "create_tasks", data: { count: created.length, tasks: created.map(t => t.title) } });
              }
              break;
            }
            case "create_milestones": {
              if (!isPremium) {
                actionsTaken.push({ type: "create_milestones", data: { error: "Premium required" } });
                break;
              }
              if (Array.isArray(action.data.milestones)) {
                const milestones = action.data.milestones.slice(0, 10);
                const created = [];
                for (let i = 0; i < milestones.length; i++) {
                  const m = milestones[i];
                  if (!m.title || typeof m.title !== "string") continue;
                  const parsedDate = m.targetDate ? new Date(m.targetDate) : null;
                  const validDate = parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : null;
                  const milestone = await storage.createProjectMilestone({
                    projectId,
                    title: m.title.slice(0, 200),
                    description: (m.description || "").slice(0, 1000),
                    status: "planned",
                    targetDate: validDate,
                    order: i,
                  });
                  created.push(milestone);
                }
                actionsTaken.push({ type: "create_milestones", data: { count: created.length, milestones: created.map(m => m.title) } });
              }
              break;
            }
            case "complete_onboarding": {
              await storage.updateProject(projectId, { novaOnboardingComplete: true } as any);
              actionsTaken.push({ type: "complete_onboarding", data: {} });
              break;
            }
          }
        } catch (e) {
          console.error("Nova action parse error:", e);
        }
      }

      cleanReply = cleanReply.trim();

      await storage.addNovaGuideMessage({ projectId, role: "assistant", content: cleanReply, actionsTaken });
      await storage.deductCredits(userId, 1);

      res.json({ reply: cleanReply, actionsTaken });
    } catch (error) {
      console.error("Nova guide error:", error);
      res.status(500).json({ message: "Nova AI failed" });
    }
  });

  app.post("/api/projects/:id/nova-guide/complete-onboarding", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isProjectMember(userId, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      await storage.updateProject(req.params.id, { novaOnboardingComplete: true } as any);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ message: "Failed to complete onboarding" }); }
  });

  app.get("/api/projects/:id/chat", isAuthenticated, async (req, res) => {
    const messages = await storage.getProjectChatMessages(req.params.id as string);
    res.json(messages);
  });

  app.post("/api/projects/:id/chat", isAuthenticated, async (req: any, res) => {
    const projectId = req.params.id;
    const userId = (req.user as any).id;
    const { message } = req.body;

    const hasCredits = await storage.checkCredits(userId, 1);
    if (!hasCredits) {
      const sub = await storage.getUserSubscription(userId);
      return res.status(403).json({ message: "Insufficient credits", creditsRemaining: sub.creditsRemaining, tier: sub.tier });
    }
    
    const project = await storage.getProject(projectId);
    if (!project) return res.status(404).json({ message: "Project not found" });

    // Save user message
    await storage.addProjectChatMessage(projectId, "user", message);

    // Get history
    const history = await storage.getProjectChatMessages(projectId);
    
    // Call AI
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: `You are an expert project consultant for SparkTower. Help the user plan their project: "${project.title}". Provide tips on timeline, team size, roadmap, and tech stack.` },
        ...history.map(m => ({ role: m.role, content: m.content }))
      ],
      stream: false, // Session plan says streaming SSE but storage might not support it easily. Let's start with simple.
    });

    const aiContent = response.choices[0].message.content || "I'm sorry, I couldn't generate a response.";
    const aiMessage = await storage.addProjectChatMessage(projectId, "assistant", aiContent);
    
    await storage.deductCredits(userId, 1);
    res.json(aiMessage);
  });

  // Project Live Chat (Team)
  app.get("/api/projects/:id/live-chat", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isProjectMember(userId, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const messages = await storage.getProjectLiveChatMessages(req.params.id);
      res.json(messages);
    } catch (error) { res.status(500).json({ message: "Failed to get chat messages" }); }
  });

  app.post("/api/projects/:id/live-chat", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isProjectMember(userId, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const validated = insertProjectLiveChatMessageSchema.parse({
        projectId: req.params.id,
        userId,
        content: (req.body.content || "").trim(),
      });
      if (!validated.content) return res.status(400).json({ message: "Message content required" });
      const message = await storage.createProjectLiveChatMessage(validated);
      const user = await storage.getUser(userId);
      res.json({ ...message, user });
    } catch (error) { console.error("Live chat error:", error); res.status(500).json({ message: "Failed to send message" }); }
  });

  // === PM EXTENDED CRUD ROUTES ===

  // Waitlist
  app.get("/api/projects/:id/waitlist", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      res.json(await storage.getWaitlistEntries(req.params.id));
    } catch (e) { res.status(500).json({ message: "Failed to get waitlist" }); }
  });
  app.post("/api/projects/:id/waitlist", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const data = insertWaitlistEntrySchema.parse({ ...req.body, projectId: req.params.id });
      res.json(await storage.createWaitlistEntry(data));
    } catch (e) { res.status(500).json({ message: "Failed to add to waitlist" }); }
  });
  app.delete("/api/projects/:id/waitlist/:entryId", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      await storage.deleteWaitlistEntry(req.params.entryId);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ message: "Failed to delete entry" }); }
  });

  // Interviews
  app.get("/api/projects/:id/interviews", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      res.json(await storage.getProjectInterviews(req.params.id));
    } catch (e) { res.status(500).json({ message: "Failed to get interviews" }); }
  });
  app.post("/api/projects/:id/interviews", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const data = insertInterviewSchema.parse({ ...req.body, projectId: req.params.id, userId: (req.user as any).id });
      res.json(await storage.createProjectInterview(data));
    } catch (e) { res.status(500).json({ message: "Failed to create interview" }); }
  });
  app.patch("/api/projects/:id/interviews/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      res.json(await storage.updateProjectInterview(req.params.itemId, req.body));
    } catch (e) { res.status(500).json({ message: "Failed to update interview" }); }
  });
  app.delete("/api/projects/:id/interviews/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      await storage.deleteProjectInterview(req.params.itemId);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ message: "Failed to delete interview" }); }
  });

  // Experiments
  app.get("/api/projects/:id/experiments", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      res.json(await storage.getProjectExperiments(req.params.id));
    } catch (e) { res.status(500).json({ message: "Failed to get experiments" }); }
  });
  app.post("/api/projects/:id/experiments", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const data = insertExperimentSchema.parse({ ...req.body, projectId: req.params.id, userId: (req.user as any).id });
      res.json(await storage.createProjectExperiment(data));
    } catch (e) { res.status(500).json({ message: "Failed to create experiment" }); }
  });
  app.patch("/api/projects/:id/experiments/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      res.json(await storage.updateProjectExperiment(req.params.itemId, req.body));
    } catch (e) { res.status(500).json({ message: "Failed to update experiment" }); }
  });
  app.delete("/api/projects/:id/experiments/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      await storage.deleteProjectExperiment(req.params.itemId);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ message: "Failed to delete experiment" }); }
  });

  // Pricing Tiers
  app.get("/api/projects/:id/pricing", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      res.json(await storage.getProjectPricingTiers(req.params.id));
    } catch (e) { res.status(500).json({ message: "Failed to get pricing tiers" }); }
  });
  app.post("/api/projects/:id/pricing", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const data = insertPricingTierSchema.parse({ ...req.body, projectId: req.params.id });
      res.json(await storage.createPricingTier(data));
    } catch (e) { res.status(500).json({ message: "Failed to create pricing tier" }); }
  });
  app.patch("/api/projects/:id/pricing/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      res.json(await storage.updatePricingTier(req.params.itemId, req.body));
    } catch (e) { res.status(500).json({ message: "Failed to update pricing tier" }); }
  });
  app.delete("/api/projects/:id/pricing/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      await storage.deletePricingTier(req.params.itemId);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ message: "Failed to delete pricing tier" }); }
  });

  // Analytics Events
  app.get("/api/projects/:id/analytics-events", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      res.json(await storage.getProjectAnalyticsEvents(req.params.id));
    } catch (e) { res.status(500).json({ message: "Failed to get analytics events" }); }
  });
  app.post("/api/projects/:id/analytics-events", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const data = insertAnalyticsEventSchema.parse({ ...req.body, projectId: req.params.id });
      res.json(await storage.createAnalyticsEvent(data));
    } catch (e) { res.status(500).json({ message: "Failed to create analytics event" }); }
  });
  app.patch("/api/projects/:id/analytics-events/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      res.json(await storage.updateAnalyticsEvent(req.params.itemId, req.body));
    } catch (e) { res.status(500).json({ message: "Failed to update analytics event" }); }
  });
  app.delete("/api/projects/:id/analytics-events/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      await storage.deleteAnalyticsEvent(req.params.itemId);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ message: "Failed to delete analytics event" }); }
  });

  // Legal Docs
  app.get("/api/projects/:id/legal-docs", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      res.json(await storage.getProjectLegalDocs(req.params.id));
    } catch (e) { res.status(500).json({ message: "Failed to get legal docs" }); }
  });
  app.post("/api/projects/:id/legal-docs", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const data = insertLegalDocSchema.parse({ ...req.body, projectId: req.params.id });
      res.json(await storage.createLegalDoc(data));
    } catch (e) { res.status(500).json({ message: "Failed to create legal doc" }); }
  });
  app.patch("/api/projects/:id/legal-docs/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      res.json(await storage.updateLegalDoc(req.params.itemId, req.body));
    } catch (e) { res.status(500).json({ message: "Failed to update legal doc" }); }
  });
  app.delete("/api/projects/:id/legal-docs/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      await storage.deleteLegalDoc(req.params.itemId);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ message: "Failed to delete legal doc" }); }
  });

  // Deploy Checklist
  app.get("/api/projects/:id/deploy-checklist", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      res.json(await storage.getDeployChecklistItems(req.params.id));
    } catch (e) { res.status(500).json({ message: "Failed to get checklist" }); }
  });
  app.post("/api/projects/:id/deploy-checklist", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const data = insertDeployChecklistItemSchema.parse({ ...req.body, projectId: req.params.id });
      res.json(await storage.createDeployChecklistItem(data));
    } catch (e) { res.status(500).json({ message: "Failed to create checklist item" }); }
  });
  app.patch("/api/projects/:id/deploy-checklist/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      res.json(await storage.updateDeployChecklistItem(req.params.itemId, req.body));
    } catch (e) { res.status(500).json({ message: "Failed to update checklist item" }); }
  });
  app.delete("/api/projects/:id/deploy-checklist/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      await storage.deleteDeployChecklistItem(req.params.itemId);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ message: "Failed to delete checklist item" }); }
  });

  // Support Tickets
  app.get("/api/projects/:id/support-tickets", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      res.json(await storage.getProjectSupportTickets(req.params.id));
    } catch (e) { res.status(500).json({ message: "Failed to get tickets" }); }
  });
  app.post("/api/projects/:id/support-tickets", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const data = insertSupportTicketSchema.parse({ ...req.body, projectId: req.params.id });
      res.json(await storage.createSupportTicket(data));
    } catch (e) { res.status(500).json({ message: "Failed to create ticket" }); }
  });
  app.patch("/api/projects/:id/support-tickets/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      res.json(await storage.updateSupportTicket(req.params.itemId, req.body));
    } catch (e) { res.status(500).json({ message: "Failed to update ticket" }); }
  });
  app.delete("/api/projects/:id/support-tickets/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      await storage.deleteSupportTicket(req.params.itemId);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ message: "Failed to delete ticket" }); }
  });

  // Launch Tasks
  app.get("/api/projects/:id/launch-tasks", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      res.json(await storage.getProjectLaunchTasks(req.params.id));
    } catch (e) { res.status(500).json({ message: "Failed to get launch tasks" }); }
  });
  app.post("/api/projects/:id/launch-tasks", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const data = insertLaunchTaskSchema.parse({ ...req.body, projectId: req.params.id });
      res.json(await storage.createLaunchTask(data));
    } catch (e) { res.status(500).json({ message: "Failed to create launch task" }); }
  });
  app.patch("/api/projects/:id/launch-tasks/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      res.json(await storage.updateLaunchTask(req.params.itemId, req.body));
    } catch (e) { res.status(500).json({ message: "Failed to update launch task" }); }
  });
  app.delete("/api/projects/:id/launch-tasks/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      await storage.deleteLaunchTask(req.params.itemId);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ message: "Failed to delete launch task" }); }
  });

  // Donations
  app.get("/api/projects/:id/donations", async (req, res) => {
    const donations = await storage.getProjectDonations(req.params.id);
    res.json(donations);
  });

  app.post("/api/projects/:id/donate", isAuthenticated, async (req: any, res) => {
    const donorId = (req.user as any).id;
    const projectId = req.params.id;
    const validated = insertDonationSchema.parse({ ...req.body, donorId, projectId });
    const donation = await storage.createDonation(validated);
    res.json(donation);
  });

  // Matches
  app.get("/api/matches", isAuthenticated, async (req: any, res) => {
    const userId = (req.user as any).id;
    const matches = await storage.getUserMatches(userId);
    res.json(matches);
  });

  app.post("/api/matches/generate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const userProfile = await storage.getUserProfile(userId);
      if (!userProfile) return res.status(400).json({ message: "Complete your profile first" });

      const allProfiles = await storage.searchUsers("");
      const otherProfiles = allProfiles.filter(p => p.id !== userId && p.profile?.isOnboarded);

      if (otherProfiles.length === 0) {
        return res.json([]);
      }

      const userProjects = await storage.getUserProjects(userId);
      const userProjectCategories = new Set(userProjects.map(p => p.category));
      const userProjectRoles = new Set(userProjects.flatMap(p => p.rolesNeeded || []));

      const userConnections = await storage.getConnections(userId);
      const userConnectionIds = new Set(userConnections.map(c => c.user.id));

      function jaccardSimilarity(a: string[] | null, b: string[] | null): number {
        if (!a?.length || !b?.length) return 0;
        const setA = new Set(a.map(s => s.toLowerCase()));
        const setB = new Set(b.map(s => s.toLowerCase()));
        const intersection = [...setA].filter(x => setB.has(x)).length;
        const union = new Set([...setA, ...setB]).size;
        return union === 0 ? 0 : intersection / union;
      }

      const experienceLevels = ["beginner", "intermediate", "expert"];
      function experienceCompatibility(a: string | null, b: string | null): number {
        if (!a || !b) return 0.5;
        const idxA = experienceLevels.indexOf(a);
        const idxB = experienceLevels.indexOf(b);
        if (idxA === -1 || idxB === -1) return 0.5;
        const diff = Math.abs(idxA - idxB);
        if (diff === 0) return 1;
        if (diff === 1) return 0.7;
        return 0.4;
      }

      const scoredMatches: { id: string; score: number; factors: Record<string, number> }[] = [];

      for (const other of otherProfiles) {
        const op = other.profile!;

        const skillsScore = jaccardSimilarity(userProfile.skills, op.skills);
        const interestsScore = jaccardSimilarity(userProfile.interests, op.interests);
        const experienceScore = experienceCompatibility(userProfile.experienceLevel, op.experienceLevel);

        const otherProjects = await storage.getUserProjects(other.id);
        const otherCategories = new Set(otherProjects.map(p => p.category));
        const otherRoles = new Set(otherProjects.flatMap(p => p.rolesNeeded || []));
        const allCategories = new Set([...userProjectCategories, ...otherCategories]);
        const categoryScore = allCategories.size > 0
          ? [...userProjectCategories].filter(c => otherCategories.has(c)).length / allCategories.size
          : 0;
        const allRoles = new Set([...userProjectRoles, ...otherRoles]);
        const roleComplementScore = allRoles.size > 0
          ? [...userProjectRoles].filter(r => !otherRoles.has(r)).length / allRoles.size
          : 0;
        const projectScore = categoryScore * 0.6 + roleComplementScore * 0.4;

        const mutualConns = await storage.getMutualConnections(userId, other.id);
        const connectionScore = Math.min(1, mutualConns.length * 0.25);

        const weightedScore = Math.round(
          (skillsScore * 30 +
           interestsScore * 25 +
           experienceScore * 15 +
           projectScore * 15 +
           connectionScore * 15)
        );

        if (weightedScore > 5) {
          scoredMatches.push({
            id: other.id,
            score: Math.min(100, weightedScore),
            factors: { skills: skillsScore, interests: interestsScore, experience: experienceScore, projects: projectScore, connections: connectionScore }
          });
        }
      }

      scoredMatches.sort((a, b) => b.score - a.score);
      const topMatches = scoredMatches.slice(0, 20);

      if (topMatches.length === 0) {
        return res.json([]);
      }

      const hasCredits = await storage.checkCredits(userId, 1);
      let matchReasons: Record<string, string[]> = {};

      if (hasCredits && topMatches.length > 0) {
        try {
          const matchSummary = topMatches.map(m => {
            const other = otherProfiles.find(p => p.id === m.id);
            return {
              id: m.id,
              name: other?.firstName || "User",
              score: m.score,
              factors: m.factors,
              skills: other?.profile?.skills?.slice(0, 5),
              interests: other?.profile?.interests?.slice(0, 5),
              experience: other?.profile?.experienceLevel,
            };
          });

          const response = await openai.chat.completions.create({
            model: "gpt-5.2",
            messages: [
              { role: "system", content: "Generate concise match reasons. Return JSON: {\"reasons\": {\"userId\": [\"reason1\", \"reason2\"]}}. Each user gets 2-3 short reasons based on the factors provided." },
              { role: "user", content: `User profile: skills=${userProfile.skills?.join(", ")}, interests=${userProfile.interests?.join(", ")}, experience=${userProfile.experienceLevel}.\n\nMatches: ${JSON.stringify(matchSummary)}` }
            ],
            response_format: { type: "json_object" }
          });
          const parsed = JSON.parse(response.choices[0].message.content || '{"reasons":{}}');
          matchReasons = parsed.reasons || {};
          await storage.deductCredits(userId, 1);
        } catch (e) {
          console.error("AI reason generation failed, using defaults:", e);
        }
      }

      const savedMatches = await Promise.all(topMatches.map(async (m) => {
        const reasons = matchReasons[m.id] || [
          m.factors.skills > 0.3 ? "Overlapping technical skills" : "Complementary skill set",
          m.factors.interests > 0.3 ? "Shared interests" : "Diverse perspectives",
          m.factors.connections > 0 ? "Mutual connections" : "Potential new collaborator",
        ];
        return storage.upsertUserMatch({
          userId,
          matchedUserId: m.id,
          score: m.score,
          reasons,
        });
      }));

      res.json(savedMatches);
    } catch (error) {
      console.error("Match generation error:", error);
      res.status(500).json({ message: "Failed to generate matches" });
    }
  });

  // Leaderboard
  app.get("/api/leaderboard", async (req, res) => {
    const sortBy = (req.query.sortBy as "views" | "donations") || "views";
    const limit = parseInt(req.query.limit as string) || 10;
    const filter = (req.query.filter as "solo" | "team" | "all") || "all";
    const leaderboard = await storage.getLeaderboard(sortBy, limit, filter);
    res.json(leaderboard);
  });

  // Reputation
  app.get("/api/reputation/:userId", async (req, res) => {
    try {
      const rep = await storage.getUserReputation(req.params.userId);
      res.json(rep || { executionScore: 0, contributionScore: 0, marketSignalScore: 0, strategicThinkingScore: 0, builderIndex: 0, details: null });
    } catch (error) {
      res.status(500).json({ message: "Failed to get reputation" });
    }
  });

  app.post("/api/reputation/calculate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const hasCredits = await storage.checkCredits(userId, 1);
      if (!hasCredits) {
        return res.status(403).json({ message: "Insufficient credits for AI evaluation" });
      }
      await storage.deductCredits(userId, 1);
      const reputation = await calculateUserReputation(userId, storage);
      res.json(reputation);
    } catch (error: any) {
      console.error("Reputation calculation error:", error);
      res.status(500).json({ message: "Failed to calculate reputation" });
    }
  });

  app.get("/api/leaderboard/reputation", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const filter = (req.query.filter as "solo" | "team" | "all") || "all";
      const leaderboard = await storage.getReputationLeaderboard(limit, filter);
      res.json(leaderboard);
    } catch (error) {
      res.status(500).json({ message: "Failed to get reputation leaderboard" });
    }
  });

  // Users
  app.get("/api/users/search", async (req, res) => {
    const query = (req.query.q as string) || "";
    const users = await storage.searchUsers(query);
    res.json(users);
  });

  app.get("/api/users/:id", async (req, res) => {
    const user = await storage.getUser(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    const profile = await storage.getUserProfile(req.params.id);
    const allProjects = await storage.getProjects();
    const userProjects = allProjects.filter(p => p.ownerId === req.params.id);
    res.json({ ...user, profile, projects: userProjects });
  });

  app.post("/api/projects/:id/media", isAuthenticated, async (req: any, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== (req.user as any).id) return res.status(403).json({ message: "Unauthorized" });

      const { objectPath } = req.body;
      if (!objectPath || typeof objectPath !== "string") {
        return res.status(400).json({ message: "objectPath is required and must be a string" });
      }

      const updated = await storage.addProjectMedia(req.params.id, objectPath);
      res.json(updated);
    } catch (error) {
      console.error("Error adding media:", error);
      res.status(500).json({ message: "Failed to add media" });
    }
  });

  app.delete("/api/projects/:id/media/:index", isAuthenticated, async (req: any, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== (req.user as any).id) return res.status(403).json({ message: "Unauthorized" });

      const index = parseInt(req.params.index);
      if (isNaN(index)) return res.status(400).json({ message: "Invalid index" });

      const updated = await storage.removeProjectMedia(req.params.id, index);
      res.json(updated);
    } catch (error) {
      console.error("Error removing media:", error);
      res.status(500).json({ message: "Failed to remove media" });
    }
  });

  app.post("/api/projects/:id/generate-video", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const hasCredits = await storage.checkCredits(userId, 5);
      if (!hasCredits) {
        const sub = await storage.getUserSubscription(userId);
        return res.status(403).json({ message: "Insufficient credits. Video generation costs 5 credits.", creditsRemaining: sub.creditsRemaining, tier: sub.tier });
      }

      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== (req.user as any).id) return res.status(403).json({ message: "Unauthorized" });

      const { prompt, style = "professional" } = req.body;
      const videoPrompt = prompt || `Create a short showcase video for the project "${project.title}": ${project.description}`;

      const styleModifiers: Record<string, string> = {
        professional: "clean, corporate, modern design, professional photography style, polished, minimalist",
        futuristic: "cyberpunk, neon glow, holographic, sci-fi, dark background, high-tech, digital",
        funny: "humorous, exaggerated, playful, bright colors, comic style, whimsical, fun",
        cartoon: "animated cartoon style, colorful, illustrated, hand-drawn feel, Pixar-like, vibrant",
      };

      const svgStyleGuides: Record<string, string> = {
        professional: "Use a dark navy (#1a1a2e) to deep blue (#16213e) gradient background. Use clean geometric shapes, thin lines, and a muted color palette of blues, grays, and whites. Add subtle grid patterns. Text in white or light gray. Modern sans-serif feel. Include simple data visualization elements like bars or circles.",
        futuristic: "Use a black (#0a0a0a) to dark purple (#1a0033) gradient background. Use neon cyan (#00fff5), electric purple (#bf00ff), and hot pink (#ff0066) for accents. Add glowing effects with semi-transparent shapes, circuit board patterns, hexagonal grids, and scan lines. Text with glow effects.",
        funny: "Use a bright warm gradient background (yellow #FFE066 to orange #FF6B35 to pink #FF1493). Use bold, rounded shapes in saturated primary colors. Add fun elements like stars, squiggles, speech bubbles, and bouncy shapes. Playful and energetic layout with thick outlines.",
        cartoon: "Use a sky blue (#87CEEB) to mint green (#98FB98) gradient background. Use bold outlines (3-4px), flat bright colors, and rounded shapes. Include cloud-like shapes, stars, and simple character silhouettes. Vibrant palette with red, blue, yellow, green accents. Hand-drawn feel.",
      };

      const styleDesc = styleModifiers[style] || styleModifiers.professional;
      const svgGuide = svgStyleGuides[style] || svgStyleGuides.professional;

      const storyboardResponse = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          {
            role: "system",
            content: `You are a creative director specializing in ${style} visual style. Generate a detailed video storyboard description for a 30-second project showcase video. The visual style should be: ${styleDesc}. Include exactly 5 scenes with clear scene descriptions, text overlays, and visual effects suggestions. Format as a structured storyboard with ## Scene 1, ## Scene 2, etc.`
          },
          { role: "user", content: videoPrompt }
        ],
      });

      const storyboard = storyboardResponse.choices[0].message.content || "Video storyboard generation failed.";

      const scenesResponse = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          {
            role: "system",
            content: `You are an AI that extracts scene descriptions from storyboards and creates SVG illustrations. Given a storyboard, extract exactly 5 scenes.

For each scene, provide:
1. "caption": A short 1-sentence summary for display
2. "svg": A complete, valid SVG image (viewBox="0 0 1280 720") that visually represents the scene.

SVG Style Guide: ${svgGuide}

SVG Rules:
- viewBox must be "0 0 1280 720" (16:9 widescreen)
- Include a full background rectangle covering the entire viewBox
- Use at least 8-12 visual elements (shapes, paths, text) per scene
- Include a short text overlay (1-3 words) relevant to the scene content
- Make each scene visually distinct and interesting
- Use proper SVG elements: rect, circle, ellipse, path, polygon, text, line, g, defs, linearGradient, radialGradient, filter
- Do NOT use <image>, <foreignObject>, or external references
- Keep SVG self-contained and valid XML
- Ensure all colors use hex values

Respond ONLY with valid JSON in this exact format (no markdown, no code fences):
[
  {"caption": "Short caption", "svg": "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 1280 720\\">...</svg>"},
  {"caption": "Short caption", "svg": "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 1280 720\\">...</svg>"},
  {"caption": "Short caption", "svg": "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 1280 720\\">...</svg>"},
  {"caption": "Short caption", "svg": "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 1280 720\\">...</svg>"},
  {"caption": "Short caption", "svg": "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 1280 720\\">...</svg>"}
]`
          },
          { role: "user", content: storyboard }
        ],
      });

      let scenes: { prompt: string; caption: string; imageUrl: string }[] = [];
      try {
        const rawContent = scenesResponse.choices[0].message.content || "[]";
        const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawContent);
        scenes = parsed.slice(0, 5).map((s: any) => {
          let svgContent = s.svg || "";
          if (svgContent && !svgContent.includes("xmlns")) {
            svgContent = svgContent.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
          }
          const dataUri = svgContent
            ? `data:image/svg+xml;base64,${Buffer.from(svgContent).toString("base64")}`
            : "";
          return {
            prompt: s.prompt || s.caption || "",
            caption: s.caption || "",
            imageUrl: dataUri,
          };
        });
        if (scenes.length === 0) throw new Error("Empty scenes array");
      } catch (parseErr) {
        console.error("Error parsing scenes:", parseErr);
        scenes = generateFallbackScenes(style);
      }

      try {
        const allBadges = await storage.getBadges();
        const aiExplorerBadge = allBadges.find(b => b.name === "AI Explorer");
        if (aiExplorerBadge) {
          const userId = (req.user as any).id;
          const existingBadges = await storage.getUserBadges(userId);
          if (!existingBadges.some(ub => ub.badgeId === aiExplorerBadge.id)) {
            await storage.awardBadge(userId, aiExplorerBadge.id);
          }
        }
      } catch (badgeErr) {
        console.error("Badge awarding failed (non-fatal):", badgeErr);
      }

      const savedObjectPaths: string[] = [];
      try {
        const objStorage = new ObjectStorageService();
        for (let i = 0; i < scenes.length; i++) {
          const scene = scenes[i];
          if (!scene.imageUrl.startsWith("data:image/svg+xml;base64,")) continue;
          try {
            const base64Data = scene.imageUrl.replace("data:image/svg+xml;base64,", "");
            const svgBuffer = Buffer.from(base64Data, "base64");

            const uploadUrl = await objStorage.getObjectEntityUploadURL();
            const uploadRes = await fetch(uploadUrl, {
              method: "PUT",
              headers: { "Content-Type": "image/svg+xml" },
              body: svgBuffer,
            });

            if (uploadRes.ok) {
              const objectPath = objStorage.normalizeObjectEntityPath(uploadUrl);
              savedObjectPaths.push(objectPath);
              await storage.addProjectMedia(project.id, objectPath);
            }
          } catch (uploadErr) {
            console.error(`Failed to upload scene ${i}:`, uploadErr);
          }
        }
      } catch (storageErr) {
        console.error("Object storage upload failed (non-fatal):", storageErr);
      }

      await storage.deductCredits(userId, 5);

      res.json({
        storyboard,
        scenes,
        style,
        savedMediaPaths: savedObjectPaths,
        message: "AI storyboard and scenes generated successfully!",
        projectId: project.id,
      });
    } catch (error) {
      console.error("Error generating video:", error);
      res.status(500).json({ message: "Failed to generate video" });
    }
  });

  // --- Milestones ---
  app.get("/api/projects/:id/milestones", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Unauthorized" });
      const milestones = await storage.getProjectMilestones(req.params.id);
      res.json(milestones);
    } catch (error) { res.status(500).json({ message: "Failed to get milestones" }); }
  });

  app.post("/api/projects/:id/milestones", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Unauthorized" });
      const milestone = await storage.createMilestone({ ...req.body, projectId: req.params.id });
      await storage.logActivity({ projectId: req.params.id, userId: (req.user as any).id, action: "created milestone", entityType: "milestone", entityId: milestone.id, metadata: { title: milestone.title } });
      res.json(milestone);
    } catch (error) { res.status(500).json({ message: "Failed to create milestone" }); }
  });

  app.patch("/api/milestones/:id", isAuthenticated, async (req: any, res) => {
    try {
      const milestone = await storage.updateMilestone(req.params.id, req.body);
      if (req.body.status === "completed") {
        await storage.logActivity({ projectId: milestone.projectId, userId: (req.user as any).id, action: "completed milestone", entityType: "milestone", entityId: milestone.id, metadata: { title: milestone.title } });
      }
      res.json(milestone);
    } catch (error) { res.status(500).json({ message: "Failed to update milestone" }); }
  });

  app.delete("/api/milestones/:id", isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteMilestone(req.params.id);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ message: "Failed to delete milestone" }); }
  });

  // --- Activity Log ---
  app.get("/api/projects/:id/activity", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Unauthorized" });
      const limit = parseInt(req.query.limit as string) || 50;
      const activity = await storage.getProjectActivity(req.params.id, limit);
      res.json(activity);
    } catch (error) { res.status(500).json({ message: "Failed to get activity" }); }
  });

  // --- Decisions ---
  app.get("/api/projects/:id/decisions", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Unauthorized" });
      const decisions = await storage.getProjectDecisions(req.params.id);
      res.json(decisions);
    } catch (error) { res.status(500).json({ message: "Failed to get decisions" }); }
  });

  app.post("/api/projects/:id/decisions", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Unauthorized" });
      const decision = await storage.createDecision({ ...req.body, projectId: req.params.id, userId: (req.user as any).id });
      await storage.logActivity({ projectId: req.params.id, userId: (req.user as any).id, action: "created decision", entityType: "decision", entityId: decision.id, metadata: { title: decision.title } });
      res.json(decision);
    } catch (error) { res.status(500).json({ message: "Failed to create decision" }); }
  });

  app.patch("/api/decisions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const decision = await storage.updateDecision(req.params.id, req.body);
      res.json(decision);
    } catch (error) { res.status(500).json({ message: "Failed to update decision" }); }
  });

  app.delete("/api/decisions/:id", isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteDecision(req.params.id);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ message: "Failed to delete decision" }); }
  });

  // --- Check-ins ---
  app.get("/api/projects/:id/check-ins", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Unauthorized" });
      const checkIns = await storage.getProjectCheckIns(req.params.id);
      res.json(checkIns);
    } catch (error) { res.status(500).json({ message: "Failed to get check-ins" }); }
  });

  app.post("/api/projects/:id/check-ins", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Unauthorized" });
      const checkIn = await storage.createCheckIn({ ...req.body, projectId: req.params.id, userId: (req.user as any).id });
      await storage.logActivity({ projectId: req.params.id, userId: (req.user as any).id, action: "submitted check-in", entityType: "check-in", entityId: checkIn.id });
      res.json(checkIn);
    } catch (error) { res.status(500).json({ message: "Failed to create check-in" }); }
  });

  // --- Project Files ---
  app.get("/api/projects/:id/files", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Unauthorized" });
      const files = await storage.getProjectFiles(req.params.id);
      res.json(files);
    } catch (error) { res.status(500).json({ message: "Failed to get files" }); }
  });

  app.post("/api/projects/:id/files", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Unauthorized" });
      const file = await storage.createProjectFile({ ...req.body, projectId: req.params.id, uploaderId: (req.user as any).id });
      await storage.logActivity({ projectId: req.params.id, userId: (req.user as any).id, action: "uploaded file", entityType: "file", entityId: file.id, metadata: { name: file.name } });
      res.json(file);
    } catch (error) { res.status(500).json({ message: "Failed to create file" }); }
  });

  app.delete("/api/files/:id", isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteProjectFile(req.params.id);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ message: "Failed to delete file" }); }
  });

  // --- Project Links ---
  app.get("/api/projects/:id/links", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Unauthorized" });
      const links = await storage.getProjectLinks(req.params.id);
      res.json(links);
    } catch (error) { res.status(500).json({ message: "Failed to get links" }); }
  });

  app.post("/api/projects/:id/links", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Unauthorized" });
      const link = await storage.createProjectLink({ ...req.body, projectId: req.params.id });
      res.json(link);
    } catch (error) { res.status(500).json({ message: "Failed to create link" }); }
  });

  app.delete("/api/links/:id", isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteProjectLink(req.params.id);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ message: "Failed to delete link" }); }
  });

  // --- Enhanced Project Members ---
  app.patch("/api/projects/:id/members/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== (req.user as any).id && req.params.userId !== (req.user as any).id) return res.status(403).json({ message: "Unauthorized" });
      const member = await storage.updateProjectMember(req.params.id, req.params.userId, req.body);
      res.json(member);
    } catch (error) { res.status(500).json({ message: "Failed to update member" }); }
  });

  // --- AI Copilot ---
  app.post("/api/projects/:id/ai/summarize-progress", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isProjectMember(userId, req.params.id))) return res.status(403).json({ message: "Unauthorized" });
      const hasCredits = await storage.checkCredits(userId, 1);
      if (!hasCredits) return res.status(403).json({ message: "Insufficient credits" });

      const project = await storage.getProject(req.params.id);
      const tasks = await storage.getProjectKanbanTasks(req.params.id);
      const checkIns = await storage.getProjectCheckIns(req.params.id);
      const activity = await storage.getProjectActivity(req.params.id, 30);
      const milestones = await storage.getProjectMilestones(req.params.id);

      const taskSummary = {
        total: tasks.length,
        done: tasks.filter(t => t.status === "done").length,
        inProgress: tasks.filter(t => t.status === "in-progress").length,
        review: tasks.filter(t => t.status === "review").length,
        todo: tasks.filter(t => t.status === "todo").length,
      };

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{
          role: "system",
          content: `You are Nova, SparkTower's AI project assistant. Generate a concise weekly progress summary for a project. Be specific and actionable. Format with markdown headers and bullet points.`
        }, {
          role: "user",
          content: `Project: "${project?.title}"\nDescription: ${project?.description}\n\nTask Status: ${JSON.stringify(taskSummary)}\nRecent Tasks: ${JSON.stringify(tasks.slice(0, 10).map(t => ({ title: t.title, status: t.status, priority: t.priority })))}\nMilestones: ${JSON.stringify(milestones.map(m => ({ title: m.title, status: m.status, targetDate: m.targetDate })))}\nRecent Check-ins: ${JSON.stringify(checkIns.slice(0, 5).map(ci => ({ did: ci.did, doing: ci.doing, blockers: ci.blockers })))}\nRecent Activity: ${JSON.stringify(activity.slice(0, 10).map(a => a.action))}\n\nGenerate a progress summary covering: accomplishments, current focus, blockers, and next steps.`
        }],
        temperature: 0.7,
      });

      await storage.deductCredits(userId, 1);
      res.json({ summary: completion.choices[0].message.content });
    } catch (error) {
      console.error("AI summarize error:", error);
      res.status(500).json({ message: "Failed to generate summary" });
    }
  });

  app.post("/api/projects/:id/ai/detect-gaps", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isProjectMember(userId, req.params.id))) return res.status(403).json({ message: "Unauthorized" });
      const hasCredits = await storage.checkCredits(userId, 1);
      if (!hasCredits) return res.status(403).json({ message: "Insufficient credits" });

      const project = await storage.getProject(req.params.id);
      const tasks = await storage.getProjectKanbanTasks(req.params.id);
      const members = await storage.getProjectMembers(req.params.id);
      const milestones = await storage.getProjectMilestones(req.params.id);
      const files = await storage.getProjectFiles(req.params.id);

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{
          role: "system",
          content: `You are Nova, SparkTower's AI project assistant. Analyze a project and detect gaps, missing pieces, or potential risks. You MUST respond with ONLY a valid JSON object (no markdown, no code fences) with a "gaps" array, each with: category (string: "missing", "risk", "suggestion"), title (string), description (string), severity ("high"/"medium"/"low").`
        }, {
          role: "user",
          content: `Project: "${project?.title}"\nDescription: ${project?.description}\nRoles Needed: ${(project?.rolesNeeded || []).join(", ")}\nTech Stack: ${(project?.techStack || []).join(", ")}\n\nTeam: ${members.length} members with roles: ${members.map(m => m.role).join(", ")}\nTasks: ${tasks.length} total (${tasks.filter(t => t.status === "done").length} done, ${tasks.filter(t => t.status === "todo").length} todo)\nMilestones: ${milestones.length} (${milestones.filter(m => m.status === "completed").length} completed)\nFiles: ${files.length}\nHas business plan: ${!!project?.businessPlanUrl}\nHas problem statement: ${!!project?.problemStatement}\n\nAnalyze and flag any gaps.`
        }],
        temperature: 0.7,
      });

      await storage.deductCredits(userId, 1);
      const rawContent = completion.choices[0].message.content || "{}";
      const cleaned = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned);
      res.json(parsed);
    } catch (error) {
      console.error("AI detect gaps error:", error);
      res.status(500).json({ message: "Failed to detect gaps" });
    }
  });

  // Badges
  app.get("/api/badges", async (_req, res) => {
    const allBadges = await storage.getBadges();
    res.json(allBadges);
  });

  app.get("/api/users/:userId/badges", async (req, res) => {
    const userBadges = await storage.getUserBadges(req.params.userId);
    res.json(userBadges);
  });

  // Contests
  app.get("/api/contests", async (req: any, res) => {
    const { status } = req.query;
    const allContests = await storage.getContests(status ? { status: status as string } : undefined);
    const userId = req.user?.claims?.sub;
    if (userId) {
      const enriched = await Promise.all(
        allContests.map(async (c) => ({
          ...c,
          isParticipant: await storage.isContestParticipant(c.id, userId),
        }))
      );
      return res.json(enriched);
    }
    res.json(allContests.map(c => ({ ...c, isParticipant: false })));
  });

  app.get("/api/contests/:id", async (req: any, res) => {
    const contest = await storage.getContest(req.params.id);
    if (!contest) return res.status(404).json({ message: "Contest not found" });
    const userId = req.user?.claims?.sub;
    const isParticipant = userId ? await storage.isContestParticipant(contest.id, userId) : false;
    res.json({ ...contest, isParticipant });
  });

  app.get("/api/contests/:id/participants", async (req, res) => {
    const participants = await storage.getContestParticipants(req.params.id);
    res.json(participants);
  });

  app.post("/api/contests/:id/join", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const contestId = req.params.id;
      const contest = await storage.getContest(contestId);
      if (!contest) return res.status(404).json({ message: "Contest not found" });
      if (contest.status !== "active" && contest.status !== "upcoming") {
        return res.status(400).json({ message: "Contest is not accepting participants" });
      }
      const already = await storage.isContestParticipant(contestId, userId);
      if (already) return res.status(400).json({ message: "Already joined" });
      if (contest.maxParticipants && contest.participantCount >= contest.maxParticipants) {
        return res.status(400).json({ message: "Contest is full" });
      }
      const participant = await storage.joinContest(contestId, userId);
      res.json(participant);
    } catch (error) {
      console.error("Error joining contest:", error);
      res.status(500).json({ message: "Failed to join contest" });
    }
  });

  app.post("/api/contests/:id/submit", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const contestId = req.params.id;
      const { submissionUrl, submissionNote } = req.body;
      if (!submissionUrl) return res.status(400).json({ message: "submissionUrl is required" });
      const contest = await storage.getContest(contestId);
      if (!contest) return res.status(404).json({ message: "Contest not found" });
      if (contest.status !== "active") {
        return res.status(400).json({ message: "Contest is not accepting submissions" });
      }
      const isParticipant = await storage.isContestParticipant(contestId, userId);
      if (!isParticipant) return res.status(400).json({ message: "You must join the contest first" });
      const updated = await storage.submitToContest(contestId, userId, submissionUrl, submissionNote);
      res.json(updated);
    } catch (error) {
      console.error("Error submitting to contest:", error);
      res.status(500).json({ message: "Failed to submit" });
    }
  });

  // Connections
  app.post("/api/connections/request", isAuthenticated, async (req: any, res) => {
    try {
      const requesterId = (req.user as any).id;
      const { userId: receiverId } = req.body;
      if (!receiverId) return res.status(400).json({ message: "userId is required" });
      if (requesterId === receiverId) return res.status(400).json({ message: "Cannot connect with yourself" });
      const conn = await storage.sendConnectionRequest(requesterId, receiverId);
      res.json(conn);
    } catch (error: any) {
      if (error.message === "Connection already exists") {
        return res.status(400).json({ message: error.message });
      }
      console.error("Connection request error:", error);
      res.status(500).json({ message: "Failed to send connection request" });
    }
  });

  app.post("/api/connections/:id/accept", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const existing = await storage.getConnectionById(req.params.id);
      if (!existing) return res.status(404).json({ message: "Connection not found" });
      if (existing.receiverId !== userId) return res.status(403).json({ message: "Only the receiver can accept a connection request" });
      if (existing.status !== "pending") return res.status(400).json({ message: "Connection is not pending" });
      const conn = await storage.acceptConnection(req.params.id);
      res.json(conn);
    } catch (error) {
      console.error("Accept connection error:", error);
      res.status(500).json({ message: "Failed to accept connection" });
    }
  });

  app.post("/api/connections/:id/reject", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const existing = await storage.getConnectionById(req.params.id);
      if (!existing) return res.status(404).json({ message: "Connection not found" });
      if (existing.receiverId !== userId) return res.status(403).json({ message: "Only the receiver can reject a connection request" });
      if (existing.status !== "pending") return res.status(400).json({ message: "Connection is not pending" });
      const conn = await storage.rejectConnection(req.params.id);
      res.json(conn);
    } catch (error) {
      console.error("Reject connection error:", error);
      res.status(500).json({ message: "Failed to reject connection" });
    }
  });

  app.delete("/api/connections/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const existing = await storage.getConnectionById(req.params.id);
      if (!existing) return res.status(404).json({ message: "Connection not found" });
      if (existing.requesterId !== userId && existing.receiverId !== userId) {
        return res.status(403).json({ message: "You can only remove your own connections" });
      }
      await storage.removeConnection(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Remove connection error:", error);
      res.status(500).json({ message: "Failed to remove connection" });
    }
  });

  app.get("/api/connections", isAuthenticated, async (req: any, res) => {
    try {
      const conns = await storage.getConnections((req.user as any).id);
      res.json(conns);
    } catch (error) {
      console.error("Get connections error:", error);
      res.status(500).json({ message: "Failed to get connections" });
    }
  });

  app.get("/api/connections/requests", isAuthenticated, async (req: any, res) => {
    try {
      const requests = await storage.getConnectionRequests((req.user as any).id);
      res.json(requests);
    } catch (error) {
      console.error("Get connection requests error:", error);
      res.status(500).json({ message: "Failed to get connection requests" });
    }
  });

  app.get("/api/connections/status/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const conn = await storage.getConnectionStatus((req.user as any).id, req.params.userId);
      res.json(conn || { status: "none" });
    } catch (error) {
      console.error("Get connection status error:", error);
      res.status(500).json({ message: "Failed to get connection status" });
    }
  });

  // Direct Messages
  app.get("/api/messages/conversations", isAuthenticated, async (req: any, res) => {
    try {
      const conversations = await storage.getConversationList((req.user as any).id);
      res.json(conversations);
    } catch (error) {
      console.error("Get conversations error:", error);
      res.status(500).json({ message: "Failed to get conversations" });
    }
  });

  app.get("/api/messages/unread-count", isAuthenticated, async (req: any, res) => {
    try {
      const count = await storage.getUnreadCount((req.user as any).id);
      res.json({ count });
    } catch (error) {
      console.error("Get unread count error:", error);
      res.status(500).json({ message: "Failed to get unread count" });
    }
  });

  app.get("/api/messages/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = (req.user as any).id;
      const otherUserId = req.params.userId;
      const conn = await storage.getConnectionStatus(currentUserId, otherUserId);
      if (!conn || conn.status !== "accepted") {
        return res.status(403).json({ message: "You can only view messages with connected users" });
      }
      const messages = await storage.getDirectMessages(currentUserId, otherUserId, 50);
      res.json(messages);
    } catch (error) {
      console.error("Get messages error:", error);
      res.status(500).json({ message: "Failed to get messages" });
    }
  });

  app.post("/api/messages/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const senderId = (req.user as any).id;
      const receiverId = req.params.userId;
      const { content } = req.body;
      if (!content || !content.trim()) return res.status(400).json({ message: "content is required" });

      const conn = await storage.getConnectionStatus(senderId, receiverId);
      if (!conn || conn.status !== "accepted") {
        return res.status(403).json({ message: "You can only message connected users" });
      }

      const msg = await storage.sendDirectMessage(senderId, receiverId, content.trim());
      res.json(msg);
    } catch (error) {
      console.error("Send message error:", error);
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  app.post("/api/messages/:userId/read", isAuthenticated, async (req: any, res) => {
    try {
      await storage.markMessagesRead((req.user as any).id, req.params.userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Mark read error:", error);
      res.status(500).json({ message: "Failed to mark messages as read" });
    }
  });

  // Stripe Connect for donation payouts
  app.post("/api/stripe/connect-account", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      if (user.stripeConnectAccountId) {
        return res.json({ accountId: user.stripeConnectAccountId });
      }

      const stripe = await getUncachableStripeClient();
      const account = await stripe.accounts.create({
        type: "express",
        email: user.email || undefined,
        metadata: { userId },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });

      await db.update(users).set({ stripeConnectAccountId: account.id }).where(eq(users.id, userId));
      res.json({ accountId: account.id });
    } catch (error) {
      console.error("Connect account error:", error);
      res.status(500).json({ message: "Failed to create connect account" });
    }
  });

  app.get("/api/stripe/connect-onboarding", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const user = await storage.getUser(userId);
      if (!user?.stripeConnectAccountId) {
        return res.status(400).json({ message: "No connect account. Create one first." });
      }

      const stripe = await getUncachableStripeClient();
      const link = await stripe.accountLinks.create({
        account: user.stripeConnectAccountId,
        refresh_url: `${req.protocol}://${req.get("host")}/profile`,
        return_url: `${req.protocol}://${req.get("host")}/profile?connect=success`,
        type: "account_onboarding",
      });

      res.json({ url: link.url });
    } catch (error) {
      console.error("Connect onboarding error:", error);
      res.status(500).json({ message: "Failed to get onboarding link" });
    }
  });

  app.get("/api/stripe/connect-dashboard", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const user = await storage.getUser(userId);
      if (!user?.stripeConnectAccountId) {
        return res.status(400).json({ message: "No connect account" });
      }

      const stripe = await getUncachableStripeClient();
      const link = await stripe.accounts.createLoginLink(user.stripeConnectAccountId);
      res.json({ url: link.url });
    } catch (error) {
      console.error("Connect dashboard error:", error);
      res.status(500).json({ message: "Failed to get dashboard link" });
    }
  });

  app.get("/api/payouts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const earnings = await storage.getUserDonationEarnings(userId);
      const user = await storage.getUser(userId);
      res.json({
        totalEarnings: earnings.total,
        donations: earnings.donations,
        connectAccountId: user?.stripeConnectAccountId || null,
      });
    } catch (error) {
      console.error("Payouts error:", error);
      res.status(500).json({ message: "Failed to get payout info" });
    }
  });

  // Stripe donation checkout
  app.post("/api/projects/:id/donate-checkout", isAuthenticated, async (req: any, res) => {
    try {
      const donorId = (req.user as any).id;
      const projectId = req.params.id;
      const { amount } = req.body;

      if (!amount || amount < 100) return res.status(400).json({ message: "Minimum donation is $1.00" });

      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const stripe = await getUncachableStripeClient();
      const donor = await storage.getUser(donorId);

      let customerId = donor?.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: donor?.email || undefined,
          metadata: { userId: donorId },
        });
        await storage.updateUserStripeInfo(donorId, { stripeCustomerId: customer.id });
        customerId = customer.id;
      }

      const owner = await storage.getUser(project.ownerId);
      const sessionParams: any = {
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: `Donation to ${project.title}` },
            unit_amount: amount,
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: `${req.protocol}://${req.get("host")}/projects/${projectId}?donated=true`,
        cancel_url: `${req.protocol}://${req.get("host")}/projects/${projectId}`,
        metadata: { type: "donation", projectId, donorId, amount: String(amount) },
      };

      if (owner?.stripeConnectAccountId) {
        const platformFee = Math.round(amount * 0.1);
        sessionParams.payment_intent_data = {
          application_fee_amount: platformFee,
          transfer_data: { destination: owner.stripeConnectAccountId },
        };
      }

      const session = await stripe.checkout.sessions.create(sessionParams);
      res.json({ url: session.url });
    } catch (error) {
      console.error("Donation checkout error:", error);
      res.status(500).json({ message: "Failed to create donation checkout" });
    }
  });

  // User projects (own + member of)
  app.get("/api/user/projects", isAuthenticated, async (req: any, res) => {
    try {
      const userProjectsList = await storage.getUserProjects((req.user as any).id);
      res.json(userProjectsList);
    } catch (error) {
      console.error("Get user projects error:", error);
      res.status(500).json({ message: "Failed to get user projects" });
    }
  });

  // Subscription & Stripe routes
  app.get("/api/subscription", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const sub = await storage.getUserSubscription(userId);
      res.json(sub);
    } catch (error) {
      console.error("Error fetching subscription:", error);
      res.status(500).json({ message: "Failed to fetch subscription" });
    }
  });

  app.get("/api/plans", async (_req, res) => {
    try {
      const result = await db.execute(
        sql`SELECT p.id as product_id, p.name, p.description, p.metadata,
                   pr.id as price_id, pr.unit_amount, pr.currency, pr.recurring
            FROM stripe.products p
            JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
            WHERE p.active = true
            ORDER BY pr.unit_amount ASC`
      );

      const plans = [
        {
          id: "free",
          name: "Free",
          description: "Get started with 20 AI credits per month",
          price: 0,
          priceId: null,
          features: ["20 AI credits/month", "Create public projects", "Join contests", "Community access"],
          tier: "free",
          credits: 20,
        },
      ];

      for (const row of result.rows as any[]) {
        const metadata = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata || {};
        plans.push({
          id: row.product_id,
          name: row.name,
          description: row.description || "",
          price: row.unit_amount / 100,
          priceId: row.price_id,
          features: getFeaturesForTier(metadata.tier),
          tier: metadata.tier || "free",
          credits: metadata.credits === "unlimited" ? -1 : parseInt(metadata.credits || "0"),
        });
      }

      res.json(plans);
    } catch (error) {
      console.error("Error fetching plans:", error);
      const fallbackPlans = [
        { id: "free", name: "Free", description: "Get started with 20 AI credits per month", price: 0, priceId: null, features: ["20 AI credits/month", "Create public projects", "Join contests", "Community access"], tier: "free", credits: 20 },
        { id: "spark_pro", name: "Spark Pro", description: "100 AI credits/month for power users", price: 4.99, priceId: null, features: ["100 AI credits/month", "Create public projects", "Priority support", "Community access"], tier: "spark_pro", credits: 100 },
        { id: "spark_business", name: "Spark Business", description: "250 AI credits/month + private projects", price: 9.99, priceId: null, features: ["250 AI credits/month", "Private projects", "Priority support", "Advanced analytics"], tier: "spark_business", credits: 250 },
        { id: "spark_unlimited", name: "Spark Unlimited", description: "Unlimited AI credits + all features", price: 29.99, priceId: null, features: ["Unlimited AI credits", "Private projects", "AI roadmap generation", "Premium support", "All features"], tier: "spark_unlimited", credits: -1 },
      ];
      res.json(fallbackPlans);
    }
  });

  app.post("/api/checkout", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const { priceId } = req.body;
      if (!priceId) return res.status(400).json({ message: "priceId is required" });

      const priceCheck = await db.execute(
        sql`SELECT pr.id FROM stripe.prices pr
            JOIN stripe.products p ON pr.product = p.id
            WHERE pr.id = ${priceId} AND pr.active = true AND p.active = true`
      );
      if ((priceCheck.rows as any[]).length === 0) {
        return res.status(400).json({ message: "Invalid price" });
      }

      const stripe = await getUncachableStripeClient();
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email || undefined,
          metadata: { userId },
        });
        await storage.updateUserStripeInfo(userId, { stripeCustomerId: customer.id });
        customerId = customer.id;
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: "subscription",
        success_url: `${req.protocol}://${req.get("host")}/pricing?success=true`,
        cancel_url: `${req.protocol}://${req.get("host")}/pricing?canceled=true`,
        metadata: { userId },
      });

      res.json({ url: session.url });
    } catch (error) {
      console.error("Checkout error:", error);
      res.status(500).json({ message: "Failed to create checkout session" });
    }
  });

  app.post("/api/billing-portal", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const user = await storage.getUser(userId);
      if (!user?.stripeCustomerId) {
        return res.status(400).json({ message: "No active subscription" });
      }

      const stripe = await getUncachableStripeClient();
      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${req.protocol}://${req.get("host")}/pricing`,
      });

      res.json({ url: session.url });
    } catch (error) {
      console.error("Billing portal error:", error);
      res.status(500).json({ message: "Failed to create portal session" });
    }
  });

  app.get("/api/stripe/publishable-key", async (_req, res) => {
    try {
      const key = await getStripePublishableKey();
      res.json({ publishableKey: key });
    } catch (error) {
      console.error("Error getting publishable key:", error);
      res.status(500).json({ message: "Failed to get publishable key" });
    }
  });

  app.post("/api/stripe/sync-subscription", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const user = await storage.getUser(userId);
      if (!user?.stripeCustomerId) {
        return res.json({ tier: "free" });
      }

      const stripe = await getUncachableStripeClient();
      const subscriptions = await stripe.subscriptions.list({
        customer: user.stripeCustomerId,
        status: "active",
        limit: 1,
      });

      if (subscriptions.data.length === 0) {
        await storage.updateUserStripeInfo(userId, { subscriptionTier: "free", stripeSubscriptionId: undefined });
        return res.json({ tier: "free" });
      }

      const sub = subscriptions.data[0];
      const priceId = sub.items.data[0]?.price?.id;
      if (priceId) {
        const price = await stripe.prices.retrieve(priceId);
        const metadata = price.metadata || {};
        const tier = metadata.tier || "free";
        await storage.updateUserStripeInfo(userId, {
          subscriptionTier: tier,
          stripeSubscriptionId: sub.id,
        });
        return res.json({ tier });
      }

      res.json({ tier: user.subscriptionTier || "free" });
    } catch (error) {
      console.error("Sync subscription error:", error);
      res.status(500).json({ message: "Failed to sync subscription" });
    }
  });

  // ============================================
  // GAMES
  // ============================================

  const TYPING_PROMPTS = [
    { category: "Startup Pitch", text: "Our platform connects freelance developers with early-stage startups, enabling rapid prototyping through AI-assisted code generation and real-time collaboration tools." },
    { category: "Startup Pitch", text: "We are building a marketplace for sustainable packaging solutions, helping e-commerce brands reduce their carbon footprint while maintaining premium unboxing experiences." },
    { category: "Product Spec", text: "The dashboard shall display real-time analytics including user retention rates, conversion funnels, and revenue metrics with customizable date ranges and export functionality." },
    { category: "Product Spec", text: "Authentication module must support OAuth 2.0 with Google, GitHub, and Apple providers, implementing secure token refresh and session management with configurable expiry." },
    { category: "Code Snippet", text: "async function fetchUserData(userId: string): Promise<UserProfile> { const response = await fetch(`/api/users/${userId}`); if (!response.ok) throw new Error('Failed to fetch user'); return response.json(); }" },
    { category: "Code Snippet", text: "const calculateMetrics = (data: DataPoint[]) => data.reduce((acc, point) => ({ total: acc.total + point.value, count: acc.count + 1, average: (acc.total + point.value) / (acc.count + 1) }), { total: 0, count: 0, average: 0 });" },
    { category: "Problem Statement", text: "Small business owners spend an average of twelve hours per week on manual bookkeeping tasks that could be automated, leading to delayed financial insights and increased error rates." },
    { category: "Problem Statement", text: "Remote teams struggle with asynchronous communication across time zones, resulting in delayed decisions, duplicated work, and decreased team cohesion over extended periods." },
    { category: "Technical Explanation", text: "WebSocket connections maintain a persistent bidirectional communication channel between the client and server, enabling real-time data transfer without the overhead of repeated HTTP handshakes." },
    { category: "Technical Explanation", text: "Database indexing creates a sorted reference structure that dramatically reduces query execution time by allowing the engine to locate rows without scanning entire tables sequentially." },
    { category: "Mission Statement", text: "We empower creators and builders to transform their ideas into reality by providing intelligent tools, collaborative workspaces, and a supportive community of innovators." },
    { category: "Mission Statement", text: "Our mission is to democratize access to artificial intelligence by building intuitive interfaces that allow non-technical users to leverage machine learning in their daily workflows." },
    { category: "Feature Description", text: "The drag-and-drop kanban board allows project managers to organize tasks across customizable columns, assign team members, set priority levels, and track progress with automated status updates." },
    { category: "Feature Description", text: "Real-time collaboration enables multiple users to simultaneously edit documents with cursor presence indicators, inline comments, version history, and conflict resolution mechanisms." },
    { category: "Value Proposition", text: "Save forty percent of your development time with our AI-powered code review tool that catches bugs, suggests optimizations, and ensures consistent coding standards across your entire team." },
    { category: "Value Proposition", text: "Our analytics platform transforms raw data into actionable insights within minutes, not days, giving product teams the confidence to make data-driven decisions at startup speed." },
    { category: "User Story", text: "As a project manager, I want to receive automated weekly progress reports so that I can quickly identify blocked tasks and reallocate resources without scheduling additional status meetings." },
    { category: "User Story", text: "As a new user, I want a guided onboarding experience that helps me set up my profile, connect with relevant peers, and discover projects matching my skills within five minutes." },
    { category: "Architecture Decision", text: "We chose a microservices architecture to enable independent scaling of the payment processing and notification services, which experience vastly different load patterns during peak usage periods." },
    { category: "Architecture Decision", text: "The team decided to implement event sourcing for the order management system, providing a complete audit trail and enabling temporal queries to reconstruct system state at any point in time." },
  ];

  const SIGNAL_NOISE_SCENARIOS = [
    {
      scenario: "MVP Launch Priorities",
      difficulty: "beginner",
      description: "You are launching an MVP next week. What matters most right now?",
      cards: [
        { id: "1", text: "User reports onboarding confusion after first step", isSignal: true },
        { id: "2", text: "Add dark mode before launch", isSignal: false },
        { id: "3", text: "Retention dropped 18% after signup step", isSignal: true },
        { id: "4", text: "Redesign logo for extra polish", isSignal: false },
        { id: "5", text: "Server latency increasing during peak hours", isSignal: true },
        { id: "6", text: "Competitor launched a new color scheme", isSignal: false },
        { id: "7", text: "Payment flow has a 12% drop-off rate", isSignal: true },
        { id: "8", text: "Add social media share buttons", isSignal: false },
        { id: "9", text: "Critical security vulnerability in auth", isSignal: true },
        { id: "10", text: "Refactor CSS to use new naming convention", isSignal: false },
        { id: "11", text: "Core API endpoint returns 500 for 3% of requests", isSignal: true },
        { id: "12", text: "Update favicon to match brand guidelines", isSignal: false },
      ],
    },
    {
      scenario: "Fundraising Data Room",
      difficulty: "intermediate",
      description: "You are preparing for a Series A pitch. Which metrics matter to investors?",
      cards: [
        { id: "1", text: "Monthly recurring revenue grew 15% MoM for 6 months", isSignal: true },
        { id: "2", text: "Office has great natural lighting", isSignal: false },
        { id: "3", text: "Net promoter score is 72", isSignal: true },
        { id: "4", text: "Team uses the latest MacBook Pros", isSignal: false },
        { id: "5", text: "Customer acquisition cost decreased 30% this quarter", isSignal: true },
        { id: "6", text: "Website was redesigned last month", isSignal: false },
        { id: "7", text: "LTV:CAC ratio is 4.2x", isSignal: true },
        { id: "8", text: "Company softball team won the league", isSignal: false },
        { id: "9", text: "Churn rate is 2.1% monthly", isSignal: true },
        { id: "10", text: "Brand new conference room furniture", isSignal: false },
        { id: "11", text: "Pipeline shows $2M in qualified leads", isSignal: true },
        { id: "12", text: "Team completed a hackathon last weekend", isSignal: false },
        { id: "13", text: "Gross margin is 78%", isSignal: true },
        { id: "14", text: "CEO keynoted at a local meetup", isSignal: false },
      ],
    },
    {
      scenario: "Feature Prioritization Sprint",
      difficulty: "intermediate",
      description: "Your backlog has 15 items. Ship the ones that move the needle.",
      cards: [
        { id: "1", text: "Fix checkout bug causing 8% cart abandonment", isSignal: true },
        { id: "2", text: "Add animated loading spinners", isSignal: false },
        { id: "3", text: "Implement search functionality users request daily", isSignal: true },
        { id: "4", text: "Rewrite test suite to use newer framework", isSignal: false },
        { id: "5", text: "Add email notifications for order status changes", isSignal: true },
        { id: "6", text: "Migrate from tabs to spaces in codebase", isSignal: false },
        { id: "7", text: "Build API integration that 40% of users asked for", isSignal: true },
        { id: "8", text: "Add confetti animation on successful signup", isSignal: false },
        { id: "9", text: "Optimize database queries causing 3s page loads", isSignal: true },
        { id: "10", text: "Rename internal variables to follow new convention", isSignal: false },
        { id: "11", text: "Add password reset flow (currently manual process)", isSignal: true },
        { id: "12", text: "Add custom cursor on hover effects", isSignal: false },
      ],
    },
    {
      scenario: "Incident Response Triage",
      difficulty: "advanced",
      description: "Your app is experiencing issues. Identify the critical alerts from the noise.",
      cards: [
        { id: "1", text: "Database CPU at 95% and climbing", isSignal: true },
        { id: "2", text: "A user requested dark mode via support ticket", isSignal: false },
        { id: "3", text: "Error rate spiked from 0.1% to 5.2% in 10 minutes", isSignal: true },
        { id: "4", text: "SSL certificate expires in 45 days", isSignal: false },
        { id: "5", text: "Memory leak detected in worker process", isSignal: true },
        { id: "6", text: "New blog post got shared on social media", isSignal: false },
        { id: "7", text: "Payment webhook failures increasing exponentially", isSignal: true },
        { id: "8", text: "One user reports font looks different on Firefox", isSignal: false },
        { id: "9", text: "Queue depth reached 10,000 unprocessed jobs", isSignal: true },
        { id: "10", text: "Competitor announced a new feature on Twitter", isSignal: false },
        { id: "11", text: "API response times exceeded SLA thresholds", isSignal: true },
        { id: "12", text: "Marketing email had a typo in footer", isSignal: false },
        { id: "13", text: "Disk usage at 92% on primary data volume", isSignal: true },
        { id: "14", text: "Junior developer pushed directly to main branch", isSignal: false },
        { id: "15", text: "Load balancer health checks failing for 2 nodes", isSignal: true },
      ],
    },
    {
      scenario: "Hiring Pipeline Review",
      difficulty: "beginner",
      description: "You are reviewing candidates for a senior engineer role. Focus on what predicts success.",
      cards: [
        { id: "1", text: "Candidate has 8 years building production systems", isSignal: true },
        { id: "2", text: "Candidate has a cool GitHub profile picture", isSignal: false },
        { id: "3", text: "Candidate led a team of 5 through a major migration", isSignal: true },
        { id: "4", text: "Candidate uses a standing desk", isSignal: false },
        { id: "5", text: "Candidate has contributed to popular open source projects", isSignal: true },
        { id: "6", text: "Candidate has 10K Twitter followers", isSignal: false },
        { id: "7", text: "Candidate explains complex topics clearly in writing", isSignal: true },
        { id: "8", text: "Candidate went to an Ivy League school", isSignal: false },
        { id: "9", text: "Candidate built and shipped 3 side projects", isSignal: true },
        { id: "10", text: "Candidate uses the latest JavaScript framework", isSignal: false },
        { id: "11", text: "References describe candidate as collaborative and reliable", isSignal: true },
        { id: "12", text: "Candidate has a personal website with animations", isSignal: false },
      ],
    },
    {
      scenario: "Product Analytics Deep Dive",
      difficulty: "advanced",
      description: "Your product metrics dashboard has dozens of charts. Which ones inform your next move?",
      cards: [
        { id: "1", text: "Day-7 retention is 23% and declining week over week", isSignal: true },
        { id: "2", text: "Page views increased 5% (from bot traffic)", isSignal: false },
        { id: "3", text: "Feature adoption rate for new editor is 45% in first week", isSignal: true },
        { id: "4", text: "Average session duration is 4.2 minutes (unchanged)", isSignal: false },
        { id: "5", text: "Power users generate 80% of all content created", isSignal: true },
        { id: "6", text: "Bounce rate on marketing page is 62% (industry average)", isSignal: false },
        { id: "7", text: "Activation rate dropped from 35% to 22% after redesign", isSignal: true },
        { id: "8", text: "Total registered users passed 50,000 milestone", isSignal: false },
        { id: "9", text: "Users who complete onboarding have 3x higher retention", isSignal: true },
        { id: "10", text: "Email open rate is 28% (up from 27%)", isSignal: false },
        { id: "11", text: "Support ticket volume doubled after latest release", isSignal: true },
        { id: "12", text: "Social media mentions increased by 12 this week", isSignal: false },
        { id: "13", text: "Revenue per user increased 18% among enterprise tier", isSignal: true },
      ],
    },
    {
      scenario: "Customer Feedback Triage",
      difficulty: "intermediate",
      description: "You have 100+ pieces of customer feedback. Find the patterns that matter.",
      cards: [
        { id: "1", text: "15 users report the same export bug this week", isSignal: true },
        { id: "2", text: "One user wants the app in Comic Sans", isSignal: false },
        { id: "3", text: "Enterprise customer threatens to churn over missing SSO", isSignal: true },
        { id: "4", text: "User suggests adding a virtual pet to the dashboard", isSignal: false },
        { id: "5", text: "NPS dropped 12 points in the latest survey", isSignal: true },
        { id: "6", text: "Someone left a one-word review saying 'nice'", isSignal: false },
        { id: "7", text: "3 out of 5 churned users cite slow performance", isSignal: true },
        { id: "8", text: "A user wants custom emoji reactions", isSignal: false },
        { id: "9", text: "Support tickets about billing increased 200%", isSignal: true },
        { id: "10", text: "One user submitted feedback entirely in haiku", isSignal: false },
        { id: "11", text: "Users spend 3x more time on feature they hate than feature they like", isSignal: true },
        { id: "12", text: "A user asked if the app works on a smart fridge", isSignal: false },
      ],
    },
    {
      scenario: "Security Audit Findings",
      difficulty: "advanced",
      description: "A security audit returned 20 findings. Prioritize what to fix immediately.",
      cards: [
        { id: "1", text: "SQL injection vulnerability in search endpoint", isSignal: true },
        { id: "2", text: "Login page has a minor CSS alignment issue", isSignal: false },
        { id: "3", text: "API keys stored in plaintext in environment variables", isSignal: true },
        { id: "4", text: "Error messages use slightly different font weights", isSignal: false },
        { id: "5", text: "Cross-site scripting possible in user-generated content", isSignal: true },
        { id: "6", text: "Favicon not optimized for all browser sizes", isSignal: false },
        { id: "7", text: "No rate limiting on authentication endpoints", isSignal: true },
        { id: "8", text: "Admin panel uses a different shade of blue", isSignal: false },
        { id: "9", text: "User sessions do not expire after password change", isSignal: true },
        { id: "10", text: "About page has an outdated team photo", isSignal: false },
        { id: "11", text: "File upload allows arbitrary file types without validation", isSignal: true },
        { id: "12", text: "Footer copyright year says 2024", isSignal: false },
        { id: "13", text: "CORS policy allows requests from any origin", isSignal: true },
      ],
    },
    {
      scenario: "Startup Pivot Decision",
      difficulty: "advanced",
      description: "Your B2C product is struggling. Which signals suggest a pivot to B2B?",
      cards: [
        { id: "1", text: "Enterprise customers have 10x lower churn than consumers", isSignal: true },
        { id: "2", text: "Your office plant is thriving", isSignal: false },
        { id: "3", text: "Average deal size with businesses is $5K/month vs $9/month B2C", isSignal: true },
        { id: "4", text: "A competitor raised funding last month", isSignal: false },
        { id: "5", text: "3 companies asked for custom integrations unprompted", isSignal: true },
        { id: "6", text: "Your social media following grew by 200", isSignal: false },
        { id: "7", text: "B2C acquisition cost exceeds 12-month LTV", isSignal: true },
        { id: "8", text: "New coffee machine in the office", isSignal: false },
        { id: "9", text: "Inbound leads from companies requesting demos doubled", isSignal: true },
        { id: "10", text: "Weekend hackathon produced cool demo features", isSignal: false },
        { id: "11", text: "Top 5% of users (all businesses) drive 70% of revenue", isSignal: true },
        { id: "12", text: "Team wore matching t-shirts at a conference", isSignal: false },
      ],
    },
    {
      scenario: "Team Performance Review",
      difficulty: "intermediate",
      description: "You are evaluating team health. Which metrics indicate real performance issues?",
      cards: [
        { id: "1", text: "Sprint velocity declined 30% over 3 sprints", isSignal: true },
        { id: "2", text: "Team Slack channel has fewer emoji reactions this week", isSignal: false },
        { id: "3", text: "Code review turnaround time increased from 4h to 2 days", isSignal: true },
        { id: "4", text: "Someone brought donuts less often", isSignal: false },
        { id: "5", text: "Bug escape rate tripled after the last two deployments", isSignal: true },
        { id: "6", text: "Standup meetings run 2 minutes longer on average", isSignal: false },
        { id: "7", text: "Two senior engineers updated their LinkedIn profiles this week", isSignal: true },
        { id: "8", text: "The team Spotify playlist has not been updated", isSignal: false },
        { id: "9", text: "On-call incidents woke up the same person 5 times this month", isSignal: true },
        { id: "10", text: "Team lunch preferences changed from Thai to Mexican", isSignal: false },
        { id: "11", text: "Technical debt items in backlog grew from 15 to 45", isSignal: true },
        { id: "12", text: "Team meme channel has been quiet", isSignal: false },
      ],
    },
  ];

  const ROLE_STATS: Record<string, { health: number; attack: number; defense: number; range: number; visibility: number }> = {
    commander: { health: 80, attack: 5, defense: 15, range: 1, visibility: 8 },
    warrior: { health: 120, attack: 25, defense: 10, range: 1, visibility: 2 },
    strategist: { health: 70, attack: 15, defense: 5, range: 3, visibility: 4 },
    scout: { health: 60, attack: 10, defense: 5, range: 1, visibility: 6 },
    engineer: { health: 90, attack: 8, defense: 20, range: 1, visibility: 3 },
  };

  function generateTacticsMap(size: number) {
    const grid: string[][] = [];
    for (let y = 0; y < size; y++) {
      const row: string[] = [];
      for (let x = 0; x < size; x++) {
        const rand = Math.random();
        if (rand < 0.1) row.push("mountain");
        else if (rand < 0.2) row.push("forest");
        else if (rand < 0.25) row.push("water");
        else row.push("plain");
      }
      grid.push(row);
    }
    grid[0][0] = "plain"; grid[0][1] = "plain";
    grid[size - 1][size - 1] = "plain"; grid[size - 1][size - 2] = "plain";
    return grid;
  }

  function getStartPositions(teamId: number, size: number, playerIndex: number) {
    if (teamId === 1) return { x: playerIndex % 3, y: Math.floor(playerIndex / 3) };
    return { x: size - 1 - (playerIndex % 3), y: size - 1 - Math.floor(playerIndex / 3) };
  }

  // --- Game Leaderboard ---
  app.get("/api/games/leaderboard/:gameType", async (req, res) => {
    try {
      const leaderboard = await storage.getGameLeaderboard(req.params.gameType, 50);
      res.json(leaderboard);
    } catch (error) { res.status(500).json({ message: "Failed to get leaderboard" }); }
  });

  // --- Tactics Arena ---
  app.post("/api/games/tactics/create", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const mapSize = 8;
      const mapData = generateTacticsMap(mapSize);
      const game = await storage.createTacticsGame({ status: "waiting", mapSize, mapData, currentRound: 0, maxRounds: 10 });
      const role = req.body.role || "warrior";
      const teamId = 1;
      const pos = getStartPositions(teamId, mapSize, 0);
      const stats = ROLE_STATS[role] || ROLE_STATS.warrior;
      await storage.createTacticsPlayer({ gameId: game.id, userId, teamId, role, health: stats.health, position: pos, resources: 50 });
      const players = await storage.getTacticsPlayers(game.id);
      res.json({ ...game, players });
    } catch (error) { console.error("Create tactics game error:", error); res.status(500).json({ message: "Failed to create game" }); }
  });

  app.get("/api/games/tactics/lobby", async (_req, res) => {
    try {
      const games = await storage.getWaitingTacticsGames();
      const enriched = await Promise.all(games.map(async (g) => {
        const players = await storage.getTacticsPlayers(g.id);
        return { ...g, players, playerCount: players.length };
      }));
      res.json(enriched);
    } catch (error) { res.status(500).json({ message: "Failed to get lobby" }); }
  });

  app.post("/api/games/tactics/:id/join", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const game = await storage.getTacticsGame(req.params.id);
      if (!game || game.status !== "waiting") return res.status(400).json({ message: "Game not available" });
      const players = await storage.getTacticsPlayers(game.id);
      if (players.find(p => p.userId === userId)) return res.status(400).json({ message: "Already in game" });
      if (players.length >= 10) return res.status(400).json({ message: "Game is full" });
      const team1Count = players.filter(p => p.teamId === 1).length;
      const team2Count = players.filter(p => p.teamId === 2).length;
      const teamId = req.body.teamId || (team1Count <= team2Count ? 1 : 2);
      const teamPlayers = players.filter(p => p.teamId === teamId);
      const role = req.body.role || "warrior";
      const pos = getStartPositions(teamId, game.mapSize, teamPlayers.length);
      const stats = ROLE_STATS[role] || ROLE_STATS.warrior;
      await storage.createTacticsPlayer({ gameId: game.id, userId, teamId, role, health: stats.health, position: pos, resources: 50 });
      const updatedPlayers = await storage.getTacticsPlayers(game.id);
      res.json({ ...game, players: updatedPlayers });
    } catch (error) { console.error("Join tactics game error:", error); res.status(500).json({ message: "Failed to join game" }); }
  });

  app.post("/api/games/tactics/:id/start", isAuthenticated, async (req: any, res) => {
    try {
      const game = await storage.getTacticsGame(req.params.id);
      if (!game || game.status !== "waiting") return res.status(400).json({ message: "Cannot start" });
      const players = await storage.getTacticsPlayers(game.id);
      if (players.length < 2) return res.status(400).json({ message: "Need at least 2 players" });
      const updated = await storage.updateTacticsGame(game.id, { status: "discussion", currentRound: 1 });
      res.json({ ...updated, players });
    } catch (error) { res.status(500).json({ message: "Failed to start game" }); }
  });

  app.get("/api/games/tactics/:id", async (req: any, res) => {
    try {
      const game = await storage.getTacticsGame(req.params.id);
      if (!game) return res.status(404).json({ message: "Game not found" });
      const players = await storage.getTacticsPlayers(game.id);
      const moves = game.currentRound > 0 ? await storage.getTacticsMovesForRound(game.id, game.currentRound) : [];
      res.json({ ...game, players, moves });
    } catch (error) { res.status(500).json({ message: "Failed to get game" }); }
  });

  app.post("/api/games/tactics/:id/move", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const game = await storage.getTacticsGame(req.params.id);
      if (!game || game.status !== "discussion") return res.status(400).json({ message: "Not in move phase" });
      const players = await storage.getTacticsPlayers(game.id);
      const player = players.find(p => p.userId === userId);
      if (!player || !player.isAlive) return res.status(400).json({ message: "Cannot move" });
      const existingMoves = await storage.getTacticsMovesForRound(game.id, game.currentRound);
      if (existingMoves.find(m => m.playerId === player.id)) return res.status(400).json({ message: "Already submitted move" });
      const move = await storage.createTacticsMove({ gameId: game.id, round: game.currentRound, playerId: player.id, actionType: req.body.actionType, targetPosition: req.body.targetPosition || null, targetPlayerId: req.body.targetPlayerId || null });
      res.json(move);
    } catch (error) { res.status(500).json({ message: "Failed to submit move" }); }
  });

  app.post("/api/games/tactics/:id/resolve", isAuthenticated, async (req: any, res) => {
    try {
      const game = await storage.getTacticsGame(req.params.id);
      if (!game || game.status !== "discussion") return res.status(400).json({ message: "Cannot resolve" });
      const players = await storage.getTacticsPlayers(game.id);
      const alivePlayers = players.filter(p => p.isAlive);
      const moves = await storage.getTacticsMovesForRound(game.id, game.currentRound);
      const results: any[] = [];

      for (const move of moves) {
        const player = players.find(p => p.id === move.playerId);
        if (!player || !player.isAlive) continue;
        const stats = ROLE_STATS[player.role] || ROLE_STATS.warrior;

        if (move.actionType === "move" && move.targetPosition) {
          const pos = move.targetPosition as { x: number; y: number };
          if (pos.x >= 0 && pos.x < game.mapSize && pos.y >= 0 && pos.y < game.mapSize) {
            await storage.updateTacticsPlayer(player.id, { position: pos });
            results.push({ playerId: player.id, action: "moved", to: pos });
          }
        } else if (move.actionType === "attack" && move.targetPlayerId) {
          const target = players.find(p => p.id === move.targetPlayerId);
          if (target && target.isAlive && target.teamId !== player.teamId) {
            const damage = stats.attack + Math.floor(Math.random() * 10);
            const newHealth = Math.max(0, target.health - damage);
            await storage.updateTacticsPlayer(target.id, { health: newHealth, isAlive: newHealth > 0 });
            results.push({ playerId: player.id, action: "attacked", targetId: target.id, damage, targetHealth: newHealth });
          }
        } else if (move.actionType === "ability") {
          if (player.role === "commander") {
            const teammates = alivePlayers.filter(p => p.teamId === player.teamId && p.id !== player.id);
            for (const t of teammates) {
              const newHealth = Math.min(ROLE_STATS[t.role]?.health || 100, t.health + 15);
              await storage.updateTacticsPlayer(t.id, { health: newHealth });
            }
            results.push({ playerId: player.id, action: "commander_buff", healed: 15 });
          } else if (player.role === "strategist") {
            results.push({ playerId: player.id, action: "trap_placed", position: move.targetPosition });
          } else if (player.role === "scout") {
            results.push({ playerId: player.id, action: "revealed_area", position: move.targetPosition });
          } else if (player.role === "engineer") {
            const newResources = player.resources + 20;
            await storage.updateTacticsPlayer(player.id, { resources: newResources });
            results.push({ playerId: player.id, action: "gathered_resources", resources: newResources });
          }
        } else if (move.actionType === "defend") {
          results.push({ playerId: player.id, action: "defending" });
        }
      }

      const updatedPlayers = await storage.getTacticsPlayers(game.id);
      const team1Alive = updatedPlayers.filter(p => p.teamId === 1 && p.isAlive);
      const team2Alive = updatedPlayers.filter(p => p.teamId === 2 && p.isAlive);
      const team1Commander = updatedPlayers.find(p => p.teamId === 1 && p.role === "commander");
      const team2Commander = updatedPlayers.find(p => p.teamId === 2 && p.role === "commander");

      let winnerId = null;
      let status = game.status;
      if (team1Alive.length === 0 || (team1Commander && !team1Commander.isAlive)) { winnerId = "team2"; status = "completed"; }
      else if (team2Alive.length === 0 || (team2Commander && !team2Commander.isAlive)) { winnerId = "team1"; status = "completed"; }
      else if (game.currentRound >= game.maxRounds) {
        const team1HP = team1Alive.reduce((s, p) => s + p.health, 0);
        const team2HP = team2Alive.reduce((s, p) => s + p.health, 0);
        winnerId = team1HP >= team2HP ? "team1" : "team2";
        status = "completed";
      }

      const nextRound = status === "completed" ? game.currentRound : game.currentRound + 1;
      const updated = await storage.updateTacticsGame(game.id, { currentRound: nextRound, winnerId, status });

      if (status === "completed") {
        const winningTeamId = winnerId === "team1" ? 1 : 2;
        const winners = updatedPlayers.filter(p => p.teamId === winningTeamId);
        for (const w of winners) {
          await storage.createLeaderboardEntry({ gameType: "tactics", userId: w.userId, score: 100 + (w.health || 0), metadata: { role: w.role, rounds: game.currentRound } });
          const existing = await storage.getUserBadges(w.userId);
          if (!existing.find((b: any) => b.badgeId === "badge-tactics-first")) {
            await storage.awardBadge(w.userId, "badge-tactics-first");
          }
        }
      }

      res.json({ ...updated, players: updatedPlayers, results });
    } catch (error) { console.error("Resolve tactics error:", error); res.status(500).json({ message: "Failed to resolve round" }); }
  });

  // --- Typing Arena ---
  app.post("/api/games/typing/create", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const prompt = TYPING_PROMPTS[Math.floor(Math.random() * TYPING_PROMPTS.length)];
      const race = await storage.createTypingRace({ promptText: prompt.text, promptCategory: prompt.category, maxPlayers: 6 });
      await storage.createTypingRacePlayer({ raceId: race.id, userId, status: "waiting" });
      const players = await storage.getTypingRacePlayers(race.id);
      res.json({ ...race, players });
    } catch (error) { console.error("Create typing race error:", error); res.status(500).json({ message: "Failed to create race" }); }
  });

  app.get("/api/games/typing/lobby", async (_req, res) => {
    try {
      const races = await storage.getWaitingTypingRaces();
      const enriched = await Promise.all(races.map(async (r) => {
        const players = await storage.getTypingRacePlayers(r.id);
        return { ...r, players, playerCount: players.length };
      }));
      res.json(enriched);
    } catch (error) { res.status(500).json({ message: "Failed to get lobby" }); }
  });

  app.post("/api/games/typing/:id/join", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const race = await storage.getTypingRace(req.params.id);
      if (!race || race.status !== "waiting") return res.status(400).json({ message: "Race not available" });
      const players = await storage.getTypingRacePlayers(race.id);
      if (players.find(p => p.userId === userId)) return res.status(400).json({ message: "Already in race" });
      if (players.length >= race.maxPlayers) return res.status(400).json({ message: "Race is full" });
      await storage.createTypingRacePlayer({ raceId: race.id, userId, status: "waiting" });
      const updatedPlayers = await storage.getTypingRacePlayers(race.id);
      res.json({ ...race, players: updatedPlayers });
    } catch (error) { res.status(500).json({ message: "Failed to join race" }); }
  });

  app.post("/api/games/typing/:id/start", isAuthenticated, async (req: any, res) => {
    try {
      const race = await storage.getTypingRace(req.params.id);
      if (!race || race.status !== "waiting") return res.status(400).json({ message: "Cannot start" });
      const updated = await storage.updateTypingRace(race.id, { status: "active", startedAt: new Date() });
      const players = await storage.getTypingRacePlayers(race.id);
      for (const p of players) { await storage.updateTypingRacePlayer(p.id, { status: "racing" }); }
      const updatedPlayers = await storage.getTypingRacePlayers(race.id);
      res.json({ ...updated, players: updatedPlayers });
    } catch (error) { res.status(500).json({ message: "Failed to start race" }); }
  });

  app.get("/api/games/typing/:id", async (req, res) => {
    try {
      const race = await storage.getTypingRace(req.params.id);
      if (!race) return res.status(404).json({ message: "Race not found" });
      const players = await storage.getTypingRacePlayers(race.id);
      res.json({ ...race, players });
    } catch (error) { res.status(500).json({ message: "Failed to get race" }); }
  });

  app.post("/api/games/typing/:id/progress", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const race = await storage.getTypingRace(req.params.id);
      if (!race || race.status !== "active") return res.status(400).json({ message: "Race not active" });
      const players = await storage.getTypingRacePlayers(race.id);
      const player = players.find(p => p.userId === userId);
      if (!player || player.status !== "racing") return res.status(400).json({ message: "Not racing" });
      await storage.updateTypingRacePlayer(player.id, {
        wpm: req.body.wpm || 0, accuracy: req.body.accuracy || 0,
        progress: req.body.progress || 0, charsTyped: req.body.charsTyped || 0,
        errors: req.body.errors || 0,
      });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ message: "Failed to update progress" }); }
  });

  app.post("/api/games/typing/:id/finish", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const race = await storage.getTypingRace(req.params.id);
      if (!race || race.status !== "active") return res.status(400).json({ message: "Race not active" });
      const players = await storage.getTypingRacePlayers(race.id);
      const player = players.find(p => p.userId === userId);
      if (!player || player.status !== "racing") return res.status(400).json({ message: "Not racing" });
      const wpm = req.body.wpm || 0;
      const accuracy = req.body.accuracy || 0;
      const finishTimeMs = req.body.finishTimeMs || 0;
      const score = Math.round(wpm * (accuracy / 100) * 10);
      await storage.updateTypingRacePlayer(player.id, { wpm, accuracy, progress: 100, charsTyped: req.body.charsTyped || race.promptText.length, finishTimeMs, status: "finished", score });
      await storage.createLeaderboardEntry({ gameType: "typing", userId, score, metadata: { wpm, accuracy, finishTimeMs, category: race.promptCategory } });
      const existingBadges = await storage.getUserBadges(userId);
      if (!existingBadges.find((b: any) => b.badgeId === "badge-typing-first")) { await storage.awardBadge(userId, "badge-typing-first"); }
      if (wpm >= 80 && !existingBadges.find((b: any) => b.badgeId === "badge-typing-speed")) { await storage.awardBadge(userId, "badge-typing-speed"); }
      if (accuracy === 100 && !existingBadges.find((b: any) => b.badgeId === "badge-typing-perfect")) { await storage.awardBadge(userId, "badge-typing-perfect"); }
      const allPlayers = await storage.getTypingRacePlayers(race.id);
      const allFinished = allPlayers.every(p => p.status === "finished" || p.status === "dnf");
      if (allFinished) { await storage.updateTypingRace(race.id, { status: "finished" }); }
      res.json({ score, wpm, accuracy, finishTimeMs });
    } catch (error) { console.error("Finish typing race error:", error); res.status(500).json({ message: "Failed to finish race" }); }
  });

  // --- Signal vs. Noise ---
  app.get("/api/games/signal-noise/scenarios", async (_req, res) => {
    res.json(SIGNAL_NOISE_SCENARIOS.map(s => ({ scenario: s.scenario, difficulty: s.difficulty, description: s.description, cardCount: s.cards.length })));
  });

  app.post("/api/games/signal-noise/start", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const scenarioName = req.body.scenario;
      const scenario = SIGNAL_NOISE_SCENARIOS.find(s => s.scenario === scenarioName) || SIGNAL_NOISE_SCENARIOS[Math.floor(Math.random() * SIGNAL_NOISE_SCENARIOS.length)];
      const shuffledCards = [...scenario.cards].sort(() => Math.random() - 0.5);
      const game = await storage.createSignalNoiseGame({ userId, scenario: scenario.scenario, difficulty: scenario.difficulty, cards: shuffledCards, decisions: [] });
      res.json(game);
    } catch (error) { console.error("Start signal noise error:", error); res.status(500).json({ message: "Failed to start game" }); }
  });

  app.post("/api/games/signal-noise/:id/decide", isAuthenticated, async (req: any, res) => {
    try {
      const game = await storage.getSignalNoiseGame(req.params.id);
      if (!game || game.completedAt) return res.status(400).json({ message: "Game not active" });
      const { cardId, choice, timeMs } = req.body;
      const cards = game.cards as any[];
      const card = cards.find((c: any) => c.id === cardId);
      if (!card) return res.status(400).json({ message: "Card not found" });
      const correct = (choice === "keep" && card.isSignal) || (choice === "discard" && !card.isSignal);
      const decisions = [...(game.decisions as any[]), { cardId, choice, correct, timeMs }];
      const updated = await storage.updateSignalNoiseGame(game.id, { decisions });
      res.json({ correct, decisions });
    } catch (error) { res.status(500).json({ message: "Failed to record decision" }); }
  });

  app.post("/api/games/signal-noise/:id/complete", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const game = await storage.getSignalNoiseGame(req.params.id);
      if (!game || game.completedAt) return res.status(400).json({ message: "Game not active" });
      const decisions = game.decisions as any[];
      const correctCount = decisions.filter((d: any) => d.correct).length;
      const accuracy = decisions.length > 0 ? Math.round((correctCount / decisions.length) * 100) : 0;
      const avgReactionMs = decisions.length > 0 ? Math.round(decisions.reduce((s: number, d: any) => s + (d.timeMs || 0), 0) / decisions.length) : 0;
      let streak = 0; let maxStreak = 0;
      for (const d of decisions) { if (d.correct) { streak++; maxStreak = Math.max(maxStreak, streak); } else { streak = 0; } }
      const difficultyMultiplier = game.difficulty === "advanced" ? 1.5 : game.difficulty === "intermediate" ? 1.2 : 1;
      const score = Math.round(correctCount * 10 * difficultyMultiplier + maxStreak * 5 + Math.max(0, (5000 - avgReactionMs) / 50));
      const updated = await storage.updateSignalNoiseGame(game.id, { score, streak: maxStreak, accuracy, avgReactionMs, completedAt: new Date(), decisions });
      await storage.createLeaderboardEntry({ gameType: "signal", userId, score, metadata: { scenario: game.scenario, difficulty: game.difficulty, accuracy, streak: maxStreak, avgReactionMs } });
      const existingBadges = await storage.getUserBadges(userId);
      if (!existingBadges.find((b: any) => b.badgeId === "badge-signal-first")) { await storage.awardBadge(userId, "badge-signal-first"); }
      if (maxStreak >= 10 && !existingBadges.find((b: any) => b.badgeId === "badge-signal-streak")) { await storage.awardBadge(userId, "badge-signal-streak"); }
      if (accuracy >= 90 && game.difficulty === "advanced" && !existingBadges.find((b: any) => b.badgeId === "badge-signal-ace")) { await storage.awardBadge(userId, "badge-signal-ace"); }
      res.json(updated);
    } catch (error) { console.error("Complete signal noise error:", error); res.status(500).json({ message: "Failed to complete game" }); }
  });

  app.get("/api/games/signal-noise/:id", async (req, res) => {
    try {
      const game = await storage.getSignalNoiseGame(req.params.id);
      if (!game) return res.status(404).json({ message: "Game not found" });
      res.json(game);
    } catch (error) { res.status(500).json({ message: "Failed to get game" }); }
  });

  app.post("/api/seed", async (req, res) => {
    try {
      // 1. Create some users if they don't exist
      const demoUsers = [
        { id: "user1", email: "alice@example.com", firstName: "Alice", lastName: "Smith" },
        { id: "user2", email: "bob@example.com", firstName: "Bob", lastName: "Jones" },
        { id: "user3", email: "charlie@example.com", firstName: "Charlie", lastName: "Brown" },
      ];

      for (const u of demoUsers) {
        const existing = await storage.getUser(u.id);
        if (!existing) {
          await db.insert(users).values(u).onConflictDoNothing();
          
          await storage.upsertUserProfile({
            userId: u.id,
            headline: `${u.firstName}'s Headline`,
            bio: `This is ${u.firstName}'s bio.`,
            skills: ["React", "TypeScript", "Node.js"],
            interests: ["Web Development", "AI"],
            experienceLevel: "intermediate",
            location: "Remote",
            isOnboarded: true,
          });
        }
      }

      // 2. Create some projects
      const projectsData = [
        {
          ownerId: "user1",
          title: "SparkTower AI",
          description: "An AI-powered platform for collaboration.",
          category: "Software",
          status: "active" as const,
          rolesNeeded: ["Frontend Developer", "Backend Developer", "ML Engineer"],
          teamSize: 3,
          estimatedWeeks: 12,
          mediaUrls: [],
        },
        {
          ownerId: "user2",
          title: "Green Energy Tracker",
          description: "Track your energy consumption and reduce your carbon footprint.",
          category: "Sustainability",
          status: "planning" as const,
          rolesNeeded: ["Data Analyst", "Backend Developer"],
          teamSize: 2,
          estimatedWeeks: 8,
        },
        {
          ownerId: "user3",
          title: "Crypto Wallet",
          description: "A secure and easy-to-use crypto wallet.",
          category: "Fintech",
          status: "completed" as const,
          rolesNeeded: ["Mobile Developer", "Full Stack Developer", "Security Engineer"],
          teamSize: 4,
          estimatedWeeks: 16,
        },
        {
          ownerId: "user1",
          title: "Smart Home Assistant",
          description: "Control your home with your voice.",
          category: "IoT",
          status: "active" as const,
          rolesNeeded: ["DevOps Engineer", "Full Stack Developer"],
          teamSize: 1,
          estimatedWeeks: 6,
        }
      ];

      for (const p of projectsData) {
        await storage.createProject(p);
      }

      // 3. Create badges
      const badgesData = [
        { name: "Early Adopter", description: "Joined SparkTower in its early days", icon: "rocket", rarity: "rare" as const, category: "community" },
        { name: "First Project", description: "Created your first project on SparkTower", icon: "star", rarity: "common" as const, category: "milestone" },
        { name: "Hackathon Winner", description: "Won a SparkTower hackathon", icon: "trophy", rarity: "legendary" as const, category: "competition" },
        { name: "Team Player", description: "Joined 3 or more projects", icon: "users", rarity: "common" as const, category: "collaboration" },
        { name: "AI Explorer", description: "Generated an AI storyboard", icon: "sparkles", rarity: "rare" as const, category: "innovation" },
        { name: "Top Contributor", description: "Reached the top 10 on the leaderboard", icon: "award", rarity: "epic" as const, category: "competition" },
      ];
      for (const b of badgesData) {
        await storage.createBadge(b);
      }

      // 4. Create contests
      const badges = await storage.getBadges();
      const hackathonBadge = badges.find(b => b.name === "Hackathon Winner");
      const now = new Date();
      const contestsData = [
        {
          title: "Build a Climate Dashboard",
          description: "Create an interactive dashboard that visualizes climate data. Use any tech stack you prefer. Projects will be judged on design, functionality, and impact.",
          category: "Sustainability",
          difficulty: "intermediate" as const,
          status: "active" as const,
          prize: "$500 + Featured on SparkTower",
          badgeId: hackathonBadge?.id || null,
          startDate: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          endDate: new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000),
          maxParticipants: 50,
          promoted: true,
        },
        {
          title: "AI-Powered Portfolio Generator",
          description: "Build a tool that uses AI to generate personalized developer portfolios. Bonus points for creative layouts and customization options.",
          category: "AI/ML",
          difficulty: "advanced" as const,
          status: "active" as const,
          prize: "$300 + SparkTower Pro Membership",
          badgeId: null,
          startDate: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
          endDate: new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000),
          maxParticipants: 30,
          promoted: false,
        },
        {
          title: "Beginner Hackathon: Todo App Showdown",
          description: "New to coding? Build the best todo app you can! Focus on user experience, clean code, and creative features. All skill levels welcome.",
          category: "Web App",
          difficulty: "beginner" as const,
          status: "upcoming" as const,
          prize: "SparkTower Swag Pack",
          badgeId: null,
          startDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
          endDate: new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000),
          maxParticipants: 100,
          promoted: true,
        },
        {
          title: "Open Source Contribution Sprint",
          description: "Contribute to open source projects and earn points. The more impactful your contributions, the higher you score. Document your PRs and contributions.",
          category: "DevOps",
          difficulty: "intermediate" as const,
          status: "completed" as const,
          prize: "$200 + Badge",
          badgeId: null,
          startDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
          endDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
          maxParticipants: null,
          promoted: false,
        },
      ];
      for (const c of contestsData) {
        await storage.createContest(c);
      }

      res.json({ message: "Seed data created successfully" });
    } catch (error) {
      console.error("Error seeding data:", error);
      res.status(500).json({ message: "Failed to seed data", error: error instanceof Error ? error.message : String(error) });
    }
  });

  return httpServer;
}
