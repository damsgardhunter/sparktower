import { pool } from "./db";
import { applyModerationLogRules } from "./moderation-log-rules";
import { createServer } from "http";
import { networkInterfaces } from "os";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync, isStripeConfigured } from "./stripeClient";
import { syncPlatformRoles } from "./platform-roles";
import { backfillMissingProfiles } from "./user-provisioning";
import { loadSurfaceFlags, startSurfaceFlagRefresh } from "./surfaces";
import { startBackingJobs } from "./backing-jobs";
import { startSimulationJobs } from "./simulation-tick";
import { startStartupGameJobs } from "./startup-game";
import { startAnalyticsJobs } from "./analytics";
import { startPromotionJobs } from "./promotion-sync";
import { startModerationJobs } from "./moderation";
import { startRetentionJobs } from "./retention";
import { startRhythmJobs } from "./company-rhythm-jobs";
import { checkMerchFonts } from "./merch-render";
import { serveStatic } from "./static";
import { createApp, log } from "./app";
import { warnIfSharedTokenSecret } from "./mobile-auth";
import { warnIfEmailUnconfigured } from "./email";
import { warnIfSenderMisaligned, emailLinkHostIsTrusted } from "./public-url";
import { assertSecretsAtBoot } from "./secrets";
import { warnIfMigrationsPending } from "./migration-state";
import { assertEnvironmentAtBoot } from "./preflight";
import { watchProcessErrors } from "./error-reporting";
import { storageCredentialMode } from "./replit_integrations/object_storage/objectStorage";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

/*
 * Before anything listens or connects: is this deployment actually configured?
 *
 * The whole report first (server/preflight.ts), so an operator reading a
 * failed deploy sees everything that is wrong at once rather than fixing one
 * variable, deploying, and meeting the next one. In production a missing
 * database, session secret or public URL ends the process here; a missing
 * Stripe key or mail provider is printed and the server carries on, because
 * refusing to serve the site to protect an unconfigured feature is the larger
 * outage.
 */
assertEnvironmentAtBoot();

// Then the secrets themselves, which also derive the keys and so must throw
// rather than report: no secrets, or weak ones in production, no server.
assertSecretsAtBoot();

// A promise nobody caught and a throw outside every handler used to be a silent
// exit. They are reported now, like any other 500 (server/error-reporting.ts).
watchProcessErrors();

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

  // Feature kill switches, read before any route can be hit, then re-read on a
  // timer so a toggle reaches every instance rather than only the one that
  // served it — this deploys to autoscale.
  warnIfSharedTokenSecret();
  await warnIfMigrationsPending();
  // Email isn't an integration any more: without it, nobody who signs up can use the site (server/email.ts).
  warnIfEmailUnconfigured();
  /*
   * Two things about outbound mail that only show up as "nobody signed up":
   * a From domain that isn't the one SPF and DKIM were published for, and
   * email links pointing at a host the CSRF guard doesn't trust.
   */
  warnIfSenderMisaligned();
  {
    const link = emailLinkHostIsTrusted();
    if (!link.ok && link.reason) console.error(`[email] ${link.reason}`);
  }
  /*
   * Which credentials uploads will use, said once at boot. Storage failures
   * surface much later and far away — an avatar that won't save — and the
   * first question is always "which credentials did it even try".
   */
  if (process.env.PRIVATE_OBJECT_DIR) {
    console.log(`[storage] bucket ${process.env.PRIVATE_OBJECT_DIR} via ${storageCredentialMode()} credentials`);
  } else if (process.env.NODE_ENV === "production") {
    console.warn("[storage] PRIVATE_OBJECT_DIR is not set: uploads will fail. Production does not fall back to local disk.");
  }
  await loadSurfaceFlags();
  startSurfaceFlagRefresh();

  // Accounts created before profiles were provisioned at sign-up have no
  // profile row; give them one rather than waiting for each to log in again.
  await backfillMissingProfiles();

  // Reviewer rights are granted from the environment, never through the API,
  // and are re-derived here so a removed reviewer loses them on restart.
  await syncPlatformRoles();
  // The moderation log refuses edits and deletes at the database. A failure
  // here is logged rather than fatal: the site should still come up.
  await applyModerationLogRules((q) => pool.query(q)).catch((err) =>
    console.error("[moderation] Couldn't apply the append-only rule to moderation_log:", err));

  // Merch artwork is generated from committed font files; fail loudly at
  // boot rather than when someone's order needs a print file.
  checkMerchFonts();

  // Merch fulfillment and the refund window. Both take an advisory lock, so
  // running several server processes is safe.
  startBackingJobs();
  startSimulationJobs();
  startStartupGameJobs();
  startAnalyticsJobs();
  startPromotionJobs();
  startModerationJobs();
  // Spent credentials and finished ledger rows (server/retention.ts).
  startRetentionJobs();
  // Due-job and check-in-day reminders for companies on the Run path (server/company-rhythm-jobs.ts).
  startRhythmJobs();

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
  /*
   * Timeouts, so a stalled connection can't hold a slot indefinitely.
   *
   * Node's defaults are generous — and `headersTimeout` must stay above
   * `keepAliveTimeout`, or a connection the server is about to reuse gets
   * closed underneath a request that has already started, which surfaces as
   * random 502s behind a proxy rather than as a timeout.
   */
  httpServer.requestTimeout = 60_000;
  httpServer.headersTimeout = 35_000;
  httpServer.keepAliveTimeout = 30_000;

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

  /*
   * Shutting down without dropping what's in flight.
   *
   * A deploy sends SIGTERM and then waits a short while before SIGKILL. With no
   * handler, the process dies at once: requests being served are cut mid-flight
   * and the person sees a failed request, which reads as the site being flaky
   * rather than as a deploy. `/_ready` is made to answer false first, so a load
   * balancer stops sending new work while the old work finishes.
   *
   * The timer is unref'd and the whole thing runs once — a second SIGTERM
   * during a drain must not start a second drain.
   */
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    appReady = false;
    log(`${signal} received — refusing new connections, finishing what's in flight`);

    /*
     * The deadline is the point of this: `close` waits for every idle
     * keep-alive connection to go away on its own, which can outlast the
     * platform's patience. Past it we stop waiting and let the exit be abrupt,
     * because an abrupt exit at 10s is better than a SIGKILL at 30 with no log
     * line saying why.
     */
    const deadline = setTimeout(() => {
      log("shutdown took too long — exiting anyway");
      process.exit(1);
    }, 10_000);
    deadline.unref();

    httpServer.close((err) => {
      if (err) console.error("[shutdown] server close failed:", err);
      // The pool last: a request still finishing may need one more query.
      pool.end()
        .catch((e) => console.error("[shutdown] closing the database pool failed:", e))
        .finally(() => {
          clearTimeout(deadline);
          log("shutdown complete");
          process.exit(err ? 1 : 0);
        });
    });
  };

  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => shutdown(signal));
})();
