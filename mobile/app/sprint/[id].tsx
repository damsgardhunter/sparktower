import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { colors, font, radius, spacing } from "../../src/theme";
import {
  Avatar, Body, Btn, Card, Chip, Cost, Empty, ErrorNote, Field, H1, H2,
  Label, Loading, Meta, Row, Screen, Segments, errText, timeAgo,
} from "../../src/components/ui";

const PHASES = ["setup", "ideation", "alignment", "building", "validation", "review", "completed"];

type Tab = "chat" | "phase" | "tasks";

/**
 * Sprint dashboard: the phase you're in, the shared task board, and the chat
 * where Nova stands in as your partner on a practice sprint.
 */
export default function SprintDashboard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("chat");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: sprint, isLoading } = useQuery({
    queryKey: ["sprint", id],
    queryFn: () => api<any>(`/api/sprints/${id}`),
    enabled: !!id,
  });

  const { data: messages } = useQuery({
    queryKey: ["sprint", id, "messages"],
    queryFn: () => api<any[]>(`/api/sprints/${id}/messages`),
    enabled: !!id && tab === "chat",
    refetchInterval: 10_000,
  });

  const { data: tasks } = useQuery({
    queryKey: ["sprint", id, "tasks"],
    queryFn: () => api<any[]>(`/api/sprints/${id}/tasks`),
    enabled: !!id && tab === "tasks",
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["sprint", id] });

  const send = useMutation({
    mutationFn: () => api(`/api/sprints/${id}/messages`, { method: "POST", body: { content: message.trim() } }),
    onSuccess: async () => {
      setMessage("");
      qc.invalidateQueries({ queryKey: ["sprint", id, "messages"] });
      // On a practice sprint Nova answers back, so the chat is a conversation.
      if (sprint?.isPractice) novaReply.mutate();
    },
    onError: (e) => setError(errText(e, "Couldn't send that.")),
  });

  const novaReply = useMutation({
    mutationFn: () => api(`/api/sprints/${id}/nova-reply`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sprint", id, "messages"] });
      qc.invalidateQueries({ queryKey: ["subscription"] });
    },
    onError: (e) => setError(errText(e, "Nova couldn't reply.")),
  });

  const advance = useMutation({
    mutationFn: () => api(`/api/sprints/${id}/advance`, { method: "POST" }),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ["subscription"] }); },
    onError: (e) => setError(errText(e, "Couldn't advance the sprint.")),
  });

  const toggleTask = useMutation({
    mutationFn: (task: any) => api(`/api/sprints/${id}/tasks/${task.id}`, {
      method: "PATCH",
      body: { status: task.status === "done" ? "todo" : "done" },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sprint", id, "tasks"] }),
  });

  if (isLoading) return <Loading />;
  if (!sprint) return <Screen><Empty title="Sprint not found" /></Screen>;

  const phaseIndex = PHASES.indexOf(sprint.status);
  const partner = sprint.user1Id === user?.id ? sprint.user2 : sprint.user1;

  return (
    <>
      <Stack.Screen options={{ title: sprint.productName || "Sprint" }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <Screen>
          <Card>
            <Row between>
              <Chip label={sprint.status} small active />
              <Meta>{sprint.duration}</Meta>
            </Row>
            <H1>{sprint.productName || "Unnamed product"}</H1>
            {sprint.productDescription && <Body muted>{sprint.productDescription}</Body>}
            <Row center gap={spacing.sm}>
              {sprint.isPractice ? (
                <>
                  <Text style={{ fontSize: 18 }}>🤖</Text>
                  <Meta>Practising with Nova</Meta>
                </>
              ) : (
                <>
                  <Avatar name={partner?.firstName || "Partner"} size={24} />
                  <Meta>with {partner?.firstName || "your partner"}</Meta>
                </>
              )}
            </Row>
            <Meta>
              Phase {Math.max(1, phaseIndex + 1)} of {PHASES.length}
            </Meta>
            {sprint.status !== "completed" && (
              <Btn
                label="Advance to next phase"
                variant="outline"
                small
                loading={advance.isPending}
                onPress={() => advance.mutate()}
              />
            )}
          </Card>

          <Segments
            options={[
              { value: "chat" as Tab, label: "Chat" },
              { value: "tasks" as Tab, label: "Tasks" },
              { value: "phase" as Tab, label: "Phases" },
            ]}
            value={tab}
            onChange={setTab}
          />

          {error && <ErrorNote message={error} />}

          {tab === "chat" && (
            <View style={{ gap: spacing.sm }}>
              {(messages ?? []).map((m) => {
                const isNova = m.isNova === true;
                const mine = !isNova && m.userId === user?.id;
                return (
                  <View key={m.id} style={[s.row, mine && { justifyContent: "flex-end" }]}>
                    <View style={[s.bubble, mine ? s.mine : isNova ? s.nova : s.theirs]}>
                      {isNova && <Text style={s.novaTag}>🤖 Nova</Text>}
                      <Text style={[s.msg, mine && { color: colors.primaryText }]}>{m.content}</Text>
                    </View>
                  </View>
                );
              })}
              {novaReply.isPending && <Meta>🤖 Nova is thinking…</Meta>}
              {!messages?.length && <Meta>No messages yet.</Meta>}

              <Row gap={spacing.sm} style={{ alignItems: "flex-end" }}>
                <View style={{ flex: 1 }}>
                  <Field
                    value={message}
                    onChangeText={setMessage}
                    placeholder={sprint.isPractice ? "Talk to Nova about the product…" : "Message your partner…"}
                  />
                </View>
                <Btn
                  label="Send"
                  small
                  disabled={!message.trim()}
                  loading={send.isPending}
                  onPress={() => send.mutate()}
                />
              </Row>
              {sprint.isPractice && <Meta>Nova replies as your partner · 1 credit per reply</Meta>}
            </View>
          )}

          {tab === "tasks" && (
            !tasks?.length ? (
              <Empty title="No tasks yet" body="Tasks appear once the sprint reaches the building phase." />
            ) : (
              <View style={{ gap: spacing.sm }}>
                {tasks.map((t) => (
                  <Card key={t.id} onPress={() => toggleTask.mutate(t)}>
                    <Row center gap={spacing.sm}>
                      <Text style={{ fontSize: 16 }}>{t.status === "done" ? "☑️" : "⬜️"}</Text>
                      <View style={{ flex: 1 }}>
                        <Body style={t.status === "done" ? { textDecorationLine: "line-through" } : undefined}>
                          {t.title}
                        </Body>
                        {t.description && <Meta numberOfLines={2}>{t.description}</Meta>}
                      </View>
                    </Row>
                  </Card>
                ))}
              </View>
            )
          )}

          {tab === "phase" && (
            <View style={{ gap: spacing.sm }}>
              {PHASES.map((p, i) => (
                <Card key={p}>
                  <Row center gap={spacing.sm}>
                    <Text style={{ fontSize: 16 }}>
                      {i < phaseIndex ? "✅" : i === phaseIndex ? "🔵" : "⚪️"}
                    </Text>
                    <Body style={{ textTransform: "capitalize", flex: 1 }}>{p}</Body>
                  </Row>
                </Card>
              ))}
            </View>
          )}
        </Screen>
      </KeyboardAvoidingView>
    </>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row" },
  bubble: { maxWidth: "82%", borderRadius: radius.md, padding: spacing.sm, gap: 2 },
  mine: { backgroundColor: colors.primary },
  theirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  nova: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary + "66" },
  novaTag: { color: colors.primary, fontSize: font.xs, fontWeight: "700" },
  msg: { color: colors.text, fontSize: font.base, lineHeight: 20 },
});
