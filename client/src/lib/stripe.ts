/**
 * Stripe.js, loaded once.
 *
 * The publishable key comes from the server rather than from a build-time
 * variable. `VITE_STRIPE_PUBLIC_KEY` would be baked into the bundle, which
 * means a key change needs a rebuild and a deploy — and the server already has
 * `/api/stripe/publishable-key`, which answers with whatever the running server
 * actually holds. On a server in test mode that is a `pk_test_…`; the client
 * never has to know which, and cannot disagree with the server about it.
 *
 * `loadStripe` injects a script tag, so it is memoised: calling it per render
 * would add one per render.
 */
import { loadStripe, type Stripe } from "@stripe/stripe-js";

let pending: Promise<Stripe | null> | null = null;

export function stripePromise(): Promise<Stripe | null> {
  if (!pending) {
    pending = (async () => {
      const res = await fetch("/api/stripe/publishable-key", { credentials: "include" });
      if (!res.ok) return null;
      const { publishableKey } = (await res.json()) as { publishableKey?: string };
      if (!publishableKey) return null;
      return loadStripe(publishableKey);
    })().catch(() => null);
  }
  return pending;
}

/** `pk_test_…` means a sandbox: nothing is charged. Worth saying out loud in the UI. */
export async function isTestMode(): Promise<boolean> {
  const res = await fetch("/api/stripe/publishable-key", { credentials: "include" }).catch(() => null);
  if (!res?.ok) return false;
  const { publishableKey } = (await res.json()) as { publishableKey?: string };
  return !!publishableKey?.startsWith("pk_test");
}
