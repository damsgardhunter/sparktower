/**
 * Launch — the native LaunchTab (client/src/pages/pm-extended-tabs.tsx):
 * landing page copy and the waitlist, the deploy checklist (with the web's
 * default twelve), and the launch plan grouped by channel.
 */
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../api/client";
import { colors, font, fontFamily, spacing } from "../../../theme";
import { Btn, Card, Divider, Icon, Meta, Progress, Row } from "../../ui";
import { EditorSheet, Overline, Tag, useNotify } from "../bits";
import { mkey } from "../shared";
import { Choice, EmptyCard, Input, ListLoading, RowAction, SectionSwitch, ToolHeader, useCrud } from "./kit";

export function LaunchTool({ projectId, project }: { projectId: string; project: any }) {
  const [section, setSection] = useState<"landing" | "checklist" | "plan">("landing");
  return (
    <View style={{ gap: spacing.md }}>
      <SectionSwitch value={section} onChange={setSection} options={[
        { value: "landing", label: "Landing & Waitlist", icon: "eye-outline" },
        { value: "checklist", label: "Deploy Checklist", icon: "checkbox-outline" },
        { value: "plan", label: "Launch Plan", icon: "rocket-outline" },
      ]} />
      {section === "landing" ? <LandingWaitlist projectId={projectId} project={project} />
        : section === "checklist" ? <DeployChecklist projectId={projectId} />
        : <LaunchPlan projectId={projectId} />}
    </View>
  );
}

function LandingWaitlist({ projectId, project }: { projectId: string; project: any }) {
  const qc = useQueryClient();
  const { notify, fail } = useNotify();
  const { items, isLoading, create, remove } = useCrud<any>(projectId, "waitlist");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [config, setConfig] = useState<any>(project?.landingPageConfig || { headline: "", subheadline: "", ctaText: "Join Waitlist", features: [] });
  useEffect(() => { if (project?.landingPageConfig) setConfig(project.landingPageConfig); }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveConfig = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}`, { method: "PATCH", body: { landingPageConfig: config } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: mkey(projectId, "project") }); notify("Landing page config saved"); },
    onError: (e) => fail(e),
  });

  const add = () => {
    if (!email.trim()) return;
    create.mutate({ email: email.trim(), name: name.trim() || undefined, source: "manual" }, { onSuccess: () => { setEmail(""); setName(""); } });
  };

  return (
    <View style={{ gap: spacing.md }}>
      <ToolHeader title="Landing Page Config" />
      <Card style={{ gap: spacing.md }}>
        <Input label="Headline" value={config.headline ?? ""} onChangeText={(v) => setConfig({ ...config, headline: v })} placeholder="Your compelling headline" />
        <Input label="Subheadline" value={config.subheadline ?? ""} onChangeText={(v) => setConfig({ ...config, subheadline: v })} placeholder="Brief value proposition" />
        <Input label="CTA Button Text" value={config.ctaText ?? ""} onChangeText={(v) => setConfig({ ...config, ctaText: v })} />
        <Btn small label="Save Config" loading={saveConfig.isPending} onPress={() => saveConfig.mutate()} style={{ alignSelf: "flex-start" }} />
      </Card>

      <ToolHeader title={`Waitlist (${items.length})`} />
      <Card style={{ gap: spacing.md }}>
        <Input value={email} onChangeText={setEmail} placeholder="Email" />
        <Row gap={spacing.sm} center>
          <View style={{ flex: 1 }}><Input value={name} onChangeText={setName} placeholder="Name (optional)" /></View>
          <Btn small icon="add" label="Add" disabled={!email.trim()} loading={create.isPending} onPress={add} />
        </Row>
        {isLoading ? <ListLoading /> : !items.length ? (
          <Meta style={{ textAlign: "center", fontSize: font.sm, paddingVertical: spacing.md }}>No waitlist signups yet</Meta>
        ) : items.map((e) => (
          <Row key={e.id} between center>
            <Text style={{ flex: 1, fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }} numberOfLines={1}>
              {e.email}{e.name ? <Text style={{ color: colors.textTertiary, fontFamily: fontFamily.regular }}>  ({e.name})</Text> : null}
            </Text>
            <RowAction icon="close" color={colors.danger} label="Remove signup" onPress={() => remove.mutate(e.id)} />
          </Row>
        ))}
      </Card>
    </View>
  );
}

const DEFAULT_CHECKLIST = [
  { item: "SSL/TLS certificate configured", category: "security" },
  { item: "Environment variables set for production", category: "infrastructure" },
  { item: "Database migrations applied", category: "infrastructure" },
  { item: "Error monitoring configured (e.g. Sentry)", category: "monitoring" },
  { item: "Uptime monitoring set up", category: "monitoring" },
  { item: "Performance testing completed", category: "performance" },
  { item: "Security audit / dependency scan", category: "security" },
  { item: "Backup strategy in place", category: "infrastructure" },
  { item: "CI/CD pipeline configured", category: "infrastructure" },
  { item: "Analytics tracking verified", category: "monitoring" },
  { item: "Load testing completed", category: "performance" },
  { item: "API rate limiting configured", category: "security" },
];
const CATEGORIES = [
  { value: "infrastructure", label: "Infrastructure" }, { value: "security", label: "Security" }, { value: "performance", label: "Performance" },
  { value: "monitoring", label: "Monitoring" }, { value: "other", label: "Other" },
];

function DeployChecklist({ projectId }: { projectId: string }) {
  const { items, isLoading, create, update, remove } = useCrud<any>(projectId, "deploy-checklist");
  const [newItem, setNewItem] = useState("");
  const [category, setCategory] = useState("other");
  const completed = items.filter((i) => i.isCompleted).length;
  const total = items.length;
  const pct = total ? Math.round((completed / total) * 100) : 0;

  const seed = () => DEFAULT_CHECKLIST.forEach((c, i) => create.mutate({ ...c, sortOrder: i }));
  const add = () => { if (!newItem.trim()) return; create.mutate({ item: newItem.trim(), category, sortOrder: total }); setNewItem(""); };

  return (
    <View style={{ gap: spacing.md }}>
      <ToolHeader title="Deployment Checklist" subtitle={total > 0 ? `${completed}/${total} completed (${pct}%)` : null}>
        {!isLoading && total === 0 && <Btn small variant="outline" label="Use Default Checklist" loading={create.isPending} onPress={seed} />}
      </ToolHeader>
      {total > 0 && <Progress value={pct} />}
      <Card style={{ gap: spacing.sm }}>
        {isLoading ? <ListLoading /> : items.map((item) => (
          <Row key={item.id} center gap={spacing.sm}>
            <Pressable hitSlop={6} onPress={() => update.mutate({ id: item.id, data: { isCompleted: !item.isCompleted } })} accessibilityRole="checkbox" accessibilityState={{ checked: !!item.isCompleted }}>
              <Icon name={item.isCompleted ? "checkbox" : "square-outline"} size={21} color={item.isCompleted ? colors.success : colors.textTertiary} />
            </Pressable>
            <Text style={{ flex: 1, fontSize: font.sm, fontFamily: fontFamily.regular, color: item.isCompleted ? colors.textTertiary : colors.text, textDecorationLine: item.isCompleted ? "line-through" : "none" }}>{item.item}</Text>
            <Tag label={item.category} color={colors.textSecondary} />
            <RowAction icon="close" color={colors.danger} label="Remove item" onPress={() => remove.mutate(item.id)} />
          </Row>
        ))}
        {total > 0 && <Divider />}
        <Input value={newItem} onChangeText={setNewItem} placeholder="Add checklist item..." />
        <Choice value={category} options={CATEGORIES} onChange={setCategory} />
        <Btn small variant="outline" icon="add" label="Add item" disabled={!newItem.trim()} onPress={add} style={{ alignSelf: "flex-start" }} />
      </Card>
    </View>
  );
}

const LAUNCH_CHANNELS = ["product-hunt", "twitter", "linkedin", "email", "blog", "press", "reddit", "youtube", "podcast", "other"];
const TASK_STATUSES = [{ value: "planned", label: "Planned" }, { value: "in-progress", label: "In Progress" }, { value: "completed", label: "Done" }];
const EMPTY_TASK = { channel: "twitter", task: "", notes: "" };

function LaunchPlan({ projectId }: { projectId: string }) {
  const { items, isLoading, create, update, remove } = useCrud<any>(projectId, "launch-tasks");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_TASK);
  const save = () => create.mutate(form, { onSuccess: () => { setOpen(false); setForm(EMPTY_TASK); } });
  const grouped = items.reduce<Record<string, any[]>>((acc, t) => { (acc[t.channel] ??= []).push(t); return acc; }, {});

  return (
    <View style={{ gap: spacing.md }}>
      <ToolHeader title="Launch Plan & Distribution">
        <Btn small icon="add" label="Add Task" onPress={() => setOpen(true)} />
      </ToolHeader>
      {isLoading ? <ListLoading /> : !items.length ? (
        <EmptyCard icon="rocket-outline" text="No launch tasks yet. Plan your distribution!" />
      ) : Object.entries(grouped).map(([channel, tasks]) => (
        <Card key={channel} style={{ gap: spacing.md }}>
          <Overline>{channel}</Overline>
          {tasks.map((t, i) => (
            <View key={t.id} style={{ gap: 6 }}>
              {i > 0 && <Divider />}
              <Row gap={spacing.sm} style={{ alignItems: "flex-start" }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{t.task}</Text>
                  {!!t.notes && <Meta>{t.notes}</Meta>}
                </View>
                <RowAction icon="close" color={colors.danger} label="Remove task" onPress={() => remove.mutate(t.id)} />
              </Row>
              <Choice value={t.status ?? "planned"} options={TASK_STATUSES} onChange={(v) => update.mutate({ id: t.id, data: { status: v } })} />
            </View>
          ))}
        </Card>
      ))}

      <EditorSheet visible={open} onClose={() => setOpen(false)} title="New Launch Task"
        action={{ label: "Save", onPress: save, disabled: !form.task.trim(), loading: create.isPending }}>
        <Choice label="Channel" value={form.channel} options={LAUNCH_CHANNELS} onChange={(v) => setForm({ ...form, channel: v })} />
        <Input label="Task" value={form.task} onChangeText={(v) => setForm({ ...form, task: v })} placeholder="What needs to be done?" />
        <Input label="Notes" value={form.notes} onChangeText={(v) => setForm({ ...form, notes: v })} multiline />
      </EditorSheet>
    </View>
  );
}
