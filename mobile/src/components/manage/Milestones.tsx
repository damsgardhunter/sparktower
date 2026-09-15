/**
 * The project's own milestones as a timeline: create, edit, set status,
 * delete. The path's authored milestones live on the dashboard's map.
 */
import { useState } from "react";
import { Alert, Platform, Pressable, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, spacing } from "../../theme";
import { Body, Btn, Card, Empty, Field, Icon, Label, Loading, Meta, Row } from "../ui";
import { Area, Bubble, EditorSheet, Line, Tag, useNotify } from "./bits";
import { mkey, useRefreshPath } from "./shared";

const STATUS = [
  { id: "planned", label: "Planned", color: colors.info },
  { id: "in-progress", label: "In progress", color: colors.warning },
  { id: "completed", label: "Completed", color: colors.success },
];

interface Milestone { id: string; title: string; description: string | null; targetDate: string | null; status: string; order: number }

export function Milestones({ projectId }: { projectId: string }) {
  const refresh = useRefreshPath(projectId);
  const { notify, fail } = useNotify();
  const [editing, setEditing] = useState<Milestone | "new" | null>(null);
  const [form, setForm] = useState({ title: "", description: "", targetDate: "", status: "planned" });

  const { data, isLoading } = useQuery({
    queryKey: mkey(projectId, "milestones"),
    queryFn: () => api<Milestone[]>(`/api/projects/${projectId}/milestones`),
  });

  const open = (m: Milestone | "new") => {
    setEditing(m);
    setForm(m === "new"
      ? { title: "", description: "", targetDate: "", status: "planned" }
      : { title: m.title, description: m.description ?? "", targetDate: m.targetDate ? new Date(m.targetDate).toISOString().slice(0, 10) : "", status: m.status });
  };

  const dateOk = !form.targetDate || /^\d{4}-\d{2}-\d{2}$/.test(form.targetDate);
  const save = useMutation({
    mutationFn: () => {
      const body = { title: form.title.trim(), description: form.description, targetDate: form.targetDate || null, status: form.status };
      return editing && editing !== "new"
        ? api(`/api/milestones/${editing.id}`, { method: "PATCH", body })
        : api(`/api/projects/${projectId}/milestones`, { method: "POST", body });
    },
    onSuccess: () => { refresh(); notify(editing === "new" ? "Milestone created" : "Milestone saved"); setEditing(null); },
    onError: (e) => fail(e),
  });
  const setStatus = useMutation({
    mutationFn: (b: { id: string; status: string }) => api(`/api/milestones/${b.id}`, { method: "PATCH", body: { status: b.status } }),
    onSuccess: refresh, onError: (e) => fail(e),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/milestones/${id}`, { method: "DELETE" }),
    onSuccess: () => { refresh(); notify("Milestone deleted"); setEditing(null); },
    onError: (e) => fail(e),
  });

  if (isLoading) return <View style={{ height: 240 }}><Loading /></View>;
  const sorted = [...(data ?? [])].sort((a, b) => (a.targetDate && b.targetDate ? new Date(a.targetDate).getTime() - new Date(b.targetDate).getTime() : a.order - b.order));

  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <Row between>
          <View>
            <Text style={{ fontFamily: fontFamily.bold, fontSize: font.lg, color: colors.text }}>Milestones</Text>
            <Meta>{sorted.length} milestone{sorted.length === 1 ? "" : "s"} · {sorted.filter((m) => m.status === "completed").length} completed</Meta>
          </View>
          <Btn small icon="add" label="New" onPress={() => open("new")} />
        </Row>
      </Card>

      {sorted.length === 0 ? (
        <Card><Empty icon="flag-outline" title="No milestones yet" body="Mark the moments that matter — a launch, the first paying customer, a raise." /></Card>
      ) : (
        <View>
          {sorted.map((m, i) => {
            const st = STATUS.find((s) => s.id === m.status) ?? STATUS[0];
            const nextStatus = m.status === "planned" ? "in-progress" : m.status === "in-progress" ? "completed" : null;
            return (
              <Row key={m.id} gap={spacing.md} style={{ alignItems: "stretch" }}>
                <View style={{ alignItems: "center", width: 32 }}>
                  <View style={{ width: 2, height: 14, backgroundColor: i === 0 ? "transparent" : colors.border }} />
                  <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: m.status === "completed" ? colors.success : m.status === "in-progress" ? colors.warning : colors.surface, borderWidth: m.status === "planned" ? 1.5 : 0, borderColor: colors.border }}>
                    <Icon name={m.status === "completed" ? "checkmark" : "flag"} size={15} color={m.status === "planned" ? colors.textTertiary : "#FFFFFF"} />
                  </View>
                  <View style={{ width: 2, flex: 1, backgroundColor: i === sorted.length - 1 ? "transparent" : colors.border }} />
                </View>
                <View style={{ flex: 1, paddingVertical: spacing.xs }}>
                  <Card onPress={() => open(m)}>
                    <Row between style={{ alignItems: "flex-start" }} gap={spacing.sm}>
                      <Text style={{ flex: 1, fontFamily: fontFamily.semibold, fontSize: font.sm + 1, color: colors.text }}>{m.title}</Text>
                      <Tag label={st.label} color={st.color} />
                    </Row>
                    {!!m.description && <Body muted numberOfLines={3}>{m.description}</Body>}
                    <Row between>
                      {m.targetDate ? <Row center gap={4}><Icon name="calendar-outline" size={12} color={colors.textTertiary} /><Meta>Target {new Date(m.targetDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</Meta></Row> : <View />}
                      {nextStatus && (
                        <Pressable hitSlop={6} onPress={() => setStatus.mutate({ id: m.id, status: nextStatus })}>
                          <Text style={{ color: colors.primary, fontSize: font.xs + 1, fontFamily: fontFamily.semibold }}>{nextStatus === "completed" ? "Complete" : "Start"}</Text>
                        </Pressable>
                      )}
                    </Row>
                  </Card>
                </View>
              </Row>
            );
          })}
        </View>
      )}

      <EditorSheet
        visible={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "New milestone" : "Edit milestone"}
        action={{ label: "Save", onPress: () => save.mutate(), disabled: !form.title.trim() || !dateOk, loading: save.isPending }}
        footer={editing && editing !== "new" ? (
          <Btn variant="danger" icon="trash-outline" label="Delete milestone" loading={remove.isPending} onPress={() => {
            const id = (editing as Milestone).id;
            if (Platform.OS === "web") { if (window.confirm("Delete this milestone?")) remove.mutate(id); }
            else Alert.alert("Delete this milestone?", form.title, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => remove.mutate(id) }]);
          }} />
        ) : undefined}
      >
        <Field label="Title" value={form.title} onChangeText={(v) => setForm({ ...form, title: v })} placeholder="e.g. First 10 paying customers" />
        <View style={{ gap: spacing.xs }}><Label>Description</Label><Area value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} placeholder="Description (optional)" rows={3} /></View>
        <View style={{ gap: spacing.xs }}>
          <Label>Target date</Label>
          <Line value={form.targetDate} onChangeText={(v) => setForm({ ...form, targetDate: v })} placeholder="YYYY-MM-DD" maxLength={10} />
          {!dateOk && <Meta style={{ color: colors.danger }}>Use YYYY-MM-DD</Meta>}
        </View>
        <View style={{ gap: spacing.sm }}>
          <Label>Status</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {STATUS.map((s) => <Bubble key={s.id} label={s.label} on={form.status === s.id} onPress={() => setForm({ ...form, status: s.id })} />)}
          </View>
        </View>
      </EditorSheet>
    </View>
  );
}
