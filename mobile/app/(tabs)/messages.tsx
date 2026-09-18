import { useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api, fetchMe } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Avatar, Empty, Icon, IconButton, Loading, Segments, TAB_BAR_SPACE } from "../../src/components/ui";
import { Sheet } from "../../src/components/Sheet";
import { inboxTime, personAvatar, personName, useConnections } from "../../src/networkData";
// The header floats over the scene, so this screen leaves its room in the scroll content.
import { useHeaderSpace } from "../../src/components/AppHeader";

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
  const headerSpace = useHeaderSpace();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [composing, setComposing] = useState(false);
  const [who, setWho] = useState("");
  const connections = useConnections(composing);
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
      <View style={s.titleRow}>
        <Text style={s.title}>Messages</Text>
        <IconButton name="create-outline" label="New message" color={colors.text} onPress={() => { setWho(""); setComposing(true); }} />
      </View>
      <View style={s.toolbar}>
        <View style={s.search}>
          <Icon name="search" size={16} color={colors.textTertiary} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search conversations"
            placeholderTextColor={colors.textTertiary}
            style={[s.searchInput, Platform.OS === "web" && ({ outlineWidth: 0, outlineStyle: "none" } as object)]}
            autoCapitalize="none"
            accessibilityLabel="Search conversations"
          />
        </View>
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
        contentContainerStyle={{ paddingTop: headerSpace, paddingBottom: TAB_BAR_SPACE }}
        ListEmptyComponent={
          needle || filter === "unread" ? (
            <Empty icon="chatbubbles-outline" title={needle ? "No conversations found" : "You're all caught up"} />
          ) : (
            <Empty
              icon="chatbubbles-outline"
              title="No messages yet"
              body="Once you're connected with someone, you can message them from their profile or your network."
              action="Message a connection"
              onAction={() => { setWho(""); setComposing(true); }}
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
                  {mine && !unread && (
                    <Icon name={c.lastMessage.read ? "checkmark-done" : "checkmark"} size={15} color={c.lastMessage.read ? colors.primary : colors.textTertiary} />
                  )}
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

      <Sheet
        visible={composing}
        onClose={() => setComposing(false)}
        title="New message"
        subtitle="You can message people you're connected with."
      >
        <View style={s.sheetSearch}>
          <Icon name="search" size={16} color={colors.textTertiary} />
          <TextInput
            value={who}
            onChangeText={setWho}
            placeholder="Type a name"
            placeholderTextColor={colors.textTertiary}
            style={[s.searchInput, Platform.OS === "web" && ({ outlineWidth: 0, outlineStyle: "none" } as object)]}
            autoCapitalize="none"
            accessibilityLabel="Search connections"
          />
        </View>
        {connections.isLoading ? <Loading /> : (() => {
          const needleWho = who.trim().toLowerCase();
          const people = (connections.data ?? [])
            .map((row) => ({ row, name: personName(row.user, row.profile) }))
            .filter(({ name, row }) => !needleWho || name.toLowerCase().includes(needleWho) || (row.profile?.headline ?? "").toLowerCase().includes(needleWho));
          if (!people.length) {
            return (
              <Empty
                icon="people-outline"
                title={needleWho ? "No connection by that name" : "No connections yet"}
                body={needleWho ? undefined : "Connect with builders from the Network tab — once they accept, you can message each other."}
                action={needleWho ? undefined : "Find people"}
                onAction={() => { setComposing(false); router.push("/(tabs)/discover"); }}
              />
            );
          }
          return (
            <View style={{ maxHeight: 360 }}>
              <ScrollView keyboardShouldPersistTaps="handled">
                {people.slice(0, 50).map(({ row, name }) => (
                  <Pressable
                    key={row.id}
                    onPress={() => { setComposing(false); router.push(`/chat/${row.user.id}`); }}
                    style={({ pressed }) => [s.pick, pressed && { backgroundColor: colors.surfaceRaised }]}
                    accessibilityRole="button"
                  >
                    <Avatar name={name} uri={personAvatar(row.user, row.profile)} size={40} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[s.name, { flex: 0 }]} numberOfLines={1}>{name}</Text>
                      {row.profile?.headline ? <Text style={s.headline} numberOfLines={1}>{row.profile.headline}</Text> : null}
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          );
        })()}
      </Sheet>
    </View>
  );
}

const s = StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  title: { color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold },
  toolbar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  sheetSearch: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, paddingHorizontal: spacing.md, height: 40 },
  pick: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm },
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
