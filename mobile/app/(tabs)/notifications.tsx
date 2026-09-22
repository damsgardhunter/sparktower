import * as WebBrowser from "expo-web-browser";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Avatar, Btn, Empty, Icon, Loading, Segments, timeAgo, type IconName } from "../../src/components/ui";
import { useConnectionStates } from "../../src/components/ConnectActions";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import { appHref, isWebHref, openWebSignedIn, notificationSection, useConnectionRequests, useInvitationActions } from "../../src/networkData";
import { useHideTabBarOnScroll } from "../../src/components/tab-bar-visibility";
import { useHeaderSpace } from "../../src/components/AppHeader";
import { TAB_BAR_SPACE } from "./_layout";

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

type Filter = "all" | "unread" | "posts" | "network" | "projects";

type Line =
  | { type: "section"; key: string; label: string }
  | { type: "item"; key: string; n: NotificationItem };

const POSTS = new Set(["followed_post", "comment", "reply", "post_reaction", "comment_reaction", "mention", "feedback_used"]);
const NETWORK = new Set(["follow", "connection_request", "connection_accepted", "company_added", "company_powers", "recruit_invite", "recruit_answer"]);
/*
 * The work you're doing: your projects, the companies you help run, their
 * challenges, and the simulation. The company and sim kinds were in no filter
 * at all, so they showed only under All and Unread — a due job or a nudge from
 * your table hidden from the Projects view it belongs in.
 */
const PROJECTS = new Set([
  "project_follow", "path_step_done", "next_step", "weekly_update", "artifact_signup", "invite_accepted",
  "job_due", "checkin_due", "scout_update", "scout_new_project", "challenge_entry", "challenge_result",
  "sim_nudge", "season_invite", "sprint_left",
  "project_application", "application_accepted", "application_rejected", "project_removed",
  "pledge_received", "campaign_decision", "pledge_refunding", "pledge_released", "pledge_refunded",
]);

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
  weekly_update: { icon: "calendar", color: "#2563EB" },
  artifact_signup: { icon: "sparkles", color: "#7C3AED" },
  feedback_used: { icon: "bulb", color: "#CA8A04" },
  invite_accepted: { icon: "person-add", color: "#16A34A" },
  sprint_left: { icon: "exit", color: colors.textSecondary },
  sim_nudge: { icon: "alarm", color: "#D97706" },
  season_invite: { icon: "game-controller", color: "#7C3AED" },
  recruit_invite: { icon: "briefcase", color: "#2563EB" },
  recruit_answer: { icon: "briefcase", color: "#16A34A" },
  challenge_entry: { icon: "trophy", color: "#CA8A04" },
  challenge_result: { icon: "trophy", color: "#16A34A" },
  scout_update: { icon: "telescope", color: "#0891B2" },
  scout_new_project: { icon: "telescope", color: "#0891B2" },
  company_added: { icon: "business", color: colors.primary },
  company_powers: { icon: "key", color: colors.primary },
  job_due: { icon: "repeat", color: "#D97706" },
  checkin_due: { icon: "clipboard", color: "#2563EB" },
  project_application: { icon: "hand-left", color: "#2563EB" },
  application_accepted: { icon: "checkmark-circle", color: "#16A34A" },
  application_rejected: { icon: "close-circle", color: colors.textSecondary },
  project_removed: { icon: "remove-circle", color: colors.textSecondary },
  pledge_received: { icon: "cash", color: "#16A34A" },
  campaign_decision: { icon: "shield-checkmark", color: "#2563EB" },
  pledge_refunding: { icon: "card", color: "#D97706" },
  pledge_released: { icon: "cash", color: "#16A34A" },
  pledge_refunded: { icon: "card", color: colors.textSecondary },
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
    // The list itself too — the tab stays mounted, so without this the badge said 3 new over yesterday's list.
    void qc.invalidateQueries({ queryKey: ["notifications"] });
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
    filter === "all" ? true
      : filter === "unread" ? !n.read
      : filter === "posts" ? POSTS.has(n.kind)
      : filter === "network" ? NETWORK.has(n.kind)
      : PROJECTS.has(n.kind));

  // The bell's own count, from the server — not just what's loaded so far.
  const counts = useQuery({
    queryKey: ["notification-count"],
    queryFn: () => api<{ count: number }>("/api/notifications/unread-count"),
  });
  const loadedUnread = all.filter((n) => !n.read).length;
  const unread = Math.max(counts.data?.count ?? 0, loadedUnread);

  // Requests you can still answer, right in the list.
  const requesters = all.filter((n) => n.kind === "connection_request").map((n) => n.actor.id);
  const { data: states } = useConnectionStates(requesters);
  const pendingInvites = useConnectionRequests().data?.length ?? 0;

  // Today, this week, earlier — so a long list reads in pieces.
  const lines = useMemo(() => {
    const out: Line[] = [];
    let last = "";
    for (const n of items) {
      const label = notificationSection(n.createdAt);
      if (label !== last) {
        out.push({ type: "section", key: `section:${label}`, label });
        last = label;
      }
      out.push({ type: "item", key: n.id, n });
    }
    return out;
  }, [items]);

  const open = (n: NotificationItem) => {
    if (!n.read) read.mutate({ ids: [n.id] });
    const to = appHref(n.href, n.actor.id);
    if (isWebHref(to)) void openWebSignedIn(to, (url) => WebBrowser.openBrowserAsync(url)).catch(() => {});
    else router.push(to as any);
  };

  const header = (
    <View style={s.toolbar}>
      <View style={s.titleRow}>
        <Text style={s.title}>Notifications</Text>
        {unread > 0 && (
          <Pressable onPress={() => read.mutate({ all: true })} disabled={read.isPending} hitSlop={8} accessibilityRole="button">
            <Text style={s.markAll}>Mark all read</Text>
          </Pressable>
        )}
      </View>
      <Segments
        options={[
          { value: "all" as Filter, label: "All" },
          { value: "unread" as Filter, label: unread ? `Unread (${unread > 99 ? "99+" : unread})` : "Unread" },
          { value: "posts" as Filter, label: "Posts" },
          { value: "network" as Filter, label: "Network" },
          { value: "projects" as Filter, label: "Projects" },
        ]}
        value={filter}
        onChange={setFilter}
      />
    </View>
  );

  /*
   * Hooks above the early return, always. With the loading return first, the
   * first render (loading) called two fewer hooks than the next, and React
   * threw "Rendered more hooks than during the previous render" — the tab
   * crashed on its very first open.
   */
  const hideTabBar = useHideTabBarOnScroll();
  // The header floats now, so the list leaves its room rather than sitting under it.
  const headerSpace = useHeaderSpace();

  if (query.isLoading) return <Loading />;

  return (
    <>
      <FlatList
        {...hideTabBar}
        contentContainerStyle={{ paddingTop: headerSpace, paddingBottom: TAB_BAR_SPACE }}
        style={{ flex: 1, backgroundColor: colors.canvas }}
        data={lines}
        keyExtractor={(l) => l.key}
        ListHeaderComponent={
          <>
            {header}
            {pendingInvites > 0 && filter !== "posts" && filter !== "projects" && (
              <Pressable
                onPress={() => router.push("/network/invitations")}
                style={({ pressed }) => [s.invites, pressed && { backgroundColor: colors.surfaceRaised }]}
                accessibilityRole="button"
              >
                <View style={s.invitesIcon}><Icon name="people" size={18} color={colors.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.invitesTitle}>Invitations</Text>
                  <Text style={s.excerptPlain}>{pendingInvites} {pendingInvites === 1 ? "person wants" : "people want"} to connect</Text>
                </View>
                <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
              </Pressable>
            )}
          </>
        }
        stickyHeaderIndices={[0]}
        refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => { void query.refetch(); void counts.refetch(); }} tintColor={colors.primary} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage(); }}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ padding: spacing.lg }} /> : <View style={{ height: spacing.xxl * 2 }} />}
        ListEmptyComponent={
          <View style={{ backgroundColor: colors.surface, marginTop: spacing.sm }}>
            {filter === "unread" ? (
              <Empty icon="checkmark-done-outline" title="You're all caught up" body="Nothing unread. New replies, reactions, follows and connections show up here." />
            ) : (
              <Empty
                icon="notifications-outline"
                title={filter === "all" ? "Nothing yet" : "Nothing here yet"}
                body="Follow builders and projects, and their progress shows up here — along with replies and reactions to what you post."
                action={filter === "all" ? "Find people to follow" : undefined}
                onAction={() => router.push("/(tabs)/discover")}
              />
            )}
          </View>
        }
        renderItem={({ item: line, index }) => {
          if (line.type === "section") {
            return <Text style={[s.section, index === 0 && { marginTop: spacing.sm }]}>{line.label}</Text>;
          }
          const n = line.n;
          const kind = KIND_ICON[n.kind] ?? { icon: "notifications" as IconName, color: colors.primary };
          const bold = n.text.startsWith(n.actor.name) ? n.actor.name : "";
          const request = n.kind === "connection_request" ? states?.[n.actor.id] : undefined;
          const canAnswer = request?.state === "incoming" && !!request.connectionId;
          const answered = n.kind === "connection_request" && (request?.state === "connected");
          const nextIsItem = lines[index + 1]?.type === "item";
          return (
            <Pressable
              onPress={() => open(n)}
              style={({ pressed }) => [s.row, !n.read && s.rowUnread, nextIsItem && s.rowDivider, pressed && { backgroundColor: colors.surfaceRaised }]}
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
                {answered && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                    <Icon name="checkmark-circle" size={14} color={colors.success} />
                    <Text style={s.excerptPlain}>Connected</Text>
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
  toolbar: { backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderColor: colors.border },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold },
  markAll: { color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold },
  invites: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surface, marginTop: spacing.sm },
  invitesIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  invitesTitle: { color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold },
  section: { color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.semibold, textTransform: "uppercase", letterSpacing: 0.5, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingVertical: spacing.md, paddingRight: spacing.lg, backgroundColor: colors.surface },
  rowDivider: { borderBottomWidth: 1, borderColor: colors.borderSubtle },
  rowUnread: { backgroundColor: "#F8F1FB" },
  unreadDotCol: { width: 12, alignItems: "flex-end", paddingTop: 22 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  kind: { position: "absolute", right: -2, bottom: -2, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.surface },
  text: { color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular },
  actor: { fontFamily: fontFamily.semibold },
  excerpt: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18, fontFamily: fontFamily.regular, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, overflow: "hidden" },
  excerptPlain: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular },
  time: { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular, marginTop: 2 },
});
