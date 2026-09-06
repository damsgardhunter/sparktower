import { useEffect, useState } from "react";
import { Image, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, API_URL, getAccessToken } from "../../src/api/client";
import { colors, radius, spacing } from "../../src/theme";
import {
  Body, Btn, Card, Chip, Cost, Empty, ErrorNote, Field, H2, Label, Loading,
  Meta, Row, Screen, errText, plain, timeAgo,
} from "../../src/components/ui";

/**
 * AI storyboard generator.
 *
 * Storyboards are private to the account that generated them, and their frames
 * stream from an owner-checked route — so images need the Bearer token as a
 * header rather than being plain public URLs.
 */

const STYLES = [
  { value: "professional", label: "Professional", blurb: "Clean, corporate, investor-ready" },
  { value: "futuristic", label: "Futuristic", blurb: "Neon, holographic, high-tech" },
  { value: "funny", label: "Funny", blurb: "Playful, bright, exaggerated" },
  { value: "cartoon", label: "Cartoon", blurb: "Illustrated, vibrant, hand-drawn" },
] as const;

/** RN can send headers with an image request, which the frame route requires. */
function useAuthHeader() {
  const [header, setHeader] = useState<Record<string, string> | undefined>();
  useEffect(() => {
    getAccessToken().then((t) => setHeader(t ? { Authorization: `Bearer ${t}` } : undefined));
  }, []);
  return header;
}

function SceneImage({ path, headers, width }: { path: string; headers?: Record<string, string>; width: number }) {
  if (!path || !headers) {
    return <View style={{ width, height: width * 0.6, borderRadius: radius.md, backgroundColor: colors.surfaceRaised }} />;
  }
  return (
    <Image
      source={{ uri: `${API_URL}${path}`, headers }}
      style={{ width, height: width * 0.6, borderRadius: radius.md, backgroundColor: colors.surfaceRaised }}
      resizeMode="cover"
    />
  );
}

export default function Storyboards() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const headers = useAuthHeader();

  const [style, setStyle] = useState<string>("professional");
  const [prompt, setPrompt] = useState("");
  const [useAiImages, setUseAiImages] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Card width minus the Screen and Card padding.
  const frameWidth = width - spacing.md * 2 - spacing.md * 2;

  const { data: project } = useQuery({
    queryKey: ["project", id],
    queryFn: () => api<any>(`/api/projects/${id}`),
    enabled: !!id,
  });

  const { data: list, isLoading } = useQuery({
    queryKey: ["storyboards", id],
    queryFn: () => api<any[]>(`/api/projects/${id}/storyboards`),
    enabled: !!id,
  });

  const { data: open } = useQuery({
    queryKey: ["storyboard", openId],
    queryFn: () => api<any>(`/api/storyboards/${openId}`),
    enabled: !!openId,
  });

  const generate = useMutation({
    mutationFn: () =>
      api<any>(`/api/projects/${id}/generate-video`, {
        method: "POST",
        body: { style, prompt: prompt.trim() || undefined, useAiImages },
      }),
    onSuccess: (r) => {
      setError(null);
      setPrompt("");
      setOpenId(r.storyboardId);
      qc.invalidateQueries({ queryKey: ["storyboards", id] });
      qc.invalidateQueries({ queryKey: ["subscription"] });
    },
    onError: (e) => setError(errText(e, "Nova couldn't build that storyboard.")),
  });

  // --- Viewing one storyboard ---
  if (openId) {
    return (
      <>
        <Stack.Screen options={{ title: "Storyboard" }} />
        <Screen>
          <Btn label="← All storyboards" variant="ghost" small onPress={() => setOpenId(null)} />
          {!open ? (
            <Loading label="Opening…" />
          ) : (
            <>
              <Card accent={colors.primary}>
                <Row between center>
                  <Label>{STYLES.find((s) => s.value === open.style)?.label || open.style}</Label>
                  <Meta>{timeAgo(open.createdAt)}</Meta>
                </Row>
                {open.prompt ? <Body muted>“{open.prompt}”</Body> : null}
                <Meta>Private to you · {open.scenes?.length || 0} scenes · {open.imageModel || "vector"}</Meta>
              </Card>

              {(open.scenes || []).map((scene: any, i: number) => (
                <Card key={i}>
                  <Row between center>
                    <Label>Scene {i + 1}</Label>
                  </Row>
                  <SceneImage path={scene.imageUrl} headers={headers} width={frameWidth} />
                  {scene.caption ? <Body style={{ fontWeight: "700" }}>{plain(scene.caption)}</Body> : null}
                  {scene.prompt ? <Meta>{plain(scene.prompt)}</Meta> : null}
                </Card>
              ))}

              {open.storyboard ? (
                <Card>
                  <Label>Full treatment</Label>
                  <Body muted>{plain(open.storyboard)}</Body>
                </Card>
              ) : null}
            </>
          )}
        </Screen>
      </>
    );
  }

  // --- Generator + library ---
  return (
    <>
      <Stack.Screen options={{ title: "AI storyboard" }} />
      <Screen>
        <Card>
          <H2>Generate a storyboard</H2>
          <Meta>
            Nova reads {project?.title ? `${project.title}'s` : "your project's"} one-liner,
            mission, and brief, then storyboards a 30-second showcase in five scenes.
            Storyboards stay private to you and never land in the media gallery.
          </Meta>
        </Card>

        <Card>
          <Label>Style</Label>
          <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
            {STYLES.map((s) => (
              <Pressable
                key={s.value}
                onPress={() => setStyle(s.value)}
                style={{
                  borderWidth: 1,
                  borderColor: style === s.value ? colors.primary : colors.border,
                  backgroundColor: style === s.value ? `${colors.primary}18` : "transparent",
                  borderRadius: radius.md,
                  padding: spacing.md,
                  gap: 2,
                }}
              >
                <Body style={{ fontWeight: "700" }}>{s.label}</Body>
                <Meta>{s.blurb}</Meta>
              </Pressable>
            ))}
          </View>
        </Card>

        <Card>
          <Field
            label="Anything specific? (optional)"
            value={prompt}
            onChangeText={setPrompt}
            placeholder="Open on the problem, end on the signup screen"
            multiline
            maxLength={500}
          />
          <Row between center>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Body style={{ fontWeight: "700" }}>AI-rendered frames</Body>
              <Meta>
                {useAiImages
                  ? "Slower, but the frames look like real shots."
                  : "Fast vector illustrations instead."}
              </Meta>
            </View>
            <Chip
              label={useAiImages ? "On" : "Off"}
              active={useAiImages}
              onPress={() => setUseAiImages(!useAiImages)}
            />
          </Row>
        </Card>

        {error && <ErrorNote message={error} />}

        <Row center gap={spacing.sm}>
          <Btn
            label={generate.isPending ? "Storyboarding…" : "Generate storyboard"}
            loading={generate.isPending}
            onPress={() => generate.mutate()}
            style={{ flex: 1 }}
          />
          <Cost credits={5} />
        </Row>
        {generate.isPending && <Meta>Five frames takes a minute or two. Keep the app open.</Meta>}

        <Label>Your storyboards</Label>
        {isLoading ? (
          <Loading />
        ) : !list?.length ? (
          <Empty
            title="No storyboards yet"
            body="Generate one above. Try a couple of different styles — they read very differently."
          />
        ) : (
          list.map((s) => (
            <Card key={s.id} onPress={() => setOpenId(s.id)}>
              <Row center gap={spacing.md}>
                {s.thumbnail && headers ? (
                  <Image
                    source={{ uri: `${API_URL}${s.thumbnail}`, headers }}
                    style={{ width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised }}
                  />
                ) : (
                  <View style={{ width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 24 }}>🎬</Text>
                  </View>
                )}
                <View style={{ flex: 1, gap: 2 }}>
                  <Body style={{ fontWeight: "700" }}>
                    {STYLES.find((x) => x.value === s.style)?.label || s.style}
                  </Body>
                  <Meta numberOfLines={1}>{s.prompt || `${s.sceneCount} scenes`}</Meta>
                  <Meta>{timeAgo(s.createdAt)}</Meta>
                </View>
              </Row>
            </Card>
          ))
        )}
      </Screen>
    </>
  );
}
