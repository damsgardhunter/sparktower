/**
 * Research — the native ResearchTab (client/src/pages/pm-extended-tabs.tsx):
 * customer interviews and experiments, each a list with a create sheet, and
 * Nova's research assist.
 */
import { useState } from "react";
import { Text, View } from "react-native";
import { colors, font, fontFamily, spacing } from "../../../theme";
import { Btn, Card, Row } from "../../ui";
import { EditorSheet, Tag } from "../bits";
import { AskNova, Choice, EmptyCard, Input, ListLoading, RowAction, SectionSwitch, StatusTag, ToolHeader, useCrud } from "./kit";

export function ResearchTool({ projectId }: { projectId: string }) {
  const [section, setSection] = useState<"interviews" | "experiments">("interviews");
  return (
    <View style={{ gap: spacing.md }}>
      <Row between wrap style={{ gap: spacing.sm }}>
        <SectionSwitch value={section} onChange={setSection} options={[
          { value: "interviews", label: "Interviews", icon: "people-outline" },
          { value: "experiments", label: "Experiments", icon: "flask-outline" },
        ]} />
        <AskNova projectId={projectId} surface="research" variant="primary" />
      </Row>
      {section === "interviews" ? <Interviews projectId={projectId} /> : <Experiments projectId={projectId} />}
    </View>
  );
}

const SENTIMENT_COLOR: Record<string, string> = { positive: colors.success, negative: colors.danger, neutral: colors.textSecondary };
const EMPTY_INTERVIEW = { intervieweeName: "", intervieweeRole: "", notes: "", keyInsights: "", sentiment: "neutral", status: "planned" };

function Interviews({ projectId }: { projectId: string }) {
  const { items, isLoading, create, update, remove } = useCrud<any>(projectId, "interviews");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_INTERVIEW);
  const save = () => create.mutate(form, { onSuccess: () => { setOpen(false); setForm(EMPTY_INTERVIEW); } });

  return (
    <View style={{ gap: spacing.md }}>
      <ToolHeader title="Customer Interviews">
        <Btn small icon="add" label="Add Interview" onPress={() => setOpen(true)} />
      </ToolHeader>
      {isLoading ? <ListLoading /> : !items.length ? (
        <EmptyCard icon="people-outline" text="No interviews yet. Start talking to customers!" />
      ) : items.map((iv) => (
        <Card key={iv.id} style={{ gap: 6 }}>
          <Row gap={spacing.sm} style={{ alignItems: "flex-start" }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Row wrap center gap={6}>
                <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>{iv.intervieweeName}</Text>
                {!!iv.intervieweeRole && <Tag label={iv.intervieweeRole} color={colors.textSecondary} />}
                <StatusTag status={iv.status} />
                {!!iv.sentiment && iv.sentiment !== "neutral" && <Tag label={iv.sentiment} color={SENTIMENT_COLOR[iv.sentiment]} />}
              </Row>
              {!!iv.notes && <Text style={{ fontSize: font.sm, color: colors.textSecondary, fontFamily: fontFamily.regular, lineHeight: 19 }}>{iv.notes}</Text>}
              {!!iv.keyInsights && <Text style={{ fontSize: font.sm, color: colors.primary, fontFamily: fontFamily.medium, lineHeight: 19 }}>{iv.keyInsights}</Text>}
            </View>
            <RowAction icon={iv.status === "completed" ? "checkmark-circle" : "time-outline"} color={iv.status === "completed" ? colors.success : colors.textSecondary}
              label={iv.status === "completed" ? "Mark planned" : "Mark completed"}
              onPress={() => update.mutate({ id: iv.id, data: { status: iv.status === "planned" ? "completed" : "planned" } })} />
            <RowAction icon="trash-outline" color={colors.danger} label="Delete interview" onPress={() => remove.mutate(iv.id)} />
          </Row>
        </Card>
      ))}

      <EditorSheet visible={open} onClose={() => setOpen(false)} title="New Interview"
        action={{ label: "Save", onPress: save, disabled: !form.intervieweeName.trim(), loading: create.isPending }}>
        <Input label="Name" value={form.intervieweeName} onChangeText={(v) => setForm({ ...form, intervieweeName: v })} />
        <Input label="Role" value={form.intervieweeRole} onChangeText={(v) => setForm({ ...form, intervieweeRole: v })} />
        <Input label="Notes" value={form.notes} onChangeText={(v) => setForm({ ...form, notes: v })} multiline />
        <Input label="Key Insights" value={form.keyInsights} onChangeText={(v) => setForm({ ...form, keyInsights: v })} multiline />
        <Choice label="Sentiment" value={form.sentiment} onChange={(v) => setForm({ ...form, sentiment: v })}
          options={[{ value: "positive", label: "Positive" }, { value: "neutral", label: "Neutral" }, { value: "negative", label: "Negative" }]} />
      </EditorSheet>
    </View>
  );
}

const EMPTY_EXPERIMENT = { hypothesis: "", method: "", metrics: "" };
const EXPERIMENT_STATUSES = [{ value: "planned", label: "Planned" }, { value: "running", label: "Running" }, { value: "completed", label: "Done" }];

function Experiments({ projectId }: { projectId: string }) {
  const { items, isLoading, create, update, remove } = useCrud<any>(projectId, "experiments");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_EXPERIMENT);
  const save = () => create.mutate(form, { onSuccess: () => { setOpen(false); setForm(EMPTY_EXPERIMENT); } });

  return (
    <View style={{ gap: spacing.md }}>
      <ToolHeader title="Experiments">
        <Btn small icon="add" label="Add Experiment" onPress={() => setOpen(true)} />
      </ToolHeader>
      {isLoading ? <ListLoading /> : !items.length ? (
        <EmptyCard icon="flask-outline" text="No experiments yet. Test your assumptions!" />
      ) : items.map((exp) => (
        <Card key={exp.id} style={{ gap: spacing.sm }}>
          <Row gap={spacing.sm} style={{ alignItems: "flex-start" }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>{exp.hypothesis}</Text>
              {!!exp.method && <Text style={{ fontSize: font.sm, color: colors.textSecondary, fontFamily: fontFamily.regular }}>Method: {exp.method}</Text>}
              {!!exp.result && <Text style={{ fontSize: font.sm, color: colors.text, fontFamily: fontFamily.regular }}>Result: {exp.result}</Text>}
              {!!exp.learnings && <Text style={{ fontSize: font.sm, color: colors.primary, fontFamily: fontFamily.regular }}>Learnings: {exp.learnings}</Text>}
            </View>
            <RowAction icon="trash-outline" color={colors.danger} label="Delete experiment" onPress={() => remove.mutate(exp.id)} />
          </Row>
          <Choice value={exp.status} options={EXPERIMENT_STATUSES} onChange={(v) => update.mutate({ id: exp.id, data: { status: v } })} />
        </Card>
      ))}

      <EditorSheet visible={open} onClose={() => setOpen(false)} title="New Experiment"
        action={{ label: "Save", onPress: save, disabled: !form.hypothesis.trim(), loading: create.isPending }}>
        <Input label="Hypothesis" value={form.hypothesis} onChangeText={(v) => setForm({ ...form, hypothesis: v })} placeholder="We believe that..." multiline rows={3} />
        <Input label="Method" value={form.method} onChangeText={(v) => setForm({ ...form, method: v })} placeholder="How will you test?" />
        <Input label="Success Metrics" value={form.metrics} onChangeText={(v) => setForm({ ...form, metrics: v })} placeholder="What defines success?" />
      </EditorSheet>
    </View>
  );
}
