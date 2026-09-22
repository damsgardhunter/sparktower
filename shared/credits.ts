/**
 * The revenue loop: hit the AI credits limit.
 *
 *   Generate with Nova on the path → credits run low → "Upgrade to keep
 *   generating", with the plans above yours → subscribe through Stripe → back
 *   to the page you were on, with the new allowance → generate more → the
 *   renewal (invoice paid) refills the allowance, and the loop goes round.
 *
 * The rules here are pure, so the server, the web app and tests agree on them.
 */
import { CREDIT_COSTS, tierRank } from "./plans";

export const OUT_OF_CREDITS = "insufficient_credits";

export type CreditState = "ok" | "low" | "out";

/** Low means about one more Nova build on the path, or the last fifth of the month's allowance. */
export function lowCreditsAt(limit: number): number {
  return Math.max(CREDIT_COSTS.taskAssist, Math.ceil(limit * 0.2));
}

export function creditState(sub: { creditsRemaining: number; creditsLimit: number; unlimited?: boolean }): CreditState {
  if (sub.unlimited || sub.creditsLimit < 0 || sub.creditsRemaining < 0) return "ok";
  if (sub.creditsRemaining <= 0) return "out";
  return sub.creditsRemaining <= lowCreditsAt(sub.creditsLimit) ? "low" : "ok";
}

/**
 * A page of ours to come back to after checkout. Only a same-site path — never
 * another origin ("//evil.test", "https://…", "/\evil") — and never the
 * checkout flags themselves.
 */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 300) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\u0000-\u001f\s]/.test(raw)) return null;
  try {
    const url = new URL(raw, "https://sparktower.invalid");
    if (url.origin !== "https://sparktower.invalid") return null;
    url.searchParams.delete("checkout");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** Where Stripe sends someone after checkout: the page they left, flagged, or the pricing page as before. */
export function checkoutReturnUrls(base: string, returnTo: unknown): { success: string; cancel: string } {
  const path = safeReturnPath(returnTo);
  if (!path) return { success: `${base}/pricing?success=true`, cancel: `${base}/pricing?canceled=true` };
  const [beforeHash, hash] = path.split("#");
  const sep = beforeHash.includes("?") ? "&" : "?";
  const tail = hash ? `#${hash}` : "";
  return { success: `${base}${beforeHash}${sep}checkout=success${tail}`, cancel: `${base}${beforeHash}${sep}checkout=canceled${tail}` };
}

/** Plans worth offering someone out of credits: the ones above theirs. */
export function upgradeOptions<T extends { tier: string }>(plans: T[], currentTier: string): T[] {
  return plans.filter((p) => tierRank(p.tier) > tierRank(currentTier));
}

/**
 * A new tier refills the month's allowance only when it's the first paid plan
 * — free to anything above it.
 *
 * It used to refill on any step up. But a plan change between paid tiers goes
 * through `stripe.subscriptions.update` with prorations, which charges nothing
 * today: the difference lands on the next invoice. So Builder → Pro → Builder
 * → Pro refilled the allowance on every "up" for about nothing, as many times
 * as someone cared to click. A move up between paid plans now raises the cap
 * and keeps what's been used; the allowance refills when an invoice is
 * actually paid (REFILLING_INVOICE_REASONS, via invoice.paid). Coming from
 * free always means a first payment — a new subscription's checkout — so the
 * refill there is for money that really arrived, and it's there the moment
 * the person returns rather than whenever the webhook lands.
 */
export const refillsOnTierChange = (from: string | null | undefined, to: string) => tierRank(from) <= 0 && tierRank(to) > 0;

/** Renewal invoices that refill the allowance: each paid cycle, and the first payment. */
export const REFILLING_INVOICE_REASONS = new Set(["subscription_cycle", "subscription_create"]);
