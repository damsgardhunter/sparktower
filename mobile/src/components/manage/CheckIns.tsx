/**
 * Weekly check-ins: the list with share, edit, visibility and delete, and
 * the four-field composer. The native counterpart of check-in-list.tsx and
 * check-in-composer.tsx (local draft autosave is web-only for now).
 */
import { useEffect, useMemo, useState } from "react";
import { Alert, Platform, Pressable, Switch, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Avatar, Body, Btn, Card, Cost, Empty, Icon, Label, Loading, Meta, Row } from "../ui";
import { Area, EditorSheet, Line, Tag, Well, shareText, useNotify } from "./bits";
import { CHECK_IN_LIMITS, mkey, validateCheckIn, webUrl, weekLabel, type CheckInDraft } from "./shared";

interface CheckIn {
  id: string; userId: string; weekStart: string; goal: string; proof: string; blocker: string | null; nextStep: string;
  visibility: "unlisted" | "public"; needsFeedback: boolean; createdAt: string; author: { name: string; avatarUrl: string | null };
}

export function CheckIns({ projectId, projectTitle }: { projectId: string; projectTitle: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const { notify, fail } = useNotify();
  const [composing, setComposing] = useState<CheckIn | "new" | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: mkey(projectId, "check-ins"),
    queryFn: () => api<CheckIn[]>(`/api/projects/${projectId}/check-ins`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: mkey(projectId, "check-ins") });

  const setVisibility = useMutation({
    mutationFn: (b: { id: string; visibility: "public" | "unlisted" }) => api<CheckIn>(`/api/check-ins/${b.id}`, { method: "PATCH", body: { visibility: b.visibility } }),
    onSuccess: (c) => { refresh(); notify(c.visibility === "public" ? "Now public — it can appear in the feedback queue" : "Now unlisted — reachable by link only"); },
    onError: (e) => fail(e),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/check-ins/${id}`, { method: "DELETE" }),
    onSuccess: () => { refresh(); notify("Check-in deleted"); },
    onError: (e) => fail(e),
  });

  const share = async (c: CheckIn) => {
    const url = webUrl(`/c/${c.id}`);
    const r = await shareText([`${projectTitle} — this week:`, c.goal, "", `Next: ${c.nextStep}`, "", url].join("\n"));
    if (r === "copied") notify("Link and share text copied");
  };

  if (isLoading) return <View style={{ height: 240 }}><Loading /></View>;

  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <Row between>
          <View style={{ flex: 1 }}>
            <Row center gap={6}><Icon name="locate-outline" size={17} color={colors.primary} /><Text style={{ fontFamily: fontFamily.bold, fontSize: font.lg, color: colors.text }}>Weekly check-ins</Text></Row>
            <Meta>Goal, proof, blocker, next step. Under two minutes.</Meta>
          </View>
          <Btn small icon="add" label="Check in" onPress={() => setComposing("new")} />
        </Row>
      </Card>

      {!data?.length ? (
        <Card>
          <Empty icon="locate-outline" title="No check-ins yet" body="One a week: what you aimed for, what shipped, what's in the way, and the single next thing. It gets a link you can send to anyone." action="Write the first one" onAction={() => setComposing("new")} />
        </Card>
      ) : data.map((c) => {
        const mine = user?.id === c.userId;
        return (
          <Card key={c.id} style={{ gap: spacing.sm }}>
            <Row center gap={spacing.sm}>
              <Avatar name={c.author.name} uri={c.author.avatarUrl} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{c.author.name}</Text>
                <Meta>{weekLabel(c.weekStart)}</Meta>
              </View>
              <Row gap={4}>
                <Tag label={c.visibility === "public" ? "Public" : "Unlisted"} color={colors.textSecondary} />
                {c.needsFeedback && <Tag label="Wants feedback" solid />}
              </Row>
            </Row>
            <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm + 1, color: colors.text, lineHeight: 20 }}>{c.goal}</Text>
            <Body muted>{c.proof}</Body>
            {!!c.blocker && (
              <Row gap={6} style={{ alignItems: "flex-start" }}>
                <Icon name="warning-outline" size={15} color={colors.warning} />
                <Body style={{ flex: 1, color: colors.warning }}>{c.blocker}</Body>
              </Row>
            )}
            <Row gap={6} style={{ alignItems: "flex-start" }}>
              <Icon name="arrow-forward" size={15} color={colors.primary} />
              <Body style={{ flex: 1 }}>{c.nextStep}</Body>
            </Row>
            <View style={{ flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.sm, gap: spacing.lg, flexWrap: "wrap" }}>
              <Action icon="share-outline" label="Share" onPress={() => share(c)} />
              <Action icon="open-outline" label="Open page" onPress={() => router.push(`/c/${c.id}` as any)} />
              {mine && <Action icon="create-outline" label="Edit" onPress={() => setComposing(c)} />}
              {mine && <Action icon={c.visibility === "public" ? "link-outline" : "globe-outline"} label={c.visibility === "public" ? "Make unlisted" : "Make public"} onPress={() => setVisibility.mutate({ id: c.id, visibility: c.visibility === "public" ? "unlisted" : "public" })} />}
              {mine && (
                <Pressable style={{ marginLeft: "auto" }} hitSlop={8} accessibilityLabel="Delete" onPress={() => {
                  if (Platform.OS === "web") { if (window.confirm("Delete this check-in?")) remove.mutate(c.id); }
                  else Alert.alert("Delete this check-in?", undefined, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => remove.mutate(c.id) }]);
                }}>
                  <Icon name="trash-outline" size={17} color={colors.textTertiary} />
                </Pressable>
              )}
            </View>
          </Card>
        );
      })}

      <CheckInComposer projectId={projectId} editing={composing === "new" ? null : composing} open={!!composing} onClose={() => setComposing(null)} />
    </View>
  );
}

function Action({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 5 }, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={16} color={colors.textSecondary} />
      <Text style={{ fontSize: font.xs + 1, color: colors.textSecondary, fontFamily: fontFamily.semibold }}>{label}</Text>
    </Pressable>
  );
}

const EMPTY: CheckInDraft = { goal: "", proof: "", blocker: "", nextStep: "" };

interface Context {
  weekStart: string;
  current: { id: string; goal: string; proof: string; blocker: string | null; nextStep: string; visibility: "unlisted" | "public"; needsFeedback: boolean } | null;
  previous: { goal: string; nextStep: string; weekStart: string } | null;
}

function CheckInComposer({ projectId, open, editing, onClose }: { projectId: string; open: boolean; editing: CheckIn | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { notify, fail } = useNotify();
  const [form, setForm] = useState<CheckInDraft>(EMPTY);
  const [visibility, setVisibility] = useState<"unlisted" | "public">("unlisted");
  const [needsFeedback, setNeedsFeedback] = useState(false);
  const [touched, setTouched] = useState(false);

  const { data: context, isLoading } = useQuery({
    queryKey: mkey(projectId, "check-ins", "context"),
    queryFn: () => api<Context>(`/api/projects/${projectId}/check-ins/context`),
    enabled: open,
  });

  useEffect(() => {
    if (!open) { setTouched(false); return; }
    if (touched) return;
    const existing = editing ?? context?.current;
    if (existing) {
      setForm({ goal: existing.goal, proof: existing.proof, blocker: existing.blocker ?? "", nextStep: existing.nextStep });
      setVisibility(existing.visibility); setNeedsFeedback(existing.needsFeedback);
    } else {
      setForm(EMPTY); setVisibility("unlisted"); setNeedsFeedback(false);
    }
  }, [open, editing, context, touched]);

  const errors = useMemo(() => validateCheckIn(form), [form]);
  const ready = Object.keys(errors).length === 0;
  const set = (patch: Partial<CheckInDraft>) => { setTouched(true); setForm((f) => ({ ...f, ...patch })); };

  const router = useRouter();
  const publish = useMutation({
    mutationFn: () => {
      const body = { ...form, blocker: form.blocker || null, visibility, needsFeedback };
      return editing
        ? api(`/api/check-ins/${editing.id}`, { method: "PATCH", body })
        : api<any>(`/api/projects/${projectId}/check-ins`, { method: "POST", body });
    },
    onSuccess: (c: any) => {
      qc.invalidateQueries({ queryKey: mkey(projectId, "check-ins") });
      if (c?.id) qc.invalidateQueries({ queryKey: ["check-in", c.id] });
      notify(editing ? "Check-in updated" : "Check-in published — share the link so people can give feedback", "success",
        c?.id ? { label: "Open", onPress: () => router.push(`/c/${c.id}` as any) } : undefined);
      onClose();
    },
    onError: (e) => fail(e, "Couldn't publish"),
  });
  const draft = useMutation({
    mutationFn: () => api<any>(`/api/projects/${projectId}/check-ins/draft`, { method: "POST" }),
    onSuccess: (r) => {
      setTouched(true);
      setForm({ goal: r?.draft?.goal || "", proof: r?.draft?.proof || "", blocker: r?.draft?.blocker || "", nextStep: r?.draft?.nextStep || "" });
      notify("Nova wrote a draft — read it before you publish", "info");
      qc.invalidateQueries({ queryKey: ["subscription"] });
    },
    onError: (e) => fail(e, "Nova couldn't draft that"),
  });

  const show = (k: keyof CheckInDraft) => (touched ? errors[k] : undefined);
  const title = editing ? "Edit check-in" : context?.current ? "Edit this week's check-in" : "New check-in";

  const field = (k: keyof CheckInDraft, label: string, hint: string, placeholder: string, multiline?: boolean) => {
    const n = form[k].trim().length;
    const max = CHECK_IN_LIMITS[k].max;
    return (
      <View style={{ gap: spacing.xs }}>
        <Row between><Label>{label}</Label><Text style={{ fontSize: font.xs, color: n > max ? colors.danger : colors.textTertiary, fontFamily: fontFamily.medium }}>{n}/{max}</Text></Row>
        {multiline ? <Area value={form[k]} onChangeText={(v) => set({ [k]: v })} placeholder={placeholder} rows={3} /> : <Line value={form[k]} onChangeText={(v) => set({ [k]: v })} placeholder={placeholder} />}
        {show(k) ? <Meta style={{ color: colors.danger }}>{show(k)}</Meta> : <Meta>{hint}</Meta>}
      </View>
    );
  };

  return (
    <EditorSheet
      visible={open} onClose={onClose} title={title}
      subtitle={`${weekLabel(editing?.weekStart ?? context?.weekStart) || "This week"} · aim for under two minutes`}
      footer={
        <Row between>
          <Row center gap={5}>
            <Icon name={ready ? "checkmark-circle" : "alert-circle-outline"} size={16} color={ready ? colors.success : touched ? colors.warning : colors.textTertiary} />
            <Meta>{ready ? "Ready" : touched ? `${Object.keys(errors).length} to fix` : "Four fields"}</Meta>
          </Row>
          <Btn label={editing || context?.current ? "Save changes" : "Publish"} disabled={!ready} loading={publish.isPending} onPress={() => { setTouched(true); publish.mutate(); }} />
        </Row>
      }
    >
      {isLoading && !editing ? <View style={{ height: 160 }}><Loading /></View> : (
        <>
          {context?.previous && !editing && (
            <Well>
              <Text style={{ fontSize: 10.5, fontFamily: fontFamily.semibold, color: colors.textTertiary, textTransform: "uppercase", letterSpacing: 0.6 }}>Last week you said</Text>
              <Body><Text style={{ color: colors.textTertiary }}>Goal: </Text>{context.previous.goal}</Body>
              <Body><Text style={{ color: colors.textTertiary }}>Next: </Text>{context.previous.nextStep}</Body>
              <Btn small variant="outline" label="Use as this week's goal" onPress={() => set({ goal: context.previous!.nextStep })} style={{ alignSelf: "flex-start" }} />
            </Well>
          )}
          <Row center gap={spacing.sm}>
            <Btn variant="outline" icon="sparkles" label={draft.isPending ? "Nova is reading your week…" : "Draft this with Nova"} loading={draft.isPending} onPress={() => draft.mutate()} style={{ flex: 1 }} />
            <Cost credits={1} />
          </Row>
          {field("goal", "Weekly goal", "One sentence. What were you aiming for?", "Get the check-in loop working end to end")}
          {field("proof", "Proof — what shipped", "Link it, or name the thing that exists now.", "Shipped the public check-in page — sparktower.app/c/…", true)}
          {field("blocker", "Blocker (optional)", "What's in the way, if anything.", "Stripe review is taking longer than expected", true)}
          {field("nextStep", "Next step", "One thing, starting with a verb.", "Ship the comment box on check-in pages")}

          <View style={{ gap: spacing.sm }}>
            <Label>Who can see it</Label>
            {([
              { key: "unlisted", icon: "link-outline", title: "Unlisted", blurb: "Anyone with the link. Listed nowhere." },
              { key: "public", icon: "globe-outline", title: "Public", blurb: "Can appear in the feedback queue and on your project." },
            ] as const).map((o) => (
              <Pressable key={o.key} onPress={() => setVisibility(o.key)} style={{ borderWidth: visibility === o.key ? 1.5 : 1, borderColor: visibility === o.key ? colors.primary : colors.border, backgroundColor: visibility === o.key ? colors.primarySoft : colors.surface, borderRadius: radius.sm, padding: spacing.md, flexDirection: "row", gap: spacing.sm }}>
                <Icon name={o.icon} size={18} color={visibility === o.key ? colors.primary : colors.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{o.title}</Text>
                  <Meta>{o.blurb}</Meta>
                </View>
                {visibility === o.key && <Icon name="checkmark-circle" size={18} color={colors.primary} />}
              </Pressable>
            ))}
            <Row center gap={spacing.md} style={{ paddingTop: spacing.xs }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>Ask for feedback</Text>
                <Meta>Puts this in the feedback queue. Makes it public.</Meta>
              </View>
              <Switch value={needsFeedback} onValueChange={(v) => { setNeedsFeedback(v); if (v) setVisibility("public"); }} trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#FFFFFF" />
            </Row>
          </View>
        </>
      )}
    </EditorSheet>
  );
}
