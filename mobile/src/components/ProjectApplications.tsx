/**
 * Joining a project: the applicant's form, and the owner's side of it —
 * pending applications to accept or reject, and the questions applicants
 * answer. The same flow and endpoints as client/src/pages/project-dashboard.tsx.
 */
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, uploadFile } from "../api/client";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Avatar, Body, Btn, ErrorNote, Field, Icon, Meta, Row, errText } from "./ui";
import { Block, Tag } from "./ProjectBits";
import { FormGroup, ProjectFormSheet } from "./ProjectFormSheet";
import { PRE_PROMPTED_QUESTIONS } from "../projectData";
import type { Notice } from "./Sheet";

export interface AppQuestion { id: string; question: string; required: boolean }

const newId = () => `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** Apply to join: an optional note, the owner's questions, an optional résumé. */
export function ApplySheet({ visible, onClose, project, notify }: {
  visible: boolean;
  onClose: () => void;
  project: { id: string; title: string; applicationQuestions?: AppQuestion[] | null };
  notify: (n: Notice) => void;
}) {
  const qc = useQueryClient();
  const questions = (project.applicationQuestions || []) as AppQuestion[];
  const [message, setMessage] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [resume, setResume] = useState<{ path: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = questions.filter((q) => q.required && !(answers[q.id] || "").trim());

  const apply = useMutation({
    mutationFn: () => api(`/api/projects/${project.id}/apply`, {
      method: "POST",
      body: {
        resumeUrl: resume?.path || undefined,
        answers: Object.entries(answers).filter(([, a]) => a.trim()).map(([questionId, answer]) => ({
          questionId, question: questions.find((q) => q.id === questionId)?.question || "", answer,
        })),
        message: message.trim() || undefined,
      },
    }),
    onSuccess: () => {
      setMessage(""); setAnswers({}); setResume(null); setError(null);
      void qc.invalidateQueries({ queryKey: ["user-applications"] });
      onClose();
      notify({ text: "Application submitted. The project owner will review it.", tone: "success" });
    },
    onError: (e) => setError(errText(e, "Couldn't submit your application.")),
  });

  const pickResume = async () => {
    setError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const file = picked.assets[0];
      if (!/\.(pdf|docx?)$/i.test(file.name)) { setError("Please upload a PDF, DOC, or DOCX."); return; }
      setUploading(true);
      const path = await uploadFile({ uri: file.uri, name: file.name, mimeType: file.mimeType || "application/pdf", size: file.size });
      setResume({ path, name: file.name });
    } catch (e) {
      setError(errText(e, "Upload failed."));
    } finally {
      setUploading(false);
    }
  };

  return (
    <ProjectFormSheet
      visible={visible}
      onClose={onClose}
      title={`Apply to ${project.title}`}
      subtitle="The project owner reviews every application."
      action="Submit application"
      actionIcon="send"
      actionDisabled={missing.length > 0 || uploading}
      actionLoading={apply.isPending}
      onAction={() => apply.mutate()}
      footerNote={error ? <ErrorNote message={error} /> : missing.length ? <Meta>Answer the required questions to submit.</Meta> : null}
    >
      <FormGroup label="Message (optional)">
        <Field value={message} onChangeText={setMessage} multiline placeholder="Tell the project owner why you'd be a great fit…" />
      </FormGroup>
      {questions.map((q, i) => (
        <FormGroup key={q.id} label={`${i + 1}. ${q.question}${q.required ? " *" : ""}`}>
          <Field value={answers[q.id] || ""} onChangeText={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} placeholder="Your answer…" />
        </FormGroup>
      ))}
      <FormGroup label="Resume (optional)" hint="PDF, DOC, or DOCX.">
        <Row center gap={spacing.sm}>
          {resume ? (
            <Row center gap={6} style={{ flex: 1 }}>
              <Icon name="document-text-outline" size={18} color={colors.primary} />
              <Text numberOfLines={1} style={{ flex: 1, fontSize: font.sm, color: colors.text, fontFamily: fontFamily.medium }}>{resume.name}</Text>
              <Icon name="checkmark-circle" size={18} color={colors.success} />
            </Row>
          ) : <Meta style={{ flex: 1, fontSize: font.sm }}>No file attached</Meta>}
          <Btn small variant="outline" icon="cloud-upload-outline" label={resume ? "Replace" : "Upload"} loading={uploading} onPress={pickResume} />
        </Row>
      </FormGroup>
    </ProjectFormSheet>
  );
}

/** The owner's editor for the questions applicants answer. */
export function QuestionsSheet({ visible, onClose, projectId, initial, notify }: {
  visible: boolean;
  onClose: () => void;
  projectId: string;
  initial: AppQuestion[];
  notify: (n: Notice) => void;
}) {
  const qc = useQueryClient();
  const [list, setList] = useState<AppQuestion[]>(initial);
  const [custom, setCustom] = useState("");
  useEffect(() => { if (visible) setList(initial); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/application-questions`, { method: "POST", body: { questions: list } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
      onClose();
      notify({ text: "Application questions saved.", tone: "success" });
    },
    onError: (e) => notify({ text: errText(e, "Couldn't save the questions."), tone: "error" }),
  });

  const add = (question: string) => setList((l) => [...l, { id: newId(), question, required: false }]);

  return (
    <ProjectFormSheet
      visible={visible}
      onClose={onClose}
      title="Application questions"
      subtitle="What applicants answer when they apply to join."
      action="Save questions"
      actionLoading={save.isPending}
      onAction={() => save.mutate()}
    >
      {list.length > 0 && (
        <FormGroup label="Your questions" hint="Tap Optional / Required to switch.">
          {list.map((q, i) => (
            <Row key={q.id} center gap={spacing.sm} style={{ backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.sm }}>
              <Meta>{i + 1}.</Meta>
              <Text style={{ flex: 1, fontSize: font.sm, color: colors.text, fontFamily: fontFamily.regular }}>{q.question}</Text>
              <Pressable hitSlop={6} onPress={() => setList((l) => l.map((x) => x.id === q.id ? { ...x, required: !x.required } : x))}>
                <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: q.required ? colors.danger : colors.textTertiary }}>
                  {q.required ? "Required" : "Optional"}
                </Text>
              </Pressable>
              <Pressable hitSlop={6} accessibilityLabel="Remove question" onPress={() => setList((l) => l.filter((x) => x.id !== q.id))}>
                <Icon name="close-circle" size={20} color={colors.textTertiary} />
              </Pressable>
            </Row>
          ))}
        </FormGroup>
      )}
      <FormGroup label="Add a custom question">
        <Row gap={spacing.sm} center>
          <View style={{ flex: 1 }}>
            <Field value={custom} onChangeText={setCustom} placeholder="Type a question…" />
          </View>
          <Btn small label="Add" disabled={!custom.trim()} onPress={() => { add(custom.trim()); setCustom(""); }} />
        </Row>
      </FormGroup>
      <FormGroup label="Pre-made questions">
        <View style={{ gap: spacing.xs }}>
          {PRE_PROMPTED_QUESTIONS.filter((q) => !list.some((x) => x.question === q)).map((q) => (
            <Pressable key={q} onPress={() => add(q)} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 }, pressed && { opacity: 0.6 }]}>
              <Icon name="add-circle-outline" size={18} color={colors.primary} />
              <Text style={{ flex: 1, fontSize: font.sm, color: colors.text, fontFamily: fontFamily.regular }}>{q}</Text>
            </Pressable>
          ))}
        </View>
      </FormGroup>
    </ProjectFormSheet>
  );
}

/** Pending applications on the owner's own page, with accept and reject. */
export function PendingApplications({ projectId, applications, questions, onEditQuestions, notify }: {
  projectId: string;
  applications: any[];
  questions: AppQuestion[];
  onEditQuestions: () => void;
  notify: (n: Notice) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const pending = applications.filter((a) => a.status === "pending");
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["project", projectId, "applications"] });
    void qc.invalidateQueries({ queryKey: ["project", projectId, "members"] });
  };
  const decide = useMutation({
    mutationFn: ({ id, verdict }: { id: string; verdict: "accept" | "reject" }) => api(`/api/applications/${id}/${verdict}`, { method: "POST" }),
    onSuccess: (_r, v) => { refresh(); notify({ text: v.verdict === "accept" ? "Application accepted. They're on the team." : "Application rejected.", tone: v.verdict === "accept" ? "success" : "info" }); },
    onError: (e) => notify({ text: errText(e, "Couldn't update that application."), tone: "error" }),
  });

  return (
    <Block title={pending.length ? `Applications · ${pending.length}` : "Applications"} icon="mail-unread-outline" action="Questions" onAction={onEditQuestions}>
      {pending.length === 0 ? (
        <Meta style={{ fontSize: font.sm }}>
          No pending applications. {questions.length ? `Applicants answer ${questions.length} question${questions.length === 1 ? "" : "s"}.` : "Add questions for applicants to answer."}
        </Meta>
      ) : pending.map((app) => {
        const name = app.profile?.displayName || app.user?.firstName || "Applicant";
        return (
          <View key={app.id} style={{ gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderSubtle }}>
            <Pressable onPress={() => router.push(`/user/${app.userId}` as any)}>
              <Row center gap={spacing.sm}>
                <Avatar name={name} uri={app.profile?.avatarUrl} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>{name}</Text>
                  {app.profile?.headline ? <Meta numberOfLines={1}>{app.profile.headline}</Meta> : null}
                </View>
              </Row>
            </Pressable>
            {app.message ? <Body>{app.message}</Body> : null}
            {(app.answers || []).map((a: any, i: number) => (
              <View key={i}>
                <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: colors.textSecondary }}>{a.question}</Text>
                <Body>{a.answer}</Body>
              </View>
            ))}
            {app.resumeUrl ? <Tag icon="document-text-outline" label="Resume attached" tone="primary" /> : null}
            <Row gap={spacing.sm}>
              <Btn small label="Accept" icon="checkmark" loading={decide.isPending && decide.variables?.id === app.id && decide.variables?.verdict === "accept"}
                onPress={() => decide.mutate({ id: app.id, verdict: "accept" })} />
              <Btn small variant="outline" label="Reject" loading={decide.isPending && decide.variables?.id === app.id && decide.variables?.verdict === "reject"}
                onPress={() => decide.mutate({ id: app.id, verdict: "reject" })} />
            </Row>
          </View>
        );
      })}
    </Block>
  );
}
