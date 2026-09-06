import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, radius, spacing } from "../../src/theme";

interface Project {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  isPrivate: boolean;
  views: number;
  rolesNeeded?: string[] | null;
  oneLiner?: string | null;
  soloMode?: boolean | null;
}

export default function Projects() {
  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["my-projects"],
    queryFn: () => api<Project[]>("/api/user/projects"),
  });

  if (isLoading) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.list}
      data={data ?? []}
      keyExtractor={(p) => p.id}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No projects yet</Text>
          <Text style={styles.emptyBody}>
            Create one on the web app and it'll show up here.
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {item.isPrivate ? "🔒 " : ""}{item.title}
            </Text>
            <View style={styles.statusPill}>
              <Text style={styles.statusText}>{item.status}</Text>
            </View>
          </View>
          <Text style={styles.body} numberOfLines={3}>
            {item.oneLiner || item.description}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{item.category}</Text>
            <Text style={styles.meta}>·</Text>
            <Text style={styles.meta}>{item.views} views</Text>
            {/* Solo builders aren't recruiting, so report the mode rather
                than a role count that may be left over from before. */}
            {item.soloMode ? (
              <>
                <Text style={styles.meta}>·</Text>
                <Text style={styles.metaSolo}>Solo Builder</Text>
              </>
            ) : (item.rolesNeeded?.length ?? 0) > 0 && (
              <>
                <Text style={styles.meta}>·</Text>
                <Text style={styles.meta}>{item.rolesNeeded!.length} roles</Text>
              </>
            )}
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  list: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, gap: spacing.sm,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { color: colors.text, fontSize: font.lg, fontWeight: "700", flex: 1 },
  statusPill: {
    backgroundColor: colors.surfaceRaised, borderRadius: radius.pill,
    paddingHorizontal: spacing.sm, paddingVertical: 2,
  },
  statusText: { color: colors.textSecondary, fontSize: font.xs, textTransform: "capitalize" },
  body: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 20 },
  metaRow: { flexDirection: "row", gap: spacing.xs, alignItems: "center" },
  meta: { color: colors.textTertiary, fontSize: font.xs },
  metaSolo: { color: colors.primary, fontSize: font.xs, fontWeight: "600" },
  empty: { alignItems: "center", paddingVertical: spacing.xxl * 2, gap: spacing.sm },
  emptyTitle: { color: colors.text, fontSize: font.lg, fontWeight: "700" },
  emptyBody: { color: colors.textSecondary, fontSize: font.sm, textAlign: "center", maxWidth: 260 },
});
