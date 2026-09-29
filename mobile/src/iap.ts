/**
 * Adding money on an iPhone, through the App Store.
 *
 * Apple requires digital goods to be sold as In-App Purchases, so the balance
 * is sold as consumables and Stripe Checkout is not offered on iOS. What the
 * phone gets back from a purchase is a signed transaction; what it does with
 * it is hand it to the server, which is the only thing that decides whether
 * any money appears (`server/apple-iap.ts`).
 *
 * ## The one ordering that matters
 *
 * Credit first, finish second.
 *
 * `finishTransaction` tells Apple the purchase has been delivered, and Apple
 * then stops redelivering it. So finishing before the server has credited the
 * balance is how somebody pays five dollars and gets nothing, with no way for
 * either side to notice. Doing it the other way round has no equivalent
 * failure: if the app dies between crediting and finishing, Apple redelivers
 * on next launch, the server sees a transaction id it has already credited and
 * says so, and the second attempt finishes it. The worst case is a duplicate
 * request the server refuses, which is what its idempotency is for.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import {
  finishTransaction, initConnection, purchaseErrorListener, purchaseUpdatedListener, requestPurchase,
} from "expo-iap";
import { api } from "./api/client";

/** The identifiers created in App Store Connect. Must match `APPLE_PRODUCTS` on the server. */
export const APPLE_PRODUCT_IDS = [
  "com.sparktower.topup.500",
  "com.sparktower.topup.1000",
  "com.sparktower.topup.2000",
] as const;

export const productForCents = (cents: number): string | null =>
  ({ 500: APPLE_PRODUCT_IDS[0], 1000: APPLE_PRODUCT_IDS[1], 2000: APPLE_PRODUCT_IDS[2] } as Record<number, string>)[cents] ?? null;

export const iapAvailable = Platform.OS === "ios";

/**
 * Buy a top-up, and tell the server about it.
 *
 * Purchases arrive on a listener rather than as the return value of
 * `requestPurchase` — StoreKit can deliver one that was started on another
 * device, or one interrupted last time the app ran — so the listener is the
 * only place a purchase is handled, and starting one is just a nudge.
 */
export function useAppleTopUp(onCredited: () => void, onError: (message: string) => void) {
  const [busy, setBusy] = useState(false);
  /* Kept in a ref so the listener, which is set up once, always calls the current one. */
  const credited = useRef(onCredited);
  const failed = useRef(onError);
  credited.current = onCredited;
  failed.current = onError;

  useEffect(() => {
    if (!iapAvailable) return;
    let alive = true;
    initConnection().catch(() => { /* the purchase itself will report it */ });

    const bought = purchaseUpdatedListener(async (purchase: any) => {
      const jws = purchase?.purchaseToken;
      if (!jws) return;
      try {
        await api("/api/nova/apple-purchase", { method: "POST", body: { signedTransaction: jws } });
        /*
         * Only now. See the note at the top: finishing first is how a
         * purchase gets paid for and never delivered.
         */
        await finishTransaction({ purchase, isConsumable: true });
        if (alive) credited.current();
      } catch (e: any) {
        /*
         * Deliberately not finished. Apple will offer it again next launch,
         * and the server will credit it then — leaving it unfinished is what
         * makes a failed server call recoverable rather than a lost payment.
         */
        if (alive) failed.current(e?.message ?? "That purchase couldn't be confirmed. It'll be picked up next time you open the app.");
      } finally {
        if (alive) setBusy(false);
      }
    });

    const broke = purchaseErrorListener((err: any) => {
      // A cancelled sheet is not an error worth showing.
      if (alive && err?.code !== "E_USER_CANCELLED") failed.current(err?.message ?? "That purchase didn't go through.");
      if (alive) setBusy(false);
    });

    return () => { alive = false; bought?.remove?.(); broke?.remove?.(); };
  }, []);

  const buy = useCallback(async (cents: number) => {
    const sku = productForCents(cents);
    if (!sku) { onError("That amount isn't sold on the App Store."); return; }
    setBusy(true);
    try {
      await requestPurchase({ request: { ios: { sku } }, type: "in-app" } as any);
    } catch (e: any) {
      setBusy(false);
      onError(e?.message ?? "Couldn't open the App Store.");
    }
  }, [onError]);

  return { buy, busy };
}
