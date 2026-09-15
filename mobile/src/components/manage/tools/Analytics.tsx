/**
 * Analytics — the native AnalyticsTab (client/src/pages/pm-extended-tabs.tsx)
 * with HealthCheckPanel (client/src/components/health-check-panel.tsx) above
 * it: Nova's project health read, fix-this and push-back on each finding, and
 * the activation / retention / revenue / referral event tracker.
 */
import { useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../../theme";
import { Btn, Card, Divider, ErrorNote, Icon, Meta, Progress, Row, errText, type IconName } from "../../ui";
import { EditorSheet, Overline, Tag, Well, useNotify } from "../bits";
import { mkey } from "../shared";
import {
  AskNova, Choice, EmptyCard, Input, ListLoading, RowAction, ShortOfCredits, ToolHeader, UpgradeCard,
  invalidateCredits, useCrud, useCredits,
} from "./kit";

const CATEGORIES = ["activation", "retention", "revenue", "referral"] as const;
const CAT_COLOR: Record<string, string> = { activation: "#3B82F6", retention: "#22C55E", revenue: "#EAB308", referral: "#A855F7" };
const TRACKING = [{ value: "planned", label: "Planned" }, { value: "implemented", label: "Implemented" }, { value: "verified", label: "Verified" }];
const EMPTY = { eventName: "", category: "activation", description: "" };

export function AnalyticsTool({ projectId }: { projectId: string }) {
  const { entitlements, isLoading: entLoading } = useCredits();
  const level: string = entitlements.projectAnalytics ?? "none";
  const allowed = !entLoading && level !== "none";
  const { items, isLoading, create, update, remove } = useCrud<any>(projectId, "analytics-events", { enabled: allowed, retry: false });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const save = () => create.mutate(form, { onSuccess: () => { setOpen(false); setForm(EMPTY); } });

  if (entLoading) return <ListLoading />;
  // Analytics is a paid entitlement; the server 402s the event list on Free.
  if (level === "none") {
    return (
      <UpgradeCard plan="starter" title="See how your project is actually doing"
        description="Track activation, retention, revenue, and referral events so you know what's working — instead of guessing." />
    );
  }

  const grouped = items.reduce<Record<string, any[]>>((acc, e) => { (acc[e.category || "activation"] ??= []).push(e); return acc; }, {});

  return (
    <View style={{ gap: spacing.md }}>
      <HealthCheck projectId={projectId} />

      <ToolHeader title="Analytics Events">
        <Tag label={level} color={colors.textSecondary} />
      </ToolHeader>
      <Row wrap gap={spacing.sm}>
        <AskNova projectId={projectId} surface="analytics" />
        <Btn small icon="add" label="Add Event" onPress={() => setOpen(true)} />
      </Row>
      <Meta style={{ fontSize: font.sm }}>Track activation, retention, revenue, and referral events for your product.</Meta>

      {level === "basic" && (
        <UpgradeCard inline plan="builder" title="Advanced analytics on Builder" description="Get roadmap-linked progress tracking and deeper breakdowns." />
      )}

      {isLoading ? <ListLoading /> : !items.length ? (
        <EmptyCard icon="bar-chart-outline" text="No analytics events defined yet." />
      ) : CATEGORIES.filter((c) => grouped[c]?.length).map((cat) => (
        <View key={cat} style={{ gap: spacing.sm }}>
          <Overline>{cat}</Overline>
          {grouped[cat].map((ev) => (
            <Card key={ev.id} accent={CAT_COLOR[cat]} style={{ gap: spacing.sm }}>
              <Row gap={spacing.sm} style={{ alignItems: "flex-start" }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>{ev.eventName}</Text>
                  {!!ev.description && <Meta>{ev.description}</Meta>}
                </View>
                <RowAction icon="close" color={colors.danger} label="Remove event" onPress={() => remove.mutate(ev.id)} />
              </Row>
              <Choice value={ev.trackingStatus ?? "planned"} options={TRACKING} onChange={(v) => update.mutate({ id: ev.id, data: { trackingStatus: v } })} />
            </Card>
          ))}
        </View>
      ))}

      <EditorSheet visible={open} onClose={() => setOpen(false)} title="New Analytics Event"
        action={{ label: "Save", onPress: save, disabled: !form.eventName.trim(), loading: create.isPending }}>
        <Input label="Event Name" value={form.eventName} onChangeText={(v) => setForm({ ...form, eventName: v })} placeholder="e.g. user_signed_up" />
        <Choice label="Category" value={form.category} options={CATEGORIES.map((c) => ({ value: c as string, label: c[0].toUpperCase() + c.slice(1) }))} onChange={(v) => setForm({ ...form, category: v })} />
        <Input label="Description" value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} placeholder="What does this event track?" multiline />
      </EditorSheet>
    </View>
  );
}

// --- Project health -----------------------------------------------------------

interface Finding { area?: string; severity?: "low" | "medium" | "high"; finding?: string; recommendation?: string; fixable?: boolean }
interface HealthData { checks: any[]; feedback: { id: string; area: string; stance: string; reason: string }[]; canRun: boolean }

const STATUS: Record<string, { label: string; color: string }> = {
  "on-track": { label: "On track", color: "#059669" },
  "at-risk": { label: "At risk", color: "#D97706" },
  stalled: { label: "Stalled", color: "#E11D48" },
};
const SEVERITY: Record<string, { icon: IconName; color: string }> = {
  high: { icon: "warning-outline", color: "#F43F5E" },
  medium: { icon: "information-circle-outline", color: "#F59E0B" },
  low: { icon: "trending-up-outline", color: colors.textTertiary },
};
const STANCES = [
  { value: "disagree", label: "I disagree — this isn't right" },
  { value: "already-handled", label: "Already handled — Nova can't see it" },
  { value: "not-a-priority", label: "Fair, but not a priority right now" },
];
const STANCE_LABEL: Record<string, string> = { disagree: "I disagree", "already-handled": "Already handled", "not-a-priority": "Not a priority right now" };
const areaKey = (area?: string) => (area || "").trim().toLowerCase();

function HealthCheck({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { notify, fail } = useNotify();
  const { can, cost, cantAfford, creditsRemaining, isLoading: entLoading } = useCredits();
  const allowed = can("projectHealthChecks");
  const key = mkey(projectId, "health-checks");
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api<HealthData>(`/api/projects/${projectId}/health-checks`), enabled: allowed });
  const [fixing, setFixing] = useState<number | null>(null);
  const [applied, setApplied] = useState<{ index: number; changes: { description: string }[]; note: string } | null>(null);
  const [disputing, setDisputing] = useState<number | null>(null);
  const [stance, setStance] = useState("disagree");
  const [reason, setReason] = useState("");
  const [sheetError, setSheetError] = useState<string | null>(null);

  const latest = data?.checks?.[0];
  const findings: Finding[] = (latest?.findings as Finding[]) || [];
  const feedback = data?.feedback || [];
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const run = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/health-check`, { method: "POST" }),
    onSuccess: () => { notify("Health check complete"); setApplied(null); void refresh(); void invalidateCredits(qc); },
    onError: (e) => fail(e, "Health check failed."),
  });
  const fix = useMutation({
    mutationFn: async (findingIndex: number) => ({ ...(await api<any>(`/api/projects/${projectId}/health-check/apply`, { method: "POST", body: { checkId: latest?.id, findingIndex } })), findingIndex }),
    onSuccess: (r: any) => {
      setApplied({ index: r.findingIndex, changes: r.changes || [], note: r.note || "" });
      notify(`Nova made ${r.changes?.length || 0} change${r.changes?.length === 1 ? "" : "s"}`);
      void qc.invalidateQueries({ queryKey: ["manage", projectId] });
      void invalidateCredits(qc);
    },
    onError: (e) => fail(e, "Applying the fix failed."),
    onSettled: () => setFixing(null),
  });
  const dispute = useMutation({
    mutationFn: ({ finding, index }: { finding: Finding; index: number }) => api(`/api/projects/${projectId}/health-findings/feedback`, {
      method: "POST", body: { checkId: latest?.id, area: finding.area || `finding-${index}`, finding: finding.finding, stance, reason },
    }),
    onSuccess: () => { notify("Noted — Nova will take that into account on the next check."); setDisputing(null); setReason(""); setStance("disagree"); void refresh(); },
    onError: (e) => setSheetError(errText(e, "Saving your response failed.")),
  });
  const retract = useMutation({
    mutationFn: (id: string) => api(`/api/health-findings/feedback/${id}`, { method: "DELETE" }),
    onSuccess: refresh, onError: (e) => fail(e, "Try again."),
  });

  if (entLoading) return null;
  if (!allowed) {
    return (
      <UpgradeCard plan="pro" title="Know if your project is actually on track"
        description="Nova reviews your scope, momentum, team, and roadmap, then tells you honestly where things stand — and fixes what it can for you." />
    );
  }

  const checkCost = cost("healthCheck");
  const fixCost = cost("healthFix");
  const disputed = disputing === null ? null : findings[disputing];

  return (
    <Card style={{ gap: spacing.md }}>
      <Row gap={spacing.sm} style={{ alignItems: "flex-start" }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Row center gap={6}><Icon name="medkit-outline" size={17} color={colors.primary} /><Text style={{ fontFamily: fontFamily.semibold, fontSize: font.lg, color: colors.text }}>Project health</Text></Row>
          <Meta style={{ fontSize: font.sm }}>Nova's honest read on where this project stands — and it can act on its own advice.</Meta>
        </View>
      </Row>
      <Btn small variant="outline" icon="pulse-outline" label={`${latest ? "Re-run" : "Run check"} (${checkCost})`} loading={run.isPending}
        disabled={cantAfford("healthCheck")} onPress={() => run.mutate()} style={{ alignSelf: "flex-start" }} />
      {cantAfford("healthCheck") && <ShortOfCredits what="A health check" cost={checkCost} have={creditsRemaining} />}

      {isLoading ? <ListLoading /> : !latest ? (
        <Meta style={{ fontSize: font.sm }}>No health check yet. Run one to see where this project actually stands.</Meta>
      ) : (
        <>
          <Row gap={spacing.lg} style={{ alignItems: "flex-start" }}>
            <View>
              <Text style={{ fontSize: 30, fontFamily: fontFamily.bold, color: colors.text }}>{latest.score}</Text>
              <Meta>out of 100</Meta>
            </View>
            <View style={{ flex: 1, gap: spacing.sm }}>
              <Tag label={STATUS[latest.status]?.label ?? latest.status} color={STATUS[latest.status]?.color ?? colors.textSecondary} />
              <Progress value={latest.score ?? 0} />
              <Text style={{ fontSize: font.sm, color: colors.textSecondary, fontFamily: fontFamily.regular, lineHeight: 19 }}>{latest.summary}</Text>
            </View>
          </Row>

          {findings.length > 0 && <Divider />}
          {findings.map((f, i) => {
            const sev = SEVERITY[f.severity || "low"] ?? SEVERITY.low;
            const pushback = feedback.find((fb) => fb.area === areaKey(f.area));
            const result = applied?.index === i ? applied : null;
            const isFixing = fixing === i && fix.isPending;
            return (
              <Row key={i} gap={spacing.sm} style={{ alignItems: "flex-start" }}>
                <Icon name={sev.icon} size={17} color={sev.color} />
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>
                    {f.area || "Finding"}{f.severity ? <Text style={{ fontSize: 10, color: colors.textTertiary, fontFamily: fontFamily.medium }}>{"  "}{f.severity.toUpperCase()}</Text> : null}
                  </Text>
                  {!!f.finding && <Meta style={{ fontSize: font.sm, lineHeight: 19 }}>{f.finding}</Meta>}
                  {!!f.recommendation && <Text style={{ fontSize: font.sm, color: colors.text, fontFamily: fontFamily.regular, lineHeight: 19 }}><Text style={{ color: colors.textTertiary }}>Do this: </Text>{f.recommendation}</Text>}
                  {pushback && (
                    <Well style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
                      <Icon name="chatbox-ellipses-outline" size={14} color={colors.textTertiary} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.semibold, color: colors.text }}>{STANCE_LABEL[pushback.stance] || pushback.stance}</Text>
                        <Meta>{pushback.reason}</Meta>
                      </View>
                      <RowAction icon="close" label="Take this back" onPress={() => retract.mutate(pushback.id)} />
                    </Well>
                  )}
                  {result && (
                    <Well tone="primary">
                      <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.semibold, color: colors.text }}>Nova applied this</Text>
                      {result.changes.map((c, j) => (
                        <Row key={j} gap={6} style={{ alignItems: "flex-start" }}><Icon name="checkmark" size={13} color={colors.success} /><Meta style={{ flex: 1 }}>{c.description}</Meta></Row>
                      ))}
                      {!!result.note && <Meta style={{ color: colors.textSecondary }}>{result.note}</Meta>}
                    </Well>
                  )}
                  <Row wrap gap={spacing.sm}>
                    {f.fixable !== false && !result && (
                      <Btn small variant="outline" icon="color-wand-outline" label={isFixing ? "Nova is working…" : `Have Nova fix this (${fixCost})`} loading={isFixing}
                        disabled={fix.isPending || cantAfford("healthFix")} onPress={() => { setFixing(i); fix.mutate(i); }} />
                    )}
                    {!pushback && (
                      <Btn small variant="ghost" icon="thumbs-down-outline" label="I disagree" onPress={() => { setDisputing(i); setStance("disagree"); setReason(""); setSheetError(null); }} />
                    )}
                  </Row>
                </View>
              </Row>
            );
          })}
          {cantAfford("healthFix") && <Meta style={{ color: colors.danger }}>Having Nova apply a fix costs {fixCost} credits and you have {creditsRemaining}.</Meta>}
          <Meta>
            Checked {new Date(latest.createdAt).toLocaleString()}
            {(data?.checks?.length || 0) > 1 ? ` · ${data!.checks.length} checks on record` : ""}
            {feedback.length > 0 ? ` · ${feedback.length} of your notes carried into the next check` : ""}
          </Meta>
        </>
      )}

      <EditorSheet visible={disputing !== null} onClose={() => setDisputing(null)} title="Push back on this finding"
        subtitle="Nova only sees what's in the project. Tell it what it's missing and it'll factor that into every future check instead of raising this again."
        action={{ label: "Tell Nova", disabled: !reason.trim(), loading: dispute.isPending, onPress: () => disputing !== null && disputed && dispute.mutate({ finding: disputed, index: disputing }) }}>
        {disputed && (
          <View style={{ backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.md, gap: 4 }}>
            <Overline>{disputed.area || "Finding"}</Overline>
            <Text style={{ fontSize: font.sm, color: colors.text, fontFamily: fontFamily.regular }}>{disputed.finding}</Text>
          </View>
        )}
        {sheetError ? <ErrorNote message={sheetError} /> : null}
        <Choice label="What's your position?" value={stance} options={STANCES} onChange={setStance} />
        <Input label="Why? *" value={reason} onChangeText={setReason} multiline rows={5}
          placeholder="e.g. The MVP looks big because I'm reusing a codebase I already have — most of that list is a week of wiring, not months." />
      </EditorSheet>
    </Card>
  );
}
