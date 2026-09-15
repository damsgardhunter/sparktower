/**
 * Activity — the native counterpart of ActivityTab in
 * client/src/pages/project-manager.tsx: the activity feed, the decision log,
 * weekly check-ins, and feedback on the project's updates.
 */
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, spacing } from "../../theme";
import { Avatar, Body, Btn, Card, Field, IconButton, Loading, Meta, Row, Segments } from "../ui";
import { Composer } from "../Composer";
import { FeedbackInbox, useNewFeedbackCount } from "../project/FeedbackInbox";
import { CheckIns } from "./CheckIns";
import { Tag, useNotify } from "./bits";
import { mkey } from "./shared";

type Section = "feed" | "decisions" | "checkins" | "feedback";

const DECISION_COLOR: Record<string, string> = { proposed: "#1D4ED8", accepted: "#15803D", revisited: "#A16207" };
const NEXT_STATUS: Record<string, string> = { proposed: "accepted", accepted: "revisited", revisited: "proposed" };

export function Activity({ projectId, projectTitle, initialSection }: { projectId: string; projectTitle: string; initialSection?: Section }) {
  const [section, setSection] = useState<Section>(initialSection ?? "feed");
  const newFeedback = useNewFeedbackCount(projectId);
  return (
    <View style={{ gap: spacing.md }}>
      <Segments
        options={[
          { value: "feed", label: "Activity Feed" },
          { value: "decisions", label: "Decision Log" },
          { value: "checkins", label: "Check-ins" },
          { value: "feedback", label: newFeedback > 0 ? `Feedback · ${newFeedback}` : "Feedback" },
        ]}
        value={section}
        onChange={setSection}
      />
      {section === "feed" && <Feed projectId={projectId} />}
      {section === "decisions" && <Decisions projectId={projectId} />}
      {section === "checkins" && <CheckIns projectId={projectId} projectTitle={projectTitle} />}
      {section === "feedback" && <Feedback projectId={projectId} />}
    </View>
  );
}

function Feed({ projectId }: { projectId: string }) {
  const { data = [], isLoading } = useQuery({ queryKey: mkey(projectId, "activity"), queryFn: () => api<any[]>(`/api/projects/${projectId}/activity`) });
  if (isLoading) return <Loading />;
  return (
    <Card style={{ gap: spacing.md }}>
      <Text style={{ fontSize: font.lg, fontFamily: fontFamily.semibold, color: colors.text }}>Activity Feed</Text>
      {data.length ? data.map((e) => {
        const name = e.user?.firstName || e.user?.email || "System";
        return (
          <Row key={e.id} gap={spacing.sm} style={{ alignItems: "flex-start" }}>
            <Avatar name={name} size={28} />
            <View style={{ flex: 1 }}>
              <Body><Text style={{ fontFamily: fontFamily.semibold }}>{name}</Text> {e.action}{e.metadata?.title || e.metadata?.name ? ` · ${e.metadata.title || e.metadata.name}` : ""}</Body>
              <Meta>{new Date(e.createdAt).toLocaleString()}</Meta>
            </View>
          </Row>
        );
      }) : <Meta style={{ fontSize: font.sm }}>No activity yet. Actions like creating tasks, milestones, and decisions will appear here.</Meta>}
    </Card>
  );
}

function Decisions({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { notify, fail } = useNotify();
  const key = mkey(projectId, "decisions");
  const [form, setForm] = useState<{ title: string; decision: string; context: string } | null>(null);
  const { data = [], isLoading } = useQuery({ queryKey: key, queryFn: () => api<any[]>(`/api/projects/${projectId}/decisions`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: mkey(projectId, "activity") }); };

  const create = useMutation({
    mutationFn: (body: { title: string; decision: string; context: string }) => api(`/api/projects/${projectId}/decisions`, { method: "POST", body }),
    onSuccess: () => { setForm(null); refresh(); notify("Decision logged."); },
    onError: (e) => fail(e, "Couldn't log that decision."),
  });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api(`/api/decisions/${id}`, { method: "PATCH", body: { status } }),
    onSuccess: refresh,
    onError: (e) => fail(e),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/decisions/${id}`, { method: "DELETE" }),
    onSuccess: () => { refresh(); notify("Decision deleted.", "info"); },
    onError: (e) => fail(e),
  });

  return (
    <View style={{ gap: spacing.md }}>
      <Row between>
        <Text style={{ fontSize: font.lg, fontFamily: fontFamily.semibold, color: colors.text }}>Decision Log</Text>
        {!form && <Btn small icon="add" label="Log Decision" onPress={() => setForm({ title: "", decision: "", context: "" })} />}
      </Row>
      {form && (
        <Card>
          <Field value={form.title} onChangeText={(title) => setForm({ ...form, title })} placeholder="Decision title" />
          <Field value={form.decision} onChangeText={(decision) => setForm({ ...form, decision })} placeholder="What was decided?" multiline />
          <Field value={form.context} onChangeText={(context) => setForm({ ...form, context })} placeholder="Context / why this was decided (optional)" multiline />
          <Row gap={spacing.sm}>
            <Btn small label="Save" disabled={!form.title.trim() || !form.decision.trim()} loading={create.isPending} onPress={() => create.mutate(form)} />
            <Btn small variant="outline" label="Cancel" onPress={() => setForm(null)} />
          </Row>
        </Card>
      )}
      {isLoading ? <Loading /> : data.length ? data.map((d) => (
        <Card key={d.id}>
          <Row gap={spacing.sm} style={{ alignItems: "flex-start" }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Row center wrap gap={6}>
                <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>{d.title}</Text>
                <Pressable onPress={() => update.mutate({ id: d.id, status: NEXT_STATUS[d.status] ?? "proposed" })} hitSlop={6} accessibilityLabel="Change status">
                  <Tag label={d.status} color={DECISION_COLOR[d.status] ?? colors.textSecondary} />
                </Pressable>
              </Row>
              <Body>{d.decision}</Body>
              {d.context ? <Meta style={{ fontSize: font.sm }}>{d.context}</Meta> : null}
              <Meta>by {d.user?.firstName || d.user?.email} · {new Date(d.createdAt).toLocaleDateString()}</Meta>
            </View>
            <IconButton name="trash-outline" size={17} color={colors.textTertiary} label="Delete decision" onPress={() => remove.mutate(d.id)} />
          </Row>
        </Card>
      )) : !form && <Meta style={{ fontSize: font.sm }}>No decisions logged yet. Document important choices so the team doesn't re-argue old decisions.</Meta>}
      {data.length > 0 && <Meta>Tap a status to move it along: proposed → accepted → revisited.</Meta>}
    </View>
  );
}

function Feedback({ projectId }: { projectId: string }) {
  const { notify } = useNotify();
  const qc = useQueryClient();
  const [composing, setComposing] = useState(false);
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ marginHorizontal: -spacing.md }}>
        <FeedbackInbox projectId={projectId} notify={(n) => notify(n.text, n.tone)} />
      </View>
      <Btn icon="create-outline" variant="outline" label="Post an update" onPress={() => setComposing(true)} />
      <Composer visible={composing} defaultProjectId={projectId} onClose={() => setComposing(false)}
        onPosted={() => { setComposing(false); void qc.invalidateQueries({ queryKey: ["feed"] }); notify("Update posted."); }} />
    </View>
  );
}
