import { useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl,
  StyleSheet, Text, View,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, radius, spacing, postTypeColors } from "../../src/theme";
import { Composer } from "../../src/components/Composer";

interface FeedPost {
  id: string;
  postType: string;
  content: string;
  mediaUrls: string[];
  reactionCount: number;
  commentCount: number;
  isSystemGenerated: boolean;
  createdAt: string;
  author: { id: string; firstName?: string; lastName?: string; email?: string };
  profile?: { displayName?: string; headline?: string };
  project?: { id: string; title: string; isPrivate: boolean } | null;
  viewerReaction: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  project_update: "Project Update",
  looking_for_help: "Looking for Help",
  looking_for_cofounder: "Looking for Cofounder",
  seeking_feedback: "Seeking Feedback",
  milestone: "Milestone",
  idea_validation: "Idea Validation",
  launch: "Launch",
  investor_update: "Investor Update",
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Strips the **bold** markers the web renders as bold. */
function plain(content: string): string {
  return content.replace(/\*\*(.+?)\*\*/g, "$1");
}

export default function Feed() {
  const qc = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["feed"],
    queryFn: () => api<{ posts: FeedPost[] }>("/api/feed?limit=25"),
  });

  const react = useMutation({
    mutationFn: (postId: string) => api(`/api/feed/${postId}/react`, {
      method: "POST",
      body: { reaction: "like" },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feed"] }),
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={data?.posts ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <Pressable style={styles.composerPrompt} onPress={() => setComposerOpen(true)}>
            <Text style={styles.composerPromptText}>Share what you're building…</Text>
          </Pressable>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyBody}>
              Be the first to share what you're building.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const name =
            item.profile?.displayName ||
            [item.author?.firstName, item.author?.lastName].filter(Boolean).join(" ") ||
            "Someone";
          const accent = postTypeColors[item.postType] || colors.info;
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.author} numberOfLines={1}>
                    {name}
                    {item.project ? (
                      <Text style={styles.projectName}>  ·  {item.project.title}</Text>
                    ) : null}
                  </Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.meta}>{timeAgo(item.createdAt)}</Text>
                    <View style={[styles.typePill, { borderColor: accent }]}>
                      <Text style={[styles.typePillText, { color: accent }]}>
                        {TYPE_LABELS[item.postType] || item.postType}
                      </Text>
                    </View>
                    {item.isSystemGenerated && (
                      <Text style={styles.autoTag}>Auto</Text>
                    )}
                  </View>
                </View>
              </View>

              <Text style={styles.content}>{plain(item.content)}</Text>

              <View style={styles.actions}>
                <Pressable
                  onPress={() => react.mutate(item.id)}
                  style={styles.action}
                  disabled={react.isPending}
                >
                  <Text style={[styles.actionText, item.viewerReaction && styles.actionTextActive]}>
                    👍 {item.reactionCount > 0 ? item.reactionCount : "Like"}
                  </Text>
                </Pressable>
                <View style={styles.action}>
                  <Text style={styles.actionText}>
                    💬 {item.commentCount > 0 ? item.commentCount : "Comment"}
                  </Text>
                </View>
              </View>
            </View>
          );
        }}
      />

      <Composer
        visible={composerOpen}
        onClose={() => setComposerOpen(false)}
        onPosted={() => {
          setComposerOpen(false);
          qc.invalidateQueries({ queryKey: ["feed"] });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  list: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  composerPrompt: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  composerPromptText: { color: colors.textTertiary, fontSize: font.base },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm,
  },
  cardHeader: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  avatar: {
    width: 40, height: 40, borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: colors.text, fontSize: font.lg, fontWeight: "700" },
  author: { color: colors.text, fontSize: font.base, fontWeight: "700" },
  projectName: { color: colors.primary, fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 2, flexWrap: "wrap" },
  meta: { color: colors.textTertiary, fontSize: font.xs },
  typePill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1 },
  typePillText: { fontSize: font.xs, fontWeight: "600" },
  autoTag: { color: colors.textTertiary, fontSize: font.xs },
  content: { color: colors.text, fontSize: font.base, lineHeight: 22 },
  actions: {
    flexDirection: "row", gap: spacing.lg, borderTopWidth: 1,
    borderTopColor: colors.borderSubtle, paddingTop: spacing.sm,
  },
  action: { flexDirection: "row", alignItems: "center" },
  actionText: { color: colors.textSecondary, fontSize: font.sm },
  actionTextActive: { color: colors.primary, fontWeight: "700" },
  empty: { alignItems: "center", paddingVertical: spacing.xxl * 2, gap: spacing.sm },
  emptyTitle: { color: colors.text, fontSize: font.lg, fontWeight: "700" },
  emptyBody: { color: colors.textSecondary, fontSize: font.sm, textAlign: "center", maxWidth: 260 },
});
