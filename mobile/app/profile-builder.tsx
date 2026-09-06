import { useState } from "react";
import { Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, uploadFile } from "../src/api/client";
import { colors, spacing } from "../src/theme";
import {
  Body, Btn, Card, Chip, Cost, ErrorNote, H2, Label, Meta,
  Row, Screen, errText,
} from "../src/components/ui";

/**
 * Nova résumé evaluator.
 *
 * Evaluation runs with `apply: false` first so the user reviews what Nova
 * extracted before it overwrites their profile — saving is destructive.
 */
export default function ProfileBuilder() {
  const router = useRouter();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ["resume-status"],
    queryFn: () => api<any>("/api/profile/resume-status"),
  });

  const attach = useMutation({
    mutationFn: (objectPath: string) =>
      api<any>("/api/profile/attach-resume", { method: "POST", body: { resumeUrl: objectPath } }),
    onSuccess: async (r) => {
      await refetchStatus();
      if (!r.readable) setError(r.note || "That file can't be read. Try a PDF.");
      else setError(null);
    },
    onError: (e) => setError(errText(e, "Couldn't save that file.")),
  });

  /** Presigned upload, then attach the resulting object path to the profile. */
  const pickAndUpload = async () => {
    setError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "text/plain"],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const file = picked.assets[0];

      setUploading(true);
      const objectPath = await uploadFile({
        uri: file.uri,
        name: file.name,
        mimeType: file.mimeType || "application/pdf",
        size: file.size,
      });
      attach.mutate(objectPath);
    } catch (e: any) {
      setError(errText(e, "Upload failed."));
    } finally {
      setUploading(false);
    }
  };

  const evaluate = useMutation({
    mutationFn: () => api<any>("/api/profile/evaluate-resume", { method: "POST", body: { apply: false } }),
    onSuccess: (r) => { setDraft(r.draft); setError(null); qc.invalidateQueries({ queryKey: ["subscription"] }); },
    onError: (e) => { setError(errText(e, "Nova couldn't read that.")); refetchStatus(); },
  });

  const apply = useMutation({
    mutationFn: () => api("/api/profile/apply-resume-draft", { method: "POST", body: { draft } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subscription"] });
      qc.invalidateQueries({ queryKey: ["resume-status"] });
      router.back();
    },
    onError: (e) => setError(errText(e, "Couldn't save your profile.")),
  });

  const busy = uploading || attach.isPending;
  const canRead = status?.hasResume && status.readable;

  // --- Review the draft ---
  if (draft) {
    return (
      <>
        <Stack.Screen options={{ title: "Review" }} />
        <Screen>
          <Card accent={colors.primary}>
            <Label>Nova's read</Label>
            <Body>{draft.novaSummary}</Body>
          </Card>

          {draft.headline ? (
            <Card><Label>Headline</Label><Body style={{ fontWeight: "700" }}>{draft.headline}</Body></Card>
          ) : null}

          {(draft.experience ?? []).length > 0 && (
            <Card>
              <Label>Experience ({draft.experience.length})</Label>
              {draft.experience.map((e: any, i: number) => (
                <View key={i} style={{ gap: 2, marginTop: i ? spacing.sm : 0 }}>
                  <Body style={{ fontWeight: "700" }}>{e.title}{e.company ? ` · ${e.company}` : ""}</Body>
                  <Meta>{[e.startDate, e.current ? "Present" : e.endDate].filter(Boolean).join(" – ")}</Meta>
                  {e.description ? <Meta>{e.description}</Meta> : null}
                </View>
              ))}
            </Card>
          )}

          {(draft.education ?? []).length > 0 && (
            <Card>
              <Label>Education ({draft.education.length})</Label>
              {draft.education.map((e: any, i: number) => (
                <View key={i} style={{ gap: 2, marginTop: i ? spacing.sm : 0 }}>
                  <Body style={{ fontWeight: "700" }}>{e.school}</Body>
                  <Meta>{[e.degree, e.field].filter(Boolean).join(", ")}</Meta>
                </View>
              ))}
            </Card>
          )}

          {(draft.portfolioProjects ?? []).length > 0 && (
            <Card>
              <Label>Other work ({draft.portfolioProjects.length})</Label>
              {draft.portfolioProjects.map((pr: any, i: number) => (
                <View key={i} style={{ gap: 2, marginTop: i ? spacing.sm : 0 }}>
                  <Body style={{ fontWeight: "700" }}>{pr.name}</Body>
                  {pr.description ? <Meta>{pr.description}</Meta> : null}
                </View>
              ))}
            </Card>
          )}

          {(draft.skills ?? []).length > 0 && (
            <Card>
              <Label>Skills ({draft.skills.length})</Label>
              <Row wrap gap={spacing.xs}>
                {draft.skills.map((sk: string) => <Chip key={sk} label={sk} small />)}
              </Row>
            </Card>
          )}

          {error && <ErrorNote message={error} />}
          <Meta>Saving replaces your current experience, education, projects, and skills.</Meta>
          <Btn label="Save to my profile" loading={apply.isPending} onPress={() => apply.mutate()} />
          <Btn label="Back" variant="ghost" small onPress={() => setDraft(null)} />
        </Screen>
      </>
    );
  }

  // --- Upload / evaluate ---
  return (
    <>
      <Stack.Screen options={{ title: "Build my profile" }} />
      <Screen>
        <Card>
          <H2>Let Nova build your profile</H2>
          <Meta>
            Upload your résumé and Nova fills in your experience, education, projects,
            and skills. It only uses what's actually in the file — no invented employers.
          </Meta>
        </Card>

        {canRead ? (
          <Card>
            <Row center gap={spacing.md}>
              <Text style={{ fontSize: 30 }}>📄</Text>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "700" }}>Résumé ready</Body>
                <Meta>Nova will read this. Upload a different file to replace it.</Meta>
              </View>
            </Row>
            <Btn label="Replace file" variant="outline" small loading={busy} onPress={pickAndUpload} />
          </Card>
        ) : (
          <Card>
            <View style={{ alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg }}>
              <Text style={{ fontSize: 34 }}>📤</Text>
              <Body style={{ fontWeight: "700" }}>Upload your résumé</Body>
              <Meta>PDF works best · max 10MB</Meta>
              <Btn label={busy ? "Uploading…" : "Choose a file"} loading={busy} onPress={pickAndUpload} />
            </View>
            {status?.note ? <Meta style={{ color: colors.warning }}>{status.note}</Meta> : null}
          </Card>
        )}

        {error && <ErrorNote message={error} />}

        <Row center gap={spacing.sm}>
          <Btn label="Evaluate my résumé" disabled={!canRead || busy}
            loading={evaluate.isPending} onPress={() => evaluate.mutate()} style={{ flex: 1 }} />
          <Cost credits={4} />
        </Row>
      </Screen>
    </>
  );
}
