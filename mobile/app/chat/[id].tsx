import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../src/api/client";
import { exploreContext } from "../../src/explore";
import { useAuth } from "../../src/auth/AuthContext";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Avatar, Icon, Loading } from "../../src/components/ui";
import { ConnectActions, useConnectionStates } from "../../src/components/ConnectActions";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import { messageTemplates } from "../../src/messageTemplates";
import { clockTime, dayLabel, personAvatar, personName } from "../../src/networkData";

interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  read: boolean;
  createdAt: string;
  /** Sent from this phone, not yet confirmed by the server. */
  pending?: boolean;
}

type Line =
  | { type: "day"; key: string; label: string }
  | { type: "msg"; key: string; msg: Message; mine: boolean; groupStart: boolean; groupEnd: boolean };

/** Messages closer together than this, from the same person, read as one run. */
const GROUP_MS = 5 * 60 * 1000;

/**
 * A conversation: bubbles grouped by who said them, a line for each day,
 * sent / read ticks on yours, and a composer that sends at once and keeps the
 * text if the server refuses. Only connected people can message, so a thread
 * with someone you aren't connected to says so — and offers Connect.
 */
export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const listRef = useRef<FlatList<Line>>(null);
  const { notice, show, clear } = useNotice();
  const meId: string | undefined = user?.id;

  const other = useQuery({
    queryKey: ["user", id],
    queryFn: () => api<any>(`/api/users/${id}`),
    enabled: !!id,
  });
  const name = personName(other.data, other.data?.profile, "Conversation");
  const headline: string | undefined = other.data?.profile?.headline ?? undefined;

  const messagesKey = ["messages", id];
  const messages = useQuery({
    queryKey: messagesKey,
    queryFn: () => api<Message[]>(`/api/messages/${id}`),
    enabled: !!id,
    refetchInterval: (query) => (query.state.error ? false : 4_000),
    retry: (count, error: any) => error?.status !== 403 && count < 1,
  });
  const notConnected = (messages.error as any)?.status === 403;
  const { data: states } = useConnectionStates(notConnected && id ? [id] : []);

  const sorted = useMemo(
    () => [...(messages.data ?? [])].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    [messages.data],
  );

  // Clear the unread badge once there's something unread from them on screen.
  const hasUnread = sorted.some((m) => m.receiverId === meId && !m.read);
  useEffect(() => {
    if (!id || !hasUnread) return;
    api(`/api/messages/${id}/read`, { method: "POST" })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["conversations"] });
        void qc.invalidateQueries({ queryKey: ["unread-count"] });
      })
      .catch(() => {});
  }, [id, hasUnread, qc]);

  const lines = useMemo(() => {
    const out: Line[] = [];
    let lastDay = "";
    sorted.forEach((msg, i) => {
      const day = new Date(msg.createdAt).toDateString();
      if (day !== lastDay) {
        out.push({ type: "day", key: `day:${day}`, label: dayLabel(msg.createdAt) });
        lastDay = day;
      }
      const prev = sorted[i - 1];
      const next = sorted[i + 1];
      const near = (a?: Message, b?: Message) => !!a && !!b && a.senderId === b.senderId
        && Math.abs(Date.parse(a.createdAt) - Date.parse(b.createdAt)) < GROUP_MS
        && new Date(a.createdAt).toDateString() === new Date(b.createdAt).toDateString();
      out.push({ type: "msg", key: msg.id, msg, mine: msg.senderId === meId, groupStart: !near(prev, msg), groupEnd: !near(msg, next) });
    });
    return out;
  }, [sorted, meId]);

  const send = useMutation({
    mutationFn: (content: string) => api<Message>(`/api/messages/${id}`, { method: "POST", body: { content, explore: exploreContext("messages") } }),
    onMutate: async (content) => {
      setText("");
      await qc.cancelQueries({ queryKey: messagesKey });
      const before = qc.getQueryData<Message[]>(messagesKey);
      const temp: Message = { id: `pending-${Date.now()}`, senderId: meId ?? "", receiverId: id ?? "", content, read: false, createdAt: new Date().toISOString(), pending: true };
      qc.setQueryData<Message[]>(messagesKey, (rows = []) => [...rows, temp]);
      return { before, content };
    },
    onError: (error: any, _content, context) => {
      qc.setQueryData(messagesKey, context?.before);
      setText((current) => current || context?.content || "");
      show({ text: error?.message || "Message not sent.", tone: "error" });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: messagesKey });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const submit = () => {
    const content = text.trim();
    if (!content || send.isPending) return;
    send.mutate(content);
  };

  const templates = messageTemplates({ name, headline });

  const title = (
    <Pressable onPress={() => router.push(`/user/${id}`)} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, maxWidth: 260 }} accessibilityRole="button" accessibilityLabel={`Open ${name}'s profile`}>
      <Avatar name={name} uri={personAvatar(other.data, other.data?.profile)} size={32} />
      <View style={{ flexShrink: 1 }}>
        <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }} numberOfLines={1}>{name}</Text>
        {headline ? <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }} numberOfLines={1}>{headline}</Text> : null}
      </View>
    </Pressable>
  );

  if (messages.isLoading) return <><Stack.Screen options={{ title: "" }} /><Loading /></>;

  return (
    <>
      <Stack.Screen options={{ headerTitle: () => title, headerTitleAlign: "left" }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        {notConnected ? (
          <ScrollView contentContainerStyle={s.gate}>
            <Avatar name={name} uri={personAvatar(other.data, other.data?.profile)} size={88} />
            <Text style={s.gateName}>{name}</Text>
            {headline ? <Text style={s.gateHeadline}>{headline}</Text> : null}
            <Text style={s.gateBody}>You can message {name.split(" ")[0]} once you're connected. Send a request with a note — it's the one thing you can say before they accept.</Text>
            {id ? <ConnectActions userId={id} name={name} headline={headline} connection={states?.[id]} notify={show} explore={{ source: "messages" }} /> : null}
          </ScrollView>
        ) : (
          <FlatList
            ref={listRef}
            data={lines}
            keyExtractor={(l) => l.key}
            contentContainerStyle={{ paddingHorizontal: spacing.md, paddingVertical: spacing.md, flexGrow: 1 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <View style={s.intro}>
                <Avatar name={name} uri={personAvatar(other.data, other.data?.profile)} size={64} />
                <Text style={s.gateName}>{name}</Text>
                {headline ? <Text style={s.gateHeadline} numberOfLines={2}>{headline}</Text> : null}
                <Pressable onPress={() => router.push(`/user/${id}`)} hitSlop={6}>
                  <Text style={s.link}>View profile</Text>
                </Pressable>
              </View>
            }
            ListEmptyComponent={
              <View style={{ alignItems: "center", gap: spacing.sm, paddingTop: spacing.lg }}>
                <Text style={s.gateHeadline}>No messages yet. Start with a hello:</Text>
                {templates.map((t) => (
                  <Pressable key={t.id} onPress={() => setText(t.body)} style={({ pressed }) => [s.template, pressed && { backgroundColor: colors.primarySoft }]}>
                    <Text style={s.templateLabel}>{t.label}</Text>
                    <Text style={s.templateBody} numberOfLines={3}>{t.body}</Text>
                  </Pressable>
                ))}
              </View>
            }
            renderItem={({ item }) => {
              if (item.type === "day") {
                return (
                  <View style={s.dayRow}>
                    <View style={s.dayLine} />
                    <Text style={s.day}>{item.label}</Text>
                    <View style={s.dayLine} />
                  </View>
                );
              }
              const { msg, mine, groupStart, groupEnd } = item;
              return (
                <View style={[s.lineRow, mine && { justifyContent: "flex-end" }, { marginTop: groupStart ? spacing.sm : 2 }]}>
                  {!mine && (
                    <View style={{ width: 28 }}>
                      {groupEnd && <Avatar name={name} uri={personAvatar(other.data, other.data?.profile)} size={28} />}
                    </View>
                  )}
                  <View style={{ maxWidth: "76%", alignItems: mine ? "flex-end" : "flex-start" }}>
                    <View
                      style={[
                        s.bubble,
                        mine ? s.bubbleMine : s.bubbleTheirs,
                        mine
                          ? { borderTopRightRadius: groupStart ? 18 : 6, borderBottomRightRadius: groupEnd ? 18 : 6 }
                          : { borderTopLeftRadius: groupStart ? 18 : 6, borderBottomLeftRadius: groupEnd ? 18 : 6 },
                        msg.pending && { opacity: 0.7 },
                      ]}
                    >
                      <Text style={[s.text, mine && { color: colors.primaryText }]} selectable>{msg.content}</Text>
                    </View>
                    {groupEnd && (
                      <View style={s.metaRow}>
                        <Text style={s.time}>{msg.pending ? "Sending…" : clockTime(msg.createdAt)}</Text>
                        {mine && !msg.pending && (
                          <Icon name={msg.read ? "checkmark-done" : "checkmark"} size={13} color={msg.read ? colors.primary : colors.textTertiary} />
                        )}
                      </View>
                    )}
                  </View>
                </View>
              );
            }}
          />
        )}

        {!notConnected && (
          <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
            <View style={s.inputWrap}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Write a message…"
                placeholderTextColor={colors.textTertiary}
                style={[s.input, Platform.OS === "web" && ({ outlineWidth: 0, outlineStyle: "none" } as object)]}
                multiline
                maxLength={4000}
                accessibilityLabel="Message"
                // On a keyboard (the web preview, an iPad), Enter sends and Shift+Enter breaks the line.
                onKeyPress={(e: any) => {
                  if (Platform.OS === "web" && e.nativeEvent.key === "Enter" && !e.nativeEvent.shiftKey) {
                    e.preventDefault?.();
                    submit();
                  }
                }}
              />
            </View>
            <Pressable
              onPress={submit}
              disabled={!text.trim() || send.isPending}
              style={({ pressed }) => [s.send, (!text.trim() || send.isPending) && s.sendDisabled, pressed && { opacity: 0.8 }]}
              accessibilityRole="button"
              accessibilityLabel="Send"
            >
              {send.isPending ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Icon name="send" size={18} color="#FFFFFF" />}
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}

const s = StyleSheet.create({
  intro: { alignItems: "center", gap: 4, paddingVertical: spacing.lg, borderBottomWidth: 1, borderColor: colors.borderSubtle, marginBottom: spacing.sm },
  link: { color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold, marginTop: 4 },
  gate: { alignItems: "center", gap: spacing.sm, padding: spacing.xl, paddingTop: spacing.xxl },
  gateName: { color: colors.text, fontSize: font.lg, fontFamily: fontFamily.semibold, textAlign: "center", marginTop: 4 },
  gateHeadline: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular, textAlign: "center" },
  gateBody: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 20, fontFamily: fontFamily.regular, textAlign: "center", maxWidth: 300, marginVertical: spacing.sm },
  template: { alignSelf: "stretch", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 4, marginHorizontal: spacing.lg },
  templateLabel: { color: colors.primary, fontSize: font.xs, fontFamily: fontFamily.semibold },
  templateBody: { color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular },
  dayRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginVertical: spacing.md },
  dayLine: { flex: 1, height: 1, backgroundColor: colors.borderSubtle },
  day: { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.semibold },
  lineRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  bubbleMine: { backgroundColor: colors.primary },
  bubbleTheirs: { backgroundColor: "#F0EEF2" },
  text: { color: colors.text, fontSize: font.base, lineHeight: 21, fontFamily: fontFamily.regular },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 3, marginHorizontal: 4 },
  time: { color: colors.textTertiary, fontSize: 10, fontFamily: fontFamily.regular },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  inputWrap: { flex: 1, backgroundColor: colors.surfaceRaised, borderRadius: 20, paddingHorizontal: spacing.md, minHeight: 40, justifyContent: "center" },
  input: { color: colors.text, fontSize: font.base, fontFamily: fontFamily.regular, maxHeight: 120, paddingTop: 10, paddingBottom: 10 },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  sendDisabled: { backgroundColor: "#CFC4D6" },
});
