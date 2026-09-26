/**
 * Paying for things, on the phone.
 *
 * The web moved off subscriptions a while ago: there are no tiers to buy any
 * more, there is a balance, and Nova's dearer jobs have prices — $3 to
 * simulate a decision, $6 to score a marketing scheme, $14.99 for Nova to
 * build a whole business. The phone never followed. Its only billing screen
 * is still `/pricing`, which sells four plans that are all free, and there was
 * no way to see a balance, add to it, or buy any of the eleven priced
 * outcomes.
 *
 * That mattered more once the simulations arrived here, because those are the
 * priced ones: running a decision on a phone would come back 402 with a
 * perfectly good explanation of what it cost and no way whatsoever to pay it.
 *
 * ## What this is
 *
 * `useWallet` — the balance and this month's free allowance.
 * `PayWall` — what to show when the server says 402. It reads the body the
 *   server already sends (`PaymentRequiredBody`: the price, the balance, the
 *   single next action) rather than deciding any of that here, so the phone
 *   and the browser cannot come to different conclusions about what something
 *   costs.
 * `useTopUp` / `useBuy` — adding money, and spending it.
 *
 * ## iOS
 *
 * Adding money is buying digital content, and Apple requires that to go
 * through in-app purchase (Guideline 3.1.1). StoreKit is not wired up, so on
 * iOS the balance and the prices are shown and topping up says where it can be
 * done instead. That is the same decision `app/pricing.tsx` already made about
 * subscriptions, kept in step rather than re-argued: what is new here is that
 * *spending* an existing balance is not a purchase, so buying an outcome with
 * money already on the account works everywhere.
 */
import { useCallback, useEffect, useState } from "react";
import { Modal, Platform, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { api, ApiError, PRODUCTION_API_URL, setPaymentRequiredHandler } from "../api/client";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Body, Btn, Card, Label, Meta } from "./ui";

/** Mirrors `Wallet` in shared/plans.ts. */
export interface Wallet {
  balanceCents: number;
  balanceDisplay: string;
  allowanceUsed: number;
  allowanceLimit: number;
  allowanceRemaining: number;
  actionsBought: number;
  devUnlimited?: boolean;
  dayPassActive?: boolean;
  imagePassActive?: boolean;
}

/** Mirrors `PaymentRequiredBody` — what a 402 carries. */
export interface PaymentRequired {
  code: "payment_required";
  message: string;
  label: string;
  outcome: string | null;
  price: { cents: number; display: string } | null;
  wallet: Wallet;
  remedy: "top_up" | "buy_pass" | "none";
  topUp: { shortfallCents: number; suggestCents: number; optionsCents: number[] } | null;
  endpoints: Record<string, string>;
}

/** The 402 body, if this error is one. Anything else is an ordinary failure. */
export function paymentRequiredOf(err: unknown): PaymentRequired | null {
  const e = err as ApiError;
  if (!e || e.status !== 402) return null;
  const body = e.body;
  return body?.code === "payment_required" ? (body as PaymentRequired) : null;
}

export const WALLET_KEY = ["nova-wallet"];

export function useWallet() {
  return useQuery({
    queryKey: WALLET_KEY,
    queryFn: () => api<{ wallet: Wallet }>("/api/nova/wallet").then((r) => r.wallet),
  });
}

/**
 * Whether money can be added from inside this app.
 *
 * True everywhere now: Android and the web preview open Stripe Checkout, and
 * iOS buys a consumable through the App Store (`src/iap.ts`). Kept as a named
 * thing rather than deleted because it is the one place that would have to say
 * "no" again if a platform ever lost its route to a payment.
 */
export const canTopUpHere = true;

/** Which way money gets added on this platform, for screens that word it differently. */
export const topUpRoute: "stripe" | "appstore" = Platform.OS === "ios" ? "appstore" : "stripe";

/** "$5", "$10" — a round amount, written the way a button should read. */
export const topUpLabel = (cents: number) =>
  cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

/**
 * Add money, through Stripe Checkout in an in-app browser.
 *
 * The balance moves when Stripe's webhook confirms the payment, never on the
 * way out of the browser, so the wallet is re-read when the sheet closes
 * rather than guessed at. A cancelled checkout therefore shows the old
 * balance, which is the true one.
 */
export function useTopUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (amountCents: number) => {
      const { url } = await api<{ url?: string }>("/api/nova/top-up", {
        method: "POST",
        body: { amountCents },
      });
      if (!url) throw new Error("Couldn't start that payment.");
      await WebBrowser.openBrowserAsync(url);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: WALLET_KEY }),
  });
}

/**
 * Spend the balance on one of the priced outcomes.
 *
 * Not a store purchase: the money is already on the account, and what is being
 * bought is Nova doing a job. Works on every platform.
 */
export function useBuy(path: string, body?: Record<string, unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<any>(path, { method: "POST", body: body ?? {} }),
    onSettled: () => qc.invalidateQueries({ queryKey: WALLET_KEY }),
  });
}

/** The balance and what is left of the month, as a card. */
export function WalletCard({ wallet, onTopUp }: { wallet: Wallet | undefined; onTopUp?: () => void }) {
  if (!wallet) return null;
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Label>Balance</Label>
          <Text style={{ color: colors.text, fontSize: font.xl, fontFamily: fontFamily.bold }}>
            {wallet.devUnlimited ? "Everything free" : wallet.balanceDisplay}
          </Text>
          <Meta>
            {wallet.allowanceRemaining} of {wallet.allowanceLimit} free Nova actions left this month
            {wallet.actionsBought > 0 ? `, and ${wallet.actionsBought} you've bought` : ""}.
          </Meta>
        </View>
        {onTopUp && canTopUpHere ? (
          <Btn label="Add money" variant="outline" small onPress={onTopUp} testID="button-top-up" />
        ) : null}
      </View>
    </Card>
  );
}

/**
 * What to show when the server says this costs money.
 *
 * Every word of it comes off the 402: the price, the balance, and `remedy` —
 * the single next action the server has already worked out. A screen that
 * decided for itself whether to offer a top-up or a pack would be a second
 * opinion about somebody's money, and the two would drift.
 */
export function PayWall({ need, onTopUp, onRetry, busy }: {
  need: PaymentRequired;
  onTopUp: (cents: number) => void;
  onRetry?: () => void;
  busy?: boolean;
}) {
  const short = need.topUp?.shortfallCents ?? 0;
  const suggest = need.topUp?.suggestCents ?? 0;

  return (
    <Card>
      <View style={{ gap: spacing.md }}>
        <View style={{ gap: 4 }}>
          <Label>{need.label}</Label>
          {need.price ? (
            <Text style={{ color: colors.text, fontSize: font.xl, fontFamily: fontFamily.bold }}>
              {need.price.display}
            </Text>
          ) : null}
          <Body>{need.message}</Body>
        </View>

        <View style={{ backgroundColor: colors.canvas, borderRadius: radius.sm, padding: spacing.md, gap: 2 }}>
          <Meta>Balance {need.wallet.balanceDisplay}</Meta>
          {short > 0 ? <Meta>Short by {(short / 100).toFixed(2)}</Meta> : null}
        </View>

        {need.remedy === "none" ? (
          /*
           * Money will not fix this one — a rate limit, or an account
           * problem. Saying "add money" here would take somebody to a
           * checkout that changes nothing.
           */
          <Meta>Nothing to buy here. Try again in a little while.</Meta>
        ) : !canTopUpHere && short > 0 ? (
          <Meta>
            Adding money isn't available in the iOS app. Open {PRODUCTION_API_URL.replace(/^https?:\/\//, "")} in a
            browser to top up, and it'll be here when you come back.
          </Meta>
        ) : short > 0 ? (
          <>
            <Btn
              label={`Add $${(suggest / 100).toFixed(0)} and continue`}
              loading={busy}
              disabled={busy}
              onPress={() => onTopUp(suggest)}
              testID="button-paywall-topup"
            />
            <Meta>Money you add never expires, and an action that fails is refunded automatically.</Meta>
          </>
        ) : (
          /*
           * The balance already covers it, so something else refused — most
           * often a pack that has to be bought before it can be spent. The
           * retry is the action.
           */
          onRetry ? <Btn label="Try again" loading={busy} disabled={busy} onPress={onRetry} /> : null
        )}
      </View>
    </Card>
  );
}

/**
 * "Nova builds the whole business" — the one that buys a project outright.
 *
 * $14.99, once, and from then on every priced outcome on that project is
 * already paid for. Offered wherever somebody is looking at a project and
 * about to spend three dollars at a time on it.
 */
export function useBuildMyBusiness(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ projectId: string; paidCents: number; started: boolean; alreadyPaid?: boolean }>(
      "/api/nova/build-my-business",
      { method: "POST", body: { projectId } },
    ),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: WALLET_KEY });
      qc.invalidateQueries({ queryKey: ["decision-sim", projectId] });
    },
  });
}

/** Turning a 402 into something a person can act on, in one hook. */
export function usePayFlow() {
  const qc = useQueryClient();
  const topUp = useTopUp();
  const afterPay = useCallback(() => {
    qc.invalidateQueries({ queryKey: WALLET_KEY });
  }, [qc]);
  return { topUp, afterPay };
}

/**
 * The app-wide answer to "that costs money".
 *
 * Registered once at the root, so a 402 from anywhere — a code audit, a
 * document, a roadmap, an image, any of the three simulations — puts the same
 * sheet in front of somebody with the same price on it. Wiring this screen by
 * screen was the alternative, and it would have meant a dozen places each
 * deciding for themselves what a refusal meant, with the ones nobody
 * remembered quietly dead-ending.
 *
 * It does not swallow the error: the request still rejects, so a screen that
 * wants to say something of its own still can, and this is only the floor.
 */
export function PayWallHost({ children }: { children: React.ReactNode }) {
  const [need, setNeed] = useState<PaymentRequired | null>(null);
  const topUp = useTopUp();

  useEffect(() => {
    setPaymentRequiredHandler((body) => setNeed(body as PaymentRequired));
    return () => setPaymentRequiredHandler(null);
  }, []);

  return (
    <>
      {children}
      <Modal visible={!!need} transparent animationType="slide" onRequestClose={() => setNeed(null)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
          <View style={{ backgroundColor: colors.canvas, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.md }}>
            {need ? (
              <PayWall
                need={need}
                busy={topUp.isPending}
                onTopUp={(cents) => topUp.mutate(cents, { onSuccess: () => setNeed(null) })}
                onRetry={() => setNeed(null)}
              />
            ) : null}
            <Btn label="Not now" variant="ghost" onPress={() => setNeed(null)} testID="button-paywall-close" />
          </View>
        </View>
      </Modal>
    </>
  );
}
