import { ROADMAP_DEPTHS, DEFAULT_ROADMAP_DEPTH, MAX_ROADMAP_PHASES, roadmapDepth, depthForRevision, type RoadmapDepth } from "@shared/roadmap";
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage, isTaskOnTime } from "./storage";
import { db } from "./db";
import { users, projectMembers, projects, userProfiles, projectDataShapes } from "@shared/schema";
import { setupAuth, isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { registerAuthRoutes } from "./replit_integrations/auth/routes";
import { attachBearerUser, registerMobileAuthRoutes } from "./mobile-auth";
import { registerObjectStorageRoutes, ObjectStorageService, ObjectNotFoundError } from "./replit_integrations/object_storage";
import { registerSprintRoutes } from "./sprint-routes";
import { registerInvestorRoutes } from "./investor-routes";
import { registerNovaBriefingRoutes } from "./nova-briefing";
import { registerFeedRoutes, registerProjectDiscussionRoutes, publishSystemPost, SYSTEM_POST_COPY, SYSTEM_POST_TYPES } from "./feed-routes";
import { registerProfileRoutes } from "./profile-routes";
import { registerDocumentRoutes } from "./document-routes";
import { registerCodeAuditRoutes } from "./code-audit-routes";
import { registerBackingRoutes } from "./backing-routes";
import { registerCheckInRoutes } from "./check-in-routes";
import { registerSurfaceRoutes, requireSurface } from "./surfaces";
import { registerModerationRoutes, blockSuspended, rateLimit } from "./moderation";
import { attachVisitor, captureWrites, registerAnalyticsIngest } from "./analytics";
import { registerAnalyticsRoutes } from "./analytics-routes";
import { captureAttribution } from "./attribution";
import { registerNovaAssistRoutes } from "./nova-assist-routes";
import {
  applyProjectOperations, buildOperableProjectState, renderLatestAudit,
  stripIdFragments, collectProjectIds, OPERATION_SCHEMA_INSTRUCTIONS,
} from "./project-operations";
import { insertUserProfileSchema, insertProjectSchema, insertProjectBase, insertDonationSchema, insertContestSchema, insertProjectLiveChatMessageSchema, insertWaitlistEntrySchema, insertInterviewSchema, insertExperimentSchema, insertPricingTierSchema, insertAnalyticsEventSchema, insertLegalDocSchema, insertDeployChecklistItemSchema, insertSupportTicketSchema, insertLaunchTaskSchema, type StoryboardScene } from "@shared/schema";
import { z } from "zod";
import OpenAI from "openai";
import { eq, ne, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { calculateUserReputation } from "./reputation";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { formatProjectBriefForPrompt, getProjectBriefContext } from "@shared/project-sections";
import { TEXT_MODEL, IMAGE_MODEL, IMAGE_SIZE, IMAGE_QUALITY } from "./aiModels";
import {
  TIER_IDS, PLAN_PRESENTATION, ENTITLEMENTS, COMPARISON_ROWS, CREDIT_COSTS,
  FAIR_USE_NOTICE, FAIR_USE_MONTHLY_CAP, normalizeTier, roadmapRebuildCost,
  type TierId,
} from "@shared/plans";
import {
  getUserEntitlements, requireFeature, requireLevel, requireCredits,
  checkPrivateProjectQuota, modelFor, memoryLimitFor, taskLimitFor,
  coachingDirectiveFor,
} from "./entitlements";
import { isValidSubcategory, PROJECT_GOALS } from "@shared/goals";
import { recordActivity } from "./analytics";
import { seal } from "./secret-box";
import { safeDbUrl, refreshDataShape, getDataShape } from "./data-shape";
import { isOwner as isPlatformOwner } from "./platform-roles";
import {
  instantiatePathTree, pathStatus, onPathTaskDone, createExpansion, createInjections,
  collectArtifacts, switchPath, backboneIdOf, reconcileMilestones, pathTaskContext, saveWork, chooseWork, milestoneDetail, createLoop, setBranch, extendBranch, reconcileLoops, latestWork, deleteLoop,
} from "./phase-trees";
import { draftExpansionSteps, proposeInjections, readExistingProgress, draftArtifact, produceWork } from "./phase-trees-nova";
import { workKindFor } from "@shared/phase-trees";
import { resolveTree, treeFor } from "@shared/phase-trees";

async function isProjectMember(userId: string, projectId: string): Promise<boolean> {
  const project = await storage.getProject(projectId);
  if (!project) return false;
  if (project.ownerId === userId) return true;
  const members = await storage.getProjectMembers(projectId);
  return members.some(m => m.userId === userId);
}

const _rawOpenAiBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const _openAiBaseURL = _rawOpenAiBase ? (_rawOpenAiBase.endsWith("/v1") ? _rawOpenAiBase : `${_rawOpenAiBase.replace(/\/$/,"")}/v1`) : undefined;
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: _openAiBaseURL,
});

/**
 * URL for a storyboard frame. Always the authenticated streaming route — the
 * underlying private object path is never sent to the client.
 */
function sceneImageUrl(storyboard: { id: string; scenes: unknown }, index: number): string | null {
  const scene = ((storyboard.scenes as StoryboardScene[]) || [])[index];
  if (!scene || (!scene.imagePath && !scene.inlineImage)) return null;
  return `/api/storyboards/${storyboard.id}/scenes/${index}/image`;
}

/** Storyboard scenes in the shape the slideshow expects. */
function toClientScenes(storyboard: { id: string; scenes: unknown }) {
  return ((storyboard.scenes as StoryboardScene[]) || []).map((scene, i) => ({
    caption: scene.caption,
    prompt: scene.prompt,
    imageUrl: sceneImageUrl(storyboard, i) || "",
  }));
}

/**
 * Maps each paid tier to its active Stripe price ID.
 *
 * Reads the tables synced by stripe-replit-sync first (cheap, local), then
 * falls back to the Stripe API — its backfill doesn't cover products/prices,
 * so the synced tables are empty until a product webhook fires. Results are
 * cached briefly so the pricing page doesn't hit Stripe on every load.
 */
let _priceCache: { at: number; value: Map<string, string> } | null = null;
const PRICE_CACHE_MS = 60_000;

async function getPriceIdsByTier(): Promise<Map<string, string>> {
  if (_priceCache && Date.now() - _priceCache.at < PRICE_CACHE_MS) {
    return _priceCache.value;
  }

  const byTier = new Map<string, string>();
  const parse = (m: any) => (typeof m === "string" ? JSON.parse(m) : m || {});

  try {
    const result = await db.execute(
      sql`SELECT p.metadata as product_metadata, pr.id as price_id, pr.unit_amount, pr.metadata as price_metadata
          FROM stripe.products p
          JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
          WHERE p.active = true
          ORDER BY pr.unit_amount ASC`
    );
    for (const row of result.rows as any[]) {
      const tier = parse(row.price_metadata).tier || parse(row.product_metadata).tier;
      // normalizeTier maps legacy spark_* products onto the new tiers.
      const normalized = normalizeTier(tier);
      if (normalized !== "free" && !byTier.has(normalized)) byTier.set(normalized, row.price_id);
    }
  } catch (error: any) {
    // stripe.* tables only exist once stripe-replit-sync has migrated.
    console.warn("Synced Stripe tables unavailable:", error?.message || error);
  }

  if (byTier.size === 0) {
    try {
      const stripe = await getUncachableStripeClient();
      const prices = await stripe.prices.list({ active: true, expand: ["data.product"], limit: 100 });
      for (const price of prices.data) {
        const product = price.product as any;
        if (!product || product.deleted || product.active === false) continue;
        if (price.recurring?.interval !== "month") continue;
        const tier = normalizeTier(price.metadata?.tier || product.metadata?.tier);
        if (tier !== "free" && !byTier.has(tier)) byTier.set(tier, price.id);
      }
    } catch (error: any) {
      // No Stripe credentials — the catalog still renders, just without checkout.
      console.warn("Stripe price lookup unavailable, serving catalog without checkout:", error?.message || error);
    }
  }

  _priceCache = { at: Date.now(), value: byTier };
  return byTier;
}

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

/** Action types Nova is allowed to trigger from a reply. */
const NOVA_ACTION_TYPES = new Set([
  "update_project", "update_scope", "create_tasks", "create_milestones", "complete_onboarding",
  "edit_project",
]);

/**
 * Finds the index of the `}` closing the object that opens at `start`.
 * String-aware, so braces inside values don't throw off the count.
 * Returns -1 when the object never closes.
 */
function matchClosingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Parses a candidate blob into an action, or null if it isn't one. */
function parseNovaAction(blob: string): any | null {
  try {
    const parsed = JSON.parse(blob.trim());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (typeof parsed.type !== "string" || !NOVA_ACTION_TYPES.has(parsed.type)) return null;
    if (parsed.data === undefined || parsed.data === null) parsed.data = {};
    if (typeof parsed.data !== "object" || Array.isArray(parsed.data)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Pulls Nova's actions out of a reply and strips them from the visible text.
 *
 * The prompt asks for `<nova_action>{...}</nova_action>`, but the model
 * regularly emits the object bare or inside a ```json fence instead. Those
 * replies used to match nothing, so the action was dropped silently while Nova
 * still told the user "Done ✅" — the update never reached the database. So
 * scan for the wrapper first, then fall back to any balanced JSON object that
 * parses into a known action type.
 *
 * Brace matching (rather than a regex) is what makes the fallback safe: it
 * tolerates nested objects and trailing junk like an extra `}`, and only
 * accepts a blob whose parsed `type` is a real action, so ordinary JSON that
 * Nova quotes in conversation is left alone.
 */
export function extractNovaActions(reply: string): { actions: any[]; cleaned: string } {
  const actions: any[] = [];
  const spans: [number, number][] = [];

  const tagRe = /<nova_action>([\s\S]*?)<\/nova_action>/g;
  for (const m of reply.matchAll(tagRe)) {
    const action = parseNovaAction(m[1]);
    if (action) {
      actions.push(action);
      spans.push([m.index!, m.index! + m[0].length]);
    }
  }

  const covered = (i: number) => spans.some(([s, e]) => i >= s && i < e);

  let i = 0;
  while (i < reply.length) {
    const start = reply.indexOf("{", i);
    if (start === -1) break;
    if (covered(start)) { i = start + 1; continue; }
    const end = matchClosingBrace(reply, start);
    if (end === -1) break;
    const action = parseNovaAction(reply.slice(start, end + 1));
    if (action) {
      actions.push(action);
      spans.push([start, end + 1]);
      i = end + 1;
    } else {
      i = start + 1;
    }
  }

  // Cut the action spans out back-to-front so earlier offsets stay valid.
  let cleaned = reply;
  for (const [s, e] of [...spans].sort((a, b) => b[0] - a[0])) {
    cleaned = cleaned.slice(0, s) + cleaned.slice(e);
  }

  // Tidy up what the removal leaves behind: empty code fences, orphaned
  // punctuation from a malformed action (the model likes to add an extra `}`),
  // and the runs of blank lines where the action used to sit.
  cleaned = cleaned
    .replace(/```[a-zA-Z]*\s*```/g, "")
    .replace(/^[ \t]*[{}[\],]+[ \t]*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { actions, cleaned };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  // Bearer auth must run before every guarded route so a mobile caller's token
  // populates req.user. It sits above registerAuthRoutes too — otherwise
  // /api/auth/user stays cookie-only and 401s for a perfectly valid token.
  // No-op when there's no Bearer header, so cookie sessions are unaffected.
  app.use(attachBearerUser);
  /*
   * A suspended account can read but not write, anywhere. Mounted globally
   * because a suspension that only covers the routes someone remembered to
   * decorate is not a suspension.
   */
  app.use(blockSuspended);
  /*
   * Behaviour capture, mounted here for two reasons.
   *
   * `attachVisitor` runs before the routes so a visitor and session id exist on
   * the very first request of a visit, including the one that serves the
   * landing page to someone who has never been here.
   *
   * `captureWrites` sits above every registration below it, so a route added
   * later is recorded without anyone remembering to record it. It reads
   * `req.user` at response time, which is why it can sit above the auth routes
   * and still attribute a sign-in to the account it created.
   */
  app.use(attachVisitor);
  /* First-touch signup attribution, stamped on the same first page. */
  app.use(captureAttribution);
  app.use(captureWrites);
  registerAnalyticsIngest(app);
  registerAnalyticsRoutes(app);
  registerAuthRoutes(app);
  registerMobileAuthRoutes(app);
  registerObjectStorageRoutes(app);
  registerSprintRoutes(app);
  registerInvestorRoutes(app);
  registerNovaBriefingRoutes(app);
  registerFeedRoutes(app);
  registerProjectDiscussionRoutes(app);
  registerProfileRoutes(app);
  registerDocumentRoutes(app);
  registerCodeAuditRoutes(app);
  registerNovaAssistRoutes(app);
  /*
   * Kill switches, mounted as path prefixes rather than per-route.
   *
   * A guard added to 66 individual registrations is one a future route forgets
   * to include; a prefix covers everything under it, including sub-routes that
   * don't exist yet. This is the point at which a surface is genuinely off —
   * the nav filtering on the client is only cosmetics on top of it.
   */
  for (const [prefix, id] of [
    ["/api/games", "games"],
    ["/api/contests", "contests"],
    ["/api/sprints", "sprints"],
    ["/api/sprint", "sprints"],
    ["/api/matches", "matches"],
    ["/api/connections", "connections"],
    ["/api/messages", "messages"],
    ["/api/leaderboard", "leaderboard"],
    ["/api/feed", "feed"],
    ["/api/check-ins", "checkIns"],
    ["/api/loop-events", "checkIns"],
  ] as const) {
    app.use(prefix, requireSurface(id));
  }

  registerSurfaceRoutes(app);
  registerModerationRoutes(app);
  registerBackingRoutes(app);
  registerCheckInRoutes(app);

  // User Profile
  app.get("/api/profile", isAuthenticated, async (req: any, res) => {
    const profile = await storage.getUserProfile((req.user as any).id);
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    res.json(profile);
  });

  /**
   * Saves a profile.
   *
   * This is a MERGE, not a replace. Both callers — the onboarding wizard and
   * the profile editor — post only the fields their own form owns, and a
   * replace wiped everything else on the row: Nova's résumé-derived
   * experience, education and portfolio, the "looking for" call, the avatar,
   * and the isOnboarded flag. Clearing that flag bounced the user straight
   * back into onboarding, which looked like the whole account had reset.
   *
   * So: validate the incoming fields as a patch, then layer it over what's
   * already stored. A field the client didn't send is a field it isn't
   * changing.
   */
  app.post("/api/profile", isAuthenticated, async (req: any, res) => {
    const userId = (req.user as any).id;
    const existing = await storage.getUserProfile(userId);

    // Identity and lifecycle columns are the server's to set. `isOnboarded`
    // in particular only ever moves forward, via complete-onboarding.
    const { id, userId: _ignoredUserId, createdAt, isOnboarded, ...incoming } = req.body ?? {};

    const patch = insertUserProfileSchema.partial().parse(incoming);
    // react-hook-form sends `undefined` for untouched optional fields; those
    // must not overwrite stored values.
    for (const key of Object.keys(patch)) {
      if ((patch as any)[key] === undefined) delete (patch as any)[key];
    }

    if (!existing && !patch.displayName) {
      return res.status(400).json({ message: "A display name is required to create your profile." });
    }

    const profile = await storage.upsertUserProfile({
      ...(existing ?? {}),
      ...patch,
      userId,
      isOnboarded: existing?.isOnboarded ?? false,
    } as any);
    res.json(profile);
  });

  /**
   * Everything the profile card on the home rail needs, in one request.
   *
   * The card shows the profile plus half a dozen counts. Fetching those as
   * separate queries meant six round trips to render one box above the fold,
   * and the numbers could disagree with each other mid-render.
   */
  app.get("/api/profile/summary", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const [profile, projects, followed, connections, reputation, badges, taskStats] = await Promise.all([
        storage.getUserProfile(userId),
        storage.getUserProjects(userId).catch(() => []),
        storage.getUserFollowedProjects(userId).catch(() => []),
        storage.getConnections(userId).catch(() => []),
        storage.getUserReputation(userId).catch(() => undefined),
        storage.getUserBadges(userId).catch(() => []),
        storage.getUserTaskStats(userId).catch(() => undefined),
      ]);

      const owned = projects.filter((p: any) => p.ownerId === userId);
      res.json({
        profile: profile ?? null,
        stats: {
          projects: owned.length,
          // Views across everything they own: the closest thing SparkTower
          // has to LinkedIn's "profile viewers".
          projectViews: owned.reduce((sum: number, p: any) => sum + (p.views ?? 0), 0),
          following: followed.length,
          connections: connections.length,
          tasksCompleted: taskStats?.tasksCompleted ?? 0,
          // The composite builder index is the headline reputation number.
          reputationScore: reputation?.builderIndex ?? null,
          badges: badges.length,
        },
      });
    } catch (error) {
      console.error("Profile summary error:", error);
      res.status(500).json({ message: "Failed to load your profile summary" });
    }
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
   Early on, find out which of the three paths this project is on and set "goal" accordingly — 🚀 **shipping an MVP** (get a first version in front of people), 🔧 **systemizing a business** (make something that already works run without them in every step), or 💰 **raising funding** (get the story and numbers investor-ready). Ask if it isn't obvious; never assume shipping for a business that already has customers.
3. Ask what **tools and platforms** they're using or planning to use (GitHub, Replit, Google Colab, Figma, etc.). If they have existing repos or live demos, ask for links.
4. Ask about their **target audience** — who will use this? What problem does it solve?
5. Work through the tricky parts *with* their answer: "🤔 The part that'll take real care is X — here's how we'd handle it." Never suggest dropping a feature or idea they've told you about; if something belongs later, say it's a later phase.
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
<project_update>{"title": "...", "description": "...", "goal": "ship_mvp" | "systemize_business" | "raise_funding", "subcategory": "<one of the goal's kinds: ship→app|saas|game|website|other, systemize→restaurant|service|retail|other, raise→startup_equity|local_community|loan_grant|other>", "rolesNeeded": [...], "techStack": [...], "teamSize": 2, "estimatedWeeks": 8, "category": "...", "repoUrl": "...", "liveUrl": "..."}</project_update>

Only include fields you have enough info to fill. Start empty if needed.`;

      const messages = [
        { role: "system" as const, content: systemPrompt },
        ...history.map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user" as const, content: message }
      ];

      const response = await openai.chat.completions.create({
        // Some deployments/users may not have access to custom "gpt-5.2" models.
        // Use a broadly available fallback model so requests don't 404.
        model: process.env.AI_DEFAULT_MODEL || "gpt-4o-mini",
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
    } catch (error: any) {
      // Improved logging for OpenAI client errors to aid diagnosis without
      // exposing secrets to clients. In development, include the error message.
      console.error("Chat error:", error);
      if (error?.status) {
        console.error("OpenAI status:", error.status);
      }
      if (error?.headers) {
        console.error("OpenAI headers:", error.headers);
      }
      // If OpenAI indicates exhausted credits, return 402 with guidance.
      if (error?.code === "credit_balance_exhausted" || error?.error?.type === "insufficient_quota") {
        return res.status(402).json({ message: "OpenAI account out of credits. Add credits or update the API key.", details: error?.error?.message || error?.message });
      }

      if (process.env.NODE_ENV === "development") {
        // Return a slightly more helpful error in dev for quicker debugging.
        return res.status(500).json({ message: "AI chat failed", error: error?.message || String(error) });
      }

      res.status(500).json({ message: "AI chat failed" });
    }
  });

  // Projects
  app.get("/api/projects", async (req: any, res) => {
    const { category, status } = req.query;
    const projects = await storage.getProjects({
      category: category as string,
      status: status as string,
      // Owners still see their own private projects in listings.
      includePrivateOwnedBy: req.user?.id,
    });
    res.json(projects);
  });

  /**
   * Solo Builder Mode and recruiting are mutually exclusive, so enforce it at
   * the write boundary rather than trusting each client.
   *
   * The web create page clears roles when the toggle flips, but that left two
   * holes: the mobile create screen and any project whose roles were set
   * before the toggle. Both produced solo projects advertising open roles.
   */
  function normalizeSoloMode<T extends Record<string, any>>(data: T): T {
    if (data.soloMode !== true) return data;
    return { ...data, rolesNeeded: [], teamSize: 1 };
  }

  app.post("/api/projects", isAuthenticated, rateLimit("project"), async (req: any, res) => {
    const ownerId = (req.user as any).id;
    const validated = normalizeSoloMode(insertProjectSchema.parse({ ...req.body, ownerId }));

    if (validated.isPrivate) {
      const quota = await checkPrivateProjectQuota(ownerId);
      if (!quota.allowed) return res.status(402).json(quota.body);
    }

    const project = await storage.createProject(validated);
    /*
     * The path exists before the user does anything: the backbone for their
     * goal, with this type's variants, becomes the roadmap, milestones and
     * tasks they land on. Never fatal — a project without a tree is a bug to
     * fix, not a reason to lose the project.
     */
    await instantiatePathTree(project.id, validated.goal, validated.subcategory)
      .catch((err) => console.error("[phase-trees] Failed to instantiate path:", err));

    // Announce it on the founder feed. Private projects stay off the feed.
    if (!project.isPrivate) {
      void publishSystemPost({
        authorId: ownerId,
        projectId: project.id,
        postType: SYSTEM_POST_TYPES.projectCreated,
        content: SYSTEM_POST_COPY.projectCreated(project.title, project.oneLiner),
        entityType: "project",
        entityId: project.id,
      });
    }

    res.json(project);
  });

  app.get("/api/projects/:id", async (req: any, res) => {
    const project = await storage.getProject(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });

    /*
     * A private project is only readable by its owner and members. Everyone
     * else gets a deliberately minimal "restricted" payload — the title and
     * nothing else — so the client can show a proper "this is a private
     * project" screen instead of a dead end. The brief, media, roles, stats,
     * and links are all withheld.
     */
    if (project.isPrivate) {
      const viewerId = req.user?.id;
      if (!viewerId || !(await isProjectMember(viewerId, project.id))) {
        return res.json({
          id: project.id,
          title: project.title,
          isPrivate: true,
          restricted: true,
        });
      }
    }

    await storage.incrementProjectViews(req.params.id);
    res.json(project);
  });

  app.get("/api/projects/:id/members", async (req: any, res) => {
    // Don't reveal who's on a private project to outsiders.
    const project = await storage.getProject(req.params.id);
    if (project?.isPrivate) {
      const viewerId = req.user?.id;
      if (!viewerId || !(await isProjectMember(viewerId, project.id))) {
        return res.json([]);
      }
    }
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
      const {
        title, description, status, assigneeId, priority, dueDate, order,
        tags, estimateHours, blockedByTaskId, subtasks, milestoneId,
      } = req.body;
      if (!title) return res.status(400).json({ message: "Title is required" });
      const now = new Date();
      /*
       * New tasks land at the end of the board, not at position 0.
       * Defaulting to 0 gave every task the same position, so nothing that
       * reads the order — the columns, and the calendar's per-day sort — could
       * tell them apart, and a task's own events got split up.
       */
      let resolvedOrder = Number(order);
      if (!Number.isFinite(resolvedOrder)) {
        const existing = await storage.getProjectKanbanTasks(req.params.id).catch(() => []);
        resolvedOrder = existing.length
          ? Math.max(...existing.map((t: any) => t.order ?? 0)) + 1
          : 0;
      }
      const task = await storage.createKanbanTask({
        projectId: req.params.id, title, description, status: status || "todo",
        assigneeId: assigneeId || null, priority: priority || "medium",
        dueDate: dueDate ? new Date(dueDate) : null, order: resolvedOrder,
        // These were accepted by the task dialog but silently dropped here.
        tags: Array.isArray(tags) ? tags.slice(0, 12).map(String) : [],
        estimateHours: Number.isFinite(estimateHours) ? estimateHours : null,
        blockedByTaskId: blockedByTaskId || null,
        subtasks: Array.isArray(subtasks) ? subtasks : [],
        milestoneId: milestoneId || null,
        // A task created straight into a later column still needs its timeline.
        startedAt: status === "in-progress" || status === "done" ? now : null,
        startedById: status === "in-progress" || status === "done" ? userId : null,
        completedAt: status === "done" ? now : null,
        completedById: status === "done" ? userId : null,
      });
      if (status === "done") {
        const onTime = isTaskOnTime(task);
        await storage.incrementUserTaskCompletion(userId, onTime).catch(() => {});
        await storage.recordTaskCompletion({
          projectId: task.projectId, taskId: task.id, completedById: userId,
          title: task.title, priority: task.priority, onTime, completedAt: task.completedAt ?? now,
        }).catch(() => {});
      }
      res.json(task);
    } catch (error) {
      console.error("Create kanban task error:", error);
      res.status(500).json({ message: "Failed to create task" });
    }
  });

  /**
   * Nova re-sequences the board into an order you can actually work down.
   *
   * The default order is whatever tasks happened to be created in, which puts
   * work you can't start yet at the top and buries its prerequisite somewhere
   * in the middle. Nova reads the tasks, works out what genuinely depends on
   * what, records those links as real blockers, and lays out a run that opens
   * with something finishable.
   */
  app.post("/api/projects/:id/kanban/sequence", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;
      if (!(await isProjectMember(userId, projectId))) return res.status(403).json({ message: "Not a project member" });

      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const allTasks = await storage.getProjectKanbanTasks(projectId);
      // Finished work is left where it is; there's nothing to sequence about it.
      const open = allTasks.filter((t: any) => t.status !== "done");
      if (open.length < 2) {
        return res.status(400).json({ message: "There's nothing to re-order yet — add a few more tasks first." });
      }

      const ent = await requireCredits(res, userId, CREDIT_COSTS.taskSequencing, "task sequencing");
      if (!ent) return;

      const [roadmap, milestones, completions] = await Promise.all([
        storage.getProjectRoadmap(projectId).catch(() => undefined),
        storage.getProjectMilestones(projectId).catch(() => []),
        storage.getProjectTaskCompletions(projectId, 10).catch(() => []),
      ]);

      const activePhase = roadmap?.phases.find((p) => p.status === "in-progress")
        || roadmap?.phases.find((p) => p.status === "upcoming");

      const completion = await openai.chat.completions.create({
        model: modelFor(ent),
        messages: [
          {
            role: "system",
            content: `You are Nova, putting a builder's task list into the order they should actually work it. ${coachingDirectiveFor(ent)}

Sequence for momentum, in this priority:
1. NOTHING BEFORE ITS PREREQUISITE. If task B can't be started until task A is done, A comes first — always. This is the whole point; a list that opens with something unstartable is worse than no order at all.
2. Open with something finishable. The first task should be completable in one sitting with what they have now, so the list starts with a win rather than a wall.
3. Group related work so they stay in one context instead of task-switching.
4. Then weigh urgency (due dates), stated priority, and what unblocks the most other work.
5. Front-load whatever moves the current roadmap phase forward.

Also identify real dependencies you can see from the task titles and descriptions — "deploy the API" plainly depends on "write the API". Only record a dependency you're confident about; a wrong blocker is worse than a missing one. Never make a task depend on itself, and never create a loop.

Every task given to you must appear exactly once in "order".

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "rationale": "2-3 sentences on the shape of this sequence and where to start.",
  "order": [
    { "id": "task id", "reason": "one short clause on why it sits here" }
  ],
  "dependencies": [
    { "id": "task that is blocked", "blockedByTaskId": "the task it waits on", "why": "short" }
  ]
}`,
          },
          {
            role: "user",
            content: [
              `PROJECT\n${project.title} — ${project.description || "no description"}`,
              activePhase
                ? `THE PHASE THEY'RE IN NOW\n${activePhase.title}: ${activePhase.description || ""}\nOutcomes: ${((activePhase.outcomes as string[]) || []).join("; ") || "none listed"}`
                : "THE PHASE THEY'RE IN NOW\nNo roadmap yet.",
              milestones.length
                ? `MILESTONES\n${milestones.map((m) => `- ${m.title} [${m.status}]${m.targetDate ? ` due ${new Date(m.targetDate).toISOString().slice(0, 10)}` : ""}`).join("\n")}`
                : null,
              completions.length
                ? `JUST FINISHED (build on this momentum)\n${completions.map((c) => `- ${c.title}`).join("\n")}`
                : null,
              `TASKS TO SEQUENCE (${open.length})\n${open.map((t: any) => {
                const subtasks = (t.subtasks as any[]) || [];
                return [
                  `- id=${t.id}`,
                  `  title: ${t.title}`,
                  t.description ? `  description: ${String(t.description).slice(0, 400)}` : null,
                  `  status: ${t.status} | priority: ${t.priority}`,
                  t.dueDate ? `  due: ${new Date(t.dueDate).toISOString().slice(0, 10)}` : null,
                  t.estimateHours ? `  estimate: ${t.estimateHours}h` : null,
                  subtasks.length ? `  subtasks: ${subtasks.length} (${subtasks.filter((s) => s.done).length} done)` : null,
                  t.blockedByTaskId ? `  already marked blocked by: ${t.blockedByTaskId}` : null,
                ].filter(Boolean).join("\n");
              }).join("\n")}`,
            ].filter(Boolean).join("\n\n"),
          },
        ],
      });

      let parsed: any;
      try {
        const raw = completion.choices[0].message.content || "{}";
        const match = raw.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(match ? match[0] : raw);
      } catch (parseErr) {
        console.error("Task sequence parse failed:", parseErr);
        return res.status(502).json({ message: "Nova returned an unreadable order. Please try again." });
      }

      const openIds = new Set(open.map((t: any) => t.id));

      /*
       * Dependencies first, because they constrain the order. Self-links,
       * unknown ids and anything that would close a loop are dropped — a
       * cycle would make every task in it permanently blocked.
       */
      const deps = new Map<string, string>();
      const wouldCycle = (from: string, to: string): boolean => {
        let cursor: string | undefined = to;
        const seen = new Set<string>([from]);
        while (cursor) {
          if (seen.has(cursor)) return true;
          seen.add(cursor);
          cursor = deps.get(cursor);
        }
        return false;
      };

      /*
       * Blockers the builder set by hand come first — Nova doesn't get to
       * discard them. Except a circular one: a pair of tasks waiting on each
       * other can never start, so re-sequencing is exactly the moment to cut
       * the link rather than order around a deadlock. Older boards can carry
       * these from before the task editor rejected them.
       */
      const cyclesBroken: { id: string; title: string; blockerTitle: string }[] = [];
      const openById = new Map((open as any[]).map((t) => [t.id, t]));
      for (const t of [...open].sort((a: any, b: any) => a.order - b.order) as any[]) {
        if (!t.blockedByTaskId || !openIds.has(t.blockedByTaskId)) continue;
        if (t.blockedByTaskId === t.id || wouldCycle(t.id, t.blockedByTaskId)) {
          cyclesBroken.push({
            id: t.id,
            title: t.title,
            blockerTitle: openById.get(t.blockedByTaskId)?.title || "another task",
          });
          await storage.updateKanbanTask(t.id, { blockedByTaskId: null } as any);
          continue;
        }
        deps.set(t.id, t.blockedByTaskId);
      }

      const newDeps: { id: string; blockedByTaskId: string; why?: string }[] = [];
      for (const d of Array.isArray(parsed.dependencies) ? parsed.dependencies.slice(0, 40) : []) {
        const id = String(d?.id || ""), blocker = String(d?.blockedByTaskId || "");
        if (!openIds.has(id) || !openIds.has(blocker) || id === blocker) continue;
        if (deps.get(id) === blocker) continue;
        // One blocker per task — that's what the column stores.
        if (deps.has(id)) continue;
        if (wouldCycle(id, blocker)) continue;
        deps.set(id, blocker);
        newDeps.push({ id, blockedByTaskId: blocker, why: String(d?.why || "").slice(0, 200) });
      }

      // Nova's proposed order, with anything it forgot appended in its old order.
      const reasons = new Map<string, string>();
      const proposed: string[] = [];
      for (const item of Array.isArray(parsed.order) ? parsed.order : []) {
        const id = String(item?.id || "");
        if (!openIds.has(id) || proposed.includes(id)) continue;
        proposed.push(id);
        reasons.set(id, String(item?.reason || "").slice(0, 200));
      }
      for (const t of [...open].sort((a: any, b: any) => a.order - b.order) as any[]) {
        if (!proposed.includes(t.id)) proposed.push(t.id);
      }

      /*
       * Topological repair. Nova is good at this but not reliable at it, and
       * "the top task is one I can't start" is the exact complaint this
       * endpoint exists to fix — so enforce it in code rather than trusting
       * the model. Stable: a task is emitted as soon as its blocker has been.
       */
      const sequenced: string[] = [];
      const emitted = new Set<string>();
      const remaining = [...proposed];
      while (remaining.length) {
        const readyIndex = remaining.findIndex((id) => {
          const blocker = deps.get(id);
          return !blocker || emitted.has(blocker) || !remaining.includes(blocker);
        });
        // -1 means every task left is waiting on another one left, which the
        // cycle guard should prevent. Fall back to Nova's order rather than loop.
        const pick = readyIndex === -1 ? 0 : readyIndex;
        const [id] = remaining.splice(pick, 1);
        sequenced.push(id);
        emitted.add(id);
      }

      for (let i = 0; i < sequenced.length; i++) {
        const id = sequenced[i];
        const patch: any = { order: i };
        const blocker = deps.get(id);
        const current = openById.get(id);
        if (blocker && current?.blockedByTaskId !== blocker) patch.blockedByTaskId = blocker;
        await storage.updateKanbanTask(id, patch);
      }

      /*
       * Finished tasks sit after the open ones. They aren't part of the
       * sequence, but leaving their old positions in place would let a done
       * task share an order value with an open one — and the calendar orders a
       * day's entries by exactly that number.
       */
      const doneTasks = (allTasks as any[])
        .filter((t) => t.status === "done")
        .sort((a, b) => a.order - b.order);
      for (let i = 0; i < doneTasks.length; i++) {
        await storage.updateKanbanTask(doneTasks[i].id, { order: sequenced.length + i } as any);
      }

      await storage.deductCredits(userId, CREDIT_COSTS.taskSequencing);
      await storage.logActivity({
        projectId, userId, action: "let Nova re-order the task board",
        entityType: "kanban", entityId: projectId,
        metadata: { tasks: sequenced.length, dependenciesFound: newDeps.length },
      }).catch(() => {});

      const byId = openById;
      res.json({
        rationale: String(parsed.rationale || "").slice(0, 600),
        sequence: sequenced.map((id, i) => ({
          id,
          title: byId.get(id)?.title || "",
          position: i + 1,
          reason: reasons.get(id) || "",
          blockedByTaskId: deps.get(id) || null,
        })),
        dependenciesFound: newDeps.map((d) => ({
          ...d,
          title: byId.get(d.id)?.title || "",
          blockerTitle: byId.get(d.blockedByTaskId)?.title || "",
        })),
        cyclesBroken,
        startHere: sequenced[0] || null,
        creditsCharged: CREDIT_COSTS.taskSequencing,
      });
    } catch (error) {
      console.error("Task sequence error:", error);
      res.status(500).json({ message: "Nova couldn't re-order the board" });
    }
  });

  /**
   * Nova plans the work.
   *
   * The analytics panel can act on its own findings; this is the same idea
   * pointed at the board. A builder asks for something like "turn my
   * milestones into ordered task lists with estimates" and Nova returns a
   * plan — per milestone: the goal, the definition of done, and 5-10 ordered,
   * estimated tasks — plus the single milestone to work next.
   *
   * Nothing is written yet. The plan comes back with the operations that would
   * produce it, and the apply route below runs them once the builder says yes.
   * Dumping forty tasks onto someone's board unasked is not help.
   */
  app.post("/api/projects/:id/tasks/nova-assist", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;
      if (!(await isProjectMember(userId, projectId))) return res.status(403).json({ message: "Not a project member" });

      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      // Gated on the Builder plan. The client always shows the button and
      // surfaces this 402, so the capability is discoverable rather than
      // hidden from the people who'd upgrade for it.
      const ent = await requireFeature(res, userId, "aiMilestones", "Nova task planning");
      if (!ent) return;

      const { ask, taskId } = req.body as { ask?: string; taskId?: string };
      if (!ask?.trim()) return res.status(400).json({ message: "Tell Nova what you want help with." });
      if (ask.length > 2000) return res.status(400).json({ message: "That's a lot to ask at once — trim it down." });

      const focusTask = taskId ? await storage.getKanbanTask(taskId) : undefined;
      if (focusTask && focusTask.projectId !== projectId) {
        return res.status(400).json({ message: "That task isn't on this project." });
      }

      if (!(await requireCredits(res, userId, CREDIT_COSTS.taskAssist, "Nova task planning"))) return;

      const [state, roadmap, milestones] = await Promise.all([
        buildOperableProjectState(projectId),
        storage.getProjectRoadmap(projectId).catch(() => undefined),
        storage.getProjectMilestones(projectId).catch(() => []),
      ]);

      const completion = await openai.chat.completions.create({
        model: modelFor(ent),
        messages: [
          {
            role: "system",
            content: `You are Nova, planning a builder's work on their task board. ${coachingDirectiveFor(ent)}

You are not writing advice. You are producing the working plan they will execute from, and the operations that put it on their board.

How to plan:
- Between 5 and 10 tasks per milestone. More than that isn't a plan, it's a backlog, and it stalls people.
- Every task gets a whole-hour estimate (minimum 1) that a real person could hit in one or two sittings. If something is bigger than about 8 hours, split it. Never use fractions.
- Order matters. Emit create_task operations in the order the work should be done — that's what sets each task's position on the board.
- You can only set "blockedByTaskId" on a task that already exists, since a task you're creating in this same plan has no id yet. Don't invent one. If the plan needs dependencies between new tasks, say so in "summary" and tell them to run "Order my tasks" once the plan is applied — that pass reads the real ids and links them.
- Attach every task to the milestone it serves with "milestoneId".
- Write a real definition of done for each milestone — the observable thing that proves it's finished — and save it with update_milestone so it lives on the milestone rather than only in this reply.
- Name exactly ONE milestone to work on next, and say why that one.
- Respect what's already there. Don't recreate a task that exists; update it instead.
- If a CODEBASE AUDIT appears in the context, plan from it. Don't create work for something the audit says is already built, do create work for what it found missing, and move tasks the audit says are finished to done. Its risks — committed credentials, no tests, no CI — are real work and belong on the board.

Set "suggestedDocument" ONLY when a written document IS the deliverable — when the task cannot be called done without that document existing. A spec, a one-pager, a brief, a business plan, a pitch, a policy: yes. SparkTower has a document builder that lays out and writes documents, so pointing them at it beats leaving them to start from a blank page.

Leave it null in every other case, including when a document would merely be *nice to have alongside* the work. If the output is code, a deployment, a configuration, a conversation, a decision, or an experiment, the answer is null — even if you think they should also write a runbook or notes about it. Suggesting a document for work that isn't document work is noise, and it teaches them to ignore the suggestion.

${OPERATION_SCHEMA_INSTRUCTIONS}

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "summary": "2-4 sentences: what this plan does and how to run it.",
  "nextMilestone": { "id": "milestone id or null", "title": "", "why": "one or two sentences" },
  "milestones": [
    {
      "id": "milestone id, or null if you are proposing a new one",
      "title": "",
      "goal": "one sentence",
      "definitionOfDone": "the observable thing that proves it is finished",
      "tasks": [ { "title": "", "estimateHours": 3, "why": "short" } ]
    }
  ],
  "totalEstimatedHours": 0,
  "suggestedDocument": { "title": "", "description": "what the document has to contain, in enough detail to write from", "why": "one sentence" } | null,
  "operations": [ ... ]
}
If the ask has nothing to do with planning tasks, say so in "summary", return an empty "operations" list, and don't invent work.`,
          },
          {
            role: "user",
            content: [
              `WHAT THE BUILDER ASKED FOR\n${ask.trim()}`,
              focusTask
                ? `THEY HAVE THIS TASK SELECTED — the ask is probably about it\nid=${focusTask.id}\ntitle: ${focusTask.title}\ndescription: ${focusTask.description || "(none)"}\nstatus: ${focusTask.status} | priority: ${focusTask.priority}${focusTask.estimateHours ? ` | estimate: ${focusTask.estimateHours}h` : ""}`
                : null,
              roadmap
                ? `ROADMAP\nGoal: ${roadmap.goal}\n${roadmap.summary || ""}\nPhases:\n${roadmap.phases.map((p) => `- ${p.title} [${p.status}] ${p.description || ""}\n    outcomes: ${((p.outcomes as string[]) || []).join("; ") || "none"}`).join("\n")}`
                : "ROADMAP\nNone yet.",
              `MILESTONE COUNT: ${milestones.length}`,
              `CURRENT PROJECT STATE (use these ids)\n${state}`,
            ].filter(Boolean).join("\n\n"),
          },
        ],
      });

      let parsed: any;
      try {
        const raw = completion.choices[0].message.content || "{}";
        const match = raw.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(match ? match[0] : raw);
      } catch (parseErr) {
        console.error("Task assist parse failed:", parseErr);
        return res.status(502).json({ message: "Nova returned an unreadable plan. Please try again." });
      }

      await storage.deductCredits(userId, CREDIT_COSTS.taskAssist);

      const operations = Array.isArray(parsed.operations) ? parsed.operations.slice(0, 80) : [];
      res.json({
        summary: String(parsed.summary || "").slice(0, 1200),
        nextMilestone: parsed.nextMilestone && typeof parsed.nextMilestone === "object" ? {
          id: parsed.nextMilestone.id || null,
          title: String(parsed.nextMilestone.title || "").slice(0, 200),
          why: String(parsed.nextMilestone.why || "").slice(0, 600),
        } : null,
        milestones: (Array.isArray(parsed.milestones) ? parsed.milestones : []).slice(0, 20).map((m: any) => ({
          id: m?.id || null,
          title: String(m?.title || "").slice(0, 200),
          goal: String(m?.goal || "").slice(0, 500),
          definitionOfDone: String(m?.definitionOfDone || "").slice(0, 600),
          tasks: (Array.isArray(m?.tasks) ? m.tasks : []).slice(0, 12).map((t: any) => ({
            title: String(t?.title || "").slice(0, 200),
            // Rounded here as well as on write, so the preview shows the same
            // number that ends up on the card — estimates are whole hours.
            estimateHours: Number.isFinite(Number(t?.estimateHours))
              ? Math.max(1, Math.round(Number(t.estimateHours)))
              : null,
            why: String(t?.why || "").slice(0, 300),
          })),
        })),
        totalEstimatedHours: Number.isFinite(Number(parsed.totalEstimatedHours)) ? Number(parsed.totalEstimatedHours) : null,
        // Offered, never acted on automatically — starting a document costs
        // credits, so it stays the builder's call.
        suggestedDocument: parsed.suggestedDocument && String(parsed.suggestedDocument.title || "").trim()
          ? {
              title: String(parsed.suggestedDocument.title).slice(0, 200),
              description: String(parsed.suggestedDocument.description || "").slice(0, 3000),
              why: String(parsed.suggestedDocument.why || "").slice(0, 400),
            }
          : null,
        operations,
        creditsCharged: CREDIT_COSTS.taskAssist,
      });
    } catch (error) {
      console.error("Task assist error:", error);
      res.status(500).json({ message: "Nova couldn't plan that" });
    }
  });

  /**
   * Applies a plan the builder reviewed. No second AI call, so no second
   * charge — the operations were already paid for when the plan was made.
   */
  app.post("/api/projects/:id/tasks/nova-assist/apply", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;
      if (!(await isProjectMember(userId, projectId))) return res.status(403).json({ message: "Not a project member" });

      const ent = await requireFeature(res, userId, "aiMilestones", "Nova task planning");
      if (!ent) return;

      const { operations } = req.body as { operations?: unknown };
      if (!Array.isArray(operations) || !operations.length) {
        return res.status(400).json({ message: "There's no plan to apply." });
      }

      const { changes, skipped } = await applyProjectOperations(projectId, userId, operations, {
        canEditMilestones: ent.aiMilestones,
        canEditRoadmap: ent.roadmapUpdates,
        // A milestone-by-milestone plan is legitimately dozens of operations.
        maxOperations: 120,
      });
      if (!changes.length) {
        return res.status(422).json({ message: "None of that plan could be applied.", skipped });
      }
      res.json({ changes, skipped });
    } catch (error) {
      console.error("Task assist apply error:", error);
      res.status(500).json({ message: "Couldn't apply that plan" });
    }
  });

  /**
   * Persists a drag-and-drop reorder in one call.
   *
   * Order only. A card dropped into a different column changes status too, and
   * that goes through PATCH so the completion stamping, feed post and
   * execution archive all stay in one place rather than being duplicated here.
   */
  app.post("/api/projects/:id/kanban/reorder", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;
      if (!(await isProjectMember(userId, projectId))) return res.status(403).json({ message: "Not a project member" });

      const { items } = req.body as { items?: { id: string; order: number }[] };
      if (!Array.isArray(items) || !items.length) {
        return res.status(400).json({ message: "Nothing to reorder" });
      }
      if (items.length > 400) return res.status(400).json({ message: "Too many tasks in one reorder" });

      // Every id has to be a task on this project, or a reorder becomes a way
      // to write to someone else's board.
      const own = await storage.getProjectKanbanTasks(projectId);
      const ownIds = new Set(own.map((t: any) => t.id));
      const valid = items.filter((i) => i && ownIds.has(i.id) && Number.isFinite(Number(i.order)));
      if (!valid.length) return res.status(400).json({ message: "None of those tasks are on this project" });

      await Promise.all(
        valid.map((i) => storage.updateKanbanTask(i.id, { order: Number(i.order) } as any)),
      );
      res.json({ updated: valid.length });
    } catch (error) {
      console.error("Kanban reorder error:", error);
      res.status(500).json({ message: "Failed to save the new order" });
    }
  });

  app.patch("/api/kanban/:taskId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const existingTask = await storage.getKanbanTask(req.params.taskId);
      if (!existingTask) return res.status(404).json({ message: "Task not found" });
      if (!(await isProjectMember(userId, existingTask.projectId))) return res.status(403).json({ message: "Not a project member" });
      const updates: any = {};
      const {
        title, description, status, assigneeId, priority, dueDate, order,
        tags, estimateHours, blockedByTaskId, subtasks, milestoneId,
      } = req.body;
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (status !== undefined) updates.status = status;
      if (assigneeId !== undefined) updates.assigneeId = assigneeId;
      if (priority !== undefined) updates.priority = priority;
      if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;
      if (order !== undefined) updates.order = order;
      // Previously dropped, so tags, estimates, blockers and subtasks edited in
      // the task dialog never saved.
      if (tags !== undefined) updates.tags = Array.isArray(tags) ? tags.slice(0, 12).map(String) : [];
      if (estimateHours !== undefined) updates.estimateHours = Number.isFinite(estimateHours) ? estimateHours : null;
      if (blockedByTaskId !== undefined) {
        /*
         * A task that blocks itself, directly or through a chain, can never be
         * started — and neither can anything behind it. Refuse the link rather
         * than storing a deadlock the board can only display, not resolve.
         */
        if (!blockedByTaskId) {
          updates.blockedByTaskId = null;
        } else if (blockedByTaskId === req.params.taskId) {
          return res.status(400).json({ message: "A task can't be blocked by itself." });
        } else {
          const siblings = await storage.getProjectKanbanTasks(existingTask.projectId);
          const blocker = siblings.find((t: any) => t.id === blockedByTaskId);
          if (!blocker) {
            return res.status(400).json({ message: "That blocker isn't a task on this project." });
          }
          const chain = new Map(
            siblings.map((t: any) => [t.id, t.id === req.params.taskId ? blockedByTaskId : t.blockedByTaskId]),
          );
          let cursor: string | null | undefined = blockedByTaskId;
          const seen = new Set<string>([req.params.taskId]);
          while (cursor) {
            if (seen.has(cursor)) {
              return res.status(400).json({
                message: "That would make two tasks wait on each other, so neither could ever start.",
              });
            }
            seen.add(cursor);
            cursor = chain.get(cursor) ?? null;
          }
          updates.blockedByTaskId = blockedByTaskId;
        }
      }
      if (subtasks !== undefined) updates.subtasks = Array.isArray(subtasks) ? subtasks : [];
      if (milestoneId !== undefined) {
        if (!milestoneId) {
          updates.milestoneId = null;
        } else {
          // A milestone from another project would render as a broken link.
          const own = await storage.getProjectMilestones(existingTask.projectId).catch(() => []);
          if (!own.some((m) => m.id === milestoneId)) {
            return res.status(400).json({ message: "That milestone isn't on this project." });
          }
          updates.milestoneId = milestoneId;
        }
      }

      /*
       * Stamp the timeline server-side so the calendar and the reputation
       * maths can't disagree, and so attribution records who actually moved
       * the card rather than who it's assigned to.
       */
      const now = new Date();
      const movingToDone = status === "done" && existingTask.status !== "done";
      const firstCompletion = movingToDone && !existingTask.completedAt;

      if (status !== undefined && status !== existingTask.status) {
        if ((status === "in-progress" || status === "done") && !existingTask.startedAt) {
          updates.startedAt = now;
          updates.startedById = userId;
        }
        if (movingToDone) {
          updates.completedAt = now;
          updates.completedById = userId;
        }
        // Reopening keeps the previous completedAt as a record of the last
        // completion — that's what stops a done/undone loop double-counting.
      }

      const task = await storage.updateKanbanTask(req.params.taskId, updates);

      if (movingToDone) {
        // A task on the path is a pace signal; the projection moves on it.
        await onPathTaskDone(task).catch((e) => console.error("[phase-trees] pace refresh failed:", e));
        /*
         * Finishing a task unblocks whatever was waiting on it.
         *
         * The blocker column was only ever cleared by hand, so a task whose
         * prerequisite was finished still showed "Blocked by <done task>" —
         * and the board went on treating it as unstartable. A completed
         * prerequisite has served its purpose, so the link goes.
         */
        const siblings = await storage.getProjectKanbanTasks(existingTask.projectId).catch(() => []);
        const waiting = (siblings as any[]).filter((t) => t.blockedByTaskId === task.id && t.id !== task.id);
        for (const t of waiting) {
          await storage.updateKanbanTask(t.id, { blockedByTaskId: null } as any).catch((e) => {
            console.error("Failed to clear blocker on task", t.id, e);
          });
        }
      }

      if (firstCompletion) {
        const onTime = isTaskOnTime(task);
        await storage.incrementUserTaskCompletion(userId, onTime).catch((e) => {
          console.error("Failed to bank task completion:", e);
        });
        // Archive it against the project too. The user-level counter drives
        // reputation; this is what lets the project itself still show its
        // execution record after the board has been cleared.
        await storage.recordTaskCompletion({
          projectId: task.projectId,
          taskId: task.id,
          completedById: userId,
          title: task.title,
          priority: task.priority,
          onTime,
          completedAt: task.completedAt ?? now,
        }).catch((e) => {
          console.error("Failed to archive task completion:", e);
        });
      }
      res.json(task);
    } catch (error) {
      console.error("Update kanban task error:", error);
      res.status(500).json({ message: "Failed to update task" });
    }
  });

  /**
   * What this project has actually shipped, including work cleared off the
   * board. Two numbers, because they answer different questions: the archive
   * is this project's record, the banked figure is the builder's across every
   * project (and covers completions that predate the archive).
   */
  app.get("/api/projects/:id/task-history", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;
      if (!(await isProjectMember(userId, projectId))) return res.status(403).json({ message: "Unauthorized" });

      const [completions, banked] = await Promise.all([
        storage.getProjectTaskCompletions(projectId, 50),
        storage.getUserTaskStats(userId),
      ]);

      res.json({
        projectCompleted: completions.length,
        projectOnTime: completions.filter((c) => c.onTime).length,
        lastCompletedAt: completions[0]?.completedAt ?? null,
        builderCompletedAllTime: banked?.tasksCompleted ?? 0,
        recent: completions.slice(0, 25),
      });
    } catch (error) {
      console.error("Task history error:", error);
      res.status(500).json({ message: "Failed to load task history" });
    }
  });

  app.delete("/api/kanban/:taskId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const existingTask = await storage.getKanbanTask(req.params.taskId);
      if (!existingTask) return res.status(404).json({ message: "Task not found" });
      if (!(await isProjectMember(userId, existingTask.projectId))) return res.status(403).json({ message: "Not a project member" });
      // Bank execution credit before the evidence disappears. Reading the
      // project's stats backfills the archive, which covers cards that were
      // finished before completions started being archived at source.
      await storage.getProjectCompletionStats(existingTask.projectId).catch(() => {});
      await storage.bankExecutionCredit(userId).catch(() => {});
      if (existingTask.completedById && existingTask.completedById !== userId) {
        await storage.bankExecutionCredit(existingTask.completedById).catch(() => {});
      }
      await storage.deleteKanbanTask(req.params.taskId);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete kanban task error:", error);
      res.status(500).json({ message: "Failed to delete task" });
    }
  });

  /**
   * Clear the board in one go.
   *
   * `?status=done` clears only finished work, which is the common case — tidy
   * up without losing what's still outstanding. Every member who completed
   * anything has their execution credit banked first, so nobody's reputation
   * drops because someone else tidied the board.
   */
  app.delete("/api/projects/:id/kanban", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      // Clearing the whole board is destructive, so restrict it to the owner.
      if (project.ownerId !== userId) {
        return res.status(403).json({ message: "Only the project owner can clear the board" });
      }

      const onlyStatus = typeof req.query.status === "string" ? req.query.status : undefined;
      if (onlyStatus && !["todo", "in-progress", "review", "done"].includes(onlyStatus)) {
        return res.status(400).json({ message: "Unknown status filter" });
      }

      // Archive first: once the rows go, the project's execution record is
      // whatever we saved here.
      await storage.getProjectCompletionStats(projectId).catch(() => {});

      const tasks = await storage.getProjectKanbanTasks(projectId);
      const affected = new Set<string>([userId, project.ownerId]);
      for (const t of tasks as any[]) {
        if (t.completedById) affected.add(t.completedById);
        if (t.assigneeId) affected.add(t.assigneeId);
      }
      for (const id of affected) {
        await storage.bankExecutionCredit(id).catch(() => {});
      }

      const removed = await storage.clearProjectKanbanTasks(projectId, onlyStatus);
      await storage.logActivity({
        projectId, userId,
        action: onlyStatus ? `cleared ${removed} ${onlyStatus} tasks` : `cleared all ${removed} tasks`,
        entityType: "kanban", entityId: projectId, metadata: { removed, onlyStatus: onlyStatus || null },
      }).catch(() => {});

      res.json({ removed });
    } catch (error) {
      console.error("Clear kanban error:", error);
      res.status(500).json({ message: "Failed to clear tasks" });
    }
  });

  /**
   * Day-by-day activity for the project calendar.
   *
   * Returns one entry per event (project created, task created, task started,
   * task completed) with the member who did it already resolved, so the client
   * doesn't have to join members to tasks itself.
   */
  app.get("/api/projects/:id/calendar", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;
      if (!(await isProjectMember(userId, projectId))) return res.status(403).json({ message: "Not a project member" });

      const [project, tasks, members, milestones] = await Promise.all([
        storage.getProject(projectId),
        storage.getProjectKanbanTasks(projectId),
        storage.getProjectMembers(projectId).catch(() => []),
        storage.getProjectMilestones(projectId).catch(() => []),
      ]);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const who = (id: string | null | undefined) => {
        if (!id) return null;
        const m = members.find((x) => x.userId === id);
        return {
          userId: id,
          name: m?.profile?.displayName || m?.user?.firstName || m?.user?.email || "Someone",
          avatarUrl: m?.profile?.avatarUrl || null,
        };
      };
      const dayKey = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

      const events: any[] = [];

      events.push({
        id: `project-${project.id}`,
        date: dayKey(project.createdAt),
        type: "project_created",
        title: `${project.title} was created`,
        priority: null, taskId: null, actor: who(project.ownerId),
      });

      for (const m of milestones) {
        if (m.targetDate) {
          events.push({
            id: `milestone-due-${m.id}`, date: dayKey(m.targetDate),
            type: m.status === "completed" ? "milestone_completed" : "milestone_due",
            title: m.title, priority: null, taskId: null, actor: null,
          });
        }
      }

      for (const t of tasks as any[]) {
        // `taskOrder` is the board's own sequence — the one Nova sets when it
        // re-orders the tasks. Carrying it here is what lets a day's entries
        // read in the same order as the board instead of an arbitrary one.
        const common = { priority: t.priority, taskId: t.id, taskOrder: t.order, taskStatus: t.status };
        events.push({
          id: `created-${t.id}`, date: dayKey(t.createdAt), type: "task_created",
          title: t.title, ...common, actor: who(t.assigneeId),
        });
        if (t.startedAt) {
          events.push({
            id: `started-${t.id}`, date: dayKey(t.startedAt), type: "task_started",
            title: t.title, ...common, actor: who(t.startedById || t.assigneeId),
          });
        }
        if (t.status === "done" && t.completedAt) {
          events.push({
            id: `completed-${t.id}`, date: dayKey(t.completedAt), type: "task_completed",
            title: t.title, ...common, actor: who(t.completedById || t.assigneeId),
          });
        }
        if (t.dueDate && t.status !== "done") {
          events.push({
            id: `due-${t.id}`, date: dayKey(t.dueDate), type: "task_due",
            title: t.title, ...common, actor: who(t.assigneeId),
          });
        }
      }

      /*
       * Within a day: project/milestone context first, then tasks in board
       * order, then each task's own events in the order they happened. Sorting
       * by anything else made a day's list disagree with the board the user
       * had just had Nova sequence.
       */
      const TYPE_RANK: Record<string, number> = {
        project_created: 0, milestone_completed: 1, milestone_due: 2,
        task_created: 3, task_started: 4, task_completed: 5, task_due: 6,
      };
      events.sort((a, b) =>
        a.date.localeCompare(b.date)
        || (a.taskId ? 1 : 0) - (b.taskId ? 1 : 0)
        || (a.taskOrder ?? -1) - (b.taskOrder ?? -1)
        || (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9)
        || String(a.title).localeCompare(String(b.title)));
      res.json({ projectCreatedAt: project.createdAt, events });
    } catch (error) {
      console.error("Project calendar error:", error);
      res.status(500).json({ message: "Failed to load the calendar" });
    }
  });

  app.post("/api/projects/:id/kanban/ai-generate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      await storage.resetCreditsIfNeeded(userId);

      // Free has no AI task generation; Starter gets a capped batch.
      const ent = await requireLevel(
        res, userId, "aiTaskGeneration", ["limited", "full"],
        "AI task generation", "starter"
      );
      if (!ent) return;
      if (!(await requireCredits(res, userId, CREDIT_COSTS.taskGeneration, "task generation"))) return;

      const maxTasks = taskLimitFor(ent);
      const projectId = req.params.id;
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      /*
       * Task generation used to see only the title, description, category,
       * tech stack and team — no roadmap, no milestones, and no existing
       * tasks. So it always produced a generic "planning → development →
       * testing → launch" lifecycle from scratch, duplicated work already on
       * the board, and ignored the plan Nova itself had just written. Give it
       * the same picture the roadmap gets.
       */
      const [members, roadmap, milestones, existingTasks] = await Promise.all([
        storage.getProjectMembers(projectId),
        storage.getProjectRoadmap(projectId).catch(() => undefined),
        storage.getProjectMilestones(projectId).catch(() => []),
        storage.getProjectKanbanTasks(projectId).catch(() => []),
      ]);

      const doneTasks = existingTasks.filter((t: any) => t.status === "done");
      const openTasks = existingTasks.filter((t: any) => t.status !== "done");

      // The phase to aim at: first unfinished one, else the last.
      const activePhase = roadmap?.phases.find((p) => p.status === "in-progress")
        || roadmap?.phases.find((p) => p.status === "upcoming")
        || roadmap?.phases[roadmap.phases.length - 1];

      // `outcomes` is a jsonb column, so it arrives untyped.
      const phaseOutcomes = (p: { outcomes?: unknown }): string[] =>
        Array.isArray(p.outcomes) ? p.outcomes.map(String) : [];

      const userContent = [
        `PROJECT BRIEF\n${formatProjectBriefForPrompt(project)}`,
        `TEAM\nTeam size: ${project.teamSize}${project.soloMode ? " (solo builder — no teammates to delegate to)" : ""}\nTimeline: ${project.estimatedWeeks} weeks\nMembers: ${members.map((m) => `${m.profile?.displayName || m.user.firstName || "Member"} (${m.role})`).join(", ") || "just the owner"}`,
        describeCurrentState({
          project,
          startingPoint: roadmap?.startingPoint,
          members: members.length,
          tasks: existingTasks,
          milestones,
          phases: roadmap?.phases,
        }),
        roadmap
          ? `THE ROADMAP NOVA ALREADY BUILT (v${roadmap.version})\nGoal: ${roadmap.goal}\n${roadmap.summary || ""}\n\nPhases:\n${roadmap.phases.map((p) => `- ${p.title} [${p.status}]${p.estimatedDuration ? ` (${p.estimatedDuration})` : ""}\n    ${p.description || ""}\n    Outcomes: ${phaseOutcomes(p).join("; ") || "none listed"}`).join("\n")}`
          : "THE ROADMAP\nNo roadmap has been built yet. Break the work down toward the goal in the brief.",
        activePhase
          ? `THE PHASE TO WORK ON NOW\n"${activePhase.title}" — ${activePhase.description || ""}\nOutcomes that phase needs: ${phaseOutcomes(activePhase).join("; ") || "none listed"}`
          : "",
        `MILESTONES\n${milestones.length ? milestones.map((m) => `- ${m.title} [${m.status}]${m.targetDate ? ` due ${new Date(m.targetDate).toISOString().slice(0, 10)}` : ""}`).join("\n") : "none set"}`,
        `TASKS ALREADY FINISHED (${doneTasks.length}) — this work is DONE, never suggest it again\n${doneTasks.map((t: any) => `- ${t.title}`).join("\n") || "none yet"}`,
        `TASKS ALREADY ON THE BOARD, NOT FINISHED (${openTasks.length}) — do NOT duplicate these\n${openTasks.map((t: any) => `- ${t.title} [${t.status}/${t.priority}]`).join("\n") || "none"}`,
      ].filter(Boolean).join("\n\n");

      const systemContent = `You are Nova, breaking a builder's next stretch of work into board-ready tasks. ${coachingDirectiveFor(ent)}

Your job is NOT to plan the whole project from scratch. A roadmap already exists and some work is already done. Generate the tasks that move the builder through THE PHASE TO WORK ON NOW, and nothing else.

Rules:
- Read WHERE THEY ARE NOW and the finished tasks first. Never generate work that is already done or already on the board, and never re-plan groundwork that clearly exists.
- Every task must serve an outcome of the current phase. If a task doesn't move that phase forward, leave it out.
- Tasks must be small enough to finish in a sitting or two, and specific enough to start without asking a follow-up question. "Add a weekly reminder email for people who posted last week" — not "improve retention".
- Order them the way they should actually be done, dependencies first.
- If the team is a solo builder, don't invent tasks that need a team.

Respond with ONLY a valid JSON object (no markdown, no code fences):
{
  "tasks": [
    {
      "title": "Short imperative task name",
      "description": "What to do and what 'done' means for this task.",
      "priority": "low" | "medium" | "high",
      "suggested_role": "who should pick this up",
      "phase": "the roadmap phase title this belongs to, or null"
    }
  ]
}
At most ${maxTasks} tasks, most important first.

${PLAIN_LANGUAGE_RULES}`;

      const raw = await askInPlainLanguage(modelFor(ent), systemContent, userContent);

      await storage.deductCredits(userId, CREDIT_COSTS.taskGeneration);

      const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const content = JSON.parse(cleaned);
      // Enforce the tier cap here too — the model can overshoot its instruction.
      const proposed = (content.tasks || content || []).slice(0, maxTasks);

      // Belt and braces: drop anything matching a title already on the board,
      // in case the model ignored the instruction.
      const seen = new Set(existingTasks.map((t: any) => t.title.trim().toLowerCase()));
      const startOrder = existingTasks.length;
      const created = [];
      for (const t of proposed) {
        const title = String(t?.title || "").trim();
        if (!title || seen.has(title.toLowerCase())) continue;
        seen.add(title.toLowerCase());
        const task = await storage.createKanbanTask({
          projectId,
          title: title.slice(0, 200),
          description: t.description || "",
          status: "todo",
          priority: ["low", "medium", "high"].includes(t.priority) ? t.priority : "medium",
          assigneeId: null,
          dueDate: null,
          // Keep the roadmap link visible on the card; there's no phase FK.
          tags: t.phase ? [String(t.phase).slice(0, 100)] : [],
          order: startOrder + created.length,
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
    
    const validated = normalizeSoloMode(insertProjectBase.partial().parse(req.body));
    /*
     * The pair is checked against what the row will be, not against the
     * patch alone: a patch that changes only the goal would otherwise leave
     * "restaurant" attached to a project that is now shipping an MVP.
     */
    const nextGoal = validated.goal ?? project.goal;
    const nextSub = validated.subcategory ?? project.subcategory;
    if (!isValidSubcategory(nextGoal, nextSub)) {
      return res.status(400).json({
        message: `"${nextSub}" is not a kind of "${nextGoal}" project — pick a subcategory for the new goal.`,
        code: "subcategory_mismatch",
      });
    }

    // Flipping a public project to private consumes private-project quota.
    if (validated.isPrivate === true && !project.isPrivate) {
      const quota = await checkPrivateProjectQuota((req.user as any).id);
      if (!quota.allowed) return res.status(402).json(quota.body);
    }

    const { goal: _g, subcategory: _s, ...rest } = validated;
    let updated = Object.keys(rest).length ? await storage.updateProject(req.params.id, rest) : project;
    if (nextGoal !== project.goal || nextSub !== project.subcategory) {
      // The path is the product of goal + type; changing either is a switch,
      // which archives the old tree, builds the new one and carries shared
      // work across. A silent column edit would leave the old path in place.
      await switchPath(req.params.id, nextGoal, nextSub);
      updated = (await storage.getProject(req.params.id)) ?? updated;
      void recordActivity({
        name: "path.switched", userId: (req.user as any).id, visitorId: req.visitorId ?? "unknown", sessionId: req.sessionId ?? "unknown",
        path: req.originalUrl, projectId: req.params.id, props: { from: project.goal, to: nextGoal, fromSubcategory: project.subcategory, toSubcategory: nextSub },
      });
    }
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

      const ent = await requireCredits(res, userId, CREDIT_COSTS.novaGuide, "Nova coaching");
      if (!ent) return;

      const { message, currentTab } = req.body;
      if (!message || typeof message !== "string") return res.status(400).json({ message: "Message is required" });
      if (message.length > 5000) return res.status(400).json({ message: "Message too long (max 5000 chars)" });

      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const members = await storage.getProjectMembers(projectId);
      const sub = await storage.getUserSubscription(userId);
      // Roadmap/milestone actions are Builder+; coaching depth and how much
      // history Nova sees both scale with the tier.
      const canCreateMilestones = ent.aiMilestones;
      const isPremium = ent.tier !== "free";

      await storage.addNovaGuideMessage({ projectId, role: "user", content: message, actionsTaken: [] });

      const history = await storage.getNovaGuideMessages(projectId);

      const projectContext = `
PROJECT CONTEXT:
- Title: ${project.title}
- Description: ${project.description || "Not set"}
- Category: ${project.category}
- Status: ${project.status}
- One-Liner: ${(project as any).oneLiner || "Not set"}
- Mission: ${(project as any).mission || "Not set"}
- Value Proposition: ${(project as any).valueProposition || "Not set"}
- Target Customer: ${(project as any).targetCustomerProfile || "Not set"}
- Problem Statement: ${project.problemStatement || "Not set"}
- Target User: ${project.targetUser || "Not set"}
- Success Metrics: ${project.successMetrics || "Not set"}
- Team Size: ${project.teamSize}
- Timeline: ${project.estimatedWeeks} weeks
- Tech Stack: ${(project.techStack || []).join(", ") || "Not set"}
- Roles Needed: ${(project.rolesNeeded || []).join(", ") || "Not set"}
- Scope MVP: ${((project.scope as any)?.mvp || []).join(", ") || "Not set"}
- Scope Nice-to-Have: ${((project.scope as any)?.niceToHave || []).join(", ") || "Not set"}
- Solo Builder Mode: ${(project as any).soloMode ? "Yes — this is a solo project. Never suggest recruiting, roles, or teammates." : "No"}
- Team Members: ${members.length}
- Onboarding Complete: ${(project as any).novaOnboardingComplete ? "Yes" : "No"}
- User Tier: ${ent.tier} (${isPremium ? "Premium" : "Free"})
- Current Tab: ${currentTab || "setup"}

WHAT'S IN THE PROJECT RIGHT NOW — these are the real ids; you must use them
verbatim when editing an existing task, milestone or roadmap phase, and you
must never invent one. This also includes the latest codebase audit, if one has
been run:
${await buildOperableProjectState(projectId)}`;

      const systemPrompt = `You are Nova, SparkTower's AI project partner: warm, direct, knowledgeable. You always refer to yourself as "Nova". No emojis, no "Nova here" openers — just answer.

YOUR ROLE: You are the user's dedicated project advisor. You guide them through building their project from the ground up — from defining their vision to launching their product.

COACHING DEPTH: ${coachingDirectiveFor(ent)}

${projectContext}

USING THE CODEBASE AUDIT:
- An audit is the only evidence in this project of what has actually been built. The tasks and milestones are what the builder *intends*; the audit is what the code *shows*.
- When they ask "where am I", "what's left", or "what should I do next", answer from the audit if there is one — and name it as the source.
- Where the audit and the board disagree, the audit wins. Point out the specific disagreement and offer to correct the board with edit_project rather than silently doing it.
- If the audit lists possible committed credentials, raise that first, every time, however the conversation started. It outranks everything else on the list.
- If no audit has been run and they ask about real progress, say plainly that nothing has verified the board and point them at the Codebase tab.
- Never claim something is built because a task says done. Say "your board says done; the audit hasn't verified it" instead.

CONVERSATION GUIDELINES:
- Be warm and direct. Concise beats thorough: say what matters, then stop.
- ACT ON CLEAR INSTRUCTIONS. When the builder tells you to change, remove or rewrite something, do it in this message with the action — do not ask whether they are sure, do not ask what to replace it with, do not offer a menu of alternatives. "Remove X" means remove X and put nothing in its place.
- Ask a question only when the instruction is genuinely ambiguous and you cannot make a reasonable call yourself — at most ONE, and only after doing everything that doesn't depend on the answer. Never end a message with "reply A, B or C".
- NEVER re-ask something the builder has already answered or stated in this conversation. If they said it once, it is settled. If they have said it twice, apologise in one clause and act.
- When the builder tells you something about their project that changes what you should believe — what's being removed, what the real loops are, what the wedge is — save it with the remember action so every future conversation and every Nova read starts from it. Then act on it.
- Remember context from earlier in the conversation
- If information is already filled in (not "Not set"), acknowledge it and build on it
- Adapt to the user's current tab context and help with relevant tasks

READABILITY (this is a narrow chat panel):
- Short paragraphs of one to three sentences. Under 150 words unless they asked for detail.
- Bullets only for real lists, never nested. No headings, no horizontal rules, no tables.
- One thing per message. If several changes are needed, do them and summarise in two lines; don't narrate each step.
- Say what you did in plain words ("Rewrote three tasks so none mentions weekly check-ins"), not what you are "going to" do.

GUIDED ONBOARDING FLOW (for new projects):
1. Welcome them warmly, acknowledge their project "${project.title}"
2. Help define their ONE-LINER positioning (who they help, what they do, how)
3. Help articulate their MISSION (why this exists, what it's working toward)
4. Help articulate their VALUE PROPOSITION and TARGET CUSTOMER
5. Work through their PROBLEM STATEMENT and SUCCESS METRICS
6. Help define their SCOPE (MVP features vs nice-to-have)
7. Create initial TASKS to get started
8. ${isPremium ? "Create MILESTONES/ROADMAP for their journey" : "Suggest upgrading to premium for AI-powered roadmap creation"}
9. Ask what they want to FOCUS ON FIRST

CONTEXT-AWARE ASSISTANCE (based on current tab):
- Setup tab: Help with brief, positioning, scope, links. The editable fields
  here are One-Liner, Mission, Value Proposition, Target Customer Profile,
  Problem Statement, Target User, and Success Metrics (all via update_project),
  plus the Scope box's MVP / Nice-to-Have lists (via update_scope). When the
  user asks you to "fill in" or "write" any of these, use the action to persist
  it — don't just print the text in chat and leave the field empty.
- Kanban tab: Help create/prioritize tasks, suggest what to work on next, and
  reword or re-prioritise existing ones via edit_project
- Milestones tab: ${isPremium ? "Help create milestones and roadmap, and edit existing milestones and roadmap phases in place via edit_project when the user wants one reworded, re-dated or re-scoped" : "Explain milestones, suggest upgrading for AI roadmap creation"}
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
   <nova_action>{"type": "update_project", "data": {"oneLiner": "...", "mission": "...", "valueProposition": "...", "targetCustomerProfile": "...", "problemStatement": "...", "targetUser": "...", "successMetrics": "..."}}</nova_action>
   Only include fields you're updating. Valid fields: oneLiner, mission, valueProposition, targetCustomerProfile, problemStatement, targetUser, successMetrics
   - mission: why the project exists and what it's working toward, in 1-2 sentences.
   - targetUser: a short phrase naming who this is for (e.g. "Solo indie founders shipping their first SaaS"), NOT a paragraph.
   - successMetrics: concrete, measurable outcomes. Prefer a few short lines over prose.
   These write straight into the Project Brief on the Setup tab, so once the user
   agrees on a value, SAVE IT with this action instead of only saying it in chat.

2. update_scope: Fill in the Scope box on the Setup tab (MVP vs nice-to-have)
   <nova_action>{"type": "update_scope", "data": {"mvp": ["feature1", "feature2"], "niceToHave": ["feature3"]}}</nova_action>
   Each entry is a SHORT feature name (2-6 words), not a sentence — they render as badges.
   Send the COMPLETE list for any bucket you include: a bucket you send replaces
   that bucket entirely. Omit a bucket to leave it untouched. To add one MVP item
   to an existing list, resend the existing items plus the new one.

3. create_tasks: Create kanban tasks
   <nova_action>{"type": "create_tasks", "data": {"tasks": [{"title": "...", "description": "...", "priority": "high|medium|low"}]}}</nova_action>

4. create_milestones: Create project milestones (${canCreateMilestones ? "AVAILABLE" : "NOT AVAILABLE on this plan. Mention that the Builder plan unlocks AI roadmaps and milestones."})
   <nova_action>{"type": "create_milestones", "data": {"milestones": [{"title": "...", "description": "...", "targetDate": "YYYY-MM-DD"}]}}</nova_action>

5. complete_onboarding: Mark onboarding as complete
   <nova_action>{"type": "complete_onboarding", "data": {}}</nova_action>

7. remember: Save something the builder told you that should hold from now on — a correction to the brief, something being removed, what the loops or the wedge really are. It goes to the top of every future Nova prompt and outranks the brief and the board. Send the FULL updated note (it replaces the previous one); keep it under 1500 characters, one line per fact.
   <nova_action>{"type": "remember", "data": {"notes": "Check-ins are being removed; they are not a loop or the wedge. The loops are the three paths: Ship an MVP, Systemize a business, Raise funding."}}</nova_action>

6. edit_project: Change things that already exist — reword a milestone, retitle
   a task, rewrite a roadmap phase and its outcomes, move something's status.
   Use this whenever the user asks you to fix, reword, rename, re-scope,
   re-date, or re-sequence something they can already see.
   <nova_action>{"type": "edit_project", "data": {"operations": [ ... ]}}</nova_action>
${OPERATION_SCHEMA_INSTRUCTIONS}
   Milestone and roadmap operations require the Builder plan${canCreateMilestones ? " — this user has it" : " — this user does NOT have it, so say so instead of trying"}.

RULES:
- NEVER write an id in your visible reply. Ids exist so you can put them inside
  a <nova_action> block; in prose they are meaningless noise to the user. Refer
  to a task, milestone or phase by its TITLE. Write "your board already has
  *Walk the weekly check-in loop*" — never "4103bb02-1319-4fbf-a110-bc57d7a0eaee
  (in-progress): Walk the weekly check-in loop".
- ALWAYS wrap an action in <nova_action>...</nova_action>. Never put the action
  JSON in a code fence, and never print it as plain text — wrap it.
- Never tell the user something was saved unless you emitted the action for it
  in the SAME message.
- Take the action and then say what was done, in one or two lines. Don't announce it first.
- Several related edits the builder clearly asked for belong in one message, not spread over a back-and-forth.
- When creating tasks, create 3-5 actionable, specific tasks
- Confirm before saving only when you had to guess at what they meant; when they told you, save it.
- Markdown: **bold** sparingly for key terms, bullets for real lists, nothing else.`;

      // "Nova project memory" — how far back Nova can see. This is the tier
      // difference between Basic / Expanded / Full memory.
      const priorMessages = history.slice(0, -1).slice(-memoryLimitFor(ent));
      const messages = [
        { role: "system" as const, content: systemPrompt },
        ...priorMessages.map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user" as const, content: message }
      ];

      const response = await openai.chat.completions.create({
        model: modelFor(ent),
        messages,
        temperature: 0.7,
      });

      const rawReply = response.choices[0].message.content || "I'm here to help! Tell me more about your project.";

      const { actions: parsedActions, cleaned } = extractNovaActions(rawReply);
      const actionsTaken: any[] = [];
      let cleanReply = cleaned;

      for (const action of parsedActions) {
        try {
          switch (action.type) {
            case "update_project": {
              // Keep in step with the brief fields the Setup tab edits and the
              // ones nova-briefing.ts scores. `mission` was missing here while
              // being required by the completion check, so Nova filled in every
              // other field and the panel then complained about the one field
              // Nova had no way to write.
              const allowedFields = ["oneLiner", "mission", "valueProposition", "targetCustomerProfile", "problemStatement", "targetUser", "successMetrics"];
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
            case "remember": {
              const notes = typeof action.data?.notes === "string" ? action.data.notes.trim().slice(0, 2000) : "";
              if (notes) {
                await db.update(projects).set({ novaNotes: notes }).where(eq(projects.id, projectId));
                actionsTaken.push({ type: "remember", data: { notes } });
              }
              break;
            }
            case "update_scope": {
              const scopeData: any = {};
              if (Array.isArray(action.data.mvp)) scopeData.mvp = action.data.mvp.filter((s: any) => typeof s === "string").slice(0, 20);
              if (Array.isArray(action.data.niceToHave)) scopeData.niceToHave = action.data.niceToHave.filter((s: any) => typeof s === "string").slice(0, 20);
              if (Object.keys(scopeData).length > 0) {
                // Merge over the existing scope rather than replacing it.
                // Nova usually sends only one bucket, and a bare overwrite
                // silently deleted the other one. Re-read the project so we
                // merge against current state, not the pre-action snapshot.
                const current = (await storage.getProject(projectId))?.scope as
                  { mvp?: string[]; niceToHave?: string[] } | null;
                const merged = {
                  mvp: current?.mvp || [],
                  niceToHave: current?.niceToHave || [],
                  ...scopeData,
                };
                await storage.updateProject(projectId, { scope: merged });
                actionsTaken.push({ type: "update_scope", data: merged });
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
              if (!canCreateMilestones) {
                actionsTaken.push({
                  type: "create_milestones",
                  data: { error: "AI milestone creation requires the Builder plan", requiredTier: "builder" },
                });
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
                  const milestone = await storage.createMilestone({
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
            case "edit_project": {
              const { changes, skipped } = await applyProjectOperations(projectId, userId, action.data?.operations, {
                canEditMilestones: ent.aiMilestones,
                canEditRoadmap: ent.roadmapUpdates,
              });
              if (changes.length) {
                actionsTaken.push({ type: "edit_project", data: { changes, skipped } });
              } else {
                console.warn("Nova edit_project applied nothing for project %s: %s", projectId, JSON.stringify(skipped));
              }
              break;
            }
          }
        } catch (e) {
          console.error("Nova action parse error:", e);
        }
      }

      /*
       * Strip any id that survived into the visible reply.
       *
       * Unlike the document builder, the chat genuinely needs ids in its
       * context — that's how it addresses an existing task in an action block.
       * So the temptation can't be removed, only the result: replies were
       * coming back as "4103bb02-1319-4fbf-…: Walk the weekly check-in loop".
       * Runs after action extraction so the action JSON, which legitimately
       * contains ids, is already out of the string.
       */
      cleanReply = stripIdFragments(cleanReply, await collectProjectIds(projectId).catch(() => []));
      cleanReply = cleanReply.trim();

      // Nova sometimes replies with nothing but the action block. Stripping it
      // would leave an empty bubble, so say what actually happened.
      if (!cleanReply) {
        cleanReply = actionsTaken.length > 0
          ? "Saved that to your project. ✅"
          : "I'm here to help! Tell me more about your project.";
      }

      // A parsed action that changed nothing means the model sent field names
      // or shapes we don't accept. Log it — this is otherwise invisible, and
      // the user just sees Nova claim success.
      if (parsedActions.length > 0 && actionsTaken.length === 0) {
        console.warn(
          "Nova parsed %d action(s) but applied none for project %s: %s",
          parsedActions.length, projectId, JSON.stringify(parsedActions).slice(0, 500),
        );
      }

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
        { role: "system", content: `You are Nova, SparkTower's project partner, helping plan "${project.title}". ${coachingDirectiveFor(await getUserEntitlements(userId))} Give concrete, sequenced advice on timeline, team, roadmap and tech stack.` },
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
  /** Where this project is on its path: the phase, the step, and the one next action. */
  app.get("/api/projects/:id/path", isAuthenticated, async (req: any, res) => {
    try {
      const status = await pathStatus(req.params.id);
      if (!status) return res.status(404).json({ message: "Project not found" });
      res.json(status);
    } catch (error) {
      console.error("Path status error:", error);
      res.status(500).json({ message: "Couldn't read the path" });
    }
  });

  /**
   * Putting a project that predates paths onto its path. The tree is built
   * around the roadmap it already has, then Nova reads the tasks, audit and
   * check-ins and marks what is already done, so the dashboard starts where
   * the project actually is rather than at week 1, step 1.
   */
  app.post("/api/projects/:id/path/adopt", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;
      if (!(await isProjectMember(userId, projectId))) return res.status(403).json({ message: "Not a project member" });
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const built = await instantiatePathTree(projectId, project.goal as any, project.subcategory, { keepRoadmap: true });
      const backbone = resolveTree(project.goal as any, project.subcategory).filter((p) => !p.optional).flatMap((p) => p.milestones)
        .map((m) => ({ id: m.id, title: m.title, description: m.description }));

      let recognised: { id: string; evidence: string; answer?: string }[] = [];
      let read = "";
      let loops: { created: string[]; updated: string[]; found: { title: string; steps: string; state: string; evidence: string }[] } = { created: [], updated: [], found: [] };
      if (req.body?.read !== false) {
        const ent = await requireCredits(res, userId, CREDIT_COSTS.taskAssist, "Nova reading your progress");
        if (!ent) return;
        const state = await buildOperableProjectState(projectId, { includeIds: false, includeAudit: true });
        const ship = project.goal === "ship_mvp";
        const known = ship ? (await storage.getProjectKanbanTasks(projectId)).filter((t) => t.tags?.includes("kind:loop") && t.tags?.includes("parent:SHIP.M1.2")).map((t) => t.title) : [];
        const result = await readExistingProgress(ent, backbone, state, { findLoops: ship, knownLoops: known, rejectedLoops: project.rejectedLoops ?? [] });
        recognised = result.done; read = result.read;
        if (ship && result.loops.length) {
          const r = await reconcileLoops(projectId, result.loops);
          loops = { ...r, found: result.loops };
        }
        await storage.deductCredits(userId, CREDIT_COSTS.taskAssist);
      }
      const { marked, filled } = await reconcileMilestones(projectId, recognised, "nova");
      const status = await pathStatus(projectId);
      res.json({ built: built.created, recognised: recognised.filter((r) => marked.includes(r.id)), filled, loops, plan: status?.adopted ? status.plan : null, read });
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code });
      console.error("Path adopt error:", error);
      res.status(500).json({ message: "Couldn't put the project on its path" });
    }
  });

  /** One milestone in full, for the map's click-through. */
  app.get("/api/projects/:id/path/milestones/:backboneId", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const detail = await milestoneDetail(req.params.id, req.params.backboneId);
      if (!detail) return res.status(404).json({ message: "That milestone isn't on this path." });
      res.json(detail);
    } catch (error) {
      console.error("Milestone detail error:", error);
      res.status(500).json({ message: "Couldn't read that milestone" });
    }
  });

  /** The builder marking a milestone done from the map — quick catch-up, no AI. */
  app.post("/api/projects/:id/path/mark", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isProjectMember(userId, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
      if (!ids.length) return res.status(400).json({ message: "Say which milestones.", code: "invalid_input", field: "ids" });
      const { marked } = await reconcileMilestones(req.params.id, ids.map((id) => ({ id, evidence: String(req.body?.evidence ?? "already done before this path existed") })), "builder");
      res.json({ marked });
    } catch (error) {
      console.error("Path mark error:", error);
      res.status(500).json({ message: "Couldn't mark that" });
    }
  });

  /**
   * Nova doing the task. The actor decides what "doing" means: options to
   * pick from, a build packet, or the template for a human-only step. The
   * result stays on the task, and choosing it writes the answer and closes it.
   */
  app.post("/api/projects/:id/path/work", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;
      if (!(await isProjectMember(userId, projectId))) return res.status(403).json({ message: "Not a project member" });
      const ctx = await pathTaskContext(projectId, String(req.body?.taskId ?? ""));
      if (!ctx) return res.status(400).json({ message: "That task isn't on this project's path.", code: "not_on_path" });
      const kind = workKindFor(ctx.actor);
      const ent = await requireCredits(res, userId, CREDIT_COSTS.taskAssist, "Nova working on a milestone");
      if (!ent) return;
      const [state, artifacts] = await Promise.all([
        buildOperableProjectState(projectId, { includeIds: false, includeAudit: true }),
        collectArtifacts(projectId),
      ]);
      const all = await storage.getProjectKanbanTasks(projectId);
      const loops = all.filter((t) => t.tags?.includes("kind:loop") && !t.tags.some((x) => x.startsWith("archived:")))
        .map((t) => ({ title: t.title, description: t.description ?? "", status: t.status }));
      const full = await storage.getProject(projectId);
      const payload = await produceWork(ent, kind,
        { title: ctx.task.title, description: ctx.task.description ?? ctx.milestone?.description ?? "", tier: ctx.tier },
        { goal: ctx.project.goal, subcategory: ctx.project.subcategory, state, artifacts, loops, rejectedLoops: full?.rejectedLoops ?? [] });
      const row = await saveWork(projectId, ctx.task.id, payload);
      await storage.deductCredits(userId, CREDIT_COSTS.taskAssist);
      res.json({ id: row.id, kind: row.kind, payload: row.payload, chosenIndex: null, createdAt: row.createdAt });
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code });
      console.error("Path work error:", error);
      res.status(500).json({ message: "Nova couldn't finish that. Try again in a moment." });
    }
  });

  /** The latest work on one task on the path. */
  app.get("/api/projects/:id/path/work/:taskId", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const ctx = await pathTaskContext(req.params.id, req.params.taskId);
      if (!ctx) return res.status(404).json({ message: "That task isn't on this project's path." });
      const w = await latestWork(ctx.task.id);
      res.json({ work: w ? { id: w.id, kind: w.kind, payload: w.payload, chosenIndex: w.chosenIndex, createdAt: w.createdAt } : null });
    } catch (error) {
      console.error("Path work read error:", error);
      res.status(500).json({ message: "Couldn't read that" });
    }
  });

  app.post("/api/projects/:id/path/work/:workId/choose", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isProjectMember(userId, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const result = await chooseWork(req.params.id, req.params.workId, {
        index: req.body?.index, text: typeof req.body?.text === "string" ? req.body.text : undefined, done: req.body?.done,
      });
      res.json(result);
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code });
      console.error("Path choose error:", error);
      res.status(500).json({ message: "Couldn't save that" });
    }
  });

  /**
   * Layer 3a. A fan-out milestone ("one per step of the core loop") becomes
   * real steps. The artifact is the parent task's own written answer; with
   * no answer there is nothing to expand from, and Nova says so.
   */
  app.post("/api/projects/:id/path/expand", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;
      if (!(await isProjectMember(userId, projectId))) return res.status(403).json({ message: "Not a project member" });
      const backboneId = String(req.body?.backboneId ?? "");
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      const milestone = resolveTree(project.goal as any, project.subcategory).flatMap((p) => p.milestones).find((m) => m.id === backboneId);
      if (!milestone?.expandsFrom) return res.status(400).json({ message: "That milestone doesn't break into steps.", code: "not_expandable" });

      const tasks = await storage.getProjectKanbanTasks(projectId);
      const loopTaskId = typeof req.body?.loopTaskId === "string" && req.body.loopTaskId ? req.body.loopTaskId : null;
      // With loops, the artifact is that loop's own write-up; without, the source milestone's.
      const source = loopTaskId
        ? tasks.find((t) => t.id === loopTaskId && t.tags?.includes("kind:loop"))
        : tasks.find((t) => backboneIdOf(t.tags) === milestone.expandsFrom);
      if (loopTaskId && !source) return res.status(400).json({ message: "That loop isn't on this project.", code: "not_on_path" });
      const authored = loopTaskId ? null : resolveTree(project.goal as any, project.subcategory).flatMap((p) => p.milestones).find((m) => m.id === milestone.expandsFrom);
      const written = typeof req.body?.artifact === "string" && req.body.artifact.trim()
        ? req.body.artifact.trim()
        : source?.description && source.description.trim() !== (authored?.description ?? "").trim() ? source.description.trim() : "";
      if (!written) {
        /*
         * Nothing written yet. No blank text fields anywhere: rather than
         * refuse, Nova drafts the answer from the project and hands it back
         * to edit. Confirming sends it as `artifact`, which lands on the
         * source task and becomes the thing the steps are built from.
         */
        const sourceTitle = loopTaskId ? source!.title : authored?.title ?? "that milestone";
        if (req.body?.draft === true) {
          const ent = await requireCredits(res, userId, CREDIT_COSTS.novaGuide, "Nova drafting your answer");
          if (!ent) return;
          const state = await buildOperableProjectState(projectId, { includeIds: false, includeAudit: true });
          const draft = await draftArtifact(ent, loopTaskId ? { title: `The ${source!.title} loop`, description: "The 3–5 step sequence that delivers value in this loop." } : authored!, state);
          await storage.deductCredits(userId, CREDIT_COSTS.novaGuide);
          return res.json({ draft, sourceTitle, sourceTaskId: source?.id ?? null });
        }
        return res.status(400).json({
          message: `Nothing is written under "${sourceTitle}" yet. Nova can draft it from your project for you to edit, or write it into that task yourself.`,
          code: "artifact_missing", sourceTitle, sourceTaskId: source?.id ?? null,
        });
      }
      const ent = await requireCredits(res, userId, CREDIT_COSTS.taskAssist, "Nova path steps");
      if (!ent) return;
      // What they confirmed is the artifact; keep it on the source task so
      // the rest of the path (injections, the next expansion) can read it.
      if (source && typeof req.body?.artifact === "string" && req.body.artifact.trim()) {
        await storage.updateKanbanTask(source.id, { description: written } as any);
      }
      const steps = await draftExpansionSteps(ent, loopTaskId ? `${milestone.title} — ${source!.title}` : milestone.title, written);
      if (steps.length < 1) return res.status(502).json({ message: "Nova couldn't read steps out of that. Try adding a line or two." });
      const result = await createExpansion(projectId, backboneId, steps, { loopTaskId });
      await storage.deductCredits(userId, CREDIT_COSTS.taskAssist);
      res.json(result);
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code });
      console.error("Path expand error:", error);
      res.status(500).json({ message: "Couldn't expand that milestone" });
    }
  });

  /** A step added by hand to a fan-out milestone (optionally under one loop). */
  app.post("/api/projects/:id/path/steps", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const title = String(req.body?.title ?? "").trim();
      if (!title) return res.status(400).json({ message: "Give the step a name.", code: "invalid_input", field: "title" });
      const result = await createExpansion(req.params.id, String(req.body?.backboneId ?? ""), [{ title, description: String(req.body?.description ?? ""), estimateHours: req.body?.estimateHours }],
        { loopTaskId: typeof req.body?.loopTaskId === "string" && req.body.loopTaskId ? req.body.loopTaskId : null, append: true });
      res.json({ created: result.created });
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code });
      console.error("Path step error:", error);
      res.status(500).json({ message: "Couldn't add that step" });
    }
  });

  /** Another loop under the core loop (or any fan-out source). */
  app.post("/api/projects/:id/path/loops", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const loop = await createLoop(req.params.id, String(req.body?.backboneId ?? "SHIP.M1.2"), { title: req.body?.title, description: req.body?.description });
      res.json(loop);
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code, field: error.field });
      console.error("Path loop error:", error);
      res.status(500).json({ message: "Couldn't add that loop" });
    }
  });

  /**
   * Where the project's data lives, for the audit's data-shape read. Owner
   * only. The connection string is sealed before it is stored and never
   * returned; the client learns only that one is configured. "self" — this
   * application's own database — is allowed only for the platform owner.
   */
  app.get("/api/projects/:id/data-source", isAuthenticated, async (req: any, res) => {
    const project = await storage.getProject(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });
    if (project.ownerId !== (req.user as any).id) return res.status(403).json({ message: "Only the owner can see this" });
    res.json({ configured: !!project.dataSource, kind: project.dataSource === "self" ? "self" : project.dataSource ? "connection" : null });
  });
  app.put("/api/projects/:id/data-source", isAuthenticated, async (req: any, res) => {
    const project = await storage.getProject(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });
    if (project.ownerId !== (req.user as any).id) return res.status(403).json({ message: "Only the owner can set this" });
    const value = req.body?.url == null ? null : String(req.body.url).trim();
    let stored: string | null = null;
    if (value === "self") {
      if (!isPlatformOwner((req.user as any).email)) return res.status(403).json({ message: "Only the platform owner can point a project at this application's database.", code: "self_not_allowed" });
      stored = "self";
    } else if (value) {
      if (!safeDbUrl(value)) return res.status(400).json({ message: "That needs to be a postgres:// URL to a public host, with its own read-only user. Local and private addresses are refused.", code: "invalid_input", field: "url" });
      stored = seal(value);
    }
    await db.update(projects).set({ dataSource: stored }).where(eq(projects.id, req.params.id));
    // Read it now: the map should exist the moment the source does.
    const shape = stored ? await refreshDataShape(req.params.id).catch((e) => ({ error: String(e?.message ?? e).slice(0, 200) })) : null;
    if (!stored) await db.delete(projectDataShapes).where(eq(projectDataShapes.projectId, req.params.id));
    res.json({ configured: !!stored, kind: stored === "self" ? "self" : stored ? "connection" : null, shape });
  });

  /** The project's current data shape, for the map. Members. */
  app.get("/api/projects/:id/data-shape", isAuthenticated, async (req: any, res) => {
    if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
    res.json({ shape: await getDataShape(req.params.id) });
  });
  /** Re-read the database now. Owner. */
  app.post("/api/projects/:id/data-shape/refresh", isAuthenticated, async (req: any, res) => {
    const project = await storage.getProject(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });
    if (project.ownerId !== (req.user as any).id) return res.status(403).json({ message: "Only the owner can do this" });
    if (!project.dataSource) return res.status(400).json({ message: "Set a data source first.", code: "no_data_source" });
    res.json({ shape: await refreshDataShape(req.params.id) });
  });

  /** What the builder wants Nova to keep in mind. Read by every Nova prompt. */
  app.put("/api/projects/:id/nova-notes", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const notes = typeof req.body?.notes === "string" ? req.body.notes.trim().slice(0, 2000) : "";
      await db.update(projects).set({ novaNotes: notes || null }).where(eq(projects.id, req.params.id));
      res.json({ notes: notes || null });
    } catch (error) {
      console.error("Nova notes error:", error);
      res.status(500).json({ message: "Couldn't save that" });
    }
  });

  app.delete("/api/projects/:id/path/loops/:taskId", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      res.json(await deleteLoop(req.params.id, req.params.taskId));
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code });
      console.error("Path loop delete error:", error);
      res.status(500).json({ message: "Couldn't remove that loop" });
    }
  });

  /** Entering, extending or leaving an optional phase — the keep-building branch. */
  app.post("/api/projects/:id/path/branch", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) return res.status(403).json({ message: "Not a project member" });
      const phaseId = req.body?.phaseId == null ? null : String(req.body.phaseId);
      const result = req.body?.extend === true && phaseId ? await extendBranch(req.params.id, phaseId) : await setBranch(req.params.id, phaseId);
      res.json(result);
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code });
      console.error("Path branch error:", error);
      res.status(500).json({ message: "Couldn't change the branch" });
    }
  });

  /**
   * Layer 3b. Nova reads the project's artifacts and proposes what this
   * phase is missing. Admission — the cap, the named artifact — is code.
   */
  app.post("/api/projects/:id/path/inject", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;
      if (!(await isProjectMember(userId, projectId))) return res.status(403).json({ message: "Not a project member" });
      const phaseId = String(req.body?.phaseId ?? "");
      const status = await pathStatus(projectId);
      if (!status) return res.status(404).json({ message: "Project not found" });
      if (!status.adopted) return res.status(400).json({ message: "Put the project on its path first.", code: "no_path" });
      const phase = status.phases.find((p) => p.id === phaseId);
      if (!phase) return res.status(400).json({ message: "That phase isn't on this path.", code: "not_on_path" });
      if (phase.injectRoom <= 0) return res.status(409).json({ message: "This phase already has three of Nova's additions. Finish those first.", code: "phase_at_cap" });
      const artifacts = await collectArtifacts(projectId);
      if (artifacts.length === 0) {
        return res.status(400).json({ message: "Nothing to ground a task in yet. Finish a milestone with a written answer, or post a check-in, and Nova will have something to work from.", code: "no_artifacts" });
      }
      const ent = await requireCredits(res, userId, CREDIT_COSTS.taskAssist, "Nova path additions");
      if (!ent) return;
      const proposals = await proposeInjections(ent, phase.title, phase.milestones.map((m) => m.title), artifacts, phase.injectRoom);
      const result = await createInjections(projectId, phaseId, proposals, artifacts);
      await storage.deductCredits(userId, CREDIT_COSTS.taskAssist);
      res.json(result);
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code });
      console.error("Path inject error:", error);
      res.status(500).json({ message: "Couldn't add to that phase" });
    }
  });

  /** Moving to another path, visibly. Shared milestones already done carry across. */
  app.post("/api/projects/:id/path/switch", isAuthenticated, async (req: any, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== (req.user as any).id) return res.status(403).json({ message: "Only the owner can move the project to another path" });
      const goal = String(req.body?.goal ?? "");
      const subcategory = String(req.body?.subcategory ?? "other");
      if (!PROJECT_GOALS.some((g) => g.id === goal)) return res.status(400).json({ message: "Pick one of the three paths.", code: "invalid_input", field: "goal" });
      if (!isValidSubcategory(goal as any, subcategory)) return res.status(400).json({ message: `"${subcategory}" is not a kind of "${goal}" project.`, code: "subcategory_mismatch" });
      if (goal === project.goal && subcategory === project.subcategory) return res.status(400).json({ message: "The project is already on that path.", code: "same_path" });
      const result = await switchPath(req.params.id, goal as any, subcategory);
      void recordActivity({
        name: "path.switched", userId: (req.user as any).id, visitorId: req.visitorId ?? "unknown", sessionId: req.sessionId ?? "unknown",
        path: req.originalUrl, projectId: req.params.id, props: { from: project.goal, to: goal, fromSubcategory: project.subcategory, toSubcategory: subcategory },
      });
      res.json(result);
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code });
      console.error("Path switch error:", error);
      res.status(500).json({ message: "Couldn't switch paths" });
    }
  });

  app.get("/api/projects/:id/analytics-events", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isProjectMember(userId, req.params.id))) return res.status(403).json({ message: "Not a project member" });

      // Free has no analytics; Starter gets basic, Builder+ advanced.
      const ent = await requireLevel(
        res, userId, "projectAnalytics", ["basic", "advanced"],
        "Project analytics", "starter"
      );
      if (!ent) return;

      // Kept as a plain array for the shared CRUD helper on the client; the
      // client reads the analytics level from useEntitlements().
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

      // Matching quality scales with tier: how many candidates come back, and
      // whether Nova explains each match in plain language.
      const matchEnt = await getUserEntitlements(userId);
      const matchLimit = { basic: 5, enhanced: 12, priority: 20 }[matchEnt.teamMatching];
      const wantsAiReasons = matchEnt.teamMatching !== "basic";

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

      const userReputation = await storage.getUserReputation(userId);
      const userBuilderIndex = userReputation?.builderIndex || 0;

      function cofounderCompatibility(a: any, b: any): number {
        let score = 0;
        let factors = 0;

        if (a.riskTolerance && b.riskTolerance) {
          const levels = ["low", "moderate", "high"];
          const diff = Math.abs(levels.indexOf(a.riskTolerance) - levels.indexOf(b.riskTolerance));
          score += diff === 0 ? 1.0 : diff === 1 ? 0.5 : 0.1;
          factors++;
        }

        if (a.scheduleStyle && b.scheduleStyle) {
          if (a.scheduleStyle === b.scheduleStyle) score += 1.0;
          else if (a.scheduleStyle === "hybrid" || b.scheduleStyle === "hybrid") score += 0.7;
          else score += 0.3;
          factors++;
        }

        if (a.conflictStyle && b.conflictStyle) {
          const complementary: Record<string, string[]> = {
            direct: ["diplomatic", "collaborative"],
            diplomatic: ["direct", "collaborative"],
            avoidant: ["collaborative", "diplomatic"],
            collaborative: ["direct", "diplomatic", "collaborative"],
          };
          if (a.conflictStyle === b.conflictStyle) score += 0.7;
          else if (complementary[a.conflictStyle]?.includes(b.conflictStyle)) score += 1.0;
          else score += 0.3;
          factors++;
        }

        if (a.hoursPerWeek && b.hoursPerWeek) {
          const diff = Math.abs(a.hoursPerWeek - b.hoursPerWeek);
          score += diff <= 5 ? 1.0 : diff <= 10 ? 0.6 : 0.2;
          factors++;
        }

        if (a.builderType && b.builderType) {
          if (a.builderType === b.builderType) score += 1.0;
          else if (a.builderType === "both" || b.builderType === "both") score += 0.7;
          else score += 0.3;
          factors++;
        }

        if (a.speedVsPolish && b.speedVsPolish) {
          const levels = ["speed", "balanced", "polish"];
          const diff = Math.abs(levels.indexOf(a.speedVsPolish) - levels.indexOf(b.speedVsPolish));
          score += diff === 0 ? 1.0 : diff === 1 ? 0.6 : 0.2;
          factors++;
        }

        return factors > 0 ? score / factors : 0.5;
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

        const cofounderScore = cofounderCompatibility(userProfile, op);

        const otherReputation = await storage.getUserReputation(other.id);
        const otherBuilderIndex = otherReputation?.builderIndex || 0;
        const indexDiff = Math.abs(userBuilderIndex - otherBuilderIndex);
        const builderScore = indexDiff <= 10 ? 1.0 : indexDiff <= 25 ? 0.7 : 0.4;

        const weightedScore = Math.round(
          (skillsScore * 25 +
           interestsScore * 20 +
           experienceScore * 10 +
           projectScore * 10 +
           connectionScore * 10 +
           cofounderScore * 15 +
           builderScore * 10)
        );

        if (weightedScore > 5) {
          scoredMatches.push({
            id: other.id,
            score: Math.min(100, weightedScore),
            factors: { skills: skillsScore, interests: interestsScore, experience: experienceScore, projects: projectScore, connections: connectionScore, cofounder: cofounderScore, builder: builderScore }
          });
        }
      }

      scoredMatches.sort((a, b) => b.score - a.score);
      const topMatches = scoredMatches.slice(0, matchLimit);

      if (topMatches.length === 0) {
        return res.json([]);
      }

      const hasCredits = wantsAiReasons && (await storage.checkCredits(userId, CREDIT_COSTS.peopleRecommendation));
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
            model: "gpt-4o",
            messages: [
              { role: "system", content: "Generate concise match reasons. Return ONLY valid JSON (no markdown): {\"reasons\": {\"userId\": [\"reason1\", \"reason2\"]}}. Each user gets 2-3 short reasons. Include co-founder compatibility insights when relevant." },
              { role: "user", content: `User profile: skills=${userProfile.skills?.join(", ")}, interests=${userProfile.interests?.join(", ")}, experience=${userProfile.experienceLevel}.\n\nMatches: ${JSON.stringify(matchSummary)}` }
            ],
          });
          const rawContent = (response.choices[0].message.content || '{"reasons":{}}').replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const parsed = JSON.parse(rawContent);
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
  app.get("/api/leaderboard", async (req: any, res) => {
    const sortBy = (req.query.sortBy as "views" | "donations") || "views";
    const limit = parseInt(req.query.limit as string) || 10;
    const filter = (req.query.filter as "solo" | "team" | "all") || "all";
    // Owners see their own private projects ranked (and badged); nobody else does.
    const leaderboard = await storage.getLeaderboard(sortBy, limit, filter, req.user?.id);
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

      const { prompt, style = "professional", useAiImages = true } = req.body;

      // The brief (one-liner, mission, problem, target user, scope, ...) is the
      // richest description of the project, so it grounds every generation step.
      const briefContext = formatProjectBriefForPrompt(project);
      const videoPrompt = prompt?.trim()
        ? prompt.trim()
        : `Create a short showcase video for the project "${project.title}".`;

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
        model: TEXT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a creative director specializing in ${style} visual style. Generate a detailed video storyboard description for a 30-second project showcase video. The visual style should be: ${styleDesc}. Include exactly 5 scenes with clear scene descriptions, text overlays, and visual effects suggestions. Format as a structured storyboard with ## Scene 1, ## Scene 2, etc.

Ground every scene in the project brief below — use its actual one-liner, mission, problem, target user, and scope. Do not invent product details that contradict the brief. Structure the 5 scenes as a narrative arc: (1) hook built on the one-liner, (2) the problem being solved, (3) the solution and what's being built, (4) who it's for and the value they get, (5) a closing call to action that reflects the mission and the roles being recruited.`
          },
          {
            role: "user",
            content: `PROJECT BRIEF\n${briefContext}\n\nCREATIVE DIRECTION\n${videoPrompt}`
          }
        ],
      });

      const storyboard = storyboardResponse.choices[0].message.content || "Video storyboard generation failed.";

      const scenesResponse = await openai.chat.completions.create({
        model: TEXT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are an AI that extracts scene descriptions from storyboards and creates SVG illustrations. Given a storyboard, extract exactly 5 scenes.

For each scene, provide:
1. "caption": A short 1-sentence summary for display
2. "imagePrompt": A vivid, self-contained image-generation prompt (2-4 sentences) describing exactly what the frame shows. Describe concrete subject matter drawn from the project brief — the actual product, users, and setting — plus composition, lighting and color. Include this visual style: ${styleDesc}. Never ask for text, words, letters, logos, or UI copy in the image.
3. "svg": A complete, valid SVG image (viewBox="0 0 1280 720") that visually represents the scene. This is a fallback used if image generation is unavailable.

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

Respond ONLY with valid JSON in this exact format (no markdown, no code fences), with exactly 5 entries:
[
  {"caption": "Short caption", "imagePrompt": "Vivid description of the frame...", "svg": "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 1280 720\\">...</svg>"}
]`
          },
          {
            role: "user",
            content: `PROJECT BRIEF\n${briefContext}\n\nSTORYBOARD\n${storyboard}`
          }
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
            prompt: s.imagePrompt || s.prompt || s.caption || "",
            caption: s.caption || "",
            imageUrl: dataUri,
          };
        });
        if (scenes.length === 0) throw new Error("Empty scenes array");
      } catch (parseErr) {
        console.error("Error parsing scenes:", parseErr);
        scenes = generateFallbackScenes(style);
      }

      // Upgrade the SVG placeholders to real AI-generated imagery. Each scene
      // falls back to its SVG independently, so a partial failure (quota,
      // content filter) still yields a complete storyboard.
      let imageModelUsed: string | null = null;
      const imageErrors: string[] = [];
      if (useAiImages) {
        const rendered = await Promise.all(
          scenes.map(async (scene) => {
            if (!scene.prompt) return scene;
            try {
              const image = await openai.images.generate({
                model: IMAGE_MODEL,
                prompt: `${scene.prompt}\n\nStyle: ${styleDesc}. Cinematic 3:2 widescreen showcase frame. Do not render any text, words, letters or logos in the image.`,
                size: IMAGE_SIZE,
                quality: IMAGE_QUALITY,
              });
              const b64 = image.data?.[0]?.b64_json;
              if (!b64) throw new Error("Image response contained no data");
              imageModelUsed = IMAGE_MODEL;
              return { ...scene, imageUrl: `data:image/png;base64,${b64}` };
            } catch (imgErr: any) {
              imageErrors.push(imgErr?.message || String(imgErr));
              return scene; // keep the SVG fallback
            }
          })
        );
        scenes = rendered;
        if (imageErrors.length > 0) {
          console.error(`AI image generation failed for ${imageErrors.length}/${scenes.length} scenes:`, imageErrors[0]);
        }
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

      /*
       * Persist scenes privately.
       *
       * Raster frames go to private object storage (too large for the DB) with
       * an owner-scoped ACL; SVG fallbacks are small enough to inline. Nothing
       * here touches projects.mediaUrls — the media gallery is exclusively for
       * media the user uploaded themselves. Storyboards are private working
       * output, readable only through /api/storyboards/* by their owner.
       */
      const storedScenes: StoryboardScene[] = [];
      const objStorage = new ObjectStorageService();

      for (const scene of scenes) {
        const base: StoryboardScene = { caption: scene.caption, prompt: scene.prompt };
        const match = scene.imageUrl.match(/^data:(image\/(?:svg\+xml|png|jpeg|webp));base64,(.*)$/);

        if (!match) {
          storedScenes.push(base);
          continue;
        }

        const [, contentType, base64Data] = match;

        // Vector fallbacks are a few KB — keep them inline so a storyboard
        // still renders even if object storage is unavailable.
        if (contentType === "image/svg+xml") {
          storedScenes.push({ ...base, inlineImage: scene.imageUrl });
          continue;
        }

        try {
          const uploadUrl = await objStorage.getObjectEntityUploadURL();
          const uploadRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": contentType },
            body: Buffer.from(base64Data, "base64"),
          });
          if (!uploadRes.ok) throw new Error(`upload returned ${uploadRes.status}`);

          const objectPath = await objStorage
            .trySetObjectEntityAclPolicy(uploadUrl, { owner: userId, visibility: "private" })
            .catch(() => objStorage.normalizeObjectEntityPath(uploadUrl));

          storedScenes.push({ ...base, imagePath: objectPath, contentType });
        } catch (uploadErr) {
          console.error("Failed to store storyboard scene:", uploadErr);
          storedScenes.push(base); // scene renders as a placeholder
        }
      }

      const saved = await storage.createStoryboard({
        projectId: project.id,
        userId,
        style,
        prompt: prompt?.trim() || null,
        storyboard,
        scenes: storedScenes,
        imageModel: imageModelUsed,
      });

      await storage.deductCredits(userId, CREDIT_COSTS.videoGeneration);

      res.json({
        storyboardId: saved.id,
        storyboard,
        // Scene images are served from an owner-checked route, never inlined
        // as data URIs and never added to the project's media gallery.
        scenes: toClientScenes(saved),
        style,
        imageModel: imageModelUsed,
        // Non-fatal: some or all scenes fell back to SVG illustrations.
        imageFallbackCount: imageErrors.length,
        imageFallbackReason: imageErrors[0] || null,
        usedBriefFields: getProjectBriefContext(project).map((p) => p.label),
        createdAt: saved.createdAt,
        message: "AI storyboard generated. Only you can see it.",
        projectId: project.id,
      });
    } catch (error) {
      console.error("Error generating video:", error);
      res.status(500).json({ message: "Failed to generate video" });
    }
  });

  // ============================================
  // STORYBOARDS — private to the generating account
  // ============================================

  /** List the caller's own storyboards for a project. Never anyone else's. */
  app.get("/api/projects/:id/storyboards", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const storyboards = await storage.getStoryboardsForUser(req.params.id, userId);
      res.json(
        storyboards.map((s) => ({
          id: s.id,
          style: s.style,
          prompt: s.prompt,
          sceneCount: ((s.scenes as StoryboardScene[]) || []).length,
          imageModel: s.imageModel,
          createdAt: s.createdAt,
          // Thumbnail for the picker list.
          thumbnail: sceneImageUrl(s, 0),
        }))
      );
    } catch (error) {
      console.error("Error listing storyboards:", error);
      res.status(500).json({ message: "Failed to list storyboards" });
    }
  });

  /** Full storyboard, owner only. */
  app.get("/api/storyboards/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const storyboard = await storage.getStoryboardForUser(req.params.id, userId);
      if (!storyboard) return res.status(404).json({ message: "Storyboard not found" });
      res.json({
        id: storyboard.id,
        projectId: storyboard.projectId,
        style: storyboard.style,
        prompt: storyboard.prompt,
        storyboard: storyboard.storyboard,
        scenes: toClientScenes(storyboard),
        imageModel: storyboard.imageModel,
        createdAt: storyboard.createdAt,
      });
    } catch (error) {
      console.error("Error fetching storyboard:", error);
      res.status(500).json({ message: "Failed to get storyboard" });
    }
  });

  /**
   * Streams one storyboard frame. The ownership check happens here rather than
   * relying on the object path being unguessable, so scene images are never
   * reachable by anyone but the account that generated them.
   */
  app.get("/api/storyboards/:id/scenes/:index/image", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const storyboard = await storage.getStoryboardForUser(req.params.id, userId);
      if (!storyboard) return res.status(404).json({ message: "Storyboard not found" });

      const index = Number(req.params.index);
      const scene = ((storyboard.scenes as StoryboardScene[]) || [])[index];
      if (!scene) return res.status(404).json({ message: "Scene not found" });

      if (scene.inlineImage) {
        const match = scene.inlineImage.match(/^data:(image\/[\w+.-]+);base64,(.*)$/);
        if (!match) return res.status(404).json({ message: "Scene has no image" });
        res.setHeader("Content-Type", match[1]);
        res.setHeader("Cache-Control", "private, max-age=86400");
        return res.send(Buffer.from(match[2], "base64"));
      }

      if (!scene.imagePath) return res.status(404).json({ message: "Scene has no image" });

      // downloadObject sets Cache-Control to private for private-ACL objects.
      const objStorage = new ObjectStorageService();
      const file = await objStorage.getObjectEntityFile(scene.imagePath);
      await objStorage.downloadObject(file, res, 86400, scene.contentType);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ message: "Scene image not found" });
      }
      console.error("Error streaming storyboard scene:", error);
      if (!res.headersSent) res.status(500).json({ message: "Failed to load scene image" });
    }
  });

  app.delete("/api/storyboards/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const deleted = await storage.deleteStoryboard(req.params.id, userId);
      if (!deleted) return res.status(404).json({ message: "Storyboard not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting storyboard:", error);
      res.status(500).json({ message: "Failed to delete storyboard" });
    }
  });

  // ============================================
  // NOVA AI ROADMAP BUILDER  (Builder tier and above)
  // ============================================

  /** Anyone on the team can read the roadmap; only paid tiers can generate one. */
  app.get("/api/projects/:id/roadmap", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isProjectMember((req.user as any).id, req.params.id))) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      const roadmap = await storage.getProjectRoadmap(req.params.id);
      const ent = await getUserEntitlements((req.user as any).id);
      res.json({
        roadmap: roadmap || null,
        canGenerate: ent.aiRoadmap,
        canUpdate: ent.roadmapUpdates,
        canCreateMilestones: ent.aiMilestones,
      });
    } catch (error) {
      console.error("Error fetching roadmap:", error);
      res.status(500).json({ message: "Failed to get roadmap" });
    }
  });

  /*
   * How Nova is required to write for builders.
   *
   * Roadmaps were coming back in analytics-team dialect — "instrument the exact
   * funnel", "baselines by cohort", "D7/D30", "WAU", "match→message rate",
   * "event schema", "A/B framework" — which reads as intimidating rather than
   * helpful to someone on their first project. The schema instructions asked
   * for output that was "concrete and specific" and said nothing at all about
   * vocabulary, so the model optimised for sounding expert. Shared by the
   * roadmap endpoints and next-actions so the whole tab reads in one voice.
   */
  const PLAIN_LANGUAGE_RULES = `HOW TO WRITE — plain words, serious thinking:

The rule is about VOCABULARY, never about ambition. Simplify the words; never
simplify the strategy. A builder reading this should think "that's exactly the
hard thing I need to do next, and I understand every word of it" — not "this is
beginner advice". If you find yourself writing an easier plan to make it
readable, you have misunderstood: write the demanding plan in clear words.

- Explain things clearly, the way a sharp colleague explains something outside your specialty. Assume intelligence and drive; assume no shared insider vocabulary.
- Never use an acronym or metric shorthand on its own. Say "how many people come back a week after signing up" instead of "D7 retention". Applies to D7/D30, DAU/WAU/MAU, MRR, ARR, CAC, LTV, KPI, ICP, CTR, SEO, CRM, SDK, API, A/B.
- Use the IDEAS behind these words freely, but never the words themselves — describe the thing instead: instrument, funnel, cohort, attribution, activation, event schema, feature flag, baseline, segment. For example, instead of "feature flag" write "a switch in the app that turns a feature off without redeploying"; instead of "funnel" write "the steps people go through before they sign up".
- "MVP" is fine; the app uses that label itself.
- Naming real tools is good and concrete. Prefer "(for example Postgres, or Mixpanel)" over vague hand-waving. Just don't assume the builder must buy something.
- Titles: 3-8 plain words naming what the builder will DO. No "+" chaining, no colons, no cryptic asides.
- Descriptions: say what to do, why it matters now, and how they'll know it's done. Use as many sentences as that honestly needs — 2 if it's simple, 5 if it's genuinely hard. Do not truncate substance to hit a length.
- Outcomes: concrete, verifiable finished things. Be specific — include real numbers, thresholds and names where they sharpen it. Clarity matters more than brevity.
- skillsNeeded: name the real capability, plainly and specifically. "A backend developer who has run a database under heavy load" — not "someone comfortable with spreadsheets".
- Encouraging and matter-of-fact. Never condescending, never make the builder feel behind.

MATCH THE BUILDER, NOT A BEGINNER:
- Read WHERE THEY ARE NOW carefully and start from there. If something already exists, do NOT plan to build it — plan the next real problem past it.
- Scale the plan to the stated GOAL. A goal in the tens of thousands of users is mostly a distribution, retention, reliability and cost problem, not a "build the app" problem. Say the uncomfortable things: what has to be true, what will break first, what the realistic constraint is.
- If the goal looks unrealistic from where they are, say so plainly in the summary and lay out the most aggressive credible path anyway. Don't quietly replace their goal with an easier one.

REWRITE PASS: reread every title, description and outcome. Replace any word a smart person outside tech would have to look up — and check you have not made the plan weaker or vaguer than the goal demands.

Do NOT write like this (jargon, and no real thinking):
  title: "Metric wiring + activation baseline (stop guessing)"
  description: "Instrument the exact funnel tied to your success metrics and establish baselines by cohort before changing features."
Also do NOT write like this (clear, but uselessly shallow for a serious goal):
  title: "Set up the code foundation"
  description: "Set up the repo and your first database tables. Done when you can sign in and deploy."
  skillsNeeded: ["someone comfortable with spreadsheets"]
Write like this instead:
  title: "Find one channel that repeats"
  description: "You need one way of reaching builders that still works when you do it the tenth time. Pick two channels and run them properly for two weeks each — enough volume to tell a real result from luck. Track how many people who arrive from each one are still posting a week later, because a channel that brings people who leave will make growth look fine while the product quietly stalls. You're done when one channel brings in new builders at a cost and effort you could sustain for months, and the people it brings behave like the ones who already stay."
  outcomes: ["Two channels each tested with at least 500 visitors", "A per-channel figure for how many people are still active after a week", "One channel you would commit the next month of effort to"]
  skillsNeeded: ["Someone who has run paid or community acquisition before", "A developer who can add tracking to signup links"]`;

  const roadmapSchemaInstructions = (depth: RoadmapDepth = DEFAULT_ROADMAP_DEPTH) => `Respond ONLY with valid JSON (no markdown, no code fences):
{
  "summary": "The overall path from where they actually are to the goal. Name what makes it ambitious and what would make it reachable — this is a plan for getting there, not a verdict on whether to try.",
  "phases": [
    {
      "title": "Short plain-English phase name (3-8 words, what they'll DO)",
      "description": "What happens, why it matters now, and how they'll know it's done. As long as the work honestly needs.",
      "estimatedDuration": "e.g. 2 weeks",
      "outcomes": ["A specific verifiable finished thing, with real numbers where they sharpen it"],
      "skillsNeeded": ["The real capability needed, named plainly and specifically"]
    }
  ]
}
Produce ${ROADMAP_DEPTHS[depth].min}-${ROADMAP_DEPTHS[depth].max} phases ordered from first to last — the builder asked for a ${ROADMAP_DEPTHS[depth].label.toLowerCase()} roadmap, so use the full range rather than folding steps together. Each phase must be concrete and specific to THIS project — no generic startup advice. Ground everything in the project brief AND in where they already are. Phases should build on each other toward the stated goal, and the hard part of the goal must actually be addressed by some phase rather than left to the end.

Every step the builder named in their goal or starting point appears as a phase. If something genuinely has to come later, it becomes a later phase — never dropped, and never quietly replaced with a smaller version of what they asked for. If the goal contains more than one direction, plan them as parallel tracks or as a sequence with the tradeoff stated; do not pick one for them.

If a CODEBASE AUDIT appears in the context, it is the evidence for what already exists and it overrides the board. Never plan a phase around building something the audit says is already built — start the roadmap from what's actually shipped. Do turn the audit's gaps and risks into phases: work it found missing is real remaining work, and a finding like no tests, no CI or a committed credential belongs in an early phase, not left implicit. Where the audit says a capability is only partly built, plan the finishing of it rather than the building of it, and say which part is already done.

${PLAIN_LANGUAGE_RULES}`;

  function parseRoadmapJson(raw: string): { summary: string; phases: any[] } {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    const phases = Array.isArray(parsed.phases) ? parsed.phases : [];
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      phases: phases.slice(0, MAX_ROADMAP_PHASES).map((p: any, i: number) => ({
        title: String(p.title || `Phase ${i + 1}`).slice(0, 200),
        description: String(p.description || ""),
        estimatedDuration: p.estimatedDuration ? String(p.estimatedDuration) : null,
        outcomes: Array.isArray(p.outcomes) ? p.outcomes.map(String).slice(0, 8) : [],
        skillsNeeded: Array.isArray(p.skillsNeeded) ? p.skillsNeeded.map(String).slice(0, 6) : [],
        order: i,
        status: "upcoming" as const,
      })),
    };
  }

  /**
   * Shorthand a first-time builder would have to look up.
   *
   * PLAIN_LANGUAGE_RULES gets titles right consistently, but the model still
   * slips analytics shorthand into descriptions, outcomes and skill lists often
   * enough that builders hit it — measured across repeat generations, not
   * assumed. So the wording is checked rather than trusted.
   */
  const PLAIN_LANGUAGE_JARGON = [
    "D1", "D7", "D30", "DAU", "WAU", "MAU", "MRR", "ARR", "CAC", "LTV", "KPI", "KPIs",
    "ICP", "CTR", "A/B", "cohort", "cohorts", "funnel", "funnels", "instrument",
    "instrumented", "instrumentation", "attribution", "activation", "schema",
    "feature flag", "feature flags", "baseline", "baselines", "segmented",
    "segmentation", "north star", "time-to-value", "north-star",
  ];

  function findJargon(text: string): string[] {
    return PLAIN_LANGUAGE_JARGON.filter((t) =>
      new RegExp(`\\b${t.replace(/\//g, "\\/").replace(/-/g, "-")}\\b`, "i").test(text)
    );
  }

  /**
   * Runs a roadmap prompt and returns the raw JSON text, asking for one
   * rewrite if the model used jargon. A single corrective pass is far more
   * reliable than phrasing the rules harder, and only costs a second call
   * when it's actually needed.
   */
  async function askInPlainLanguage(model: string, system: string, user: string): Promise<string> {
    const messages: any[] = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
    const ask = async (msgs: any[]) =>
      (await openai.chat.completions.create({ model, messages: msgs })).choices[0].message.content || "{}";

    const raw = await ask(messages);
    const jargon = findJargon(raw);
    if (jargon.length === 0) return raw;

    const rewritten = await ask([
      ...messages,
      { role: "assistant", content: raw },
      {
        role: "user",
        content: `That used terms a first-time builder would not know: ${jargon.join(", ")}.

Rewrite the JSON. Keep the same items, the same order and the same meaning — change only the wording, and do not make the plan any weaker, shorter or vaguer. Replace every one of those terms with plain English saying what it actually means. For example "D7 retention" becomes "how many people come back a week after joining", and "an analytics event schema" becomes "a simple list of the actions you want to track".

Respond ONLY with the JSON, in the same shape as before.`,
      },
    ]);

    const remaining = findJargon(rewritten);
    if (remaining.length > 0) {
      // Don't fail the builder's request over wording — surface it instead.
      console.warn("Roadmap still contained jargon after one rewrite: %j", remaining);
    }
    return rewritten;
  }

  /** As above, parsed into phases. */
  async function generateRoadmapJson(model: string, system: string, user: string) {
    return parseRoadmapJson(await askInPlainLanguage(model, system, user));
  }

  /**
   * What already exists, so a re-plan doesn't restart from zero.
   *
   * `startingPoint` is captured when a roadmap is first generated and stored on
   * the roadmap row, but update and rebuild never read it back — so re-planning
   * a mature product produced phases like "set up the repo and your first
   * database tables". Phase status alone isn't enough of a signal either: a
   * freshly generated roadmap has every phase "upcoming", which reads as
   * "nothing is built" even when the app is live.
   *
   * So state the situation explicitly, from the roadmap's starting point plus
   * whatever the project record can evidence.
   */
  function describeCurrentState(input: {
    project: any;
    startingPoint?: string | null;
    members?: number;
    tasks?: any[];
    milestones?: any[];
    phases?: { title: string; status: string }[];
  }): string {
    const { project } = input;
    const lines: string[] = [];

    if (input.startingPoint?.trim()) {
      lines.push(`Where the builder said they were starting from:\n${input.startingPoint.trim()}`);
    }

    const evidence: string[] = [];
    if ((project.techStack || []).length) evidence.push(`Already building with: ${project.techStack.join(", ")}`);
    if (project.repoUrl) evidence.push("A code repository already exists");
    if (project.liveUrl) evidence.push("Something is already deployed and reachable");
    if ((project.mediaUrls || []).length) evidence.push(`${project.mediaUrls.length} screenshot(s) of working product`);
    if (project.businessPlanUrl) evidence.push("A business plan is already written");
    if (input.members && input.members > 1) evidence.push(`${input.members} people on the team`);

    const doneTasks = (input.tasks || []).filter((t) => t.status === "done").length;
    const totalTasks = (input.tasks || []).length;
    if (totalTasks) evidence.push(`${doneTasks} of ${totalTasks} tasks finished`);

    const doneMs = (input.milestones || []).filter((m) => m.status === "completed").length;
    if (input.milestones?.length) evidence.push(`${doneMs} of ${input.milestones.length} milestones hit`);

    const donePhases = (input.phases || []).filter((p) => p.status === "completed");
    if (donePhases.length) evidence.push(`Roadmap phases already completed: ${donePhases.map((p) => p.title).join("; ")}`);

    if (evidence.length) lines.push(`Evidence from the project record:\n${evidence.map((e) => `- ${e}`).join("\n")}`);

    if (!lines.length) return "";
    return `WHERE THEY ARE NOW (do NOT plan work that is already done)\n${lines.join("\n\n")}`;
  }

  /** Generate a fresh roadmap from a stated goal. */
  app.post("/api/projects/:id/roadmap/generate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;

      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== userId) return res.status(403).json({ message: "Only the project owner can build a roadmap" });

      const ent = await requireFeature(res, userId, "aiRoadmap", "The Nova AI Roadmap Builder");
      if (!ent) return;
      if (!(await requireCredits(res, userId, CREDIT_COSTS.roadmapGeneration, "roadmap generation"))) return;

      const { goal, startingPoint, targetDate } = req.body as {
        goal?: string; startingPoint?: string; targetDate?: string;
      };
      const depth = roadmapDepth(req.body?.depth);
      if (!goal?.trim()) return res.status(400).json({ message: "A goal is required" });

      let parsed: { summary: string; phases: any[] };
      try {
        parsed = await generateRoadmapJson(
          modelFor(ent),
          `You are Nova, a project strategist who turns a builder's goal into a concrete, sequenced roadmap. ${coachingDirectiveFor(ent)}\n\n${roadmapSchemaInstructions(depth)}`,
          [
            `PROJECT BRIEF\n${formatProjectBriefForPrompt(project)}`,
            describeCurrentState({
              project,
              startingPoint,
              members: (await storage.getProjectMembers(projectId).catch(() => [])).length,
              tasks: await storage.getProjectKanbanTasks(projectId).catch(() => []),
              milestones: await storage.getProjectMilestones(projectId).catch(() => []),
            }),
            `GOAL\n${goal.trim()}`,
            targetDate ? `TARGET DATE\n${targetDate}` : "",
            /*
             * The first roadmap is exactly where this matters most. A builder
             * who has been shipping for months and only now generates a
             * roadmap would otherwise get a plan that starts from nothing —
             * "set up auth", "build the database" — for work already done.
             */
            await renderLatestAudit(projectId),
          ].filter(Boolean).join("\n\n"),
        );
      } catch (parseErr) {
        console.error("Roadmap parse failed:", parseErr);
        return res.status(502).json({ message: "Nova returned an unreadable roadmap. Please try again." });
      }
      if (parsed.phases.length === 0) {
        return res.status(502).json({ message: "Nova couldn't build a roadmap from that goal. Try describing it differently." });
      }

      const created = await storage.createRoadmap(
        {
          projectId,
          goal: goal.trim(),
          summary: parsed.summary,
          startingPoint: startingPoint?.trim() || null,
          targetDate: targetDate ? new Date(targetDate) : null,
          status: "active",
          generatedOnTier: ent.tier,
        },
        parsed.phases
      );

      await storage.deductCredits(userId, CREDIT_COSTS.roadmapGeneration);
      await storage.logActivity({
        projectId, userId, action: "generated an AI roadmap",
        entityType: "roadmap", entityId: created.id, metadata: { goal: goal.trim(), phases: created.phases.length },
      });

      if (!project.isPrivate) {
        void publishSystemPost({
          authorId: userId,
          projectId,
          postType: SYSTEM_POST_TYPES.roadmapBuilt,
          content: SYSTEM_POST_COPY.roadmapBuilt(project.title, goal.trim(), created.phases.length),
          entityType: "roadmap",
          entityId: created.id,
        });
      }

      res.json({ roadmap: created, creditsCharged: CREDIT_COSTS.roadmapGeneration });
    } catch (error) {
      console.error("Roadmap generation error:", error);
      res.status(500).json({ message: "Failed to generate roadmap" });
    }
  });

  /**
   * Revise an existing roadmap against current progress. Nova sees which
   * phases are done and what tasks/milestones exist, then re-plans the rest.
   */
  app.post("/api/projects/:id/roadmap/update", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;

      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== userId) return res.status(403).json({ message: "Only the project owner can update the roadmap" });

      const ent = await requireFeature(res, userId, "roadmapUpdates", "Nova roadmap updates");
      if (!ent) return;

      const existing = await storage.getProjectRoadmap(projectId);
      if (!existing) return res.status(404).json({ message: "No roadmap to update. Generate one first." });

      if (!(await requireCredits(res, userId, CREDIT_COSTS.roadmapUpdate, "a roadmap update"))) return;

      const { note } = req.body as { note?: string };
      const tasks = await storage.getProjectKanbanTasks(projectId).catch(() => []);
      const milestones = await storage.getProjectMilestones(projectId).catch(() => []);

      const progressSummary = [
        `Phases: ${existing.phases.map((p) => `${p.title} [${p.status}]`).join("; ")}`,
        milestones.length ? `Milestones: ${milestones.map((m) => `${m.title} [${m.status}]`).join("; ")}` : "",
        tasks.length ? `Tasks: ${tasks.length} total, ${tasks.filter((t: any) => t.status === "done").length} done` : "",
        note?.trim() ? `Builder's note: ${note.trim()}` : "",
      ].filter(Boolean).join("\n");

      let parsed: { summary: string; phases: any[] };
      try {
        parsed = await generateRoadmapJson(
          modelFor(ent),
          `You are Nova, revising an existing project roadmap based on real progress. ${coachingDirectiveFor(ent)}

Keep phases that are still correct (preserve their titles so progress isn't lost), and add new phases the project now needs. Merge two phases only when they have become the same work; a phase the builder still wants stays even if it has to move later. Mark phases already finished as completed.\n\n${roadmapSchemaInstructions(depthForRevision(existing.phases.length))}
Additionally, each phase may include "status": one of "upcoming", "in-progress", "completed".`,
          [
            `PROJECT BRIEF\n${formatProjectBriefForPrompt(project)}`,
            `GOAL\n${existing.goal}`,
            describeCurrentState({
              project,
              startingPoint: existing.startingPoint,
              tasks, milestones, phases: existing.phases,
            }),
            `CURRENT ROADMAP (v${existing.version})\n${existing.summary || ""}`,
            `CURRENT PROGRESS\n${progressSummary}`,
            // Re-planning without knowing what's actually shipped produces a
            // roadmap that re-plans finished work.
            await renderLatestAudit(projectId),
          ].filter(Boolean).join("\n\n"),
        );
      } catch (parseErr) {
        console.error("Roadmap update parse failed:", parseErr);
        return res.status(502).json({ message: "Nova returned an unreadable roadmap. Please try again." });
      }
      if (parsed.phases.length === 0) {
        return res.status(502).json({ message: "Nova couldn't revise the roadmap. Please try again." });
      }

      // Carry forward status for phases Nova kept by title, so completed work
      // isn't silently reset to "upcoming".
      const priorStatusByTitle = new Map(
        existing.phases.map((p) => [p.title.trim().toLowerCase(), p.status])
      );
      const phases = parsed.phases.map((p: any) => ({
        ...p,
        status: p.status && ["upcoming", "in-progress", "completed"].includes(p.status)
          ? p.status
          : priorStatusByTitle.get(String(p.title).trim().toLowerCase()) || "upcoming",
      }));

      await storage.replaceRoadmapPhases(existing.id, phases);
      const updated = await storage.updateRoadmap(existing.id, {
        summary: parsed.summary || existing.summary,
        version: existing.version + 1,
      });

      await storage.deductCredits(userId, CREDIT_COSTS.roadmapUpdate);
      await storage.logActivity({
        projectId, userId, action: "updated the AI roadmap",
        entityType: "roadmap", entityId: existing.id, metadata: { version: updated.version },
      });

      const fresh = await storage.getProjectRoadmap(projectId);
      res.json({ roadmap: fresh, creditsCharged: CREDIT_COSTS.roadmapUpdate });
    } catch (error) {
      console.error("Roadmap update error:", error);
      res.status(500).json({ message: "Failed to update roadmap" });
    }
  });

  /**
   * "What should I do next?" — Nova reads the roadmap, milestones and tasks
   * and ranks the three highest-impact actions to take right now.
   */
  app.post("/api/projects/:id/roadmap/next-actions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;

      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (!(await isProjectMember(userId, projectId))) return res.status(403).json({ message: "Unauthorized" });

      const ent = await requireFeature(res, userId, "aiRoadmap", "Next-action recommendations");
      if (!ent) return;

      const roadmap = await storage.getProjectRoadmap(projectId);
      if (!roadmap) return res.status(404).json({ message: "Build a roadmap first, then Nova can tell you what's next." });

      if (!(await requireCredits(res, userId, CREDIT_COSTS.nextActions, "next-action recommendations"))) return;

      const [tasks, milestones] = await Promise.all([
        storage.getProjectKanbanTasks(projectId).catch(() => []),
        storage.getProjectMilestones(projectId).catch(() => []),
      ]);
      const openTasks = tasks.filter((t: any) => t.status !== "done");

      const nextActionsRaw = await askInPlainLanguage(
        modelFor(ent),
        `You are Nova, telling a builder exactly what to do next. ${coachingDirectiveFor(ent)}

Pick the THREE highest-impact actions available right now. Judge impact by what unblocks the most downstream work or most reduces the biggest risk — not by what's easiest. If the obvious next step is wrong, say so and give the right one.

Each action must be something they could start today, not a vague theme.

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "reasoning": "1-2 sentences on where the project actually stands right now.",
  "actions": [
    {
      "title": "Short imperative, e.g. 'Interview 5 students about study habits'",
      "why": "1-2 sentences on the impact of doing this now.",
      "effort": "quick" | "medium" | "heavy",
      "impact": "high" | "medium",
      "relatedPhase": "the roadmap phase title this belongs to, or null"
    }
  ]
}
Exactly 3 actions, ordered most important first.

If a CODEBASE AUDIT appears below, it is the evidence for what exists. Never propose building something it says is already built, and prefer the gaps and risks it found over anything the board merely claims.

${PLAIN_LANGUAGE_RULES}`,
        [
          `PROJECT BRIEF\n${formatProjectBriefForPrompt(project)}`,
          `GOAL\n${roadmap.goal}`,
          `ROADMAP (v${roadmap.version})\n${roadmap.phases.map((p) => `- ${p.title} [${p.status}] ${p.description || ""}`).join("\n")}`,
          `MILESTONES\n${milestones.length ? milestones.map((m) => `- ${m.title} [${m.status}]`).join("\n") : "none"}`,
          `OPEN TASKS (${openTasks.length} of ${tasks.length})\n${openTasks.slice(0, 25).map((t: any) => `- ${t.title} [${t.priority}]`).join("\n") || "none"}`,
          // "What should I do next?" is unanswerable without knowing what's
          // already built, and only the audit knows that.
          await renderLatestAudit(projectId),
        ].join("\n\n"),
      );

      let parsed: any;
      try {
        const match = nextActionsRaw.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(match ? match[0] : nextActionsRaw);
      } catch (parseErr) {
        console.error("Next actions parse failed:", parseErr);
        return res.status(502).json({ message: "Nova's answer came back unreadable. Try again." });
      }

      const actions = (Array.isArray(parsed.actions) ? parsed.actions : []).slice(0, 3).map((a: any) => ({
        title: String(a?.title || "").slice(0, 200),
        why: String(a?.why || "").slice(0, 500),
        effort: ["quick", "medium", "heavy"].includes(a?.effort) ? a.effort : "medium",
        impact: ["high", "medium"].includes(a?.impact) ? a.impact : "high",
        relatedPhase: a?.relatedPhase ? String(a.relatedPhase).slice(0, 200) : null,
      })).filter((a: any) => a.title);

      if (actions.length === 0) {
        return res.status(502).json({ message: "Nova couldn't work out what's next. Try again." });
      }

      await storage.deductCredits(userId, CREDIT_COSTS.nextActions);
      res.json({
        reasoning: String(parsed.reasoning || ""),
        actions,
        creditsCharged: CREDIT_COSTS.nextActions,
      });
    } catch (error) {
      console.error("Next actions error:", error);
      res.status(500).json({ message: "Failed to work out next actions" });
    }
  });

  /**
   * Quotes the cost of a full rebuild before the user commits, so an 8-15
   * credit charge is never a surprise.
   */
  app.get("/api/projects/:id/roadmap/rebuild-quote", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isProjectMember(userId, req.params.id))) return res.status(403).json({ message: "Unauthorized" });

      const [roadmap, milestones, tasks] = await Promise.all([
        storage.getProjectRoadmap(req.params.id),
        storage.getProjectMilestones(req.params.id).catch(() => []),
        storage.getProjectKanbanTasks(req.params.id).catch(() => []),
      ]);

      const counts = {
        phases: roadmap?.phases.length || 0,
        milestones: milestones.length,
        tasks: tasks.length,
      };
      res.json({
        cost: roadmapRebuildCost(counts),
        min: CREDIT_COSTS.roadmapRebuildMin,
        max: CREDIT_COSTS.roadmapRebuildMax,
        counts,
        hasRoadmap: !!roadmap,
      });
    } catch (error) {
      console.error("Rebuild quote error:", error);
      res.status(500).json({ message: "Failed to quote a rebuild" });
    }
  });

  /**
   * Full roadmap rebuild. Where /roadmap/update revises the remaining phases,
   * this re-plans from scratch against what the project has become —
   * restructuring phases, resequencing milestones, and re-prioritising tasks.
   * For when the project changed direction, not just progressed.
   */
  app.post("/api/projects/:id/roadmap/rebuild", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;

      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== userId) return res.status(403).json({ message: "Only the project owner can rebuild the roadmap" });

      const ent = await requireFeature(res, userId, "roadmapUpdates", "Roadmap rebuilds");
      if (!ent) return;

      const existing = await storage.getProjectRoadmap(projectId);
      if (!existing) return res.status(404).json({ message: "No roadmap to rebuild. Generate one first." });

      const [milestones, tasks] = await Promise.all([
        storage.getProjectMilestones(projectId).catch(() => []),
        storage.getProjectKanbanTasks(projectId).catch(() => []),
      ]);

      const cost = roadmapRebuildCost({
        phases: existing.phases.length,
        milestones: milestones.length,
        tasks: tasks.length,
      });
      if (!(await requireCredits(res, userId, cost, "a roadmap rebuild"))) return;

      const { whatChanged, newGoal, startingPoint: newStartingPoint } = req.body as {
        whatChanged?: string; newGoal?: string; startingPoint?: string;
      };
      const goal = newGoal?.trim() || existing.goal;
      const memberCount = (await storage.getProjectMembers(projectId).catch(() => [])).length;

      const rebuildRaw = await askInPlainLanguage(
        modelFor(ent),
        `You are Nova, rebuilding a project roadmap from scratch because the project has changed. ${coachingDirectiveFor(ent)}

This is NOT an incremental revision. Re-plan the whole path to the goal against what the project actually is now. Where a phase no longer fits the goal, say so in the summary and explain where that work now belongs — reordered, merged into a later phase, or set aside for the builder to decide — rather than silently removing it. Genuinely completed work should be preserved as completed phases.

Also resequence the milestones and re-prioritise the open tasks to match the new plan.

${roadmapSchemaInstructions(req.body?.depth ? roadmapDepth(req.body.depth) : depthForRevision(existing.phases.length))}
Each phase may also include "status": "upcoming" | "in-progress" | "completed".

Additionally include:
  "milestoneOrder": [ { "title": "<existing milestone title>", "order": <number>, "status": "planned" | "in-progress" | "completed" } ],
  "taskPriorities": [ { "title": "<existing task title>", "priority": "low" | "medium" | "high" } ],
  "changeSummary": "2-3 sentences on what you restructured and why."`,
        [
          `PROJECT BRIEF (current)\n${formatProjectBriefForPrompt(project)}`,
          `GOAL\n${goal}`,
          describeCurrentState({
            project,
            startingPoint: newStartingPoint?.trim() || existing.startingPoint,
            members: memberCount,
            tasks, milestones, phases: existing.phases,
          }),
          whatChanged?.trim() ? `WHAT CHANGED\n${whatChanged.trim()}` : "",
          `PREVIOUS ROADMAP (v${existing.version})\n${existing.summary || ""}\n${existing.phases.map((p) => `- ${p.title} [${p.status}]`).join("\n")}`,
          `EXISTING MILESTONES\n${milestones.map((m) => `- ${m.title} [${m.status}]`).join("\n") || "none"}`,
          `EXISTING TASKS\n${tasks.map((t: any) => `- ${t.title} [${t.status}/${t.priority}]`).join("\n") || "none"}`,
          // A rebuild that ignores what's shipped re-plans work already done.
          await renderLatestAudit(projectId),
        ].filter(Boolean).join("\n\n"),
      );

      let parsed: any;
      try {
        const match = rebuildRaw.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(match ? match[0] : rebuildRaw);
      } catch (parseErr) {
        console.error("Roadmap rebuild parse failed:", parseErr);
        return res.status(502).json({ message: "Nova's rebuild came back unreadable. Try again." });
      }

      const phases = parseRoadmapJson(JSON.stringify(parsed)).phases.map((p: any) => ({
        ...p,
        status: ["upcoming", "in-progress", "completed"].includes(parsed.phases?.find((x: any) => x.title === p.title)?.status)
          ? parsed.phases.find((x: any) => x.title === p.title).status
          : "upcoming",
      }));
      if (phases.length === 0) {
        return res.status(502).json({ message: "Nova couldn't rebuild the roadmap. Try again." });
      }

      await storage.replaceRoadmapPhases(existing.id, phases);
      const updated = await storage.updateRoadmap(existing.id, {
        goal,
        summary: parsed.summary || existing.summary,
        version: existing.version + 1,
        // Carry the starting point forward (or take the builder's revised one),
        // so the next rebuild still knows what's already built.
        startingPoint: newStartingPoint?.trim() || existing.startingPoint,
      });

      // Resequence milestones by title match.
      let milestonesUpdated = 0;
      for (const m of Array.isArray(parsed.milestoneOrder) ? parsed.milestoneOrder : []) {
        const target = milestones.find((x) => x.title.trim().toLowerCase() === String(m?.title || "").trim().toLowerCase());
        if (!target) continue;
        const patch: any = {};
        if (Number.isFinite(m.order)) patch.order = Number(m.order);
        if (["planned", "in-progress", "completed"].includes(m.status)) patch.status = m.status;
        if (Object.keys(patch).length === 0) continue;
        await storage.updateMilestone(target.id, patch).catch(() => {});
        milestonesUpdated++;
      }

      // Re-prioritise open tasks by title match.
      let tasksUpdated = 0;
      for (const t of Array.isArray(parsed.taskPriorities) ? parsed.taskPriorities : []) {
        const target = tasks.find((x: any) => x.title.trim().toLowerCase() === String(t?.title || "").trim().toLowerCase());
        if (!target || !["low", "medium", "high"].includes(t.priority)) continue;
        await storage.updateKanbanTask(target.id, { priority: t.priority }).catch(() => {});
        tasksUpdated++;
      }

      await storage.deductCredits(userId, cost);
      await storage.logActivity({
        projectId, userId, action: "rebuilt the AI roadmap",
        entityType: "roadmap", entityId: existing.id,
        metadata: { version: updated.version, phases: phases.length, milestonesUpdated, tasksUpdated },
      });

      const fresh = await storage.getProjectRoadmap(projectId);
      res.json({
        roadmap: fresh,
        changeSummary: String(parsed.changeSummary || ""),
        milestonesUpdated,
        tasksUpdated,
        creditsCharged: cost,
      });
    } catch (error) {
      console.error("Roadmap rebuild error:", error);
      res.status(500).json({ message: "Failed to rebuild the roadmap" });
    }
  });

  /**
   * Owner edits a phase by hand.
   *
   * Nova's plan is a starting point, not scripture — the builder knows things
   * Nova doesn't, and a phase they can't reword is a phase they stop trusting.
   * So the whole phase is editable here, not just its status.
   */
  app.patch("/api/roadmap-phases/:phaseId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const phase = await storage.getRoadmapPhase(req.params.phaseId);
      if (!phase) return res.status(404).json({ message: "Phase not found" });

      const project = await storage.getProject(phase.projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== userId) {
        return res.status(403).json({ message: "Only the project owner can edit the roadmap" });
      }

      const body = req.body as Record<string, unknown>;
      const patch: Record<string, unknown> = {};

      if (body.status !== undefined) {
        if (!["upcoming", "in-progress", "completed"].includes(String(body.status))) {
          return res.status(400).json({ message: "status must be upcoming, in-progress, or completed" });
        }
        patch.status = body.status;
      }
      if (body.title !== undefined) {
        const title = String(body.title).trim().slice(0, 200);
        if (!title) return res.status(400).json({ message: "A phase needs a title" });
        patch.title = title;
      }
      if (body.description !== undefined) {
        patch.description = String(body.description ?? "").trim().slice(0, 2000) || null;
      }
      if (body.estimatedDuration !== undefined) {
        patch.estimatedDuration = String(body.estimatedDuration ?? "").trim().slice(0, 80) || null;
      }
      if (Array.isArray(body.outcomes)) {
        patch.outcomes = body.outcomes
          .map((o) => String(o ?? "").trim().slice(0, 300))
          .filter(Boolean)
          .slice(0, 12);
      }
      if (Array.isArray(body.skillsNeeded)) {
        patch.skillsNeeded = body.skillsNeeded
          .map((s) => String(s ?? "").trim().slice(0, 60))
          .filter(Boolean)
          .slice(0, 12);
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ message: "Nothing to update" });
      }

      const updated = await storage.updateRoadmapPhase(req.params.phaseId, patch as any);
      await storage.logActivity({
        projectId: phase.projectId, userId,
        action: patch.status && Object.keys(patch).length === 1 ? "updated a roadmap phase's status" : "edited a roadmap phase",
        entityType: "roadmap", entityId: updated.id, metadata: { title: updated.title },
      });
      res.json(updated);
    } catch (error) {
      console.error("Phase update error:", error);
      res.status(500).json({ message: "Failed to update phase" });
    }
  });

  /** Turn a roadmap phase into a real project milestone (Builder and above). */
  app.post("/api/roadmap-phases/:phaseId/create-milestone", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const ent = await requireFeature(res, userId, "aiMilestones", "AI milestone creation");
      if (!ent) return;

      const { projectId } = req.body as { projectId?: string };
      if (!projectId) return res.status(400).json({ message: "projectId is required" });

      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== userId) return res.status(403).json({ message: "Only the project owner can do that" });

      const roadmap = await storage.getProjectRoadmap(projectId);
      const phase = roadmap?.phases.find((p) => p.id === req.params.phaseId);
      if (!phase) return res.status(404).json({ message: "Phase not found on this project's roadmap" });
      if (phase.milestoneId) return res.status(409).json({ message: "This phase already has a milestone" });

      const existingMilestones = await storage.getProjectMilestones(projectId);
      const milestone = await storage.createMilestone({
        projectId,
        title: phase.title,
        description: phase.description || null,
        status: "planned",
        order: existingMilestones.length,
      } as any);

      await storage.updateRoadmapPhase(phase.id, { milestoneId: milestone.id });
      await storage.logActivity({
        projectId, userId, action: "created a milestone from the roadmap",
        entityType: "milestone", entityId: milestone.id, metadata: { title: milestone.title },
      });

      res.json(milestone);
    } catch (error) {
      console.error("Create milestone from phase error:", error);
      res.status(500).json({ message: "Failed to create milestone" });
    }
  });

  // ============================================
  // AI PROJECT HEALTH CHECKS  (Pro tier)
  // ============================================

  app.get("/api/projects/:id/health-checks", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isProjectMember(userId, req.params.id))) return res.status(403).json({ message: "Unauthorized" });
      const ent = await getUserEntitlements(userId);
      const [checks, feedback] = await Promise.all([
        storage.getHealthChecks(req.params.id),
        storage.getHealthFindingFeedback(req.params.id),
      ]);
      res.json({ checks, feedback, canRun: ent.projectHealthChecks });
    } catch (error) {
      console.error("Error fetching health checks:", error);
      res.status(500).json({ message: "Failed to get health checks" });
    }
  });

  /**
   * The builder pushes back on a finding.
   *
   * An assessment the user can't argue with is one they stop reading. The
   * reason is stored against the finding's area and replayed into every later
   * check, so Nova either drops the point or engages with the objection
   * instead of repeating itself.
   */
  app.post("/api/projects/:id/health-findings/feedback", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;
      if (!(await isProjectMember(userId, projectId))) return res.status(403).json({ message: "Unauthorized" });

      const { checkId, area, finding, stance, reason } = req.body as Record<string, string>;
      const STANCES = ["disagree", "already-handled", "not-a-priority"];
      if (!area?.trim()) return res.status(400).json({ message: "Which finding is this about?" });
      if (!STANCES.includes(stance)) {
        return res.status(400).json({ message: `stance must be one of ${STANCES.join(", ")}` });
      }
      if (!reason?.trim()) {
        return res.status(400).json({ message: "Tell Nova why — that's the part it remembers." });
      }

      const saved = await storage.createHealthFindingFeedback({
        projectId,
        checkId: checkId || null,
        userId,
        area: area.trim().toLowerCase().slice(0, 120),
        finding: (finding || "").slice(0, 1000) || null,
        stance: stance as any,
        reason: reason.trim().slice(0, 1000),
      } as any);

      res.json(saved);
    } catch (error) {
      console.error("Health finding feedback error:", error);
      res.status(500).json({ message: "Failed to save your response" });
    }
  });

  app.delete("/api/health-findings/feedback/:feedbackId", isAuthenticated, async (req: any, res) => {
    try {
      const removed = await storage.deleteHealthFindingFeedback(req.params.feedbackId, (req.user as any).id);
      if (!removed) return res.status(404).json({ message: "Not found" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to remove your response" });
    }
  });

  app.post("/api/projects/:id/health-check", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;

      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (!(await isProjectMember(userId, projectId))) return res.status(403).json({ message: "Unauthorized" });

      const ent = await requireFeature(res, userId, "projectHealthChecks", "AI project health checks");
      if (!ent) return;
      if (!(await requireCredits(res, userId, CREDIT_COSTS.healthCheck, "a health check"))) return;

      const [tasks, milestones, members, roadmap, feedback, history, banked, auditText] = await Promise.all([
        storage.getProjectKanbanTasks(projectId).catch(() => []),
        storage.getProjectMilestones(projectId).catch(() => []),
        storage.getProjectMembers(projectId).catch(() => []),
        storage.getProjectRoadmap(projectId).catch(() => undefined),
        storage.getHealthFindingFeedback(projectId).catch(() => []),
        storage.getProjectTaskCompletions(projectId, 40).catch(() => []),
        storage.getUserTaskStats(userId).catch(() => undefined),
        renderLatestAudit(projectId),
      ]);

      const doneTasks = tasks.filter((t: any) => t.status === "done").length;
      const context = [
        `PROJECT BRIEF\n${formatProjectBriefForPrompt(project)}`,
        `TEAM\n${members.length} of ${project.teamSize ?? "?"} seats filled`,
        /*
         * The board is working state, not the execution record. Builders clear
         * finished cards, and reading only the live board made Nova score a
         * project with real throughput as having shipped nothing. Give it the
         * completion history so "no evidence of execution" is a conclusion it
         * can only reach when that's actually true.
         */
        [
          `TASKS COMPLETED ON THIS PROJECT: ${history.length}. This is the real figure — it includes finished cards the builder has since cleared off the board.`,
          history.length
            ? `Completion dates, newest first: ${history.slice(0, 12).map((c) => `${c.title} (${new Date(c.completedAt).toISOString().slice(0, 10)})`).join("; ")}`
            : "Nothing has ever been completed on this project.",
          `CURRENT BOARD: ${tasks.length} cards, ${doneTasks} of them still sitting in the done column. The done column shows what hasn't been tidied away yet; it is NOT the completion count.`,
          `This builder has completed ${banked?.tasksCompleted ?? 0} tasks across all their projects.`,
          history.length
            ? "Because work has demonstrably been completed, do not claim or imply that nothing is done, that no tasks have been finished, or that there is no evidence of execution. Judge momentum on the completion dates above — how many, how recently, and whether the pace is holding."
            : null,
        ].filter(Boolean).join("\n"),
        `MILESTONES\n${milestones.length ? milestones.map((m) => `${m.title} [${m.status}]`).join("; ") : "none"}`,
        roadmap ? `ROADMAP\nGoal: ${roadmap.goal}\nPhases: ${roadmap.phases.map((p) => `${p.title} [${p.status}]`).join("; ")}` : "ROADMAP\nnone",
        `AGE\nCreated ${Math.max(0, Math.round((Date.now() - new Date(project.createdAt).getTime()) / 86400000))} days ago`,
        auditText,
        feedback.length
          ? `WHAT THE BUILDER TOLD YOU LAST TIME\n${feedback
              .slice(0, 12)
              .map((f) => `- On "${f.area}" they said [${f.stance}]: ${f.reason}`)
              .join("\n")}`
          : null,
      ].filter(Boolean).join("\n\n");

      const completion = await openai.chat.completions.create({
        model: modelFor(ent),
        messages: [
          {
            role: "system",
            content: `You are Nova, assessing the health of a project honestly. Be direct about risks — a falsely reassuring assessment is useless.

If the context includes WHAT THE BUILDER TOLD YOU LAST TIME, treat it as information you did not previously have. Where they said a concern was already handled or not a priority, do not raise it again in the same form: either drop it, or — if the project data still contradicts them — say plainly that you're raising it anyway and why. Never repeat a finding verbatim after it has been answered; that's how a builder learns to ignore you.

Every recommendation must be something that can be acted on inside this project: a task to create, a milestone to add or reword, a roadmap phase to change, a scope list to cut, or a brief field to rewrite. Avoid advice that lives entirely outside the tool.

If a CODEBASE AUDIT appears in the context, treat it as the evidence for what is actually built and score accordingly. A project whose audit shows a working product is not "stalled" because its board is untidy — say the board is out of date instead. Equally, do not credit a milestone the audit says is not started. Cite the audit when it's what changed your assessment.

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "score": 0-100,
  "status": "on-track" | "at-risk" | "stalled",
  "summary": "2-3 sentences on where this project actually stands.",
  "findings": [
    { "area": "e.g. Scope, Team, Momentum, Clarity", "severity": "low" | "medium" | "high", "finding": "What you observed.", "recommendation": "The specific next action.", "fixable": true }
  ]
}
Set "fixable" to true when you could carry out the recommendation yourself by editing tasks, milestones, roadmap phases, scope, or the project brief — false when it needs the builder to go and do something in the real world (talk to users, pick a channel, ship).
Produce 3-6 findings.`,
          },
          { role: "user", content: context },
        ],
      });

      let parsed: any;
      try {
        const raw = completion.choices[0].message.content || "{}";
        const match = raw.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(match ? match[0] : raw);
      } catch (parseErr) {
        console.error("Health check parse failed:", parseErr);
        return res.status(502).json({ message: "Nova returned an unreadable assessment. Please try again." });
      }

      const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
      const status = ["on-track", "at-risk", "stalled"].includes(parsed.status) ? parsed.status : "at-risk";
      const check = await storage.createHealthCheck({
        projectId,
        score,
        status,
        summary: String(parsed.summary || "No summary provided."),
        findings: Array.isArray(parsed.findings) ? parsed.findings.slice(0, 8) : [],
      });

      await storage.deductCredits(userId, CREDIT_COSTS.healthCheck);
      res.json({ check, creditsCharged: CREDIT_COSTS.healthCheck });
    } catch (error) {
      console.error("Health check error:", error);
      res.status(500).json({ message: "Failed to run health check" });
    }
  });

  /**
   * "Nova, do it."
   *
   * A recommendation the builder has to re-type by hand is a recommendation
   * they mostly don't act on. This takes one finding and has Nova carry it out
   * against the real project — rewording a roadmap phase, cutting the MVP
   * list, adding the milestone it says is missing — then reports back exactly
   * what changed.
   */
  app.post("/api/projects/:id/health-check/apply", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;

      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== userId) {
        return res.status(403).json({ message: "Only the project owner can let Nova make changes" });
      }

      const ent = await requireFeature(res, userId, "projectHealthChecks", "AI project health checks");
      if (!ent) return;

      const { checkId, findingIndex, note } = req.body as { checkId?: string; findingIndex?: number; note?: string };
      const checks = await storage.getHealthChecks(projectId);
      const check = checkId ? checks.find((c) => c.id === checkId) : checks[0];
      if (!check) return res.status(404).json({ message: "Run a health check first." });

      const findings = (check.findings as any[]) || [];
      const finding = findings[Number(findingIndex)];
      if (!finding) return res.status(400).json({ message: "That finding isn't on this check." });

      if (!(await requireCredits(res, userId, CREDIT_COSTS.healthFix, "Nova applying a fix"))) return;

      const state = await buildOperableProjectState(projectId);

      const completion = await openai.chat.completions.create({
        model: modelFor(ent),
        messages: [
          {
            role: "system",
            content: `You are Nova, carrying out one of your own recommendations on a builder's project. ${coachingDirectiveFor(ent)}

You are not advising any more — you are editing. Make the smallest set of concrete changes that genuinely addresses the finding. Prefer editing what already exists over piling on new items: if the finding is that the MVP is too big, cut the MVP list; if a roadmap phase is vague, reword that phase and give it real outcomes; if momentum is the problem, add a handful of specific tasks that could be finished this week.

Never invent an id. Never touch anything the finding didn't call for. If part of the recommendation can only be done by the builder in the real world (running interviews, choosing a channel), leave it out of the operations and say so in "note".

${OPERATION_SCHEMA_INSTRUCTIONS}

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "operations": [ ... ],
  "note": "1-2 sentences: what you changed and what's still left to the builder."
}`,
          },
          {
            role: "user",
            content: [
              `THE FINDING TO ACT ON\nArea: ${finding.area || "general"}\nSeverity: ${finding.severity || "unknown"}\nObservation: ${finding.finding || ""}\nRecommendation: ${finding.recommendation || ""}`,
              note?.trim() ? `THE BUILDER ADDED\n${note.trim().slice(0, 600)}` : null,
              `CURRENT PROJECT STATE (use these ids)\n${state}`,
            ].filter(Boolean).join("\n\n"),
          },
        ],
      });

      let parsed: any;
      try {
        const raw = completion.choices[0].message.content || "{}";
        const match = raw.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(match ? match[0] : raw);
      } catch (parseErr) {
        console.error("Health fix parse failed:", parseErr);
        return res.status(502).json({ message: "Nova returned an unreadable plan. Please try again." });
      }

      const { changes, skipped } = await applyProjectOperations(projectId, userId, parsed.operations, {
        canEditMilestones: ent.aiMilestones,
        canEditRoadmap: ent.roadmapUpdates,
      });

      // Nothing landed means nothing to charge for.
      if (!changes.length) {
        return res.status(422).json({
          message: "Nova couldn't turn that finding into a change it's able to make. This one's on you — or try re-running the check.",
          skipped,
        });
      }

      await storage.deductCredits(userId, CREDIT_COSTS.healthFix);
      res.json({
        changes,
        skipped,
        note: String(parsed.note || "").slice(0, 800),
        creditsCharged: CREDIT_COSTS.healthFix,
      });
    } catch (error) {
      console.error("Health fix error:", error);
      res.status(500).json({ message: "Nova couldn't apply that fix" });
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
      const userId = (req.user as any).id;
      // Read the prior state first so re-saving an already-completed milestone
      // doesn't post to the feed a second time.
      const before = await storage.getMilestone(req.params.id);
      if (!before) return res.status(404).json({ message: "Milestone not found" });
      if (!(await isProjectMember(userId, before.projectId))) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      // Whitelisted so a client can't move a milestone to another project or
      // rewrite its id, and so the title/description/date are all editable
      // rather than status alone.
      const body = req.body as Record<string, unknown>;
      const patch: Record<string, unknown> = {};

      if (body.title !== undefined) {
        const title = String(body.title).trim().slice(0, 200);
        if (!title) return res.status(400).json({ message: "A milestone needs a title" });
        patch.title = title;
      }
      if (body.description !== undefined) {
        patch.description = String(body.description ?? "").trim().slice(0, 2000) || null;
      }
      if (body.status !== undefined) {
        if (!["planned", "in-progress", "completed"].includes(String(body.status))) {
          return res.status(400).json({ message: "status must be planned, in-progress, or completed" });
        }
        patch.status = body.status;
      }
      if (body.targetDate !== undefined) {
        if (!body.targetDate) {
          patch.targetDate = null;
        } else {
          const parsed = new Date(String(body.targetDate));
          if (isNaN(parsed.getTime())) return res.status(400).json({ message: "That target date isn't a valid date" });
          patch.targetDate = parsed;
        }
      }
      if (body.order !== undefined && Number.isFinite(Number(body.order))) {
        patch.order = Number(body.order);
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ message: "Nothing to update" });
      }

      const milestone = await storage.updateMilestone(req.params.id, patch as any);

      if (patch.status === "completed" && before?.status !== "completed") {
        await storage.logActivity({ projectId: milestone.projectId, userId, action: "completed milestone", entityType: "milestone", entityId: milestone.id, metadata: { title: milestone.title } });

        const project = await storage.getProject(milestone.projectId);
        if (project && !project.isPrivate) {
          void publishSystemPost({
            authorId: userId,
            projectId: milestone.projectId,
            postType: SYSTEM_POST_TYPES.milestoneCompleted,
            content: SYSTEM_POST_COPY.milestoneCompleted(project.title, milestone.title),
            entityType: "milestone",
            entityId: milestone.id,
          });
        }
      }
      res.json(milestone);
    } catch (error) { res.status(500).json({ message: "Failed to update milestone" }); }
  });

  app.delete("/api/milestones/:id", isAuthenticated, async (req: any, res) => {
    try {
      const milestone = await storage.getMilestone(req.params.id);
      if (!milestone) return res.status(404).json({ message: "Milestone not found" });
      if (!(await isProjectMember((req.user as any).id, milestone.projectId))) {
        return res.status(403).json({ message: "Unauthorized" });
      }
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
  // Check-ins now live in server/check-in-routes.ts — the loop needs a public
  // permalink, validation and week identity, which outgrew two inline handlers.

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
          content: `Project: "${project?.title}"\nDescription: ${project?.description}\n\nTask Status: ${JSON.stringify(taskSummary)}\nRecent Tasks: ${JSON.stringify(tasks.slice(0, 10).map(t => ({ title: t.title, status: t.status, priority: t.priority })))}\nMilestones: ${JSON.stringify(milestones.map(m => ({ title: m.title, status: m.status, targetDate: m.targetDate })))}\nRecent Check-ins: ${JSON.stringify(checkIns.slice(0, 5).map(ci => ({ goal: ci.goal, proof: ci.proof, blocker: ci.blocker, nextStep: ci.nextStep })))}\nRecent Activity: ${JSON.stringify(activity.slice(0, 10).map(a => a.action))}\n\nGenerate a progress summary covering: accomplishments, current focus, blockers, and next steps.`
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

  app.post("/api/messages/:userId", isAuthenticated, rateLimit("message"), async (req: any, res) => {
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

  /**
   * Retired: the donation route that paid creators the moment a card cleared.
   *
   * It used a Stripe destination charge, so money reached the creator's
   * connected account instantly — a hole straight around the escrow the
   * backing flow exists to provide. Kept as an explicit 410 rather than
   * deleted so an old client, a cached page or a bookmarked call gets told
   * what happened instead of a bare 404.
   *
   * Historic `donations` rows are untouched; they still count toward the
   * public totals and reputation.
   */
  app.post("/api/projects/:id/donate-checkout", isAuthenticated, async (req: any, res) => {
    res.status(410).json({
      message: "Direct donations have moved to backing, where funds are held until the project is reviewed.",
      replacement: `/api/projects/${req.params.id}/backing/checkout`,
    });
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
      const ent = await getUserEntitlements(userId);
      const privateProjectsUsed = await storage.countPrivateProjects(userId);
      res.json({
        ...sub,
        // JSON has no Infinity; the client treats -1 as unlimited.
        creditsLimit: sub.creditsLimit === Infinity ? -1 : sub.creditsLimit,
        creditsRemaining: sub.creditsRemaining === Infinity ? -1 : sub.creditsRemaining,
        unlimited: sub.creditsLimit === Infinity,
        fairUseCap: sub.creditsLimit === Infinity ? FAIR_USE_MONTHLY_CAP : null,
        entitlements: {
          ...ent,
          credits: ent.credits === Infinity ? -1 : ent.credits,
          privateProjects: ent.privateProjects === Infinity ? -1 : ent.privateProjects,
        },
        privateProjectsUsed,
        creditCosts: CREDIT_COSTS,
      });
    } catch (error) {
      console.error("Error fetching subscription:", error);
      res.status(500).json({ message: "Failed to fetch subscription" });
    }
  });

  /**
   * Plan catalog. All presentation (names, copy, bullets, prices) comes from
   * shared/plans.ts so the pricing page renders correctly even when Stripe
   * isn't configured — only `priceId` needs Stripe, and without it the page
   * shows the plan but can't start checkout.
   */
  app.get("/api/plans", async (_req, res) => {
    const priceIdByTier = await getPriceIdsByTier();

    const plans = TIER_IDS.map((tier) => {
      const p = PLAN_PRESENTATION[tier];
      const ent = ENTITLEMENTS[tier];
      return {
        id: tier,
        tier,
        stage: p.stage,
        name: p.name,
        promise: p.promise,
        headline: p.headline,
        pitch: p.pitch,
        price: p.priceMonthly,
        priceId: priceIdByTier.get(tier) || null,
        cta: p.cta,
        featured: p.featured || false,
        footnote: p.footnote || null,
        highlights: p.highlights,
        credits: ent.credits === Infinity ? -1 : ent.credits,
        privateProjects: ent.privateProjects === Infinity ? -1 : ent.privateProjects,
        checkoutAvailable: tier === "free" || priceIdByTier.has(tier),
      };
    });

    res.json({
      plans,
      comparison: COMPARISON_ROWS,
      fairUseNotice: FAIR_USE_NOTICE,
      creditCosts: CREDIT_COSTS,
      // Signals to the pricing page that paid plans can't be purchased yet.
      stripeConfigured: priceIdByTier.size > 0,
    });
  });

  app.post("/api/checkout", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const { priceId } = req.body;
      if (!priceId) return res.status(400).json({ message: "priceId is required" });

      // Only allow prices belonging to one of our own tiers, so an arbitrary
      // price ID can't be substituted by the client.
      const allowedPriceIds = new Set((await getPriceIdsByTier()).values());
      if (!allowedPriceIds.has(priceId)) {
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

  /**
   * Dev-only tier override, so every entitlement layer can be exercised
   * without four Stripe subscriptions. Hard-disabled outside development and
   * whenever a real Stripe subscription exists, so it can never be used to
   * self-upgrade in production.
   */
  app.post("/api/dev/set-tier", isAuthenticated, async (req: any, res) => {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_TIER_OVERRIDE !== "true") {
      return res.status(404).json({ message: "Not found" });
    }
    try {
      const userId = (req.user as any).id;
      const { tier } = req.body as { tier?: string };
      if (!tier || !TIER_IDS.includes(tier as TierId)) {
        return res.status(400).json({ message: `tier must be one of: ${TIER_IDS.join(", ")}` });
      }

      const user = await storage.getUser(userId);
      if (user?.stripeSubscriptionId) {
        return res.status(409).json({
          message: "You have a real Stripe subscription. Cancel it in the billing portal before overriding the tier.",
        });
      }

      await storage.updateUserStripeInfo(userId, { subscriptionTier: tier });
      const ent = await getUserEntitlements(userId);
      console.log(`[dev] tier override: user ${userId} -> ${tier}`);
      res.json({ tier: ent.tier, entitlements: { ...ent, credits: ent.credits === Infinity ? -1 : ent.credits, privateProjects: ent.privateProjects === Infinity ? -1 : ent.privateProjects } });
    } catch (error) {
      console.error("Dev set-tier error:", error);
      res.status(500).json({ message: "Failed to set tier" });
    }
  });

  /** Dev-only: reset this month's credit usage so limits can be re-tested. */
  app.post("/api/dev/reset-credits", isAuthenticated, async (req: any, res) => {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_TIER_OVERRIDE !== "true") {
      return res.status(404).json({ message: "Not found" });
    }
    try {
      const userId = (req.user as any).id;
      await db.update(users).set({ creditsUsed: 0, creditsResetAt: new Date() }).where(eq(users.id, userId));
      const sub = await storage.getUserSubscription(userId);
      res.json({ creditsUsed: sub.creditsUsed, creditsLimit: sub.creditsLimit === Infinity ? -1 : sub.creditsLimit });
    } catch (error) {
      console.error("Dev reset-credits error:", error);
      res.status(500).json({ message: "Failed to reset credits" });
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
          goal: "ship_mvp" as const,
          subcategory: "app",
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
          goal: "ship_mvp" as const,
          subcategory: "app",
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
          goal: "ship_mvp" as const,
          subcategory: "app",
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
          goal: "ship_mvp" as const,
          subcategory: "app",
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
