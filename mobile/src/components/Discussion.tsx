import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { api } from "../api/client";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Avatar, Btn, ErrorNote, Loading, Meta, errText, timeAgo } from "./ui";
import { FeedText, MentionInput, ReportSheet, useMe } from "./FeedParts";
import { MAX_COMMENT_LENGTH, type Mention } from "./feedModel";

type Target = "milestone" | "project" | "roadmap_phase";

/** Openers so a blank box doesn't stop people engaging. */
const STARTERS: Record<Target, string[]> = {
  milestone: ["Congrats!", "How did you pull that off?", "I can help with what's next."],
  roadmap_phase: ["I can help with this.", "Have you considered…", "What's blocking this?"],
  project: ["This is interesting because…", "Have you considered…", "I'd use this if…"],
};

/**
 * Comment thread on a milestone, roadmap phase, or project.
 * Native counterpart of the web's ProjectDiscussion, drawn like the feed's comments.
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
  const router = useRouter();
  const me = useMe();
  const [open, setOpen] = useState(!compact);
  const [content, setContent] = useState("");
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [reportId, setReportId] = useState<string | null>(null);
  /*
   * What went wrong with the last thing this thread tried.
   *
   * Inline rather than the floating NoticeBanner the screens use: a Discussion
   * is a block inside somebody else's scrolling page, and NoticeBanner is
   * absolutely positioned — dropped in here it would anchor to this block and
   * land in the middle of the page rather than above the bottom edge. The
   * message belongs next to the box that failed anyway.
   */
  const [problem, setProblem] = useState<string | null>(null);

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

  /*
   * All three of these used to fail without saying anything.
   *
   * The comment was the expensive one: a refused post (rate limit, a
   * moderation hold, no connection) cleared nothing and showed nothing, so
   * what someone had written just sat there looking un-sent while they tapped
   * Comment again and again. Note that the box is only emptied in onSuccess —
   * a failure keeps the typed draft and its @mentions exactly as they were, so
   * "try again" is one tap and not a retype.
   */
  const post = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/comments`, {
      method: "POST",
      body: { targetType, targetId, content, mentions },
    }),
    onSuccess: () => { setContent(""); setMentions([]); setProblem(null); invalidate(); },
    onError: (e) => setProblem(errText(e, "Couldn't post that comment. It's still here — try again.")),
  });

  const react = useMutation({
    mutationFn: (commentId: string) => api(`/api/project-comments/${commentId}/react`, { method: "POST" }),
    onSuccess: () => { setProblem(null); invalidate(); },
    onError: (e) => setProblem(errText(e, "Couldn't register that. Try again.")),
  });

  const remove = useMutation({
    mutationFn: (commentId: string) => api(`/api/project-comments/${commentId}`, { method: "DELETE" }),
    onSuccess: () => { setProblem(null); invalidate(); },
    // A delete that silently does nothing is the worst of the three: the
    // comment stays on screen and the person assumes it's gone from the page.
    onError: (e) => setProblem(errText(e, "Couldn't delete that comment. It's still there.")),
  });

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} style={({ pressed }) => [s.discussBtn, pressed && { opacity: 0.6 }]}>
        <Ionicons name="chatbubble-outline" size={15} color={colors.textSecondary} />
        <Text style={s.discussText}>Discuss</Text>
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
            const name = c.profile?.displayName || [c.author?.firstName, c.author?.lastName].filter(Boolean).join(" ") || "Someone";
            const mine = !!me.id && me.id === c.authorId;
            return (
              <View key={c.id} style={s.row}>
                <Pressable onPress={() => router.push(`/user/${c.authorId}` as any)}>
                  <Avatar name={name} uri={c.profile?.avatarUrl ?? c.author?.profileImageUrl} size={32} />
                </Pressable>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={s.bubble}>
                    <View style={s.head}>
                      <Text style={s.commentAuthor} numberOfLines={1}>{name}</Text>
                      <Text style={s.time}>{timeAgo(c.createdAt)}</Text>
                    </View>
                    {c.profile?.headline ? <Text style={s.headline} numberOfLines={1}>{c.profile.headline}</Text> : null}
                    <FeedText content={c.content} mentions={c.mentions} style={{ fontSize: font.sm, lineHeight: 19, marginTop: 2 }} />
                  </View>
                  <View style={s.actions}>
                    <Pressable onPress={() => react.mutate(c.id)} hitSlop={6} style={s.inline}>
                      <Ionicons name={c.viewerReacted ? "thumbs-up" : "thumbs-up-outline"} size={13} color={c.viewerReacted ? colors.primary : colors.textSecondary} />
                      <Text style={[s.commentAction, c.viewerReacted && s.commentActionActive]}>
                        {c.reactionCount > 0 ? c.reactionCount : "Like"}
                      </Text>
                    </Pressable>
                    {mine ? (
                      <Pressable onPress={() => remove.mutate(c.id)} hitSlop={6}>
                        <Text style={s.commentAction}>Delete</Text>
                      </Pressable>
                    ) : me.id ? (
                      <Pressable onPress={() => setReportId(c.id)} hitSlop={6} style={s.inline}>
                        <Ionicons name="flag-outline" size={12} color={colors.textTertiary} />
                        <Text style={[s.commentAction, { color: colors.textTertiary }]}>Report</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })}
        </>
      )}

      <View style={{ gap: spacing.xs }}>
        {problem && <ErrorNote message={problem} />}
        <MentionInput
          value={content}
          onChangeText={setContent}
          mentions={mentions}
          onMentionsChange={setMentions}
          placeholder="Add a comment… use @ to tag"
          maxLength={MAX_COMMENT_LENGTH}
        />
        {content.length === 0 ? (
          <View style={s.starters}>
            {STARTERS[targetType].map((st) => (
              <Pressable key={st} onPress={() => setContent(st)} style={s.starter}>
                <Text style={s.starterText}>{st}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Btn label="Comment" small icon="send" loading={post.isPending} onPress={() => post.mutate()} style={{ alignSelf: "flex-end" }} />
        )}
      </View>

      <ReportSheet visible={!!reportId} onClose={() => setReportId(null)} targetType="comment" targetId={reportId ?? ""} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle,
    paddingTop: spacing.md, marginTop: spacing.xs,
  },
  discussBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    paddingTop: spacing.sm, marginTop: spacing.xs,
  },
  discussText: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.semibold },
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  bubble: {
    backgroundColor: colors.surfaceRaised, borderTopLeftRadius: 2, borderTopRightRadius: radius.md,
    borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  commentAuthor: { flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold },
  time: { color: colors.textTertiary, fontSize: 11, fontFamily: fontFamily.regular },
  headline: { color: colors.textSecondary, fontSize: 11, fontFamily: fontFamily.regular },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: 4, marginLeft: spacing.sm },
  inline: { flexDirection: "row", alignItems: "center", gap: 4 },
  commentAction: { color: colors.textSecondary, fontSize: 12, fontFamily: fontFamily.semibold },
  commentActionActive: { color: colors.primary },
  starters: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  starter: {
    backgroundColor: colors.surfaceRaised, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 5,
  },
  starterText: { color: colors.textSecondary, fontSize: 12, fontFamily: fontFamily.medium },
});
