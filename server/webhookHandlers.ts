import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { db } from './db';
import { users, donations, projects, projectBackings, projectMerchOrders, stripeEvents, simSeatPurchases, companies, gamePlayPurchases } from '@shared/schema';
import { isPaidSubscriptionStatus } from '@shared/subscriptions';
import { normalizeTier } from '@shared/plans';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { applyTier, onInvoicePaid, onSubscriptionPaymentFailed, onSubscriptionChargeRefunded } from "./billing-credits";
import { recordBacking } from './backing-routes';
import { settleTier } from './subscription-state';

/** Thrown only when the signature check fails: the caller answers 400, and Stripe does not retry. */
export class WebhookVerificationError extends Error {
  constructor(message: string) { super(message); this.name = "WebhookVerificationError"; }
}

/** A paid price whose tier can't be read. Never read as "free": that would downgrade someone who is paying. */
export class PriceTierMissingError extends Error {
  constructor(public priceId: string) { super(`Stripe price ${priceId} has no tier in its metadata or its product's`); }
}

/**
 * The tier a price entitles — from the price's metadata, else its product's,
 * the same two places the pricing page reads when it offers checkout. A price
 * with neither is a misconfiguration: it throws (the webhook answers 500 and
 * Stripe retries, visibly failing in its dashboard and Stripe health) rather
 * than quietly setting a paying subscriber to free.
 */
export async function tierForPrice(priceId: string): Promise<string> {
  const stripe = await getUncachableStripeClient();
  const price: any = await stripe.prices.retrieve(priceId, { expand: ['product'] });
  const product = typeof price.product === 'object' ? price.product : null;
  const raw = price.metadata?.tier || product?.metadata?.tier;
  const tier = normalizeTier(raw);
  if (!raw || (tier === 'free' && raw !== 'free')) throw new PriceTierMissingError(priceId);
  return tier;
}

/** A claim "processing" longer than this is a dead attempt. Handlers take seconds; Stripe's retries come minutes to hours apart. */
export const STALE_CLAIM_MINUTES = 10;

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
      await WebhookHandlers.handleDispute(event);
      await WebhookHandlers.handlePaymentFailure(event);
      await onInvoicePaid(event, async (subscriptionId) => {
        const stripe = await getUncachableStripeClient();
        return WebhookHandlers.tierForSubscription(await stripe.subscriptions.retrieve(subscriptionId));
      });
      if (eventId) await db.update(stripeEvents).set({ status: "processed", processedAt: new Date(), error: null }).where(eq(stripeEvents.id, eventId));
      return { eventId, duplicate: false };
    } catch (err) {
      if (eventId) await db.update(stripeEvents).set({ status: "failed", error: String((err as Error)?.message ?? err).slice(0, 500) }).where(eq(stripeEvents.id, eventId)).catch(() => {});
      throw err;
    }
  }

  /**
   * True when this delivery should be processed: first sight, a retry of a
   * failure, or a takeover of an attempt that died while "processing".
   *
   * One atomic statement each, so two deliveries arriving together can't both
   * win. Without the takeover, a crash or deploy mid-event left the row
   * "processing" forever and every retry from Stripe was answered as a
   * duplicate — a 200 that quietly lost the payment event. The stale check is
   * the database's clock against the database's timestamp.
   */
  static async claim(eventId: string, type: string): Promise<boolean> {
    const inserted = await db.insert(stripeEvents).values({ id: eventId, type, status: "processing" }).onConflictDoNothing().returning({ id: stripeEvents.id });
    if (inserted.length) return true;
    const reclaimed = await db.update(stripeEvents)
      .set({ status: "processing", error: null, claimedAt: sql`now()` })
      .where(and(
        eq(stripeEvents.id, eventId),
        or(
          eq(stripeEvents.status, "failed"),
          and(eq(stripeEvents.status, "processing"), sql`${stripeEvents.claimedAt} < now() - make_interval(mins => ${STALE_CLAIM_MINUTES})`),
        ),
      ))
      .returning({ id: stripeEvents.id });
    return reclaimed.length > 0;
  }

  /** The tier a subscription entitles, from the price's metadata. Throws if Stripe can't be asked; that is a retry, not a silent free tier. */
  static async tierForSubscription(subscription: any): Promise<string> {
    const priceId = subscription.items?.data?.[0]?.price?.id || subscription.items?.data?.[0]?.plan?.id;
    if (!priceId) return 'free';
    return tierForPrice(priceId);
  }

  static async handleSubscriptionEvent(event: any): Promise<void> {
    const type = event.type;
    if (!type?.startsWith('customer.subscription.')) return;
    const subscription = event.data?.object;
    if (!subscription?.customer) return;
    const [user] = await db.select().from(users).where(eq(users.stripeCustomerId, subscription.customer));
    if (!user) return;

    /*
     * Stripe promises delivery, not order. A retry of "upgraded to builder"
     * can land after "upgraded to pro", and a retry of any update can land
     * after a cancellation — so the event's own timestamp decides, not the
     * order it happened to arrive in. An older one is ignored; the ledger
     * already handles the same event twice.
     */
    const eventAt = WebhookHandlers.eventTime(event);
    if (eventAt && user.subscriptionEventAt && eventAt < user.subscriptionEventAt) {
      console.log(`[stripe] Ignoring ${type} for user ${user.id}: ${eventAt.toISOString()} is older than the state it carries (${user.subscriptionEventAt.toISOString()}).`);
      return;
    }
    const stamp = { subscriptionEventAt: eventAt ?? new Date() };

    /*
     * The plan comes from everything the customer is paying for, not from the
     * one subscription this event is about (server/subscription-state.ts).
     * Deciding from the event alone meant a second subscription's renewal set
     * the plan back to its own tier each month, and cancelling either of two
     * dropped the account to Free while the other kept charging.
     */
    if (type === 'customer.subscription.deleted' || type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
      const stripe = await getUncachableStripeClient();
      const settled = await settleTier({
        userId: user.id,
        customer: subscription.customer,
        stripe,
        tierFor: (sub) => WebhookHandlers.tierForSubscription(sub),
        // A deleted subscription is finished, whatever status the event shows.
        fresh: type === 'customer.subscription.deleted' ? { ...subscription, status: 'canceled' } : subscription,
      });
      await db.update(users).set(stamp).where(eq(users.id, user.id));
      console.log(`Subscription ${type.split('.').pop()} for user ${user.id}: tier=${settled.tier}${settled.paying > 1 ? ` (${settled.paying} paid subscriptions — reported)` : ''}`);
    }
  }

  /** A Stripe event's own clock: `created` is seconds since the epoch. */
  static eventTime(event: any): Date | null {
    const seconds = Number(event?.created);
    return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
  }

  static async handleCheckoutCompleted(event: any): Promise<void> {
    // A delayed payment method completes the checkout unpaid and settles later, as async_payment_succeeded.
    const settledLater = event.type === 'checkout.session.async_payment_succeeded';
    if (event.type !== 'checkout.session.completed' && !settledLater) return;
    const session = event.data?.object;
    if (!session) return;

    // Backing pledges are held in escrow and have their own ledger, believer
    // numbers and merch queue — see server/backing-routes.ts. It dedupes by
    // session id itself, and records only a session that's actually paid.
    // Errors propagate: a lost pledge is worth a retry.
    if (session.metadata?.type === 'backing') { await recordBacking(session); return; }
    if (settledLater) return;

    /*
     * Seats on the simulation: a one-off payment, credited to the company that
     * bought them rather than to the person who clicked. Keyed on the session
     * so a redelivery inserts nothing and therefore credits nothing — the same
     * shape as donations below, for the same reason.
     */
    if (session.metadata?.kind === 'simulation_seats') {
      const companyId = session.metadata.companyId;
      const seats = parseInt(session.metadata.seats ?? '0', 10);
      if (!companyId || !Number.isInteger(seats) || seats < 1) return;
      if (session.payment_status && session.payment_status !== 'paid') return;
      /*
       * Which balance to credit. Read from the session's own metadata rather
       * than inferred from what was paid: the price could change, and a seat
       * credited to the wrong balance is a seat the company paid for and
       * cannot spend. An old session from before the two tiers carries no
       * `seatKind`, and every seat sold then was a Nova seat.
       */
      const seatKind = session.metadata?.seatKind === 'play' ? 'play' : 'nova';
      const column = seatKind === 'play' ? companies.simPlaySeatsPaid : companies.simNovaSeatsPaid;
      await db.transaction(async (tx) => {
        const inserted = await tx.insert(simSeatPurchases).values({
          companyId,
          seats,
          kind: seatKind,
          amount: Number(session.amount_total ?? 0),
          stripeSessionId: session.id,
          boughtBy: session.metadata?.userId ?? null,
        }).onConflictDoNothing({ target: simSeatPurchases.stripeSessionId }).returning({ id: simSeatPurchases.id });
        if (!inserted.length) return;
        await tx.update(companies)
          .set({ [seatKind === 'play' ? 'simPlaySeatsPaid' : 'simNovaSeatsPaid']: sql`${column} + ${seats}` })
          .where(eq(companies.id, companyId));
      });
      console.log(`Simulation seats credited: ${seats} ${seatKind} to company ${companyId}`);
      return;
    }

    /*
     * Another Ten Years valuation, at a dollar each. Same shape as the seats
     * above and for the same reason: keyed on the session, so a redelivery
     * inserts nothing and therefore credits nothing.
     */
    if (session.metadata?.kind === 'game_plays') {
      const userId = session.metadata.userId;
      const plays = parseInt(session.metadata.plays ?? '0', 10);
      if (!userId || !Number.isInteger(plays) || plays < 1) return;
      if (session.payment_status && session.payment_status !== 'paid') return;
      await db.transaction(async (tx) => {
        const inserted = await tx.insert(gamePlayPurchases).values({
          userId,
          plays,
          amount: Number(session.amount_total ?? 0),
          stripeSessionId: session.id,
        }).onConflictDoNothing({ target: gamePlayPurchases.stripeSessionId }).returning({ id: gamePlayPurchases.id });
        if (!inserted.length) return;
        await tx.update(users)
          .set({ gamePlaysPaid: sql`${users.gamePlaysPaid} + ${plays}` })
          .where(eq(users.id, userId));
      });
      console.log(`Game plays credited: ${plays} to ${userId}`);
      return;
    }

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
      const settled = await settleTier({
        userId: user.id,
        customer: session.customer,
        stripe,
        tierFor: (sub) => WebhookHandlers.tierForSubscription(sub),
        fresh: subscription as any,
      });
      console.log(`Checkout subscription for user ${user.id}: tier=${settled.tier}`);
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

    const matched = await db.transaction(async (tx) => {
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
          return true;
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
      return !!donation || !!backing;
    });
    if (matched) return;

    // Not a donation or a backing: a subscription payment, refunded in full, takes the plan with it.
    await onSubscriptionChargeRefunded(charge, async (c) => {
      if (c.invoice) return true;
      if (!paymentIntent) return false;
      // Newer API versions don't put the invoice on the charge; ask which invoice this payment paid. Throws → retried.
      const stripe = await getUncachableStripeClient();
      const payments = await (stripe as any).invoicePayments.list({ payment: { type: "payment_intent", payment_intent: paymentIntent }, limit: 1 });
      return (payments?.data?.length ?? 0) > 0;
    });
  }

  /**
   * Chargebacks on a pledge.
   *
   * A dispute is the backer's bank taking the money back by force: Stripe
   * pulls the amount (and a fee) from the platform balance the moment it's
   * opened, and returns it only if the dispute is won. This handler used to
   * know nothing about them, so a disputed pledge stayed plain "held" — and
   * the next payout release sent the creator money the platform no longer
   * had, or the refund sweep returned it to a backer whose bank already had.
   * Either way the platform paid for one pledge twice.
   *
   *   - charge.dispute.created marks the pledge (`disputedAt`). Release and the
   *     sweep both skip a marked pledge, under their row locks.
   *   - charge.dispute.closed settles it: won (or an inquiry closed without a
   *     chargeback) clears the mark and the pledge is held again, as before;
   *     lost means the backer has their money back, so the pledge is refunded
   *     and the public total gives it back, as a dashboard refund would.
   *
   * A dispute on a pledge already paid out is recorded and reported: the
   * creator has that money, and getting it back is a person's call.
   */
  static async handleDispute(event: any): Promise<void> {
    if (event.type !== 'charge.dispute.created' && event.type !== 'charge.dispute.closed') return;
    const dispute = event.data?.object;
    if (!dispute) return;
    const paymentIntent: string | null = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id ?? null;
    const chargeId: string | null = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id ?? null;
    if (!paymentIntent && !chargeId) return;
    const match = or(
      ...(paymentIntent ? [eq(projectBackings.stripePaymentIntentId, paymentIntent)] : []),
      ...(chargeId ? [eq(projectBackings.stripeChargeId, chargeId)] : []),
    );

    await db.transaction(async (tx) => {
      // The same lock release and the sweep take, so neither can act on this pledge mid-decision.
      const [backing] = await tx.select({ id: projectBackings.id, status: projectBackings.status, amountCents: projectBackings.amountCents, projectId: projectBackings.projectId, disputedAt: projectBackings.disputedAt, stripeChargeId: projectBackings.stripeChargeId })
        .from(projectBackings).where(match).for("update");
      if (!backing) return;

      if (event.type === 'charge.dispute.created') {
        if (!backing.disputedAt) {
          await tx.update(projectBackings).set({ disputedAt: new Date(), stripeChargeId: backing.stripeChargeId ?? chargeId }).where(eq(projectBackings.id, backing.id));
        }
        if (backing.status === 'released') console.error(`[stripe] dispute ${dispute.id} opened on backing ${backing.id}, which was already paid out to the creator — needs a person`);
        else console.warn(`[stripe] dispute ${dispute.id} opened on backing ${backing.id} (${backing.status}): held back from release and the refund sweep`);
        return;
      }

      // Closed. "won" and "warning_closed" (an inquiry that never became a chargeback) leave the money with us.
      if (dispute.status === 'won' || dispute.status === 'warning_closed') {
        await tx.update(projectBackings).set({ disputedAt: null }).where(eq(projectBackings.id, backing.id));
        console.log(`[stripe] dispute ${dispute.id} on backing ${backing.id} closed ${dispute.status}: ${backing.status === 'held' ? 'held again' : backing.status}`);
        return;
      }
      if (dispute.status !== 'lost') return;

      if (backing.status === 'held' || backing.status === 'pending') {
        // Lost: the backer's bank returned the money. The mark stays, as the record of how.
        await tx.update(projectBackings).set({ status: 'refunded', resolvedAt: new Date(), disputedAt: backing.disputedAt ?? new Date() }).where(eq(projectBackings.id, backing.id));
        await tx.update(projects).set({ totalDonations: sql`greatest(0, ${projects.totalDonations} - ${backing.amountCents})` }).where(eq(projects.id, backing.projectId));
        await tx.update(projectMerchOrders).set({ status: 'canceled', updatedAt: new Date() })
          .where(and(eq(projectMerchOrders.backingId, backing.id), inArray(projectMerchOrders.status, ['queued', 'failed'])));
        console.log(`[stripe] dispute ${dispute.id} lost: backing ${backing.id} refunded by the bank; project ${backing.projectId} total reduced by ${backing.amountCents}`);
      } else if (backing.status === 'released') {
        console.error(`[stripe] dispute ${dispute.id} lost on backing ${backing.id}, already paid out to the creator — the platform is out ${backing.amountCents} cents; needs a person`);
      }
    });
  }

  /**
   * A failed payment is acknowledged and recorded. A subscription invoice's
   * failure is kept on the account (paymentFailedAt, cleared by the next paid
   * invoice) so the app asks the user to update their card; entitlements still
   * follow the subscription's status, which Stripe sends as its own event
   * (past_due, unpaid → free tier above).
   */
  static async handlePaymentFailure(event: any): Promise<void> {
    if (event.type !== 'invoice.payment_failed' && event.type !== 'payment_intent.payment_failed') return;
    const obj = event.data?.object;
    const customer = typeof obj?.customer === "string" ? obj.customer : obj?.customer?.id;
    if (!customer) return;
    const recorded = await onSubscriptionPaymentFailed(event);
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.stripeCustomerId, customer));
    if (recorded) console.warn(`[stripe] recorded a failed subscription payment on user ${user?.id}`);
    console.warn(`[stripe] ${event.type} for customer ${customer}${user ? ` (user ${user.id})` : " (no user)"}: ${obj?.last_payment_error?.message ?? obj?.failure_message ?? "no message"}`);
  }
}
