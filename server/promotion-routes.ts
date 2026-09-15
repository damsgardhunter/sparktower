/**
 * Featured tools in the feed: the catalog (shared/promotions.ts) with what an
 * admin has set for each — video, referral link, perk, headline, logo, shown or
 * not. The feed reads the active ones; admins edit them on /admin/promotions.
 * Where each goes, and which, is decided in the browser per visit
 * (planFeedPromotions), so the set changes every time the home feed opens.
 */
import type { Express, RequestHandler } from "express";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { promotionSettings, promotionSources } from "@shared/schema";
import { syncAllPromotions, syncPromotion } from "./promotion-sync";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { atLeast } from "./platform-roles";
import { mfaGate } from "./mfa";
import { PROMOTION_CATALOG, validatePromotionSettings, type FeedPromotion } from "@shared/promotions";

/** Admins only: what every signed-in person sees in their feed, and where its links go. 404 for anyone else. */
const requireAdmin: RequestHandler = (req: any, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not signed in" });
  if (!atLeast(req.user.platformRole, "admin")) return res.status(404).json({ message: "Not found" });
  if (!mfaGate(req, res)) return;
  next();
};

type SettingsRow = typeof promotionSettings.$inferSelect;
type SourceRow = Omit<typeof promotionSources.$inferSelect, "logoData">;

/**
 * The catalog, with what an admin set taking precedence over what the sync
 * read from the company's own pages: their logo (served from here) and their
 * recent video, whose title stands in as "what's new".
 */
function merge({ settings, sources }: { settings: Map<string, SettingsRow>; sources: Map<string, SourceRow & { hasLogo: boolean }> }) {
  return PROMOTION_CATALOG.map((c) => {
    const s = settings.get(c.id);
    const src = sources.get(c.id);
    const perk = s?.perk ?? c.perk ?? null;
    const syncedVideo = src?.videoId ? `https://www.youtube.com/watch?v=${src.videoId}` : null;
    const promotion: FeedPromotion = {
      ...c,
      headline: s?.headline ?? (s?.videoUrl ? null : src?.videoTitle ?? null),
      videoUrl: s?.videoUrl ?? syncedVideo,
      referralUrl: s?.referralUrl ?? null,
      logoUrl: s?.logoUrl ?? (src?.hasLogo ? `/api/promotions/${c.id}/logo?v=${src.fetchedAt?.getTime() ?? 0}` : null),
      // An offer is only an offer with a link to claim it through.
      offer: s?.referralUrl && perk ? perk : null,
    };
    return {
      promotion, active: s?.active ?? true, perk, youtubeChannelUrl: s?.youtubeChannelUrl ?? null, updatedAt: s?.updatedAt ?? null,
      synced: src ? { logo: src.hasLogo, logoSourceUrl: src.logoSourceUrl, channelId: src.youtubeChannelId, videoId: src.videoId, videoTitle: src.videoTitle, videoPublishedAt: src.videoPublishedAt, fetchedAt: src.fetchedAt, error: src.error } : null,
    };
  });
}

async function settingsById() {
  const [rows, sources] = await Promise.all([
    db.select().from(promotionSettings),
    db.select({
      promotionId: promotionSources.promotionId, logoContentType: promotionSources.logoContentType, logoSourceUrl: promotionSources.logoSourceUrl,
      youtubeChannelId: promotionSources.youtubeChannelId, videoId: promotionSources.videoId, videoTitle: promotionSources.videoTitle,
      videoPublishedAt: promotionSources.videoPublishedAt, fetchedAt: promotionSources.fetchedAt, error: promotionSources.error,
    }).from(promotionSources),
  ]);
  return {
    settings: new Map(rows.map((r) => [r.promotionId, r])),
    sources: new Map(sources.map((r) => [r.promotionId, { ...r, hasLogo: !!r.logoContentType }])),
  };
}

export function registerPromotionRoutes(app: Express) {
  /** The featured tools the feed may show. */
  app.get("/api/promotions", isAuthenticated, async (_req, res) => {
    try {
      // Not cached by the browser: an admin's change shows on the next visit. The feed holds it for the visit itself.
      res.set("Cache-Control", "no-store");
      res.json({ promotions: merge(await settingsById()).filter((m) => m.active).map((m) => m.promotion) });
    } catch (error) {
      console.error("Promotions error:", error);
      res.status(500).json({ message: "Couldn't load promotions" });
    }
  });

  /** A company's logo, as read from its site — served from here, so viewers never load it from theirs. */
  app.get("/api/promotions/:id/logo", async (req, res) => {
    try {
      const [row] = await db.select({ data: promotionSources.logoData, type: promotionSources.logoContentType })
        .from(promotionSources).where(eq(promotionSources.promotionId, String(req.params.id)));
      if (!row?.data || !row.type) return res.status(404).end();
      res.set({ "Content-Type": row.type, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" });
      res.end(Buffer.from(row.data, "base64"));
    } catch (error) {
      console.error("Promotion logo error:", error);
      res.status(500).end();
    }
  });

  /** Read one company's logo and video from its site again, now. */
  app.post("/api/admin/promotions/:id/refresh", isAuthenticated, requireAdmin, rateLimit("review"), async (req, res) => {
    try {
      const id = String(req.params.id);
      if (!PROMOTION_CATALOG.some((c) => c.id === id)) return res.status(404).json({ message: "That company isn't in the catalog." });
      const result = await syncPromotion(id);
      res.json({ result, promotion: merge(await settingsById()).find((m) => m.promotion.id === id) });
    } catch (error) {
      console.error("Promotion refresh error:", error);
      res.status(500).json({ message: "Couldn't refresh that" });
    }
  });

  /** Every company, in the background: a hundred sites take a few minutes. */
  app.post("/api/admin/promotions/refresh", isAuthenticated, requireAdmin, rateLimit("review"), (_req, res) => {
    void syncAllPromotions().catch((e) => console.error("[promotions] refresh-all failed:", e));
    res.status(202).json({ started: true, companies: PROMOTION_CATALOG.length });
  });

  /** Every catalog entry with its settings, shown or not. */
  app.get("/api/admin/promotions", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      res.json({ promotions: merge(await settingsById()) });
    } catch (error) {
      console.error("Admin promotions error:", error);
      res.status(500).json({ message: "Couldn't load promotions" });
    }
  });

  /** Set one company's video, referral link, perk, headline, logo, and whether it's shown. */
  app.put("/api/admin/promotions/:id", isAuthenticated, requireAdmin, rateLimit("review"), async (req: any, res) => {
    try {
      const id = String(req.params.id);
      if (!PROMOTION_CATALOG.some((c) => c.id === id)) return res.status(404).json({ message: "That company isn't in the catalog." });
      const checked = validatePromotionSettings(req.body ?? {});
      if (!checked.ok) return res.status(400).json({ message: checked.message, code: "invalid_input", field: checked.field });
      const values = { ...checked.value, active: checked.value.active ?? true, updatedById: req.user.id, updatedAt: new Date() };
      await db.insert(promotionSettings).values({ promotionId: id, ...values })
        .onConflictDoUpdate({ target: promotionSettings.promotionId, set: values });
      res.json({ promotion: merge(await settingsById()).find((m) => m.promotion.id === id) });
    } catch (error) {
      console.error("Promotion update error:", error);
      res.status(500).json({ message: "Couldn't save that" });
    }
  });
}
