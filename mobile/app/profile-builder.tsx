import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, uploadFile } from "../src/api/client";
import { useEntitlementsQuery } from "../src/hooks/useEntitlements";
import { colors, font, fontFamily, radius, spacing } from "../src/theme";
import {
  Body, Btn, Chip, Cost, Divider, ErrorNote, Icon, Meta, NovaGradient, Row, Screen, Section, errText, type IconName,
} from "../src/components/ui";

/**
 * Nova résumé evaluator — the web's ProfileResumePanel
 * (client/src/components/profile-resume-panel.tsx).
 *
 * Evaluation runs with `apply: false` first so the user reviews what Nova
 * extracted before it overwrites their profile — saving is destructive.
 */
export default function ProfileBuilder() {
  const router = useRouter();
  const qc = useQueryClient();
  const ent = useEntitlementsQuery();
  const [draft, setDraft] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ["resume-status"],
    queryFn: () => api<any>("/api/profile/resume-status"),
  });
  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<any>("/api/profile").catch(() => null),
  });
  const hasContent = (profile?.experience?.length ?? 0) > 0 || (profile?.education?.length ?? 0) > 0;
  const cost: number = ent.creditCosts?.resumeEvaluation ?? 4;
  const cantAfford = !ent.isLoading && !ent.isUnlimited && ent.creditsRemaining < cost;

  const attach = useMutation({
    mutationFn: (objectPath: string) =>
      api<any>("/api/profile/attach-resume", { method: "POST", body: { resumeUrl: objectPath } }),
    onSuccess: async (r) => {
      await refetchStatus();
      void qc.invalidateQueries({ queryKey: ["profile"] });
      setError(r.readable ? null : r.note || "That file can't be read. Try exporting it as a PDF.");
    },
    onError: (e) => setError(errText(e, "Couldn't save that file.")),
  });

  /** Presigned upload, then attach the resulting object path to the profile. */
  const pickAndUpload = async () => {
    setError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "text/plain", "text/markdown"],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const file = picked.assets[0];
      if (file.size && file.size > 10 * 1024 * 1024) { setError("That file is over 10MB."); return; }

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
    onSuccess: (r) => { setDraft(r.draft); setError(null); void qc.invalidateQueries({ queryKey: ["subscription"] }); },
    onError: (e) => { setError(errText(e, "Nova couldn't read that.")); void refetchStatus(); },
  });

  const apply = useMutation({
    mutationFn: () => api("/api/profile/apply-resume-draft", { method: "POST", body: { draft } }),
    onSuccess: () => {
      for (const key of [["subscription"], ["resume-status"], ["profile"], ["profile-summary"], ["user"], ["me"]]) {
        void qc.invalidateQueries({ queryKey: key });
      }
      if (router.canGoBack()) router.back(); else router.replace("/(tabs)/profile");
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
        <Screen canvas contentStyle={{ padding: 0, gap: spacing.sm, paddingBottom: spacing.xxl * 2 }}>
          <Section>
            <Row gap={spacing.sm} center>
              <Icon name="checkmark-circle" size={20} color={colors.success} />
              <Text style={{ fontSize: font.base, fontFamily: fontFamily.semibold, color: colors.text }}>Here's what Nova found</Text>
            </Row>
            <Meta style={{ fontSize: font.sm }}>Review it, then save it to your profile.</Meta>
            {draft.novaSummary ? (
              <View style={{ borderRadius: radius.md, backgroundColor: colors.primarySoft, padding: spacing.md, gap: 4 }}>
                <Row center gap={6}>
                  <Icon name="sparkles" size={13} color={colors.primary} />
                  <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: colors.primary, textTransform: "uppercase", letterSpacing: 0.5 }}>Nova's read</Text>
                </Row>
                <Body>{draft.novaSummary}</Body>
              </View>
            ) : null}
            {draft.headline ? (
              <View style={{ gap: 2 }}>
                <Meta>Headline</Meta>
                <Body style={{ fontFamily: fontFamily.semibold, fontSize: font.base }}>{draft.headline}</Body>
              </View>
            ) : null}
          </Section>

          <DraftList title="Experience" icon="briefcase-outline" items={draft.experience} render={(e: any) => (
            <>
              <Body style={{ fontFamily: fontFamily.semibold }}>{e.title}</Body>
              {e.company ? <Body>{e.company}</Body> : null}
              <Meta>{[e.startDate || "?", e.current ? "Present" : e.endDate || "?"].join(" – ")}</Meta>
              {e.description ? <Body muted>{e.description}</Body> : null}
            </>
          )} />
          <DraftList title="Education" icon="school-outline" items={draft.education} render={(e: any) => (
            <>
              <Body style={{ fontFamily: fontFamily.semibold }}>{e.school}</Body>
              <Meta>{[[e.degree, e.field].filter(Boolean).join(", "), e.endYear ? `${e.startYear || ""}–${e.endYear}` : null].filter(Boolean).join(" · ")}</Meta>
            </>
          )} />
          <DraftList title="Other work" icon="folder-open-outline" items={draft.portfolioProjects} render={(p: any) => (
            <>
              <Body style={{ fontFamily: fontFamily.semibold }}>{p.name}</Body>
              {p.description ? <Body muted>{p.description}</Body> : null}
              {(p.technologies?.length ?? 0) > 0 && <Row wrap gap={4} style={{ marginTop: 4 }}>{p.technologies.map((t: string) => <Chip key={t} label={t} small />)}</Row>}
            </>
          )} />
          {(draft.skills ?? []).length > 0 && (
            <Section title={`Skills (${draft.skills.length})`}>
              <Row wrap gap={spacing.sm}>{draft.skills.map((sk: string) => <Chip key={sk} label={sk} />)}</Row>
            </Section>
          )}

          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
            {error && <ErrorNote message={error} />}
            {hasContent && (
              <Row gap={6} center>
                <Icon name="warning-outline" size={15} color={colors.warning} />
                <Meta style={{ color: colors.warning, flex: 1, fontSize: font.sm }}>Saving replaces your current experience, education, projects, and skills.</Meta>
              </Row>
            )}
            <Btn label="Save to my profile" icon="checkmark" loading={apply.isPending} onPress={() => apply.mutate()} />
            <Btn label="Back" variant="ghost" onPress={() => setDraft(null)} />
          </View>
        </Screen>
      </>
    );
  }

  // --- Upload / evaluate ---
  return (
    <>
      <Stack.Screen options={{ title: "Build with résumé" }} />
      <Screen canvas contentStyle={{ padding: 0, gap: spacing.sm, paddingBottom: spacing.xxl * 2 }}>
        <Section>
          <Row gap={spacing.md}>
            <NovaGradient style={{ width: 44, height: 44, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" }}>
              <Icon name="color-wand" size={22} color="#FFFFFF" />
            </NovaGradient>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: font.lg, fontFamily: fontFamily.bold, color: colors.text }}>
                {hasContent ? "Refresh your profile with Nova" : "Let Nova build your profile"}
              </Text>
              <Meta style={{ fontSize: font.sm, lineHeight: 18 }}>
                {canRead
                  ? "Nova reads the résumé on your profile and fills in your experience, education, projects, and skills."
                  : "Upload your résumé and Nova fills in your experience, education, projects, and skills."}
              </Meta>
            </View>
          </Row>
        </Section>

        <Section title="Your résumé">
          {canRead ? (
            <Row center gap={spacing.md}>
              <View style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
                <Icon name="document-text" size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Body style={{ fontFamily: fontFamily.semibold }}>Résumé ready</Body>
                <Meta>Nova will read this. Upload a different file to replace it.</Meta>
              </View>
              <Btn label="Replace" icon="cloud-upload-outline" variant="outline" small loading={busy} onPress={pickAndUpload} />
            </Row>
          ) : (
            <View style={{ alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.md }}>
              <Icon name="cloud-upload-outline" size={34} color={colors.primary} />
              <Body style={{ fontFamily: fontFamily.semibold }}>Upload your résumé</Body>
              <Meta>PDF works best · max 10MB</Meta>
              <Btn label={busy ? "Uploading…" : "Choose a file"} small loading={busy} onPress={pickAndUpload} />
            </View>
          )}
          {status?.hasResume && !status.readable && status.note ? (
            <Row gap={6}>
              <Icon name="warning-outline" size={15} color={colors.warning} />
              <Meta style={{ color: colors.warning, flex: 1, fontSize: font.sm }}>{status.note}</Meta>
            </Row>
          ) : null}
          <Row gap={6}>
            <Icon name="shield-checkmark-outline" size={15} color={colors.textTertiary} />
            <Meta style={{ flex: 1, fontSize: font.sm }}>Nova only uses what's actually in the file. It won't invent employers, dates, or skills.</Meta>
          </Row>
        </Section>

        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          {error && <ErrorNote message={error} />}
          <Row center gap={spacing.sm}>
            <Btn label={evaluate.isPending ? "Nova is reading your résumé…" : "Evaluate my résumé"} icon="sparkles"
              disabled={!canRead || busy || cantAfford} loading={evaluate.isPending} onPress={() => evaluate.mutate()} style={{ flex: 1 }} />
            <Cost credits={cost} />
          </Row>
          {cantAfford && <Meta style={{ color: colors.danger }}>Needs {cost} credits, you have {ent.creditsRemaining}.</Meta>}
        </View>
      </Screen>
    </>
  );
}

function DraftList({ title, icon, items, render }: { title: string; icon: IconName; items?: any[]; render: (item: any) => ReactNode }) {
  const list = items ?? [];
  if (!list.length) return null;
  return (
    <Section title={`${title} (${list.length})`}>
      {list.map((item, i) => (
        <View key={i} style={{ gap: spacing.md }}>
          {i > 0 && <Divider style={{ marginLeft: 56 }} />}
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <View style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" }}>
              <Icon name={icon} size={22} color={colors.textSecondary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>{render(item)}</View>
          </View>
        </View>
      ))}
    </Section>
  );
}
