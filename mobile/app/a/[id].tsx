/**
 * /a/:id — a published path artifact, the growth loop's front door
 * (client/src/pages/public-artifact.tsx). What one step on a real project
 * produced, where that project is on its path, and one clear way in: start
 * your own path on the same goal, or explore this project first.
 */
import { Image, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { API_URL, api } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { colors, font, fontFamily, radius, shadow, spacing } from "../../src/theme";
import { Avatar, Btn, Empty, Icon, IconButton, Loading, NovaGradient, assetUri } from "../../src/components/ui";
import { shareText } from "../../src/components/manage/bits";
import { rememberReturnPath } from "../../src/pendingDestination";

interface PublicArtifact {
  id: string;
  title: string;
  summary: string;
  body: string;
  files: { path: string; purpose?: string }[];
  tags: string[];
  publishedAt: string | null;
  views: number;
  postId: string | null;
  project: { id: string; title: string; oneLiner: string | null; logoUrl: string | null };
  path: { goal: string; goalLabel: string; subcategory: string | null; progress: { done: number; total: number } | null; next: string | null };
  author: { id: string; name: string; avatarUrl: string | null };
}

export default function PublicArtifactPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["public-artifact", id],
    queryFn: () => api<PublicArtifact>(`/api/public/artifacts/${id}`),
    enabled: !!id,
    retry: false,
    staleTime: Infinity,
  });

  if (isLoading) return <><Stack.Screen options={{ title: "Artifact" }} /><Loading /></>;
  if (isError || !data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: "center" }}>
        <Stack.Screen options={{ title: "Artifact" }} />
        <Empty icon="document-outline" title="This artifact isn't published" body="It may have been taken down, or its project is private." action="Back" onAction={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/feed" as any))} />
      </View>
    );
  }

  /*
   * This page is one of the two the app shows signed out, and both of its
   * calls to action need an account. Pushed straight, AuthGate replaces them
   * with sign-in and the destination is lost — the reader lands on the feed
   * having asked to start a path on a specific goal, which is exactly the
   * conversion this page exists for. So write the route down first and let the
   * entry point (or the end of onboarding) finish the journey.
   */
  const go = (path: string) => {
    if (user) { router.push(path as any); return; }
    void rememberReturnPath(path);
    router.push("/(auth)/sign-in" as any);
  };

  const url = `${API_URL}/a/${data.id}`;
  const share = () => void shareText(`${data.title} — ${data.project.title}\n${url}`);
  const progress = data.path.progress;
  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const logo = assetUri(data.project.logoUrl);

  return (
    <>
      <Stack.Screen options={{ title: "Artifact", headerRight: () => <IconButton name="share-outline" label="Share" onPress={share} /> }} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl * 2 }}>
        <View style={card} testID="public-artifact">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="compass-outline" size={14} color={colors.primary} />
            <Text style={small}>A step on the path to <Text style={{ color: colors.text, fontFamily: fontFamily.semibold }}>{data.path.goalLabel}</Text></Text>
          </View>
          <Text style={{ fontSize: font.xl, lineHeight: 28, fontFamily: fontFamily.bold, color: colors.text, letterSpacing: -0.3 }} testID="text-artifact-title">{data.title}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Avatar name={data.author.name} uri={data.author.avatarUrl} size={24} />
            <Text style={small} onPress={() => router.push(`/user/${data.author.id}` as any)}>
              <Text style={{ color: colors.text, fontFamily: fontFamily.medium }}>{data.author.name}</Text>
              {data.publishedAt ? ` · ${new Date(data.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : ""}
              {data.views ? ` · ${data.views} view${data.views === 1 ? "" : "s"}` : ""}
            </Text>
          </View>
          {data.tags.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {data.tags.map((t) => (
                <View key={t} style={{ backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 }}>
                  <Text style={{ fontSize: font.xs, color: colors.textSecondary, fontFamily: fontFamily.medium }}>#{t}</Text>
                </View>
              ))}
            </View>
          )}
          <Text selectable style={{ fontSize: font.sm + 1, lineHeight: 22, color: colors.text, fontFamily: fontFamily.regular }} testID="text-artifact-body">{data.body}</Text>
          {data.files.length > 0 && (
            <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.md, gap: 4 }}>
              <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.semibold, color: colors.text }}>What was built</Text>
              {data.files.map((f) => (
                <View key={f.path} style={{ flexDirection: "row", gap: 6 }}>
                  <Icon name="code-slash-outline" size={14} color={colors.textTertiary} />
                  <Text style={[small, { flex: 1 }]}><Text style={{ fontFamily: "Courier", color: colors.text }}>{f.path}</Text>{f.purpose ? ` — ${f.purpose}` : ""}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* The backlink: the project and where it is on its path. */}
        <View style={card} testID="artifact-project">
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            {logo
              ? <Image source={{ uri: assetUri(logo)! }} style={{ width: 44, height: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }} />
              : <View style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.primarySoft }} />}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: font.base, fontFamily: fontFamily.bold, color: colors.text }} numberOfLines={1}>{data.project.title}</Text>
              {!!data.project.oneLiner && <Text style={small} numberOfLines={2}>{data.project.oneLiner}</Text>}
            </View>
          </View>
          {progress && (
            <View style={{ gap: 4 }}>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceRaised, overflow: "hidden" }}>
                <View style={{ width: `${pct}%`, height: "100%", backgroundColor: colors.primary }} />
              </View>
              <Text style={small}>{progress.done} of {progress.total} milestones{data.path.next ? ` · next: ${data.path.next}` : ""}</Text>
            </View>
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            <Btn small variant="outline" icon="compass-outline" label="Explore this project and its path" onPress={() => go(`/project/${data.project.id}`)} />
            {user && data.postId && <Btn small variant="ghost" icon="chatbubbles-outline" label="See the discussion" onPress={() => router.push(`/post/${data.postId}` as any)} />}
          </View>
        </View>

        {/* The way in. */}
        <View style={[card, { borderColor: `${colors.primary}55`, overflow: "hidden", padding: 0, gap: 0 }]}>
          <NovaGradient style={{ height: 4 }} />
          <View style={{ padding: spacing.md, gap: spacing.sm }}>
            <Text style={{ fontSize: font.base, fontFamily: fontFamily.bold, color: colors.text }}>Start your own path to {data.path.goalLabel.toLowerCase()}</Text>
            <Text style={{ fontSize: font.sm, lineHeight: 20, color: colors.textSecondary, fontFamily: fontFamily.regular }}>
              SparkTower breaks the goal into steps, Nova helps with each one, and what you finish becomes something you can publish — like this.
            </Text>
            <Btn icon="arrow-forward" label="Start a project on this path" onPress={() => go(`/project/new?goal=${encodeURIComponent(data.path.goal)}${data.path.subcategory ? `&subcategory=${encodeURIComponent(data.path.subcategory)}` : ""}`)} style={{ alignSelf: "flex-start" }} />
          </View>
        </View>
      </ScrollView>
    </>
  );
}

const card = { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.md, ...shadow.card } as const;
const small = { color: colors.textTertiary, fontSize: font.xs + 1, lineHeight: 17, fontFamily: fontFamily.regular } as const;
