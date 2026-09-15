import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors, font, radius, spacing } from "../theme";

interface NextStepItem {
  project: { id: string; title: string };
  phase: string;
  progress: { done: number; total: number };
  next: { title: string; actor: string; step: string | null } | null;
  daysSinceActivity: number;
}

const ACTOR_SHORT: Record<string, string> = {
  "nova-builds": "Nova builds it", "nova-drafts": "Nova drafts it", "user-decides": "You choose", "user-does": "Only you",
};

/**
 * The top of the feed on the phone: each of your paths and its next step, one
 * tap from the project. Same list as the web — it comes from the server.
 */
export function ContinuePath() {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["next-steps"],
    queryFn: () => api<{ items: NextStepItem[] }>("/api/me/next-steps"),
  });
  const items = data?.items ?? [];
  if (!items.length) return null;
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, overflow: "hidden" }}>
      <Text style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs, fontSize: font.xs, fontWeight: "700", color: colors.primary, textTransform: "uppercase" }}>
        Continue your path
      </Text>
      {items.map((item) => (
        <Pressable
          key={item.project.id}
          onPress={() => router.push(`/manage/${item.project.id}` as any)}
          style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderSubtle }}
          accessibilityLabel={`Continue ${item.project.title}`}
        >
          <Text style={{ fontSize: font.base, fontWeight: "700", color: colors.text }}>{item.project.title}</Text>
          <Text style={{ fontSize: font.xs, color: colors.textSecondary }}>
            {item.phase} · {item.progress.done}/{item.progress.total} steps{item.daysSinceActivity >= 2 ? ` · away ${item.daysSinceActivity} days` : ""}
          </Text>
          <Text style={{ fontSize: font.sm, color: colors.text, marginTop: 2 }} numberOfLines={2}>
            {item.next ? `Next: ${item.next.step ?? item.next.title} · ${ACTOR_SHORT[item.next.actor] ?? item.next.actor}` : "The main line is done — pick what's next."}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
