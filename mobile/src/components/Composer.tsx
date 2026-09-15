import { useRef, useState } from "react";
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api, uploadFile } from "../api/client";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Avatar, Btn, ListItem, assetUri, errText } from "./ui";
import { Sheet } from "./Sheet";
import { MentionInput, useMe } from "./FeedParts";
import {
  ASK_MAX, COMPOSER_POST_TYPES, MAX_ASKS, MAX_POST_LENGTH, MAX_POST_MEDIA,
  creditLine, postTypeDef, type Mention, type PostType,
} from "./feedModel";

interface MyProject { id: string; title: string; isPrivate: boolean }
interface InboxItem {
  commentId: string;
  content: string;
  author: { id: string; name: string };
  state: "open" | "applied" | "closed";
  task: { id: string; title: string; status: string } | null;
}

/**
 * Writing a post — everything the web composer does: the kind of post (which
 * sets the example and the starters), who it's for, @mentions, photos, and on
 * a project's post the questions you want answered and credit for feedback
 * you acted on.
 *
 * `chrome="screen"` is the full-screen route (app/post/new.tsx), with Post in
 * the navigation header; `chrome="modal"` draws its own top bar.
 */
export function PostComposer({
  chrome, onClose, onPosted, defaultProjectId, defaultType,
}: {
  chrome: "screen" | "modal";
  onClose: () => void;
  onPosted: () => void;
  defaultProjectId?: string;
  defaultType?: string;
}) {
  const qc = useQueryClient();
  const me = useMe();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);

  const initialType = COMPOSER_POST_TYPES.some((t) => t.type === defaultType) ? (defaultType as PostType) : "project_update";
  const [postType, setPostType] = useState<PostType>(initialType);
  const [content, setContent] = useState("");
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [projectId, setProjectId] = useState<string | undefined>(defaultProjectId);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [asks, setAsks] = useState<string[]>([]);
  const [closes, setCloses] = useState<string[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: projects } = useQuery({
    queryKey: ["feed", "my-projects"],
    queryFn: () => api<MyProject[]>("/api/feed/my-projects"),
  });
  const selected = projects?.find((p) => p.id === projectId);

  // Feedback the team put on the board and hasn't credited: this update can close the loop on it.
  const { data: inbox } = useQuery({
    queryKey: ["project", projectId, "feedback"],
    queryFn: () => api<{ items: InboxItem[] }>(`/api/projects/${projectId}/feedback`),
    enabled: !!projectId,
  });
  const creditable = (inbox?.items ?? []).filter((i) => i.state === "applied");
  const credited = closes ?? creditable.filter((i) => i.task?.status === "done").map((i) => i.commentId);

  const def = postTypeDef(postType);

  const publish = useMutation({
    mutationFn: () => api("/api/feed", {
      method: "POST",
      body: {
        postType, content, projectId, mediaUrls, mentions,
        ...(projectId ? { asks: asks.filter((a) => a.trim()), closesCommentIds: credited } : {}),
      },
    }),
    onSuccess: () => {
      setContent(""); setMentions([]); setMediaUrls([]); setAsks([]); setCloses(null); setError(null);
      qc.invalidateQueries({ queryKey: ["feed"] });
      if (projectId) qc.invalidateQueries({ queryKey: ["project", projectId] });
      onPosted();
    },
    onError: (e) => setError(errText(e, "Couldn't post. Try again.")),
  });

  const addPhoto = async () => {
    setError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: "image/*", copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.[0]) return;
      const file = picked.assets[0];
      setUploading(true);
      const path = await uploadFile({ uri: file.uri, name: file.name, mimeType: file.mimeType || "image/jpeg", size: file.size });
      setMediaUrls((prev) => [...prev, path].slice(0, MAX_POST_MEDIA));
    } catch (e) {
      setError(errText(e, "Upload failed."));
    } finally {
      setUploading(false);
    }
  };

  const tagSomeone = () => {
    setContent((c) => (c && !c.endsWith(" ") && !c.endsWith("\n") ? `${c} @` : `${c}@`));
    inputRef.current?.focus();
  };

  const canPost = !!content.trim() && !publish.isPending && !uploading;
  const postButton = (
    <Btn label="Post" small disabled={!canPost} loading={publish.isPending} onPress={() => publish.mutate()} style={{ minWidth: 64, marginRight: Platform.OS === "web" ? spacing.md : 0 }} />
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={chrome === "screen" && Platform.OS === "ios" ? 90 : 0}
      style={s.container}
    >
      {chrome === "screen" ? (
        <Stack.Screen options={{ title: "Share a post", headerRight: () => postButton }} />
      ) : (
        <View style={[s.topBar, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
            <Ionicons name="close" size={26} color={colors.textSecondary} />
          </Pressable>
          <Text style={s.topTitle}>Share a post</Text>
          {postButton}
        </View>
      )}

      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {/* Who's posting, and for what */}
        <View style={s.author}>
          <Avatar name={me.name} uri={me.avatar} size={46} />
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text style={s.name} numberOfLines={1}>{me.name}</Text>
            <Pressable onPress={() => setPicking(true)} style={s.audience} accessibilityLabel="Choose who this post is for">
              <Ionicons name={selected ? (selected.isPrivate ? "lock-closed" : "rocket") : "person"} size={13} color={colors.textSecondary} />
              <Text style={s.audienceText} numberOfLines={1}>{selected ? selected.title : "Just me"}</Text>
              <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
            </Pressable>
          </View>
        </View>

        {/* The kind of post: what makes the box easy to fill */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.types} style={{ marginHorizontal: -spacing.lg }}>
          {COMPOSER_POST_TYPES.map((t) => {
            const on = postType === t.type;
            return (
              <Pressable key={t.type} onPress={() => setPostType(t.type)} style={[s.type, on && s.typeOn]} accessibilityState={{ selected: on }}>
                <Ionicons name={t.icon} size={15} color={on ? colors.primary : colors.textSecondary} />
                <Text style={[s.typeText, on && s.typeTextOn]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Text style={s.hint}>{def.hint}</Text>

        <MentionInput
          inputRef={inputRef}
          value={content}
          onChangeText={setContent}
          mentions={mentions}
          onMentionsChange={setMentions}
          placeholder={def.placeholder}
          maxLength={MAX_POST_LENGTH}
          minHeight={150}
          autoFocus={chrome === "screen"}
          borderless
        />

        {content.length === 0 && (
          <View style={s.starters}>
            {def.starters.map((st) => (
              <Pressable key={st} onPress={() => { setContent(`${st} `); inputRef.current?.focus(); }} style={s.starter}>
                <Text style={s.starterText}>{st}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {mediaUrls.length > 0 && (
          <View style={s.mediaRow}>
            {mediaUrls.map((url) => (
              <View key={url} style={s.thumb}>
                <Image source={{ uri: assetUri(url)! }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                <Pressable onPress={() => setMediaUrls((prev) => prev.filter((u) => u !== url))} style={s.thumbRemove} accessibilityLabel="Remove photo">
                  <Ionicons name="close" size={14} color="#FFFFFF" />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* A project's post: specific questions, and credit for feedback acted on */}
        {projectId && (
          <View style={s.box}>
            <View style={s.boxHead}>
              <Ionicons name="help-circle-outline" size={17} color={colors.primary} />
              <Text style={s.boxTitle}>What do you want feedback on?</Text>
            </View>
            <Text style={s.boxHint}>Vague updates get vague replies. Ask up to {MAX_ASKS} specific questions.</Text>
            {asks.map((a, i) => (
              <View key={i} style={s.askRow}>
                <TextInput
                  value={a}
                  maxLength={ASK_MAX}
                  onChangeText={(v) => setAsks((prev) => prev.map((x, j) => (j === i ? v : x)))}
                  placeholder={i === 0 ? "Would you sign up from this page? What stopped you?" : "Another question"}
                  placeholderTextColor={colors.textTertiary}
                  style={s.askInput}
                />
                <Pressable onPress={() => setAsks((prev) => prev.filter((_, j) => j !== i))} hitSlop={8} accessibilityLabel="Remove question">
                  <Ionicons name="close-circle" size={20} color={colors.textTertiary} />
                </Pressable>
              </View>
            ))}
            {asks.length < MAX_ASKS && (
              <Pressable onPress={() => setAsks((prev) => [...prev, ""])} style={s.addAsk}>
                <Ionicons name="add" size={16} color={colors.primary} />
                <Text style={s.addAskText}>Add a question</Text>
              </Pressable>
            )}

            {creditable.length > 0 && (
              <View style={s.creditBox}>
                <View style={s.boxHead}>
                  <Ionicons name="repeat" size={16} color={colors.success} />
                  <Text style={s.boxTitle}>Close the loop on feedback you acted on</Text>
                </View>
                {creditable.map((i) => {
                  const on = credited.includes(i.commentId);
                  return (
                    <Pressable
                      key={i.commentId}
                      onPress={() => setCloses(on ? credited.filter((x) => x !== i.commentId) : [...credited, i.commentId])}
                      style={s.creditRow}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                    >
                      <Ionicons name={on ? "checkbox" : "square-outline"} size={19} color={on ? colors.primary : colors.textTertiary} />
                      <Text style={s.creditText}>
                        <Text style={{ fontFamily: fontFamily.semibold }}>{i.author.name}</Text>: {i.content.length > 90 ? `${i.content.slice(0, 89)}…` : i.content}
                        <Text style={{ color: colors.textTertiary }}> · task {i.task?.status === "done" ? "done" : "not done yet"}</Text>
                      </Text>
                    </Pressable>
                  );
                })}
                {credited.length > 0 && (
                  <Text style={s.boxHint}>
                    Your post will say "{creditLine(creditable.filter((i) => credited.includes(i.commentId)).map((i) => i.author.name))}" and they'll see it.
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {selected?.isPrivate && (
          <View style={s.warning}>
            <Ionicons name="lock-closed" size={13} color={colors.warning} />
            <Text style={s.warningText}>{selected.title} is private — only its team will see this post.</Text>
          </View>
        )}
        {error && <Text style={s.error}>{error}</Text>}
      </ScrollView>

      {/* Toolbar */}
      <View style={[s.toolbar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <Pressable onPress={addPhoto} disabled={uploading || mediaUrls.length >= MAX_POST_MEDIA} style={s.tool} accessibilityLabel="Add a photo">
          {uploading ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="image-outline" size={23} color={mediaUrls.length >= MAX_POST_MEDIA ? colors.textTertiary : colors.textSecondary} />}
        </Pressable>
        <Pressable onPress={tagSomeone} style={s.tool} accessibilityLabel="Tag someone">
          <Ionicons name="at" size={23} color={colors.textSecondary} />
        </Pressable>
        <Pressable onPress={() => setPicking(true)} style={s.tool} accessibilityLabel="Choose a project">
          <Ionicons name="rocket-outline" size={22} color={colors.textSecondary} />
        </Pressable>
        <View style={{ flex: 1 }} />
        {mentions.length > 0 && <Text style={s.toolMeta}>{mentions.length} tagged</Text>}
        {content.length > MAX_POST_LENGTH * 0.8 && <Text style={s.toolMeta}>{content.length}/{MAX_POST_LENGTH}</Text>}
      </View>

      <Sheet visible={picking} onClose={() => setPicking(false)} title="Who is this post for?" subtitle="Post as yourself, or for a project you're on.">
        <View style={{ marginHorizontal: -spacing.lg }}>
          <ListItem
            icon="person-outline"
            title="Just me"
            onPress={() => { setProjectId(undefined); setCloses(null); setPicking(false); }}
            right={!projectId ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : <View />}
          />
          {(projects ?? []).map((p) => (
            <ListItem
              key={p.id}
              icon={p.isPrivate ? "lock-closed-outline" : "rocket-outline"}
              title={p.title}
              subtitle={p.isPrivate ? "Private — only the team sees it" : undefined}
              onPress={() => { setProjectId(p.id); setCloses(null); setPicking(false); }}
              right={projectId === p.id ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : <View />}
            />
          ))}
          {projects && projects.length === 0 && (
            <Text style={[s.boxHint, { paddingHorizontal: spacing.lg }]}>You're not on a project yet. Start one to post updates for it.</Text>
          )}
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  );
}

/** The composer as a full-screen modal, for screens that open it in place. */
export function Composer({
  visible, onClose, onPosted, defaultProjectId, defaultType,
}: {
  visible: boolean;
  onClose: () => void;
  onPosted: () => void;
  defaultProjectId?: string;
  defaultType?: string;
}) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {visible && (
        <PostComposer chrome="modal" onClose={onClose} onPosted={onPosted} defaultProjectId={defaultProjectId} defaultType={defaultType} />
      )}
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: 1, borderColor: colors.border,
  },
  topTitle: { flex: 1, color: colors.text, fontSize: font.lg, fontFamily: fontFamily.semibold },
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  author: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  name: { color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold },
  audience: {
    flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", maxWidth: "100%",
    borderWidth: 1, borderColor: colors.textTertiary, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3,
  },
  audienceText: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.semibold, flexShrink: 1 },
  types: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  type: {
    flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.surface,
  },
  typeOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  typeText: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.medium },
  typeTextOn: { color: colors.primary, fontFamily: fontFamily.semibold },
  hint: { color: colors.textTertiary, fontSize: 12, fontFamily: fontFamily.regular, marginTop: -4 },
  starters: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  starter: { backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  starterText: { color: colors.textSecondary, fontSize: 12, fontFamily: fontFamily.medium },
  mediaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  thumb: { width: 96, height: 96, borderRadius: radius.sm, overflow: "hidden", backgroundColor: colors.surfaceRaised },
  thumbRemove: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  box: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  boxHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  boxTitle: { color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold, flexShrink: 1 },
  boxHint: { color: colors.textTertiary, fontSize: 12, fontFamily: fontFamily.regular, lineHeight: 17 },
  askRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  askInput: {
    flex: 1, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 9,
    color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular,
  },
  addAsk: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingVertical: 4 },
  addAskText: { color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold },
  creditBox: { borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.sm, gap: spacing.sm },
  creditRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  creditText: { flex: 1, color: colors.text, fontSize: 12, fontFamily: fontFamily.regular, lineHeight: 17 },
  warning: { flexDirection: "row", alignItems: "center", gap: 6 },
  warningText: { color: colors.warning, fontSize: font.sm, fontFamily: fontFamily.regular, flexShrink: 1 },
  error: { color: colors.danger, fontSize: font.sm, fontFamily: fontFamily.regular },
  toolbar: {
    flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.background,
  },
  tool: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20 },
  toolMeta: { color: colors.textTertiary, fontSize: 12, fontFamily: fontFamily.regular, marginLeft: spacing.sm },
});
