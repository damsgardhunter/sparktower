/**
 * Asking for an advert, and finding out how it is getting on.
 *
 * Four routes and a sweep. The sweep is the part that matters: a render is
 * minutes of somebody else's queue, so nothing here waits for one. A POST
 * charges the wallet, writes the row and returns it; the work happens after
 * the response, and the row is the only thing anybody polls.
 *
 * ## Why the quote route exists
 *
 * Because the price depends on a choice somebody is still making, and "how
 * much is this" should not be answered by charging them. It also returns the
 * plan — how many clips, how many seconds generated — which is the honest
 * version of what they are buying: a thirty-second advert is better value than
 * a six-second one, and the only way to see that is to see the plan.
 */
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { adRenders, projects } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { isOnTeam } from "./project-visibility";
import { rateLimit } from "./moderation";
import { walletOf } from "./wallet";
import { withJobLock, JOB } from "./job-lock";
import {
  advanceRender, quoteRender, rendersFor, renderingAvailable, startRender, unfinishedRenders,
} from "./ad-render";
import { AD_DURATIONS, AD_FORMATS, isAdDuration, type AdDuration } from "@shared/ads";
import { AD_STYLES, availableStyles } from "@shared/ad-styles";
import { brandCompleteness } from "@shared/ad-brand";
import { brandKitFor } from "./ad-brand-routes";

/** The project, when this person is on its team. 404 either way — see ad-brand-routes. */
async function reachable(projectId: string, viewerId: string | null | undefined) {
  const [project] = await db.select({ id: projects.id, ownerId: projects.ownerId, title: projects.title })
    .from(projects).where(eq(projects.id, projectId));
  if (!project) return null;
  return (await isOnTeam(viewerId, project)) ? project : null;
}

/**
 * What evidence this project has, which decides which styles it may use.
 *
 * Read from the brand kit for now. Three of the six styles need something the
 * business supplied — a testimonial needs a quote — and the alternative to
 * gating them is a model inventing a customer, which is the one failure in
 * this whole feature that could get somebody sued.
 */
async function evidenceFor(projectId: string) {
  const kit = await brandKitFor(projectId);
  return {
    productPhotos: !!kit?.logoPath,
    packagingPhotos: false,
    quotes: false,
    beforeAfter: false,
    founderLine: !!kit?.tagline,
  };
}

/** The row as a screen should see it. The brief and the plan stay; the prompts don't. */
const forClient = (row: typeof adRenders.$inferSelect) => ({
  id: row.id,
  projectId: row.projectId,
  durationSeconds: row.durationSeconds,
  format: row.format,
  style: row.style,
  status: row.status,
  outputPath: row.outputPath,
  failure: row.failure,
  chargedCents: row.chargedCents,
  refundedCents: row.refundedCents,
  script: row.script,
  /*
   * How many clips are in and how many are still out, rather than the plates
   * themselves: a plate carries the prompt, and a prompt is this product's
   * own working rather than something a person needs in order to wait.
   */
  progress: (() => {
    const plates = (row.plates as any[]) ?? [];
    return { clips: plates.length, done: plates.filter((p) => p?.status === "succeeded").length };
  })(),
  createdAt: row.createdAt,
  finishedAt: row.finishedAt,
});

export function registerAdRenderRoutes(app: Express) {
  /** What this project can order, what it would cost, and what it has ordered. */
  app.get("/api/projects/:id/ad-renders", isAuthenticated, async (req: any, res) => {
    try {
      const project = await reachable(req.params.id, req.user?.id);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const evidence = await evidenceFor(project.id);
      const kit = await brandKitFor(project.id);
      res.json({
        available: renderingAvailable(),
        renders: (await rendersFor(project.id)).map(forClient),
        /* The quote for each length, so a screen never computes a price. */
        quotes: AD_DURATIONS.map((d) => {
          const q = quoteRender(d);
          return { durationSeconds: d, priceCents: q.priceCents, clips: q.plates.length, generatedSeconds: q.generatedSeconds };
        }),
        formats: AD_FORMATS,
        /* Every style, with the ones this project cannot use yet marked rather than hidden. */
        styles: AD_STYLES.map((s) => ({
          id: s.id, label: s.label, bestFor: s.bestFor,
          available: availableStyles(evidence).some((a) => a.id === s.id),
        })),
        /*
         * How finished the brand kit is, because an advert made without one is
         * the complaint this whole feature started from: colours from a
         * fallback and no logo at all.
         */
        brand: brandCompleteness(kit),
        balanceCents: (await walletOf(req.user.id)).balanceCents,
      });
    } catch (error) {
      console.error("Ad renders list error:", error);
      res.status(500).json({ message: "Couldn't load the adverts" });
    }
  });

  /** Order one. Charges the wallet, then returns the row to poll. */
  app.post("/api/projects/:id/ad-renders", isAuthenticated, rateLimit("ai"), async (req: any, res) => {
    try {
      const project = await reachable(req.params.id, req.user?.id);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const can = renderingAvailable();
      if (!can.ok) return res.status(503).json({ message: can.reason });

      const started = await startRender(req.user.id, project.id, {
        duration: Number(req.body?.duration),
        format: String(req.body?.format ?? ""),
        style: String(req.body?.style ?? ""),
        brief: String(req.body?.brief ?? ""),
      }, await evidenceFor(project.id));

      if (!started.ok) {
        return res.status(started.refusal.field === "balance" ? 402 : 400)
          .json({ message: started.refusal.message, field: started.refusal.field });
      }

      /*
       * Kicked off after the response rather than awaited. The first step
       * writes a script and submits several clips, which is well past the
       * point any proxy between here and a phone would have given up — and
       * the sweep would pick the row up anyway, so the only thing awaiting it
       * buys is a slower reply.
       */
      void advanceRender(started.render.id).catch((err) => {
        console.error(`[ad-render] first step failed for ${started.render.id}:`, err);
      });

      res.status(201).json(forClient(started.render));
    } catch (error) {
      console.error("Ad render create error:", error);
      res.status(500).json({ message: "Couldn't start that advert" });
    }
  });

  /** One render. A pure read: the sweep is what moves it along. */
  app.get("/api/ad-renders/:id", isAuthenticated, async (req: any, res) => {
    try {
      const [row] = await db.select().from(adRenders).where(eq(adRenders.id, req.params.id));
      if (!row) return res.status(404).json({ message: "Advert not found" });
      if (!(await reachable(row.projectId, req.user?.id))) return res.status(404).json({ message: "Advert not found" });
      res.json(forClient(row));
    } catch (error) {
      console.error("Ad render read error:", error);
      res.status(500).json({ message: "Couldn't load that advert" });
    }
  });

  /**
   * Push one render along by hand.
   *
   * The sweep does this every half minute, so this is not how an advert gets
   * made. It is here because a person watching a progress bar that has not
   * moved will refresh, and a refresh that actually asks is better than one
   * that waits for a timer it cannot see.
   */
  app.post("/api/ad-renders/:id/check", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const [row] = await db.select().from(adRenders).where(eq(adRenders.id, req.params.id));
      if (!row) return res.status(404).json({ message: "Advert not found" });
      if (!(await reachable(row.projectId, req.user?.id))) return res.status(404).json({ message: "Advert not found" });
      res.json(forClient(await advanceRender(row.id)));
    } catch (error) {
      console.error("Ad render check error:", error);
      res.status(500).json({ message: "Couldn't check that advert" });
    }
  });
}

/**
 * Every unfinished render, moved one step, every half minute.
 *
 * Behind the job lock so one instance does the work: two servers polling the
 * same provider task is harmless, but two servers compositing the same render
 * is two uploads and a race over which path the row ends up with.
 *
 * Half a minute because that is the shape of the wait — a clip takes a minute
 * or two, so a longer interval is a person watching a finished advert not
 * appear, and a shorter one is polling somebody else's API for no reason.
 */
export function startAdRenderJobs(): void {
  const sweep = async () => {
    await withJobLock(JOB.adRenders, async () => {
      for (const row of await unfinishedRenders()) {
        await advanceRender(row.id).catch((err) => {
          console.error(`[ad-render] sweep failed for ${row.id}:`, err);
        });
      }
    });
  };
  setInterval(() => { sweep().catch((err) => console.error("[ad-render] sweep failed:", err)); }, 30_000).unref();
}
