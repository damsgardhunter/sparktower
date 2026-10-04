/**
 * Cards kept on file, and paying with one.
 *
 * Every payment in the product went through Stripe Checkout: a redirect to a
 * page Stripe hosts, a card typed again every time, and a trip back. That is
 * the right default for a first purchase and the wrong one for the fourth —
 * somebody topping up a balance for the fifth time should not be retyping a
 * card, and the page they do it on should look like this product.
 *
 * So: the card is saved once, and the next purchase is one tap.
 *
 * ## Where the card actually lives
 *
 * Not here. The number never reaches this server, and that is the whole design
 * rather than a detail. The client collects it with Stripe's own element,
 * which sends it to Stripe directly and hands back a PaymentMethod id; this
 * server only ever sees `pm_…`. That is what keeps the platform in PCI SAQ A —
 * a questionnaire — instead of SAQ D, which is an annual audit, a penetration
 * test and a segmented network. Storing the number here would also not remove
 * the dependency on a processor: a card you hold is still a card somebody else
 * has to charge for you.
 *
 * ## Two rules the routes below are built on
 *
 * **A payment method id from a client is not trusted.** `pm_…` ids are
 * guessable in shape and a stolen one must not be chargeable by whoever holds
 * it, so every route that names one re-reads it from Stripe and checks it is
 * attached to *this* account's customer. Without that, "charge pm_X" is an
 * API for billing other people's cards.
 *
 * **The balance moves on the webhook, never on the way out.** The existing
 * checkout flow already works this way and the reason is the same here: the
 * API response says what Stripe thinks at that instant, and a card can settle,
 * fail or be disputed afterwards. `payment_intent.succeeded` is what credits a
 * balance, keyed on the intent's id so a redelivery credits once.
 *
 * ## Why off-session charging needs a way back on-session
 *
 * A saved card charged while the customer is not there can still need them:
 * under SCA a bank may demand a challenge, and Stripe answers
 * `authentication_required`. That is not a failure to report as "card
 * declined" — the card is fine and the customer is right there, having just
 * tapped a button. So the intent is returned with its client secret and the UI
 * finishes it in the open page. Treating that as a decline is how somebody
 * with a working card is told their card does not work.
 */
import type { Express, Response } from "express";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { getUncachableStripeClient, isStripeConfigured } from "./stripeClient";
import { ensureStripeCustomer } from "./stripe-customer";
import { storage } from "./storage";
import { TOP_UP_CENTS, formatMoney } from "@shared/plans";

/** What the client needs to show a saved card, and nothing more. */
export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
  /** True once the card's own expiry month has passed. */
  expired: boolean;
}

const cardOf = (pm: Stripe.PaymentMethod, defaultId: string | null): SavedCard | null => {
  if (pm.type !== "card" || !pm.card) return null;
  const now = new Date();
  /* A card is good until the end of its expiry month, which is why this is `<`. */
  const expired = pm.card.exp_year < now.getUTCFullYear()
    || (pm.card.exp_year === now.getUTCFullYear() && pm.card.exp_month < now.getUTCMonth() + 1);
  return {
    id: pm.id,
    brand: pm.card.brand,
    last4: pm.card.last4,
    expMonth: pm.card.exp_month,
    expYear: pm.card.exp_year,
    isDefault: pm.id === defaultId,
    expired,
  };
};

/** The customer's id and their default card, in one read. */
async function customerFor(userId: string): Promise<{ stripe: Stripe; customerId: string; defaultId: string | null }> {
  const stripe = await getUncachableStripeClient();
  const user = await storage.getUser(userId);
  if (!user) throw new Error("no such account");
  const customerId = await ensureStripeCustomer(stripe, user);
  const customer = await stripe.customers.retrieve(customerId);
  const defaultId = customer.deleted
    ? null
    : (typeof customer.invoice_settings?.default_payment_method === "string"
        ? customer.invoice_settings.default_payment_method
        : customer.invoice_settings?.default_payment_method?.id ?? null);
  return { stripe, customerId, defaultId };
}

/**
 * The card, re-read from Stripe and confirmed to be this account's.
 *
 * Answers 404 rather than 403 for a card belonging to somebody else: whether a
 * given `pm_…` exists at all is not this caller's business, and two different
 * answers would tell them.
 */
async function ownedCard(
  stripe: Stripe, customerId: string, paymentMethodId: unknown, res: Response,
): Promise<Stripe.PaymentMethod | null> {
  const id = typeof paymentMethodId === "string" ? paymentMethodId.trim() : "";
  if (!id.startsWith("pm_")) {
    res.status(400).json({ message: "That isn't a saved card.", code: "invalid_input", field: "paymentMethodId" });
    return null;
  }
  let pm: Stripe.PaymentMethod;
  try {
    pm = await stripe.paymentMethods.retrieve(id);
  } catch {
    res.status(404).json({ message: "No such saved card." });
    return null;
  }
  if (pm.customer !== customerId) {
    res.status(404).json({ message: "No such saved card." });
    return null;
  }
  return pm;
}

const stripeOff = (res: Response) => {
  res.status(503).json({ message: "Card payments aren't set up on this server yet.", code: "stripe_unconfigured" });
};

export function registerPaymentMethodRoutes(app: Express): void {
  /**
   * Start saving a card.
   *
   * A SetupIntent rather than a PaymentIntent of zero: it is the API for
   * "collect a card to use later", it carries the right off-session usage so
   * the bank's mandate covers later charges, and it does not take any money.
   *
   * `usage: "off_session"` is what makes a later charge without the customer
   * legitimate — Stripe tells the bank at setup time that this will happen,
   * which is what keeps the success rate up on the charges that follow.
   */
  app.post("/api/payment-methods/setup-intent", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    if (!isStripeConfigured()) return stripeOff(res);
    try {
      const { stripe, customerId } = await customerFor(req.user.id);
      const intent = await stripe.setupIntents.create({
        customer: customerId,
        usage: "off_session",
        payment_method_types: ["card"],
        metadata: { userId: req.user.id },
      });
      res.json({ clientSecret: intent.client_secret });
    } catch (error) {
      console.error("Setup intent error:", error);
      res.status(500).json({ message: "Couldn't start saving a card." });
    }
  });

  /** The cards on file, newest first, with which one is the default. */
  app.get("/api/payment-methods", isAuthenticated, async (req: any, res) => {
    if (!isStripeConfigured()) return res.json({ cards: [], stripeConfigured: false });
    try {
      const { stripe, customerId, defaultId } = await customerFor(req.user.id);
      const list = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 20 });
      const cards = list.data.map((pm) => cardOf(pm, defaultId)).filter((c): c is SavedCard => !!c);
      /* Default first, then newest — the order somebody scans for "the one I use". */
      cards.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
      res.json({ cards, stripeConfigured: true });
    } catch (error) {
      console.error("Payment methods read error:", error);
      res.status(500).json({ message: "Couldn't read your saved cards." });
    }
  });

  /** Make one the default, which is what a one-tap purchase uses. */
  app.post("/api/payment-methods/:id/default", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    if (!isStripeConfigured()) return stripeOff(res);
    try {
      const { stripe, customerId } = await customerFor(req.user.id);
      const pm = await ownedCard(stripe, customerId, req.params.id, res);
      if (!pm) return;
      await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm.id } });
      res.json({ ok: true, paymentMethodId: pm.id });
    } catch (error) {
      console.error("Default card error:", error);
      res.status(500).json({ message: "Couldn't change your default card." });
    }
  });

  /**
   * Forget a card.
   *
   * Detached from the customer rather than deleted: a PaymentMethod that has
   * paid for something stays attached to those payments in Stripe, which is
   * what a refund and a dispute both need. What goes is the ability to charge
   * it again.
   */
  app.delete("/api/payment-methods/:id", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    if (!isStripeConfigured()) return stripeOff(res);
    try {
      const { stripe, customerId } = await customerFor(req.user.id);
      const pm = await ownedCard(stripe, customerId, req.params.id, res);
      if (!pm) return;
      await stripe.paymentMethods.detach(pm.id);
      res.json({ ok: true });
    } catch (error) {
      console.error("Detach card error:", error);
      res.status(500).json({ message: "Couldn't remove that card." });
    }
  });

  /**
   * Top up with a card already on file.
   *
   * The amount is checked against the same list the hosted checkout accepts,
   * so the two ways of buying the same thing cannot disagree about the price.
   *
   * Nothing here credits a balance. The PaymentIntent's own id goes in the
   * metadata the webhook reads, and `payment_intent.succeeded` is what moves
   * the money — see the note at the top of this file.
   */
  app.post("/api/wallet/topup/saved-card", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    if (!isStripeConfigured()) return stripeOff(res);
    try {
      const amountCents = Math.round(Number(req.body?.amountCents));
      if (!TOP_UP_CENTS.includes(amountCents)) {
        return res.status(400).json({
          message: "Pick one of the top-up amounts.",
          code: "invalid_amount", optionsCents: TOP_UP_CENTS,
        });
      }
      const { stripe, customerId, defaultId } = await customerFor(req.user.id);
      const wanted = req.body?.paymentMethodId ?? defaultId;
      if (!wanted) {
        return res.status(400).json({ message: "No card saved yet.", code: "no_saved_card" });
      }
      const pm = await ownedCard(stripe, customerId, wanted, res);
      if (!pm) return;

      /*
       * `off_session: true` with `confirm: true` is the one-tap charge. The
       * idempotency key is the account, the card, the amount and the minute —
       * so a double tap charges once, and a deliberate second top-up a minute
       * later is not swallowed as a duplicate.
       */
      const minute = Math.floor(Date.now() / 60_000);
      try {
        const intent = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: "usd",
          customer: customerId,
          payment_method: pm.id,
          off_session: true,
          confirm: true,
          description: `SparkTower balance — ${formatMoney(amountCents)}`,
          metadata: { type: "topup", userId: req.user.id, amountCents: String(amountCents) },
        }, { idempotencyKey: `topup_${req.user.id}_${pm.id}_${amountCents}_${minute}` });

        return res.json({
          status: intent.status,
          /* The webhook credits it; this only tells the UI what to say. */
          paid: intent.status === "succeeded",
          amountCents,
        });
      } catch (err: any) {
        /*
         * The bank wants the customer. Not a decline — see the note at the top
         * of this file — so the intent's client secret goes back and the open
         * page finishes it.
         */
        if (err?.code === "authentication_required" && err?.raw?.payment_intent?.client_secret) {
          return res.status(402).json({
            code: "authentication_required",
            message: "Your bank wants to check it's you. One more tap and it's done.",
            clientSecret: err.raw.payment_intent.client_secret,
            amountCents,
          });
        }
        /*
         * Everything else is Stripe's own sentence, which says what is wrong
         * with the card — "insufficient funds", "expired card" — and is more
         * use than anything this file could write.
         */
        if (err?.type === "StripeCardError") {
          return res.status(402).json({
            code: "card_declined",
            message: err.message || "That card was declined.",
            declineCode: err.decline_code ?? null,
          });
        }
        throw err;
      }
    } catch (error) {
      console.error("Saved-card top-up error:", error);
      res.status(500).json({ message: "Couldn't take that payment." });
    }
  });
}
