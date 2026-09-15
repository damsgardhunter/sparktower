import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, Share, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_URL, api } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { colors, font, fontFamily, radius, shadow, spacing } from "../../src/theme";
import { Avatar, Btn, Empty, ErrorNote, Icon, IconButton, Loading, assetUri, errText, timeAgo, type IconName } from "../../src/components/ui";
import { Pill, weekLabel } from "../../src/components/MoreKit";
import { ReportSheet } from "../../src/components/FeedParts";

const MAX = 2000;

/**
 * One weekly check-in and its feedback thread — the web's /c/:id, which the
 * Needs feedback queue sends people to. Read the week, then leave a comment.
 */
export default function CheckInDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["check-in", id],
    queryFn: () => api<any>(`/api/check-ins/${id}`),
    enabled: !!id,
    retry: false,
  });
  const commentsKey = ["check-in", id, "comments"];
  const { data: comments, isLoading: commentsLoading } = useQuery({
    queryKey: commentsKey,
    queryFn: () => api<any[]>(`/api/projects/${data.projectId}/comments?targetType=check_in&targetId=${id}`),
    enabled: !!data?.projectId,
  });

  const post = useMutation({
    mutationFn: () => api<any[]>(`/api/projects/${data.projectId}/comments`, { method: "POST", body: { targetType: "check_in", targetId: id, content: draft.trim() } }),
    onSuccess: (fresh) => {
      setDraft(""); setError(null);
      if (Array.isArray(fresh)) qc.setQueryData(commentsKey, fresh); else qc.invalidateQueries({ queryKey: commentsKey });
      qc.invalidateQueries({ queryKey: ["check-in", id] });
      qc.invalidateQueries({ queryKey: ["needs-feedback"] });
    },
    onError: (e) => setError(errText(e, "Couldn't post that. Try again.")),
  });
  const remove = useMutation({
    mutationFn: (commentId: string) => api(`/api/project-comments/${commentId}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: commentsKey }); qc.invalidateQueries({ queryKey: ["check-in", id] }); },
    onError: (e) => setError(errText(e, "Couldn't delete that.")),
  });

  if (isLoading) return <Loading />;
  if (isError || !data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: "center" }}>
        <Stack.Screen options={{ title: "Check-in" }} />
        <Empty icon="document-outline" title="Check-in not found" body="It may have been removed, or it belongs to a private project." />
      </View>
    );
  }

  const list = comments ?? [];
  const logo = assetUri(data.projectLogo);
  const nameOf = (c: any) => c.profile?.displayName || c.author?.firstName || "A builder";
  const share = () => Share.share({ message: `${data.projectTitle}: ${data.goal}\nNext: ${data.nextStep}\n${API_URL}/c/${data.id}` }).catch(() => {});

  return (
    <>
      <Stack.Screen options={{ title: weekLabel(data.weekStart) || "Check-in", headerRight: () => <IconButton name="share-outline" label="Share" onPress={share} /> }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90} style={{ flex: 1, backgroundColor: colors.canvas }}>
        <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            {logo ? <Image source={{ uri: logo }} style={{ width: 44, height: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }} /> : null}
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }} onPress={() => router.push(`/project/${data.projectId}`)}>{data.projectTitle}</Text>
              <Text style={small}>{weekLabel(data.weekStart)}</Text>
            </View>
          </View>

          <View style={card}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Avatar name={data.author?.name} uri={data.author?.avatarUrl} size={32} />
              <Text style={[body, { flex: 1, fontFamily: fontFamily.semibold }]}>{data.author?.name}</Text>
              <Pill label={data.visibility === "public" ? "Public" : "Unlisted"} icon={data.visibility === "public" ? "globe-outline" : "link-outline"} color={colors.textSecondary} />
            </View>
            {data.commentCount > 0
              ? <Pill label="Got feedback" icon="checkmark-circle" color={colors.success} />
              : data.needsFeedback ? <Pill label="Wants feedback" icon="chatbubble-outline" color={colors.warning} /> : null}
            <Block label="The goal" text={data.goal} strong />
            <Block label="What shipped" text={data.proof} />
            {data.blocker ? <Block label="In the way" text={data.blocker} icon="warning-outline" color={colors.warning} /> : null}
            <Block label="Next step" text={data.nextStep} icon="arrow-forward" color={colors.primary} />
          </View>

          <View style={card}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name="chatbubbles-outline" size={17} color={colors.primary} />
              <Text style={[body, { fontFamily: fontFamily.semibold, fontSize: font.base }]}>
                {list.length === 0 ? "Feedback" : `${list.length} ${list.length === 1 ? "comment" : "comments"}`}
              </Text>
            </View>
            <TextInput
              value={draft} onChangeText={(t) => setDraft(t.slice(0, MAX))} multiline
              placeholder={`Tell ${data.author?.name ?? "them"} what you think — what's working, what you'd push on.`}
              placeholderTextColor={colors.textTertiary}
              style={{ minHeight: 88, textAlignVertical: "top", backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular }}
            />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={small}>{draft.trim().length}/{MAX}</Text>
              <Btn label="Post" icon="send" small disabled={!draft.trim()} loading={post.isPending} onPress={() => post.mutate()} />
            </View>
            {error && <ErrorNote message={error} />}

            {commentsLoading ? <Loading /> : list.length === 0 ? (
              <Text style={small}>No feedback yet. The first person to read this can change that.</Text>
            ) : list.map((c) => (
              <View key={c.id} style={{ flexDirection: "row", gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
                <Avatar name={nameOf(c)} uri={c.profile?.avatarUrl} size={32} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={small}><Text style={{ color: colors.text, fontFamily: fontFamily.semibold }}>{nameOf(c)}</Text> · {timeAgo(c.createdAt)}</Text>
                  <Text style={body}>{c.content}</Text>
                </View>
                <IconButton name="flag-outline" size={16} label="Report" color={colors.textTertiary} onPress={() => setReportId(c.id)} />
                {(user?.id === c.authorId || data.viewerCanModerate) && (
                  <IconButton name="trash-outline" size={16} label="Delete" color={colors.textTertiary} onPress={() => remove.mutate(c.id)} />
                )}
              </View>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <ReportSheet visible={!!reportId} onClose={() => setReportId(null)} targetType="comment" targetId={reportId ?? ""} />
    </>
  );
}

function Block({ label, text, strong, icon, color }: { label: string; text: string; strong?: boolean; icon?: IconName; color?: string }) {
  return (
    <View style={{ gap: 3 }}>
      <Text style={{ color: colors.textTertiary, fontSize: 11, fontFamily: fontFamily.semibold, letterSpacing: 0.6, textTransform: "uppercase" }}>{label}</Text>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {icon ? <Icon name={icon} size={15} color={color ?? colors.textSecondary} /> : null}
        <Text style={[body, { flex: 1 }, strong && { fontSize: font.base, fontFamily: fontFamily.semibold }, color && icon === "warning-outline" ? { color } : null]}>{text}</Text>
      </View>
    </View>
  );
}

const card = { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.md, ...shadow.card } as const;
const body = { color: colors.text, fontSize: font.sm, lineHeight: 20, fontFamily: fontFamily.regular } as const;
const small = { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular } as const;
