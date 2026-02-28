import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { users, projectMembers, projects } from "@shared/schema";
import { setupAuth, isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { registerAuthRoutes } from "./replit_integrations/auth/routes";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { insertUserProfileSchema, insertProjectSchema, insertDonationSchema } from "@shared/schema";
import { z } from "zod";
import OpenAI from "openai";
import { eq } from "drizzle-orm";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);
  registerObjectStorageRoutes(app);

  // User Profile
  app.get("/api/profile", isAuthenticated, async (req: any, res) => {
    const profile = await storage.getUserProfile(req.user.claims.sub);
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    res.json(profile);
  });

  app.post("/api/profile", isAuthenticated, async (req: any, res) => {
    const userId = req.user.claims.sub;
    const validated = insertUserProfileSchema.parse({ ...req.body, userId });
    const profile = await storage.upsertUserProfile(validated);
    res.json(profile);
  });

  app.post("/api/profile/complete-onboarding", isAuthenticated, async (req: any, res) => {
    await storage.completeOnboarding(req.user.claims.sub);
    res.json({ success: true });
  });

  // General AI Chat for project creation (no project ID needed yet)
  app.post("/api/chat", isAuthenticated, async (req: any, res) => {
    try {
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
    const ownerId = req.user.claims.sub;
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

  app.post("/api/projects/:id/join", isAuthenticated, async (req: any, res) => {
    const userId = req.user.claims.sub;
    const projectId = req.params.id;
    const { role } = req.body;
    
    // Check if already a member
    const members = await storage.getProjectMembers(projectId);
    if (members.some(m => m.userId === userId)) {
      return res.status(400).json({ message: "Already a member" });
    }

    const member = await db.insert(projectMembers).values({
      projectId,
      userId,
      role: role || "member"
    }).returning();
    
    res.json(member[0]);
  });

  app.patch("/api/projects/:id", isAuthenticated, async (req: any, res) => {
    const project = await storage.getProject(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });
    if (project.ownerId !== req.user.claims.sub) return res.status(403).json({ message: "Unauthorized" });
    
    const validated = insertProjectSchema.partial().parse(req.body);
    const updated = await storage.updateProject(req.params.id, validated);
    res.json(updated);
  });

  // Project Chat
  app.get("/api/projects/:id/chat", isAuthenticated, async (req, res) => {
    const messages = await storage.getProjectChatMessages(req.params.id as string);
    res.json(messages);
  });

  app.post("/api/projects/:id/chat", isAuthenticated, async (req: any, res) => {
    const projectId = req.params.id;
    const { message } = req.body;
    
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
    
    res.json(aiMessage);
  });

  // Donations
  app.get("/api/projects/:id/donations", async (req, res) => {
    const donations = await storage.getProjectDonations(req.params.id);
    res.json(donations);
  });

  app.post("/api/projects/:id/donate", isAuthenticated, async (req: any, res) => {
    const donorId = req.user.claims.sub;
    const projectId = req.params.id;
    const validated = insertDonationSchema.parse({ ...req.body, donorId, projectId });
    const donation = await storage.createDonation(validated);
    res.json(donation);
  });

  // Matches
  app.get("/api/matches", isAuthenticated, async (req: any, res) => {
    const userId = req.user.claims.sub;
    const matches = await storage.getUserMatches(userId);
    res.json(matches);
  });

  app.post("/api/matches/generate", isAuthenticated, async (req: any, res) => {
    const userId = req.user.claims.sub;
    const userProfile = await storage.getUserProfile(userId);
    if (!userProfile) return res.status(400).json({ message: "Complete your profile first" });

    const allProfiles = await storage.searchUsers(""); // Simple way to get all for now
    const otherProfiles = allProfiles.filter(p => p.id !== userId && p.profile?.isOnboarded);

    // AI logic for matching
    const prompt = `Match the following user with others based on skills, interests, and experience level.
    Current User: ${JSON.stringify(userProfile)}
    Other Users: ${JSON.stringify(otherProfiles.map(p => ({ id: p.id, ...p.profile })))}
    
    Return a JSON array of matches with: { matchedUserId: string, score: number (0-100), reasons: string[] }`;

    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [{ role: "system", content: "You are a matchmaking AI. Return only valid JSON." }, { role: "user", content: prompt }],
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content || '{"matches": []}');
    const matches = result.matches || [];

    const savedMatches = await Promise.all(matches.map((m: any) => 
      storage.upsertUserMatch({
        userId,
        matchedUserId: m.matchedUserId,
        score: m.score,
        reasons: m.reasons
      })
    ));

    res.json(savedMatches);
  });

  // Leaderboard
  app.get("/api/leaderboard", async (req, res) => {
    const sortBy = (req.query.sortBy as "views" | "donations") || "views";
    const limit = parseInt(req.query.limit as string) || 10;
    const leaderboard = await storage.getLeaderboard(sortBy, limit);
    res.json(leaderboard);
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
      if (project.ownerId !== req.user.claims.sub) return res.status(403).json({ message: "Unauthorized" });

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
      if (project.ownerId !== req.user.claims.sub) return res.status(403).json({ message: "Unauthorized" });

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
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== req.user.claims.sub) return res.status(403).json({ message: "Unauthorized" });

      const { prompt, style = "professional" } = req.body;
      const videoPrompt = prompt || `Create a short showcase video for the project "${project.title}": ${project.description}`;

      const styleModifiers: Record<string, string> = {
        professional: "clean, corporate, modern design, professional photography style, polished, minimalist",
        futuristic: "cyberpunk, neon glow, holographic, sci-fi, dark background, high-tech, digital",
        funny: "humorous, exaggerated, playful, bright colors, comic style, whimsical, fun",
        cartoon: "animated cartoon style, colorful, illustrated, hand-drawn feel, Pixar-like, vibrant",
      };

      const styleDesc = styleModifiers[style] || styleModifiers.professional;

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
            content: `You are an AI that extracts scene descriptions from storyboards. Given a storyboard, extract exactly 5 scenes. For each scene, provide:
1. A concise image generation prompt (2-3 sentences describing the visual scene in detail, incorporating the style: ${styleDesc})
2. A short caption (1 sentence summary for display)

Respond ONLY with valid JSON in this exact format:
[
  {"prompt": "detailed image description...", "caption": "Short caption text"},
  {"prompt": "detailed image description...", "caption": "Short caption text"},
  {"prompt": "detailed image description...", "caption": "Short caption text"},
  {"prompt": "detailed image description...", "caption": "Short caption text"},
  {"prompt": "detailed image description...", "caption": "Short caption text"}
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
        scenes = parsed.slice(0, 5).map((s: any) => ({
          prompt: s.prompt || "",
          caption: s.caption || "",
          imageUrl: "",
        }));
        if (scenes.length === 0) throw new Error("Empty scenes array");
      } catch (parseErr) {
        console.error("Error parsing scenes:", parseErr);
        scenes = [
          { prompt: "Opening scene for the project showcase", caption: "Welcome to the project", imageUrl: "" },
          { prompt: "Key features demonstration", caption: "Core features overview", imageUrl: "" },
          { prompt: "Technical architecture overview", caption: "Built with modern tech", imageUrl: "" },
          { prompt: "User experience showcase", caption: "Designed for users", imageUrl: "" },
          { prompt: "Closing scene with call to action", caption: "Join us today", imageUrl: "" },
        ];
      }

      res.json({
        storyboard,
        scenes,
        style,
        message: "AI storyboard and scenes generated successfully!",
        projectId: project.id,
      });
    } catch (error) {
      console.error("Error generating video:", error);
      res.status(500).json({ message: "Failed to generate video" });
    }
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

      res.json({ message: "Seed data created successfully" });
    } catch (error) {
      console.error("Error seeding data:", error);
      res.status(500).json({ message: "Failed to seed data", error: error instanceof Error ? error.message : String(error) });
    }
  });

  return httpServer;
}
