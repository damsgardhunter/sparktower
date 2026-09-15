/**
 * Team Chat — the native counterpart of LiveChatTab in
 * client/src/pages/project-manager.tsx: the project's live chat, polled every
 * few seconds, with a send box.
 */
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Avatar, Btn, Card, Icon, Loading, Meta, Row } from "../ui";
import { Tag, useNotify } from "./bits";
import { mkey } from "./shared";

export function Chat({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { fail } = useNotify();
  const [message, setMessage] = useState("");
  const key = mkey(projectId, "live-chat");
  const { data = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api<any[]>(`/api/projects/${projectId}/live-chat`),
    refetchInterval: 3000,
  });
  const send = useMutation({
    mutationFn: (content: string) => api(`/api/projects/${projectId}/live-chat`, { method: "POST", body: { content } }),
    onSuccess: () => { setMessage(""); void qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => fail(e, "Failed to send message"),
  });
  const submit = () => { if (message.trim()) send.mutate(message.trim()); };

  return (
    <View style={{ gap: spacing.md }}>
      <Row between>
        <Text style={{ fontSize: font.lg, fontFamily: fontFamily.semibold, color: colors.text }}>Team Chat</Text>
        <Tag color={colors.textSecondary} label={`${data.length} messages`} />
      </Row>
      <Card style={{ gap: spacing.md, minHeight: 320 }}>
        {isLoading ? <Loading /> : !data.length ? (
          <View style={{ alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.sm }}>
            <Icon name="chatbubbles-outline" size={40} color={colors.textTertiary} />
            <Meta style={{ fontSize: font.sm }}>No messages yet. Start the conversation!</Meta>
          </View>
        ) : data.map((msg) => {
          const me = msg.userId === user?.id;
          return (
            <View key={msg.id} style={{ flexDirection: me ? "row-reverse" : "row", gap: spacing.sm, maxWidth: "85%", alignSelf: me ? "flex-end" : "flex-start" }}>
              <Avatar name={msg.user?.firstName || "User"} uri={msg.user?.profileImageUrl} size={28} />
              <View style={{ gap: 2, flexShrink: 1, alignItems: me ? "flex-end" : "flex-start" }}>
                <Meta>{msg.user?.firstName || "User"} · {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Meta>
                <View style={{ borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: me ? colors.primary : colors.surfaceRaised }}>
                  <Text style={{ fontSize: font.sm, lineHeight: 19, color: me ? "#FFFFFF" : colors.text, fontFamily: fontFamily.regular }}>{msg.content}</Text>
                </View>
              </View>
            </View>
          );
        })}
      </Card>
      <Row gap={spacing.sm} center>
        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder="Type a message..."
          placeholderTextColor={colors.textTertiary}
          onSubmitEditing={submit}
          returnKeyType="send"
          editable={!send.isPending}
          style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 10, fontSize: font.sm, color: colors.text, fontFamily: fontFamily.regular }}
        />
        <Btn small label="Send" disabled={!message.trim()} loading={send.isPending} onPress={submit} />
      </Row>
    </View>
  );
}
