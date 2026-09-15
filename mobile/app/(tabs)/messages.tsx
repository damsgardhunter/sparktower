import { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api, fetchMe } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Avatar, Empty, Icon, IconButton, Loading, Segments } from "../../src/components/ui";
import { inboxTime, personAvatar, personName } from "../../src/networkData";

interface Conversation {
  userId: string;
  user: { id: string; firstName?: string | null; lastName?: string | null; email?: string | null; profileImageUrl?: string | null };
  profile?: { displayName?: string | null; headline?: string | null; avatarUrl?: string | null } | null;
  lastMessage: { id: string; senderId: string; content: string; createdAt: string; read: boolean };
  unreadCount: number;
}

type Filter = "all" | "unread";

/**
 * Messaging: one row per person, newest first — who, the last thing said,
 * when, and whether you've read it. Search narrows by name; the pencil starts
 * a conversation with someone you're connected to.
 */
export default function Messages() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api<Conversation[]>("/api/messages/conversations"),
    // Chat lists go stale fast; poll while the screen is open.
    refetchInterval: 10_000,
  });

  if (isLoading) return <Loading />;

  const needle = q.trim().toLowerCase();
  const all = data ?? [];
  const rows = all
    .filter((c) => filter === "all" || c.unreadCount > 0)
    .filter((c) => !needle || personName(c.user, c.profile).toLowerCase().includes(needle));
  const unreadTotal = all.filter((c) => c.unreadCount > 0).length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={s.toolbar}>
        <View style={s.search}>
          <Icon name="search" size={16} color={colors.textTertiary} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search messages"
            placeholderTextColor={colors.textTertiary}
            style={s.searchInput}
            autoCapitalize="none"
            accessibilityLabel="Search conversations"
          />
        </View>
        <IconButton name="create-outline" label="New message" color={colors.text} onPress={() => router.push("/network/connections")} />
      </View>
      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderColor: colors.border }}>
        <Segments
          options={[{ value: "all" as Filter, label: "All" }, { value: "unread" as Filter, label: unreadTotal ? `Unread (${unreadTotal})` : "Unread" }]}
          value={filter}
          onChange={setFilter}
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(c) => c.userId}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
        ItemSeparatorComponent={() => <View style={s.sep} />}
        contentContainerStyle={{ paddingBottom: spacing.xxl * 2 }}
        ListEmptyComponent={
          needle || filter === "unread" ? (
            <Empty icon="chatbubbles-outline" title={needle ? "No conversations found" : "You're all caught up"} />
          ) : (
            <Empty
              icon="chatbubbles-outline"
              title="No messages yet"
              body="Once you're connected with someone, you can message them from their profile or your network."
              action="Message a connection"
              onAction={() => router.push("/network/connections")}
            />
          )
        }
        renderItem={({ item: c }) => {
          const name = personName(c.user, c.profile, "Someone");
          const unread = c.unreadCount > 0;
          const mine = c.lastMessage.senderId === me?.user?.id;
          return (
            <Pressable
              onPress={() => router.push(`/chat/${c.userId}`)}
              style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surfaceRaised }]}
              accessibilityRole="button"
              accessibilityLabel={`${name}${unread ? `, ${c.unreadCount} unread` : ""}`}
            >
              <Avatar name={name} uri={personAvatar(c.user, c.profile)} size={52} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <Text style={[s.name, unread && { fontFamily: fontFamily.bold }]} numberOfLines={1}>{name}</Text>
                  <Text style={[s.time, unread && { color: colors.primary, fontFamily: fontFamily.semibold }]}>{inboxTime(c.lastMessage.createdAt)}</Text>
                </View>
                {c.profile?.headline ? <Text style={s.headline} numberOfLines={1}>{c.profile.headline}</Text> : null}
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <Text style={[s.preview, unread && { color: colors.text, fontFamily: fontFamily.semibold }]} numberOfLines={1}>
                    {mine ? "You: " : ""}{c.lastMessage.content}
                  </Text>
                  {unread && (
                    <View style={s.count}>
                      <Text style={s.countText}>{c.unreadCount > 9 ? "9+" : c.unreadCount}</Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  toolbar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  search: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, paddingHorizontal: spacing.md, height: 38 },
  searchInput: { flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular, paddingVertical: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  sep: { height: 1, backgroundColor: colors.borderSubtle, marginLeft: spacing.lg + 52 + spacing.md },
  name: { flex: 1, color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold },
  headline: { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular },
  time: { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular },
  preview: { flex: 1, color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular },
  count: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  countText: { color: colors.primaryText, fontSize: 11, fontFamily: fontFamily.bold },
});
