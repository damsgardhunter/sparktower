import { useState, useRef, useEffect } from "react";
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { colors, font, radius, spacing } from "../../src/theme";
import { Btn, Empty, Field, Loading, Meta, Row, timeAgo } from "../../src/components/ui";

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const listRef = useRef<FlatList>(null);

  const { data: messages, isLoading } = useQuery({
    queryKey: ["messages", id],
    queryFn: () => api<any[]>(`/api/messages/${id}`),
    enabled: !!id,
    refetchInterval: 8_000,
  });

  // Clear the unread badge once the thread is open.
  useEffect(() => {
    if (!id) return;
    api(`/api/messages/${id}/read`, { method: "POST" })
      .then(() => qc.invalidateQueries({ queryKey: ["conversations"] }))
      .catch(() => {});
  }, [id]);

  const send = useMutation({
    mutationFn: () => api(`/api/messages/${id}`, { method: "POST", body: { content: text.trim() } }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["messages", id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  if (isLoading) return <Loading />;

  return (
    <>
      <Stack.Screen options={{ title: "Chat" }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <FlatList
          ref={listRef}
          data={messages ?? []}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<Empty title="Say hello" body="No messages in this conversation yet." />}
          renderItem={({ item }) => {
            const mine = item.senderId === user?.id;
            return (
              <View style={[s.bubbleRow, mine && { justifyContent: "flex-end" }]}>
                <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleTheirs]}>
                  <Text style={[s.text, mine && { color: colors.primaryText }]}>{item.content}</Text>
                  <Text style={[s.time, mine && { color: colors.primaryText, opacity: 0.7 }]}>
                    {timeAgo(item.createdAt)}
                  </Text>
                </View>
              </View>
            );
          }}
        />
        <View style={s.composer}>
          <View style={{ flex: 1 }}>
            <Field value={text} onChangeText={setText} placeholder="Message…" />
          </View>
          <Btn
            label="Send"
            small
            disabled={!text.trim()}
            loading={send.isPending}
            onPress={() => send.mutate()}
          />
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const s = StyleSheet.create({
  bubbleRow: { flexDirection: "row" },
  bubble: { maxWidth: "78%", borderRadius: radius.md, padding: spacing.sm, gap: 2 },
  bubbleMine: { backgroundColor: colors.primary },
  bubbleTheirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  text: { color: colors.text, fontSize: font.base, lineHeight: 20 },
  time: { color: colors.textTertiary, fontSize: 10 },
  composer: {
    flexDirection: "row", gap: spacing.sm, alignItems: "flex-end",
    padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border,
  },
});
