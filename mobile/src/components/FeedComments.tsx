import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../api/client";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Avatar, Btn, ListItem, Meta, errText, timeAgo } from "./ui";
import { Sheet, type Notice } from "./Sheet";
import { FeedText, MentionInput, ReactionPicker, ReactionStack, ReportSheet, useMe } from "./FeedParts";
import { MAX_COMMENT_LENGTH, authorAvatar, authorName, reactionDef, type FeedComment, type FeedPost, type Mention, type Reaction } from "./feedModel";

interface Node extends FeedComment { replies: Node[] }

/** Replies indent this far, then line up under the last indent — narrow screens can't nest forever. */
const MAX_INDENT = 2;

/** The flat list as a tree. A reply whose parent was taken down shows at the top rather than vanishing. */
export function buildCommentTree(rows: FeedComment[]): Node[] {
  const byId = new Map<string, Node>(rows.map((r) => [r.id, { ...r, replies: [] }]));
  const roots: Node[] = [];
  for (const node of byId.values()) {
    const parent = node.parentCommentId ? byId.get(node.parentCommentId) : undefined;
    if (parent) parent.replies.push(node);
    else roots.push(node);
  }
  const prune = (nodes: Node[]): Node[] => nodes
    .map((n) => ({ ...n, replies: prune(n.replies) }))
    .filter((n) => !n.deleted || n.replies.length > 0);
  return prune(roots);
}

export const commentsKey = (postId: string) => ["post", postId, "comments"];

export function useComments(postId: string) {
  return useQuery({
    queryKey: commentsKey(postId),
    queryFn: () => api<FeedComment[]>(`/api/feed/${postId}/comments`),
  });
}

export interface ReplyTarget { id: string; name: string }

/**
 * A post's comments as a thread: reply to any comment, react to any comment,
 * report one that shouldn't be there, delete your own. On a project's post the
 * team also sees where each outside comment is in the build loop, and can turn
 * one into a task.
 */
export function FeedCommentThread({
  post, onReply, onNotice,
}: {
  post: Pick<FeedPost, "id" | "projectId" | "viewerIsTeam" | "authorId">;
  onReply: (target: ReplyTarget) => void;
  onNotice?: (n: Notice) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const { data: rows, isLoading } = useComments(post.id);
  const tree = useMemo(() => buildCommentTree(rows ?? []), [rows]);
  const [picker, setPicker] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<Node | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const refresh = () => qc.invalidateQueries({ queryKey: commentsKey(post.id) });

  const react = useMutation({
    mutationFn: ({ id, reaction }: { id: string; reaction: Reaction }) =>
      api(`/api/feed/comments/${id}/react`, { method: "POST", body: { reaction } }),
    onSuccess: refresh,
    onError: (e) => onNotice?.({ text: errText(e, "Couldn't react."), tone: "error" }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/feed/comments/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      qc.invalidateQueries({ queryKey: ["feed"] });
      qc.invalidateQueries({ queryKey: ["post", post.id] });
      onNotice?.({ text: "Comment deleted", tone: "success" });
    },
    onError: (e) => onNotice?.({ text: errText(e, "Couldn't delete that."), tone: "error" }),
  });
  const apply = useMutation({
    mutationFn: (id: string) => api<{ task?: { title?: string } }>(`/api/feed/comments/${id}/apply`, { method: "POST", body: {} }),
    onSuccess: (r) => {
      refresh();
      onNotice?.({ text: `Added to the board: ${r.task?.title ?? "a task"}. Credit it in your next update once it's done.`, tone: "success" });
    },
    onError: (e) => onNotice?.({ text: errText(e, "Couldn't turn that into a task."), tone: "error" }),
  });

  const renderNode = (c: Node, depth: number): React.ReactElement => {
    const name = authorName(c);
    const mine = !!me.id && me.id === c.authorId;
    const small = depth > 0;
    const viewerDef = reactionDef(c.viewerReaction);
    const hideReplies = collapsed[c.id];

    return (
      <View key={c.id} style={{ gap: spacing.sm }}>
        <View style={s.row}>
          {c.deleted ? (
            <View style={[s.ghostAvatar, small && s.ghostAvatarSmall]} />
          ) : (
            <Pressable onPress={() => router.push(`/user/${c.authorId}` as any)}>
              <Avatar name={name} uri={authorAvatar(c)} size={small ? 28 : 36} />
            </Pressable>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={[s.bubble, c.hidden && s.bubbleHidden]}>
              {c.deleted ? (
                <Text style={s.deleted}>This comment was deleted.</Text>
              ) : (
                <>
                  <View style={s.bubbleHead}>
                    <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => router.push(`/user/${c.authorId}` as any)}>
                      <Text style={s.name} numberOfLines={1}>
                        {name}
                        {c.authorId === post.authorId && <Text style={s.authorTag}>  Author</Text>}
                      </Text>
                      {c.profile?.headline ? <Text style={s.headline} numberOfLines={1}>{c.profile.headline}</Text> : null}
                    </Pressable>
                    <Text style={s.time}>{timeAgo(c.createdAt)}</Text>
                    {me.id && !c.hidden && (
                      <Pressable hitSlop={10} onPress={() => setMenuFor(c)} accessibilityLabel="Comment options">
                        <Ionicons name="ellipsis-horizontal" size={16} color={colors.textTertiary} />
                      </Pressable>
                    )}
                  </View>
                  <FeedText
                    content={c.content}
                    mentions={c.mentions}
                    style={{ fontSize: font.sm, lineHeight: 19, marginTop: 4 }}
                    onMentionPress={(id) => router.push(`/user/${id}` as any)}
                  />
                  {c.hidden && (
                    <View style={s.hiddenNote}>
                      <Ionicons name="eye-off-outline" size={12} color={colors.danger} />
                      <Text style={s.hiddenText}>Only you can see this — it was taken down{c.hiddenReason ? `: ${c.hiddenReason}` : "."}</Text>
                    </View>
                  )}
                </>
              )}
            </View>

            {!c.deleted && !c.hidden && (
              <View style={s.actions}>
                {picker === c.id && (
                  <ReactionPicker
                    current={c.viewerReaction}
                    style={{ bottom: 26, left: -8 }}
                    onClose={() => setPicker(null)}
                    onPick={(r) => { setPicker(null); react.mutate({ id: c.id, reaction: r }); }}
                  />
                )}
                {me.id && (
                  <Pressable
                    onPress={() => react.mutate({ id: c.id, reaction: c.viewerReaction ?? "like" })}
                    onLongPress={() => setPicker(c.id)}
                    delayLongPress={300}
                    hitSlop={6}
                    accessibilityHint="Hold to pick a reaction"
                  >
                    <Text style={[s.action, viewerDef && { color: viewerDef.color }]}>{viewerDef ? viewerDef.label : "Like"}</Text>
                  </Pressable>
                )}
                {c.reactionCount > 0 && (
                  <Pressable onPress={() => setPicker(c.id)} style={s.inline} hitSlop={6}>
                    <ReactionStack breakdown={c.reactionBreakdown} size={15} />
                    <Text style={s.count}>{c.reactionCount}</Text>
                  </Pressable>
                )}
                <Text style={s.sep}>|</Text>
                {me.id && (
                  <Pressable onPress={() => onReply({ id: c.id, name })} hitSlop={6}>
                    <Text style={s.action}>Reply</Text>
                  </Pressable>
                )}
                {c.replies.length > 0 && (
                  <Pressable onPress={() => setCollapsed((m) => ({ ...m, [c.id]: !m[c.id] }))} hitSlop={6}>
                    <Text style={s.count}>
                      {hideReplies ? "Show " : ""}{c.replies.length} repl{c.replies.length === 1 ? "y" : "ies"}
                    </Text>
                  </Pressable>
                )}
                {!mine && !c.byTeam && post.projectId && (
                  c.closedByPostId ? (
                    <View style={s.inline}><Ionicons name="checkmark-circle" size={12} color={colors.success} /><Text style={[s.count, { color: colors.success }]}>Acted on</Text></View>
                  ) : c.appliedAt ? (
                    <View style={s.inline}><Ionicons name="list" size={12} color={colors.primary} /><Text style={[s.count, { color: colors.primary }]}>On the board</Text></View>
                  ) : post.viewerIsTeam ? (
                    <Pressable onPress={() => apply.mutate(c.id)} disabled={apply.isPending} style={s.inline} hitSlop={6}>
                      {apply.isPending && apply.variables === c.id
                        ? <ActivityIndicator size="small" color={colors.primary} />
                        : <Ionicons name="add-circle-outline" size={13} color={colors.primary} />}
                      <Text style={[s.action, { color: colors.primary }]}>Make a task</Text>
                    </Pressable>
                  ) : null
                )}
              </View>
            )}
          </View>
        </View>

        {c.replies.length > 0 && !hideReplies && (
          <View style={depth < MAX_INDENT ? s.replies : { gap: spacing.sm }}>
            {c.replies.map((r) => renderNode(r, depth + 1))}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={{ gap: spacing.md }}>
      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.lg }} />
      ) : tree.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="chatbubbles-outline" size={28} color={colors.textTertiary} />
          <Text style={s.emptyTitle}>No comments yet</Text>
          <Meta>Start the conversation.</Meta>
        </View>
      ) : (
        tree.map((c) => renderNode(c, 0))
      )}

      <Sheet visible={!!menuFor} onClose={() => setMenuFor(null)} title="Comment options">
        <View style={{ marginHorizontal: -spacing.lg }}>
          {menuFor && (
            <ListItem icon="arrow-undo-outline" title={`Reply to ${authorName(menuFor)}`} onPress={() => { const c = menuFor; setMenuFor(null); onReply({ id: c.id, name: authorName(c) }); }} />
          )}
          {menuFor && me.id === menuFor.authorId ? (
            <ListItem icon="trash-outline" title="Delete comment" danger onPress={() => { const id = menuFor.id; setMenuFor(null); remove.mutate(id); }} />
          ) : menuFor ? (
            <ListItem icon="flag-outline" title="Report comment" subtitle="A person reviews every report" onPress={() => { const id = menuFor.id; setMenuFor(null); setReportId(id); }} />
          ) : null}
        </View>
      </Sheet>

      <ReportSheet
        visible={!!reportId}
        onClose={() => setReportId(null)}
        targetType="feed_comment"
        targetId={reportId ?? ""}
        onSent={() => onNotice?.({ text: "Thanks — someone will review this.", tone: "success" })}
      />
    </View>
  );
}

/**
 * The box pinned to the bottom of a post: comment, or reply to whoever was
 * picked, with @ to tag people.
 */
export function CommentBar({
  postId, replyTo, onCancelReply, autoFocus, inputRef, onNotice, onSent,
}: {
  postId: string;
  replyTo: ReplyTarget | null;
  onCancelReply: () => void;
  autoFocus?: boolean;
  inputRef?: React.RefObject<TextInput | null>;
  onNotice?: (n: Notice) => void;
  onSent?: () => void;
}) {
  const qc = useQueryClient();
  const me = useMe();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<Mention[]>([]);
  const localRef = useRef<TextInput>(null);
  const ref = inputRef ?? localRef;

  const send = useMutation({
    mutationFn: () => api<FeedComment[]>(`/api/feed/${postId}/comments`, {
      method: "POST",
      body: { content: text, mentions, parentCommentId: replyTo?.id },
    }),
    onSuccess: (rows) => {
      setText(""); setMentions([]); onCancelReply();
      qc.setQueryData(commentsKey(postId), rows);
      qc.invalidateQueries({ queryKey: ["post", postId] });
      qc.invalidateQueries({ queryKey: ["feed"] });
      onSent?.();
    },
    onError: (e) => onNotice?.({ text: errText(e, "Couldn't post that."), tone: "error" }),
  });

  if (!me.id) return null;
  return (
    <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      {replyTo && (
        <View style={s.replying}>
          <Text style={s.replyingText} numberOfLines={1}>Replying to <Text style={{ fontFamily: fontFamily.semibold, color: colors.text }}>{replyTo.name}</Text></Text>
          <Pressable onPress={onCancelReply} hitSlop={8} accessibilityLabel="Cancel reply">
            <Ionicons name="close" size={16} color={colors.textSecondary} />
          </Pressable>
        </View>
      )}
      <View style={s.barRow}>
        <Avatar name={me.name} uri={me.avatar} size={34} />
        <View style={{ flex: 1 }}>
          <MentionInput
            inputRef={ref}
            value={text}
            onChangeText={setText}
            mentions={mentions}
            onMentionsChange={setMentions}
            placeholder={replyTo ? `Reply to ${replyTo.name}…` : "Add a comment… use @ to tag"}
            maxLength={MAX_COMMENT_LENGTH}
            minHeight={40}
            autoFocus={autoFocus}
            style={{ maxHeight: 120 }}
          />
        </View>
        {text.trim().length > 0 && (
          <Btn label={replyTo ? "Reply" : "Post"} small loading={send.isPending} onPress={() => send.mutate()} />
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  ghostAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceRaised },
  ghostAvatarSmall: { width: 28, height: 28, borderRadius: 14 },
  bubble: { backgroundColor: colors.surfaceRaised, borderTopRightRadius: radius.md, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, borderTopLeftRadius: 2, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bubbleHidden: { backgroundColor: "#FDF1F0", borderWidth: 1, borderColor: "#F6D3D1" },
  bubbleHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  name: { color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold },
  authorTag: { color: colors.primary, fontSize: 11, fontFamily: fontFamily.semibold },
  headline: { color: colors.textSecondary, fontSize: 11, fontFamily: fontFamily.regular },
  time: { color: colors.textTertiary, fontSize: 11, fontFamily: fontFamily.regular, marginTop: 1 },
  deleted: { color: colors.textTertiary, fontSize: font.sm, fontFamily: fontFamily.regular, fontStyle: "italic" },
  hiddenNote: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  hiddenText: { color: colors.danger, fontSize: 11, fontFamily: fontFamily.regular, flexShrink: 1 },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, marginTop: 4, marginLeft: spacing.sm, position: "relative" },
  action: { color: colors.textSecondary, fontSize: 12, fontFamily: fontFamily.semibold },
  inline: { flexDirection: "row", alignItems: "center", gap: 3 },
  count: { color: colors.textTertiary, fontSize: 12, fontFamily: fontFamily.regular },
  sep: { color: colors.border, fontSize: 12 },
  replies: { marginLeft: 18, paddingLeft: spacing.md, borderLeftWidth: 2, borderColor: colors.borderSubtle, gap: spacing.sm },
  empty: { alignItems: "center", gap: 4, paddingVertical: spacing.xl },
  emptyTitle: { color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold },
  bar: { backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.xs },
  barRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  replying: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.xs },
  replyingText: { color: colors.textSecondary, fontSize: 12, fontFamily: fontFamily.regular, flexShrink: 1 },
});
