import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync, isStripeConfigured } from "./stripeClient";
import { WebhookHandlers } from "./webhookHandlers";
import { ensureGameBadges } from "./badge-seed";
import { syncPlatformRoles } from "./platform-roles";
import { backfillMissingProfiles } from "./user-provisioning";
import { loadSurfaceFlags } from "./surfaces";
import { startBackingJobs } from "./backing-jobs";
import { startAnalyticsJobs } from "./analytics";
import { checkMerchFonts } from "./merch-render";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.get("/_health", (_req, res) => {
  res.sendStatus(200);
});

let appReady = false;
app.use((req, res, next) => {
  if (!appReady && req.path === "/" && req.method === "GET") {
    return res.status(200).send("OK");
  }
  next();
});

app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      return res.status(400).json({ error: "Missing stripe-signature" });
    }
    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      if (!Buffer.isBuffer(req.body)) {
        return res.status(500).json({ error: "Webhook processing error" });
      }
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error("Webhook error:", error.message);
      res.status(400).json({ error: "Webhook processing error" });
    }
  }
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

/**
 * Express 5 leaves `req.body` as `undefined` when a request carries no body,
 * where Express 4 left it `{}`. Handlers all over this codebase read
 * `req.body.foo` directly, so a bodyless POST — which is exactly what
 * `apiRequest("POST", url)` sends with no data — threw
 * "Cannot read properties of undefined" and surfaced as a generic 500.
 *
 * Normalizing here fixes every such route at once.
 */
app.use((req, _res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

function stripPasswordHash(obj: any): any {
  if (obj === null || obj === undefined || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripPasswordHash);
  if (obj instanceof Date) return obj;
  const result: any = {};
  for (const key of Object.keys(obj)) {
    if (key === "passwordHash") continue;
    result[key] = typeof obj[key] === "object" ? stripPasswordHash(obj[key]) : obj[key];
  }
  return result;
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    const sanitized = stripPasswordHash(bodyJson);
    capturedJsonResponse = sanitized;
    return originalResJson.apply(res, [sanitized, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.log("Skipping Stripe init: DATABASE_URL not set");
    } else if (!isStripeConfigured()) {
      console.log("Skipping Stripe init: no Stripe credentials (set STRIPE_SECRET_KEY to enable)");
    } else {
      console.log("Initializing Stripe schema...");
      await runMigrations({ databaseUrl });
      console.log("Stripe schema ready");

      const stripeSync = await getStripeSync();

      // Stripe can only reach a publicly routable URL, so skip webhook
      // registration when running locally without one.
      const publicDomain = process.env.PUBLIC_URL || process.env.REPLIT_DOMAINS?.split(",")[0];
      if (publicDomain) {
        const webhookBaseUrl = publicDomain.startsWith("http") ? publicDomain : `https://${publicDomain}`;
        const webhookResult = await stripeSync.findOrCreateManagedWebhook(
          `${webhookBaseUrl}/api/stripe/webhook`
        );
        console.log("Webhook configured:", JSON.stringify(webhookResult?.webhook?.url || webhookResult?.id || "ok"));
      } else {
        console.log("Skipping Stripe webhook registration: no public URL (set PUBLIC_URL to enable)");
      }

      stripeSync.syncBackfill()
        .then(() => console.log("Stripe data synced"))
        .catch((err: any) => console.error("Error syncing Stripe data:", err));
    }
  } catch (stripeErr) {
    console.error("Stripe init failed (non-fatal):", stripeErr);
  }

  // Game badges are referenced by hard-coded id, so their rows have to exist.
  await ensureGameBadges();

  // Feature kill switches, read before any route can be hit.
  await loadSurfaceFlags();

  // Accounts created before profiles were provisioned at sign-up have no
  // profile row; give them one rather than waiting for each to log in again.
  await backfillMissingProfiles();

  // Reviewer rights are granted from the environment, never through the API,
  // and are re-derived here so a removed reviewer loses them on restart.
  await syncPlatformRoles();

  // Merch artwork is generated from committed font files; fail loudly at
  // boot rather than when someone's order needs a print file.
  checkMerchFonts();

  // Merch fulfillment and the refund window. Both take an advisory lock, so
  // running several server processes is safe.
  startBackingJobs();
  startAnalyticsJobs();

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  const listenOptions: any = {
    port,
    host: "0.0.0.0",
  };
  // reusePort may not be supported in some macOS environments; enable only when not darwin
  if (process.platform !== "darwin") {
    listenOptions.reusePort = true;
  }
  httpServer.listen(listenOptions, () => {
    appReady = true;
    log(`serving on port ${port}`);
  });
})();
