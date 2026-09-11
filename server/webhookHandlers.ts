import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { db } from './db';
import { users, donations, projects, projectBackings, projectMerchOrders, stripeEvents } from '@shared/schema';
import { isPaidSubscriptionStatus } from '@shared/subscriptions';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { recordBacking } from './backing-routes';

/** Thrown only when the signature check fails: the caller answers 400, and Stripe does not retry. */
export class WebhookVerificationError extends Error {
  constructor(message: string) { super(message); this.name = "WebhookVerificationError"; }
}

export class WebhookHandlers {
  /**
   * One gate, then the work.
   *
   * Verification happens once, in the sync client, and throws on a bad
   * signature. Only after that is the payload parsed — there used to be a
   * second constructEvent call with an empty secret whose failure was the
   * normal path, which read as an unverified fallback. It wasn't, but code
   * that has to be explained is code that will be misread.
   *
   * Then the ledger: each event id is claimed before processing. Already
   * processed means done, in flight means skip, failed means try again.
   * Handlers throw on failure; the claim is marked failed and the error
   * propagates so the endpoint answers 5xx and Stripe retries. A handler
   * that swallowed its errors and returned 200 told Stripe everything was
   * fine while the donation went unrecorded.
   */
  static async processWebhook(payload: Buffer, signature: string): Promise<{ eventId: string | null; duplicate: boolean }> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const sync = await getStripeSync();
    try {
      await sync.processWebhook(payload, signature);
    } catch (err) {
      const message = String((err as Error)?.message ?? "");
      /*
       * No secret to check against is our misconfiguration, not a forgery.
       * It used to surface as a 400 — and Stripe never retries a 400 — so a
       * deployment whose webhook registration was missing dropped every
       * payment event without a trace. As a 500 it's retried for three days
       * and shows up in Stripe's dashboard as failing.
       */
      if (/no webhook secret/i.test(message)) {
        console.error("[stripe] Webhook received but no signing secret is configured — set STRIPE_WEBHOOK_SECRET or register the endpoint (PUBLIC_URL). Stripe will retry.");
        throw new Error("Stripe webhook signing secret is not configured");
      }
      throw new WebhookVerificationError(message || "Signature verification failed");
    }

    // Verified above; parsing the bytes we verified is the only honest source of the event.
    const event = JSON.parse(payload.toString());
    const eventId: string | null = typeof event?.id === "string" ? event.id : null;
    const type: string = String(event?.type ?? "unknown");

    if (eventId) {
      const claimed = await WebhookHandlers.claim(eventId, type);
      if (!claimed) return { eventId, duplicate: true };
    }
    try {
      await WebhookHandlers.handleSubscriptionEvent(event);
      await WebhookHandlers.handleCheckoutCompleted(event);
      await WebhookHandlers.handleRefund(event);
      await WebhookHandlers.handlePaymentFailure(event);
      if (eventId) await db.update(stripeEvents).set({ status: "processed", processedAt: new Date(), error: null }).where(eq(stripeEvents.id, eventId));
      return { eventId, duplicate: false };
    } catch (err) {
      if (eventId) await db.update(stripeEvents).set({ status: "failed", error: String((err as Error)?.message ?? err).slice(0, 500) }).where(eq(stripeEvents.id, eventId)).catch(() => {});
      throw err;
    }
  }

  /** True when this delivery should be processed: first sight, or a retry of a failure. */
  static async claim(eventId: string, type: string): Promise<boolean> {
    const inserted = await db.insert(stripeEvents).values({ id: eventId, type, status: "processing" }).onConflictDoNothing().returning({ id: stripeEvents.id });
    if (inserted.length) return true;
    const [existing] = await db.select().from(stripeEvents).where(eq(stripeEvents.id, eventId));
    if (existing?.status !== "failed") return false;
    await db.update(stripeEvents).set({ status: "processing", error: null }).where(eq(stripeEvents.id, eventId));
    return true;
  }

  /** The tier a subscription entitles, from the price's metadata. Throws if Stripe can't be asked; that is a retry, not a silent free tier. */
  static async tierForSubscription(subscription: any): Promise<string> {
    const priceId = subscription.items?.data?.[0]?.price?.id || subscription.items?.data?.[0]?.plan?.id;
    if (!priceId) return 'free';
    const stripe = await getUncachableStripeClient();
    const price = await stripe.prices.retrieve(priceId);
    return price.metadata?.tier || 'free';
  }

  static async handleSubscriptionEvent(event: any): Promise<void> {
    const type = event.type;
    if (!type?.startsWith('customer.subscription.')) return;
    const subscription = event.data?.object;
    if (!subscription?.customer) return;
    const [user] = await db.select().from(users).where(eq(users.stripeCustomerId, subscription.customer));
    if (!user) return;

    if (type === 'customer.subscription.deleted') {
      await db.update(users).set({ subscriptionTier: 'free', stripeSubscriptionId: null }).where(eq(users.id, user.id));
      console.log(`Subscription canceled for user ${user.id}, reverted to free tier`);
      return;
    }
    if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
      const status = subscription.status;
      if (!isPaidSubscriptionStatus(status)) {
        await db.update(users).set({ subscriptionTier: 'free', stripeSubscriptionId: subscription.id }).where(eq(users.id, user.id));
        return;
      }
      const tier = await WebhookHandlers.tierForSubscription(subscription);
      await db.update(users).set({ subscriptionTier: tier, stripeSubscriptionId: subscription.id }).where(eq(users.id, user.id));
      console.log(`Subscription updated for user ${user.id}: tier=${tier}`);
    }
  }

  static async handleCheckoutCompleted(event: any): Promise<void> {
    if (event.type !== 'checkout.session.completed') return;
    const session = event.data?.object;
    if (!session) return;

    // Backing pledges are held in escrow and have their own ledger, believer
    // numbers and merch queue — see server/backing-routes.ts. It dedupes by
    // session id itself. Errors propagate: a lost pledge is worth a retry.
    if (session.metadata?.type === 'backing') { await recordBacking(session); return; }

    if (session.metadata?.type === 'donation') {
      const { projectId, donorId, amount } = session.metadata;
      if (!projectId || !donorId || !amount) return;
      const amountCents = parseInt(amount);
      // The session id is unique on donations: a redelivery inserts nothing
      // and therefore increments nothing. The two writes are one transaction.
      await db.transaction(async (tx) => {
        const inserted = await tx.insert(donations).values({
          projectId, donorId, amount: amountCents, message: "Stripe donation",
          stripeSessionId: session.id ?? null,
          stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
        }).onConflictDoNothing({ target: donations.stripeSessionId }).returning({ id: donations.id });
        if (!inserted.length) return;
        await tx.update(projects).set({ totalDonations: sql`${projects.totalDonations} + ${amountCents}` }).where(eq(projects.id, projectId));
      });
      console.log(`Donation recorded: $${amountCents / 100} to project ${projectId} from ${donorId}`);
      return;
    }

    // A subscription bought through checkout: the tier follows the payment,
    // not the next subscription event that may or may not arrive first.
    if (session.mode === 'subscription' && session.subscription && session.customer) {
      const [user] = await db.select().from(users).where(eq(users.stripeCustomerId, session.customer));
      if (!user) return;
      const stripe = await getUncachableStripeClient();
      const subscription = await stripe.subscriptions.retrieve(typeof session.subscription === "string" ? session.subscription : session.subscription.id);
      const tier = isPaidSubscriptionStatus(subscription.status) ? await WebhookHandlers.tierForSubscription(subscription) : 'free';
      await db.update(users).set({ subscriptionTier: tier, stripeSubscriptionId: subscription.id }).where(eq(users.id, user.id));
      console.log(`Checkout subscription for user ${user.id}: tier=${tier}`);
    }
  }

  /**
   * Money going back.
   *
   * Stripe sends `charge.refunded` for every refund on a charge, partial ones
   * included, each carrying the charge's running `amount_refunded`. So what
   * gets recorded is that running total, and the project's figure moves by
   * the difference from what was recorded before. That makes the handler
   * idempotent across *different* events for the same refund, not just
   * redeliveries of one event (the ledger handles those): the same running
   * total twice moves nothing. It also fixes the partial refund, which used
   * to mark the whole donation refunded and take all of it off the total.
   *
   * Rows are locked for the decision, so two refund events for one charge
   * processed at the same moment can't both move the total.
   */
  static async handleRefund(event: any): Promise<void> {
    if (event.type !== 'charge.refunded') return;
    const charge = event.data?.object;
    if (!charge) return;
    const paymentIntent: string | null = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? null;
    const chargeId: string | null = charge.id ?? null;
    if (!paymentIntent && !chargeId) return;
    const match = (piCol: any, chCol: any) => or(
      ...(paymentIntent ? [eq(piCol, paymentIntent)] : []),
      ...(chargeId ? [eq(chCol, chargeId)] : []),
    );
    // Real charge.refunded events always carry both. One without a running
    // total is read as a full refund, which is what this handler always did.
    const refundedSoFar: number = typeof charge.amount_refunded === "number" ? Math.max(0, charge.amount_refunded) : Number.POSITIVE_INFINITY;
    const inFull = charge.refunded === true || refundedSoFar === Number.POSITIVE_INFINITY;
    const latestRefundId: string | null = charge.refunds?.data?.[0]?.id ?? null;

    await db.transaction(async (tx) => {
      const [donation] = await tx.select().from(donations).where(match(donations.stripePaymentIntentId, donations.stripeChargeId)).for("update");
      if (donation) {
        const nowRefunded = Math.min(donation.amount, inFull ? donation.amount : refundedSoFar);
        const delta = nowRefunded - (donation.refundedAmount ?? 0);
        if (delta > 0) {
          await tx.update(donations).set({
            refundedAmount: nowRefunded,
            refundedAt: nowRefunded >= donation.amount ? new Date() : donation.refundedAt,
            stripeChargeId: donation.stripeChargeId ?? chargeId,
          }).where(eq(donations.id, donation.id));
          await tx.update(projects).set({ totalDonations: sql`greatest(0, ${projects.totalDonations} - ${delta})` }).where(eq(projects.id, donation.projectId));
          console.log(`Donation ${donation.id}: ${nowRefunded}/${donation.amount} cents refunded; project ${donation.projectId} total reduced by ${delta}`);
        }
      }

      const [backing] = await tx.select({ id: projectBackings.id, status: projectBackings.status, amountCents: projectBackings.amountCents, projectId: projectBackings.projectId })
        .from(projectBackings).where(match(projectBackings.stripePaymentIntentId, projectBackings.stripeChargeId)).for("update");
      if (backing && backing.status !== 'refunded') {
        if (!inFull && refundedSoFar < backing.amountCents) {
          // A backing is escrow: it's held, released or refunded, not part of
          // each. A partial refund is someone acting in the Stripe dashboard,
          // and it needs a person to decide what the backing now is.
          console.warn(`[stripe] partial refund on backing ${backing.id}: ${refundedSoFar}/${backing.amountCents} cents — left ${backing.status} for a reviewer`);
          return;
        }
        await tx.update(projectBackings).set({ status: 'refunded', stripeRefundId: latestRefundId, resolvedAt: new Date() }).where(eq(projectBackings.id, backing.id));
        // Refunded outside the platform's own sweep — the dashboard, a dispute.
        // The public "raised" figure gives the money back here, and only here:
        // the move to "refunded" is the guard, and the sweep checks it too.
        await tx.update(projects).set({ totalDonations: sql`greatest(0, ${projects.totalDonations} - ${backing.amountCents})` }).where(eq(projects.id, backing.projectId));
        await tx.update(projectMerchOrders).set({ status: 'canceled', updatedAt: new Date() })
          .where(and(eq(projectMerchOrders.backingId, backing.id), inArray(projectMerchOrders.status, ['queued', 'failed'])));
        console.log(`Backing ${backing.id} refunded from Stripe; project ${backing.projectId} total reduced by ${backing.amountCents}`);
      }
    });
  }

  /**
   * A failed payment is acknowledged and recorded; entitlements follow the
   * subscription's status, which Stripe sends as its own event (past_due,
   * unpaid → free tier above). Recording here means the ledger shows the
   * failure even when that status event is late.
   */
  static async handlePaymentFailure(event: any): Promise<void> {
    if (event.type !== 'invoice.payment_failed' && event.type !== 'payment_intent.payment_failed') return;
    const obj = event.data?.object;
    const customer = typeof obj?.customer === "string" ? obj.customer : obj?.customer?.id;
    if (!customer) return;
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.stripeCustomerId, customer));
    console.warn(`[stripe] ${event.type} for customer ${customer}${user ? ` (user ${user.id})` : " (no user)"}: ${obj?.last_payment_error?.message ?? obj?.failure_message ?? "no message"}`);
  }
}
