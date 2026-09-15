/**
 * The product as its loops, each with its state and steps. The web draws a
 * horizontal tree (client/src/components/loop-tree.tsx); on a phone the same
 * nodes stack as cards, and any loop or step opens to Nova's work on it.
 */
import { useState } from "react";
import { Alert, Platform, Pressable, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Body, Btn, Icon, Loading, Meta, Row } from "../ui";
import { Area, Bubble, Line, Overline, Tag, Tick, Well, useNotify } from "./bits";
import { WorkView } from "./WorkView";
import {
  LOOP_TYPE_COLOR, LOOP_TYPE_INFO, addableLoopTypes, mkey, useRefreshPath,
  type Actor, type LoopNode, type LoopTreeData, type LoopType, type WorkRow,
} from "./shared";

const STATE: Record<LoopNode["state"], { label: string; color: string }> = {
  unwritten: { label: "Not written", color: colors.textTertiary },
  written: { label: "Written", color: colors.primary },
  planned: { label: "Steps ready", color: colors.primary },
  building: { label: "Building", color: colors.warning },
  built: { label: "Built", color: colors.success },
};

function NodeWork({ projectId, taskId, actor, done }: { projectId: string; taskId: string; actor: Actor; done: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: mkey(projectId, "path", "work", taskId),
    queryFn: () => api<{ work: WorkRow | null }>(`/api/projects/${projectId}/path/work/${taskId}`),
  });
  if (isLoading) return <View style={{ height: 40 }}><Loading /></View>;
  return <WorkView projectId={projectId} taskId={taskId} actor={actor} work={data?.work ?? null} done={done} compact />;
}

function confirm(message: string, onYes: () => void) {
  if (Platform.OS === "web") { if (window.confirm(message)) onYes(); return; }
  Alert.alert("Remove this loop?", message, [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: onYes }]);
}

export function LoopTree({ projectId, tree }: { projectId: string; tree: LoopTreeData }) {
  const refresh = useRefreshPath(projectId);
  const { notify, fail } = useNotify();
  const loops = (tree.loops ?? []).map((l) => ({ ...l, type: (l.type && LOOP_TYPE_INFO[l.type] ? l.type : "product") as LoopType }));
  const coverage = tree.coverage ?? { missing: [], unwritten: [], productLoops: loops.length, complete: false };
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ kind: "loop" | "step"; loopTaskId: string | null; title: string; description: string; type: LoopType } | null>(null);
  const [draft, setDraft] = useState<{ loopTaskId: string; title: string; text: string } | null>(null);
  const [rename, setRename] = useState<{ taskId: string; title: string; description: string } | null>(null);

  const add = useMutation({
    mutationFn: (f: NonNullable<typeof form>) => f.kind === "loop"
      ? api(`/api/projects/${projectId}/path/loops`, { method: "POST", body: { backboneId: tree.sourceId, title: f.title, description: f.description, type: f.type } })
      : api(`/api/projects/${projectId}/path/steps`, { method: "POST", body: { backboneId: tree.fanOutId, loopTaskId: f.loopTaskId, title: f.title, description: f.description } }),
    onSuccess: () => { setForm(null); refresh(); }, onError: (e) => fail(e),
  });
  const expand = useMutation({
    mutationFn: (b: { loopTaskId: string; artifact?: string }) => api<any>(`/api/projects/${projectId}/path/expand`, { method: "POST", body: { backboneId: tree.fanOutId, ...b } }),
    onSuccess: (r) => { setDraft(null); refresh(); notify(r?.created?.length ? `Nova broke it into ${r.created.length} steps` : "Steps already exist"); },
    onError: async (e: any, b) => {
      if (String(e?.body?.code ?? e?.message ?? "").includes("artifact_missing")) {
        try {
          const r = await api<any>(`/api/projects/${projectId}/path/expand`, { method: "POST", body: { backboneId: tree.fanOutId, loopTaskId: b.loopTaskId, draft: true } });
          setDraft({ loopTaskId: b.loopTaskId, title: r.sourceTitle, text: r.draft });
          return;
        } catch (err) { return fail(err); }
      }
      fail(e);
    },
  });
  const setStatus = useMutation({
    mutationFn: (b: { taskId: string; status: "done" | "todo" }) => api(`/api/kanban/${b.taskId}`, { method: "PATCH", body: { status: b.status } }),
    onSuccess: refresh, onError: (e) => fail(e),
  });
  const save = useMutation({
    mutationFn: (b: NonNullable<typeof rename>) => api(`/api/kanban/${b.taskId}`, { method: "PATCH", body: { title: b.title, description: b.description } }),
    onSuccess: () => { setRename(null); refresh(); }, onError: (e) => fail(e),
  });
  const write = useMutation({
    mutationFn: (loopTaskIds?: string[]) => api<any>(`/api/projects/${projectId}/path/loops/write`, { method: "POST", body: loopTaskIds ? { loopTaskIds } : {} }),
    onSuccess: (r) => { refresh(); const n = (r?.written?.length ?? 0) + (r?.created?.length ?? 0); notify(`Nova wrote ${n} loop${n === 1 ? "" : "s"} — read them over`); },
    onError: (e) => fail(e),
  });
  const remove = useMutation({
    mutationFn: (taskId: string) => api<any>(`/api/projects/${projectId}/path/loops/${taskId}`, { method: "DELETE" }),
    onSuccess: () => { refresh(); notify("Loop removed"); }, onError: (e) => fail(e),
  });

  const addable = addableLoopTypes(loops);
  const built = loops.filter((l) => l.state === "built").length;
  const written = loops.filter((l) => l.written).length;
  const reads = new Map((tree.competition?.audit.loops ?? []).map((r) => [r.loopTaskId, r]));

  return (
    <View style={{ gap: spacing.sm }}>
      <Well tone="primary" style={{ alignItems: "flex-start" }}>
        <Overline>{tree.sourceTitle}</Overline>
        <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{loops.length} loop{loops.length === 1 ? "" : "s"} · {written} written · {built} built</Text>
        <Meta>{coverage.complete ? "All five kinds written" : `Still to write: ${[...coverage.missing, ...coverage.unwritten].map((t) => LOOP_TYPE_INFO[t]?.label.toLowerCase()).join(", ")}`}</Meta>
        {(!coverage.complete || loops.some((l) => !l.written)) && (
          <Btn small variant="outline" icon="sparkles" label="Nova writes the rest" loading={write.isPending && write.variables === undefined} onPress={() => write.mutate(undefined)} />
        )}
      </Well>

      {loops.map((loop) => {
        const st = STATE[loop.state];
        const isOpen = open === loop.taskId;
        const read = reads.get(loop.taskId);
        return (
          <View key={loop.taskId} style={{ borderWidth: 1, borderColor: isOpen ? colors.primary : colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface }}>
            {rename?.taskId === loop.taskId ? (
              <View style={{ gap: spacing.sm }}>
                <Line value={rename.title} onChangeText={(t) => setRename({ ...rename, title: t })} />
                <Area value={rename.description} onChangeText={(t) => setRename({ ...rename, description: t })} rows={3} />
                <Row gap={spacing.sm}>
                  <Btn small label="Save" disabled={!rename.title.trim()} loading={save.isPending} onPress={() => save.mutate(rename)} />
                  <Btn small variant="ghost" label="Cancel" onPress={() => setRename(null)} />
                </Row>
              </View>
            ) : (
              <>
                <Row between>
                  <Row gap={6} wrap style={{ flex: 1 }}>
                    <Tag label={LOOP_TYPE_INFO[loop.type].label} color={LOOP_TYPE_COLOR[loop.type]} />
                    <Tag label={st.label} color={st.color} />
                    {read && <Tag label={`${read.score}/100 · ${read.verdict}`} color={read.verdict === "strong" ? colors.success : read.verdict === "weak" ? colors.danger : colors.warning} />}
                  </Row>
                  <Row gap={spacing.md} center>
                    <Pressable hitSlop={8} onPress={() => setRename({ taskId: loop.taskId, title: loop.title, description: loop.description })} accessibilityLabel="Rename"><Icon name="create-outline" size={17} color={colors.textTertiary} /></Pressable>
                    <Pressable hitSlop={8} accessibilityLabel="Not a loop" onPress={() => confirm(`Remove "${loop.title}"? Unfinished steps go with it, and Nova won't propose it again.`, () => remove.mutate(loop.taskId))}><Icon name="trash-outline" size={17} color={colors.textTertiary} /></Pressable>
                  </Row>
                </Row>
                <Pressable onPress={() => setOpen(isOpen ? null : loop.taskId)}>
                  <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>{loop.title}</Text>
                </Pressable>
                {loop.description
                  ? <Body muted numberOfLines={isOpen ? undefined : 3}>{loop.description}</Body>
                  : <Meta>{LOOP_TYPE_INFO[loop.type].asks} e.g. {LOOP_TYPE_INFO[loop.type].example}</Meta>}
                {loop.closure && (
                  <Meta style={{ color: loop.closure.closure === "closed" ? colors.success : loop.closure.closure === "open" ? colors.warning : colors.textTertiary }}>
                    {loop.closure.closure === "closed" ? "Closes in code" : loop.closure.closure === "open" ? "Open in code" : "Not built yet"}{loop.closure.breaksAt ? ` — breaks at: ${loop.closure.breaksAt}` : ""}{loop.closure.fix ? `. Fix: ${loop.closure.fix}` : ""}
                  </Meta>
                )}
              </>
            )}

            {loop.steps.length > 0 && (
              <View style={{ borderLeftWidth: 2, borderColor: colors.border, marginLeft: 4, paddingLeft: spacing.md, gap: 2 }}>
                {loop.steps.map((s) => {
                  const sOpen = open === s.taskId;
                  return (
                    <View key={s.taskId}>
                      <Pressable onPress={() => setOpen(sOpen ? null : s.taskId)} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 }}>
                        <Tick done={s.status === "done"} size={16} />
                        <Text numberOfLines={sOpen ? undefined : 1} style={{ flex: 1, fontSize: font.sm, fontFamily: fontFamily.regular, color: s.status === "done" ? colors.textTertiary : colors.text, textDecorationLine: s.status === "done" ? "line-through" : "none" }}>{s.title}</Text>
                        <Icon name={sOpen ? "chevron-down" : "chevron-forward"} size={14} color={colors.textTertiary} />
                      </Pressable>
                      {sOpen && (
                        <View style={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
                          {!!s.description && <Meta>{s.description}</Meta>}
                          <NodeWork projectId={projectId} taskId={s.taskId} actor={s.actor} done={s.status === "done"} />
                          <Btn small variant="ghost" icon={s.status === "done" ? "refresh" : "checkmark-circle-outline"} label={s.status === "done" ? "Reopen" : "Mark done"}
                            onPress={() => setStatus.mutate({ taskId: s.taskId, status: s.status === "done" ? "todo" : "done" })} style={{ alignSelf: "flex-start" }} />
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
            {loop.total > 0 && <Meta>{loop.done}/{loop.total} steps</Meta>}

            <Row gap={spacing.sm} wrap>
              {!loop.written && <Btn small variant="outline" icon="sparkles" label="Nova writes it" loading={write.isPending && !!write.variables?.includes(loop.taskId)} onPress={() => write.mutate([loop.taskId])} />}
              {loop.steps.length === 0 && <Btn small icon="git-branch-outline" label="Break into steps" disabled={!!draft} loading={expand.isPending && expand.variables?.loopTaskId === loop.taskId} onPress={() => expand.mutate({ loopTaskId: loop.taskId })} />}
              {!(form?.kind === "step" && form.loopTaskId === loop.taskId) && <Btn small variant="ghost" icon="add" label="Step" onPress={() => setForm({ kind: "step", loopTaskId: loop.taskId, title: "", description: "", type: "product" })} />}
              <Btn small variant="ghost" icon={isOpen ? "chevron-up" : "sparkles-outline"} label={isOpen ? "Close" : "The loop itself"} onPress={() => setOpen(isOpen ? null : loop.taskId)} />
            </Row>

            {form?.kind === "step" && form.loopTaskId === loop.taskId && (
              <View style={{ gap: spacing.sm }}>
                <Line value={form.title} onChangeText={(t) => setForm({ ...form, title: t })} placeholder="Name the step" />
                <Row gap={spacing.sm}>
                  <Btn small label="Add" disabled={!form.title.trim()} loading={add.isPending} onPress={() => add.mutate(form)} />
                  <Btn small variant="ghost" label="Cancel" onPress={() => setForm(null)} />
                </Row>
              </View>
            )}
            {draft?.loopTaskId === loop.taskId && (
              <View style={{ gap: spacing.sm, borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.sm }}>
                <Meta>Nothing written for {draft.title} yet, so Nova drafted it. Edit, then build the steps.</Meta>
                <Area value={draft.text} onChangeText={(t) => setDraft({ ...draft, text: t })} rows={6} />
                <Row gap={spacing.sm} wrap>
                  <Btn small label="Looks right — build the steps" disabled={!draft.text.trim()} loading={expand.isPending} onPress={() => expand.mutate({ loopTaskId: loop.taskId, artifact: draft.text })} />
                  <Btn small variant="ghost" label="Cancel" onPress={() => setDraft(null)} />
                </Row>
              </View>
            )}
            {isOpen && (
              <View style={{ gap: spacing.sm, borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.sm }}>
                <Overline color={colors.primary}>The loop itself</Overline>
                <NodeWork projectId={projectId} taskId={loop.taskId} actor={loop.actor} done={loop.status === "done"} />
                <Btn small variant="ghost" icon={loop.status === "done" ? "refresh" : "checkmark-circle-outline"} label={loop.status === "done" ? "Reopen" : "Written — mark done"}
                  onPress={() => setStatus.mutate({ taskId: loop.taskId, status: loop.status === "done" ? "todo" : "done" })} style={{ alignSelf: "flex-start" }} />
              </View>
            )}
          </View>
        );
      })}

      {coverage.missing.filter((t) => !(form?.kind === "loop" && form.type === t)).map((t) => (
        <Pressable key={t} onPress={() => setForm({ kind: "loop", loopTaskId: null, title: LOOP_TYPE_INFO[t].label, description: "", type: t })}
          style={{ borderWidth: 1, borderStyle: "dashed", borderColor: colors.warning, borderRadius: radius.md, padding: spacing.md, gap: 4 }}>
          <Tag label={LOOP_TYPE_INFO[t].label} color={LOOP_TYPE_COLOR[t]} />
          <Meta>Missing. {LOOP_TYPE_INFO[t].asks}</Meta>
          <Row center gap={4}><Icon name="add" size={14} color={colors.primary} /><Text style={{ color: colors.primary, fontSize: font.xs + 1, fontFamily: fontFamily.semibold }}>Add it</Text></Row>
        </Pressable>
      ))}

      {form?.kind === "loop" ? (
        <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {(addable.length ? addable : [form.type]).map((t) => <Bubble key={t} small label={LOOP_TYPE_INFO[t].label} on={form.type === t} onPress={() => setForm({ ...form, type: t })} />)}
          </View>
          <Line value={form.title} onChangeText={(t) => setForm({ ...form, title: t })} placeholder="Name the loop" />
          <Area value={form.description} onChangeText={(t) => setForm({ ...form, description: t })} rows={3} placeholder={`Its 3–5 steps — e.g. ${LOOP_TYPE_INFO[form.type].example}`} />
          <Row gap={spacing.sm}>
            <Btn small label="Add loop" disabled={!form.title.trim()} loading={add.isPending} onPress={() => add.mutate(form)} />
            <Btn small variant="ghost" label="Cancel" onPress={() => setForm(null)} />
          </Row>
        </View>
      ) : addable.length > 0 && (
        <Btn small variant="outline" icon="add" label={addable.includes("product") ? "Another product loop" : "Another loop"}
          onPress={() => setForm({ kind: "loop", loopTaskId: null, title: "", description: "", type: addable.includes("product") ? "product" : addable[0] })} style={{ alignSelf: "flex-start" }} />
      )}

      {tree.competition && (
        <Well>
          <Row between><Overline>Loops vs. the competition</Overline><Tag label={`${tree.competition.audit.overallScore}/100`} /></Row>
          {!!tree.competition.audit.summary && <Body muted>{tree.competition.audit.summary}</Body>}
          <Meta>The full competitive audit is on the web.</Meta>
        </Well>
      )}
      {tree.unassigned.length > 0 && <Meta>{tree.unassigned.length} step{tree.unassigned.length === 1 ? "" : "s"} not under any loop: {tree.unassigned.map((u) => u.title).join(", ")}</Meta>}
    </View>
  );
}
