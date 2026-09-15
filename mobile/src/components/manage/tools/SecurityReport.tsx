/**
 * Security before release — the audit's `findings.security`: a 0–100 score,
 * release blockers, Nova's prioritised fixes and the checklist behind them.
 * Each missing or partial check, and each fix, can go straight onto the board
 * as a "security" task. Older audits have no security read; they get a
 * one-line nudge to run a new one.
 */
import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../../theme";
import { Icon, Row, type IconName } from "../../ui";
import { Overline, Tag, useNotify } from "../bits";
import { mkey } from "../shared";

type Severity = "high" | "medium" | "low";
type CheckStatus = "pass" | "partial" | "missing" | "n/a";
type Category = "transport" | "sessions" | "input" | "secrets" | "supply-chain" | "accounts" | "operations";
interface SecurityCheck { id: string; label: string; category: Category; severity: Severity; status: CheckStatus; detail: string; why: string; fix: string; evidence: string[] }
interface SecurityPlanItem { title: string; severity: Severity; why: string; fix: string; files: string[]; checkId: string | null }
export interface SecurityFindings {
  score: number; blockers: number;
  counts: { pass: number; partial: number; missing: number; na: number };
  checks: SecurityCheck[]; plan: SecurityPlanItem[];
}

/** The server's security category labels, restated. */
const CATEGORY_LABEL: Record<Category, string> = {
  transport: "Headers & transport", sessions: "Sessions & cookies", input: "Input & output", secrets: "Secrets",
  "supply-chain": "Dependencies & CI", accounts: "Accounts & access", operations: "Operations",
};
const GREEN = "#10B981", AMBER = "#F59E0B", RED = "#F43F5E";
const SEVERITY_COLOR: Record<Severity, string> = { high: RED, medium: AMBER, low: colors.textTertiary };
const STATUS: Record<CheckStatus, { icon: IconName; color: string }> = {
  missing: { icon: "close-circle", color: RED },
  partial: { icon: "alert-circle", color: AMBER },
  pass: { icon: "checkmark-circle", color: GREEN },
  "n/a": { icon: "remove-circle-outline", color: colors.textTertiary },
};
const scoreColor = (n: number) => (n >= 85 ? GREEN : n >= 60 ? AMBER : RED);

const line = (children: React.ReactNode, color: string = colors.text, numberOfLines?: number) => (
  <Text selectable={!numberOfLines} numberOfLines={numberOfLines} style={{ fontSize: font.xs + 1, color, fontFamily: fontFamily.regular, lineHeight: 17 }}>{children}</Text>
);
const Files = ({ paths }: { paths?: string[] }) =>
  paths?.length ? <Text selectable style={{ fontSize: 10, color: colors.textTertiary, fontFamily: fontFamily.regular }}>{paths.slice(0, 5).join(" · ")}{paths.length > 5 ? ` +${paths.length - 5}` : ""}</Text> : null;

/** Adds one security fix to the board; remembers which went on this session. */
function useAddToBoard(projectId: string) {
  const qc = useQueryClient();
  const { notify, fail } = useNotify();
  const [added, setAdded] = useState<Set<string>>(new Set());
  // Already on the board — from an earlier visit, the website, or a teammate — by its title.
  const { data: board } = useQuery({ queryKey: mkey(projectId, "kanban"), queryFn: () => api<{ title: string; tags?: string[] | null }[]>(`/api/projects/${projectId}/kanban`) });
  const onBoard = (title: string) => (board ?? []).some((t) => t.title.trim().toLowerCase() === `security: ${title}`.trim().toLowerCase() && !(t.tags ?? []).some((x) => x.startsWith("archived:")));
  const add = useMutation({
    mutationFn: (x: { key: string; title: string; why: string; fix: string; severity: Severity }) =>
      api(`/api/projects/${projectId}/kanban`, {
        method: "POST",
        body: { title: `Security: ${x.title}`, description: `${x.fix}\n\nWhy: ${x.why}`, priority: x.severity === "high" ? "high" : "medium", status: "todo", tags: ["security"] },
      }),
    onSuccess: (_r, x) => {
      setAdded((s) => new Set(s).add(x.key));
      notify(`Added to your board: ${x.title}`);
      for (const k of ["kanban", "milestones", "briefing"]) void qc.invalidateQueries({ queryKey: mkey(projectId, k) });
    },
    onError: (e) => fail(e, "Couldn't add that to the board."),
  });
  return { added, add, onBoard };
}

function AddButton({ onBoard, loading, onPress }: { onBoard: boolean; loading: boolean; onPress: () => void }) {
  const tint = onBoard ? GREEN : colors.primary;
  return (
    <Pressable onPress={onPress} disabled={onBoard || loading} hitSlop={6} accessibilityRole="button"
      style={({ pressed }) => [{
        flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", borderRadius: radius.pill,
        paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: onBoard ? `${GREEN}55` : `${colors.primary}66`,
        backgroundColor: onBoard ? `${GREEN}14` : colors.surface,
      }, (pressed || loading) && { opacity: 0.6 }]}>
      {loading ? <ActivityIndicator size="small" color={tint} style={{ transform: [{ scale: 0.7 }] }} /> : <Icon name={onBoard ? "checkmark" : "add"} size={13} color={tint} />}
      <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: tint }}>{onBoard ? "On your board" : loading ? "Adding…" : "Add to board"}</Text>
    </Pressable>
  );
}

export function SecurityReport({ projectId, security }: { projectId: string; security: SecurityFindings | null | undefined }) {
  const { added, add, onBoard } = useAddToBoard(projectId);
  const [openPlan, setOpenPlan] = useState<number | null>(null);
  const [openCheck, setOpenCheck] = useState<string | null>(null);
  const [showPassed, setShowPassed] = useState(false);

  if (!security) {
    return (
      <Row center gap={6} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm + 2 }}>
        <Icon name="shield-outline" size={14} color={colors.textTertiary} />
        <Text style={{ flex: 1, fontSize: font.xs + 1, color: colors.textTertiary, fontFamily: fontFamily.regular }}>Run a new audit to check security before release.</Text>
      </Row>
    );
  }

  const checks = security.checks ?? [];
  const plan = security.plan ?? [];
  const open = checks.filter((c) => c.status === "missing" || c.status === "partial");
  const passed = checks.filter((c) => c.status === "pass" || c.status === "n/a");
  const color = scoreColor(security.score);
  const pending = (key: string) => add.isPending && add.variables?.key === key;
  const counts = [
    `${security.counts.pass} pass`, `${security.counts.partial} partial`, `${security.counts.missing} missing`,
    security.counts.na ? `${security.counts.na} n/a` : null,
  ].filter(Boolean).join(" · ");

  const renderCheck = (c: SecurityCheck) => {
    const st = STATUS[c.status] ?? STATUS["n/a"];
    const isOpen = openCheck === c.id;
    const actionable = c.status === "missing" || c.status === "partial";
    const key = `check:${c.id}`;
    return (
      <View key={c.id} testID={`security-check-${c.id}`} style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.sm + 2, gap: 4 }}>
        <Pressable onPress={() => setOpenCheck(isOpen ? null : c.id)} onLongPress={() => {}} delayLongPress={350} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <View style={{ marginTop: 1 }}><Icon name={st.icon} size={16} color={st.color} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Row center gap={6} wrap>
              <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: c.status === "n/a" ? colors.textTertiary : colors.text, flexShrink: 1 }}>{c.label}</Text>
              {actionable && <Tag label={c.severity} color={SEVERITY_COLOR[c.severity] ?? AMBER} />}
            </Row>
            {line(c.detail, colors.textTertiary, isOpen ? undefined : 1)}
          </View>
          <Icon name={isOpen ? "chevron-down" : "chevron-forward"} size={14} color={colors.textTertiary} />
        </Pressable>
        {isOpen && (
          <View style={{ paddingLeft: 24, gap: 4 }}>
            <Overline>{CATEGORY_LABEL[c.category] ?? c.category}</Overline>
            {!!c.why && line(<><Text style={{ fontFamily: fontFamily.medium }}>Why it matters: </Text>{c.why}</>)}
            {!!c.fix && line(<><Text style={{ fontFamily: fontFamily.medium }}>Fix: </Text>{c.fix}</>)}
            <Files paths={c.evidence} />
          </View>
        )}
        {actionable && (
          <View style={{ paddingLeft: 24 }}>
            <AddButton onBoard={added.has(key) || onBoard(c.label)} loading={pending(key)}
              onPress={() => add.mutate({ key, title: c.label, why: c.why, fix: c.fix, severity: c.severity })} />
          </View>
        )}
      </View>
    );
  };

  return (
    <View testID="security-report" style={{ borderWidth: 1, borderColor: security.blockers ? `${RED}55` : colors.border, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.md, gap: spacing.sm }}>
      {/* Header */}
      <Row center gap={6} wrap>
        <Icon name="shield-checkmark-outline" size={17} color={color} />
        <Text style={{ fontSize: font.base, fontFamily: fontFamily.semibold, color: colors.text, flexShrink: 1 }}>Security before release</Text>
        <View style={{ flex: 1 }} />
        <Text style={{ fontSize: font.lg, fontFamily: fontFamily.bold, color }}>{security.score}<Text style={{ fontSize: font.xs + 1, color: colors.textTertiary, fontFamily: fontFamily.medium }}>/100</Text></Text>
      </Row>
      <Row center gap={8} wrap>
        <Tag solid label={security.blockers ? `${security.blockers} release blocker${security.blockers === 1 ? "" : "s"}` : "No release blockers"} color={security.blockers ? RED : GREEN} />
        <Text style={{ fontSize: font.xs + 1, color: colors.textSecondary, fontFamily: fontFamily.regular }}>{counts}</Text>
      </Row>

      {/* Fix first */}
      {plan.length > 0 && (
        <View style={{ borderWidth: 1, borderColor: `${colors.primary}55`, backgroundColor: colors.primarySoft, borderRadius: radius.sm, padding: spacing.sm + 2, gap: spacing.sm }}>
          <Overline color={colors.primary}>Fix first</Overline>
          {plan.map((p, i) => {
            const isOpen = openPlan === i;
            const key = `plan:${i}:${p.title}`;
            return (
              <View key={key} style={{ gap: 4, borderTopWidth: i ? 1 : 0, borderColor: `${colors.primary}22`, paddingTop: i ? spacing.sm : 0 }}>
                <Pressable onPress={() => setOpenPlan(isOpen ? null : i)} onLongPress={() => {}} delayLongPress={350} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                  <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginTop: 2 }}>
                    <Text style={{ fontSize: 9, color: "#FFFFFF", fontFamily: fontFamily.bold }}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Row center gap={6} wrap>
                      <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text, flexShrink: 1 }}>{p.title}</Text>
                      <Tag label={p.severity} color={SEVERITY_COLOR[p.severity] ?? AMBER} />
                    </Row>
                    {line(p.why, colors.textSecondary, isOpen ? undefined : 2)}
                  </View>
                  <Icon name={isOpen ? "chevron-down" : "chevron-forward"} size={14} color={colors.textTertiary} />
                </Pressable>
                {isOpen && (
                  <View style={{ paddingLeft: 24, gap: 4 }}>
                    {!!p.fix && line(<><Text style={{ fontFamily: fontFamily.medium }}>Fix: </Text>{p.fix}</>)}
                    <Files paths={p.files} />
                  </View>
                )}
                <View style={{ paddingLeft: 24 }}>
                  <AddButton onBoard={added.has(key) || onBoard(p.title)} loading={pending(key)}
                    onPress={() => add.mutate({ key, title: p.title, why: p.why, fix: p.fix, severity: p.severity })} />
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Checklist */}
      {open.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Overline>Needs work ({open.length})</Overline>
          {open.map(renderCheck)}
        </View>
      ) : checks.length > 0 ? (
        <Row center gap={6}><Icon name="checkmark-circle" size={14} color={GREEN} />{line("Every check passes.", colors.textSecondary)}</Row>
      ) : null}
      {passed.length > 0 && (
        <View style={{ gap: 6 }}>
          <Pressable onPress={() => setShowPassed((v) => !v)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name={showPassed ? "chevron-down" : "chevron-forward"} size={12} color={colors.textSecondary} />
            <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.medium, color: colors.textSecondary }}>{showPassed ? "Hide passed checks" : `Show passed checks (${passed.length})`}</Text>
          </Pressable>
          {showPassed && passed.map(renderCheck)}
        </View>
      )}
    </View>
  );
}
