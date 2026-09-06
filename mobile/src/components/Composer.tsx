import { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors, font, radius, spacing, postTypeColors } from "../theme";

/**
 * Post types, mirroring shared/feed.ts.
 *
 * Duplicated rather than imported because Metro can't resolve the web app's
 * `@shared` path alias, and shared/feed.ts imports from shared/schema.ts,
 * which pulls in Drizzle. Keep these in sync when adding a type.
 */
const POST_TYPES = [
  { type: "project_update", label: "Project Update", placeholder: "Finished our onboarding flow — signups now take 40 seconds instead of four minutes." },
  { type: "looking_for_help", label: "Looking for Help", placeholder: "Need someone with React experience to help untangle our matching UI." },
  { type: "looking_for_cofounder", label: "Looking for Cofounder", placeholder: "Looking for a technical cofounder. I've got 20 user interviews and a design." },
  { type: "seeking_feedback", label: "Seeking Feedback", placeholder: "Here's our landing page. Would you sign up? If not, what stopped you?" },
  { type: "milestone", label: "Milestone", placeholder: "100 students signed up in the first week. We expected 20." },
  { type: "idea_validation", label: "Idea Validation", placeholder: "Would this be useful, or is it a solution to a non-problem?" },
  { type: "launch", label: "Launch", placeholder: "It's live for anyone at three campuses." },
  { type: "investor_update", label: "Investor Update", placeholder: "Month 3: 420 weekly actives (+38%), 12% paid conversion, 9 months runway." },
] as const;

const MAX_LENGTH = 3000;

export function Composer({
  visible, onClose, onPosted, defaultProjectId,
}: {
  visible: boolean;
  onClose: () => void;
  onPosted: () => void;
  defaultProjectId?: string;
}) {
  const [postType, setPostType] = useState<string>("project_update");
  const [content, setContent] = useState("");
  const [projectId, setProjectId] = useState<string | undefined>(defaultProjectId);
  const [error, setError] = useState<string | null>(null);

  const { data: projects } = useQuery({
    queryKey: ["feed", "my-projects"],
    queryFn: () => api<{ id: string; title: string; isPrivate: boolean }[]>("/api/feed/my-projects"),
    enabled: visible,
  });

  const publish = useMutation({
    mutationFn: () => api("/api/feed", {
      method: "POST",
      body: { postType, content, projectId, mediaUrls: [], mentions: [] },
    }),
    onSuccess: () => {
      setContent("");
      setError(null);
      onPosted();
    },
    onError: (err: any) => setError(err?.message || "Couldn't post. Try again."),
  });

  const def = POST_TYPES.find((t) => t.type === postType)!;
  const selected = projects?.find((p) => p.id === projectId);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.container}
      >
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>New post</Text>
          <Pressable
            onPress={() => publish.mutate()}
            disabled={!content.trim() || publish.isPending}
            hitSlop={8}
          >
            {publish.isPending ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={[styles.post, !content.trim() && styles.postDisabled]}>Post</Text>
            )}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>What kind of post is this?</Text>
          <View style={styles.chips}>
            {POST_TYPES.map((t) => {
              const active = postType === t.type;
              const accent = postTypeColors[t.type] || colors.info;
              return (
                <Pressable
                  key={t.type}
                  onPress={() => setPostType(t.type)}
                  style={[styles.chip, active && { borderColor: accent, backgroundColor: `${accent}22` }]}
                >
                  <Text style={[styles.chipText, active && { color: colors.text, fontWeight: "700" }]}>
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            value={content}
            onChangeText={setContent}
            placeholder={def.placeholder}
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            multiline
            maxLength={MAX_LENGTH}
            textAlignVertical="top"
          />

          {(projects?.length ?? 0) > 0 && (
            <>
              <Text style={styles.label}>Posting for</Text>
              <View style={styles.chips}>
                <Pressable
                  onPress={() => setProjectId(undefined)}
                  style={[styles.chip, !projectId && styles.chipActive]}
                >
                  <Text style={[styles.chipText, !projectId && { color: colors.text, fontWeight: "700" }]}>
                    Just me
                  </Text>
                </Pressable>
                {projects!.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => setProjectId(p.id)}
                    style={[styles.chip, projectId === p.id && styles.chipActive]}
                  >
                    <Text
                      style={[styles.chipText, projectId === p.id && { color: colors.text, fontWeight: "700" }]}
                    >
                      {p.isPrivate ? "🔒 " : ""}{p.title}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {selected?.isPrivate && (
            <Text style={styles.warning}>
              {selected.title} is private — only its team will see this post.
            </Text>
          )}

          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingTop: spacing.xxl + spacing.md, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { color: colors.text, fontSize: font.lg, fontWeight: "700" },
  cancel: { color: colors.textSecondary, fontSize: font.base },
  post: { color: colors.primary, fontSize: font.base, fontWeight: "700" },
  postDisabled: { color: colors.textTertiary },
  body: { padding: spacing.lg, gap: spacing.md },
  label: { color: colors.textSecondary, fontSize: font.sm, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: `${colors.primary}22` },
  chipText: { color: colors.textSecondary, fontSize: font.sm },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md, color: colors.text,
    fontSize: font.base, minHeight: 160, lineHeight: 22,
  },
  warning: { color: colors.warning, fontSize: font.sm },
  error: { color: colors.danger, fontSize: font.sm },
});
