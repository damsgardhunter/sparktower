import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Avatar, Btn, Empty, Icon, Loading, Segments, timeAgo, type IconName } from "../../src/components/ui";
import { useConnectionStates } from "../../src/components/ConnectActions";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import { appHref, useInvitationActions } from "../../src/networkData";

interface NotificationItem {
  id: string;
  kind: string;
  createdAt: string;
  read: boolean;
  actor: { id: string; name: string; avatarUrl: string | null };
  project: { id: string; title: string | null } | null;
  excerpt: string | null;
  text: string;
  /** Where the web opens it; appHref() turns it into a screen here. */
  href?: string;
}

type Filter = "all" | "posts" | "network" | "projects";

const POSTS = new Set(["followed_post", "comment", "reply", "post_reaction", "comment_reaction", "mention", "feedback_used"]);
const NETWORK = new Set(["follow", "connection_request", "connection_accepted"]);
const PROJECTS = new Set(["project_follow", "path_step_done", "next_step"]);

/** The small icon on the avatar's corner: what kind of thing happened. */
const KIND_ICON: Record<string, { icon: IconName; color: string }> = {
  followed_post: { icon: "document-text", color: "#2563EB" },
  comment: { icon: "chatbubble", color: "#0891B2" },
  reply: { icon: "chatbubbles", color: "#0891B2" },
  post_reaction: { icon: "heart", color: "#E11D48" },
  comment_reaction: { icon: "heart", color: "#E11D48" },
  mention: { icon: "at", color: "#7C3AED" },
  follow: { icon: "person-add", color: colors.primary },
  project_follow: { icon: "rocket", color: colors.primary },
  connection_request: { icon: "people", color: colors.primary },
  connection_accepted: { icon: "checkmark-circle", color: "#16A34A" },
  path_step_done: { icon: "flag", color: "#16A34A" },
  next_step: { icon: "arrow-forward-circle", color: "#D97706" },
  feedback_used: { icon: "bulb", color: "#CA8A04" },
};

/**
 * Notifications, LinkedIn-style: who did what, newest first, unread tinted.
 * The same list as the web bell — it's recorded on the server — and tapping
 * one marks it read and opens it: a post opens the post, a request your
 * invitations, a follow the person.
 */
export default function Notifications() {
  const router = useRouter();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const { notice, show, clear } = useNotice();
  const invites = useInvitationActions(show);

  const query = useInfiniteQuery({
    queryKey: ["notifications"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<{ items: NotificationItem[]; nextCursor: string | null }>(`/api/notifications${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  // Back on the tab: the list re-reads, so what arrived meanwhile is there.
  useFocusEffect(useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["notification-count"] });
  }, [qc]));

  const read = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) => api("/api/notifications/read", { method: "POST", body }),
    onMutate: async (body) => {
      // Read at once: the tint goes as soon as the tap lands.
      await qc.cancelQueries({ queryKey: ["notifications"] });
      qc.setQueryData(["notifications"], (data: any) => data && {
        ...data,
        pages: data.pages.map((page: any) => ({
          ...page,
          items: page.items.map((n: NotificationItem) => (body.all || body.ids?.includes(n.id) ? { ...n, read: true } : n)),
        })),
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: ["notification-count"] });
    },
  });

  const all = (query.data?.pages ?? []).flatMap((p) => p.items);
  const items = all.filter((n) =>
    filter === "all" ? true : filter === "posts" ? POSTS.has(n.kind) : filter === "network" ? NETWORK.has(n.kind) : PROJECTS.has(n.kind));
  const unread = all.filter((n) => !n.read).length;

  // Requests you can still answer, right in the list.
  const requesters = all.filter((n) => n.kind === "connection_request").map((n) => n.actor.id);
  const { data: states } = useConnectionStates(requesters);

  const open = (n: NotificationItem) => {
    if (!n.read) read.mutate({ ids: [n.id] });
    router.push(appHref(n.href, n.actor.id) as any);
  };

  const header = (
    <View style={s.toolbar}>
      <View style={{ flex: 1 }}>
        <Segments
          options={[
            { value: "all" as Filter, label: "All" },
            { value: "posts" as Filter, label: "Posts" },
            { value: "network" as Filter, label: "Network" },
            { value: "projects" as Filter, label: "Projects" },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </View>
    </View>
  );

  if (query.isLoading) return <Loading />;

  return (
    <>
      <FlatList
        style={{ flex: 1, backgroundColor: colors.canvas }}
        data={items}
        keyExtractor={(n) => n.id}
        ListHeaderComponent={
          <>
            {header}
            {unread > 0 && (
              <View style={s.unreadBar}>
                <Text style={s.unreadText}>{unread} unread</Text>
                <Pressable onPress={() => read.mutate({ all: true })} hitSlop={8} accessibilityRole="button">
                  <Text style={s.markAll}>Mark all as read</Text>
                </Pressable>
              </View>
            )}
          </>
        }
        stickyHeaderIndices={[0]}
        refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => query.refetch()} tintColor={colors.primary} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage(); }}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ padding: spacing.lg }} /> : <View style={{ height: spacing.xxl * 2 }} />}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.borderSubtle }} />}
        ListEmptyComponent={
          <View style={{ backgroundColor: colors.surface, marginTop: spacing.sm }}>
            <Empty
              icon="notifications-outline"
              title={filter === "all" ? "Nothing yet" : "Nothing here yet"}
              body="Follow builders and projects, and their progress shows up here — along with replies and reactions to what you post."
            />
          </View>
        }
        renderItem={({ item: n }) => {
          const kind = KIND_ICON[n.kind] ?? { icon: "notifications" as IconName, color: colors.primary };
          const bold = n.text.startsWith(n.actor.name) ? n.actor.name : "";
          const request = n.kind === "connection_request" ? states?.[n.actor.id] : undefined;
          const canAnswer = request?.state === "incoming" && !!request.connectionId;
          return (
            <Pressable
              onPress={() => open(n)}
              style={({ pressed }) => [s.row, !n.read && s.rowUnread, pressed && { backgroundColor: colors.surfaceRaised }]}
              accessibilityRole="button"
              accessibilityLabel={`${n.read ? "" : "Unread. "}${n.text}`}
            >
              <View style={s.unreadDotCol}>{!n.read && <View style={s.unreadDot} />}</View>
              <View>
                <Avatar name={n.actor.name} uri={n.actor.avatarUrl} size={52} />
                <View style={[s.kind, { backgroundColor: kind.color }]}>
                  <Icon name={kind.icon} size={11} color="#FFFFFF" />
                </View>
              </View>
              <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
                <Text style={s.text} numberOfLines={3}>
                  {bold ? <Text style={s.actor}>{bold}</Text> : null}
                  {n.text.slice(bold.length)}
                </Text>
                {n.excerpt ? <Text style={s.excerpt} numberOfLines={2}>“{n.excerpt}”</Text> : null}
                {canAnswer && (
                  <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: 4 }}>
                    <Btn label="Ignore" small variant="ghost" disabled={invites.busyId === request!.connectionId} onPress={() => { invites.ignore({ id: request!.connectionId!, name: n.actor.name }); if (!n.read) read.mutate({ ids: [n.id] }); }} />
                    <Btn label="Accept" small variant="outline" loading={invites.busyId === request!.connectionId} onPress={() => { invites.accept({ id: request!.connectionId!, name: n.actor.name }); if (!n.read) read.mutate({ ids: [n.id] }); }} />
                  </View>
                )}
              </View>
              <Text style={s.time}>{timeAgo(n.createdAt)}</Text>
            </Pressable>
          );
        }}
      />
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}

const s = StyleSheet.create({
  toolbar: { backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderColor: colors.border },
  unreadBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: 10, backgroundColor: colors.surface, marginTop: spacing.sm, borderBottomWidth: 1, borderColor: colors.borderSubtle },
  unreadText: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.medium },
  markAll: { color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingVertical: spacing.md, paddingRight: spacing.lg, backgroundColor: colors.surface },
  rowUnread: { backgroundColor: "#F8F1FB" },
  unreadDotCol: { width: 12, alignItems: "flex-end", paddingTop: 22 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  kind: { position: "absolute", right: -2, bottom: -2, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.surface },
  text: { color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular },
  actor: { fontFamily: fontFamily.semibold },
  excerpt: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18, fontFamily: fontFamily.regular, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, overflow: "hidden" },
  time: { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular, marginTop: 2 },
});
