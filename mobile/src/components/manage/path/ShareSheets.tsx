/**
 * Sharing what the path produced — the three dialogs of
 * client/src/components/continue-path-card.tsx, as sheets on the manager:
 *
 *   ShareStepSheet      one finished step, as a progress post with asks
 *   WeeklyUpdateSheet   every unshared step this week, ticked, in one post
 *   PublishArtifactSheet the step's output as a public page (/a/:id) and a post
 *
 * What comes back in the comments is feedback on the step, and each comment
 * is a notification that brings the builder back to the next one.
 */
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../../theme";
import { Btn, Icon, Loading, Meta, Row, errText } from "../../ui";
import { Sheet } from "../../Sheet";
import { Tag, shareText, useNotify } from "../bits";
import { ARTIFACT_MAX_TAGS, ARTIFACT_TITLE_MAX, ARTIFACT_TITLE_MIN, MAX_ASKS, mkey, useRefreshPath, webUrl } from "../shared";

/** After a share: the path's lastDone/weekly change, the feed and the home card too. */
function useAfterShare(projectId: string) {
  const qc = useQueryClient();
  const refresh = useRefreshPath(projectId);
  return () => {
    refresh();
    qc.invalidateQueries({ queryKey: ["feed"] });
    qc.invalidateQueries({ queryKey: ["project", projectId] });
  };
}

const input = {
  borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 9,
  color: colors.text, fontSize: font.sm + 1, fontFamily: fontFamily.regular, backgroundColor: colors.surfaceRaised,
} as const;

function Footer({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, paddingTop: 2 }}>{children}</View>;
}

function ErrorLine({ text }: { text: string | null }) {
  return text ? <Text style={{ color: colors.danger, fontSize: font.sm, fontFamily: fontFamily.regular }}>{text}</Text> : null;
}

export function ShareStepSheet({ projectId, projectTitle, step, onClose }: {
  projectId: string; projectTitle: string; step: { taskId: string; title: string }; onClose: () => void;
}) {
  const router = useRouter();
  const { notify } = useNotify();
  const after = useAfterShare(projectId);
  const [content, setContent] = useState(`Just finished "${step.title}" on ${projectTitle}. `);
  const [asks, setAsks] = useState<string[]>([""]);
  const [error, setError] = useState<string | null>(null);
  const share = useMutation({
    mutationFn: () => api<{ id?: string }>("/api/feed", {
      method: "POST",
      body: { postType: "project_update", projectId, content: content.trim(), asks: asks.filter((a) => a.trim()), pathTaskId: step.taskId },
    }),
    onSuccess: (post) => {
      after();
      onClose();
      notify("Shared — replies land in your notifications and your project's feedback inbox.", "success",
        post?.id ? { label: "See post", onPress: () => router.push(`/post/${post.id}` as any) } : undefined);
    },
    onError: (e) => setError(errText(e, "Couldn't share that.")),
  });
  return (
    <Sheet visible onClose={onClose} title="Share this step for feedback" subtitle="Post what you finished, with a question or two. Feedback on it comes back to you.">
      <TextInput value={content} onChangeText={setContent} multiline style={[input, { minHeight: 96, textAlignVertical: "top" }]} testID="input-share-step-content" />
      {asks.map((a, i) => (
        <TextInput
          key={i} value={a} placeholderTextColor={colors.textTertiary} style={input}
          onChangeText={(v) => setAsks((prev) => prev.map((x, j) => (j === i ? v : x)))}
          placeholder={i === 0 ? "What do you want feedback on? e.g. Is this pricing clear?" : "Another question"}
          testID={`input-share-step-ask-${i}`}
        />
      ))}
      {asks.length < MAX_ASKS && (
        <Pressable onPress={() => setAsks((p) => [...p, ""])} hitSlop={6}>
          <Text style={{ color: colors.primary, fontSize: font.xs + 1, fontFamily: fontFamily.semibold }}>+ Another question</Text>
        </Pressable>
      )}
      <ErrorLine text={error} />
      <Footer>
        <Btn small variant="ghost" label="Not now" onPress={onClose} />
        <Btn small icon="share-social-outline" label="Share" disabled={!content.trim()} loading={share.isPending} onPress={() => share.mutate()} />
      </Footer>
    </Sheet>
  );
}

export function WeeklyUpdateSheet({ projectId, projectTitle, steps, onClose }: {
  projectId: string; projectTitle: string; steps: { taskId: string; title: string }[]; onClose: () => void;
}) {
  const router = useRouter();
  const { notify } = useNotify();
  const after = useAfterShare(projectId);
  const [picked, setPicked] = useState<string[]>(steps.map((s) => s.taskId));
  const [content, setContent] = useState(`This week on ${projectTitle}:\n${steps.map((s) => `- ${s.title}`).join("\n")}\n\n`);
  const [ask, setAsk] = useState("");
  const [error, setError] = useState<string | null>(null);
  const post = useMutation({
    mutationFn: () => api<{ id?: string }>("/api/feed", {
      method: "POST",
      body: { postType: "project_update", projectId, content: content.trim(), asks: ask.trim() ? [ask.trim()] : [], pathStepIds: picked },
    }),
    onSuccess: (p) => {
      after();
      onClose();
      notify("Weekly update posted — replies land in your notifications and your feedback inbox.", "success",
        p?.id ? { label: "See post", onPress: () => router.push(`/post/${p.id}` as any) } : undefined);
    },
    onError: (e) => setError(errText(e, "Couldn't post that.")),
  });
  return (
    <Sheet visible onClose={onClose} title="This week's progress" subtitle="What you finished on the path, ready to post. Ask something specific and the feedback comes back to you.">
      <ScrollView style={{ maxHeight: 150 }} contentContainerStyle={{ gap: 6 }}>
        {steps.map((s) => {
          const on = picked.includes(s.taskId);
          return (
            <Pressable
              key={s.taskId} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
              onPress={() => setPicked((p) => (on ? p.filter((x) => x !== s.taskId) : [...p, s.taskId]))}
              style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }} testID={`weekly-step-${s.taskId}`}
            >
              <Icon name={on ? "checkbox" : "square-outline"} size={18} color={on ? colors.primary : colors.textTertiary} />
              <Text style={{ flex: 1, color: colors.text, fontSize: font.sm + 1, fontFamily: fontFamily.regular }}>{s.title}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <TextInput value={content} onChangeText={setContent} multiline style={[input, { minHeight: 110, maxHeight: 180, textAlignVertical: "top" }]} testID="input-weekly-content" />
      <TextInput value={ask} onChangeText={setAsk} placeholder="What do you want feedback on this week?" placeholderTextColor={colors.textTertiary} style={input} testID="input-weekly-ask" />
      <ErrorLine text={error} />
      <Footer>
        <Btn small variant="ghost" label="Not now" onPress={onClose} />
        <Btn small icon="share-social-outline" label="Post update" disabled={!content.trim() || !picked.length} loading={post.isPending} onPress={() => post.mutate()} />
      </Footer>
    </Sheet>
  );
}

interface DraftArtifact {
  id: string; title: string; summary: string; body: string; files: { path: string }[]; tags: string[];
  visibility: string; publishedPostId: string | null;
}

/**
 * Opened on a step that's already out, the sheet lands on its published page
 * rather than the form: the link, and the button that takes it down again.
 */
export function PublishArtifactSheet({ projectId, step, onClose }: {
  projectId: string; step: { taskId: string; title: string }; onClose: () => void;
}) {
  const router = useRouter();
  const { notify } = useNotify();
  const after = useAfterShare(projectId);
  const [title, setTitle] = useState(step.title);
  const [tags, setTags] = useState("");
  const [ask, setAsk] = useState("");
  const [published, setPublished] = useState<{ url: string; id: string; postId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Nova assembles the artifact from the step's own answer when the sheet opens.
  const draft = useQuery({
    queryKey: mkey(projectId, "path", "artifact", step.taskId),
    queryFn: async () => {
      const a = await api<DraftArtifact>(`/api/projects/${projectId}/path/tasks/${step.taskId}/artifact`, { method: "POST" });
      setTitle(a.title);
      if (a.tags?.length) setTags(a.tags.join(", "));
      return a;
    },
    retry: false,
    staleTime: Infinity,
  });
  const publish = useMutation({
    mutationFn: () => api<{ url: string; postId: string; artifact: { id: string } }>(`/api/artifacts/${draft.data!.id}/publish`, {
      method: "POST",
      body: { title: title.trim(), tags: tags.split(/[,\s]+/).filter(Boolean), asks: ask.trim() ? [ask.trim()] : [] },
    }),
    onSuccess: (r) => { setError(null); setPublished({ url: webUrl(r.url), id: r.artifact?.id ?? draft.data!.id, postId: r.postId }); after(); },
    onError: (e) => setError(errText(e, "Couldn't publish that.")),
  });
  // The other direction. The feed post is a separate thing, deleted from the feed.
  const unpublish = useMutation({
    mutationFn: () => api(`/api/artifacts/${draft.data!.id}/unpublish`, { method: "POST" }),
    onSuccess: () => { after(); onClose(); notify("The page is down — the link leads nowhere now.", "success"); },
    onError: (e) => setError(errText(e, "Couldn't take it down.")),
  });

  // Just published, or opened on a step published earlier — the same page either way.
  const live = published ?? (draft.data?.visibility === "public"
    ? { url: webUrl(`/a/${draft.data.id}`), id: draft.data.id, postId: draft.data.publishedPostId ?? "" }
    : null);

  const share = async () => {
    if (!live) return;
    const r = await shareText(`${title.trim()}\n${live.url}`);
    if (r === "copied") notify("Link copied");
  };

  const takeDown = () => Alert.alert(
    "Take this page down?",
    "The page stops being reachable. Anyone who opens the link — including people who already have it — gets nothing. Your post about it stays on the feed until you delete it, and you can publish the page again later.",
    [{ text: "Leave it up", style: "cancel" }, { text: "Take it down", style: "destructive", onPress: () => unpublish.mutate() }],
  );

  return (
    <Sheet
      visible onClose={onClose}
      title={live ? "Published" : "Publish what this step produced"}
      subtitle={live ? "It has a public page anyone can open, and a post on the feed." : "A public page with a title and tags, linked back to your project and its path, plus a feed post."}
    >
      {live ? (
        <View style={{ gap: spacing.md }}>
          <View style={[input, { backgroundColor: colors.surfaceRaised }]}>
            <Text selectable style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular }} testID="text-artifact-url">{live.url}</Text>
          </View>
          <Row gap={spacing.sm} wrap>
            <Btn small variant="outline" icon="share-outline" label="Share link" onPress={share} />
            <Btn small variant="outline" icon="open-outline" label="Open the page" onPress={() => { onClose(); router.push(`/a/${live.id}` as any); }} />
            {!!live.postId && <Btn small variant="ghost" icon="chatbubbles-outline" label="See the post" onPress={() => { onClose(); router.push(`/post/${live.postId}` as any); }} />}
          </Row>
          <ErrorLine text={error} />
          <Footer>
            <Btn small variant="danger" icon="eye-off-outline" label="Take the page down" loading={unpublish.isPending} onPress={takeDown} testID="button-unpublish-artifact" />
            <Btn small label="Done" onPress={onClose} />
          </Footer>
        </View>
      ) : draft.isLoading ? (
        <View style={{ height: 120 }}><Loading label="Nova is putting it together…" /></View>
      ) : draft.isError ? (
        <>
          <ErrorLine text={errText(draft.error, "Couldn't make that artifact.")} />
          <Footer><Btn small variant="ghost" label="Close" onPress={onClose} /></Footer>
        </>
      ) : draft.data ? (
        <>
          <View style={{ gap: 4 }}>
            <Meta>Public title</Meta>
            <TextInput value={title} onChangeText={setTitle} maxLength={ARTIFACT_TITLE_MAX} style={input} testID="input-artifact-title" />
          </View>
          <View style={{ gap: 4 }}>
            <Meta>Tags (up to {ARTIFACT_MAX_TAGS}, comma separated)</Meta>
            <TextInput value={tags} onChangeText={setTags} placeholder="pricing, landing-page" placeholderTextColor={colors.textTertiary} autoCapitalize="none" style={input} testID="input-artifact-tags" />
          </View>
          <ScrollView style={{ maxHeight: 160, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised }} contentContainerStyle={{ padding: spacing.sm + 2 }}>
            <Text style={{ fontSize: font.xs + 1, lineHeight: 18, color: colors.text, fontFamily: fontFamily.regular }}>
              {draft.data.body || draft.data.summary}
            </Text>
            {draft.data.files.length > 0 && <View style={{ marginTop: 6 }}><Tag label={`${draft.data.files.length} file${draft.data.files.length === 1 ? "" : "s"} built`} /></View>}
          </ScrollView>
          <TextInput value={ask} onChangeText={setAsk} placeholder="Ask the feed something (optional)" placeholderTextColor={colors.textTertiary} style={input} testID="input-artifact-ask" />
          <ErrorLine text={error} />
          <Footer>
            <Btn small variant="ghost" label="Not now" onPress={onClose} />
            <Btn small icon="globe-outline" label="Publish" disabled={title.trim().length < ARTIFACT_TITLE_MIN} loading={publish.isPending} onPress={() => publish.mutate()} />
          </Footer>
        </>
      ) : null}
    </Sheet>
  );
}
