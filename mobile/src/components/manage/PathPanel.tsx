/**
 * A section's path on its dashboard, after client/src/components/path-panel.tsx:
 * the one next step first, then compact blocks between thin rules — Progress,
 * Loops (Ship) or Fundability (Raise), Codebase, Recent activity, and the
 * whole path one tap away. Everything reads the section's live path.
 */
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Btn, Card, Icon, Loading, Meta, NovaGradient, Row } from "../ui";
import { Area, Block, Bubble, Clamp, GradientOutline, Line, Overline, Pill, Tag, Tick, useNotify } from "./bits";
import { CapitalProfileCard } from "./CapitalProfileCard";
import { LoopTree } from "./LoopTree";
import { MilestoneSheet } from "./MilestoneDetail";
import { WorkView } from "./WorkView";
import { PublishArtifactSheet, ShareStepSheet, WeeklyUpdateSheet } from "./path/ShareSheets";
import {
  ACTOR_SHORT, LOOP_TYPE_INFO, PROJECT_GOALS, TIER_LABEL, addableLoopTypes, ago, estimate, mkey, shortDay, useRefreshPath,
  type LoopType, type NoPath, type PathStatus, type ProjectGoal,
} from "./shared";
import { auditStageLabel, formatElapsed, sectionDef, useAuditStatus, useSectionPath } from "../../sections";

function projection(p: NonNullable<PathStatus["pace"]>) {
  if (p.mode === "pipeline") return "Pipeline";
  if (p.mode === "none" || !p.projectedAt) return "No date yet";
  if (p.mode === "range" && p.projectedLow && p.projectedHigh) return `${shortDay(p.projectedLow)} – ${shortDay(p.projectedHigh)}`;
  return shortDay(p.projectedAt);
}

const PACE_LABEL: Record<string, string> = { active: "On pace", nudge: "Quiet week", decaying: "Slipping", dormant: "Paused" };
const PACE_TONE: Record<string, string> = { active: colors.success, nudge: colors.warning, decaying: colors.warning, dormant: colors.textTertiary };

/** One section's path. */
export function usePath(projectId: string, goal: ProjectGoal) {
  return useSectionPath<PathStatus | NoPath>(projectId, goal);
}

export function PathPanel({ projectId, goal, onNavigate, onStartSection, isPrimary }: {
  projectId: string; goal: ProjectGoal; onNavigate: (tab: string) => void; onStartSection?: () => void; isPrimary: boolean;
}) {
  const refresh = useRefreshPath(projectId);
  const { notify, fail } = useNotify();
  const { data: raw, isLoading, error } = usePath(projectId, goal);
  const [showMap, setShowMap] = useState(false);
  const [openMilestone, setOpenMilestone] = useState<{ id: string; title: string } | null>(null);
  const def = sectionDef(goal);

  const adopt = useMutation({
    mutationFn: () => api<any>(`/api/projects/${projectId}/path/adopt`, { method: "POST", body: { goal } }),
    onSuccess: (r) => {
      refresh();
      const bits = [
        r?.recognised?.length ? `${r.recognised.length} marked done` : null,
        r?.filled?.length ? `${r.filled.length} written in` : null,
        r?.loops?.created?.length ? `${r.loops.created.length} loops found` : null,
      ].filter(Boolean);
      notify(bits.length ? `Nova re-read your project: ${bits.join(", ")}` : r?.built ? "Your project is on its path" : "Nothing new — the path already matches");
    },
    onError: (e) => fail(e),
  });
  const branch = useMutation({
    mutationFn: (b: { phaseId: string | null; extend?: boolean }) => api<any>(`/api/projects/${projectId}/path/branch`, { method: "POST", body: { ...b, goal } }),
    onSuccess: (r, b) => { refresh(); notify(b.phaseId ? (b.extend ? `Extending — round ${r?.round}` : "Keep building it is") : "Back on the main line"); },
    onError: (e) => fail(e),
  });

  if (isLoading) return <View style={{ height: 160 }}><Loading /></View>;
  if (!raw) return error ? <Card><Meta>{(error as any)?.message ?? "Couldn't load the path."}</Meta></Card> : null;

  if (!raw.adopted) {
    if (raw.started === false) {
      return (
        <View testID="section-not-started" style={{ alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl, paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.border, backgroundColor: colors.surface }}>
          <NovaGradient style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" }}>
            <Icon name={def.icon} size={22} color="#FFFFFF" />
          </NovaGradient>
          <View style={{ alignItems: "center", gap: 4 }}>
            <Text style={{ fontSize: font.xl, fontFamily: fontFamily.bold, color: colors.text }}>{def.label}</Text>
            <Text numberOfLines={2} style={{ textAlign: "center", fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular, color: colors.textSecondary }}>{raw.promise || def.blurb}</Text>
          </View>
          {onStartSection && <Btn icon="play" label={`Start ${def.short}`} onPress={onStartSection} />}
        </View>
      );
    }
    return (
      <Card style={{ borderColor: `${colors.primary}66` }}>
        <Text style={{ fontFamily: fontFamily.bold, fontSize: font.base, color: colors.text }}>Put {def.short} on its path</Text>
        <Meta>{raw.existingDone}/{raw.existingTasks} tasks already done — Nova marks what's finished.</Meta>
        <Btn small icon="sparkles" label={adopt.isPending ? "Nova is reading…" : "Start the path"} loading={adopt.isPending} onPress={() => adopt.mutate()} style={{ alignSelf: "flex-start" }} />
      </Card>
    );
  }

  const data = raw;
  const events = data.events ?? [];

  return (
    <View style={{ gap: spacing.md }}>
      <NextStep projectId={projectId} data={data} onNavigate={onNavigate} />

      {data.offer && (
        <Card style={{ borderColor: `${colors.primary}55` }}>
          <Row center gap={spacing.sm}>
            <Icon name="git-branch-outline" size={16} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm + 1, color: colors.text }}>{data.offer.title}</Text>
              <Meta>Main thing works. Extend, or move on.</Meta>
            </View>
          </Row>
          <Row gap={spacing.sm}>
            <Btn small icon="git-branch-outline" label="Keep building" loading={branch.isPending} onPress={() => branch.mutate({ phaseId: data.offer!.phaseId })} />
            <Btn small variant="outline" label="Move on" onPress={() => notify(`On to ${data.current.title}`, "info")} />
          </Row>
        </Card>
      )}
      {data.branch?.open && (
        <Row center gap={spacing.xs} wrap>
          <Icon name="git-branch-outline" size={14} color={colors.primary} />
          <Meta>Extending{data.branch.round > 1 ? ` · round ${data.branch.round}` : ""}</Meta>
          <Btn small variant="ghost" icon="repeat" label="Extend again" onPress={() => branch.mutate({ phaseId: data.branch!.phaseId, extend: true })} />
          <Btn small variant="ghost" icon="exit-outline" label="Go to users" onPress={() => branch.mutate({ phaseId: null })} />
        </Row>
      )}

      <Card style={{ paddingVertical: 0, gap: 0 }}>
        <Block title="Progress" icon="trending-up-outline">
          <ProgressStats data={data} />
          <NovaRead projectId={projectId} data={data} adopting={adopt.isPending} onReevaluate={() => adopt.mutate()} />
        </Block>

        {data.loopTree && (
          <Block divider title={`Loops · ${data.loopTree.loops.length}`} icon="git-network-outline">
            <LoopTree projectId={projectId} tree={data.loopTree} />
          </Block>
        )}

        {data.capital && data.capital.answered > 0 && (
          <Block divider title="Fundability" icon="cash-outline">
            <CapitalProfileCard capital={data.capital} bare />
          </Block>
        )}

        <Block divider title="Codebase" icon="code-slash-outline">
          <CodebaseSync projectId={projectId} data={data} onNavigate={onNavigate} />
        </Block>

        {events.length > 0 && (
          <Block divider title="Recent activity" icon="pulse-outline">
            <RecentActivity events={events} />
          </Block>
        )}

        <Block
          divider
          title={`Whole path · ${data.phases.length} phases`}
          icon="map-outline"
          right={
            <Pressable onPress={() => setShowMap(!showMap)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 3 }} testID="button-toggle-path">
              <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.semibold, color: colors.primary }}>{showMap ? "Hide" : "Show"}</Text>
              <Icon name={showMap ? "chevron-up" : "chevron-down"} size={13} color={colors.primary} />
            </Pressable>
          }
        >
          {showMap
            ? <PathMap projectId={projectId} goal={goal} data={data} isPrimary={isPrimary} onOpen={setOpenMilestone} />
            : <Clamp text={data.promise} lines={1} />}
        </Block>
      </Card>

      <MilestoneSheet projectId={projectId} backboneId={openMilestone?.id ?? null} title={openMilestone?.title ?? ""} onClose={() => setOpenMilestone(null)} />
    </View>
  );
}

// --- Next step ----------------------------------------------------------------

/**
 * Arriving from a notification (`?focus=`, shared/notifications.ts PATH_FOCUS):
 * the Next Step card is outlined for a moment; `weekly` opens the weekly
 * update; a milestone id that's no longer next says the step got done. The
 * param is cleared once handled so it doesn't replay.
 */
function usePathFocus(data: PathStatus, openWeekly: () => void): boolean {
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const router = useRouter();
  const { notify } = useNotify();
  const handled = useRef<string | null>(null);
  const [highlighted, setHighlighted] = useState(false);
  useEffect(() => {
    if (!focus || handled.current === focus) return;
    handled.current = focus;
    setHighlighted(true);
    setTimeout(() => setHighlighted(false), 2500);
    if (focus === "weekly") {
      if (data.weekly?.due && data.weekly.steps.length) openWeekly();
      else notify("This week's finished steps are already posted.");
    } else if (focus !== "next" && data.next && data.next.id !== focus) {
      notify(`That step's done. Next up: ${data.next.step?.title ?? data.next.title}`);
    }
    router.setParams({ focus: undefined } as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);
  return highlighted;
}

function NextStep({ projectId, data, onNavigate }: { projectId: string; data: PathStatus; onNavigate: (tab: string) => void }) {
  const router = useRouter();
  const refresh = useRefreshPath(projectId);
  const { notify, fail } = useNotify();
  const [loopForm, setLoopForm] = useState<{ title: string; description: string; type: LoopType } | null>(null);
  const [draft, setDraft] = useState<{ backboneId: string; loopTaskId: string | null; sourceTitle: string; text: string } | null>(null);
  const [sharing, setSharing] = useState<"step" | "artifact" | "week" | null>(null);
  const highlighted = usePathFocus(data, () => setSharing("week"));
  const { data: project } = useQuery({ queryKey: mkey(projectId, "project"), queryFn: () => api<any>(`/api/projects/${projectId}`), enabled: !!projectId });
  const projectTitle: string = project?.title ?? "your project";

  const markDone = useMutation({ mutationFn: (taskId: string) => api(`/api/kanban/${taskId}`, { method: "PATCH", body: { status: "done" } }), onSuccess: refresh, onError: (e) => fail(e) });
  const expand = useMutation({
    mutationFn: (b: { backboneId: string; artifact?: string; loopTaskId?: string | null }) => api<any>(`/api/projects/${projectId}/path/expand`, { method: "POST", body: b }),
    onSuccess: (r) => { setDraft(null); refresh(); notify(r?.created?.length ? `Nova broke it into ${r.created.length} steps` : "Steps already exist"); },
    onError: async (e: any, b) => {
      if (String(e?.body?.code ?? e?.message ?? "").includes("artifact_missing")) {
        try {
          const r = await api<any>(`/api/projects/${projectId}/path/expand`, { method: "POST", body: { backboneId: b.backboneId, loopTaskId: b.loopTaskId ?? null, draft: true } });
          setDraft({ backboneId: b.backboneId, loopTaskId: b.loopTaskId ?? null, sourceTitle: r.sourceTitle, text: r.draft });
          return;
        } catch (err) { return fail(err); }
      }
      fail(e);
    },
  });
  const addLoop = useMutation({
    mutationFn: (b: { backboneId: string; title: string; description: string; type: LoopType }) => api(`/api/projects/${projectId}/path/loops`, { method: "POST", body: b }),
    onSuccess: () => { setLoopForm(null); refresh(); notify("Loop added"); },
    onError: (e) => fail(e),
  });

  const { next, current } = data;
  const sources = new Set(data.phases.flatMap((p) => p.milestones).map((m) => m.expandsFrom).filter(Boolean));
  const isSource = (id: string) => sources.has(id);
  const routeNotes = next?.routeQuestion && data.capital && data.capital.answered >= 3
    ? { [next.routeQuestion]: Object.fromEntries(data.capital.routeFit.map((r) => [r.route, `fit ${r.score}`])) }
    : undefined;

  const followUps = (
    <>
      {data.lastDone && (
        <Row center gap={spacing.sm} wrap style={{ paddingHorizontal: 2 }} >
          <Icon name="checkmark-circle" size={14} color={colors.success} />
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: font.xs + 1, fontFamily: fontFamily.regular, color: colors.textSecondary }}>Finished <Text style={{ fontFamily: fontFamily.semibold, color: colors.text }}>{data.lastDone.title}</Text></Text>
          {data.lastDone.sharedPostId ? (
            <LinkText label="See feedback" icon="chatbubbles-outline" onPress={() => router.push(`/post/${data.lastDone!.sharedPostId}` as any)} testID="link-shared-step" />
          ) : (
            <>
              <LinkText label="Share" icon="share-social-outline" onPress={() => setSharing("step")} testID="button-share-finished-step" />
              <LinkText label="Publish" icon="globe-outline" onPress={() => setSharing("artifact")} testID="button-publish-finished-step" />
            </>
          )}
        </Row>
      )}
      {data.weekly?.due && data.weekly.steps.length > 1 && (
        <Row center gap={spacing.sm} wrap style={{ paddingHorizontal: 2 }}>
          <Meta>{data.weekly.steps.length} steps done this week, not shared</Meta>
          <LinkText label="Post weekly update" icon="megaphone-outline" onPress={() => setSharing("week")} testID="button-path-weekly-update" />
        </Row>
      )}
      {sharing === "step" && data.lastDone && <ShareStepSheet projectId={projectId} projectTitle={projectTitle} step={data.lastDone} onClose={() => setSharing(null)} />}
      {sharing === "artifact" && data.lastDone && <PublishArtifactSheet projectId={projectId} step={data.lastDone} onClose={() => setSharing(null)} />}
      {sharing === "week" && data.weekly && <WeeklyUpdateSheet projectId={projectId} projectTitle={projectTitle} steps={data.weekly.steps} onClose={() => setSharing(null)} />}
    </>
  );

  if (!next) {
    return (
      <View style={{ gap: spacing.sm }}>
        <Card style={highlighted ? { borderColor: colors.primary, borderWidth: 2 } : undefined}>
          <Row center gap={spacing.sm}><Icon name="trophy-outline" size={18} color={colors.success} /><Text style={{ fontFamily: fontFamily.bold, fontSize: font.base, color: colors.text }}>Path complete</Text></Row>
          {data.proposal?.map((p) => (
            <Row key={p.goal} between gap={spacing.md} style={{ borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.sm }}>
              <View style={{ flex: 1 }}><Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{sectionDef(p.goal).label}</Text><Clamp text={p.why} /></View>
              <Btn small variant="outline" label="Open" icon="arrow-forward" onPress={() => router.setParams({ section: p.goal } as any)} />
            </Row>
          ))}
        </Card>
        {followUps}
      </View>
    );
  }

  const novaActs = next.actor !== "user-does";
  const [phaseHead] = current.title.split(" — ");
  const showWork = next.workTaskId && !(next.expandsFrom && !next.steps) && !(isSource(next.id) && next.loops.length > 0 && !next.step);

  return (
    <View style={{ gap: spacing.sm }}>
      <GradientOutline width={highlighted ? 3 : 1.5} rounded={radius.md} innerStyle={{ padding: spacing.md, gap: spacing.sm }}>
        <View testID="next-action" accessibilityHint={highlighted ? "Your next step" : undefined} style={{ gap: spacing.sm }}>
          <Row center gap={6}>
            <Icon name="compass-outline" size={13} color={colors.primary} />
            <Overline color={colors.primary}>Next step</Overline>
          </Row>
          <Row wrap gap={5}>
            <Pill tone="primary" label={`${phaseHead} · Step ${current.step} of ${current.of}`} />
            <Pill icon={novaActs ? "sparkles" : "person-outline"} label={ACTOR_SHORT[next.actor]} />
            <Pill icon="time-outline" label={estimate(next.estimateMinutes)} />
            {next.steps && <Pill icon="list-outline" label={`${next.steps.done}/${next.steps.total} steps`} />}
          </Row>
          <Text style={{ fontFamily: fontFamily.bold, fontSize: font.lg + 1, color: colors.text, lineHeight: 24 }} testID="next-action-title">{next.title}</Text>
          <Clamp text={next.description} />
          <Meta>{TIER_LABEL[next.tier]}</Meta>

          {next.step && (
            <View style={{ backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.sm + 2, gap: 2 }}>
              <Overline>{next.step.isLoop ? "Write this loop" : next.step.loop ? `Step · ${next.step.loop.title}` : "This step"}</Overline>
              <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{next.step.title}</Text>
              {!!next.step.description && <Clamp text={next.step.description} lines={1} />}
            </View>
          )}

          {next.loops.length > 0 && (
            <View style={{ gap: 4 }}>
              <Overline>Loops · {next.loops.filter((l) => l.status === "done").length}/{next.loops.length} written</Overline>
              <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm }}>
                {next.loops.map((l, i) => (
                  <Row key={l.taskId} center gap={spacing.sm} style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderColor: colors.borderSubtle }}>
                    <Tick done={l.status === "done"} size={15} />
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: font.sm, fontFamily: fontFamily.regular, color: colors.text }}>{l.title}</Text>
                    <Text style={{ fontSize: 10, fontFamily: fontFamily.medium, color: colors.textTertiary }}>{LOOP_TYPE_INFO[l.type ?? "product"]?.label}</Text>
                    {next.expandsFrom && !l.expanded && (
                      <Pressable hitSlop={6} disabled={expand.isPending || !!draft} onPress={() => expand.mutate({ backboneId: next.id, loopTaskId: l.taskId })}>
                        <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: colors.primary }}>Break down</Text>
                      </Pressable>
                    )}
                  </Row>
                ))}
              </View>
              {(next.missingLoopTypes?.length ?? 0) > 0 && (
                <Meta style={{ color: colors.warning }}>Missing: {(next.missingLoopTypes ?? []).map((t) => LOOP_TYPE_INFO[t].label.toLowerCase()).join(", ")}</Meta>
              )}
            </View>
          )}

          {showWork && (
            <View style={{ borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.sm }}>
              <WorkView
                projectId={projectId} taskId={next.workTaskId!} actor={next.step?.actor ?? next.actor} work={next.work} done={false}
                intake={next.step ? undefined : next.intake} workKind={next.step ? undefined : next.workKind}
                prefill={next.step ? undefined : next.prefill} optionNotes={routeNotes}
              />
            </View>
          )}

          <Row gap={spacing.sm} wrap style={{ borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.sm }}>
            {next.expandsFrom && !next.steps && next.loops.length === 0 && (
              <Btn small icon="git-branch-outline" label="Break into steps" disabled={!!draft} loading={expand.isPending} onPress={() => expand.mutate({ backboneId: next.id })} />
            )}
            {isSource(next.id) && !loopForm && (
              <Btn small variant="outline" icon="add" label={next.missingLoopTypes?.length ? `Add ${LOOP_TYPE_INFO[next.missingLoopTypes[0]].label.toLowerCase()}` : "Add loop"}
                onPress={() => { const t = next.missingLoopTypes?.[0] ?? "product"; setLoopForm({ title: next.missingLoopTypes?.length ? LOOP_TYPE_INFO[t].label : "", description: "", type: t }); }} />
            )}
            {next.taskId && (
              <Btn small variant="outline" icon="checkmark-circle-outline" label={next.tier === "claimed" ? "I did this" : "Done"} loading={markDone.isPending}
                onPress={() => markDone.mutate(next.step?.taskId ?? next.taskId!)} />
            )}
            <Btn small variant="ghost" label="Open in tasks" onPress={() => onNavigate("tasks")} />
          </Row>

          {loopForm && (
            <View style={{ gap: spacing.sm, borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.sm }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {addableLoopTypes(next.loops.map((l) => ({ type: l.type ?? "product" }))).map((t) => (
                  <Bubble key={t} small label={LOOP_TYPE_INFO[t].label} on={loopForm.type === t} onPress={() => setLoopForm({ ...loopForm, type: t })} />
                ))}
              </View>
              <Line value={loopForm.title} onChangeText={(t) => setLoopForm({ ...loopForm, title: t })} placeholder="Loop name" />
              <Area value={loopForm.description} onChangeText={(t) => setLoopForm({ ...loopForm, description: t })} rows={3} placeholder="Its 3–5 steps (optional)" />
              <Row gap={spacing.sm}>
                <Btn small label="Add loop" disabled={!loopForm.title.trim()} loading={addLoop.isPending} onPress={() => addLoop.mutate({ backboneId: next.expandsFrom ?? next.id, ...loopForm })} />
                <Btn small variant="ghost" label="Cancel" onPress={() => setLoopForm(null)} />
              </Row>
            </View>
          )}
          {draft && (
            <View style={{ gap: spacing.sm, borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.sm }}>
              <Meta>Nova drafted {draft.sourceTitle}. Edit, then build the steps.</Meta>
              <Area value={draft.text} onChangeText={(t) => setDraft({ ...draft, text: t })} rows={6} />
              <Row gap={spacing.sm} wrap>
                <Btn small label="Build the steps" disabled={!draft.text.trim()} loading={expand.isPending}
                  onPress={() => expand.mutate({ backboneId: draft.backboneId, loopTaskId: draft.loopTaskId, artifact: draft.text })} />
                <Btn small variant="ghost" label="Cancel" onPress={() => setDraft(null)} />
              </Row>
            </View>
          )}
        </View>
      </GradientOutline>
      {followUps}
    </View>
  );
}

// --- Progress -----------------------------------------------------------------

function ProgressStats({ data }: { data: PathStatus }) {
  const { mainLine, current, pace, plan } = data;
  const pct = mainLine.total ? Math.round((mainLine.done / mainLine.total) * 100) : 0;
  const tiles = [
    { label: "Complete", value: `${pct}%`, sub: `${mainLine.done}/${mainLine.total} milestones`, bar: pct },
    { label: "Phase", value: current.title.split(" — ")[0], sub: `Step ${current.step} of ${current.of}` },
    { label: "Finish", value: pace ? projection(pace) : "—", sub: plan && plan.loops > 1 ? `${plan.loops} loops · ${Math.round(plan.authoredDays / 7)} wk plan` : "Projected" },
    {
      label: "Pace",
      value: pace?.multiplier != null ? `${pace.multiplier}×` : pace ? PACE_LABEL[pace.state] ?? "—" : "—",
      sub: pace ? (Math.floor(pace.daysSinceActivity) === 0 ? "Active today" : `Last active ${Math.floor(pace.daysSinceActivity)}d ago`) : "No activity yet",
      tone: pace ? PACE_TONE[pace.state] : undefined,
    },
  ];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, overflow: "hidden" }} testID="path-progress">
      {tiles.map((t, i) => (
        <View key={t.label} style={{ width: "50%", padding: spacing.sm + 2, gap: 1, borderColor: colors.border, borderLeftWidth: i % 2 ? 1 : 0, borderTopWidth: i > 1 ? 1 : 0 }}>
          <Overline>{t.label}</Overline>
          <Text numberOfLines={1} style={{ fontSize: font.lg, fontFamily: fontFamily.bold, color: t.tone ?? colors.text }}>{t.value}</Text>
          <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: fontFamily.regular, color: colors.textTertiary }}>{t.sub}</Text>
          {t.bar != null && (
            <View style={{ height: 3, borderRadius: 2, backgroundColor: colors.surfaceRaised, overflow: "hidden", marginTop: 4 }}>
              {t.bar > 0 && <View style={{ width: `${t.bar}%`, height: "100%", backgroundColor: colors.primary }} />}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

function NovaRead({ projectId, data, adopting, onReevaluate }: { projectId: string; data: PathStatus; adopting: boolean; onReevaluate: () => void }) {
  const refresh = useRefreshPath(projectId);
  const { notify, fail } = useNotify();
  const [notes, setNotes] = useState<string | null>(null);
  const saveNotes = useMutation({
    mutationFn: (n: string) => api(`/api/projects/${projectId}/nova-notes`, { method: "PUT", body: { notes: n } }),
    onSuccess: () => { setNotes(null); refresh(); notify("Nova will keep that in mind"); },
    onError: (e) => fail(e),
  });
  const { pace } = data;
  return (
    <View style={{ gap: spacing.sm }} testID="nova-panel">
      {pace && (
        <Row gap={6} style={{ alignItems: "flex-start" }}>
          <View style={{ marginTop: 2 }}><Icon name="sparkles" size={13} color={colors.primary} /></View>
          <View style={{ flex: 1 }}><Clamp text={`${pace.state === "nudge" ? "A week without activity — one small step keeps the date. " : ""}${pace.note}`} lines={1} /></View>
        </Row>
      )}
      <Row gap={spacing.sm} wrap>
        <Btn small variant="outline" icon="sparkles" label={adopting ? "Re-reading…" : "Re-evaluate"} loading={adopting} onPress={onReevaluate} />
        <Btn small variant="ghost" icon="chatbox-outline" label={data.novaNotes ? "Your note" : "Tell Nova"} onPress={() => setNotes(notes == null ? data.novaNotes : null)} />
      </Row>
      {notes != null && (
        <View style={{ gap: spacing.sm }}>
          <Meta>Outranks the brief and the board on every read.</Meta>
          <Area value={notes} onChangeText={setNotes} rows={3} placeholder="e.g. Check-ins are being removed — they are not a loop." />
          <Row gap={spacing.sm}>
            <Btn small label="Save" loading={saveNotes.isPending} onPress={() => saveNotes.mutate(notes)} />
            <Btn small variant="ghost" label="Cancel" onPress={() => setNotes(null)} />
          </Row>
        </View>
      )}
      {data.rejectedLoops.length > 0 && <Meta numberOfLines={1}>Not loops: {data.rejectedLoops.join(" · ")}</Meta>}
    </View>
  );
}

// --- Codebase ------------------------------------------------------------------

function CodebaseSync({ projectId, data, onNavigate }: { projectId: string; data: PathStatus; onNavigate: (tab: string) => void }) {
  const [all, setAll] = useState(false);
  const { running } = useAuditStatus(projectId);
  const { data: audits } = useQuery({
    queryKey: mkey(projectId, "code-audits"),
    queryFn: () => api<{ id: string; createdAt: string; completionPercent: number | null }[]>(`/api/projects/${projectId}/code-audits`),
  });
  const latest = audits?.[0] ?? null;
  const update = data.auditUpdate ?? null;
  const readAt = latest?.createdAt ?? update?.at ?? data.loopTree?.closureAuditAt ?? null;
  const loops = data.loopTree?.loops ?? [];
  const closing = loops.filter((l) => l.closure?.closure === "closed").length;
  const read = loops.filter((l) => l.closure).length;
  const days = data.pace ? Math.floor(data.pace.daysSinceActivity) : null;
  const facts = [
    { label: "Last read", value: readAt ? ago(readAt) : "Never" },
    { label: "Activity", value: days == null ? "—" : days === 0 ? "Today" : `${days}d ago` },
    ...(latest?.completionPercent != null ? [{ label: "Built", value: `${latest.completionPercent}%` }] : []),
    ...(read > 0 ? [{ label: "Loops closing", value: `${closing}/${loops.length}` }] : []),
  ];

  return (
    <View style={{ gap: spacing.sm }}>
      <Row wrap gap={spacing.lg}>
        {facts.map((f) => (
          <View key={f.label}>
            <Overline>{f.label}</Overline>
            <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>{f.value}</Text>
          </View>
        ))}
      </Row>
      {running ? (
        <Row center gap={spacing.sm} style={{ backgroundColor: colors.primarySoft, borderRadius: radius.sm, padding: spacing.sm }}>
          <Icon name="scan-outline" size={14} color={colors.primary} />
          <Text style={{ flex: 1, fontSize: font.xs + 1, fontFamily: fontFamily.semibold, color: colors.primary }}>Nova is reading your code… {auditStageLabel(running.stage)} · {formatElapsed(running.elapsedSeconds)}</Text>
        </Row>
      ) : (
        <Btn small variant={readAt ? "outline" : "primary"} icon="scan-outline" label={readAt ? "Re-read code" : "Read my code"} onPress={() => onNavigate("codebase")} style={{ alignSelf: "flex-start" }} />
      )}
      {update && (
        <View style={{ borderWidth: 1, borderColor: `${colors.primary}40`, backgroundColor: `${colors.primary}08`, borderRadius: radius.sm, padding: spacing.sm, gap: 4 }} testID="path-audit-update">
          <Row center gap={6} wrap>
            <Icon name="git-commit-outline" size={13} color={colors.primary} />
            <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.semibold, color: colors.text }}>From your code</Text>
            <Meta>{ago(update.at)}{update.appliedCount > 0 ? ` · ${update.appliedCount} change${update.appliedCount === 1 ? "" : "s"} made` : ""}</Meta>
            {update.pendingCount > 0 && <LinkText label={`Review ${update.pendingCount} waiting`} icon="arrow-forward" onPress={() => onNavigate("codebase")} testID="button-review-audit-changes" />}
          </Row>
          {(all ? update.applied : update.applied.slice(0, 3)).map((a, i) => (
            <Row key={i} gap={5} style={{ alignItems: "flex-start" }}><Icon name="checkmark-circle" size={12} color={colors.success} /><Text numberOfLines={1} style={{ flex: 1, fontSize: font.xs + 1, fontFamily: fontFamily.regular, color: colors.textSecondary }}>{a}</Text></Row>
          ))}
          {update.applied.length > 3 && <Pressable onPress={() => setAll(!all)} hitSlop={6}><Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: colors.primary }}>{all ? "Less" : `+${update.appliedCount - 3} more`}</Text></Pressable>}
          {update.pendingLoops.length > 0 && <Meta numberOfLines={2} style={{ color: colors.warning }}>Loops may have changed: {update.pendingLoops.join("; ")}</Meta>}
        </View>
      )}
    </View>
  );
}

// --- Activity -------------------------------------------------------------------

function RecentActivity({ events }: { events: NonNullable<PathStatus["events"]> }) {
  const [all, setAll] = useState(false);
  const shown = all ? events : events.slice(0, 4);
  return (
    <View testID="path-activity">
      {shown.map((e, i) => {
        const moved = e.projectedBefore && e.projectedAfter && shortDay(e.projectedBefore) !== shortDay(e.projectedAfter);
        const earlier = moved && new Date(e.projectedAfter!).getTime() < new Date(e.projectedBefore!).getTime();
        return (
          <Row key={e.id} center gap={spacing.sm} style={{ paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderColor: colors.borderSubtle }}>
            <Icon name="checkmark-circle" size={14} color={colors.success} />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: font.sm, fontFamily: fontFamily.regular, color: colors.text }}>{e.title}</Text>
            {moved && <Text style={{ fontSize: 11, fontFamily: fontFamily.medium, color: earlier ? colors.success : colors.warning }}>{shortDay(e.projectedBefore)} → {shortDay(e.projectedAfter)}</Text>}
            <Text style={{ fontSize: 11, fontFamily: fontFamily.regular, color: colors.textTertiary }}>{ago(e.createdAt)}</Text>
          </Row>
        );
      })}
      {events.length > 4 && (
        <Pressable onPress={() => setAll(!all)} hitSlop={6}><Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.semibold, color: colors.primary }}>{all ? "Show less" : `Show all ${events.length}`}</Text></Pressable>
      )}
    </View>
  );
}

// --- The whole path ----------------------------------------------------------------

function PathMap({ projectId, goal, data, isPrimary, onOpen }: {
  projectId: string; goal: ProjectGoal; data: PathStatus; isPrimary: boolean; onOpen: (m: { id: string; title: string }) => void;
}) {
  const refresh = useRefreshPath(projectId);
  const { notify, fail } = useNotify();
  const [showSwitch, setShowSwitch] = useState(false);
  const mark = useMutation({ mutationFn: (ids: string[]) => api(`/api/projects/${projectId}/path/mark`, { method: "POST", body: { ids, goal } }), onSuccess: refresh, onError: (e) => fail(e) });
  const inject = useMutation({
    mutationFn: (phaseId: string) => api<any>(`/api/projects/${projectId}/path/inject`, { method: "POST", body: { phaseId, goal } }),
    onSuccess: (r) => { refresh(); notify(r?.created?.length ? `Nova added ${r.created.length} task${r.created.length === 1 ? "" : "s"}` : "Nothing missing here"); },
    onError: (e) => fail(e),
  });
  const branch = useMutation({
    mutationFn: (phaseId: string | null) => api<any>(`/api/projects/${projectId}/path/branch`, { method: "POST", body: { phaseId, goal } }),
    onSuccess: () => { refresh(); notify("Working the branch"); },
    onError: (e) => fail(e),
  });
  const switchPath = useMutation({
    mutationFn: (body: { goal: ProjectGoal; subcategory: string }) => api<any>(`/api/projects/${projectId}/path/switch`, { method: "POST", body }),
    onSuccess: (r) => { refresh(); setShowSwitch(false); notify(r?.carried ? `Moved — ${r.carried} shared milestone${r.carried === 1 ? "" : "s"} carried across` : "Moved to the new path"); },
    onError: (e) => fail(e),
  });

  return (
    <View style={{ gap: spacing.md }}>
      {data.phases.map((phase) => (
        <View key={phase.id} style={[{ gap: 2 }, phase.optional && { borderLeftWidth: 2, borderStyle: "dashed", borderColor: colors.border, paddingLeft: spacing.sm }]}>
          <Row center gap={6}>
            {phase.optional && <Icon name="git-branch-outline" size={12} color={colors.textTertiary} />}
            <Text style={{ flex: 1, fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{phase.title}</Text>
            <Tag label={`${phase.done}/${phase.total}`} color={phase.done === phase.total && phase.total > 0 ? colors.success : colors.textSecondary} />
          </Row>
          {phase.milestones.map((m) => (
            <Pressable key={m.id} onPress={() => onOpen({ id: m.id, title: m.title })} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 }, pressed && { opacity: 0.6 }]}>
              <Tick done={m.done} size={16} />
              <Text numberOfLines={2} style={{ flex: 1, fontSize: font.sm, fontFamily: m.id === data.next?.id ? fontFamily.semibold : fontFamily.regular, color: m.done ? colors.textTertiary : colors.text }}>{m.title}</Text>
              {!m.done && (
                <Pressable hitSlop={8} onPress={() => mark.mutate([m.id])} disabled={mark.isPending}>
                  <Text style={{ fontSize: font.xs, color: colors.primary, fontFamily: fontFamily.semibold }}>Mark done</Text>
                </Pressable>
              )}
              <Icon name="chevron-forward" size={13} color={colors.textTertiary} />
            </Pressable>
          ))}
          {phase.injected.map((t) => (
            <Row key={t.id} center gap={spacing.sm} style={{ paddingVertical: 4 }}>
              {t.status === "done" ? <Tick done size={16} /> : <Icon name="sparkles-outline" size={15} color={colors.primary} />}
              <Text numberOfLines={2} style={{ flex: 1, fontSize: font.sm, color: t.status === "done" ? colors.textTertiary : colors.text, fontFamily: fontFamily.regular }}>{t.title}</Text>
            </Row>
          ))}
          {phase.optional ? (
            data.branch?.phaseId !== phase.id && <Btn small variant="ghost" icon="git-branch-outline" label="Work this branch" loading={branch.isPending} onPress={() => branch.mutate(phase.id)} style={{ alignSelf: "flex-start" }} />
          ) : phase.injectRoom > 0 && (
            <Pressable disabled={inject.isPending} onPress={() => inject.mutate(phase.id)} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 }}>
              <Icon name="add" size={13} color={colors.textSecondary} />
              <Meta>What's missing? ({phase.injectRoom} left)</Meta>
            </Pressable>
          )}
        </View>
      ))}
      {isPrimary && (!showSwitch ? (
        <Btn small variant="ghost" icon="swap-horizontal" label="Move this project to another path" onPress={() => setShowSwitch(true)} style={{ alignSelf: "flex-start" }} />
      ) : (
        <SwitchForm current={data.goal} pending={switchPath.isPending} onSwitch={(b) => switchPath.mutate(b)} onCancel={() => setShowSwitch(false)} />
      ))}
    </View>
  );
}

function LinkText({ label, icon, onPress, testID }: { label: string; icon: React.ComponentProps<typeof Icon>["name"]; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} testID={testID} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 3 }, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={12} color={colors.primary} />
      <Text style={{ color: colors.primary, fontFamily: fontFamily.semibold, fontSize: font.xs + 1 }}>{label}</Text>
    </Pressable>
  );
}

function SwitchForm({ current, pending, onSwitch, onCancel }: { current: ProjectGoal; pending: boolean; onSwitch: (b: { goal: ProjectGoal; subcategory: string }) => void; onCancel: () => void }) {
  const others = PROJECT_GOALS.filter((g) => g.id !== current);
  const [goal, setGoal] = useState<ProjectGoal>(others[0].id);
  const [sub, setSub] = useState("other");
  return (
    <View style={{ gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm }}>
      <Meta>Shared milestones you've finished carry across as done.</Meta>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {others.map((g) => <Bubble key={g.id} label={g.label} on={goal === g.id} onPress={() => { setGoal(g.id); setSub("other"); }} />)}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {PROJECT_GOALS.find((g) => g.id === goal)!.subs.map((s) => <Bubble key={s.id} small label={s.label} on={sub === s.id} onPress={() => setSub(s.id)} />)}
      </View>
      <Row gap={spacing.sm}>
        <Btn small label="Switch path" loading={pending} onPress={() => onSwitch({ goal, subcategory: sub })} />
        <Btn small variant="ghost" label="Cancel" onPress={onCancel} />
      </Row>
    </View>
  );
}
