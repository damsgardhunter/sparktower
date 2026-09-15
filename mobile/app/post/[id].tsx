import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, spacing } from "../../src/theme";
import { Empty, Loading } from "../../src/components/ui";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import { PostCard } from "../../src/components/PostCard";
import { CommentBar, FeedCommentThread, commentsKey, type ReplyTarget } from "../../src/components/FeedComments";
import { NextStepLink, ReactionsBox } from "../../src/components/feed/PostExtras";
import type { FeedPost } from "../../src/components/feedModel";

/**
 * A post on its own: the post unfolded, every comment and reply, and a comment
 * box pinned to the bottom. What a notification, a shared link or a tap on a
 * feed card opens.
 */
export default function PostScreen() {
  const { id, comment } = useLocalSearchParams<{ id: string; comment?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { data: post, isLoading, error, refetch } = useQuery({
    queryKey: ["post", id],
    queryFn: () => api<FeedPost>(`/api/feed/${id}`),
    enabled: !!id,
    retry: false,
  });
  const notFound = (error as { status?: number } | null)?.status === 404;

  // Opening the post is seeing what the notifications said about it.
  useEffect(() => {
    if (!post?.id) return;
    api("/api/notifications/read", { method: "POST", body: { postId: post.id } })
      .then(() => qc.invalidateQueries({ queryKey: ["notification-count"] }))
      .catch(() => {});
  }, [post?.id]);

  const focusBox = () => setTimeout(() => inputRef.current?.focus(), 50);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetch(), qc.invalidateQueries({ queryKey: commentsKey(id!) })]);
    setRefreshing(false);
  };

  if (isLoading) return (<><Stack.Screen options={{ title: "Post" }} /><Loading /></>);

  if (error || !post) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: "center" }}>
        <Stack.Screen options={{ title: "Post" }} />
        {notFound ? (
          <Empty icon="newspaper-outline" title="This post isn't here" body="It was deleted, or it's on a private project you're not part of." action="Back to the feed" onAction={() => router.back()} />
        ) : (
          <Empty icon="cloud-offline-outline" title="Couldn't load this post" body="Something went wrong on our side." action="Try again" onAction={() => refetch()} />
        )}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}>
      <Stack.Screen options={{ title: "Post" }} />
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.sm }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Opened from a link rather than the feed: the web's way back. */}
        {!router.canGoBack() && (
          <Text style={s.back} onPress={() => router.replace("/(tabs)/feed")} testID="link-back-to-feed">← Back to the feed</Text>
        )}

        {/* A step shared from the path: feedback read, back to the next one. Team only. */}
        {post.project && post.viewerIsTeam && (post.pathStep || post.pathWeek) && <NextStepLink projectId={post.project.id} />}

        <PostCard
          post={post}
          standalone
          onComment={() => { setReplyTo(null); focusBox(); }}
          onNotice={show}
          onDeleted={() => router.back()}
        />
        <View style={s.comments}>
          <Text style={s.title}>Comments{post.commentCount > 0 ? ` · ${post.commentCount}` : ""}</Text>
          <FeedCommentThread
            post={post}
            onReply={(t) => { setReplyTo(t); focusBox(); }}
            onNotice={show}
          />
        </View>

        <ReactionsBox postId={post.id} />
      </ScrollView>
      <CommentBar
        postId={post.id}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        autoFocus={comment === "1"}
        inputRef={inputRef}
        onNotice={show}
        onSent={() => { if (!replyTo) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150); }}
      />
      <NoticeBanner notice={notice} onDismiss={clear} />
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  // The same box as the post above it.
  comments: {
    marginHorizontal: spacing.sm, backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md,
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
  },
  back: { color: colors.textTertiary, fontSize: 12, fontFamily: fontFamily.regular, marginHorizontal: spacing.lg, marginTop: spacing.xs },
  title: { color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold },
});
