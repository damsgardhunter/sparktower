/**
 * Your data: take a copy, or leave.
 *
 * Both routes act only on the caller's own account — there is no id in either
 * path, so there is nothing to tamper with. Deleting asks for the password
 * again (and a second factor where one is set up), because a borrowed session
 * must not be able to erase someone's work.
 *
 * What each one does with which tables is in server/account-data.ts.
 */
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { deleteAccount, exportAccount } from "./account-data";
import { checkSecondFactor, countWrongMfaCode, limitMfaAttempts, mfaEnabledFor } from "./mfa";
import { getUncachableStripeClient } from "./stripeClient";

/** Subscription states Stripe will never bill again. */
const FINISHED = new Set(["canceled", "incomplete_expired"]);

/**
 * Stops the billing before the record of it is erased.
 *
 * Deleting an account nulls `stripe_customer_id` and `stripe_subscription_id`
 * on the tombstone — and nothing cancelled the subscription first. So a paying
 * member who deleted their account went on being charged every month, and when
 * the next invoice arrived the webhook could not match it to anyone, because
 * the only link between that customer and this account had just been
 * deleted. Nobody would have known until the card statement.
 *
 * Every live subscription on the customer is cancelled, not only the one on
 * the row: a checkout that completed twice, or a plan change that left an old
 * subscription behind, bills just the same. Cancelled now rather than at the
 * end of the period — the account the period pays for no longer exists.
 *
 * An account with no billing never reaches Stripe, so a free account can be
 * deleted on a deployment with Stripe unconfigured or down.
 */
async function cancelBilling(user: { stripeCustomerId: string | null; stripeSubscriptionId: string | null }): Promise<number> {
  if (!user.stripeCustomerId && !user.stripeSubscriptionId) return 0;
  const stripe = await getUncachableStripeClient();

  const live = new Map<string, string>();
  if (user.stripeCustomerId) {
    const subs = await stripe.subscriptions.list({ customer: user.stripeCustomerId, status: "all", limit: 100 });
    for (const sub of subs.data) live.set(sub.id, sub.status);
  }
  if (user.stripeSubscriptionId && !live.has(user.stripeSubscriptionId)) {
    try {
      const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      live.set(sub.id, sub.status);
    } catch (err: any) {
      // Already gone from Stripe: nothing left to bill.
      if (err?.code !== "resource_missing") throw err;
    }
  }

  let cancelled = 0;
  for (const [id, status] of live) {
    if (FINISHED.has(status)) continue;
    await stripe.subscriptions.cancel(id);
    cancelled += 1;
  }
  return cancelled;
}

export function registerAccountRoutes(app: Express) {
  /** Everything we hold on the account, as a JSON file. */
  app.get("/api/account/export", isAuthenticated, rateLimit("session"), async (req: any, res) => {
    try {
      const data = await exportAccount(req.user.id);
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="sparktower-export-${stamp}.json"`);
      res.send(JSON.stringify(data, null, 2));
    } catch (error: any) {
      if (error?.status === 404) return res.status(404).json({ message: "No such account" });
      console.error("Account export error:", error);
      res.status(500).json({ message: "Couldn't build your export. Try again in a minute." });
    }
  });

  /**
   * Closes the account for good.
   *
   * `keepPosts` is the person's choice about what other people can still read:
   * their posts and comments stay under "Deleted account", or go with
   * everything else. Projects with other members are handed over, never deleted.
   */
  app.post("/api/account/delete", isAuthenticated, rateLimit("session"), async (req: any, res) => {
    try {
      const userId = req.user.id;
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return res.status(404).json({ message: "No such account" });

      // Proof it's them, not a borrowed tab. An account with no password (Google only) is asked to type the phrase instead.
      if (user.passwordHash) {
        const password = String(req.body?.password ?? "");
        if (!password || !(await bcrypt.compare(password, user.passwordHash))) {
          return res.status(401).json({ message: "That password isn't right.", code: "bad_password", field: "password" });
        }
      } else if (String(req.body?.confirm ?? "").trim().toLowerCase() !== "delete my account") {
        return res.status(400).json({ message: 'Type "delete my account" to confirm.', code: "confirm_required", field: "confirm" });
      }

      if (mfaEnabledFor(user)) {
        if (!(await limitMfaAttempts(req, res, userId))) return;
        const method = await checkSecondFactor(userId, String(req.body?.code ?? ""));
        if (!method) {
          await countWrongMfaCode(userId);
          return res.status(401).json({ message: "That code isn't right.", code: "mfa_invalid_code", field: "code" });
        }
      }

      /*
       * Billing first, and fail closed. If Stripe can't be reached the account
       * is left exactly as it was: deleting it anyway would erase the only
       * record of which subscription to cancel, and turn "try again later"
       * into "charged indefinitely by an account that no longer exists".
       */
      let billingCancelled = 0;
      try {
        billingCancelled = await cancelBilling(user);
      } catch (err) {
        console.error("[account] couldn't cancel billing before deleting", userId, err);
        return res.status(502).json({
          message: "We couldn't cancel your subscription just now, so nothing was deleted. Try again in a minute — your account and plan are unchanged.",
          code: "billing_cancel_failed",
        });
      }

      const outcome = { ...(await deleteAccount(userId, { keepPosts: req.body?.keepPosts === true })), billingCancelled };

      // The session this came in on is already gone from the store; clear the cookie too.
      req.logout?.(() => {
        req.session?.destroy?.(() => {
          res.clearCookie("connect.sid");
          res.json({ ok: true, ...outcome });
        });
      });
      // No passport on this request (a bearer-token client): answer anyway.
      if (!req.logout) res.json({ ok: true, ...outcome });
    } catch (error) {
      console.error("Account delete error:", error);
      res.status(500).json({ message: "Couldn't close the account. Nothing was changed." });
    }
  });
}
