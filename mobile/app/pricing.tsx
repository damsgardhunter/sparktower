/**
 * Your balance, and the things it buys — the web's /pricing.
 *
 * This screen used to sell four subscription tiers. There are no tiers any
 * more: the web moved to a balance and per-outcome prices a while ago, every
 * plan became free, and this screen carried on offering to upgrade people to
 * something that no longer existed. Somebody who pressed "Upgrade to Pro" was
 * sent to a Stripe page for a product the server had stopped honouring.
 *
 * What it shows now is what the account actually has: money on the balance,
 * what is left of the month's free Nova actions, and the two things that can
 * be bought outright — more actions, and a day of images. Everything else is
 * priced where it is used, which is why this screen does not list eleven
 * outcomes: a price only means something next to the thing it buys.
 *
 * ## Adding money
 *
 * Through Stripe Checkout in an in-app browser on Android and the web
 * preview. On iOS it is In-App Purchase or nothing — see `Pay.tsx` and
 * `src/iap.ts` for the whole of that argument; this screen only asks.
 */
import { useState } from "react";
import { Text, View } from "react-native";
import { Stack } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../src/theme";
import { Body, Btn, Card, Label, Loading, Meta, Screen } from "../src/components/ui";
import { NoticeBanner, useNotice } from "../src/components/Sheet";
import { WALLET_KEY, topUpLabel, topUpRoute, useBuy, useTopUp, useWallet } from "../src/components/Pay";
import { useAppleTopUp } from "../src/iap";

/** What the server will take, from TOP_UP_CENTS. Three is a choice; six is a form. */
const AMOUNTS = [500, 1000, 2000];

export default function WalletScreen() {
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();
  const wallet = useWallet();
  const topUp = useTopUp();
  const [busy, setBusy] = useState<string | null>(null);

  /*
   * Two ways to add money, one button. Stripe Checkout in a browser where the
   * store rules allow it, the App Store where they do not — the screen asks
   * for an amount and does not otherwise care which.
   */
  const appStore = useAppleTopUp(
    () => { qc.invalidateQueries({ queryKey: WALLET_KEY }); show({ tone: "success", text: "Added to your balance." }); },
    (text) => show({ tone: "error", text }),
  );
  const addMoney = (cents: number) => {
    if (topUpRoute === "appstore") { appStore.buy(cents); return; }
    topUp.mutate(cents, { onError: (e: any) => show({ tone: "error", text: e?.message ?? "Couldn't start that payment." }) });
  };
  const addingMoney = topUp.isPending || appStore.busy;

  const actions = useBuy("/api/nova/day-pass");
  const images = useBuy("/api/nova/image-pass");

  const w = wallet.data;

  const buy = (what: "actions" | "images") => {
    const m = what === "actions" ? actions : images;
    setBusy(what);
    m.mutate(undefined, {
      onSuccess: () => show({
        tone: "success",
        text: what === "actions" ? "25 more Nova actions, on the account." : "Images are unlimited for the next 24 hours.",
      }),
      /*
       * A refusal for money is not toasted: the app-wide paywall has already
       * been handed the 402 by the api client and is showing the price and
       * the way to pay it. Anything else is an ordinary failure.
       */
      onError: (e: any) => { if (e?.status !== 402) show({ tone: "error", text: e?.message ?? "That didn't go through." }); },
      onSettled: () => { setBusy(null); qc.invalidateQueries({ queryKey: WALLET_KEY }); },
    });
  };

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: "Balance" }} />
      <Screen canvas onRefresh={() => wallet.refetch()} refreshing={wallet.isRefetching}>
        {wallet.isLoading || !w ? (
          <Loading label="Reading your balance…" />
        ) : (
          <>
            <Card>
              <View style={{ gap: spacing.xs }}>
                <Label>On your account</Label>
                <Text style={{ color: colors.text, fontSize: font.xxl, fontFamily: fontFamily.bold }}>
                  {w.devUnlimited ? "Everything free" : w.balanceDisplay}
                </Text>
                <Meta>
                  {w.allowanceRemaining} of {w.allowanceLimit} free Nova actions left this month
                  {w.actionsBought > 0 ? `, and ${w.actionsBought} you've bought` : ""}.
                  {w.imagePassActive ? " Images are unlimited right now." : ""}
                </Meta>
                <Meta>Money you add never expires, and an action that fails is refunded automatically.</Meta>
              </View>
            </Card>

            {/* ── Adding money ── */}
            <Card>
              <View style={{ gap: spacing.md }}>
                <View style={{ gap: 2 }}>
                  <Label>Add money</Label>
                  <Meta>
                    Nova's bigger jobs have a price — $3 to simulate a decision, $6 to score a marketing scheme,
                    $14.99 for a whole business built out. They come off this balance.
                  </Meta>
                </View>

                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  {AMOUNTS.map((cents) => (
                    <Btn
                      key={cents}
                      label={topUpLabel(cents)}
                      variant="outline"
                      small
                      style={{ flex: 1 }}
                      loading={addingMoney}
                      disabled={addingMoney}
                      onPress={() => addMoney(cents)}
                      testID={`button-topup-${cents}`}
                    />
                  ))}
                </View>
                <Meta>
                  {topUpRoute === "appstore"
                    ? "Through the App Store, like anything else bought in an app."
                    : "Through Stripe, in a browser that opens over this one."}
                </Meta>
              </View>
            </Card>

            {/* ── The two things sold outright ── */}
            <Card>
              <View style={{ gap: spacing.md }}>
                <View style={{ gap: 2 }}>
                  <Label>More Nova actions</Label>
                  <Meta>
                    $5 buys 25 more, spent one at a time. What you buy when the month's free ones have run out —
                    they never expire, so nothing is wasted by buying them on a quiet week.
                  </Meta>
                </View>
                <Btn
                  label="Buy 25 actions — $5"
                  variant="outline"
                  loading={busy === "actions"}
                  disabled={!!busy}
                  onPress={() => buy("actions")}
                  testID="button-buy-actions"
                />

                <View style={{ height: 1, backgroundColor: colors.border }} />

                <View style={{ gap: 2 }}>
                  <Label>A day of images</Label>
                  <Meta>
                    $5 for unlimited image generation for 24 hours — project pages, post images, storyboards,
                    badges. Up to 50 an hour.
                  </Meta>
                </View>
                <Btn
                  label={w.imagePassActive ? "Running now" : "Buy a day — $5"}
                  variant="outline"
                  loading={busy === "images"}
                  disabled={!!busy || w.imagePassActive}
                  onPress={() => buy("images")}
                  testID="button-buy-images"
                />

                <Meta>Both come off your balance.</Meta>
              </View>
            </Card>

            <Card>
              <View style={{ gap: 2 }}>
                <Label>No plans, no subscription</Label>
                <Meta>
                  Paying never buys standing, reach or features — only Nova doing work for you. Everything the
                  product does is free; what costs money is asking Nova to do a long job.
                </Meta>
              </View>
            </Card>
          </>
        )}
      </Screen>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </View>
  );
}
