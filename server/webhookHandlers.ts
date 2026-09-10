import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { db } from './db';
import { users, donations, projects, projectBackings, stripeEvents } from '@shared/schema';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
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
      throw new WebhookVerificationError((err as Error)?.message ?? "Signature verification failed");
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
      if (status !== 'active' && status !== 'trialing') {
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
      const tier = (subscription.status === 'active' || subscription.status === 'trialing') ? await WebhookHandlers.tierForSubscription(subscription) : 'free';
      await db.update(users).set({ subscriptionTier: tier, stripeSubscriptionId: subscription.id }).where(eq(users.id, user.id));
      console.log(`Checkout subscription for user ${user.id}: tier=${tier}`);
    }
  }

  /**
   * Money going back. A refunded donation is marked and the project's total
   * comes down once; a refunded backing moves to its refunded state. Matched
   * on the payment intent or the charge, whichever the event carries.
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

    await db.transaction(async (tx) => {
      const [donation] = await tx.select().from(donations).where(and(match(donations.stripePaymentIntentId, donations.stripeChargeId), isNull(donations.refundedAt)));
      if (donation) {
        await tx.update(donations).set({ refundedAt: new Date(), stripeChargeId: donation.stripeChargeId ?? chargeId }).where(eq(donations.id, donation.id));
        await tx.update(projects).set({ totalDonations: sql`greatest(0, ${projects.totalDonations} - ${donation.amount})` }).where(eq(projects.id, donation.projectId));
        console.log(`Donation ${donation.id} refunded; project ${donation.projectId} total reduced by ${donation.amount}`);
      }
      const [backing] = await tx.select({ id: projectBackings.id, status: projectBackings.status }).from(projectBackings).where(match(projectBackings.stripePaymentIntentId, projectBackings.stripeChargeId));
      if (backing && backing.status !== 'refunded') {
        await tx.update(projectBackings).set({ status: 'refunded', stripeRefundId: charge.refunds?.data?.[0]?.id ?? null, resolvedAt: new Date() }).where(eq(projectBackings.id, backing.id));
        console.log(`Backing ${backing.id} marked refunded from Stripe`);
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
