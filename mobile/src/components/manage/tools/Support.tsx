/**
 * Support — the native SupportTab (client/src/pages/pm-extended-tabs.tsx):
 * tickets with their priority and status, a create sheet, and a ticket sheet
 * to move its status or delete it.
 */
import { useState } from "react";
import { Text, View } from "react-native";
import { colors, font, fontFamily, spacing } from "../../../theme";
import { Btn, Card, Meta, Row } from "../../ui";
import { EditorSheet } from "../bits";
import { Choice, EmptyCard, Input, ListLoading, StatusTag, ToolHeader, useCrud } from "./kit";

const EMPTY = { subject: "", description: "", submitterEmail: "", submitterName: "", priority: "medium" };
const PRIORITIES = [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }];
const STATUSES = [{ value: "open", label: "Open" }, { value: "in-progress", label: "In Progress" }, { value: "resolved", label: "Resolved" }, { value: "closed", label: "Closed" }];

export function SupportTool({ projectId }: { projectId: string }) {
  const { items, isLoading, create, update, remove } = useCrud<any>(projectId, "support-tickets");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [viewId, setViewId] = useState<string | null>(null);
  const view = items.find((t) => t.id === viewId) ?? null;
  const openCount = items.filter((t) => t.status === "open" || t.status === "in-progress").length;
  const save = () => create.mutate(form, { onSuccess: () => { setOpen(false); setForm(EMPTY); } });

  return (
    <View style={{ gap: spacing.md }}>
      <ToolHeader title="Support Tickets" subtitle={openCount > 0 ? `${openCount} open` : null}>
        <Btn small icon="add" label="New Ticket" onPress={() => setOpen(true)} />
      </ToolHeader>

      {isLoading ? <ListLoading /> : !items.length ? (
        <EmptyCard icon="headset-outline" text="No support tickets yet." />
      ) : items.map((t) => (
        <Card key={t.id} onPress={() => setViewId(t.id)} style={{ gap: 4 }}>
          <Row between style={{ alignItems: "flex-start", gap: spacing.sm }}>
            <Text style={{ flex: 1, fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>{t.subject}</Text>
            <Meta>{new Date(t.createdAt).toLocaleDateString()}</Meta>
          </Row>
          <Row wrap gap={6}><StatusTag status={t.priority} /><StatusTag status={t.status} /></Row>
          {!!t.submitterEmail && <Meta>{t.submitterName ? `${t.submitterName} (${t.submitterEmail})` : t.submitterEmail}</Meta>}
        </Card>
      ))}

      <EditorSheet visible={open} onClose={() => setOpen(false)} title="New Support Ticket"
        action={{ label: "Save", onPress: save, disabled: !form.subject.trim(), loading: create.isPending }}>
        <Input label="Subject" value={form.subject} onChangeText={(v) => setForm({ ...form, subject: v })} />
        <Input label="Description" value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} multiline />
        <Input label="Submitter Email" value={form.submitterEmail} onChangeText={(v) => setForm({ ...form, submitterEmail: v })} />
        <Input label="Submitter Name" value={form.submitterName} onChangeText={(v) => setForm({ ...form, submitterName: v })} />
        <Choice label="Priority" value={form.priority} options={PRIORITIES} onChange={(v) => setForm({ ...form, priority: v })} />
      </EditorSheet>

      <EditorSheet visible={!!view} onClose={() => setViewId(null)} title={view?.subject ?? ""}>
        {view && (
          <>
            <Row wrap gap={6}><StatusTag status={view.priority} /></Row>
            <Choice label="Status" value={view.status || "open"} options={STATUSES} onChange={(v) => update.mutate({ id: view.id, data: { status: v } })} />
            {!!view.submitterEmail && <Meta style={{ fontSize: font.sm }}>From: {view.submitterName} ({view.submitterEmail})</Meta>}
            <Text style={{ fontSize: font.sm, color: colors.text, fontFamily: fontFamily.regular, lineHeight: 20 }}>{view.description}</Text>
            <Btn small variant="danger" icon="trash-outline" label="Delete Ticket" style={{ alignSelf: "flex-start" }}
              onPress={() => { remove.mutate(view.id); setViewId(null); }} />
          </>
        )}
      </EditorSheet>
    </View>
  );
}
