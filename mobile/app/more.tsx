import { useRouter, Stack } from "expo-router";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { spacing } from "../src/theme";
import { Body, Card, Label, Meta, Row, Screen } from "../src/components/ui";

/**
 * Everything that doesn't earn a tab. Six tabs is already the practical
 * maximum before labels start truncating on small phones.
 */
export default function More() {
  const router = useRouter();

  const { data: sub } = useQuery({
    queryKey: ["subscription"],
    queryFn: () => api<any>("/api/subscription"),
  });

  // Contests are hidden for now, matching the web sidebar. The route still
  // exists and works via a deep link.
  const items: { label: string; sub: string; href: string; glyph: string }[] = [
    { label: "Leaderboard", sub: "Top projects and the Builder Index", href: "/(tabs)/leaderboard", glyph: "🏆" },
    { label: "New project", sub: "Start something", href: "/project/new", glyph: "➕" },
    { label: "Practice sprint", sub: "Rehearse with Nova", href: "/sprint/practice", glyph: "🤖" },
    { label: "Build my profile", sub: "Let Nova read your résumé", href: "/profile-builder", glyph: "📄" },
    { label: "Games", sub: "Typing Arena and Signal vs. Noise", href: "/games", glyph: "🎮" },
    { label: "Plans", sub: sub ? `You're on ${sub.tier}` : "Compare plans", href: "/pricing", glyph: "💳" },
  ];

  return (
    <>
      <Stack.Screen options={{ title: "More" }} />
      <Screen>
        {items.map((i) => (
          <Card key={i.href} onPress={() => router.push(i.href as any)}>
            <Row center gap={spacing.md}>
              <Body style={{ fontSize: 22 }}>{i.glyph}</Body>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "700" }}>{i.label}</Body>
                <Meta>{i.sub}</Meta>
              </View>
              <Meta>›</Meta>
            </Row>
          </Card>
        ))}

        {sub && (
          <Card>
            <Label>Credits</Label>
            <Meta>
              {sub.unlimited
                ? `${sub.creditsUsed} actions used · unlimited`
                : `${sub.creditsUsed} of ${sub.creditsLimit} used this month`}
            </Meta>
          </Card>
        )}
      </Screen>
    </>
  );
}
