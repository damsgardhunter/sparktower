/**
 * Nova's work on one task, and the controls to act on it — the native
 * counterpart of client/src/components/path-work.tsx.
 *
 * A step answered by tapping shows its questions as bubbles (IntakeView).
 * Otherwise there's the work button, then what Nova produced: options to
 * pick or edit, a build to run, a template to use, or a plan with its
 * figures, tables, gaps and actions.
 */
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Body, Btn, Icon, Meta, Row } from "../ui";
import { Area, Bubble, Line, Overline, Well, shareText, useNotify } from "./bits";
import {
  isAsked, useRefreshPath, workActionLabel,
  type Actor, type IntakeQuestion, type PlanPayload, type RunGroup, type WorkKind, type WorkRow,
} from "./shared";

export function WorkView({ projectId, taskId, actor, work, done, compact, intake, workKind, prefill, optionNotes, onSaved }: {
  projectId: string; taskId: string; actor: Actor; work: WorkRow | null; done: boolean; compact?: boolean;
  intake?: IntakeQuestion[]; workKind?: WorkKind | null; prefill?: "resume";
  optionNotes?: Record<string, Record<string, string>>;
  onSaved?: () => void;
}) {
  if (intake?.length) {
    return <IntakeView projectId={projectId} taskId={taskId} questions={intake} work={work} done={done} prefill={prefill} optionNotes={optionNotes} onSaved={onSaved} />;
  }
  return <NovaWorkView projectId={projectId} taskId={taskId} actor={actor} work={work} done={done} compact={compact} workKind={workKind} />;
}

function NovaWorkView({ projectId, taskId, actor, work, done, compact, workKind }: {
  projectId: string; taskId: string; actor: Actor; work: WorkRow | null; done: boolean; compact?: boolean; workKind?: WorkKind | null;
}) {
  const refresh = useRefreshPath(projectId);
  const { notify, fail } = useNotify();
  const [edit, setEdit] = useState<{ index: number; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/path/work`, { method: "POST", body: { taskId } }),
    onSuccess: () => { setEdit(null); setError(null); refresh(); },
    onError: (e: any) => setError(e?.message || "Nova couldn't do that just now."),
  });
  const choose = useMutation({
    mutationFn: (b: { workId: string; index?: number; text?: string }) => api(`/api/projects/${projectId}/path/work/${b.workId}/choose`, { method: "POST", body: b }),
    onSuccess: () => { setEdit(null); refresh(); notify("Saved as your answer"); },
    onError: (e) => fail(e),
  });

  const copy = async (text: string) => {
    const r = await shareText(text);
    if (r === "copied") notify("Copied");
  };

  const runButton = (
    <View style={{ gap: spacing.xs }}>
      <Btn
        small icon={work ? "refresh" : "construct-outline"} variant={work ? "outline" : "primary"}
        label={run.isPending ? "Nova is on it…" : work ? "Have Nova redo it" : workActionLabel(actor, workKind)}
        loading={run.isPending} onPress={() => run.mutate()} style={{ alignSelf: "flex-start" }}
      />
      {error && (
        <Well tone="warning">
          <Row gap={6} style={{ alignItems: "flex-start" }}>
            <Icon name="alert-circle-outline" size={16} color={colors.warning} />
            <Body style={{ flex: 1, fontSize: font.xs + 1 }}>{error}</Body>
          </Row>
        </Well>
      )}
    </View>
  );

  if (!work) return runButton;
  const p = work.payload;

  return (
    <View style={{ gap: spacing.md }}>
      {(p.kind === "options" || p.kind === "build") && p.existing ? (
        <Well><Body style={{ fontSize: font.xs + 1 }}><Text style={{ fontFamily: fontFamily.semibold }}>Already in place: </Text>{p.existing}</Body></Well>
      ) : null}

      {p.kind === "options" && (
        <View style={{ gap: spacing.sm }}>
          {!!p.intro && <Body muted>{p.intro}</Body>}
          {p.options.map((o, i) => {
            const chosen = work.chosenIndex === i;
            const editing = edit?.index === i;
            return (
              <View key={i} style={{ borderWidth: chosen || editing ? 1.5 : 1, borderColor: chosen || editing ? colors.primary : colors.border, borderRadius: radius.md, padding: spacing.md, gap: 6 }}>
                <Row between>
                  <Text style={{ flex: 1, fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{o.title}</Text>
                  {chosen && <Overline color={colors.primary}>Chosen</Overline>}
                </Row>
                {editing
                  ? <Area value={edit.text} onChangeText={(t) => setEdit({ index: i, text: t })} rows={6} />
                  : <Body numberOfLines={compact && !chosen ? 4 : undefined}>{o.body}</Body>}
                {!!o.why && <Meta>{o.why}</Meta>}
                {!done && (
                  <Row gap={spacing.sm} style={{ paddingTop: 2 }}>
                    <Btn small label={editing ? "Use my edit" : "Use this one"} loading={choose.isPending && choose.variables?.index === i}
                      onPress={() => choose.mutate({ workId: work.id, index: i, text: editing ? edit.text : undefined })} />
                    {editing
                      ? <Btn small variant="ghost" label="Cancel" onPress={() => setEdit(null)} />
                      : <Btn small variant="ghost" icon="create-outline" label="Edit" onPress={() => setEdit({ index: i, text: o.body })} />}
                  </Row>
                )}
              </View>
            );
          })}
        </View>
      )}

      {p.kind === "build" && (
        <View style={{ gap: spacing.sm }}>
          <Body>{p.summary}</Body>
          {p.assumptions.length > 0 && <Meta>Assumed: {p.assumptions.join(" · ")}</Meta>}
          {p.files.map((f, i) => <FileBlock key={i} path={f.path} purpose={f.purpose} content={f.content} onCopy={() => copy(f.content)} />)}
          {p.runSteps.length > 0 && <RunBlocks groups={p.runGroups} steps={p.runSteps} onCopy={copy} />}
          {!!p.verify && <Body><Text style={{ fontFamily: fontFamily.semibold }}>It works when: </Text>{p.verify}</Body>}
          {!done && <Btn small icon="checkmark-circle-outline" label="It runs — mark done" loading={choose.isPending} onPress={() => choose.mutate({ workId: work.id })} style={{ alignSelf: "flex-start" }} />}
        </View>
      )}

      {p.kind === "plan" && (
        <PlanView projectId={projectId} workId={work.id} plan={p} done={done} compact={compact}
          onAccept={() => choose.mutate({ workId: work.id })} accepting={choose.isPending} />
      )}

      {p.kind === "template" && (
        <View style={{ gap: spacing.sm }}>
          {!!p.intro && <Body muted>{p.intro}</Body>}
          <Well><Text selectable style={{ fontSize: font.sm, lineHeight: 20, color: colors.text, fontFamily: fontFamily.regular }}>{p.template}</Text></Well>
          <Meta><Text style={{ fontFamily: fontFamily.semibold }}>Nova did: </Text>{p.whatNovaDid}   <Text style={{ fontFamily: fontFamily.semibold }}>You do: </Text>{p.whatIsLeft}</Meta>
          <Row gap={spacing.sm} wrap>
            <Btn small variant="outline" icon="share-outline" label="Copy or share" onPress={() => copy(p.template)} />
            {!done && <Btn small icon="checkmark-circle-outline" label="I did this" loading={choose.isPending} onPress={() => choose.mutate({ workId: work.id })} />}
          </Row>
        </View>
      )}

      {runButton}
    </View>
  );
}

function FileBlock({ path, purpose, content, onCopy }: { path: string; purpose?: string; content: string; onCopy: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, overflow: "hidden" }}>
      <Pressable onPress={() => setOpen(!open)} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm + 2 }}>
        <Icon name={open ? "chevron-down" : "chevron-forward"} size={14} color={colors.textTertiary} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: "Courier", fontSize: font.xs + 1, color: colors.text }} numberOfLines={1}>{path}</Text>
          {!!purpose && <Meta numberOfLines={1}>{purpose}</Meta>}
        </View>
        <Pressable onPress={onCopy} hitSlop={8}><Icon name="copy-outline" size={16} color={colors.primary} /></Pressable>
      </Pressable>
      {open && (
        <ScrollView horizontal style={{ backgroundColor: colors.surfaceRaised, maxHeight: 320 }} contentContainerStyle={{ padding: spacing.sm }}>
          <Text selectable style={{ fontFamily: "Courier", fontSize: 11, color: colors.text }}>{content}</Text>
        </ScrollView>
      )}
    </View>
  );
}

const WHERE_ICON: Record<string, any> = { terminal: "terminal-outline", "new-terminal": "terminal-outline", "browser-console": "globe-outline", browser: "globe-outline", manual: "hand-left-outline" };

function RunBlocks({ groups, steps, onCopy }: { groups?: RunGroup[]; steps: string[]; onCopy: (t: string) => void }) {
  if (!groups?.length) {
    return <View style={{ gap: 2 }}>{steps.map((s, i) => <Body key={i}>{i + 1}. {s}</Body>)}</View>;
  }
  return (
    <View style={{ gap: spacing.sm }}>
      {groups.map((g, i) => (
        <View key={i} style={{ gap: 4 }}>
          {!!g.before && <Text style={{ fontSize: font.xs, color: colors.warning, fontFamily: fontFamily.semibold }}>{g.before}</Text>}
          <Row center gap={6}>
            <Icon name={WHERE_ICON[g.where] ?? "terminal-outline"} size={14} color={colors.textTertiary} />
            <Meta style={{ flex: 1 }}>{g.label}{g.cwd ? ` · in ${g.cwd}/` : ""}</Meta>
          </Row>
          {!!g.copy && (
            <Pressable onPress={() => onCopy(g.copy)} style={{ backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.sm, flexDirection: "row", gap: spacing.sm }}>
              <Text selectable style={{ flex: 1, fontFamily: "Courier", fontSize: 11, color: colors.text }}>{g.copy}</Text>
              <Icon name="copy-outline" size={15} color={colors.primary} />
            </Pressable>
          )}
          {!!g.note && <Meta>{g.note}</Meta>}
        </View>
      ))}
    </View>
  );
}

/**
 * A step answered by tapping: each question's choices as bubbles. Follow-up
 * questions appear when an earlier answer calls for them; saving marks the
 * step done, and the answers can be changed from the same place later.
 */
export function IntakeView({ projectId, taskId, questions, work, done, onSaved, prefill, optionNotes }: {
  projectId: string; taskId: string; questions: IntakeQuestion[]; work: WorkRow | null; done: boolean;
  onSaved?: () => void; prefill?: "resume"; optionNotes?: Record<string, Record<string, string>>;
}) {
  const refresh = useRefreshPath(projectId);
  const { notify, fail } = useNotify();
  const saved = work?.payload.kind === "intake" ? work.payload.answers : null;
  const [answers, setAnswers] = useState<Record<string, string[]>>(saved ?? {});
  const [editing, setEditing] = useState(!done || !saved);
  const [prefilled, setPrefilled] = useState<string[] | null>(null);

  const visibleAnswers = () => Object.fromEntries(questions.filter((q) => isAsked(q, answers)).map((q) => [q.id, answers[q.id] ?? []]));

  const save = useMutation({
    mutationFn: () => api<{ route?: string | null }>(`/api/projects/${projectId}/path/intake`, { method: "POST", body: { taskId, answers: visibleAnswers() } }),
    onSuccess: (r) => {
      setEditing(false); refresh();
      notify(r?.route ? "Route chosen — your roadmap is ready" : "Saved — Nova will build from this");
      onSaved?.();
    },
    onError: (e) => fail(e),
  });

  const fill = useMutation({
    mutationFn: () => api<{ hasResume: boolean; answers: Record<string, string[]> | null; found: string[] }>(`/api/projects/${projectId}/path/prefill/${taskId}`),
    onSuccess: (r) => {
      if (!r.hasResume) { notify("No résumé on your profile yet — upload one and Nova can fill this in.", "info"); return; }
      if (r.answers) setAnswers((prev) => ({ ...prev, ...r.answers }));
      setPrefilled(r.found);
      notify(r.found.length ? "Filled in from your résumé — check it" : "Your résumé doesn't show a business you owned", "info");
    },
    onError: (e) => fail(e),
  });

  const pick = (q: IntakeQuestion, id: string) => setAnswers((prev) => {
    const current = prev[q.id] ?? [];
    if (q.multi) return { ...prev, [q.id]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id] };
    return { ...prev, [q.id]: current[0] === id ? [] : [id] };
  });
  const missing = questions.filter((q) => isAsked(q, answers) && !q.optional && !(answers[q.id]?.length));

  if (!editing && saved) {
    return (
      <View style={{ gap: spacing.sm }}>
        <Well>
          {questions.filter((q) => isAsked(q, saved)).map((q) => {
            const values = saved[q.id] ?? [];
            const labels = q.kind === "text" ? values : values.map((id) => q.options.find((o) => o.id === id)?.label ?? id);
            return (
              <View key={q.id} style={{ gap: 1 }}>
                <Meta>{q.prompt}</Meta>
                <Body style={{ fontFamily: fontFamily.semibold }}>{labels.length ? labels.join(", ") : "Not sure yet"}</Body>
              </View>
            );
          })}
        </Well>
        <Btn small variant="outline" icon="create-outline" label="Change my answers" onPress={() => setEditing(true)} style={{ alignSelf: "flex-start" }} />
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.lg }}>
      {prefill === "resume" && (
        <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm + 2, gap: 6 }}>
          <Btn small variant="outline" icon="sparkles-outline" label="Fill from my résumé" loading={fill.isPending} onPress={() => fill.mutate()} style={{ alignSelf: "flex-start" }} />
          <Meta>{prefilled?.length ? `Found: ${prefilled.join("; ")}` : "Nova reads the roles on your profile. You check everything before it's saved."}</Meta>
        </View>
      )}
      {questions.filter((q) => isAsked(q, answers)).map((q) => (
        <View key={q.id} style={{ gap: spacing.sm }}>
          <View style={{ gap: 2 }}>
            <Text style={{ fontSize: font.base, fontFamily: fontFamily.semibold, color: colors.text, lineHeight: 21 }}>
              {q.prompt}
              {q.optional ? <Text style={{ fontSize: font.xs, color: colors.textTertiary, fontFamily: fontFamily.regular }}>  optional</Text> : null}
              {q.multi ? <Text style={{ fontSize: font.xs, color: colors.textTertiary, fontFamily: fontFamily.regular }}>  pick any</Text> : null}
            </Text>
            {!!q.help && <Meta>{q.help}</Meta>}
          </View>
          {q.kind === "text" ? (
            <Line value={answers[q.id]?.[0] ?? ""} placeholder={q.placeholder} maxLength={300}
              onChangeText={(t) => setAnswers((prev) => ({ ...prev, [q.id]: t ? [t] : [] }))} />
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              {q.options.map((o) => (
                <Bubble key={o.id} label={o.label} on={(answers[q.id] ?? []).includes(o.id)} note={optionNotes?.[q.id]?.[o.id]} onPress={() => pick(q, o.id)} />
              ))}
            </View>
          )}
        </View>
      ))}
      <Row center gap={spacing.md} wrap>
        <Btn small icon="checkmark-circle-outline" label={saved ? "Save my answers" : "Save and continue"} disabled={missing.length > 0} loading={save.isPending} onPress={() => save.mutate()} />
        {missing.length > 0 && <Meta>{missing.length} to answer</Meta>}
        {saved && <Btn small variant="ghost" label="Cancel" onPress={() => { setAnswers(saved); setEditing(false); }} />}
      </Row>
    </View>
  );
}

/** A plan Nova built: the numbers, the tables, what's weak, and what to do next. */
function PlanView({ projectId, workId, plan, done, compact, onAccept, accepting }: {
  projectId: string; workId: string; plan: PlanPayload; done: boolean; compact?: boolean; onAccept: () => void; accepting: boolean;
}) {
  const refresh = useRefreshPath(projectId);
  const { notify, fail } = useNotify();
  const [openSection, setOpenSection] = useState<number | null>(compact ? null : 0);
  const addTasks = useMutation({
    mutationFn: () => api<{ created: string[]; skipped: number }>(`/api/projects/${projectId}/path/work/${workId}/tasks`, { method: "POST", body: {} }),
    onSuccess: (r) => { refresh(); notify(r.created.length ? `Added ${r.created.length} task${r.created.length === 1 ? "" : "s"} to your board` : "Those are already on your board"); },
    onError: (e) => fail(e),
  });

  return (
    <View style={{ gap: spacing.md }}>
      {!!plan.summary && <Body>{plan.summary}</Body>}
      {plan.figures.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {plan.figures.map((f, i) => (
            <View key={i} style={{ width: "48%", flexGrow: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm + 2, gap: 2 }}>
              <Meta>{f.label}</Meta>
              <Text style={{ fontSize: font.lg, fontFamily: fontFamily.bold, color: colors.text }}>{f.value}</Text>
              {!!f.note && <Meta>{f.note}</Meta>}
            </View>
          ))}
        </View>
      )}
      {plan.tables.map((t, i) => (
        <View key={i} style={{ gap: 4 }}>
          {!!t.title && <Overline>{t.title}</Overline>}
          <ScrollView horizontal showsHorizontalScrollIndicator style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm }}>
            <View>
              <View style={{ flexDirection: "row", backgroundColor: colors.surfaceRaised }}>
                {t.columns.map((c, j) => <Text key={j} style={cell(true)}>{c}</Text>)}
              </View>
              {t.rows.map((r, j) => (
                <View key={j} style={{ flexDirection: "row", borderTopWidth: 1, borderColor: colors.borderSubtle }}>
                  {r.map((c, k) => <Text key={k} style={cell(false)}>{c}</Text>)}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      ))}
      {plan.sections.map((s, i) => (
        <View key={i} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm }}>
          <Pressable onPress={() => setOpenSection(openSection === i ? null : i)} style={{ flexDirection: "row", alignItems: "center", padding: spacing.sm + 2, gap: spacing.sm }}>
            <Text style={{ flex: 1, fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{s.heading || "Detail"}</Text>
            <Icon name={openSection === i ? "chevron-up" : "chevron-down"} size={16} color={colors.textTertiary} />
          </Pressable>
          {openSection === i && <Body style={{ paddingHorizontal: spacing.sm + 2, paddingBottom: spacing.sm + 2 }}>{s.body}</Body>}
        </View>
      ))}
      {plan.gaps.length > 0 && (
        <Well tone="warning">
          <Row center gap={6}><Icon name="warning-outline" size={15} color={colors.warning} /><Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.semibold, color: colors.warning }}>What's weak</Text></Row>
          {plan.gaps.map((g, i) => <Body key={i}>•  {g}</Body>)}
        </Well>
      )}
      {plan.actions.length > 0 && (
        <View style={{ gap: spacing.sm }}>
          <Overline>What to do</Overline>
          {plan.actions.map((a, i) => (
            <View key={i} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm + 2, gap: 3 }}>
              <Row gap={6} wrap center>
                {!!a.when && <View style={{ backgroundColor: colors.surfaceRaised, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}><Text style={{ fontSize: 10.5, color: colors.textSecondary, fontFamily: fontFamily.medium }}>{a.when}</Text></View>}
                <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text, flexShrink: 1 }}>{a.title}</Text>
              </Row>
              {!!a.detail && <Meta>{a.detail}</Meta>}
              {!!a.moves && <Text style={{ fontSize: font.xs, color: colors.primary, fontFamily: fontFamily.medium }}>Moves: {a.moves}</Text>}
            </View>
          ))}
        </View>
      )}
      {plan.assumptions.length > 0 && <Meta>Assumed: {plan.assumptions.join(" · ")}</Meta>}
      {!!plan.verifyWith && (
        <Row gap={6} style={{ alignItems: "flex-start" }}>
          <Icon name="shield-checkmark-outline" size={14} color={colors.textTertiary} />
          <Meta style={{ flex: 1 }}>Check with: {plan.verifyWith}</Meta>
        </Row>
      )}
      <Row gap={spacing.sm} wrap>
        {!done && <Btn small icon="checkmark-circle-outline" label="Plan on this — mark done" loading={accepting} onPress={onAccept} />}
        {plan.actions.length > 0 && <Btn small variant="outline" icon="add-circle-outline" label="Add these to my tasks" loading={addTasks.isPending} onPress={() => addTasks.mutate()} />}
      </Row>
    </View>
  );
}

const cell = (head: boolean) => ({
  width: 132, paddingHorizontal: 8, paddingVertical: 6, fontSize: 11.5, color: colors.text,
  fontFamily: head ? fontFamily.semibold : fontFamily.regular,
});
