import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { users, projectMembers, projects } from "@shared/schema";
import { setupAuth, isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { registerAuthRoutes } from "./replit_integrations/auth/routes";
import { registerObjectStorageRoutes, ObjectStorageService } from "./replit_integrations/object_storage";
import { insertUserProfileSchema, insertProjectSchema, insertDonationSchema, insertContestSchema } from "@shared/schema";
import { z } from "zod";
import OpenAI from "openai";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";

function getFeaturesForTier(tier: string): string[] {
  const features: Record<string, string[]> = {
    spark_pro: ["100 AI credits/month", "Create public projects", "Priority support", "Community access"],
    spark_business: ["250 AI credits/month", "Private projects", "Priority support", "Advanced analytics"],
    spark_unlimited: ["Unlimited AI credits", "Private projects", "AI roadmap generation", "Premium support", "All features"],
  };
  return features[tier] || ["20 AI credits/month", "Create public projects", "Join contests", "Community access"];
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
      const userId = req.user.claims.sub;
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
    const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
      const hasCredits = await storage.checkCredits(userId, 5);
      if (!hasCredits) {
        const sub = await storage.getUserSubscription(userId);
        return res.status(403).json({ message: "Insufficient credits. Video generation costs 5 credits.", creditsRemaining: sub.creditsRemaining, tier: sub.tier });
      }

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
          const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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

  // Subscription & Stripe routes
  app.get("/api/subscription", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
