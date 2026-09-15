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
  LOOP_TYPES, type Actor, type LoopNode, type LoopTreeData, type LoopType, type LoopVerdict, type WorkRow,
} from "./shared";

const VERDICT_COLOR: Record<LoopVerdict, string> = { strong: colors.success, competitive: colors.warning, weak: colors.danger };

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
  const [rename, setRename] = useState<{ taskId: string; title: string; description: string; type: LoopType; was: LoopType } | null>(null);

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
    mutationFn: async (b: NonNullable<typeof rename>) => {
      if (b.type !== b.was) await api(`/api/projects/${projectId}/path/loops/${b.taskId}`, { method: "PATCH", body: { type: b.type } });
      return api(`/api/kanban/${b.taskId}`, { method: "PATCH", body: { title: b.title, description: b.description } });
    },
    onSuccess: () => { setRename(null); refresh(); }, onError: (e) => { refresh(); fail(e); },
  });
  const audit = useMutation({
    mutationFn: () => api<any>(`/api/projects/${projectId}/path/loops/audit`, { method: "POST", body: {} }),
    onSuccess: (r) => { refresh(); notify(`Nova scored your loops ${r?.audit?.overallScore ?? ""}/100${r?.creditsCharged ? ` · ${r.creditsCharged} credits` : ""}`); },
    onError: (e) => fail(e),
  });
  const write = useMutation({
    mutationFn: (loopTaskIds?: string[]) => api<any>(`/api/projects/${projectId}/path/loops/write`, { method: "POST", body: loopTaskIds ? { loopTaskIds } : {} }),
    onSuccess: (r) => { refresh(); const n = (r?.written?.length ?? 0) + (r?.created?.length ?? 0); notify(`Nova wrote ${n} loop${n === 1 ? "" : "s"} — read them over`); },
    onError: (e) => fail(e),
  });
  const remove = useMutation({
    mutationFn: (taskId: string) => api<any>(`/api/projects/${projectId}/path/loops/${taskId}`, { method: "DELETE" }),
    onSuccess: (r) => { refresh(); notify(r?.keptSteps ? `Loop removed — ${r.keptSteps} finished step${r.keptSteps === 1 ? "" : "s"} kept on the board` : "Loop removed"); }, onError: (e) => fail(e),
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
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {LOOP_TYPES.filter((t) => t === rename.was || addableLoopTypes(loops.filter((l) => l.taskId !== loop.taskId)).includes(t)).map((t) => (
                    <Bubble key={t} small label={LOOP_TYPE_INFO[t].label} on={rename.type === t} onPress={() => setRename({ ...rename, type: t })} />
                  ))}
                </View>
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
                    <Pressable hitSlop={8} onPress={() => setRename({ taskId: loop.taskId, title: loop.title, description: loop.description, type: loop.type, was: loop.type })} accessibilityLabel="Rename"><Icon name="create-outline" size={17} color={colors.textTertiary} /></Pressable>
                    <Pressable hitSlop={8} accessibilityLabel="Not a loop" onPress={() => confirm(`Remove "${loop.title}"? Unfinished steps go with it, and Nova won't propose it again.`, () => remove.mutate(loop.taskId))}><Icon name="trash-outline" size={17} color={colors.textTertiary} /></Pressable>
                  </Row>
                </Row>
                <Pressable onPress={() => setOpen(isOpen ? null : loop.taskId)}>
                  <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>{loop.title}</Text>
                </Pressable>
                {loop.description
                  ? <Body muted numberOfLines={isOpen ? undefined : 3}>{loop.description}</Body>
                  : (
                    <View style={{ gap: 3 }}>
                      <Meta>{LOOP_TYPE_INFO[loop.type].asks} It closes when: {LOOP_TYPE_INFO[loop.type].closes.charAt(0).toLowerCase() + LOOP_TYPE_INFO[loop.type].closes.slice(1)}</Meta>
                      <Meta style={{ fontStyle: "italic" }}>e.g. {LOOP_TYPE_INFO[loop.type].example}</Meta>
                      <Meta style={{ fontStyle: "italic" }}>Write its 3–5 steps, or have Nova draft them from your project.</Meta>
                    </View>
                  )}
                {loop.closure && (
                  <Meta style={{ color: loop.closure.closure === "closed" ? colors.success : loop.closure.closure === "open" ? colors.warning : colors.textTertiary }}>
                    {loop.closure.closure === "closed"
                      ? `Closes in code${loop.closure.returnPath ? ` — back via ${loop.closure.returnPath.mechanism}` : ""}`
                      : `${loop.closure.closure === "open" ? "Open in code" : "Not built yet"}${loop.closure.breaksAt ? ` — breaks at: ${loop.closure.breaksAt}` : ""}${loop.closure.fix ? `. Fix: ${loop.closure.fix}` : ""}${loop.closure.note ? ` (${loop.closure.note})` : ""}`}
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

      <CompetitionPanel tree={tree} complete={coverage.complete} running={audit.isPending} onRun={() => audit.mutate()} />
      {tree.unassigned.length > 0 && <Meta>{tree.unassigned.length} step{tree.unassigned.length === 1 ? "" : "s"} not under any loop: {tree.unassigned.map((u) => u.title).join(", ")}</Meta>}
    </View>
  );
}

/**
 * Nova's read of the loops against the competition — offered once all five
 * kinds are written, re-offered when a loop has changed since.
 */
function CompetitionPanel({ tree, complete, running, onRun }: { tree: LoopTreeData; complete: boolean; running: boolean; onRun: () => void }) {
  const c = tree.competition;
  const button = (label: string, icon: "flash-outline" | "refresh") => (
    <Btn small variant={c ? "outline" : "primary"} icon={icon} label={label} loading={running} disabled={!complete} onPress={onRun} style={{ alignSelf: "flex-start" }} />
  );
  if (!c) {
    return (
      <View style={{ borderWidth: 1, borderStyle: tree.competitionDue ? "solid" : "dashed", borderColor: tree.competitionDue ? `${colors.primary}66` : colors.border, backgroundColor: tree.competitionDue ? colors.primarySoft : "transparent", borderRadius: radius.md, padding: spacing.md, gap: 6 }}>
        <Row center gap={6}><Icon name="flash-outline" size={15} color={colors.primary} /><Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>Audit the loops against the competition</Text></Row>
        <Meta>
          {complete
            ? "Nova names who your customers use today, how their version of each loop works, and scores how likely each of yours is to keep turning."
            : "Once all five loops are written, Nova compares each with what your competitors run and scores how effective it will be."}
        </Meta>
        {button("Run the competitive audit", "flash-outline")}
      </View>
    );
  }
  const a = c.audit;
  const overall: LoopVerdict = a.overallScore >= 70 ? "strong" : a.overallScore >= 45 ? "competitive" : "weak";
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm }}>
      <Row between style={{ alignItems: "flex-start" }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Row center gap={6}><Icon name="flash-outline" size={15} color={colors.primary} /><Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>Loops vs. the competition</Text></Row>
          <Meta>{new Date(c.createdAt).toLocaleDateString()}{c.stale ? " · your loops have changed since" : ""}</Meta>
        </View>
        <Tag label={`${a.overallScore}/100`} color={VERDICT_COLOR[overall]} />
      </Row>
      {button(c.stale ? "Audit again" : "Re-run", "refresh")}
      {!!a.summary && <Body muted>{a.summary}</Body>}
      {a.competitors?.length > 0 && (
        <View style={{ gap: 2 }}>
          <Overline>Who customers use today</Overline>
          {a.competitors.map((x) => <Meta key={x.name}><Text style={{ fontFamily: fontFamily.semibold, color: colors.text }}>{x.name}</Text>{x.why ? ` — ${x.why}` : ""}</Meta>)}
        </View>
      )}
      {a.loops.map((r) => (
        <View key={r.loopTaskId} style={{ borderWidth: 1, borderColor: r.loopTaskId === a.weakestLoopTaskId ? `${colors.danger}66` : colors.border, borderRadius: radius.sm, padding: spacing.sm + 2, gap: 4 }}>
          <Row gap={6} wrap center>
            <Tag label={LOOP_TYPE_INFO[r.type]?.label ?? "Loop"} color={LOOP_TYPE_COLOR[r.type] ?? colors.primary} />
            <Tag label={`${r.score}/100 · ${r.verdict}`} color={VERDICT_COLOR[r.verdict] ?? colors.warning} />
            {r.loopTaskId === a.weakestLoopTaskId && <Text style={{ fontSize: font.xs, color: colors.danger, fontFamily: fontFamily.semibold }}>fix first</Text>}
          </Row>
          <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{r.title}</Text>
          {r.competitors?.length > 0 && <Meta>{r.competitors.map((x) => `${x.name}: ${x.howTheirLoopWorks}`).join(" · ")}</Meta>}
          {!!r.advantage && <Meta><Text style={{ fontFamily: fontFamily.semibold, color: colors.text }}>Edge: </Text>{r.advantage}</Meta>}
          {!!r.gap && <Meta><Text style={{ fontFamily: fontFamily.semibold, color: colors.text }}>Gap: </Text>{r.gap}</Meta>}
          {!!r.breakRisk && <Meta><Text style={{ fontFamily: fontFamily.semibold, color: colors.text }}>Likely to break at: </Text>{r.breakRisk}</Meta>}
          {!!r.recommendation && <Meta><Text style={{ fontFamily: fontFamily.semibold, color: colors.text }}>Do this: </Text>{r.recommendation}</Meta>}
        </View>
      ))}
      {!!a.caveat && <Meta style={{ fontStyle: "italic" }}>{a.caveat}</Meta>}
    </View>
  );
}
