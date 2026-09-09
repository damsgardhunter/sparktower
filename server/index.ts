import { createServer } from "http";
import { networkInterfaces } from "os";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync, isStripeConfigured } from "./stripeClient";
import { ensureGameBadges } from "./badge-seed";
import { syncPlatformRoles } from "./platform-roles";
import { backfillMissingProfiles } from "./user-provisioning";
import { loadSurfaceFlags, startSurfaceFlagRefresh } from "./surfaces";
import { startBackingJobs } from "./backing-jobs";
import { startAnalyticsJobs } from "./analytics";
import { startModerationJobs } from "./moderation";
import { checkMerchFonts } from "./merch-render";
import { serveStatic } from "./static";
import { createApp, log } from "./app";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

const httpServer = createServer();

/*
 * Flipped once the server is listening. Until then `GET /` answers a bare 200
 * so a platform health probe doesn't fail the deploy while the startup work
 * below is still running.
 */
let appReady = false;

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

  // Feature kill switches, read before any route can be hit, then re-read on a
  // timer so a toggle reaches every instance rather than only the one that
  // served it — this deploys to autoscale.
  await loadSurfaceFlags();
  startSurfaceFlagRefresh();

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
  startModerationJobs();

  const app = await createApp({
    httpServer,
    isReady: () => appReady,
    logRequests: true,
  });
  httpServer.on("request", app);

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

    /*
     * The addresses other machines on the network can use.
     *
     * The server already binds 0.0.0.0, so this was always reachable from a
     * phone or a laptop on the same wifi — but only if you knew the address,
     * and the log said "port 5001" as though localhost were the only way in.
     * Printing it is the whole difference between "it's accessible" and
     * "someone else can actually open it".
     */
    for (const [name, addrs] of Object.entries(networkInterfaces())) {
      for (const addr of addrs ?? []) {
        if (addr.family === "IPv4" && !addr.internal) {
          log(`  on this network: http://${addr.address}:${port}  (${name})`);
        }
      }
    }
  });
})();
