import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api } from "../../src/api/client";
import { DISCOVER_NEW_KEY } from "../../src/explore";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Avatar, Btn, ListItem } from "../../src/components/ui";
import { NoticeBanner, Sheet, useNotice } from "../../src/components/Sheet";
import { PostCard } from "../../src/components/PostCard";
import { useMe } from "../../src/components/FeedParts";
import { POST_TYPES, type FeedPage, type PostType } from "../../src/components/feedModel";

type Scope = "everyone" | "following";

interface DiscoverNews {
  count: number;
  more: boolean;
  updates: { kind: "builder" | "project"; id: string; name: string; newPosts: number }[];
}

/** Short labels for the quick-start buttons under "Start a post". */
const QUICK: { type: PostType; label: string; icon: React.ComponentProps<typeof Ionicons>["name"]; color: string }[] = [
  { type: "project_update", label: "Update", icon: "rocket", color: "#2563EB" },
  { type: "looking_for_help", label: "Ask for help", icon: "hand-left", color: "#D97706" },
  { type: "launch", label: "Launch", icon: "sparkles", color: "#E11D48" },
];

/**
 * Home: the founder feed, the way a professional network lays it out on a
 * phone — start a post at the top, what's new from people you've looked at,
 * For you / Following, then posts as white cards on the gray canvas, loading
 * older ones as you scroll.
 */
export default function Feed() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const { notice, show, clear } = useNotice();
  const [scope, setScope] = useState<Scope>("everyone");
  const [filter, setFilter] = useState<PostType | "all">("all");
  const [filtering, setFiltering] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const feed = useInfiniteQuery({
    queryKey: ["feed", scope, filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "20" });
      if (scope === "following") params.set("scope", "following");
      if (filter !== "all") params.set("postType", filter);
      if (pageParam) params.set("before", pageParam);
      return api<FeedPage>(`/api/feed?${params.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const posts = useMemo(() => {
    const seen = new Set<string>();
    return (feed.data?.pages ?? []).flatMap((p) => p.posts).filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  }, [feed.data]);
  const followingCount = feed.data?.pages[0]?.followingCount;

  // Shares the tab bar's cache: new posts from people you follow, counted on the server.
  const { data: counts } = useQuery({
    queryKey: ["notification-count"],
    queryFn: () => api<{ count: number; followedPosts?: number }>("/api/notifications/unread-count"),
    refetchInterval: 30_000,
  });
  const newFromFollowing = counts?.followedPosts ?? 0;

  const { data: news } = useQuery({
    queryKey: DISCOVER_NEW_KEY,
    queryFn: () => api<DiscoverNews>("/api/discover/new-count"),
    refetchInterval: 60_000,
  });

  // Opening Following reads what it announced.
  useEffect(() => {
    if (scope !== "following" || newFromFollowing === 0) return;
    api("/api/notifications/read", { method: "POST", body: { kind: "followed_post" } })
      .then(() => qc.invalidateQueries({ queryKey: ["notification-count"] }))
      .catch(() => {});
  }, [scope, newFromFollowing]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      qc.resetQueries({ queryKey: ["feed", scope, filter] }),
      qc.invalidateQueries({ queryKey: DISCOVER_NEW_KEY }),
      qc.invalidateQueries({ queryKey: ["notification-count"] }),
    ]);
    setRefreshing(false);
  };

  const filterLabel = filter === "all" ? null : POST_TYPES.find((t) => t.type === filter)?.label;

  const header = (
    <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
      {/* Start a post */}
      <View style={s.block}>
        <View style={s.startRow}>
          <Pressable onPress={() => router.push("/(tabs)/profile")} accessibilityLabel="Your profile">
            <Avatar name={me.name} uri={me.avatar} size={42} />
          </Pressable>
          <Pressable
            onPress={() => router.push("/post/new")}
            style={({ pressed }) => [s.startPill, pressed && { backgroundColor: colors.surfaceRaised }]}
            accessibilityRole="button"
            testID="button-start-post"
          >
            <Text style={s.startText}>Start a post</Text>
          </Pressable>
        </View>
        <View style={s.quickRow}>
          {QUICK.map((q) => (
            <Pressable
              key={q.type}
              onPress={() => router.push(`/post/new?type=${q.type}` as any)}
              style={({ pressed }) => [s.quick, pressed && { backgroundColor: colors.surfaceRaised }]}
            >
              <Ionicons name={q.icon} size={18} color={q.color} />
              <Text style={s.quickText}>{q.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* New since you last looked, from Discover */}
      {!!news?.count && (
        <Pressable onPress={() => router.push("/(tabs)/discover")} style={({ pressed }) => [s.block, s.news, pressed && { opacity: 0.8 }]} testID="link-discover-news">
          <View style={s.newsIcon}><Ionicons name="compass" size={20} color={colors.primary} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.newsTitle}>{news.count}{news.more ? "+" : ""} new since you last looked</Text>
            <Text style={s.newsSub} numberOfLines={1}>
              from {news.updates.slice(0, 2).map((u) => u.name).join(" and ")}
              {news.updates.length > 2 ? ` and ${news.updates.length - 2} more` : ""}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </Pressable>
      )}

      {/* Whose posts, and a filter */}
      <View style={[s.block, s.tabsRow]}>
        {([["everyone", "For you"], ["following", "Following"]] as const).map(([value, label]) => {
          const on = scope === value;
          return (
            <Pressable key={value} onPress={() => setScope(value)} style={[s.tab, on && s.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }} testID={`feed-scope-${value}`}>
              <Text style={[s.tabText, on && s.tabTextOn]}>{label}</Text>
              {value === "following" && newFromFollowing > 0 && !on && (
                <View style={s.tabBadge}><Text style={s.tabBadgeText}>{newFromFollowing > 99 ? "99+" : newFromFollowing}</Text></View>
              )}
            </Pressable>
          );
        })}
        <View style={{ flex: 1 }} />
        <View style={[s.filterBtn, filterLabel && s.filterBtnOn]}>
          <Pressable onPress={() => setFiltering(true)} style={s.filterInner} accessibilityLabel="Filter posts">
            <Ionicons name="options-outline" size={16} color={filterLabel ? colors.primary : colors.textSecondary} />
            <Text style={[s.filterText, filterLabel && { color: colors.primary }]} numberOfLines={1}>{filterLabel ?? "Filter"}</Text>
          </Pressable>
          {filterLabel && (
            <Pressable onPress={() => setFilter("all")} hitSlop={8} accessibilityLabel="Clear filter">
              <Ionicons name="close" size={14} color={colors.primary} />
            </Pressable>
          )}
        </View>
      </View>

      {scope === "everyone" && newFromFollowing > 0 && (
        <Pressable onPress={() => setScope("following")} style={[s.block, s.followBanner]}>
          <Ionicons name="heart" size={16} color={colors.primary} />
          <Text style={s.followText}>
            <Text style={{ fontFamily: fontFamily.semibold }}>{newFromFollowing} new update{newFromFollowing === 1 ? "" : "s"}</Text> from people and projects you follow
          </Text>
          <Text style={s.followLink}>See them</Text>
        </Pressable>
      )}
    </View>
  );

  const empty = feed.isLoading ? (
    <View style={{ paddingVertical: spacing.xxl }}><ActivityIndicator color={colors.primary} /></View>
  ) : feed.isError ? (
    <EmptyBlock icon="cloud-offline-outline" title="Couldn't load the feed" body="Pull down to try again." />
  ) : scope === "following" ? (
    followingCount ? (
      <EmptyBlock icon="heart-outline" title="Nothing new from who you follow yet" body={`You follow ${followingCount} ${followingCount === 1 ? "builder or project" : "builders and projects"}. Their next update lands here.`} />
    ) : (
      <EmptyBlock icon="heart-outline" title="Follow builders to see updates" body="Follow people and projects, and what they post shows up here — nothing else.">
        <Btn label="Find builders to follow" small icon="people-outline" onPress={() => router.push("/(tabs)/discover")} />
      </EmptyBlock>
    )
  ) : filterLabel ? (
    <EmptyBlock icon="newspaper-outline" title={`No ${filterLabel} posts yet`} body="Try a different filter, or write the first one.">
      <Btn label="Clear filter" small variant="outline" onPress={() => setFilter("all")} />
    </EmptyBlock>
  ) : (
    <EmptyBlock icon="newspaper-outline" title="Nothing here yet" body="Be the first to share what you're building. Create a project or hit a milestone and it shows up here automatically.">
      <Btn label="Start a post" small icon="create-outline" onPress={() => router.push("/post/new")} />
    </EmptyBlock>
  );

  return (
    <View style={s.container}>
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <PostCard post={item} onNotice={show} />}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          posts.length === 0 ? null : feed.isFetchingNextPage ? (
            <View style={{ paddingVertical: spacing.lg }}><ActivityIndicator color={colors.primary} /></View>
          ) : !feed.hasNextPage ? (
            <View style={s.end}>
              <Ionicons name="checkmark-circle-outline" size={20} color={colors.textTertiary} />
              <Text style={s.endText}>You're all caught up</Text>
            </View>
          ) : null
        }
        onEndReached={() => { if (feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage(); }}
        onEndReachedThreshold={0.6}
        contentContainerStyle={{ paddingTop: spacing.sm, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      />

      <Sheet visible={filtering} onClose={() => setFiltering(false)} title="Show posts">
        <View style={{ marginHorizontal: -spacing.lg }}>
          <ListItem
            icon="newspaper-outline"
            title="Everything"
            onPress={() => { setFilter("all"); setFiltering(false); }}
            right={filter === "all" ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : <View />}
          />
          {POST_TYPES.map((t) => (
            <ListItem
              key={t.type}
              icon={t.icon}
              title={t.label}
              onPress={() => { setFilter(t.type); setFiltering(false); }}
              right={filter === t.type ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : <View />}
            />
          ))}
        </View>
      </Sheet>

      <NoticeBanner notice={notice} onDismiss={clear} />
    </View>
  );
}

function EmptyBlock({ icon, title, body, children }: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={[s.block, s.empty]}>
      <Ionicons name={icon} size={40} color={colors.textTertiary} />
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyBody}>{body}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  block: {
    backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  startRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  startPill: {
    flex: 1, height: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: "#BDBDBD",
    justifyContent: "center", paddingHorizontal: spacing.lg,
  },
  startText: { color: colors.textSecondary, fontSize: font.sm + 1, fontFamily: fontFamily.semibold },
  quickRow: { flexDirection: "row", paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, marginTop: spacing.xs },
  quick: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: radius.sm },
  quickText: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.semibold },
  news: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  newsIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  newsTitle: { color: colors.text, fontSize: font.sm + 1, fontFamily: fontFamily.semibold },
  newsSub: { color: colors.textSecondary, fontSize: 12, fontFamily: fontFamily.regular, marginTop: 1 },
  tabsRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 2, borderColor: "transparent" },
  tabOn: { borderColor: colors.primary },
  tabText: { color: colors.textSecondary, fontSize: font.sm + 1, fontFamily: fontFamily.medium },
  tabTextOn: { color: colors.primary, fontFamily: fontFamily.semibold },
  tabBadge: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  tabBadgeText: { color: colors.primaryText, fontSize: 10, fontFamily: fontFamily.bold },
  filterBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, maxWidth: 170,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, marginRight: spacing.sm,
  },
  filterInner: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  filterBtnOn: { backgroundColor: colors.primarySoft },
  filterText: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.medium, flexShrink: 1 },
  followBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  followText: { flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular },
  followLink: { color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl },
  emptyTitle: { color: colors.text, fontSize: font.lg, fontFamily: fontFamily.semibold, textAlign: "center" },
  emptyBody: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular, textAlign: "center", lineHeight: 19, marginBottom: spacing.xs },
  end: { alignItems: "center", gap: 4, paddingVertical: spacing.xl },
  endText: { color: colors.textTertiary, fontSize: 12, fontFamily: fontFamily.regular },
});
