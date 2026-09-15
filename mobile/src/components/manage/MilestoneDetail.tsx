/**
 * One path milestone, opened from the map: what it asks for, what's written
 * on it, Nova's work, how it got done, and its loops and steps with the same
 * controls. The native counterpart of client/src/components/path-milestone.tsx.
 */
import { useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, spacing } from "../../theme";
import { Body, Btn, Divider, Icon, Loading, Meta, Row } from "../ui";
import { Area, EditorSheet, Line, Overline, Tick, Well, useNotify } from "./bits";
import { WorkView } from "./WorkView";
import {
  ACTOR_LABEL, mkey, shortDay, useRefreshPath,
  type Actor, type IntakeQuestion, type VerificationTier, type WorkKind, type WorkRow,
} from "./shared";

type How = "not-done" | "verified" | "nova-recognised" | "you-marked" | "carried" | "done";
interface TaskView { taskId: string; title: string; status: string; completedAt: string | null; how: How; actor: Actor; answer: string | null; work: WorkRow | null }
interface Detail {
  phase: { id: string; title: string; optional: boolean };
  milestone: { id: string; title: string; description: string; actor: Actor; estimateMinutes: number | null; tier: VerificationTier; expandsFrom?: string; intake?: IntakeQuestion[]; work?: WorkKind; prefill?: "resume" };
  isSource: boolean;
  task: TaskView | null;
  loops: TaskView[];
  sourceLoops: { taskId: string; title: string; status: string; expanded: boolean }[];
  steps: (TaskView & { loopTaskId: string | null })[];
}

const HOW: Record<How, string> = {
  "not-done": "Not done yet",
  verified: "Verified by the codebase audit",
  "nova-recognised": "Nova recognised this as already done",
  "you-marked": "You marked this done",
  carried: "Carried over from another path",
  done: "Done",
};

export function MilestoneSheet({ projectId, backboneId, title, onClose }: { projectId: string; backboneId: string | null; title: string; onClose: () => void }) {
  return (
    <EditorSheet visible={!!backboneId} onClose={onClose} title={title} subtitle="Milestone">
      {backboneId && <MilestoneDetail projectId={projectId} backboneId={backboneId} />}
    </EditorSheet>
  );
}

function MilestoneDetail({ projectId, backboneId }: { projectId: string; backboneId: string }) {
  const refresh = useRefreshPath(projectId);
  const { fail } = useNotify();
  const { data, isLoading, error } = useQuery({
    queryKey: mkey(projectId, "path", "milestones", backboneId),
    queryFn: () => api<Detail>(`/api/projects/${projectId}/path/milestones/${backboneId}`),
  });
  const setStatus = useMutation({
    mutationFn: (b: { taskId: string; status: "done" | "todo" }) => api(`/api/kanban/${b.taskId}`, { method: "PATCH", body: { status: b.status } }),
    onSuccess: refresh, onError: (e) => fail(e),
  });
  const [form, setForm] = useState<{ kind: "loop" | "step"; loopTaskId: string | null; title: string; description: string } | null>(null);
  const add = useMutation({
    mutationFn: (f: NonNullable<typeof form>) => f.kind === "loop"
      ? api(`/api/projects/${projectId}/path/loops`, { method: "POST", body: { backboneId, title: f.title, description: f.description } })
      : api(`/api/projects/${projectId}/path/steps`, { method: "POST", body: { backboneId, loopTaskId: f.loopTaskId, title: f.title, description: f.description } }),
    onSuccess: () => { setForm(null); refresh(); }, onError: (e) => fail(e),
  });

  if (isLoading) return <View style={{ height: 200 }}><Loading /></View>;
  if (!data) return <Meta>{(error as any)?.message ?? "Couldn't load this milestone."}</Meta>;
  const { milestone, task, steps, loops, sourceLoops, isSource } = data;

  const addForm = (f: NonNullable<typeof form>) => (
    <View style={{ gap: spacing.sm }}>
      <Line value={f.title} onChangeText={(t) => setForm({ ...f, title: t })} placeholder={f.kind === "loop" ? "Name the loop" : "Name the step"} />
      <Area value={f.description} onChangeText={(t) => setForm({ ...f, description: t })} rows={3} placeholder={f.kind === "loop" ? "Its 3–5 steps, if you know them" : "What exists when it's done"} />
      <Row gap={spacing.sm}>
        <Btn small label="Add" disabled={!f.title.trim()} loading={add.isPending} onPress={() => add.mutate(f)} />
        <Btn small variant="ghost" label="Cancel" onPress={() => setForm(null)} />
      </Row>
    </View>
  );

  const block = (t: TaskView, opts: { authored?: string; label?: string; own?: boolean }) => (
    <View key={t.taskId} style={{ gap: spacing.sm }}>
      {opts.label && <Row center gap={6}><Tick done={t.status === "done"} size={16} /><Text style={{ flex: 1, fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{opts.label}</Text></Row>}
      {!!opts.authored && <Body muted>{opts.authored}</Body>}
      <Row center gap={5}>
        <Icon name={t.actor === "user-does" ? "person-outline" : "sparkles"} size={12} color={t.actor === "user-does" ? colors.textTertiary : colors.primary} />
        <Meta style={{ flex: 1 }}>{ACTOR_LABEL[t.actor]} · {HOW[t.how]}{t.completedAt && t.status === "done" ? ` · ${shortDay(t.completedAt)}` : ""}</Meta>
      </Row>
      {!!t.answer && (
        <Well>
          <Overline>What's written</Overline>
          <Text selectable style={{ fontSize: font.sm, color: colors.text, lineHeight: 20, fontFamily: fontFamily.regular }}>{t.answer}</Text>
        </Well>
      )}
      {!t.answer && t.status === "done" && !t.work && (
        <Meta>Nothing written here yet. "Re-evaluate where I'm at" fills this in from your brief and audit where it can; otherwise have Nova draft it.</Meta>
      )}
      <WorkView projectId={projectId} taskId={t.taskId} actor={t.actor} work={t.work} done={t.status === "done"} compact
        intake={opts.own ? milestone.intake : undefined} workKind={opts.own ? milestone.work : undefined} prefill={opts.own ? milestone.prefill : undefined} />
      {t.status === "done"
        ? <Btn small variant="ghost" icon="refresh" label="Reopen" onPress={() => setStatus.mutate({ taskId: t.taskId, status: "todo" })} style={{ alignSelf: "flex-start" }} />
        : <Btn small variant="ghost" icon="checkmark-circle-outline" label="Mark done" onPress={() => setStatus.mutate({ taskId: t.taskId, status: "done" })} style={{ alignSelf: "flex-start" }} />}
    </View>
  );

  const indent = (node: React.ReactNode, key: string) => (
    <View key={key} style={{ borderLeftWidth: 2, borderColor: colors.border, paddingLeft: spacing.md }}>{node}</View>
  );

  return (
    <View style={{ gap: spacing.lg }}>
      <Meta>{data.phase.title}</Meta>
      {task ? block(task, { authored: milestone.description, own: true }) : <Body muted>{milestone.description}</Body>}

      {(loops.length > 0 || isSource) && (
        <View style={{ gap: spacing.md }}>
          <Divider />
          <Overline>Loops · {loops.filter((l) => l.status === "done").length}/{loops.length}</Overline>
          {loops.map((l) => indent(block(l, { label: l.title }), l.taskId))}
          {form?.kind === "loop" ? addForm(form) : (
            <Btn small variant="ghost" icon="add" label="Add another loop" onPress={() => setForm({ kind: "loop", loopTaskId: null, title: "", description: "" })} style={{ alignSelf: "flex-start" }} />
          )}
        </View>
      )}

      {(steps.length > 0 || milestone.expandsFrom) && (
        <View style={{ gap: spacing.md }}>
          <Divider />
          <Overline>Steps · {steps.filter((s) => s.status === "done").length}/{steps.length}</Overline>
          {sourceLoops.length > 0 ? sourceLoops.map((l) => {
            const own = steps.filter((s) => s.loopTaskId === l.taskId);
            return (
              <View key={l.taskId} style={{ gap: spacing.sm }}>
                <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{l.title} <Text style={{ color: colors.textTertiary, fontFamily: fontFamily.regular }}>· {own.filter((s) => s.status === "done").length}/{own.length}</Text></Text>
                {own.map((s) => indent(block(s, { label: s.title }), s.taskId))}
                {form?.kind === "step" && form.loopTaskId === l.taskId ? addForm(form) : (
                  <Btn small variant="ghost" icon="add" label="Add a step" onPress={() => setForm({ kind: "step", loopTaskId: l.taskId, title: "", description: "" })} style={{ alignSelf: "flex-start" }} />
                )}
              </View>
            );
          }) : (
            <>
              {steps.map((s) => indent(block(s, { label: s.title }), s.taskId))}
              {form?.kind === "step" ? addForm(form) : (
                <Btn small variant="ghost" icon="add" label="Add a step" onPress={() => setForm({ kind: "step", loopTaskId: null, title: "", description: "" })} style={{ alignSelf: "flex-start" }} />
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}
