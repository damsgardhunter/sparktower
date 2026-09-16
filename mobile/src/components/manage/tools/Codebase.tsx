/**
 * Codebase — the native CodebaseTab (client/src/components/codebase-tab.tsx):
 * point Nova at a GitHub repo or a .zip, read the audit (built %, stage,
 * runtime, what moved, scan facts, secrets, the catch-up, next three things,
 * loops, plan vs code, capabilities, risks and the rest), apply it to the
 * board, pick an earlier audit, and connect the live database. Whether Nova
 * is reading the code right now — started here, on the web, from the editor
 * bridge or by a teammate — comes from /code-audit/status: while one runs the
 * tab says so and won't start another, and when it ends the audits, the path,
 * the sections and the board are re-read.
 */
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, uploadFile } from "../../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../../theme";
import { Btn, Card, Divider, Icon, Meta, Progress, Row, type IconName } from "../../ui";
import { Overline, Tag, Well, useNotify } from "../bits";
import { LOOP_TYPE_INFO, mkey, type LoopType } from "../shared";
import { auditStageLabel, formatElapsed, useAuditStatus } from "../../../sections";
import { CheckRow, Choice, Input, ListLoading, PlanNote, ShortOfCredits, invalidateCredits, useCredits } from "./kit";
import { SecurityReport } from "./SecurityReport";

interface AuditListItem { id: string; source: string; sourceKind: "github" | "upload"; stage: string | null; completionPercent: number | null; summary: string | null; appliedAt: string | null; createdAt: string; operationCount: number }
interface RepoCheck { fullName: string; ref: string; language: string | null; isPrivate: boolean; stars: number }

const STAGE: Record<string, { label: string; color: string }> = {
  empty: { label: "Empty", color: "#64748B" }, scaffold: { label: "Scaffold", color: "#64748B" }, prototype: { label: "Prototype", color: "#D97706" },
  mvp: { label: "MVP", color: "#2563EB" }, beta: { label: "Beta", color: "#7C3AED" }, production: { label: "Production", color: "#059669" },
};
const SEVERITY: Record<string, string> = { high: "#F43F5E", medium: "#F59E0B", low: colors.textTertiary };
const VERDICT: Record<string, { icon: IconName; color: string; label: string }> = {
  complete: { icon: "checkmark-circle", color: "#10B981", label: "Complete" },
  "in-progress": { icon: "ellipse", color: "#3B82F6", label: "In progress" },
  "not-started": { icon: "close-circle-outline", color: colors.textTertiary, label: "Not started" },
};
const CAP_COLOR: Record<string, string> = { built: "#059669", partial: "#D97706", missing: "#E11D48", unreported: colors.textTertiary };
/** shared/capabilities.ts CAPABILITY_AREAS labels. */
const AREA_LABEL: Record<string, string> = {
  auth: "Auth & sessions", rateLimiting: "Rate limiting", moderation: "Moderation & reporting", payments: "Payments & billing",
  ai: "AI routes", analytics: "Analytics & metrics", data: "Data & persistence", tests: "Tests", ci: "CI",
  deploy: "Deploy & operability", mobile: "Mobile",
};
const areaLabel = (id: string) => AREA_LABEL[id] ?? id;

const small = (children: React.ReactNode, color: string = colors.text, key?: React.Key) => (
  <Text key={key} style={{ fontSize: font.xs + 1, color, fontFamily: fontFamily.regular, lineHeight: 17 }}>{children}</Text>
);
const Evidence = ({ paths }: { paths?: string[] }) =>
  paths?.length ? <Text style={{ fontSize: 10, color: colors.textTertiary, fontFamily: undefined }}>{paths.slice(0, 3).join(" · ")}</Text> : null;

function Collapsible({ title, count, icon, children, defaultOpen = false }: { title: string; count?: number; icon: IconName; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={{ borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.md, gap: spacing.sm }}>
      <Pressable onPress={() => setOpen((o) => !o)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={open ? "chevron-down" : "chevron-forward"} size={14} color={colors.text} />
        <Icon name={icon} size={14} color={colors.textTertiary} />
        <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{title}</Text>
        {count !== undefined && <Tag label={String(count)} color={colors.textSecondary} />}
      </Pressable>
      {open && <View style={{ paddingLeft: spacing.lg, gap: spacing.sm }}>{children}</View>}
    </View>
  );
}

export function CodebaseTool({ projectId, repoUrl, isOwner }: { projectId: string; repoUrl?: string | null; isOwner: boolean }) {
  const qc = useQueryClient();
  const { notify, fail } = useNotify();
  const { can, cost, cantAfford, creditsRemaining } = useCredits();
  const [url, setUrl] = useState(repoUrl || "");
  const [token, setToken] = useState("");
  const [tokenOpen, setTokenOpen] = useState(false);
  const [check, setCheck] = useState<RepoCheck | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const price = cost("codeAudit");
  const short = cantAfford("codeAudit");

  const { data: audits } = useQuery({ queryKey: mkey(projectId, "code-audits"), queryFn: () => api<AuditListItem[]>(`/api/projects/${projectId}/code-audits`) });
  const latestId = selectedId || audits?.[0]?.id || null;
  const { data: audit, isLoading: auditLoading } = useQuery({
    queryKey: mkey(projectId, "code-audit", latestId ?? undefined),
    queryFn: () => api<any>(`/api/code-audits/${latestId}`),
    enabled: !!latestId,
  });
  const refreshAll = () => qc.invalidateQueries({ queryKey: ["manage", projectId] });

  const checkRepo = useMutation({
    mutationFn: () => api<RepoCheck>(`/api/projects/${projectId}/code-audit/check-repo`, { method: "POST", body: { repoUrl: url, token: token.trim() || undefined } }),
    onSuccess: setCheck,
    onError: (e) => { setCheck(null); fail(e, "Can't reach that repository. Check the URL."); },
  });
  const run = useMutation({
    mutationFn: (payload: { repoUrl?: string; token?: string; objectPath?: string; fileName?: string }) =>
      api<{ audit: any; creditsCharged: number; autoApplied: { changes: string[] } | null }>(`/api/projects/${projectId}/code-audit`, { method: "POST", body: payload }),
    onSuccess: (r) => {
      setSelectedId(r.audit.id);
      qc.setQueryData(mkey(projectId, "code-audit", r.audit.id), r.audit);
      void refreshAll(); void invalidateCredits(qc);
      const n = r.autoApplied?.changes.length ?? 0;
      notify(`Audit complete · ${r.audit.stage} · ${r.audit.completionPercent}% built · ${r.creditsCharged} credits${n ? ` · Nova updated ${n} thing${n === 1 ? "" : "s"}` : ""}`);
    },
    onError: (e) => fail(e, "The audit failed."),
  });
  const apply = useMutation({
    mutationFn: () => api<{ changes: unknown[]; skipped: unknown[] }>(`/api/code-audits/${latestId}/apply`, { method: "POST" }),
    onSuccess: (r) => { notify(`Board updated — ${r.changes.length} change${r.changes.length === 1 ? "" : "s"}${r.skipped.length ? ` · ${r.skipped.length} skipped` : ""}`); void refreshAll(); },
    onError: (e) => fail(e, "Couldn't apply that. Try again."),
  });

  const pickZip = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ["application/zip", "application/x-zip-compressed"], copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.[0]) return;
      const f = picked.assets[0];
      if (!/\.zip$/i.test(f.name)) { fail(new Error("Export your project as a .zip and upload that."), "Zip files only"); return; }
      setUploading(true);
      const objectPath = await uploadFile({ uri: f.uri, name: f.name, mimeType: f.mimeType || "application/zip", size: f.size });
      run.mutate({ objectPath, fileName: f.name });
    } catch (e) { fail(e, "Upload failed."); } finally { setUploading(false); }
  };

  const findings = audit?.findings ?? {};
  const scan = findings.scan ?? {};
  const runtime = audit?.runtime ?? null;
  const delta = audit?.delta ?? null;
  const status = useAuditStatus(projectId, { expectRunning: run.isPending });
  const remote = status.running;
  const running = run.isPending || uploading || !!remote;

  return (
    <View style={{ gap: spacing.md }}>
      {/* --- Source --- */}
      <Card style={{ gap: spacing.md }}>
        <View style={{ gap: 2 }}>
          <Row center gap={6}><Icon name="scan-outline" size={17} color={colors.primary} /><Text style={{ fontFamily: fontFamily.semibold, fontSize: font.lg, color: colors.text }}>Codebase audit</Text></Row>
          <Meta style={{ fontSize: font.sm, lineHeight: 19 }}>Nova reads your actual code and reconciles it with your plan — what's really built, what's missing, and which tasks are further along than your board says.</Meta>
        </View>
        {remote && (
          <Row center gap={spacing.sm} style={{ backgroundColor: colors.primarySoft, borderRadius: radius.sm, padding: spacing.sm + 2 }}>
            <Icon name="scan-outline" size={16} color={colors.primary} />
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.primary }} testID="audit-running">Nova is reading your code…</Text>
              <Meta>
                {auditStageLabel(remote.stage)} · {formatElapsed(remote.elapsedSeconds)}
                {remote.startedBy?.firstName ? ` · started by ${remote.startedBy.firstName}` : ""}
              </Meta>
            </View>
          </Row>
        )}
        {!remote && status.last?.error && !run.isPending && (
          <Meta style={{ color: colors.danger }}>The last code read didn't finish: {status.last.error}</Meta>
        )}
        {!can("aiMilestones") && <PlanNote title="Codebase audits are on the Builder plan" body="Running one will tell you what to upgrade to." />}

        <Row center gap={6}><Icon name="logo-github" size={14} color={colors.textSecondary} /><Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.textSecondary }}>GitHub repository</Text></Row>
        <Row gap={spacing.sm} center>
          <View style={{ flex: 1 }}><Input value={url} onChangeText={(v) => { setUrl(v); setCheck(null); }} placeholder="https://github.com/you/your-repo" /></View>
          <Btn small variant="outline" icon="checkmark" label="Check" disabled={!url.trim()} loading={checkRepo.isPending} onPress={() => checkRepo.mutate()} />
        </Row>
        {check && (
          <Row center gap={spacing.sm} style={{ borderWidth: 1, borderColor: "#10B98166", backgroundColor: "#10B9811A", borderRadius: radius.sm, padding: spacing.sm + 2 }}>
            <Icon name="checkmark-circle" size={16} color="#10B981" />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{check.fullName} <Text style={{ color: colors.textTertiary, fontFamily: fontFamily.regular }}>@ {check.ref}</Text></Text>
              <Meta numberOfLines={1}>{[check.language, check.isPrivate ? "private" : "public", `${check.stars} stars`].filter(Boolean).join(" · ")}</Meta>
            </View>
          </Row>
        )}
        <Pressable onPress={() => setTokenOpen((o) => !o)} hitSlop={6}>
          <Text style={{ fontSize: font.xs + 1, color: colors.textTertiary, fontFamily: fontFamily.regular, textDecorationLine: "underline" }}>{tokenOpen ? "Hide" : "Private repository?"}</Text>
        </Pressable>
        {tokenOpen && (
          <Well>
            <Input label="GitHub personal access token (read-only)" value={token} onChangeText={(v) => { setToken(v); setCheck(null); }} placeholder="ghp_…" secure />
            <Meta>Used for this audit and never saved — you'll re-enter it next time. Create one with read-only Contents access, and revoke it when you're done.</Meta>
          </Well>
        )}
        <Btn icon="scan-outline" label={running && !uploading ? "Nova is reading your code…" : `Audit this repository (${price})`} loading={run.isPending}
          disabled={!url.trim() || running || short} onPress={() => run.mutate({ repoUrl: url, token: token.trim() || undefined })} />

        <Row center gap={spacing.md}>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} /><Overline>or</Overline><View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
        </Row>
        <Btn variant="outline" icon="cloud-upload-outline" label={`Upload a .zip of your project (${price})`} loading={uploading} disabled={running || short} onPress={pickZip} />
        <Meta>node_modules, build output and lockfiles are ignored, so you can zip the whole folder.</Meta>
        {short && <ShortOfCredits what="An audit" cost={price} have={creditsRemaining} />}
      </Card>

      {/* --- Result --- */}
      {auditLoading ? <ListLoading /> : !audit ? (
        <Card style={{ alignItems: "center", paddingVertical: spacing.xl, gap: spacing.sm }}>
          <Icon name="code-slash-outline" size={36} color={`${colors.textTertiary}66`} />
          <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>No audit yet</Text>
          <Meta style={{ textAlign: "center", fontSize: font.sm }}>Point Nova at your repository and it'll tell you where the project actually is — not where the board says it is.</Meta>
        </Card>
      ) : (
        <Card style={{ gap: spacing.md }}>
          <Row gap={spacing.lg} style={{ alignItems: "flex-start" }}>
            <View>
              <Text style={{ fontSize: 30, fontFamily: fontFamily.bold, color: colors.text }}>{audit.completionPercent}%</Text>
              <Meta>built</Meta>
            </View>
            <View style={{ flex: 1, gap: spacing.sm }}>
              <Row center gap={6} wrap>
                <Tag label={STAGE[audit.stage]?.label ?? audit.stage} color={STAGE[audit.stage]?.color ?? colors.textSecondary} />
                <Meta numberOfLines={1} style={{ flexShrink: 1 }}>{audit.source}</Meta>
              </Row>
              <Progress value={audit.completionPercent || 0} />
              {!!findings.stackSummary && <Meta>{findings.stackSummary}</Meta>}
            </View>
          </Row>
          <Text style={{ fontSize: font.sm, color: colors.textSecondary, fontFamily: fontFamily.regular, lineHeight: 20 }}>{audit.summary}</Text>

          <SecurityReport projectId={projectId} security={findings.security} />

          {runtime && (
            <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm + 2, gap: 3 }}>
              <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>Running?</Text>
              {([["Live URL", runtime.liveUrl], ["Health", runtime.health]] as const).map(([label, r]: any) => (
                <Row key={label} center gap={6}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: !r ? `${colors.textTertiary}66` : r.ok ? "#10B981" : "#F43F5E" }} />
                  {small(<><Text style={{ fontFamily: fontFamily.medium }}>{label}: </Text><Text style={{ color: colors.textTertiary }}>{!r ? "no public URL to probe" : r.ok ? `${r.status} in ${r.ms}ms` : `not answering (${r.status ?? r.error ?? "no response"})`}</Text></>)}
                </Row>
              ))}
              {runtime.surfaces && small(`Kill switches: ${runtime.surfaces.loaded ? "loaded" : "not loaded"}, ${runtime.surfaces.enabled} on${runtime.surfaces.off?.length ? `, off: ${runtime.surfaces.off.join(", ")}` : ""}`, colors.textTertiary)}
              {runtime.env && small(`Env: ${runtime.env.setHere.length}/${runtime.env.referenced} referenced variables set on the ${runtime.env.instance} instance${runtime.env.missingHere?.length ? ` · not set: ${runtime.env.missingHere.slice(0, 8).join(", ")}${runtime.env.missingHere.length > 8 ? " …" : ""}` : ""}`, colors.textTertiary)}
            </View>
          )}

          {delta && (
            <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm + 2, gap: 3 }}>
              <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{delta.previousAuditId ? `Since the last audit (${delta.daysSince} days ago)` : "First audit"}</Text>
              {delta.previousAuditId ? (
                <>
                  {small(delta.changed ? "The code moved." : "No meaningful change in the code.", colors.textTertiary)}
                  {small(`Routes ${delta.routes.before}→${delta.routes.after}${delta.routes.added.length ? ` · added ${delta.routes.added.slice(0, 6).join(", ")}${delta.routes.added.length > 6 ? ` +${delta.routes.added.length - 6}` : ""}` : ""}`)}
                  {small(`Tables ${delta.tables.before}→${delta.tables.after}${delta.tables.added.length ? ` · added ${delta.tables.added.join(", ")}` : ""}`)}
                  {small(`Tests ${delta.tests.before}→${delta.tests.after} files · lines ${delta.linesOfCode.before.toLocaleString()}→${delta.linesOfCode.after.toLocaleString()} · completion ${delta.completionPercent.before ?? "?"}%→${delta.completionPercent.after ?? "?"}%`)}
                  {delta.areas?.length > 0 && small(`Areas moved: ${delta.areas.map((a: any) => `${areaLabel(a.area)} ${a.from}→${a.to}`).join("; ")}`)}
                  {delta.coverage && small(`Writes rate-limited ${delta.coverage.writesRateLimited[0]}→${delta.coverage.writesRateLimited[1]} of ${delta.coverage.writes[1]} · costly metered ${delta.coverage.costlyMetered[0]}→${delta.coverage.costlyMetered[1]}`)}
                </>
              ) : small("Run another audit later and this shows what moved.", colors.textTertiary)}
            </View>
          )}

          <Row wrap gap={spacing.sm}>
            {([
              { icon: "document-text-outline", label: "lines of code", value: (scan.linesOfCode || 0).toLocaleString() },
              { icon: "git-branch-outline", label: "routes found", value: scan.routeCount ?? 0 },
              { icon: "server-outline", label: "data models", value: scan.modelCount ?? scan.dataModels?.length ?? 0 },
              { icon: "flask-outline", label: "test files", value: scan.testFiles ?? 0 },
            ] as { icon: IconName; label: string; value: string | number }[]).map((s) => (
              <View key={s.label} style={{ width: "48%", flexGrow: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.sm + 2 }}>
                <Row center gap={4}><Icon name={s.icon} size={12} color={colors.textTertiary} /><Meta style={{ fontSize: 10 }}>{s.label}</Meta></Row>
                <Text style={{ fontSize: font.lg, fontFamily: fontFamily.semibold, color: colors.text }}>{s.value}</Text>
              </View>
            ))}
          </Row>

          {scan.suspectedSecrets?.length > 0 && (
            <Row gap={spacing.sm} style={{ alignItems: "flex-start", borderWidth: 1, borderColor: "#F43F5E80", backgroundColor: "#F43F5E1A", borderRadius: radius.sm, padding: spacing.md }}>
              <Icon name="shield-outline" size={16} color="#F43F5E" />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>Possible credentials committed to the repository</Text>
                {scan.suspectedSecrets.slice(0, 5).map((s: any, i: number) => small(`${s.file} — ${s.hint}`, colors.textTertiary, i))}
                {small("Rotate them, then remove them from the file and from git history.")}
              </View>
            </Row>
          )}

          <CatchUp projectId={projectId} audit={audit} onApplied={refreshAll} />

          {findings.nextThreeThings?.length > 0 && (
            <Well tone="primary">
              <Overline color={colors.primary}>Do these next</Overline>
              {findings.nextThreeThings.map((t: string, i: number) => (
                <Row key={i} gap={spacing.sm} style={{ alignItems: "flex-start" }}>
                  <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginTop: 2 }}>
                    <Text style={{ fontSize: 9, color: "#FFFFFF", fontFamily: fontFamily.bold }}>{i + 1}</Text>
                  </View>
                  <Text style={{ flex: 1, fontSize: font.sm, color: colors.text, fontFamily: fontFamily.regular, lineHeight: 19 }}>{t}</Text>
                </Row>
              ))}
            </Well>
          )}

          {findings.loops?.length > 0 && (() => {
            const closed = findings.loops.filter((l: any) => l.closure === "closed").length;
            return (
              <Collapsible title="Do your loops close?" count={closed} icon="repeat-outline" defaultOpen>
                {small(`${closed} of ${findings.loops.length} close in the code. A loop is closed only when every step is built and something brings the user back to the first step.`, colors.textTertiary)}
                {findings.loops.map((l: any) => (
                  <View key={l.loopTaskId} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm + 2, gap: 4 }}>
                    <Row center gap={6} wrap>
                      <Icon name={l.closure === "closed" ? "checkmark-circle" : l.closure === "open" ? "warning-outline" : "close-circle-outline"} size={14} color={l.closure === "closed" ? "#10B981" : l.closure === "open" ? "#F59E0B" : colors.textTertiary} />
                      <Overline>{LOOP_TYPE_INFO[l.type as LoopType]?.label ?? l.type}</Overline>
                      <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text, flexShrink: 1 }}>{l.title}</Text>
                      <Tag label={l.closure === "closed" ? "closed" : l.closure === "open" ? "open" : "not built"} color={colors.textSecondary} />
                    </Row>
                    {(l.stages ?? []).map((st: any, i: number) => small(
                      <>{i + 1}. {st.step} <Text style={{ color: colors.textTertiary }}>— {st.status}{st.evidence?.length ? ` · ${st.evidence.join(", ")}` : ""}</Text></>,
                      st.status === "built" ? colors.text : st.status === "partial" ? "#B45309" : colors.textTertiary, i,
                    ))}
                    {l.returnPath && small(<><Text style={{ fontFamily: fontFamily.medium }}>Back to step one via: </Text>{l.returnPath.mechanism}{l.returnPath.evidence?.length ? <Text style={{ color: colors.textTertiary }}> · {l.returnPath.evidence.join(", ")}</Text> : null}</>)}
                    {!!l.breaksAt && small(<><Text style={{ fontFamily: fontFamily.medium }}>Breaks at: </Text>{l.breaksAt}</>)}
                    {!!l.fix && small(<><Text style={{ fontFamily: fontFamily.medium }}>To close it: </Text>{l.fix}</>)}
                    {!!l.note && small(l.note, colors.textTertiary)}
                  </View>
                ))}
              </Collapsible>
            );
          })()}

          {(findings.taskReconciliation?.looksDone?.length > 0 || findings.milestones?.length > 0) && (
            <Collapsible title="Plan vs code" icon="cube-outline" defaultOpen count={(findings.taskReconciliation?.looksDone?.length || 0) + (findings.milestones?.length || 0)}>
              {findings.taskReconciliation?.looksDone?.length > 0 && (
                <View style={{ gap: 3 }}>
                  <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.medium, color: colors.text }}>Open tasks the code says are finished</Text>
                  {findings.taskReconciliation.looksDone.map((t: any, i: number) => (
                    <Row key={i} gap={6} style={{ alignItems: "flex-start" }}><Icon name="checkmark-circle" size={12} color="#10B981" /><View style={{ flex: 1 }}>{small(t.title)}<Evidence paths={t.evidence} /></View></Row>
                  ))}
                </View>
              )}
              {findings.taskReconciliation?.notStarted?.length > 0 && (
                <View style={{ gap: 3 }}>
                  <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.medium, color: colors.text }}>No supporting code found</Text>
                  {findings.taskReconciliation.notStarted.map((t: any, i: number) => (
                    <Row key={i} gap={6} style={{ alignItems: "flex-start" }}><Icon name="close-circle-outline" size={12} color={colors.textTertiary} /><View style={{ flex: 1 }}>{small(<>{t.title}{t.why ? <Text style={{ color: colors.textTertiary }}> — {t.why}</Text> : null}</>)}</View></Row>
                  ))}
                </View>
              )}
              {findings.milestones?.length > 0 && (
                <View style={{ gap: 3 }}>
                  <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.medium, color: colors.text }}>Milestones, judged from the code</Text>
                  {findings.milestones.map((m: any, i: number) => {
                    const v = VERDICT[m.verdict] ?? VERDICT["not-started"];
                    return <Row key={i} gap={6} style={{ alignItems: "flex-start" }}><Icon name={v.icon} size={12} color={v.color} /><View style={{ flex: 1 }}>{small(<><Text style={{ fontFamily: fontFamily.semibold }}>{m.title}</Text> — {v.label}. <Text style={{ color: colors.textTertiary }}>{m.why}</Text></>)}</View></Row>;
                  })}
                </View>
              )}
            </Collapsible>
          )}

          {findings.capabilities?.length > 0 && (
            <Collapsible title="What the code already has" count={findings.capabilities.filter((c: any) => c.status === "built").length} icon="checkmark-circle-outline" defaultOpen>
              {findings.capabilities.map((c: any) => (
                <Row key={c.area} gap={spacing.sm} style={{ alignItems: "flex-start" }}>
                  <Tag label={c.status} color={CAP_COLOR[c.status] ?? colors.textTertiary} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{areaLabel(c.area)}</Text>
                    {!!c.summary && small(c.summary, colors.textTertiary)}
                    {!!c.missing && small(`Missing: ${c.missing}`, colors.textTertiary)}
                    {!!c.detail?.coverage && small(c.detail.coverage)}
                    {(c.detail?.gaps ?? []).map((g: any, i: number) => (
                      <Row key={i} gap={6} style={{ alignItems: "flex-start" }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 6, backgroundColor: g.severity === "high" ? "#F43F5E" : g.severity === "medium" ? "#F59E0B" : `${colors.textTertiary}80` }} />
                        <View style={{ flex: 1 }}>{small(<>{g.item}{g.file ? <Text style={{ color: colors.textTertiary, fontSize: 10 }}>  {g.file}</Text> : null}</>)}</View>
                      </Row>
                    ))}
                    {c.evidence?.length > 0 && <Text numberOfLines={1} style={{ fontSize: 10, color: colors.textTertiary }}>{c.evidence.map((e: any) => e.route ? `${e.route} · ${e.file}` : e.file).join(" · ")}</Text>}
                    {!!c.note && small(c.note, "#B45309")}
                  </View>
                </Row>
              ))}
            </Collapsible>
          )}

          {findings.risks?.length > 0 && (
            <Collapsible title="Risks" count={findings.risks.length} icon="warning-outline" defaultOpen>
              {findings.risks.map((r: any, i: number) => (
                <View key={i} style={{ gap: 2 }}>
                  <Row center gap={6}>
                    <Icon name={r.severity === "high" ? "warning" : "ellipse-outline"} size={12} color={SEVERITY[r.severity] ?? SEVERITY.medium} />
                    <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.medium, color: colors.text }}>{r.area}</Text>
                    <Text style={{ fontSize: 9, color: colors.textTertiary, fontFamily: fontFamily.medium }}>{String(r.severity ?? "").toUpperCase()}</Text>
                  </Row>
                  <View style={{ paddingLeft: 18, gap: 2 }}>
                    {small(r.finding, colors.textTertiary)}
                    {!!r.recommendation && small(<><Text style={{ color: colors.textTertiary }}>Fix: </Text>{r.recommendation}</>)}
                    <Evidence paths={r.evidence} />
                  </View>
                </View>
              ))}
            </Collapsible>
          )}

          {findings.built?.length > 0 && (
            <Collapsible title="Built" count={findings.built.length} icon="checkmark-circle-outline">
              {findings.built.map((b: any, i: number) => <View key={i}>{small(<><Text style={{ color: "#059669" }}>✓ </Text>{b.item}</>)}<Evidence paths={b.evidence} /></View>)}
            </Collapsible>
          )}
          {findings.partial?.length > 0 && (
            <Collapsible title="Partly built" count={findings.partial.length} icon="ellipse-outline">
              {findings.partial.map((b: any, i: number) => (
                <View key={i} style={{ gap: 1 }}>
                  <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.medium, color: colors.text }}>{b.item}</Text>
                  {small(`Has: ${b.exists}`, colors.textTertiary)}{small(`Needs: ${b.missing}`)}<Evidence paths={b.evidence} />
                </View>
              ))}
            </Collapsible>
          )}
          {findings.missing?.length > 0 && (
            <Collapsible title="Missing" count={findings.missing.length} icon="close-circle-outline">
              {findings.missing.map((b: any, i: number) => (
                <View key={i} style={{ gap: 1 }}><Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.medium, color: colors.text }}>{b.item}</Text>{small(b.matters, colors.textTertiary)}</View>
              ))}
            </Collapsible>
          )}
          {findings.undocumented?.length > 0 && (
            <Collapsible title="In the code but not in the plan" count={findings.undocumented.length} icon="cube-outline">
              {findings.undocumented.map((b: any, i: number) => <View key={i}>{small(b.item)}<Evidence paths={b.evidence} /></View>)}
            </Collapsible>
          )}
          {scan.routes?.length > 0 && (
            <Collapsible title="Routes found in the code" count={scan.routeCount} icon="git-branch-outline">
              <Row wrap gap={4}>{scan.routes.slice(0, 60).map((r: any, i: number) => <Tag key={i} label={r.label} color={colors.textSecondary} />)}</Row>
            </Collapsible>
          )}
          {scan.dataModels?.length > 0 && (
            <Collapsible title="Data models" count={scan.modelCount ?? scan.dataModels.length} icon="server-outline">
              <Row wrap gap={4}>{scan.dataModels.map((m: any, i: number) => <Tag key={i} label={m.name} color={colors.textSecondary} />)}</Row>
            </Collapsible>
          )}

          <Divider />
          <Meta>Audited {new Date(audit.createdAt).toLocaleString()}{scan.truncated ? " · partial scan (repository over the size budget)" : ""}</Meta>
          {audit.appliedAt ? (
            <Tag label={`Applied ${new Date(audit.appliedAt).toLocaleDateString()}`} color={colors.textSecondary} />
          ) : (!findings.catchUp && Array.isArray(audit.operations) && audit.operations.length > 0) ? (
            <Btn small icon="color-wand-outline" label={apply.isPending ? "Updating…" : `Make my board match the code (${audit.operations.length})`} loading={apply.isPending} onPress={() => apply.mutate()} style={{ alignSelf: "flex-start" }} />
          ) : null}
        </Card>
      )}

      {/* --- History --- */}
      {(audits?.length || 0) > 1 && (
        <Card style={{ gap: spacing.sm }}>
          <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>Earlier audits</Text>
          {audits!.map((a) => (
            <Pressable key={a.id} onPress={() => setSelectedId(a.id)} style={{ borderRadius: radius.sm, padding: spacing.sm, borderWidth: 1, borderColor: a.id === latestId ? `${colors.primary}66` : "transparent", backgroundColor: a.id === latestId ? colors.primarySoft : "transparent" }}>
              <Row center gap={6}>
                <Icon name={a.sourceKind === "github" ? "logo-github" : "cloud-upload-outline"} size={13} color={colors.textSecondary} />
                <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.medium, color: colors.text }}>{a.completionPercent}% · {a.stage}</Text>
                <Meta numberOfLines={1} style={{ flex: 1 }}>{a.source}</Meta>
                <Meta>{new Date(a.createdAt).toLocaleDateString()}</Meta>
              </Row>
            </Pressable>
          ))}
        </Card>
      )}

      <DataSource projectId={projectId} isOwner={isOwner} />
    </View>
  );
}

// --- Catch-up -------------------------------------------------------------------

/** shared/audit-catchup.ts CATCHUP_SECTIONS, AUDIT_AUTO_APPLY_LABEL and describeOp, restated. */
const CATCHUP_SECTIONS = [
  { id: "drift", label: "Out of date on your board", hint: "Things your board says that the code doesn't — removed or reopened only with your OK" },
  { id: "shipped", label: "Work you shipped", hint: "Recorded as finished tasks" },
  { id: "closed", label: "Tasks that are done", hint: "Moved to done" },
  { id: "path", label: "Path milestones reached", hint: "Checked off on your path" },
  { id: "brief", label: "Brief, scope and stack", hint: "Updated to match where the project is going" },
  { id: "loops", label: "Loops", hint: "Written or rewritten from what the code does" },
  { id: "tasks", label: "What's next", hint: "New and changed tasks" },
  { id: "plan", label: "Milestones and roadmap", hint: "Updated to match the work" },
] as const;
const AUTO_APPLY = [
  { value: "all", label: "Update everything automatically" },
  { value: "safe", label: "Record finished work automatically, ask about the rest" },
  { value: "off", label: "Ask me before changing anything" },
];
function describeOp(op: any): string {
  if (typeof op?._label === "string") return op._label;
  switch (op?.op) {
    case "create_task": return op.status === "done" ? `Record shipped: ${op.title}` : `Add task: ${op.title}`;
    case "update_task": return op.status === "done" ? "Mark done: a task" : `Update task: ${op.title ?? "a task"}`;
    case "complete_path_milestone": return `Check off path milestone ${op.backboneId}`;
    case "update_project": return `Update ${Object.keys(op.fields ?? {}).join(", ")}`;
    case "update_scope": return "Update the scope";
    case "create_loop": return `Write the ${op.type ?? "product"} loop: ${op.title}`;
    case "update_loop": return `Rewrite loop: ${op.title ?? "a loop"}`;
    case "add_loop_steps": return `Add ${Array.isArray(op.steps) ? op.steps.length : 0} build step${op.steps?.length === 1 ? "" : "s"} to a loop`;
    case "retire_loop": return "Retire loop";
    case "retire_task": return `Remove from your board${op.reason ? ` — ${op.reason}` : ""}`;
    case "create_milestone": return `Add milestone: ${op.title}`;
    case "update_milestone": return `Update milestone${op.title ? `: ${op.title}` : ""}`;
    case "update_phase": return `Update roadmap phase${op.title ? `: ${op.title}` : ""}`;
    default: return String(op?.op ?? "change");
  }
}
function summarizeCatchUp(ops: { _section?: string }[]): string {
  const count = (s: string) => ops.filter((o) => o._section === s).length;
  const parts = [
    count("shipped") && `${count("shipped")} piece${count("shipped") === 1 ? "" : "s"} of shipped work to record`,
    count("closed") && `${count("closed")} task${count("closed") === 1 ? "" : "s"} to close`,
    count("path") && `${count("path")} path milestone${count("path") === 1 ? "" : "s"} reached`,
    count("brief") && "brief updates",
    count("loops") && `${count("loops")} loop change${count("loops") === 1 ? "" : "s"}`,
    count("tasks") && `${count("tasks")} task change${count("tasks") === 1 ? "" : "s"}`,
    count("plan") && `${count("plan")} milestone or roadmap change${count("plan") === 1 ? "" : "s"}`,
    count("drift") && `${count("drift")} out-of-date item${count("drift") === 1 ? "" : "s"} on your board to check`,
  ].filter(Boolean) as string[];
  return parts.length ? parts.join(", ") : "Your project already matches the code.";
}

function CatchUp({ projectId, audit, onApplied }: { projectId: string; audit: any; onApplied: () => void }) {
  const qc = useQueryClient();
  const { notify, fail } = useNotify();
  const catchUp = audit?.findings?.catchUp;
  const ops: any[] = Array.isArray(audit?.operations) ? audit.operations : [];
  const pending = ops.filter((o) => !o._status || o._status === "pending");
  const bySection = CATCHUP_SECTIONS.map((s) => ({ ...s, ops: pending.filter((o) => (o._section ?? "plan") === s.id) })).filter((s) => s.ops.length);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const selected = chosen ?? new Set<string>(bySection.map((s) => s.id));
  const [open, setOpen] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [showDropped, setShowDropped] = useState(false);
  const project = qc.getQueryData<any>(mkey(projectId, "project"));
  const [mode, setModeLocal] = useState<string>(project?.auditAutoApply ?? "safe");

  const apply = useMutation({
    mutationFn: () => api<{ changes: unknown[]; skipped: unknown[] }>(`/api/code-audits/${audit.id}/apply`, { method: "POST", body: { sections: [...selected] } }),
    onSuccess: (r) => { notify(`Project updated — ${r.changes.length} change${r.changes.length === 1 ? "" : "s"}${r.skipped.length ? ` · ${r.skipped.length} couldn't be applied` : ""}`); setChosen(null); onApplied(); },
    onError: (e) => fail(e, "Couldn't apply that"),
  });
  const setMode = useMutation({
    mutationFn: (autoApply: string) => api(`/api/projects/${projectId}/audit-settings`, { method: "PUT", body: { autoApply } }),
    onMutate: (m) => setModeLocal(m),
    onSuccess: () => qc.invalidateQueries({ queryKey: mkey(projectId, "project") }),
    onError: (e) => fail(e, "Couldn't save that"),
  });

  if (!catchUp) return null;
  const applied: string[] = catchUp.applied ?? [];
  const pendingCount = bySection.filter((s) => selected.has(s.id)).reduce((n, s) => n + s.ops.length, 0);
  const since = catchUp.since ? new Date(catchUp.since).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;

  return (
    <View style={{ borderWidth: 1, borderColor: `${colors.primary}66`, backgroundColor: colors.primarySoft, borderRadius: radius.sm, padding: spacing.md, gap: spacing.sm }}>
      <Row center gap={6}><Icon name="refresh-outline" size={12} color={colors.primary} /><Overline color={colors.primary}>{since ? `Since ${since}` : "Catching your project up"}</Overline></Row>
      {!!catchUp.note && <Text style={{ fontSize: font.sm, color: colors.text, fontFamily: fontFamily.regular, lineHeight: 19 }}>{catchUp.note}</Text>}
      {(catchUp.files || catchUp.commits?.count) ? small([
        catchUp.files ? `${catchUp.files.added} files added · ${catchUp.files.modified} changed · ${catchUp.files.removed} removed` : null,
        catchUp.commits?.count ? `${catchUp.commits.count} commits` : null,
      ].filter(Boolean).join("  ·  "), colors.textTertiary) : null}

      {applied.length > 0 && (
        <View>
          <Pressable onPress={() => setShowDone((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name={showDone ? "chevron-down" : "chevron-forward"} size={12} color="#047857" />
            <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.medium, color: "#047857" }}>Nova brought {applied.length} thing{applied.length === 1 ? "" : "s"} up to date</Text>
          </Pressable>
          {showDone && <View style={{ paddingLeft: spacing.lg, gap: 2 }}>{applied.map((a, i) => small(`• ${a}`, colors.textTertiary, i))}</View>}
        </View>
      )}

      {bySection.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.medium, color: colors.text }}>Waiting for you: {summarizeCatchUp(pending)}</Text>
          {bySection.map((s) => (
            <View key={s.id} style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 6, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
              <Row center gap={6}>
                <View style={{ flex: 1 }}>
                  <CheckRow on={selected.has(s.id)} title={`${s.label} (${s.ops.length})`} hint={s.hint}
                    onPress={() => { const next = new Set(selected); if (next.has(s.id)) next.delete(s.id); else next.add(s.id); setChosen(next); }} />
                </View>
                <Pressable hitSlop={8} onPress={() => setOpen(open === s.id ? null : s.id)}><Icon name={open === s.id ? "chevron-down" : "chevron-forward"} size={16} color={colors.textTertiary} /></Pressable>
              </Row>
              {open === s.id && <View style={{ paddingLeft: 28, paddingBottom: 6, gap: 2 }}>{s.ops.map((o, i) => small(`• ${describeOp(o)}`, colors.textTertiary, i))}</View>}
            </View>
          ))}
          <Btn small icon="color-wand-outline" label={`Update my project (${pendingCount})`} disabled={!pendingCount} loading={apply.isPending} onPress={() => apply.mutate()} style={{ alignSelf: "flex-start" }} />
          {selected.size < bySection.length && <Meta>Unticked sections are skipped, and Nova won't suggest them again.</Meta>}
        </View>
      ) : small(applied.length ? "Nothing else is waiting." : "Your project already matches the code.", colors.textTertiary)}

      {!!catchUp.skipped?.length && (
        <View style={{ gap: 2 }}>
          {small(`${catchUp.skipped.length} change${catchUp.skipped.length === 1 ? "" : "s"} didn't take:`, "#92400E")}
          {catchUp.skipped.map((x: string, i: number) => small(`• ${x}`, "#92400E", i))}
        </View>
      )}
      {!!catchUp.dropped?.length && (
        <View>
          <Pressable onPress={() => setShowDropped((v) => !v)} style={{ flexDirection: "row", gap: 4, alignItems: "flex-start" }}>
            <Icon name={showDropped ? "chevron-down" : "chevron-forward"} size={12} color={colors.textTertiary} />
            <View style={{ flex: 1 }}>{small(`Left out to keep this short: ${catchUp.dropped.map((d: any) => `${d.count} ${d.reason}`).join(", ")}`, colors.textTertiary)}</View>
          </Pressable>
          {showDropped && catchUp.dropped.map((d: any) => (
            <View key={d.reason} style={{ paddingLeft: spacing.lg, gap: 1 }}>
              {small(d.reason, colors.text)}
              {(d.items ?? []).map((it: string, i: number) => small(`• ${it}`, colors.textTertiary, i))}
            </View>
          ))}
        </View>
      )}
      <View style={{ borderTopWidth: 1, borderColor: `${colors.primary}22`, paddingTop: spacing.sm }}>
        <Choice label="After each audit" value={mode} options={AUTO_APPLY} onChange={(m) => setMode.mutate(m)} />
      </View>
    </View>
  );
}

// --- Your data ------------------------------------------------------------------

function DataSource({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const qc = useQueryClient();
  const { notify, fail } = useNotify();
  const [url, setUrl] = useState("");
  const statusKey = mkey(projectId, "data-source");
  const shapeKey = mkey(projectId, "data-shape");
  const status = useQuery({ queryKey: statusKey, queryFn: () => api<{ configured: boolean; kind: "self" | "connection" | null }>(`/api/projects/${projectId}/data-source`), enabled: isOwner });
  const shapeQ = useQuery({ queryKey: shapeKey, queryFn: () => api<{ shape: any }>(`/api/projects/${projectId}/data-shape`) });
  const done = (r: any) => {
    setUrl("");
    qc.setQueryData(shapeKey, { shape: r.shape ?? null });
    void qc.invalidateQueries({ queryKey: statusKey });
    void qc.invalidateQueries({ queryKey: shapeKey });
    if (r.shape?.error) fail(new Error(r.shape.error), "Saved, but the read failed");
    else if (r.shape) notify(`Read ${r.shape.totals.tables} tables, ${r.shape.totals.rows.toLocaleString()} rows`);
    else if (!r.configured) notify("Data source removed", "info");
  };
  const save = useMutation({ mutationFn: (value: string | null) => api(`/api/projects/${projectId}/data-source`, { method: "PUT", body: { url: value } }), onSuccess: done, onError: (e) => fail(e) });
  const reread = useMutation({ mutationFn: () => api<any>(`/api/projects/${projectId}/data-shape/refresh`, { method: "POST" }), onSuccess: (r) => done({ ...r, configured: true }), onError: (e) => fail(e) });

  const busy = save.isPending || reread.isPending;
  const shape = shapeQ.data?.shape ?? null;
  const configured = status.data?.configured ?? !!shape;
  const tables: any[] = shape?.tables ? [...shape.tables].sort((a, b) => b.rows - a.rows) : [];

  return (
    <Card style={{ gap: spacing.md }}>
      <Row between style={{ alignItems: "flex-start", gap: spacing.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Row center gap={6}><Icon name="server-outline" size={16} color={colors.text} /><Text style={{ fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>Your data</Text></Row>
          <Meta style={{ lineHeight: 16 }}>The live database as a map: tables, keys and row counts, so Nova can tell "built" from "built but nobody uses it". Use a read-only user; the connection is sealed and never shown again.</Meta>
        </View>
        {isOwner && configured && <Btn small variant="outline" icon="refresh" label="Re-read" loading={reread.isPending} disabled={busy} onPress={() => reread.mutate()} />}
      </Row>

      {isOwner && (
        <View style={{ gap: spacing.sm }}>
          <Meta>{status.data?.configured ? (status.data.kind === "self" ? "Reading this application's own database." : "A connection is configured.") : "No data source yet."}</Meta>
          <Row wrap gap={spacing.sm}>
            <Btn small icon="server-outline" label={save.isPending && save.variables === "self" ? "Reading your database…" : "Use my application's database"} loading={save.isPending && save.variables === "self"} disabled={busy} onPress={() => save.mutate("self")} />
            {status.data?.configured && <Btn small variant="ghost" label="Remove" disabled={busy} onPress={() => save.mutate(null)} />}
          </Row>
          <Row gap={spacing.sm} center>
            <View style={{ flex: 1 }}><Input value={url} onChangeText={setUrl} placeholder="or a read-only postgres URL to your database" /></View>
            <Btn small label="Connect" disabled={busy || !url.trim()} loading={save.isPending && save.variables !== "self"} onPress={() => save.mutate(url.trim())} />
          </Row>
        </View>
      )}

      {busy && !shape && <Meta style={{ fontSize: font.sm }}>Reading tables and row counts…</Meta>}
      {shape && !shape.error && (
        <View style={{ gap: spacing.sm }}>
          <Meta>{shape.totals.tables} tables · {shape.totals.rows.toLocaleString()} rows · {shape.totals.emptyTables} empty · read {new Date(shape.at).toLocaleString()}</Meta>
          {tables.slice(0, 40).map((t) => (
            <Row key={t.name} between style={{ borderBottomWidth: 1, borderColor: colors.borderSubtle, paddingBottom: 4 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.medium, color: t.rows ? colors.text : colors.textTertiary }}>{t.name}</Text>
                {t.foreignKeys?.length > 0 && <Meta style={{ fontSize: 10 }}>→ {t.foreignKeys.map((f: any) => f.refTable).join(", ")}</Meta>}
              </View>
              <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.semibold, color: t.rows ? colors.text : colors.textTertiary }}>{t.rows.toLocaleString()}{t.exact ? "" : "~"}</Text>
            </Row>
          ))}
          {tables.length > 40 && <Meta>…and {tables.length - 40} more tables</Meta>}
          {shape.compare && (shape.compare.inCodeNotInDb.length > 0 || shape.compare.inDbNotInCode.length > 0) && (
            <Well tone="warning">
              {small(`In code but not in the database: ${shape.compare.inCodeNotInDb.join(", ") || "none"}`)}
              {small(`In the database but not in code: ${shape.compare.inDbNotInCode.join(", ") || "none"}`)}
            </Well>
          )}
        </View>
      )}
      {!shape && !busy && !isOwner && <Meta>The owner hasn't connected a database yet.</Meta>}
    </Card>
  );
}
