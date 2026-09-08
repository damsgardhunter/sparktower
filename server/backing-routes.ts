/**
 * Backing: donation tiers, backer rewards, merch, and the escrow around them.
 *
 * Two things here are load-bearing and worth stating plainly.
 *
 * **Money is held, not forwarded.** Pledges are taken as ordinary charges into
 * the platform's own Stripe balance — deliberately *not* the destination
 * charges the older `/donate-checkout` route uses, which pay a creator the
 * instant a card clears. Nothing reaches a creator until a human approves it,
 * which is the only reason "we hold funds until the project is real" is a true
 * statement rather than a marketing one.
 *
 * **Approval is a judgement, not a formula.** The audit score, completed-task
 * count and profile state are computed and shown to the reviewer, but they
 * gate nothing on their own: a legitimate project three weeks in scores badly
 * on all three, and a determined fraud can score well on all three. The
 * signals exist to make a person faster, not to replace them.
 *
 * Data access goes through `db` rather than `storage` — this is a
 * self-contained feature and IStorage is already carrying three hundred
 * methods that every other module has to read past.
 */
import type { Express } from "express";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import {
  projects, users, userProfiles, projectBackingCampaigns, projectBackerTiers,
  projectBackings, projectMerchOrders, projectCodeAudits, projectKanbanTasks,
  backerBadges, type ShippingAddress,
} from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { requireSurface } from "./surfaces";
import { getUncachableStripeClient } from "./stripeClient";
import { requireReviewer } from "./platform-roles";
import { isPrintfulConfigured, listCatalog } from "./printful";
import { renderMerchFace, type MerchFace } from "./merch-render";
import {
  generateBadgeArt, setShowcase, upsertBackerBadge, renderBadgeImage, projectLogoBuffer,
  badgeLogoUrl,
} from "./backer-badges";
import { ObjectStorageService } from "./replit_integrations/object_storage";
import {
  DEFAULT_MERCH_CONFIG, DEFAULT_TIER_TEMPLATE, DIGITAL_REWARD_KEYS, MERCH_PRODUCT_KEYS,
  MIN_PLEDGE_CENTS, MAX_PLEDGE_CENTS, REFUND_WINDOW_DAYS, DEFAULT_TIP_PERCENT,
  UNCLAIMED_PREFERENCES, MAX_SHOWCASE_BADGES, BADGE_LEVELS, platformFeeCents, creatorPayoutCents, tierForAmount,
  tierNeedsShipping, type MerchConfig,
} from "@shared/backing";

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const keysFrom = (v: unknown, allowed: string[]): string[] =>
  Array.isArray(v) ? Array.from(new Set(v.map(String).filter((k) => allowed.includes(k)))) : [];

/**
 * The merch config as it should actually render.
 *
 * A creator who has already set a project logo shouldn't have to upload the
 * same file again to get it on a shirt, so the project's logo stands in
 * whenever the merch config doesn't override it.
 */
function effectiveMerchConfig(
  stored: unknown, projectLogoUrl: string | null,
): MerchConfig {
  const config = { ...DEFAULT_MERCH_CONFIG, ...((stored as object) || {}) } as MerchConfig;
  return { ...config, logoUrl: config.logoUrl || projectLogoUrl || null };
}

async function isOwner(userId: string, projectId: string): Promise<boolean> {
  const [row] = await db.select({ ownerId: projects.ownerId })
    .from(projects).where(eq(projects.id, projectId));
  return row?.ownerId === userId;
}

/** Creates the campaign row on first touch so the editor never 404s. */
async function ensureCampaign(projectId: string) {
  const [existing] = await db.select().from(projectBackingCampaigns)
    .where(eq(projectBackingCampaigns.projectId, projectId));
  if (existing) return existing;
  const [created] = await db.insert(projectBackingCampaigns)
    .values({ projectId, merchConfig: DEFAULT_MERCH_CONFIG })
    .returning();
  return created;
}

function sanitizeMerchConfig(input: unknown, current: MerchConfig): MerchConfig {
  const raw = (input ?? {}) as Partial<MerchConfig>;
  const showLogo = raw.showLogo ?? current.showLogo;
  const showName = raw.showName ?? current.showName;
  return {
    // A garment with neither logo nor name on it is a blank shirt. If the
    // creator turns both off, put the name back — it's the safer default and
    // the setup screen says so rather than silently disagreeing with them.
    showLogo,
    showName: showLogo || showName ? showName : true,
    displayName: raw.displayName === undefined
      ? current.displayName
      : (str(raw.displayName, 60) || null),
    logoUrl: raw.logoUrl === undefined ? current.logoUrl : (str(raw.logoUrl, 500) || null),
    colorway: ["black", "white", "heather"].includes(raw.colorway as string)
      ? raw.colorway as MerchConfig["colorway"]
      : current.colorway,
    showDatestamp: raw.showDatestamp ?? current.showDatestamp,
    enabledProducts: raw.enabledProducts === undefined
      ? current.enabledProducts
      : keysFrom(raw.enabledProducts, MERCH_PRODUCT_KEYS),
    creatorShirt: raw.creatorShirt ?? current.creatorShirt,
    backArtworkUrl: raw.backArtworkUrl === undefined
      ? current.backArtworkUrl
      : (str(raw.backArtworkUrl, 500) || null),
  };
}

/**
 * Everything a reviewer wants to know before releasing someone's money.
 *
 * Read-only and advisory. Nothing here blocks a payout and nothing here
 * authorises one — see the module header.
 */
export async function backingSignals(projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return null;

  const [[audit], doneTasks, [owner], [profile], members, [totals]] = await Promise.all([
    db.select().from(projectCodeAudits)
      .where(eq(projectCodeAudits.projectId, projectId))
      .orderBy(desc(projectCodeAudits.createdAt)).limit(1),
    db.select({ n: sql<number>`count(*)::int` }).from(projectKanbanTasks)
      .where(and(eq(projectKanbanTasks.projectId, projectId), eq(projectKanbanTasks.status, "done"))),
    db.select().from(users).where(eq(users.id, project.ownerId)),
    db.select().from(userProfiles).where(eq(userProfiles.userId, project.ownerId)),
    storage.getProjectMembers(projectId).catch(() => []),
    db.select({
      backers: sql<number>`count(*)::int`,
      heldCents: sql<number>`coalesce(sum(case when status = 'held' then amount_cents else 0 end), 0)::int`,
      releasedCents: sql<number>`coalesce(sum(case when status = 'released' then amount_cents else 0 end), 0)::int`,
    }).from(projectBackings).where(eq(projectBackings.projectId, projectId)),
  ]);

  // Profile completeness is a fraud signal, not a quality one: an account with
  // nothing on it is cheap to make and cheap to abandon.
  const profileFields = [
    profile?.displayName, profile?.headline, profile?.bio,
    profile?.avatarUrl, profile?.location,
  ];
  const profileFilled = profileFields.filter(Boolean).length;

  let stripeAccount: { detailsSubmitted: boolean; chargesEnabled: boolean; payoutsEnabled: boolean } | null = null;
  if (owner?.stripeConnectAccountId) {
    try {
      const stripe = await getUncachableStripeClient();
      const account = await stripe.accounts.retrieve(owner.stripeConnectAccountId);
      stripeAccount = {
        detailsSubmitted: Boolean(account.details_submitted),
        chargesEnabled: Boolean(account.charges_enabled),
        payoutsEnabled: Boolean(account.payouts_enabled),
      };
    } catch {
      // A Stripe hiccup must not empty the reviewer's console.
      stripeAccount = null;
    }
  }

  return {
    project: { id: project.id, title: project.title, createdAt: project.createdAt },
    owner: owner ? { id: owner.id, email: owner.email, createdAt: owner.createdAt } : null,
    codeAudit: audit
      ? {
          completionPercent: audit.completionPercent,
          stage: audit.stage,
          source: audit.source,
          createdAt: audit.createdAt,
        }
      : null,
    completedTasks: doneTasks?.[0]?.n ?? 0,
    profileCompleteness: Math.round((profileFilled / profileFields.length) * 100),
    hasRepoUrl: Boolean(project.repoUrl),
    hasLiveUrl: Boolean(project.liveUrl),
    memberCount: members.length,
    /** Identity verification, done by Stripe rather than by us. */
    stripeAccount,
    backers: totals?.backers ?? 0,
    heldCents: totals?.heldCents ?? 0,
    releasedCents: totals?.releasedCents ?? 0,
  };
}

export function registerBackingRoutes(app: Express) {
  // Nested under /api/projects/:id, so the prefix guards in routes.ts can't
  // reach these — mounted here instead, same effect.
  app.use("/api/projects/:id/backing", requireSurface("backing"));

  // ---------------------------------------------------------------- creator

  /** The whole editor payload: campaign, tiers, and how the payout looks. */
  app.get("/api/projects/:id/backing", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = req.params.id;
      if (!(await isOwner(req.user.id, projectId))) {
        return res.status(403).json({ message: "Only the project owner can set up backing" });
      }

      const campaign = await ensureCampaign(projectId);
      const tiers = await db.select().from(projectBackerTiers)
        .where(eq(projectBackerTiers.projectId, projectId))
        .orderBy(projectBackerTiers.sortOrder, projectBackerTiers.amountCents);

      const [owner] = await db.select().from(users).where(eq(users.id, req.user.id));
      const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
      const signals = await backingSignals(projectId);

      res.json({
        campaign,
        tiers,
        // Same fallback the renderer uses, so the editor and the shirt agree
        // about which logo is in play.
        merchConfig: effectiveMerchConfig(campaign.merchConfig, project?.logoUrl ?? null),
        badgePreviews: (campaign.badgePreviews as Record<string, string>) || {},
        // The logo badges and merch will actually use, already resolved.
        projectLogoUrl: badgeLogoUrl(project?.logoUrl ?? null, campaign.merchConfig),
        payouts: {
          connectAccountId: owner?.stripeConnectAccountId || null,
          heldCents: signals?.heldCents ?? 0,
          releasedCents: signals?.releasedCents ?? 0,
          backers: signals?.backers ?? 0,
        },
        // The creator sees the same signals the reviewer does. Hiding them
        // just generates support tickets asking why they weren't approved.
        signals,
        printfulReady: isPrintfulConfigured(),
      });
    } catch (error) {
      console.error("Get backing setup error:", error);
      res.status(500).json({ message: "Failed to load your backing setup" });
    }
  });

  app.patch("/api/projects/:id/backing", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = req.params.id;
      if (!(await isOwner(req.user.id, projectId))) {
        return res.status(403).json({ message: "Only the project owner can set up backing" });
      }

      const campaign = await ensureCampaign(projectId);
      const current = { ...DEFAULT_MERCH_CONFIG, ...(campaign.merchConfig as object) } as MerchConfig;
      const updates: Record<string, unknown> = {};

      if (req.body.headline !== undefined) updates.headline = str(req.body.headline, 140) || null;
      if (req.body.story !== undefined) updates.story = str(req.body.story, 4000) || null;
      if (req.body.goalCents !== undefined) {
        updates.goalCents = req.body.goalCents === null
          ? null
          : clampInt(req.body.goalCents, 0, 100_000_000, 0);
      }
      if (req.body.merchConfig !== undefined) {
        updates.merchConfig = sanitizeMerchConfig(req.body.merchConfig, current);
      }
      if (req.body.enabled !== undefined) {
        const enabling = Boolean(req.body.enabled);
        if (enabling) {
          const [{ n }] = await db.select({ n: sql<number>`count(*)::int` })
            .from(projectBackerTiers)
            .where(and(
              eq(projectBackerTiers.projectId, projectId),
              eq(projectBackerTiers.isActive, true),
            ));
          if (n === 0) {
            return res.status(422).json({
              message: "Add at least one tier before opening your campaign.",
            });
          }
        }
        updates.enabled = enabling;
        // The datestamp on every shirt is fixed the first time the campaign
        // opens. Re-opening later must not silently re-date existing backers.
        if (enabling && !campaign.startedAt) updates.startedAt = new Date();
      }

      const [updated] = await db.update(projectBackingCampaigns)
        .set(updates)
        .where(eq(projectBackingCampaigns.id, campaign.id))
        .returning();
      res.json(updated);
    } catch (error) {
      console.error("Update backing campaign error:", error);
      res.status(500).json({ message: "Failed to save your campaign" });
    }
  });

  /** Seeds the five-rung ladder. Refuses rather than duplicating existing work. */
  app.post("/api/projects/:id/backing/tiers/apply-template", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = req.params.id;
      if (!(await isOwner(req.user.id, projectId))) {
        return res.status(403).json({ message: "Only the project owner can set up backing" });
      }
      const existing = await db.select({ id: projectBackerTiers.id })
        .from(projectBackerTiers).where(eq(projectBackerTiers.projectId, projectId));
      if (existing.length > 0) {
        return res.status(409).json({ message: "You already have tiers. Edit or delete them first." });
      }

      const created = await db.insert(projectBackerTiers).values(
        DEFAULT_TIER_TEMPLATE.map((t, i) => ({
          projectId,
          amountCents: t.amountCents,
          name: t.name,
          description: t.description,
          digitalRewards: t.digitalRewards,
          merchProducts: t.merchProducts,
          sortOrder: i,
        })),
      ).returning();
      res.json(created);
    } catch (error) {
      console.error("Apply tier template error:", error);
      res.status(500).json({ message: "Failed to create the starter tiers" });
    }
  });

  app.post("/api/projects/:id/backing/tiers", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = req.params.id;
      if (!(await isOwner(req.user.id, projectId))) {
        return res.status(403).json({ message: "Only the project owner can set up backing" });
      }
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` })
        .from(projectBackerTiers).where(eq(projectBackerTiers.projectId, projectId));
      if (n >= 8) {
        return res.status(422).json({ message: "Eight rungs is already more than anyone reads." });
      }

      const [tier] = await db.insert(projectBackerTiers).values({
        projectId,
        amountCents: clampInt(req.body.amountCents, MIN_PLEDGE_CENTS, MAX_PLEDGE_CENTS, 500),
        name: str(req.body.name, 40) || "Believer",
        description: str(req.body.description, 300) || null,
        digitalRewards: keysFrom(req.body.digitalRewards, DIGITAL_REWARD_KEYS),
        merchProducts: keysFrom(req.body.merchProducts, MERCH_PRODUCT_KEYS),
        maxBackers: req.body.maxBackers ? clampInt(req.body.maxBackers, 1, 1_000_000, 50) : null,
        sortOrder: n,
      }).returning();
      res.json(tier);
    } catch (error) {
      console.error("Create tier error:", error);
      res.status(500).json({ message: "Failed to add that tier" });
    }
  });

  app.patch("/api/backing-tiers/:tierId", isAuthenticated, async (req: any, res) => {
    try {
      const [tier] = await db.select().from(projectBackerTiers)
        .where(eq(projectBackerTiers.id, req.params.tierId));
      if (!tier) return res.status(404).json({ message: "Tier not found" });
      if (!(await isOwner(req.user.id, tier.projectId))) {
        return res.status(403).json({ message: "Only the project owner can edit tiers" });
      }

      const updates: Record<string, unknown> = {};
      if (req.body.name !== undefined) updates.name = str(req.body.name, 40) || tier.name;
      if (req.body.description !== undefined) updates.description = str(req.body.description, 300) || null;
      if (req.body.amountCents !== undefined) {
        updates.amountCents = clampInt(req.body.amountCents, MIN_PLEDGE_CENTS, MAX_PLEDGE_CENTS, tier.amountCents);
      }
      if (req.body.digitalRewards !== undefined) {
        updates.digitalRewards = keysFrom(req.body.digitalRewards, DIGITAL_REWARD_KEYS);
      }
      if (req.body.merchProducts !== undefined) {
        updates.merchProducts = keysFrom(req.body.merchProducts, MERCH_PRODUCT_KEYS);
      }
      if (req.body.maxBackers !== undefined) {
        updates.maxBackers = req.body.maxBackers === null
          ? null : clampInt(req.body.maxBackers, 1, 1_000_000, 50);
      }
      if (req.body.isActive !== undefined) updates.isActive = Boolean(req.body.isActive);
      if (req.body.sortOrder !== undefined) updates.sortOrder = clampInt(req.body.sortOrder, 0, 99, tier.sortOrder);

      const [updated] = await db.update(projectBackerTiers).set(updates)
        .where(eq(projectBackerTiers.id, tier.id)).returning();
      res.json(updated);
    } catch (error) {
      console.error("Update tier error:", error);
      res.status(500).json({ message: "Failed to save that tier" });
    }
  });

  app.delete("/api/backing-tiers/:tierId", isAuthenticated, async (req: any, res) => {
    try {
      const [tier] = await db.select().from(projectBackerTiers)
        .where(eq(projectBackerTiers.id, req.params.tierId));
      if (!tier) return res.status(404).json({ message: "Tier not found" });
      if (!(await isOwner(req.user.id, tier.projectId))) {
        return res.status(403).json({ message: "Only the project owner can delete tiers" });
      }

      // Someone already bought this. Their record points at it, so retire the
      // rung instead of deleting the thing their receipt refers to.
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` })
        .from(projectBackings).where(eq(projectBackings.tierId, tier.id));
      if (n > 0) {
        const [retired] = await db.update(projectBackerTiers).set({ isActive: false })
          .where(eq(projectBackerTiers.id, tier.id)).returning();
        return res.json({ retired: true, tier: retired });
      }

      await db.delete(projectBackerTiers).where(eq(projectBackerTiers.id, tier.id));
      res.json({ deleted: true });
    } catch (error) {
      console.error("Delete tier error:", error);
      res.status(500).json({ message: "Failed to remove that tier" });
    }
  });

  /** Puts the project in the reviewer's queue. Payouts wait on this. */
  app.post("/api/projects/:id/backing/submit-review", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = req.params.id;
      if (!(await isOwner(req.user.id, projectId))) {
        return res.status(403).json({ message: "Only the project owner can request review" });
      }
      const campaign = await ensureCampaign(projectId);
      if (campaign.reviewStatus === "approved") {
        return res.status(409).json({ message: "This project is already approved for payouts." });
      }

      const [owner] = await db.select().from(users).where(eq(users.id, req.user.id));
      if (!owner?.stripeConnectAccountId) {
        return res.status(422).json({
          message: "Connect a Stripe account first — there's nowhere to send the money otherwise.",
        });
      }

      const [updated] = await db.update(projectBackingCampaigns)
        .set({ reviewStatus: "pending", submittedForReviewAt: new Date(), reviewNotes: null })
        .where(eq(projectBackingCampaigns.id, campaign.id))
        .returning();
      res.json(updated);
    } catch (error) {
      console.error("Submit for review error:", error);
      res.status(500).json({ message: "Failed to submit for review" });
    }
  });

  /**
   * A creator seeing the badge their backers will get, before anyone pledges.
   *
   * Goes through the same `renderBadgeImage` a real badge does, so this can't
   * quietly diverge from what actually gets handed out. Cached on the campaign
   * because each call costs a model request and this screen gets reopened.
   */
  app.post("/api/projects/:id/backing/badge-preview", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = req.params.id;
      if (!(await isOwner(req.user.id, projectId))) {
        return res.status(403).json({ message: "Only the project owner can preview badges" });
      }

      const level = String(req.body.level || "bronze");
      if (!BADGE_LEVELS.some((l) => l.key === level)) {
        return res.status(400).json({ message: "Unknown badge level" });
      }

      const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
      if (!project) return res.status(404).json({ message: "Project not found" });

      const campaign = await ensureCampaign(projectId);
      // Same resolution the real badge uses, so a preview can't disagree.
      const logo = await projectLogoBuffer(badgeLogoUrl(project.logoUrl, campaign.merchConfig));

      const png = await renderBadgeImage(level, project.title, logo);
      const objectPath = await new ObjectStorageService().writeObjectBuffer(png, "image/png");

      const previews = { ...((campaign.badgePreviews as Record<string, string>) || {}), [level]: objectPath };
      await db.update(projectBackingCampaigns).set({ badgePreviews: previews })
        .where(eq(projectBackingCampaigns.id, campaign.id));

      res.json({ level, imageUrl: objectPath, usedLogo: !!logo });
    } catch (error: any) {
      console.error("Badge preview error:", error);
      res.status(502).json({ message: error?.message || "Couldn't make that preview" });
    }
  });

  // ------------------------------------------------------------------ art
  //
  // Both endpoints are unauthenticated on purpose. The preview is what a
  // prospective backer looks at before they've signed in, and the print file
  // has to be fetchable by Printful's servers, which carry no session.

  /**
   * The artwork as the creator and the backer see it, on the garment colour.
   *
   * Rendered by the same function that produces the print file, so what's on
   * screen is what goes on the shirt.
   */
  app.get("/api/projects/:id/merch/preview.png", async (req, res) => {
    try {
      const face = String(req.query.face || "front");
      if (!["front", "back", "creator"].includes(face)) {
        return res.status(400).json({ message: "face must be front, back or creator" });
      }
      const width = clampInt(req.query.width, 200, 1200, 700);

      const [row] = await db.select({
        campaign: projectBackingCampaigns,
        title: projects.title,
        logoUrl: projects.logoUrl,
      }).from(projects)
        .leftJoin(projectBackingCampaigns, eq(projectBackingCampaigns.projectId, projects.id))
        .where(eq(projects.id, req.params.id));
      if (!row) return res.status(404).json({ message: "Project not found" });

      const config = effectiveMerchConfig(row.campaign?.merchConfig, row.logoUrl);

      const png = await renderMerchFace({
        config, projectName: row.title, startedAt: row.campaign?.startedAt ?? null,
        face: face as MerchFace, preview: true, width,
      });

      // Short cache: the creator is actively editing, but a backer reloading
      // the project page shouldn't re-render a 4500px canvas each time.
      res.set("Content-Type", "image/png");
      res.set("Cache-Control", "public, max-age=60");
      res.send(png);
    } catch (error: any) {
      console.error("Merch preview error:", error);
      res.status(422).json({ message: error?.message || "Couldn't render that preview" });
    }
  });

  /**
   * The print file Printful fetches.
   *
   * Rendered from the artwork snapshot stored on the order, never from the
   * campaign's current config — a creator who swaps their logo after someone
   * ordered must not change what that person already bought.
   */
  app.get("/api/merch-orders/:orderId/print/:face.png", async (req, res) => {
    try {
      const face = String(req.params.face);
      if (!["front", "back", "creator"].includes(face)) {
        return res.status(404).json({ message: "Not found" });
      }

      const [row] = await db.select({
        order: projectMerchOrders,
        campaign: projectBackingCampaigns,
        title: projects.title,
        logoUrl: projects.logoUrl,
      }).from(projectMerchOrders)
        .innerJoin(projects, eq(projects.id, projectMerchOrders.projectId))
        .leftJoin(projectBackingCampaigns, eq(projectBackingCampaigns.projectId, projectMerchOrders.projectId))
        .where(eq(projectMerchOrders.id, req.params.orderId));
      if (!row) return res.status(404).json({ message: "Not found" });

      const snapshot = (row.order.items as { artwork?: Record<string, unknown> }[])?.[0]?.artwork;
      const config = effectiveMerchConfig(snapshot, row.logoUrl);

      const png = await renderMerchFace({
        config, projectName: row.title, startedAt: row.campaign?.startedAt ?? null,
        face: face as MerchFace,
      });

      res.set("Content-Type", "image/png");
      // Immutable: the snapshot it renders from never changes.
      res.set("Cache-Control", "public, max-age=86400, immutable");
      res.send(png);
    } catch (error: any) {
      console.error("Print file error:", error);
      res.status(422).json({ message: error?.message || "Couldn't render the print file" });
    }
  });

  // ----------------------------------------------------------------- public

  /** What a backer sees. Only ever returns an opened campaign. */
  app.get("/api/projects/:id/backing/public", async (req, res) => {
    try {
      const projectId = req.params.id;
      const [campaign] = await db.select().from(projectBackingCampaigns)
        .where(eq(projectBackingCampaigns.projectId, projectId));
      if (!campaign?.enabled) return res.status(404).json({ message: "Not accepting backing" });

      const tiers = await db.select().from(projectBackerTiers)
        .where(and(
          eq(projectBackerTiers.projectId, projectId),
          eq(projectBackerTiers.isActive, true),
        ))
        .orderBy(projectBackerTiers.amountCents);

      // Per-tier counts, so a limited rung can show what's left.
      const claimed = await db.select({
        tierId: projectBackings.tierId,
        n: sql<number>`count(*)::int`,
      }).from(projectBackings)
        .where(and(
          eq(projectBackings.projectId, projectId),
          inArray(projectBackings.status, ["held", "released"]),
        ))
        .groupBy(projectBackings.tierId);
      const claimedByTier = new Map(claimed.map((c) => [c.tierId, c.n]));

      const wall = await db.select({
        believerNumber: projectBackings.believerNumber,
        message: projectBackings.message,
        isAnonymous: projectBackings.isAnonymous,
        tierName: projectBackings.tierNameAtBacking,
        createdAt: projectBackings.createdAt,
        backerFirstName: users.firstName,
        backerImage: users.profileImageUrl,
      }).from(projectBackings)
        .leftJoin(users, eq(users.id, projectBackings.backerId))
        .where(and(
          eq(projectBackings.projectId, projectId),
          inArray(projectBackings.status, ["held", "released"]),
        ))
        .orderBy(projectBackings.believerNumber)
        .limit(200);

      const [totals] = await db.select({
        raisedCents: sql<number>`coalesce(sum(amount_cents), 0)::int`,
        backers: sql<number>`count(*)::int`,
      }).from(projectBackings)
        .where(and(
          eq(projectBackings.projectId, projectId),
          inArray(projectBackings.status, ["held", "released"]),
        ));

      res.json({
        campaign: {
          headline: campaign.headline,
          story: campaign.story,
          goalCents: campaign.goalCents,
          startedAt: campaign.startedAt,
          merchConfig: { ...DEFAULT_MERCH_CONFIG, ...(campaign.merchConfig as object) },
          /* Backers are told plainly that money is held and why. */
          fundsHeld: campaign.reviewStatus !== "approved",
        },
        tiers: tiers.map((t) => ({
          ...t,
          claimed: claimedByTier.get(t.id) ?? 0,
          soldOut: t.maxBackers != null && (claimedByTier.get(t.id) ?? 0) >= t.maxBackers,
        })),
        wall: wall.map((w) => ({
          believerNumber: w.believerNumber,
          name: w.isAnonymous ? "Anonymous" : (w.backerFirstName || "A believer"),
          image: w.isAnonymous ? null : w.backerImage,
          message: w.message,
          tierName: w.tierName,
          createdAt: w.createdAt,
        })),
        raisedCents: totals?.raisedCents ?? 0,
        backers: totals?.backers ?? 0,
        defaultTipPercent: DEFAULT_TIP_PERCENT,
        refundWindowDays: REFUND_WINDOW_DAYS,
      });
    } catch (error) {
      console.error("Public backing error:", error);
      res.status(500).json({ message: "Failed to load this campaign" });
    }
  });

  /**
   * Starts a pledge.
   *
   * No `transfer_data`, so the charge settles into the platform balance and
   * stays there until a reviewer releases it. The backing row is written by
   * the webhook, not here — a session that is created and abandoned must not
   * leave a pledge on the backer wall.
   */
  app.post("/api/projects/:id/backing/checkout", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = req.params.id;
      const backerId = req.user.id;

      const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId === backerId) {
        return res.status(422).json({ message: "You can't back your own project." });
      }

      const [campaign] = await db.select().from(projectBackingCampaigns)
        .where(eq(projectBackingCampaigns.projectId, projectId));
      if (!campaign?.enabled) return res.status(404).json({ message: "Not accepting backing" });

      const amountCents = clampInt(req.body.amountCents, MIN_PLEDGE_CENTS, MAX_PLEDGE_CENTS, 0);
      if (amountCents < MIN_PLEDGE_CENTS) {
        return res.status(400).json({ message: `Minimum pledge is $${MIN_PLEDGE_CENTS / 100}.` });
      }
      const tipCents = clampInt(req.body.tipCents, 0, MAX_PLEDGE_CENTS, 0);

      const tiers = await db.select().from(projectBackerTiers)
        .where(and(
          eq(projectBackerTiers.projectId, projectId),
          eq(projectBackerTiers.isActive, true),
        ));
      // The rung is earned by the amount, not by the button clicked: someone
      // who types $40 gets the $35 shirt, which is what they expect.
      const tier = tierForAmount(tiers, amountCents);

      if (tier?.maxBackers != null) {
        const [{ n }] = await db.select({ n: sql<number>`count(*)::int` })
          .from(projectBackings)
          .where(and(
            eq(projectBackings.tierId, tier.id),
            inArray(projectBackings.status, ["held", "released"]),
          ));
        if (n >= tier.maxBackers) {
          return res.status(409).json({ message: `"${tier.name}" is sold out.` });
        }
      }

      const needsShipping = tier ? tierNeedsShipping(tier) : false;
      const unclaimedPreference = UNCLAIMED_PREFERENCES.includes(req.body.unclaimedPreference)
        ? req.body.unclaimedPreference
        : "refund";

      const stripe = await getUncachableStripeClient();
      const backer = await storage.getUser(backerId);
      let customerId = backer?.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: backer?.email || undefined,
          metadata: { userId: backerId },
        });
        await storage.updateUserStripeInfo(backerId, { stripeCustomerId: customer.id });
        customerId = customer.id;
      }

      const lineItems: any[] = [{
        price_data: {
          currency: "usd",
          product_data: {
            name: tier ? `${tier.name} — ${project.title}` : `Backing ${project.title}`,
            description: tier?.description || undefined,
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      }];
      if (tipCents > 0) {
        lineItems.push({
          price_data: {
            currency: "usd",
            product_data: { name: "Tip to SparkTower (optional)" },
            unit_amount: tipCents,
          },
          quantity: 1,
        });
      }

      const origin = `${req.protocol}://${req.get("host")}`;
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "payment",
        line_items: lineItems,
        ...(needsShipping
          ? { shipping_address_collection: { allowed_countries: ["US", "CA", "GB", "AU", "DE", "FR", "NL", "IE", "NZ"] } }
          : {}),
        success_url: `${origin}/projects/${projectId}?backed=1`,
        cancel_url: `${origin}/projects/${projectId}`,
        metadata: {
          type: "backing",
          projectId,
          backerId,
          amountCents: String(amountCents),
          tipCents: String(tipCents),
          tierId: tier?.id || "",
          tierName: tier?.name || "",
          message: str(req.body.message, 280),
          isAnonymous: req.body.isAnonymous ? "1" : "0",
          unclaimedPreference,
        },
      });

      res.json({ url: session.url });
    } catch (error) {
      console.error("Backing checkout error:", error);
      res.status(500).json({ message: "Couldn't start that pledge" });
    }
  });

  // --------------------------------------------------------------- reviewer

  app.get("/api/admin/backing/queue", isAuthenticated, requireReviewer, async (_req, res) => {
    try {
      const rows = await db.select({
        campaign: projectBackingCampaigns,
        projectTitle: projects.title,
        ownerId: projects.ownerId,
      }).from(projectBackingCampaigns)
        .innerJoin(projects, eq(projects.id, projectBackingCampaigns.projectId))
        .where(inArray(projectBackingCampaigns.reviewStatus, ["pending", "approved", "rejected"]))
        .orderBy(desc(projectBackingCampaigns.submittedForReviewAt));

      const held = await db.select({
        projectId: projectBackings.projectId,
        heldCents: sql<number>`coalesce(sum(amount_cents), 0)::int`,
        backers: sql<number>`count(*)::int`,
      }).from(projectBackings)
        .where(eq(projectBackings.status, "held"))
        .groupBy(projectBackings.projectId);
      const heldByProject = new Map(held.map((h) => [h.projectId, h]));

      res.json(rows.map((r) => ({
        ...r.campaign,
        projectTitle: r.projectTitle,
        ownerId: r.ownerId,
        heldCents: heldByProject.get(r.campaign.projectId)?.heldCents ?? 0,
        heldBackers: heldByProject.get(r.campaign.projectId)?.backers ?? 0,
      })));
    } catch (error) {
      console.error("Review queue error:", error);
      res.status(500).json({ message: "Failed to load the review queue" });
    }
  });

  app.get("/api/admin/backing/:projectId/signals", isAuthenticated, requireReviewer, async (req: any, res) => {
    try {
      const signals = await backingSignals(String(req.params.projectId));
      if (!signals) return res.status(404).json({ message: "Project not found" });
      res.json(signals);
    } catch (error) {
      console.error("Backing signals error:", error);
      res.status(500).json({ message: "Failed to load signals" });
    }
  });

  /**
   * Approve or reject a project for payouts.
   *
   * Approving does not itself move money — it unlocks the release action and
   * flushes any merch that was queued waiting for a human to confirm the
   * project is real.
   */
  app.post("/api/admin/backing/:projectId/decision", isAuthenticated, requireReviewer, async (req: any, res) => {
    try {
      const { projectId } = req.params;
      const decision = req.body.decision;
      if (decision !== "approved" && decision !== "rejected") {
        return res.status(400).json({ message: "Decision must be approved or rejected" });
      }
      const [campaign] = await db.select().from(projectBackingCampaigns)
        .where(eq(projectBackingCampaigns.projectId, projectId));
      if (!campaign) return res.status(404).json({ message: "No campaign for that project" });

      const [updated] = await db.update(projectBackingCampaigns).set({
        reviewStatus: decision,
        reviewedAt: new Date(),
        reviewedById: req.user.id,
        reviewNotes: str(req.body.notes, 2000) || null,
      }).where(eq(projectBackingCampaigns.id, campaign.id)).returning();

      /*
       * Merch is gated on this campaign's review status rather than on a flag
       * copied onto each order, so approving frees the backlog without
       * touching a row: the fulfillment worker only submits orders whose
       * project reads "approved". Counted here purely so the reviewer knows
       * how many parcels their decision just set in motion.
       */
      const [waiting] = await db.select({ n: sql<number>`count(*)::int` })
        .from(projectMerchOrders)
        .where(and(
          eq(projectMerchOrders.projectId, projectId),
          eq(projectMerchOrders.status, "queued"),
        ));

      res.json({ campaign: updated, merchWaiting: waiting?.n ?? 0 });
    } catch (error) {
      console.error("Backing decision error:", error);
      res.status(500).json({ message: "Failed to record that decision" });
    }
  });

  /**
   * Moves held funds to the creator's connected account.
   *
   * Separate from approval on purpose: approving says "this project is real",
   * releasing says "send this specific money", and one reviewer mistake
   * should not be able to do both at once.
   */
  app.post("/api/admin/backing/:projectId/release", isAuthenticated, requireReviewer, async (req: any, res) => {
    try {
      const { projectId } = req.params;
      const [campaign] = await db.select().from(projectBackingCampaigns)
        .where(eq(projectBackingCampaigns.projectId, projectId));
      if (campaign?.reviewStatus !== "approved") {
        return res.status(422).json({ message: "Approve the project before releasing funds." });
      }

      const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
      if (!project) return res.status(404).json({ message: "Project not found" });
      const [owner] = await db.select().from(users).where(eq(users.id, project.ownerId));
      if (!owner?.stripeConnectAccountId) {
        return res.status(422).json({ message: "The creator has no connected Stripe account." });
      }

      const pending = await db.select().from(projectBackings)
        .where(and(eq(projectBackings.projectId, projectId), eq(projectBackings.status, "held")));
      if (pending.length === 0) return res.json({ released: 0, totalCents: 0 });

      const stripe = await getUncachableStripeClient();
      const released: string[] = [];
      const failed: { id: string; error: string }[] = [];
      let totalCents = 0;

      // One transfer per backing rather than one lump sum: a single failure
      // then costs one pledge instead of the whole batch, and each transfer
      // carries the id of the pledge that funded it for reconciliation.
      for (const backing of pending) {
        try {
          const amount = creatorPayoutCents(backing.amountCents);
          const transfer = await stripe.transfers.create({
            amount,
            currency: "usd",
            destination: owner.stripeConnectAccountId,
            transfer_group: `backing_${projectId}`,
            metadata: { backingId: backing.id, projectId },
          }, { idempotencyKey: `release_${backing.id}` });

          await db.update(projectBackings).set({
            status: "released",
            stripeTransferId: transfer.id,
            releasedAt: new Date(),
            resolvedAt: new Date(),
          }).where(eq(projectBackings.id, backing.id));

          released.push(backing.id);
          totalCents += amount;
        } catch (err: any) {
          failed.push({ id: backing.id, error: err?.message || "transfer failed" });
        }
      }

      res.json({ released: released.length, totalCents, failed });
    } catch (error) {
      console.error("Release funds error:", error);
      res.status(500).json({ message: "Failed to release funds" });
    }
  });

  app.get("/api/admin/printful/catalog", isAuthenticated, requireReviewer, async (_req, res) => {
    try {
      if (!isPrintfulConfigured()) {
        return res.status(422).json({ message: "Set PRINTFUL_API_KEY to browse the catalog." });
      }
      res.json(await listCatalog());
    } catch (error: any) {
      console.error("Printful catalog error:", error);
      res.status(502).json({ message: error?.message || "Printful is unreachable" });
    }
  });

  // ------------------------------------------------------------- the backer

  /**
   * The public half of someone's backing history — the digital rewards.
   *
   * Believer numbers and founding-believer credit are the cheap rewards that
   * carry the most weight, and a reward nobody can see isn't one. Anonymous
   * pledges are excluded here and nowhere else, so choosing anonymity actually
   * means something.
   */
  app.get("/api/users/:userId/backings", async (req, res) => {
    try {
      const rows = await db.select({
        projectId: projectBackings.projectId,
        projectTitle: projects.title,
        believerNumber: projectBackings.believerNumber,
        tierName: projectBackings.tierNameAtBacking,
        digitalRewards: projectBackerTiers.digitalRewards,
        createdAt: projectBackings.createdAt,
      }).from(projectBackings)
        .innerJoin(projects, eq(projects.id, projectBackings.projectId))
        .leftJoin(projectBackerTiers, eq(projectBackerTiers.id, projectBackings.tierId))
        .where(and(
          eq(projectBackings.backerId, String(req.params.userId)),
          eq(projectBackings.isAnonymous, false),
          inArray(projectBackings.status, ["held", "released"]),
        ))
        .orderBy(projectBackings.createdAt)
        .limit(100);

      res.json(rows.map((r) => ({
        ...r,
        foundingBeliever: (r.digitalRewards || []).includes("founding_believer"),
      })));
    } catch (error) {
      console.error("Public backings error:", error);
      res.status(500).json({ message: "Failed to load backings" });
    }
  });

  /**
   * A backer changing their mind about being named.
   *
   * Anonymity has to be reversible after the fact. Someone decides they'd
   * rather not be on a public wall a week later, and the only alternative to
   * this is a support request.
   */
  app.patch("/api/backings/:id/privacy", isAuthenticated, async (req: any, res) => {
    try {
      const [backing] = await db.select().from(projectBackings)
        .where(eq(projectBackings.id, req.params.id));
      if (!backing) return res.status(404).json({ message: "Not found" });
      if (backing.backerId !== req.user.id) {
        return res.status(403).json({ message: "That isn't your pledge" });
      }

      const [updated] = await db.update(projectBackings)
        .set({ isAnonymous: Boolean(req.body.isAnonymous) })
        .where(eq(projectBackings.id, backing.id))
        .returning();
      res.json(updated);
    } catch (error) {
      console.error("Backing privacy error:", error);
      res.status(500).json({ message: "Couldn't change that" });
    }
  });

  /**
   * The creator's record of who backed them and what they're owed.
   *
   * Owner-only, and it deliberately shows real names even for backers who are
   * anonymous *on the public wall* — the creator has to be able to post a
   * shirt. What anonymity controls is the public listing, not whether the
   * person they paid knows who they are, and the response says which is which
   * so the UI can't muddle them.
   */
  app.get("/api/projects/:id/backing/backers", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = req.params.id;
      if (!(await isOwner(req.user.id, projectId))) {
        return res.status(403).json({ message: "Only the project owner can see backers" });
      }

      const rows = await db.select({
        backing: projectBackings,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        tierName: projectBackerTiers.name,
        digitalRewards: projectBackerTiers.digitalRewards,
        merchProducts: projectBackerTiers.merchProducts,
        badgeLevel: backerBadges.level,
        badgeStatus: backerBadges.status,
        merchStatus: projectMerchOrders.status,
        trackingUrl: projectMerchOrders.trackingUrl,
      }).from(projectBackings)
        .leftJoin(users, eq(users.id, projectBackings.backerId))
        .leftJoin(projectBackerTiers, eq(projectBackerTiers.id, projectBackings.tierId))
        .leftJoin(backerBadges, and(
          eq(backerBadges.userId, projectBackings.backerId),
          eq(backerBadges.projectId, projectBackings.projectId),
        ))
        .leftJoin(projectMerchOrders, eq(projectMerchOrders.backingId, projectBackings.id))
        .where(eq(projectBackings.projectId, projectId))
        .orderBy(projectBackings.believerNumber);

      res.json(rows.map((r) => {
        const rewards = r.digitalRewards || [];
        return {
          id: r.backing.id,
          believerNumber: r.backing.believerNumber,
          name: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email || "Backer",
          email: r.email,
          /** They chose not to be named on the public wall. Still shipped to. */
          anonymousOnWall: r.backing.isAnonymous,
          amountCents: r.backing.amountCents,
          tipCents: r.backing.tipCents,
          tierName: r.backing.tierNameAtBacking || r.tierName,
          status: r.backing.status,
          message: r.backing.message,
          createdAt: r.backing.createdAt,
          entitlements: {
            earlyAccess: rewards.includes("early_access"),
            foundingBeliever: rewards.includes("founding_believer"),
            wallpaper: rewards.includes("wallpaper"),
            certificate: rewards.includes("certificate"),
            profileFrame: rewards.includes("profile_frame"),
            videoThankYou: rewards.includes("video_thankyou"),
            badge: rewards.includes("digital_badge"),
          },
          badge: r.badgeLevel ? { level: r.badgeLevel, status: r.badgeStatus } : null,
          merch: (r.merchProducts?.length ?? 0) > 0
            ? { products: r.merchProducts, status: r.merchStatus, trackingUrl: r.trackingUrl }
            : null,
          shippingAddress: r.backing.shippingAddress,
        };
      }));
    } catch (error) {
      console.error("Backer list error:", error);
      res.status(500).json({ message: "Failed to load your backers" });
    }
  });

  // ------------------------------------------------------------- badges

  /** Every badge someone holds, for their own management screen. */
  app.get("/api/me/badges", isAuthenticated, async (req: any, res) => {
    try {
      const rows = await db.select({
        badge: backerBadges,
        projectTitle: projects.title,
        projectLogo: projects.logoUrl,
      }).from(backerBadges)
        .innerJoin(projects, eq(projects.id, backerBadges.projectId))
        .where(eq(backerBadges.userId, req.user.id))
        .orderBy(desc(backerBadges.createdAt));
      res.json(rows.map((r) => ({ ...r.badge, projectTitle: r.projectTitle, projectLogo: r.projectLogo })));
    } catch (error) {
      console.error("My badges error:", error);
      res.status(500).json({ message: "Failed to load your badges" });
    }
  });

  /** The badges someone has pinned. Public — that's the point of pinning. */
  app.get("/api/users/:userId/badges/backer", async (req, res) => {
    try {
      const rows = await db.select({
        badge: backerBadges,
        projectTitle: projects.title,
      }).from(backerBadges)
        .innerJoin(projects, eq(projects.id, backerBadges.projectId))
        .where(and(
          eq(backerBadges.userId, String(req.params.userId)),
          isNotNull(backerBadges.showcaseOrder),
        ))
        .orderBy(backerBadges.showcaseOrder);
      res.json(rows.map((r) => ({ ...r.badge, projectTitle: r.projectTitle })));
    } catch (error) {
      console.error("Public badges error:", error);
      res.status(500).json({ message: "Failed to load badges" });
    }
  });

  /** Builds (or rebuilds) the artwork. Only the badge's owner may ask. */
  app.post("/api/backer-badges/:id/generate", isAuthenticated, async (req: any, res) => {
    try {
      const [badge] = await db.select().from(backerBadges)
        .where(eq(backerBadges.id, req.params.id));
      if (!badge) return res.status(404).json({ message: "Badge not found" });
      if (badge.userId !== req.user.id) {
        return res.status(403).json({ message: "That isn't your badge" });
      }

      const imageUrl = await generateBadgeArt(badge.id);
      res.json({ imageUrl, status: "ready" });
    } catch (error: any) {
      console.error("Badge generation error:", error);
      res.status(502).json({ message: error?.message || "Couldn't make that badge" });
    }
  });

  /** Replaces the pinned set, in order. */
  app.put("/api/me/badges/showcase", isAuthenticated, async (req: any, res) => {
    try {
      const ids = Array.isArray(req.body.badgeIds)
        ? req.body.badgeIds.map(String).slice(0, MAX_SHOWCASE_BADGES)
        : [];
      res.json(await setShowcase(req.user.id, ids));
    } catch (error) {
      console.error("Showcase error:", error);
      res.status(500).json({ message: "Couldn't save your selection" });
    }
  });

  /** What one person has backed, for their profile and their receipts. */
  app.get("/api/me/backings", isAuthenticated, async (req: any, res) => {
    try {
      const rows = await db.select({
        backing: projectBackings,
        projectTitle: projects.title,
      }).from(projectBackings)
        .innerJoin(projects, eq(projects.id, projectBackings.projectId))
        .where(eq(projectBackings.backerId, req.user.id))
        .orderBy(desc(projectBackings.createdAt));
      res.json(rows.map((r) => ({ ...r.backing, projectTitle: r.projectTitle })));
    } catch (error) {
      console.error("My backings error:", error);
      res.status(500).json({ message: "Failed to load your backings" });
    }
  });
}

/**
 * Records a completed pledge. Called from the Stripe webhook.
 *
 * Believer numbers come from a counter on the campaign row incremented inside
 * the same transaction as the insert, so two people checking out at the same
 * moment can't both be handed #0047.
 */
export async function recordBacking(session: any): Promise<void> {
  const m = session?.metadata || {};
  if (m.type !== "backing") return;

  const existing = await db.select({ id: projectBackings.id }).from(projectBackings)
    .where(eq(projectBackings.stripeCheckoutSessionId, session.id));
  if (existing.length > 0) return; // Stripe retries webhooks; this is expected.

  const amountCents = parseInt(m.amountCents, 10);
  const tipCents = parseInt(m.tipCents, 10) || 0;
  if (!m.projectId || !m.backerId || !Number.isFinite(amountCents)) return;

  const shipping = session.shipping_details || session.customer_details;
  const address: ShippingAddress | null = shipping?.address?.line1
    ? {
        name: shipping.name || "",
        line1: shipping.address.line1,
        line2: shipping.address.line2 || undefined,
        city: shipping.address.city || "",
        state: shipping.address.state || undefined,
        postalCode: shipping.address.postal_code || "",
        country: shipping.address.country || "US",
      }
    : null;

  const refundDueAt = new Date(Date.now() + REFUND_WINDOW_DAYS * 86_400_000);

  await db.transaction(async (tx) => {
    const [campaign] = await tx.update(projectBackingCampaigns)
      .set({ believerCount: sql`${projectBackingCampaigns.believerCount} + 1` })
      .where(eq(projectBackingCampaigns.projectId, m.projectId))
      .returning();

    const [backing] = await tx.insert(projectBackings).values({
      projectId: m.projectId,
      backerId: m.backerId,
      tierId: m.tierId || null,
      tierNameAtBacking: m.tierName || null,
      amountCents,
      tipCents,
      believerNumber: campaign?.believerCount ?? null,
      message: m.message || null,
      isAnonymous: m.isAnonymous === "1",
      status: "held",
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: session.payment_intent || null,
      shippingAddress: address,
      unclaimedPreference: m.unclaimedPreference === "donate_platform" ? "donate_platform" : "refund",
      refundDueAt,
    }).returning();

    // The public "raised" figure counts money taken, not money released —
    // it's what backers have committed, and it must not drop on payout.
    await tx.update(projects)
      .set({ totalDonations: sql`${projects.totalDonations} + ${amountCents}` })
      .where(eq(projects.id, m.projectId));

    // Physical rewards queue until the project has cleared review once. The
    // risk being managed is a creator collecting for a project that doesn't
    // exist, and that is settled the first time a person looks — not once per
    // shirt — so after approval these flush and later orders go straight out.
    if (m.tierId && address) {
      const [tier] = await tx.select().from(projectBackerTiers)
        .where(eq(projectBackerTiers.id, m.tierId));
      if (tier && (tier.merchProducts?.length ?? 0) > 0) {
        await tx.insert(projectMerchOrders).values({
          backingId: backing.id,
          projectId: m.projectId,
          status: "queued",
          items: (tier.merchProducts || []).map((key) => ({
            productKey: key,
            quantity: 1,
            artwork: (campaign?.merchConfig as Record<string, unknown>) || {},
          })),
          shippingAddress: address,
        });
      }
    }
  });

  /*
   * The badge entitlement is written straight away; the artwork is made later
   * on request. A model call failing here would roll back a pledge that has
   * already been paid for, which is the wrong trade entirely.
   */
  try {
    await upsertBackerBadge(m.backerId, m.projectId);
  } catch (err) {
    console.error("Badge upsert failed (pledge is unaffected):", err);
  }

  console.log(`Backing recorded: $${amountCents / 100} to project ${m.projectId} (held)`);
}
