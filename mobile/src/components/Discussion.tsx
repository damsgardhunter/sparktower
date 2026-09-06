import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors, font, radius, spacing } from "../theme";
import { Avatar, Body, Btn, Field, Loading, Meta, Row, timeAgo } from "./ui";

type Target = "milestone" | "project" | "roadmap_phase";

/** Openers so a blank box doesn't stop people engaging. */
const STARTERS: Record<Target, string[]> = {
  milestone: ["Congrats! 🎉", "How did you pull that off?", "I can help with what's next."],
  roadmap_phase: ["I can help with this.", "Have you considered…", "What's blocking this?"],
  project: ["This is interesting because…", "Have you considered…", "I'd use this if…"],
};

/**
 * Comment thread on a milestone, roadmap phase, or project.
 * Native counterpart of the web's ProjectDiscussion.
 */
export function Discussion({
  projectId, targetType, targetId, compact,
}: {
  projectId: string;
  targetType: Target;
  targetId: string;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(!compact);
  const [content, setContent] = useState("");

  const key = ["project", projectId, "comments", targetType, targetId];

  const { data: comments, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api<any[]>(
      `/api/projects/${projectId}/comments?targetType=${targetType}&targetId=${targetId}`
    ),
    enabled: open,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["project", projectId, "comment-counts"] });
  };

  const post = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/comments`, {
      method: "POST",
      body: { targetType, targetId, content },
    }),
    onSuccess: () => { setContent(""); invalidate(); },
  });

  const react = useMutation({
    mutationFn: (commentId: string) => api(`/api/project-comments/${commentId}/react`, { method: "POST" }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (commentId: string) => api(`/api/project-comments/${commentId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} style={({ pressed }) => [s.discussBtn, pressed && { opacity: 0.6 }]}>
        <Text style={s.discussText}>💬 Discuss</Text>
      </Pressable>
    );
  }

  return (
    <View style={s.wrap}>
      {isLoading ? (
        <Loading />
      ) : (
        <>
          {(comments?.length ?? 0) === 0 && <Meta>No comments yet. Start the conversation.</Meta>}
          {(comments ?? []).map((c) => {
            const name = c.profile?.displayName || c.author?.firstName || "Someone";
            return (
              <Row key={c.id} gap={spacing.sm} style={{ alignItems: "flex-start" }}>
                <Avatar name={name} size={28} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={s.bubble}>
                    <Row center gap={spacing.xs}>
                      <Text style={s.commentAuthor}>{name}</Text>
                      <Meta>{timeAgo(c.createdAt)}</Meta>
                    </Row>
                    <Body>{c.content}</Body>
                  </View>
                  <Row gap={spacing.md} style={{ marginTop: 2, marginLeft: spacing.xs }}>
                    <Pressable onPress={() => react.mutate(c.id)} hitSlop={6}>
                      <Text style={[s.commentAction, c.viewerReacted && s.commentActionActive]}>
                        👍 {c.reactionCount > 0 ? c.reactionCount : "Like"}
                      </Text>
                    </Pressable>
                    <Pressable onPress={() => remove.mutate(c.id)} hitSlop={6}>
                      <Text style={s.commentAction}>Delete</Text>
                    </Pressable>
                  </Row>
                </View>
              </Row>
            );
          })}
        </>
      )}

      <View style={{ gap: spacing.xs }}>
        <Field value={content} onChangeText={setContent} placeholder="Add a comment…" multiline />
        {content.length === 0 ? (
          <Row wrap gap={spacing.xs}>
            {STARTERS[targetType].map((st) => (
              <Pressable key={st} onPress={() => setContent(st)} style={s.starter}>
                <Text style={s.starterText}>{st}</Text>
              </Pressable>
            ))}
          </Row>
        ) : (
          <Btn label="Comment" small loading={post.isPending} onPress={() => post.mutate()} />
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderSubtle,
    paddingTop: spacing.sm, marginTop: spacing.xs,
  },
  discussBtn: {
    alignSelf: "flex-start", borderTopWidth: 1, borderTopColor: colors.borderSubtle,
    paddingTop: spacing.sm, marginTop: spacing.xs,
  },
  discussText: { color: colors.textSecondary, fontSize: font.sm },
  bubble: { backgroundColor: colors.surfaceRaised, borderRadius: radius.md, padding: spacing.sm },
  commentAuthor: { color: colors.text, fontSize: font.xs, fontWeight: "700" },
  commentAction: { color: colors.textTertiary, fontSize: font.xs },
  commentActionActive: { color: colors.primary, fontWeight: "700" },
  starter: {
    backgroundColor: colors.surfaceRaised, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
  },
  starterText: { color: colors.textSecondary, fontSize: font.xs },
});
