import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { db } from './db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    try {
      const stripe = await getUncachableStripeClient();
      const event = stripe.webhooks.constructEvent(
        payload,
        signature,
        '' // stripe-replit-sync already verified, we just need to parse
      );
      await WebhookHandlers.handleSubscriptionEvent(event);
    } catch (err) {
      try {
        const rawEvent = JSON.parse(payload.toString());
        await WebhookHandlers.handleSubscriptionEvent(rawEvent);
      } catch (parseErr) {
        console.error("Failed to parse webhook event for tier sync:", parseErr);
      }
    }
  }

  static async handleSubscriptionEvent(event: any): Promise<void> {
    const type = event.type;
    if (!type?.startsWith('customer.subscription.')) return;

    const subscription = event.data?.object;
    if (!subscription) return;

    const customerId = subscription.customer;
    if (!customerId) return;

    const [user] = await db.select().from(users).where(eq(users.stripeCustomerId, customerId));
    if (!user) return;

    if (type === 'customer.subscription.deleted') {
      await db.update(users).set({
        subscriptionTier: 'free',
        stripeSubscriptionId: null,
      }).where(eq(users.id, user.id));
      console.log(`Subscription canceled for user ${user.id}, reverted to free tier`);
      return;
    }

    if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
      const status = subscription.status;
      if (status !== 'active' && status !== 'trialing') {
        await db.update(users).set({
          subscriptionTier: 'free',
          stripeSubscriptionId: subscription.id,
        }).where(eq(users.id, user.id));
        return;
      }

      const priceId = subscription.items?.data?.[0]?.price?.id ||
                       subscription.items?.data?.[0]?.plan?.id;

      if (priceId) {
        try {
          const stripe = await getUncachableStripeClient();
          const price = await stripe.prices.retrieve(priceId);
          const tier = price.metadata?.tier || 'free';
          await db.update(users).set({
            subscriptionTier: tier,
            stripeSubscriptionId: subscription.id,
          }).where(eq(users.id, user.id));
          console.log(`Subscription updated for user ${user.id}: tier=${tier}`);
        } catch (err) {
          console.error("Failed to retrieve price for tier mapping:", err);
        }
      }
    }
  }
}
