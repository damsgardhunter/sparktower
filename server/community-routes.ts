/**
 * Communities: groups people join around what they're building, listed under
 * Contests and Communities. For now a community is a name, a line about who
 * it's for, and its members — joining is the whole interaction.
 *
 * The starting set is written here and seeded by slug at boot: a new seed is
 * added, an edited one updates in place, and nothing is ever duplicated or
 * removed (a community people have joined isn't deleted by a code change).
 */
import type { Express } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { communities, communityMembers } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";

export const SEED_COMMUNITIES = [
  { slug: "solo-builders", name: "Solo Builders", tagline: "Building alone, shipping anyway", description: "For founders working without a team: accountability, scope cuts and getting to launch on your own.", icon: "user", color: "#9745B5" },
  { slug: "ai-builders", name: "AI Builders", tagline: "Products built on models and agents", description: "Share what you're building with AI, compare stacks and prompts, and learn what users actually pay for.", icon: "sparkles", color: "#10B981" },
  { slug: "saas-founders", name: "SaaS Founders", tagline: "From first user to recurring revenue", description: "Pricing, onboarding, churn and growth for software businesses at every stage.", icon: "layers", color: "#2563EB" },
  { slug: "first-time-founders", name: "First-Time Founders", tagline: "Your first company, one step at a time", description: "Ask the questions everyone has the first time: validation, co-founders, legal basics and staying motivated.", icon: "rocket", color: "#F59E0B" },
  { slug: "raising-capital", name: "Raising Capital", tagline: "Investors, loans, grants and deals", description: "Decks, intros, term sheets and alternatives to equity — from people doing it right now.", icon: "hand-coins", color: "#E11D48" },
  { slug: "small-business-owners", name: "Small Business Owners", tagline: "Run it without it running you", description: "Systems, hiring and numbers for restaurants, services and shops that want to work without the owner in every step.", icon: "store", color: "#0891B2" },
] as const;

/** Adds any missing starter communities and keeps their copy current. Safe on every boot. */
export async function seedCommunities(): Promise<void> {
  for (const [i, c] of SEED_COMMUNITIES.entries()) {
    await db.insert(communities).values({ ...c, sort: i })
      .onConflictDoUpdate({ target: communities.slug, set: { name: c.name, tagline: c.tagline, description: c.description, icon: c.icon, color: c.color, sort: i } });
  }
}

/** Every community with its member count, and whether the viewer has joined. */
export async function listCommunities(viewerId?: string) {
  const rows = await db.select({
    id: communities.id, slug: communities.slug, name: communities.name, tagline: communities.tagline,
    description: communities.description, icon: communities.icon, color: communities.color,
    // Qualified by hand: inside a subquery drizzle writes bare column names, and a bare "id" is the member row's.
    members: sql<number>`(select count(*)::int from community_members cm where cm.community_id = "communities"."id")`,
    joined: viewerId
      ? sql<boolean>`exists(select 1 from community_members cm where cm.community_id = "communities"."id" and cm.user_id = ${viewerId})`
      : sql<boolean>`false`,
  }).from(communities).orderBy(asc(communities.sort), asc(communities.name));
  return rows.map((r) => ({ ...r, members: Number(r.members), joined: Boolean(r.joined) }));
}

async function bySlug(slug: string) {
  const [row] = await db.select({ id: communities.id }).from(communities).where(eq(communities.slug, slug));
  return row ?? null;
}

export function registerCommunityRoutes(app: Express) {
  /** Readable signed out, so the page shows what's there before someone joins. */
  app.get("/api/communities", async (req: any, res) => {
    try {
      res.json(await listCommunities(req.user?.id));
    } catch (error) {
      console.error("Communities error:", error);
      res.status(500).json({ message: "Couldn't load communities" });
    }
  });

  app.post("/api/communities/:slug/join", isAuthenticated, rateLimit("follow"), async (req: any, res) => {
    try {
      const community = await bySlug(String(req.params.slug));
      if (!community) return res.status(404).json({ message: "Community not found" });
      await db.insert(communityMembers).values({ communityId: community.id, userId: req.user.id }).onConflictDoNothing();
      const [row] = (await listCommunities(req.user.id)).filter((c) => c.id === community.id);
      res.json(row);
    } catch (error) {
      console.error("Join community error:", error);
      res.status(500).json({ message: "Couldn't join that community" });
    }
  });

  app.delete("/api/communities/:slug/join", isAuthenticated, async (req: any, res) => {
    try {
      const community = await bySlug(String(req.params.slug));
      if (!community) return res.status(404).json({ message: "Community not found" });
      await db.delete(communityMembers).where(and(eq(communityMembers.communityId, community.id), eq(communityMembers.userId, req.user.id)));
      const [row] = (await listCommunities(req.user.id)).filter((c) => c.id === community.id);
      res.json(row);
    } catch (error) {
      console.error("Leave community error:", error);
      res.status(500).json({ message: "Couldn't leave that community" });
    }
  });
}
