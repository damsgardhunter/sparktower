import { useState } from "react";
import { ScrollView, Text, View, Platform } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { api } from "../src/api/client";
import { useEntitlementsQuery } from "../src/hooks/useEntitlements";
import { colors, font, fontFamily, radius, shadow, spacing } from "../src/theme";
import { Btn, Icon, Loading, NovaGradient, Progress, type IconName } from "../src/components/ui";
import { Callout, Pill } from "../src/components/MoreKit";
import { NoticeBanner, useNotice } from "../src/components/Sheet";

const TIER_ORDER = ["free", "starter", "builder", "pro"];
const STAGE_ICONS: Record<string, IconName> = { Explore: "compass", Start: "sparkles", Build: "map", Accelerate: "rocket" };

/**
 * Plans, usage, and upgrading — the web's /pricing.
 *
 * Checkout and the billing portal are Stripe pages, so they open in an in-app
 * browser; when it closes, the subscription is re-synced so a new plan shows
 * straight away. (App Store review can require in-app purchase for digital
 * subscriptions on iOS.)
 *
 * On iOS the plans are shown but upgrading and managing happen on the web:
 * Apple requires in-app purchase for digital subscriptions sold inside an iOS
 * app (Guideline 3.1.1), and StoreKit isn't wired up. Android and the web
 * preview open Stripe in the in-app browser.
 */
const IOS_NO_WEB_CHECKOUT = Platform.OS === "ios";
export default function Pricing() {
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();
  const [pendingTier, setPendingTier] = useState<string | null>(null);
  const ent = useEntitlementsQuery();

  const { data, isLoading } = useQuery({ queryKey: ["plans"], queryFn: () => api<any>("/api/plans") });

  // The web lands back on /pricing?success=true and syncs; the phone syncs when
  // the in-app browser closes, and says so when the plan actually changed.
  const afterBrowser = async (before: string) => {
    let tier: string | undefined;
    try { tier = (await api<{ tier?: string }>("/api/stripe/sync-subscription", { method: "POST" })).tier; } catch { /* the webhook will catch up */ }
    // Entitlements shape nearly every screen, so refresh everything, as the web's tier switch does.
    await qc.invalidateQueries();
    if (tier && tier !== before) {
      show(tier === "free"
        ? { tone: "info", text: "You're on the Free plan now." }
        : { tone: "success", text: "You're all set! Your plan is active. Nova just leveled up." });
    }
  };

  const checkout = useMutation({
    mutationFn: ({ priceId }: { priceId: string; tier: string }) => api<{ url?: string }>("/api/checkout", { method: "POST", body: { priceId } }),
    onSuccess: async (r) => {
      setPendingTier(null);
      if (!r.url) { show({ tone: "error", text: "Couldn't start checkout: no checkout link came back." }); return; }
      await WebBrowser.openBrowserAsync(r.url);
      await afterBrowser(ent.tier);
    },
    onError: (e: any) => { setPendingTier(null); show({ tone: "error", text: e?.message || "Couldn't start checkout. Please try again." }); },
  });

  const portal = useMutation({
    mutationFn: () => api<{ url?: string }>("/api/billing-portal", { method: "POST" }),
    onSuccess: async (r) => {
      if (!r.url) { show({ tone: "error", text: "Couldn't open the billing portal." }); return; }
      await WebBrowser.openBrowserAsync(r.url);
      await afterBrowser(ent.tier);
    },
    onError: (e: any) => show({ tone: "error", text: e?.message === "No active subscription" ? "You don't have a paid subscription to manage." : "Couldn't open the billing portal." }),
  });

  if (isLoading || ent.isLoading) return <Loading />;

  const plans: any[] = [...(data?.plans ?? [])].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
  const current = plans.find((p) => p.tier === ent.tier);
  const pct = ent.isUnlimited || ent.creditsLimit <= 0 ? 0 : Math.min(100, (ent.creditsUsed / ent.creditsLimit) * 100);
  const costs = data?.creditCosts;

  return (
    <>
      <Stack.Screen options={{ title: "Plans & credits" }} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl * 2 }}>
        {/* Sell the outcome, not the credits. */}
        <View style={{ gap: spacing.sm, paddingHorizontal: spacing.xs, paddingTop: spacing.sm }}>
          <Text style={{ color: colors.text, fontSize: font.xxl, lineHeight: 34, fontFamily: fontFamily.bold, letterSpacing: -0.5 }}>Tell Nova where you want to go.</Text>
          <Text style={{ color: colors.textSecondary, fontSize: font.base, lineHeight: 22, fontFamily: fontFamily.regular }}>
            Nova helps you figure out how to get there — turning a vague idea into a project, a plan, and the people you need to build it.
          </Text>
        </View>

        {/* Usage first on a phone: it's what you came to check. */}
        <View style={cardStyle}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>Your Nova usage this month</Text>
              <Text style={meta}>
                {ent.isUnlimited ? `${ent.creditsUsed.toLocaleString()} actions used — unlimited on your plan` : `${ent.creditsUsed} of ${ent.creditsLimit} credits used`}
              </Text>
            </View>
            <Pill label={current?.name ?? "Free"} />
          </View>
          {!ent.isUnlimited && (
            <View style={{ gap: 6 }}>
              <Progress value={pct} />
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={small}>{ent.creditsRemaining} remaining</Text>
                <Text style={small}>Resets at the start of each month</Text>
              </View>
            </View>
          )}
          {costs && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {[
                ["Nova chat", 1], ["Roadmap", costs.roadmapGeneration], ["Roadmap update", costs.roadmapUpdate],
                ["Health check", costs.healthCheck], ["Video", costs.videoGeneration],
              ].filter(([, v]) => v != null).map(([k, v]) => (
                <View key={String(k)} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={small}>{k}</Text>
                  <Text style={[small, { color: colors.text, fontFamily: fontFamily.semibold }]}>{v}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {!data?.stripeConfigured && (
          <Callout tone="warn" title="Checkout isn't connected yet" body="Plans are shown from the catalog, but paid upgrades need Stripe configured on the server." />
        )}

        {plans.map((plan) => {
          const isCurrent = ent.tier === plan.tier;
          const featured = plan.featured;
          const busy = checkout.isPending && pendingTier === plan.tier;
          return (
            <View key={plan.tier} style={[cardStyle, { padding: 0, overflow: "hidden" }, featured && { borderColor: colors.primary, borderWidth: 1.5 }, isCurrent && !featured && { borderColor: colors.primary }]}>
              {featured && (
                <NovaGradient style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 6 }}>
                  <Icon name="sparkles" size={13} color="#FFFFFF" />
                  <Text style={{ color: "#FFFFFF", fontSize: font.xs, fontFamily: fontFamily.bold, letterSpacing: 0.5 }}>MOST POPULAR</Text>
                </NovaGradient>
              )}
              <View style={{ padding: spacing.lg, gap: spacing.md }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <View style={{ width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: featured ? colors.primary : colors.primarySoft }}>
                    <Icon name={STAGE_ICONS[plan.stage] ?? "compass"} size={17} color={featured ? "#FFFFFF" : colors.primary} />
                  </View>
                  <Text style={{ flex: 1, color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.semibold, letterSpacing: 1.5, textTransform: "uppercase" }}>{plan.stage}</Text>
                  {isCurrent && <Pill label="Your plan" icon="checkmark" />}
                </View>

                <View style={{ gap: 2 }}>
                  <Text style={{ color: colors.text, fontSize: font.xl, fontFamily: fontFamily.bold }}>{plan.name}</Text>
                  <Text style={{ color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{plan.promise}</Text>
                </View>
                <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 20, fontFamily: fontFamily.regular }}>{plan.pitch}</Text>

                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
                  <Text style={{ color: colors.text, fontSize: 34, fontFamily: fontFamily.bold, letterSpacing: -0.5 }}>{plan.price === 0 ? "Free" : `$${Number(plan.price).toFixed(2)}`}</Text>
                  {plan.price > 0 && <Text style={meta}>/month</Text>}
                </View>

                <View style={{ gap: 8 }}>
                  {(plan.highlights ?? []).map((h: string, i: number) => (
                    <View key={i} style={{ flexDirection: "row", gap: 8 }}>
                      <Icon name="checkmark" size={17} color={featured ? colors.primary : "#B07CC6"} />
                      <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, lineHeight: 20, fontFamily: fontFamily.regular }}>{h}</Text>
                    </View>
                  ))}
                </View>

                {IOS_NO_WEB_CHECKOUT && plan.tier !== "free" && !isCurrent ? (
                  <Text style={[small, { textAlign: "center" }]}>Upgrade on the web at sparktower.app/pricing</Text>
                ) : IOS_NO_WEB_CHECKOUT && isCurrent && plan.tier !== "free" ? (
                  <Text style={[small, { textAlign: "center" }]}>Manage your plan on the web at sparktower.app/pricing</Text>
                ) : IOS_NO_WEB_CHECKOUT && plan.tier === "free" && !isCurrent ? (
                  // Switching to Free is the Stripe billing portal on the web — also a web-only step on iOS.
                  <Text style={[small, { textAlign: "center" }]}>Switch plans on the web at sparktower.app/pricing</Text>
                ) : isCurrent ? (
                  plan.tier === "free"
                    ? <Btn label="Your current plan" variant="outline" disabled />
                    : <Btn label="Manage plan" icon="open-outline" variant="outline" loading={portal.isPending} onPress={() => portal.mutate()} />
                ) : plan.tier === "free" ? (
                  <Btn label="Switch to Free" variant="outline" loading={portal.isPending} onPress={() => portal.mutate()} />
                ) : (
                  <Btn label={plan.priceId ? plan.cta : "Unavailable"} variant={featured ? "primary" : "outline"}
                    disabled={!plan.priceId || checkout.isPending} loading={busy}
                    onPress={() => { setPendingTier(plan.tier); checkout.mutate({ priceId: plan.priceId, tier: plan.tier }); }} />
                )}
                {plan.footnote ? <Text style={[small, { textAlign: "center" }]}>{plan.footnote}</Text> : null}
              </View>
            </View>
          );
        })}

        {!!data?.comparison?.length && (
          <View style={{ gap: spacing.sm }}>
            <View style={{ gap: 2, paddingHorizontal: spacing.xs }}>
              <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }}>Compare every plan</Text>
              <Text style={meta}>All the details, including credit limits.</Text>
            </View>
            <View style={[cardStyle, { padding: 0, overflow: "hidden" }]}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View>
                  <View style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised }}>
                    <Text style={[cell, featureCell, { fontFamily: fontFamily.semibold, color: colors.textTertiary }]}>Feature</Text>
                    {TIER_ORDER.map((t) => {
                      const p = plans.find((x) => x.tier === t);
                      return (
                        <View key={t} style={[valueCell, { paddingVertical: 8 }]}>
                          <Text style={{ fontSize: 9, letterSpacing: 1, color: colors.textTertiary, fontFamily: fontFamily.semibold, textTransform: "uppercase" }}>{p?.stage}</Text>
                          <Text style={{ fontSize: font.sm, color: p?.featured ? colors.primary : colors.text, fontFamily: fontFamily.semibold }}>{p?.name}</Text>
                        </View>
                      );
                    })}
                  </View>
                  {data.comparison.map((row: any, i: number) => (
                    <View key={row.label} style={{ flexDirection: "row", borderTopWidth: i ? 1 : 0, borderColor: colors.borderSubtle, alignItems: "center" }}>
                      <Text style={[cell, featureCell]}>{row.label}</Text>
                      {TIER_ORDER.map((t) => {
                        const v = row.values[t];
                        return (
                          <View key={t} style={valueCell}>
                            {v === true ? <Icon name="checkmark" size={17} color={colors.primary} />
                              : v === false ? <Icon name="remove" size={17} color={colors.border} />
                              : <Text style={{ fontSize: font.xs, color: colors.text, fontFamily: fontFamily.medium, textAlign: "center" }}>{String(v)}</Text>}
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          </View>
        )}

        <View style={{ gap: 6, paddingHorizontal: spacing.md }}>
          {data?.fairUseNotice ? <Text style={[small, { textAlign: "center" }]}>{data.fairUseNotice}</Text> : null}
          <Text style={[small, { textAlign: "center" }]}>Cancel anytime from the billing portal. Payments are processed securely by Stripe.</Text>
        </View>
      </ScrollView>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}

const cardStyle = {
  backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
  padding: spacing.lg, gap: spacing.md, ...shadow.card,
} as const;
const meta = { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular } as const;
const small = { color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular } as const;
const cell = { color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.regular, paddingVertical: 10, paddingHorizontal: spacing.md } as const;
const featureCell = { width: 150 } as const;
const valueCell = { width: 84, alignItems: "center" as const, justifyContent: "center" as const, paddingVertical: 10, paddingHorizontal: 4 };
