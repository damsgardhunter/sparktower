/**
 * Is Stripe actually talking to us? For the owner, and mostly for production.
 *
 * Every payment path — donations, backings, subscriptions — is only as live
 * as the webhook. An empty event ledger can mean "nobody has paid yet" or
 * "nothing can reach us", and the difference matters: the second is money
 * taken with nothing recorded. This says which, from what's in the database.
 */
import type { Express } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db, pool } from "./db";
import { donations, projectBackings, stripeEvents } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { requireOwner } from "./platform-roles";
import { isStripeConfigured } from "./stripeClient";

export function registerStripeHealthRoutes(app: Express) {
  app.get("/api/admin/stripe/health", isAuthenticated, requireOwner, async (_req, res) => {
    try {
      // The library keeps the endpoint it registered, and its signing secret, here.
      // Null when its schema isn't there at all: Stripe was never initialised.
      const managed: { url: string; status: string }[] | null = await pool
        .query(`SELECT url, status FROM "stripe"."_managed_webhooks"`)
        .then((r) => r.rows as { url: string; status: string }[], () => null);

      const byStatus = await db.select({
        status: stripeEvents.status,
        count: sql<number>`count(*)::int`,
        lastReceivedAt: sql<string | null>`max(${stripeEvents.receivedAt})`,
      }).from(stripeEvents).groupBy(stripeEvents.status);
      const recentFailures = await db.select({ id: stripeEvents.id, type: stripeEvents.type, error: stripeEvents.error, receivedAt: stripeEvents.receivedAt })
        .from(stripeEvents).where(eq(stripeEvents.status, "failed")).orderBy(desc(stripeEvents.receivedAt)).limit(5);
      const [donationCounts] = await db.select({
        total: sql<number>`count(*)::int`,
        refunded: sql<number>`count(*) filter (where ${donations.refundedAt} is not null)::int`,
        partlyRefunded: sql<number>`count(*) filter (where ${donations.refundedAmount} > 0 and ${donations.refundedAt} is null)::int`,
      }).from(donations);
      const backings = await db.select({ status: projectBackings.status, count: sql<number>`count(*)::int` })
        .from(projectBackings).groupBy(projectBackings.status);

      const total = byStatus.reduce((n, r) => n + r.count, 0);
      const lastReceivedAt = byStatus.map((r) => r.lastReceivedAt).filter(Boolean).sort().pop() ?? null;
      const webhookSecret = Boolean(process.env.STRIPE_WEBHOOK_SECRET) || (managed?.length ?? 0) > 0;
      const verdict =
        !isStripeConfigured() ? "not_configured"
        : !webhookSecret ? "no_webhook_secret"
        : total === 0 ? "waiting_for_first_event"
        : recentFailures.length ? "receiving_with_failures"
        : "receiving";

      res.json({
        verdict,
        configured: {
          apiKey: isStripeConfigured(),
          webhookSecretFromEnv: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
          managedWebhooks: managed ?? [],
        },
        events: { total, byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.count])), lastReceivedAt, recentFailures },
        donations: donationCounts,
        backings: Object.fromEntries(backings.map((r) => [r.status, r.count])),
      });
    } catch (error) {
      console.error("Stripe health error:", error);
      res.status(500).json({ message: "Couldn't read Stripe's state" });
    }
  });
}
