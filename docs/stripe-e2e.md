# Stripe: payments, donations, backing — end to end

Every money path ends at one endpoint: `POST /api/stripe/webhook`. If Stripe
can't reach it, or can't be verified, money is taken and nothing is recorded.
So the first check is always the webhook.

## What's handled

| Stripe event | What happens | Where |
|---|---|---|
| `checkout.session.completed` (metadata `type: donation`) | Donation recorded once per session; project total goes up | `server/webhookHandlers.ts` |
| `checkout.session.completed` (metadata `type: backing`) | Backing held in escrow, believer number, merch queued | `recordBacking` in `server/backing-routes.ts` |
| `checkout.session.completed` (mode `subscription`) | Tier set from the price's `metadata.tier` | `server/webhookHandlers.ts` |
| `customer.subscription.created/updated/deleted` | Tier follows the status; `active` and `trialing` are paid | `shared/subscriptions.ts` |
| `charge.refunded` | Donation: the running refunded amount is recorded and the total moves by the difference. Backing: refunded in full → marked refunded, total given back, queued merch canceled; partial → left for a reviewer | `server/webhookHandlers.ts` |
| `invoice.payment_failed`, `payment_intent.payment_failed` | Logged; the tier follows the subscription status event | `server/webhookHandlers.ts` |

Entitlements (credits, features) are computed from `users.subscriptionTier`
each time they're read (`server/entitlements.ts`); there's nothing else to
keep in sync. `GET /api/subscription` returns them; `POST /api/stripe/sync-subscription`
re-reads the tier from Stripe for the signed-in user's own customer id.

## Guarantees

- **Verified.** The signature is checked before anything is parsed. A bad
  signature is a 400 (Stripe doesn't retry a forgery).
- **Retried when it's our fault.** Any failure after verification — including
  no signing secret configured — is a 500, so Stripe retries for three days.
- **Once.** `stripe_events` claims each event id before processing: processed
  means skip, failed means retry. Donations are unique per checkout session;
  backings are deduped by session; refunds are idempotent on the charge's
  running `amount_refunded`, so a repeated or re-sent refund moves nothing.
- **One writer of the total per refund.** A backing's move to `refunded` —
  by the refund sweep or by the webhook, whichever is first — is the only
  thing that gives its money back to the project's total.

## The signing secret

The endpoint needs a secret to verify against, from either:

1. **A managed webhook** — at boot, with `PUBLIC_URL` set and Stripe keys
   available, the server registers `${PUBLIC_URL}/api/stripe/webhook` with
   Stripe and stores its secret in `stripe._managed_webhooks`.
2. **`STRIPE_WEBHOOK_SECRET`** — the `whsec_…` from `stripe listen`, or from an
   endpoint you added in the Stripe dashboard.

Without either, every delivery fails with a 500 and the log says
`no signing secret is configured`.

## Check it: the owner's health view

`GET /api/admin/stripe/health` (signed in as `PLATFORM_OWNER_EMAIL`):

- `verdict`: `receiving` · `receiving_with_failures` · `waiting_for_first_event` · `no_webhook_secret` · `not_configured`
- `configured`: API key, env secret, managed webhooks (url and status)
- `events`: total, by status, last received, the five latest failures
- `donations` and `backings`: counts, including partly refunded donations

In production, the verdict should be `receiving` once anyone has paid. The
Stripe dashboard's endpoint page should show the same deliveries as 2xx.

## Run it locally, end to end

```bash
brew install stripe/stripe-cli/stripe
stripe login                     # the test-mode account whose keys are in .env

# Forward Stripe's events to the dev server; it prints a whsec_… secret.
stripe listen --forward-to localhost:5000/api/stripe/webhook
```

Put that secret in `.env` as `STRIPE_WEBHOOK_SECRET=whsec_…` and restart the
dev server. Then, in a second terminal:

1. **Is it reaching us?** `stripe trigger payment_intent.succeeded` — the
   `stripe listen` window shows `200`, and the health view's `events.total`
   goes up. (A triggered event has none of our metadata, so it's recorded in
   the ledger and changes nothing else.)
2. **A real donation.** In the app, donate to a project with card
   `4242 4242 4242 4242`. The project's total rises; `donations` has the row.
3. **A partial refund.** In the Stripe dashboard (test mode), refund part of
   that payment. The total drops by that much; the donation shows
   `refunded_amount` and no `refunded_at` yet. Refund the rest: the remainder
   comes off and `refunded_at` is set.
4. **A subscription.** Upgrade from the pricing page with the same card. The
   tier changes on `checkout.session.completed`; cancel it in the dashboard and
   it returns to free on `customer.subscription.deleted`.

```sql
SELECT id, type, status, error, received_at FROM stripe_events ORDER BY received_at DESC LIMIT 20;
SELECT amount, refunded_amount, refunded_at FROM donations ORDER BY created_at DESC LIMIT 5;
SELECT status, count(*) FROM project_backings GROUP BY status;
```

Backing is behind the `backing` kill switch and **off by default** ("real
money and an escrow obligation"). Turn it on in the admin surfaces page to
walk a backing through the same way.

## Automated

```bash
npx vitest run test/integration/stripe-webhook.test.ts test/integration/stripe-health.test.ts test/unit/subscriptions.test.ts
```

Signatures are real (`stripe.webhooks.constructEvent`); only the sync library,
which calls Stripe's API, is stubbed.
