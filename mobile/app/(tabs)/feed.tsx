import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api } from "../../src/api/client";
import { DISCOVER_NEW_KEY } from "../../src/explore";
import { colors, font, fontFamily, spacing } from "../../src/theme";
import { ListItem, type IconName } from "../../src/components/ui";
import { NoticeBanner, Sheet, useNotice } from "../../src/components/Sheet";
import { PostCard } from "../../src/components/PostCard";
import { VerifyEmailNotice } from "../../src/components/VerifyEmailNotice";
import { POST_TYPES, type FeedPage, type FeedPost, type PostType } from "../../src/components/feedModel";
import { Box, GlossyButton, primaryTint } from "../../src/components/feed/Box";
import { DiscoverNewsLink, FeedbackUsedCard, MyProjectsCard, ProfileCard } from "../../src/components/feed/HomeRail";
import { ContinuePathCard, NEXT_STEPS_KEY } from "../../src/components/feed/ContinuePathCard";
import { ComposerCard } from "../../src/components/feed/ComposerCard";
import { RAIL_SLOTS, RailModule, type RailModuleKind } from "../../src/components/feed/RailModules";

type Scope = "everyone" | "following";

type Item = { key: string; post: FeedPost } | { key: string; module: RailModuleKind };

/**
 * Home — the website's home page (client/src/pages/home.tsx) on one column.
 *
 * The web lays the feed beside a rail. Here the rail's personal modules come
 * first (your profile, Create Project, what's new, your path, your projects),
 * then the composer and the Everyone / Following bar exactly as the web has
 * them, then posts as the same boxes on the gray page — with the rail's
 * discovery modules (top projects, people to build with, new projects) dropped
 * in between posts rather than stacked on top.
 */
export default function Feed() {
  const router = useRouter();
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();
  // `?feed=following` opens straight to Following, as on the web.
  const { feed: wanted } = useLocalSearchParams<{ feed?: string }>();
  const [scope, setScope] = useState<Scope>(wanted === "following" ? "following" : "everyone");
  useEffect(() => { if (wanted === "following") setScope("following"); }, [wanted]);
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

  // Posts, with the rail's discovery modules between them on the Everyone feed.
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const withModules = scope === "everyone" && filter === "all";
    posts.forEach((post, i) => {
      out.push({ key: post.id, post });
      if (withModules) {
        const slot = RAIL_SLOTS.find((r) => r.after === i);
        if (slot) out.push({ key: `module-${slot.kind}`, module: slot.kind });
      }
    });
    return out;
  }, [posts, scope, filter]);
  const leftoverModules = scope === "everyone" && filter === "all" && posts.length > 0 && !feed.hasNextPage
    ? RAIL_SLOTS.filter((r) => r.after >= posts.length).map((r) => r.kind)
    : [];

  // Shares the tab bar's cache: new posts from people you follow, counted on the server.
  const { data: counts } = useQuery({
    queryKey: ["notification-count"],
    queryFn: () => api<{ count: number; followedPosts?: number }>("/api/notifications/unread-count"),
    refetchInterval: 30_000,
  });
  const newFromFollowing = counts?.followedPosts ?? 0;

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
      qc.invalidateQueries({ queryKey: ["profile-summary"] }),
      qc.invalidateQueries({ queryKey: NEXT_STEPS_KEY }),
      qc.invalidateQueries({ queryKey: ["feedback-used"] }),
    ]);
    setRefreshing(false);
  };

  const filterLabel = filter === "all" ? null : POST_TYPES.find((t) => t.type === filter)?.label;

  const header = (
    <View style={s.stack}>
      <ProfileCard />
      <VerifyEmailNotice onNotice={show} />
      <GlossyButton label="Create Project" icon="add" onPress={() => router.push("/project/new" as any)} testID="button-create-project-home" />
      <DiscoverNewsLink />
      <ContinuePathCard onNotice={show} />
      <FeedbackUsedCard />
      <MyProjectsCard />
      <ComposerCard />

      {/* One line: whose posts on the left, and a small Filter at the end. */}
      <View style={s.filterBar} testID="feed-filter-bar">
        <View style={s.scopes} accessibilityRole="tablist">
          {([["everyone", "Everyone", "people-outline"], ["following", "Following", "heart-outline"]] as const).map(([value, label, icon]) => {
            const on = scope === value;
            return (
              <Pressable
                key={value}
                onPress={() => setScope(value)}
                style={[s.scope, on && s.scopeOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                testID={`feed-scope-${value}`}
              >
                <Ionicons name={icon} size={13} color={on ? colors.primaryText : colors.textSecondary} />
                <Text style={[s.scopeText, on && s.scopeTextOn]}>{label}</Text>
                {value === "following" && newFromFollowing > 0 && !on && (
                  <View style={s.badge} testID="following-new-count">
                    <Text style={s.badgeText}>{newFromFollowing > 99 ? "99+" : newFromFollowing}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
        <View style={s.filler} />
        {filterLabel && (
          <Pressable onPress={() => setFilter("all")} style={s.clear} hitSlop={6} testID="filter-clear">
            <Text style={s.clearText} numberOfLines={1}>{filterLabel}</Text>
            <Ionicons name="close" size={12} color={colors.primary} />
          </Pressable>
        )}
        <Pressable onPress={() => setFiltering(true)} style={s.filterBtn} hitSlop={6} testID="button-feed-filter">
          <Ionicons name="options-outline" size={13} color={colors.textTertiary} />
          <Text style={s.filterText}>Filter</Text>
          <Ionicons name="chevron-down" size={12} color={colors.textTertiary} />
        </Pressable>
      </View>

      {/* The way back into the loop: progress from people you follow, since you last looked. */}
      {scope === "everyone" && newFromFollowing > 0 && (
        <Pressable
          onPress={() => setScope("following")}
          style={({ pressed }) => [s.tinted, pressed && { backgroundColor: primaryTint(0.1) }]}
          testID="button-new-from-following"
        >
          <Ionicons name="heart-outline" size={15} color={colors.primary} />
          <Text style={s.tintedText}>
            <Text style={{ fontFamily: fontFamily.semibold }}>{newFromFollowing} new update{newFromFollowing === 1 ? "" : "s"}</Text> from people and projects you follow since you last looked
          </Text>
          <Text style={s.tintedLink}>See them</Text>
        </Pressable>
      )}
    </View>
  );

  const empty = feed.isLoading ? (
    <View style={{ gap: spacing.sm }}>
      {[0, 1, 2].map((i) => <View key={i} style={s.skeleton} />)}
    </View>
  ) : feed.isError ? (
    <EmptyBox icon="cloud-offline-outline" title="Couldn't load the feed" body="Pull down to try again." />
  ) : scope === "following" ? (
    followingCount ? (
      <EmptyBox icon="heart-outline" title="Nothing new from who you follow yet" body={`You follow ${followingCount} ${followingCount === 1 ? "builder or project" : "builders and projects"}. Their next update lands here.`} testID="following-empty" />
    ) : (
      <EmptyBox icon="heart-outline" title="Follow builders to see updates" body="Follow people and projects, and what they post shows up here — nothing else." testID="following-empty">
        <Pressable onPress={() => router.push("/(tabs)/discover")} style={s.emptyBtn} testID="button-find-builders">
          <Text style={s.emptyBtnText}>Find builders to follow</Text>
        </Pressable>
      </EmptyBox>
    )
  ) : (
    <EmptyBox
      icon="newspaper-outline"
      title={filterLabel ? `No ${filterLabel} posts yet` : "Nothing here yet"}
      body={filterLabel
        ? "Try a different filter, or write the first one."
        : "Be the first to share what you're building. Create a project or hit a milestone and it'll show up here automatically."}
    />
  );

  return (
    <View style={s.container}>
      <FlatList
        data={items}
        keyExtractor={(it) => it.key}
        renderItem={({ item }) => ("post" in item ? <PostCard post={item.post} onNotice={show} /> : <RailModule kind={item.module} />)}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          posts.length === 0 ? null : feed.isFetchingNextPage ? (
            <View style={{ paddingVertical: spacing.lg }}><ActivityIndicator color={colors.primary} /></View>
          ) : !feed.hasNextPage ? (
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              {leftoverModules.map((kind) => <RailModule key={kind} kind={kind} />)}
              <View style={s.end}>
                <Ionicons name="checkmark-circle-outline" size={18} color={colors.textTertiary} />
                <Text style={s.endText}>You're all caught up</Text>
                <Text style={s.endText}>SparkTower · built for people who ship</Text>
              </View>
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

function EmptyBox({ icon, title, body, children, testID }: {
  icon: IconName;
  title: string;
  body: string;
  children?: React.ReactNode;
  testID?: string;
}) {
  return (
    <Box style={s.empty} testID={testID}>
      <Ionicons name={icon} size={40} color="rgba(135,135,135,0.35)" />
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyBody}>{body}</Text>
      {children}
    </Box>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  stack: { gap: spacing.sm, marginBottom: spacing.sm },
  filterBar: { flexDirection: "row", alignItems: "center", gap: 4, marginHorizontal: spacing.sm, paddingVertical: 2 },
  scopes: { flexDirection: "row", gap: 2 },
  scope: { flexDirection: "row", alignItems: "center", gap: 5, height: 30, paddingHorizontal: 10, borderRadius: 6 },
  scopeOn: { backgroundColor: "#000000" },
  scopeText: { color: colors.textSecondary, fontSize: 12, fontFamily: fontFamily.medium },
  scopeTextOn: { color: colors.primaryText },
  badge: { minWidth: 18, height: 16, borderRadius: 8, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: 5, marginLeft: 1 },
  badgeText: { color: colors.primaryText, fontSize: 10, fontFamily: fontFamily.semibold },
  filler: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: "rgba(0,0,0,0.15)", marginHorizontal: spacing.sm },
  clear: { flexDirection: "row", alignItems: "center", gap: 2, maxWidth: 130 },
  clearText: { color: colors.primary, fontSize: 11, fontFamily: fontFamily.regular, flexShrink: 1 },
  filterBtn: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 4 },
  filterText: { color: colors.textTertiary, fontSize: 11, fontFamily: fontFamily.regular },
  tinted: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.sm,
    borderRadius: 8, borderWidth: 1, borderColor: primaryTint(0.4), backgroundColor: primaryTint(0.05),
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  tintedText: { flex: 1, color: colors.text, fontSize: font.sm, lineHeight: 18, fontFamily: fontFamily.regular },
  tintedLink: { color: colors.primary, fontSize: 12, fontFamily: fontFamily.regular },
  skeleton: { height: 192, marginHorizontal: spacing.sm, borderRadius: 8, backgroundColor: "#E9E8E5" },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: 48, paddingHorizontal: spacing.xl },
  emptyTitle: { color: colors.text, fontSize: font.base, fontFamily: fontFamily.medium, textAlign: "center" },
  emptyBody: { color: colors.textTertiary, fontSize: font.sm, fontFamily: fontFamily.regular, textAlign: "center", lineHeight: 19, maxWidth: 320 },
  emptyBtn: { marginTop: spacing.sm, height: 34, paddingHorizontal: spacing.md, borderRadius: 6, backgroundColor: colors.primary, justifyContent: "center" },
  emptyBtnText: { color: colors.primaryText, fontSize: font.sm, fontFamily: fontFamily.medium },
  end: { alignItems: "center", gap: 4, paddingVertical: spacing.xl },
  endText: { color: colors.textTertiary, fontSize: 11, fontFamily: fontFamily.regular },
});
