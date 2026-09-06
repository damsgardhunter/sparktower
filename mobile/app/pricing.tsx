import { Linking, Platform, View } from "react-native";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api, API_URL } from "../src/api/client";
import { spacing, colors } from "../src/theme";
import {
  Body, Btn, Card, Chip, H1, H2, Label, Loading, Meta, Progress, Row, Screen,
} from "../src/components/ui";

/**
 * Plans and current usage.
 *
 * Checkout deliberately opens in the browser rather than in-app. Apple
 * requires in-app purchase for digital goods sold inside an iOS app
 * (Guideline 3.1.1), so on iOS this only *shows* the plans — upgrading needs
 * StoreKit, which isn't wired up yet.
 */
export default function Pricing() {
  const { data, isLoading } = useQuery({
    queryKey: ["plans"],
    queryFn: () => api<any>("/api/plans"),
  });

  const { data: sub } = useQuery({
    queryKey: ["subscription"],
    queryFn: () => api<any>("/api/subscription"),
  });

  if (isLoading) return <Loading />;

  const plans = data?.plans ?? [];

  return (
    <>
      <Stack.Screen options={{ title: "Plans" }} />
      <Screen>
        <View style={{ gap: spacing.xs }}>
          <H1>Tell Nova where you want to go.</H1>
          <Body muted>
            Nova helps you figure out how to get there — turning a vague idea into a
            project, a plan, and the people you need to build it.
          </Body>
        </View>

        {sub && (
          <Card>
            <Label>Your usage this month</Label>
            <Row between>
              <Body style={{ fontWeight: "700", textTransform: "capitalize" }}>{sub.tier}</Body>
              <Meta>
                {sub.unlimited
                  ? `${sub.creditsUsed} actions · unlimited`
                  : `${sub.creditsUsed} / ${sub.creditsLimit} credits`}
              </Meta>
            </Row>
            {!sub.unlimited && sub.creditsLimit > 0 && (
              <Progress value={(sub.creditsUsed / sub.creditsLimit) * 100} />
            )}
          </Card>
        )}

        {plans.map((p: any) => (
          <Card key={p.tier} accent={p.featured ? colors.primary : undefined}>
            <Label>{p.stage}</Label>
            <Row between>
              <H2>{p.name}</H2>
              <Body style={{ fontWeight: "800" }}>
                {p.price === 0 ? "Free" : `$${p.price.toFixed(2)}/mo`}
              </Body>
            </Row>
            <Body style={{ color: colors.primary, fontWeight: "600" }}>{p.promise}</Body>
            <Body muted>{p.pitch}</Body>
            <View style={{ gap: 2 }}>
              {(p.highlights ?? []).map((h: string, i: number) => (
                <Body key={i}>· {h}</Body>
              ))}
            </View>
            {sub?.tier === p.tier ? (
              <Chip label="Your plan" small active />
            ) : p.price > 0 ? (
              Platform.OS === "ios" ? (
                <Meta>Manage your plan on the web at sparktower.app/pricing</Meta>
              ) : (
                <Btn
                  label={p.cta}
                  variant={p.featured ? "primary" : "outline"}
                  small
                  onPress={() => Linking.openURL(`${API_URL}/pricing`)}
                />
              )
            ) : null}
            {p.footnote && <Meta>{p.footnote}</Meta>}
          </Card>
        ))}

        {data?.fairUseNotice && <Meta>{data.fairUseNotice}</Meta>}
      </Screen>
    </>
  );
}
