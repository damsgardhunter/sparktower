/**
 * The build loop from the team's side — feedback on the project's updates,
 * what's new since you looked, one tap to turn it into a task, and a nudge to
 * credit it in the next update. The native counterpart of
 * client/src/components/feedback-inbox.tsx, against the same endpoints.
 */
import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Avatar, Btn, Icon, Loading, Meta, Row, errText } from "../ui";
import { Block } from "../ProjectBits";
import type { Notice } from "../Sheet";

type FeedbackState = "open" | "applied" | "closed";

export interface FeedbackInboxItem {
  commentId: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string; avatarUrl: string | null };
  post: { id: string; excerpt: string; asks: string[]; createdAt: string };
  state: FeedbackState;
  isNew: boolean;
  task: { id: string; title: string; status: string } | null;
  closedByPostId: string | null;
}
export interface FeedbackInboxData {
  items: FeedbackInboxItem[];
  counts: { new: number; open: number; applied: number; readyToClose: number; closed: number };
}

const STATE: Record<FeedbackState, { label: string; bg: string; fg: string }> = {
  open: { label: "Not acted on", bg: colors.surfaceRaised, fg: colors.textSecondary },
  applied: { label: "On the board", bg: colors.primarySoft, fg: colors.primary },
  closed: { label: "Credited in an update", bg: "#DCFCE7", fg: "#15803D" },
};

export const feedbackKey = (projectId: string) => ["project", projectId, "feedback"];

/** The team's count of feedback they haven't read, for the Updates tab's badge. */
export function useNewFeedbackCount(projectId: string, enabled = true) {
  const { data } = useQuery({
    queryKey: feedbackKey(projectId),
    queryFn: () => api<FeedbackInboxData>(`/api/projects/${projectId}/feedback`),
    enabled,
    retry: false,
  });
  return data?.counts.new ?? 0;
}

export function FeedbackInbox({ projectId, notify }: { projectId: string; notify: (n: Notice) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: feedbackKey(projectId),
    queryFn: () => api<FeedbackInboxData>(`/api/projects/${projectId}/feedback`),
    retry: false,
  });

  const seen = useMutation({ mutationFn: () => api(`/api/projects/${projectId}/feedback/seen`, { method: "POST", body: {} }) });
  // Reading the inbox is seeing it; the "new" marks stay for this visit.
  const newCount = data?.counts.new ?? 0;
  useEffect(() => {
    if (newCount > 0 && !seen.isPending && !seen.isSuccess) seen.mutate();
  }, [newCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = useMutation({
    mutationFn: (commentId: string) => api(`/api/feed/comments/${commentId}/apply`, { method: "POST", body: {} }),
    onSuccess: () => {
      notify({ text: "Added to the board. Once it's done, credit it in your next update.", tone: "success" });
      void qc.invalidateQueries({ queryKey: feedbackKey(projectId) });
      void qc.invalidateQueries({ queryKey: ["manage", projectId] });
    },
    onError: (e) => notify({ text: errText(e, "Couldn't turn that into a task."), tone: "error" }),
  });

  if (isLoading) return <Block><Loading /></Block>;
  if (!data) return null;
  const { items, counts } = data;

  return (
    <Block>
      <Row center wrap gap={6}>
        <Icon name="chatbox-ellipses-outline" size={17} color={colors.primary} />
        <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>Feedback on your updates</Text>
        {counts.new > 0 && (
          <View style={{ backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 }}>
            <Text style={{ color: "#FFFFFF", fontSize: font.xs, fontFamily: fontFamily.semibold }}>{counts.new} new</Text>
          </View>
        )}
      </Row>
      <Meta>{counts.open} to act on · {counts.applied} on the board · {counts.closed} credited</Meta>

      {counts.readyToClose > 0 && (
        <Row gap={6} style={{ backgroundColor: "#DCFCE7", borderRadius: radius.sm, padding: spacing.sm }}>
          <Icon name="repeat" size={15} color="#15803D" />
          <Text style={{ flex: 1, fontSize: font.xs + 1, lineHeight: 17, color: "#166534", fontFamily: fontFamily.regular }}>
            {counts.readyToClose === 1 ? "One piece of feedback is" : `${counts.readyToClose} pieces of feedback are`} done. Post an update and credit {counts.readyToClose === 1 ? "it" : "them"} — the people who gave it will see it was used.
          </Text>
        </Row>
      )}

      {items.length === 0 ? (
        <Meta style={{ fontSize: font.sm, lineHeight: 19 }}>
          No feedback yet. Post an update for this project with a specific question or two — that's what gets answered.
        </Meta>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {items.map((i) => (
            <View key={i.commentId} style={{
              borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, gap: 6,
              borderColor: i.isNew ? `${colors.primary}66` : colors.border, backgroundColor: i.isNew ? colors.primarySoft : colors.surface,
            }}>
              <Row center gap={6}>
                <Pressable onPress={() => router.push(`/user/${i.author.id}` as any)}>
                  <Row center gap={6}>
                    <Avatar name={i.author.name} uri={i.author.avatarUrl} size={22} />
                    <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.semibold, color: colors.text }}>{i.author.name}</Text>
                  </Row>
                </Pressable>
                {i.isNew && <Meta style={{ color: colors.primary }}>new</Meta>}
                <View style={{ flex: 1 }} />
                <View style={{ backgroundColor: STATE[i.state].bg, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 }}>
                  <Text style={{ fontSize: 10, fontFamily: fontFamily.medium, color: STATE[i.state].fg }}>{STATE[i.state].label}</Text>
                </View>
              </Row>
              <Text style={{ fontSize: font.sm, lineHeight: 19, color: colors.text, fontFamily: fontFamily.regular }}>{i.content}</Text>
              <Pressable onPress={() => router.push(`/post/${i.post.id}` as any)}>
                <Meta numberOfLines={1}>On: {i.post.excerpt}</Meta>
              </Pressable>
              {(i.state === "open" || i.task) && (
                <Row center wrap gap={spacing.sm}>
                  {i.state === "open" && (
                    <Btn small variant="outline" icon="list-outline" label="Turn into a task"
                      loading={apply.isPending && apply.variables === i.commentId} onPress={() => apply.mutate(i.commentId)} />
                  )}
                  {i.task && (
                    <Row center gap={4} style={{ flexShrink: 1 }}>
                      <Icon name={i.task.status === "done" ? "checkmark-circle" : "list-outline"} size={13} color={i.task.status === "done" ? colors.success : colors.textTertiary} />
                      <Meta numberOfLines={1} style={{ flexShrink: 1 }}>{i.task.title} · {i.task.status === "done" ? "done" : "in progress"}</Meta>
                    </Row>
                  )}
                </Row>
              )}
            </View>
          ))}
        </View>
      )}
    </Block>
  );
}
