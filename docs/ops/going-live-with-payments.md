# Taking real money

Everything in the product is on Stripe **test** keys as of 2026-10-04 —
`sk_test_…` locally and `pk_test_…` on production, which `GET
/api/stripe/publishable-key` will confirm from outside. Nothing has ever been
charged. This is the list for changing that, and the order matters.

## What is already built

- **Stripe Checkout** for every purchase: a hosted page, a redirect out and
  back. Nine call sites.
- **Cards on file**, added 2026-10-04 (`server/payment-methods.ts`,
  `client/src/components/saved-cards.tsx`): a card saved once, then one-tap
  top-ups in the product's own dialog. The number never reaches this server.
- **Connect** for paying creators out, subscriptions, and a billing portal.
- **Apple In-App Purchase** on iOS, because Apple requires it for digital
  goods. Stripe is not used on an iPhone and must not be.

## The order to do it in

### 1. Before anything, decide about Apple

Apple requires digital goods sold inside an iOS app to go through In-App
Purchase, at 15–30%. The app already does this (`mobile/src/iap.ts`), and the
saved-card work deliberately does **not** reach iOS — `topUpRoute` is
`"appstore"` there, and the seats screen hides its card button on that
platform for the same reason.

Do not "fix" that by adding a Stripe sheet to the iOS app. It is the single
most reliable way to fail App Review, and the rejection cites the rule rather
than the code, so it is not a bug you can iterate on.

iOS needs, separately: `APPLE_IAP_ENVIRONMENT=production` once the app is out
of TestFlight, plus the shared secret and key ids. Until those are set the
Apple path is sandbox, which also charges nobody.

### 2. Stripe dashboard, in live mode

- Activate the account: business details, bank account, tax information.
  Payouts do not run until this is done, and it is the part with a waiting
  period.
- Recreate the products and prices **in live mode**. Test-mode price ids do not
  exist in live mode, so anything that names one will 404 the first time
  somebody tries to pay. `server/seed-stripe.ts` creates them — do not edit
  that file (see `replit.md`), run it.
- Register the webhook endpoint at `https://sparktower.app/api/stripe/webhook`
  and subscribe at least:
  - `checkout.session.completed`, `checkout.session.async_payment_succeeded`
  - `payment_intent.succeeded` — **new, and required**: this is the only event
    that credits a saved-card top-up. Without it the money is taken and no
    balance moves.
  - `customer.subscription.created|updated|deleted`
  - `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`
  - `charge.dispute.created`, `charge.refunded`
- Copy the **live** signing secret. A test-mode secret against live events
  fails every signature check, and the handler answers 500 so Stripe retries
  for days — which looks like an outage rather than a misconfiguration.

### 3. Render environment

Set, in production only:

```
STRIPE_SECRET_KEY=sk_live_…
STRIPE_PUBLISHABLE_KEY=pk_live_…
STRIPE_WEBHOOK_SECRET=whsec_…   # the live one
```

`STRIPE_WEBHOOK_SECRET` is currently unset even locally. It is what proves an
inbound webhook came from Stripe; without it anybody who can reach the URL can
credit a balance by posting JSON at it.

### 4. What switches itself off

The moment the server holds an `sk_live` key, five guards change behaviour on
their own. They are deliberate and they are listed here so nobody is surprised:

- `server/wallet.ts` — the dev bypass that skips charging stops working.
- `server/routes.ts`, `server/challenge-prizes.ts` — the same, for their own
  paths.

So the free-money path closes by itself. That is the design: "a switch that
turns off charging is worth being paranoid about twice."

### 5. Verify, in this order

1. `GET /api/stripe/publishable-key` on production returns `pk_live_…`.
2. A real card, smallest top-up ($5), through the **hosted** page. Check the
   balance moves and the ledger row appears.
3. The same again with the card **saved**, one tap. This is the path that
   depends on `payment_intent.succeeded`, so it is the one that proves the
   webhook subscription is right.
4. Stripe dashboard → the payment shows, and the webhook delivered 200.
5. Refund it from the dashboard. Check the balance comes back down —
   `charge.refunded` is handled.

Do steps 2 and 3 yourself with your own card before anybody else can reach it.
A first real payment that fails silently is indistinguishable from a product
nobody wants to buy from.

## Things that are easy to get wrong

**A test-mode customer id in a live-mode account.** Every account already has a
`stripeCustomerId`, created in test mode. Those ids do not exist in live mode,
so the first live purchase for an existing account fails on the customer
lookup. `ensureStripeCustomer` only creates one when the column is empty, so it
will not heal itself. Decide before launch whether to clear
`users.stripe_customer_id` for everyone — on a pre-launch database with no real
customers, clearing it is the simple answer.

**Saved cards do not migrate.** A card saved in the sandbox is a test card
attached to a test customer. They all disappear at the switch, which is fine
now and would not be later.

**Apple and Stripe prices drifting.** `shared/plans.ts`'s `TOP_UP_CENTS` and
the App Store product ids have to agree, and Apple's price tiers are not
arbitrary numbers. `mobile/src/iap.ts` has the note.

## Where the money paths are

| Path | Where | Credited by |
|---|---|---|
| Hosted checkout | `server/routes.ts`, 9 sites | `checkout.session.completed` |
| Saved card, one tap | `server/payment-methods.ts` | `payment_intent.succeeded` |
| iOS | `mobile/src/iap.ts` → `server/apple-iap.ts` | the signed transaction |
| Creator payouts | Connect, `server/stripe-connect-errors.ts` | — |
