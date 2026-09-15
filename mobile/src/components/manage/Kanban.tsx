/**
 * The task board on a phone: one column at a time behind a status control,
 * cards that move forward with a tap, and a full editor for everything the
 * web's task dialog holds.
 */
import { useEffect, useMemo, useState } from "react";
import { Alert, Platform, Pressable, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Avatar, Btn, Card, Cost, Empty, Field, Icon, Label, Loading, Meta, Row, Segments } from "../ui";
import { Area, Bubble, EditorSheet, Line, Overline, Tag, useNotify } from "./bits";
import { mkey, useRefreshPath } from "./shared";

export const KANBAN_COLUMNS = [
  { id: "todo", label: "To do", icon: "ellipse-outline" as const, color: colors.textTertiary },
  { id: "in-progress", label: "In progress", icon: "time-outline" as const, color: colors.info },
  { id: "review", label: "Review", icon: "eye-outline" as const, color: colors.warning },
  { id: "done", label: "Done", icon: "checkmark-circle" as const, color: colors.success },
];
const PRIORITY_COLOR: Record<string, string> = { low: colors.success, medium: colors.warning, high: colors.danger };

interface Subtask { id: string; title: string; done: boolean }
interface Task {
  id: string; title: string; description: string | null; status: string; priority: string; order: number;
  assigneeId: string | null; dueDate: string | null; tags: string[] | null; estimateHours: number | null;
  subtasks: Subtask[] | null; milestoneId?: string | null; blockedByTaskId?: string | null;
}
interface Member { userId: string; user: { firstName?: string | null; email?: string | null }; profile?: { displayName?: string | null; avatarUrl?: string | null } }

const memberName = (m: Member) => m.profile?.displayName || m.user?.firstName || m.user?.email || "Member";

function confirmAsk(title: string, message: string, onYes: () => void) {
  if (Platform.OS === "web") { if (window.confirm(`${title}\n\n${message}`)) onYes(); return; }
  Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: onYes }]);
}

export function Kanban({ projectId, members }: { projectId: string; members: Member[] }) {
  const qc = useQueryClient();
  const refresh = useRefreshPath(projectId);
  const { notify, fail } = useNotify();
  const [column, setColumn] = useState("todo");
  const [editing, setEditing] = useState<Task | "new" | null>(null);

  const { data: tasks, isLoading } = useQuery({
    queryKey: mkey(projectId, "kanban"),
    queryFn: () => api<Task[]>(`/api/projects/${projectId}/kanban`),
  });
  const { data: milestones } = useQuery({
    queryKey: mkey(projectId, "milestones"),
    queryFn: () => api<any[]>(`/api/projects/${projectId}/milestones`),
  });

  const update = useMutation({
    mutationFn: (b: { id: string; data: Partial<Task> }) => api(`/api/kanban/${b.id}`, { method: "PATCH", body: b.data }),
    onMutate: async (b) => {
      // Moving a card should feel instant.
      qc.setQueryData<Task[]>(mkey(projectId, "kanban"), (old) => (old ?? []).map((t) => (t.id === b.id ? { ...t, ...b.data } : t)));
    },
    onSettled: refresh,
    onError: (e) => fail(e),
  });
  const generate = useMutation({
    mutationFn: () => api<any>(`/api/projects/${projectId}/kanban/ai-generate`, { method: "POST" }),
    onSuccess: (r) => { refresh(); notify(r?.tasks?.length ? `Nova added ${r.tasks.length} tasks` : "Tasks generated"); },
    onError: (e) => fail(e, "Nova couldn't generate tasks."),
  });
  const sequence = useMutation({
    mutationFn: () => api<any>(`/api/projects/${projectId}/kanban/sequence`, { method: "POST" }),
    onSuccess: () => { refresh(); notify("Board re-ordered"); },
    onError: (e) => fail(e, "Nova couldn't re-order the board."),
  });
  const clearDone = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/kanban?status=done`, { method: "DELETE" }),
    onSuccess: () => { refresh(); notify("Cleared finished tasks"); },
    onError: (e) => fail(e),
  });

  const counts = useMemo(() => Object.fromEntries(KANBAN_COLUMNS.map((c) => [c.id, (tasks ?? []).filter((t) => t.status === c.id).length])), [tasks]);
  const shown = (tasks ?? []).filter((t) => t.status === column).sort((a, b) => a.order - b.order);
  const col = KANBAN_COLUMNS.find((c) => c.id === column)!;
  const nextCol = KANBAN_COLUMNS[KANBAN_COLUMNS.findIndex((c) => c.id === column) + 1];

  if (isLoading) return <View style={{ height: 240 }}><Loading /></View>;
  const total = tasks?.length ?? 0;

  return (
    <View style={{ gap: spacing.md }}>
      <Card style={{ gap: spacing.sm }}>
        <Row between>
          <View>
            <Text style={{ fontFamily: fontFamily.bold, fontSize: font.lg, color: colors.text }}>Tasks</Text>
            <Meta>{total} total · {counts.done ?? 0} done</Meta>
          </View>
          <Btn small icon="add" label="New task" onPress={() => setEditing("new")} />
        </Row>
        <Row gap={spacing.sm} wrap>
          <Row center gap={4}><Btn small variant="outline" icon="sparkles" label="Generate with Nova" loading={generate.isPending} onPress={() => generate.mutate()} /><Cost credits={1} /></Row>
          {total > 1 && <Btn small variant="ghost" icon="swap-vertical" label="Order with Nova" loading={sequence.isPending} onPress={() => sequence.mutate()} />}
        </Row>
      </Card>

      <Segments
        options={KANBAN_COLUMNS.map((c) => ({ value: c.id, label: `${c.label} ${counts[c.id] ?? 0}` }))}
        value={column}
        onChange={setColumn}
      />

      {shown.length === 0 ? (
        <Card><Empty icon={col.icon} title={`Nothing in ${col.label.toLowerCase()}`} body={column === "todo" ? "Add a task, or have Nova break the project down." : undefined} /></Card>
      ) : shown.map((t) => {
        const assignee = members.find((m) => m.userId === t.assigneeId);
        const subs = t.subtasks ?? [];
        const overdue = t.dueDate && t.status !== "done" && new Date(t.dueDate).getTime() < Date.now();
        return (
          <Card key={t.id} onPress={() => setEditing(t)} accent={PRIORITY_COLOR[t.priority]}>
            <Row gap={spacing.sm} style={{ alignItems: "flex-start" }}>
              <Pressable hitSlop={8} onPress={() => update.mutate({ id: t.id, data: { status: t.status === "done" ? "todo" : "done" } })} style={{ marginTop: 1 }} accessibilityLabel={t.status === "done" ? "Reopen" : "Mark done"}>
                <Icon name={t.status === "done" ? "checkmark-circle" : "ellipse-outline"} size={22} color={t.status === "done" ? colors.success : colors.textTertiary} />
              </Pressable>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm + 1, color: t.status === "done" ? colors.textTertiary : colors.text, textDecorationLine: t.status === "done" ? "line-through" : "none", lineHeight: 20 }}>{t.title}</Text>
                {!!t.description && <Meta numberOfLines={2}>{t.description}</Meta>}
                <Row center gap={spacing.sm} wrap>
                  <Tag label={t.priority} color={PRIORITY_COLOR[t.priority] ?? colors.textSecondary} />
                  {!!t.dueDate && <Row center gap={3}><Icon name="calendar-outline" size={12} color={overdue ? colors.danger : colors.textTertiary} /><Meta style={overdue ? { color: colors.danger } : undefined}>{new Date(t.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</Meta></Row>}
                  {subs.length > 0 && <Row center gap={3}><Icon name="list-outline" size={12} color={colors.textTertiary} /><Meta>{subs.filter((s) => s.done).length}/{subs.length}</Meta></Row>}
                  {t.estimateHours != null && <Meta>{t.estimateHours}h</Meta>}
                  {(t.tags ?? []).filter((x) => !x.includes(":")).slice(0, 2).map((x) => <Meta key={x}>#{x}</Meta>)}
                </Row>
              </View>
              {assignee && <Avatar name={memberName(assignee)} uri={assignee.profile?.avatarUrl} size={26} />}
            </Row>
            {nextCol && (
              <Pressable onPress={() => update.mutate({ id: t.id, data: { status: nextCol.id } })} style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-end" }} hitSlop={6}>
                <Text style={{ color: colors.primary, fontSize: font.xs + 1, fontFamily: fontFamily.semibold }}>Move to {nextCol.label.toLowerCase()}</Text>
                <Icon name="arrow-forward" size={13} color={colors.primary} />
              </Pressable>
            )}
          </Card>
        );
      })}

      {column === "done" && (counts.done ?? 0) > 0 && (
        <Btn small variant="ghost" icon="trash-outline" label="Clear finished tasks" loading={clearDone.isPending}
          onPress={() => confirmAsk("Clear finished tasks?", "Every task in Done is removed from the board.", () => clearDone.mutate())} style={{ alignSelf: "center" }} />
      )}

      <TaskEditor
        projectId={projectId} task={editing} defaultStatus={column} members={members} milestones={milestones ?? []} tasks={tasks ?? []}
        onClose={() => setEditing(null)}
      />
    </View>
  );
}

const EMPTY = { title: "", description: "", status: "todo", priority: "medium", assigneeId: "", dueDate: "", tags: [] as string[], estimateHours: "", subtasks: [] as Subtask[], milestoneId: "", blockedByTaskId: "" };

function TaskEditor({ projectId, task, defaultStatus, members, milestones, tasks, onClose }: {
  projectId: string; task: Task | "new" | null; defaultStatus: string; members: Member[]; milestones: any[]; tasks: Task[]; onClose: () => void;
}) {
  const refresh = useRefreshPath(projectId);
  const { notify, fail } = useNotify();
  const [form, setForm] = useState(EMPTY);
  const [tag, setTag] = useState("");
  const [sub, setSub] = useState("");

  useEffect(() => {
    if (!task) return;
    if (task === "new") { setForm({ ...EMPTY, status: defaultStatus }); return; }
    setForm({
      title: task.title, description: task.description ?? "", status: task.status, priority: task.priority,
      assigneeId: task.assigneeId ?? "", dueDate: task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : "",
      tags: task.tags ?? [], estimateHours: task.estimateHours?.toString() ?? "", subtasks: task.subtasks ?? [],
      milestoneId: task.milestoneId ?? "", blockedByTaskId: task.blockedByTaskId ?? "",
    });
  }, [task, defaultStatus]);

  const body = () => ({
    title: form.title.trim(), description: form.description || null, status: form.status, priority: form.priority,
    assigneeId: form.assigneeId || null, dueDate: /^\d{4}-\d{2}-\d{2}$/.test(form.dueDate) ? form.dueDate : null,
    tags: form.tags, estimateHours: form.estimateHours ? parseInt(form.estimateHours, 10) || null : null,
    subtasks: form.subtasks, milestoneId: form.milestoneId || null, blockedByTaskId: form.blockedByTaskId || null,
  });
  const save = useMutation({
    mutationFn: () => task && task !== "new"
      ? api(`/api/kanban/${task.id}`, { method: "PATCH", body: body() })
      : api(`/api/projects/${projectId}/kanban`, { method: "POST", body: body() }),
    onSuccess: () => { refresh(); notify(task === "new" ? "Task created" : "Task updated"); onClose(); },
    onError: (e) => fail(e),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/kanban/${id}`, { method: "DELETE" }),
    onSuccess: () => { refresh(); notify("Task deleted"); onClose(); },
    onError: (e) => fail(e),
  });

  const set = (patch: Partial<typeof EMPTY>) => setForm((f) => ({ ...f, ...patch }));
  const dateOk = !form.dueDate || /^\d{4}-\d{2}-\d{2}$/.test(form.dueDate);

  return (
    <EditorSheet
      visible={!!task} onClose={onClose} title={task === "new" ? "New task" : "Edit task"}
      action={{ label: task === "new" ? "Create" : "Save", onPress: () => save.mutate(), disabled: !form.title.trim() || !dateOk, loading: save.isPending }}
      footer={task && task !== "new" ? (
        <Btn variant="danger" icon="trash-outline" label="Delete task" loading={remove.isPending}
          onPress={() => confirmAsk("Delete this task?", form.title, () => remove.mutate((task as Task).id))} />
      ) : undefined}
    >
      <Field label="Title" value={form.title} onChangeText={(v) => set({ title: v })} placeholder="Task title" />
      <View style={{ gap: spacing.xs }}>
        <Label>Description</Label>
        <Area value={form.description} onChangeText={(v) => set({ description: v })} placeholder="Task description (optional)" rows={4} />
      </View>

      <View style={{ gap: spacing.sm }}>
        <Label>Status</Label>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {KANBAN_COLUMNS.map((c) => <Bubble key={c.id} label={c.label} on={form.status === c.id} onPress={() => set({ status: c.id })} />)}
        </View>
      </View>
      <View style={{ gap: spacing.sm }}>
        <Label>Priority</Label>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {["low", "medium", "high"].map((p) => <Bubble key={p} label={p[0].toUpperCase() + p.slice(1)} on={form.priority === p} onPress={() => set({ priority: p })} />)}
        </View>
      </View>

      {members.length > 0 && (
        <View style={{ gap: spacing.sm }}>
          <Label>Assignee</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <Bubble label="Unassigned" on={!form.assigneeId} onPress={() => set({ assigneeId: "" })} />
            {members.map((m) => <Bubble key={m.userId} label={memberName(m)} on={form.assigneeId === m.userId} onPress={() => set({ assigneeId: m.userId })} />)}
          </View>
        </View>
      )}

      <Row gap={spacing.md}>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Label>Due date</Label>
          <Line value={form.dueDate} onChangeText={(v) => set({ dueDate: v })} placeholder="YYYY-MM-DD" maxLength={10} />
          {!dateOk && <Meta style={{ color: colors.danger }}>Use YYYY-MM-DD</Meta>}
        </View>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Label>Estimate (hours)</Label>
          <Line value={form.estimateHours} onChangeText={(v) => set({ estimateHours: v.replace(/\D/g, "") })} placeholder="e.g. 4" numeric />
        </View>
      </Row>

      {milestones.length > 0 && (
        <View style={{ gap: spacing.sm }}>
          <Label>Milestone</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <Bubble small label="Not linked" on={!form.milestoneId} onPress={() => set({ milestoneId: "" })} />
            {milestones.map((m) => <Bubble small key={m.id} label={m.title} on={form.milestoneId === m.id} onPress={() => set({ milestoneId: m.id })} />)}
          </View>
        </View>
      )}

      {tasks.length > 1 && (
        <View style={{ gap: spacing.sm }}>
          <Label>Blocked by</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <Bubble small label="None" on={!form.blockedByTaskId} onPress={() => set({ blockedByTaskId: "" })} />
            {tasks.filter((t) => t.status !== "done" && (task === "new" || t.id !== task?.id)).slice(0, 12).map((t) => (
              <Bubble small key={t.id} label={t.title.length > 34 ? `${t.title.slice(0, 32)}…` : t.title} on={form.blockedByTaskId === t.id} onPress={() => set({ blockedByTaskId: t.id })} />
            ))}
          </View>
        </View>
      )}

      <View style={{ gap: spacing.sm }}>
        <Label>Tags</Label>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {form.tags.filter((x) => !x.includes(":")).map((x) => (
            <Pressable key={x} onPress={() => set({ tags: form.tags.filter((y) => y !== x) })} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: colors.primary, fontSize: font.xs + 1, fontFamily: fontFamily.medium }}>{x}</Text>
              <Icon name="close" size={12} color={colors.primary} />
            </Pressable>
          ))}
        </View>
        <Row gap={spacing.sm} center>
          <View style={{ flex: 1 }}><Line value={tag} onChangeText={setTag} placeholder="Add a tag" /></View>
          <Btn small variant="outline" label="Add" disabled={!tag.trim()} onPress={() => { const v = tag.trim(); if (v && !form.tags.includes(v)) set({ tags: [...form.tags, v] }); setTag(""); }} />
        </Row>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Row between><Label>Subtasks</Label>{form.subtasks.length > 0 && <Overline>{form.subtasks.filter((s) => s.done).length}/{form.subtasks.length}</Overline>}</Row>
        {form.subtasks.map((s) => (
          <Row key={s.id} center gap={spacing.sm}>
            <Pressable hitSlop={6} onPress={() => set({ subtasks: form.subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)) })}>
              <Icon name={s.done ? "checkbox" : "square-outline"} size={20} color={s.done ? colors.primary : colors.textTertiary} />
            </Pressable>
            <Text style={{ flex: 1, fontSize: font.sm, color: s.done ? colors.textTertiary : colors.text, textDecorationLine: s.done ? "line-through" : "none", fontFamily: fontFamily.regular }}>{s.title}</Text>
            <Pressable hitSlop={6} onPress={() => set({ subtasks: form.subtasks.filter((x) => x.id !== s.id) })}><Icon name="close" size={16} color={colors.textTertiary} /></Pressable>
          </Row>
        ))}
        <Row gap={spacing.sm} center>
          <View style={{ flex: 1 }}><Line value={sub} onChangeText={setSub} placeholder="Add a subtask" /></View>
          <Btn small variant="outline" label="Add" disabled={!sub.trim()} onPress={() => { set({ subtasks: [...form.subtasks, { id: `${Date.now()}`, title: sub.trim(), done: false }] }); setSub(""); }} />
        </Row>
      </View>
    </EditorSheet>
  );
}
