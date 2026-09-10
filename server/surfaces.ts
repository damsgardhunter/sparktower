/**
 * Runtime kill switches for feature areas.
 *
 * The load-bearing piece is `requireSurface`. Hiding a nav link on the client
 * while its endpoint still accepts writes is not switching a feature off — it
 * just makes the feature undiscoverable to honest users. The server has to be
 * the one saying no.
 *
 * Flags are cached in memory and refreshed on write, because this middleware
 * sits in front of ordinary requests and must not add a query to each one.
 */
import type { Express, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { surfaceFlags } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { requireReviewer } from "./platform-roles";
import {
  SURFACES, SURFACE_IDS, defaultSurfaceMap, surface,
} from "@shared/surfaces";
import { logModeration } from "./moderation";

let cache: Record<string, boolean> = defaultSurfaceMap();
let loaded = false;

/** Reads the flags into memory. Called at boot and after every change. */
export async function loadSurfaceFlags(): Promise<Record<string, boolean>> {
  try {
    const rows = await db.select().from(surfaceFlags);
    const next = defaultSurfaceMap();
    for (const row of rows) {
      // A row for a surface that no longer exists is ignored rather than
      // resurrected — the registry is the source of truth for what exists.
      if (row.surfaceId in next) next[row.surfaceId] = row.enabled;
    }
    cache = next;
    loaded = true;
  } catch (err) {
    /*
     * Fall back to the shipped defaults rather than failing closed on
     * everything. A database blip shouldn't take the whole product down, and
     * the defaults are the conservative set anyway.
     */
    console.error("[surfaces] Could not load flags, using defaults:", err);
    cache = defaultSurfaceMap();
  }
  return cache;
}

/**
 * How stale a flag may get on an instance that didn't serve the toggle.
 *
 * The cache is per-process and was refreshed only at boot and by whichever
 * instance handled the change. `.replit` deploys to `autoscale`, which runs
 * several — so turning a surface off updated one of them and left the rest
 * serving it until they happened to restart. A kill switch that works on one
 * instance out of N is not a kill switch, and the moment you need one is the
 * moment you cannot wait for a deploy.
 *
 * Polling rather than a notification channel: ten seconds of staleness is
 * nothing against "until restart", and this needs no new moving parts to be
 * correct however many instances are running.
 */
const REFRESH_MS = 10_000;

/** Starts the periodic re-read. Safe to call more than once. */
let refresher: ReturnType<typeof setInterval> | null = null;
export function startSurfaceFlagRefresh(): void {
  if (refresher) return;
  refresher = setInterval(() => { void loadSurfaceFlags(); }, REFRESH_MS);
  // Must not hold the process open — this is a cache, not work.
  refresher.unref();
}

/** Stops the periodic re-read. Tests call it so a finished app leaves nothing ticking. */
export function stopSurfaceFlagRefresh(): void {
  if (refresher) clearInterval(refresher);
  refresher = null;
}

export const surfaceEnabled = (id: string): boolean => cache[id] !== false;

export const surfaceMap = (): Record<string, boolean> => ({ ...cache });

/**
 * Blocks a route family when its surface is off.
 *
 * Returns 404, not 403: a disabled surface should be indistinguishable from
 * one that was never built, so probing the API can't map what's behind the
 * curtain.
 */
export function requireSurface(id: string): RequestHandler {
  return (_req, res, next) => {
    if (surfaceEnabled(id)) return next();
    res.status(404).json({ message: "Not found" });
  };
}

export function registerSurfaceRoutes(app: Express) {
  /**
   * What's on. Public and unauthenticated — the nav needs it before login,
   * and the answer is the same for everyone.
   */
  app.get("/api/surfaces", (_req, res) => {
    res.json({ enabled: surfaceMap(), loaded });
  });

  /** The full registry with notes, for the admin toggle. */
  app.get("/api/admin/surfaces", isAuthenticated, requireReviewer, (_req, res) => {
    const enabled = surfaceMap();
    res.json({
      surfaces: SURFACES.map((s) => ({ ...s, enabled: enabled[s.id] !== false })),
    });
  });

  app.patch("/api/admin/surfaces/:id", isAuthenticated, requireReviewer, async (req: any, res) => {
    try {
      const id = String(req.params.id);
      if (!SURFACE_IDS.includes(id)) {
        return res.status(404).json({ message: "No such surface" });
      }
      const enabled = Boolean(req.body?.enabled);

      await db.insert(surfaceFlags)
        .values({ surfaceId: id, enabled, updatedById: req.user.id, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: surfaceFlags.surfaceId,
          set: { enabled, updatedById: req.user.id, updatedAt: new Date() },
        });

      await loadSurfaceFlags();
      console.log(`[surfaces] ${id} -> ${enabled ? "on" : "off"} by ${req.user.id}`);
      await logModeration({
        action: "surface_toggled", actorId: req.user.id,
        targetType: "surface", targetId: id, details: { enabled },
      });
      res.json({ id, enabled, label: surface(id)?.label });
    } catch (error) {
      console.error("Surface toggle error:", error);
      res.status(500).json({ message: "Couldn't change that" });
    }
  });
}
