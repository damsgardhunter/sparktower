/**
 * Money added from an iPhone.
 *
 * Apple does not allow an app to sell digital goods any other way, so the
 * balance is sold as consumable In-App Purchases and the phone hands back a
 * *signed transaction* — a JWS that Apple minted and signed with a certificate
 * chaining to its own root.
 *
 * ## The whole of the security argument
 *
 * The phone is not trusted about any of it. Not the amount, not the product,
 * not whether a payment happened. A jailbroken device, a patched binary or
 * plain `curl` can post whatever JSON it likes to this endpoint, so:
 *
 *   - The signature is verified against Apple's root certificates. A
 *     transaction nobody at Apple signed is not a transaction.
 *   - The bundle id in the payload must be ours. A genuine receipt from some
 *     *other* app is genuinely signed and must still be refused.
 *   - The amount comes from `APPLE_PRODUCTS` keyed by the product id inside
 *     the verified payload — never from the request body. The client cannot
 *     name its own price, for the same reason `/api/nova/top-up` only accepts
 *     amounts from `TOP_UP_CENTS`.
 *   - The transaction id is the idempotency key. Apple re-delivers unfinished
 *     transactions, StoreKit replays them on reinstall, and somebody can
 *     simply post the same body twice; `creditTopUp` already refuses a second
 *     credit against a key it has seen, so all three are the same harmless
 *     no-op.
 *
 * ## What is deliberately not here
 *
 * Refunds and revocations arrive as App Store Server Notifications, which is
 * a separate endpoint and a separate decision about what to do when somebody
 * has already spent a balance Apple has taken back. Until that exists, a
 * refunded top-up leaves the money on the account — which is the safe failure
 * for the customer and a known cost to the business, rather than a silent
 * negative balance.
 */
import type { Express } from "express";
import { Environment, SignedDataVerifier } from "@apple/app-store-server-library";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { enforceRateLimit } from "./moderation";
import { creditTopUp, walletOf } from "./wallet";
import { APPLE_PRODUCTS } from "@shared/plans";

/**
 * Apple's root certificates, from disk.
 *
 * Downloaded from https://www.apple.com/certificateauthority/ and committed,
 * because verification that fetches its own trust anchors over the network is
 * verification that a network can defeat. Missing certificates mean the
 * feature is off rather than open: `verifier()` returns null and the route
 * refuses.
 */
const CERT_DIR = path.join(process.cwd(), "server", "apple-certs");

function rootCerts(): Buffer[] {
  try {
    return readdirSync(CERT_DIR)
      .filter((f) => f.endsWith(".cer") || f.endsWith(".der"))
      .map((f) => readFileSync(path.join(CERT_DIR, f)));
  } catch {
    return [];
  }
}

let cached: SignedDataVerifier | null | undefined;

/** Null when this server has not been given what it needs to check a receipt. */
function verifier(): SignedDataVerifier | null {
  if (cached !== undefined) return cached;
  const bundleId = process.env.APPLE_BUNDLE_ID;
  const certs = rootCerts();
  if (!bundleId || certs.length === 0) {
    cached = null;
    return cached;
  }
  /*
   * Sandbox unless told otherwise. A TestFlight build's receipts are sandbox
   * receipts, and a server that only accepts production ones rejects every
   * purchase made during testing — which is how a feature ships broken.
   */
  const environment = process.env.APPLE_IAP_ENVIRONMENT === "production"
    ? Environment.PRODUCTION
    : Environment.SANDBOX;
  cached = new SignedDataVerifier(certs, true, environment, bundleId);
  return cached;
}

export function registerAppleIapRoutes(app: Express): void {
  /**
   * Turn a signed StoreKit transaction into balance.
   *
   * Safe to call more than once with the same transaction: the second one
   * credits nothing and answers with the same balance, which is what lets the
   * app retry on a dropped connection without a person paying twice or
   * getting twice what they paid for.
   */
  app.post("/api/nova/apple-purchase", isAuthenticated, async (req: any, res) => {
    const userId = req.user.id;
    if (!(await enforceRateLimit(res, userId, "checkout"))) return;

    const check = verifier();
    if (!check) {
      return res.status(503).json({
        code: "iap_unconfigured",
        message: "In-app purchases aren't set up on this server yet.",
      });
    }

    const signed = typeof req.body?.signedTransaction === "string" ? req.body.signedTransaction : "";
    if (!signed) return res.status(400).json({ message: "signedTransaction is required." });

    let payload;
    try {
      payload = await check.verifyAndDecodeTransaction(signed);
    } catch (err: any) {
      /*
       * Logged as a warning rather than an error: an unverifiable receipt is
       * far more likely to be a sandbox/production mix-up than an attack, and
       * either way it is the client's problem, not a fault in this server.
       */
      console.warn(`[iap] refused a transaction that did not verify: ${err?.message ?? err}`);
      return res.status(400).json({ code: "bad_receipt", message: "That purchase couldn't be verified with Apple." });
    }

    // Genuinely signed, genuinely somebody else's app.
    if (payload.bundleId !== process.env.APPLE_BUNDLE_ID) {
      console.warn(`[iap] refused a valid receipt for another app: ${payload.bundleId}`);
      return res.status(400).json({ code: "bad_receipt", message: "That purchase isn't for this app." });
    }

    const cents = APPLE_PRODUCTS[payload.productId ?? ""];
    if (!cents) {
      console.warn(`[iap] refused an unknown product: ${payload.productId}`);
      return res.status(400).json({ code: "unknown_product", message: "That isn't something this app sells." });
    }

    const transactionId = payload.transactionId;
    if (!transactionId) {
      return res.status(400).json({ code: "bad_receipt", message: "That purchase has no transaction id." });
    }

    /*
     * Namespaced, because this shares a column with Stripe's session ids and
     * two different payment systems must never collide on a key that decides
     * whether somebody's money is credited.
     */
    const { credited, balanceCents } = await creditTopUp(
      userId,
      cents,
      `apple:${transactionId}`,
      "Added to your balance (App Store)",
    );

    if (credited) console.log(`[iap] credited ${cents}¢ to ${userId} for ${payload.productId}`);
    res.json({ credited, balanceCents, wallet: await walletOf(userId) });
  });
}
