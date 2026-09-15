/**
 * Nova's path on the dashboard: pace strip, the capital profile on funding
 * paths, the Nova panel, the one next action with Nova's work inline, and the
 * whole path one tap away. The native counterpart of path-panel.tsx.
 */
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Body, Btn, Card, Divider, Icon, Loading, Meta, NovaGradient, Row } from "../ui";
import { Area, Bubble, Line, Overline, Tag, Tick, Well, useNotify } from "./bits";
import { CapitalProfileCard } from "./CapitalProfileCard";
import { LoopTree } from "./LoopTree";
import { MilestoneSheet } from "./MilestoneDetail";
import { WorkView } from "./WorkView";
import { PublishArtifactSheet, ShareStepSheet, WeeklyUpdateSheet } from "./path/ShareSheets";
import {
  ACTOR_LABEL, LOOP_TYPE_COLOR, LOOP_TYPE_INFO, PROJECT_GOALS, TIER_LABEL, addableLoopTypes, estimate, goalLabel, mkey, shortDay, useRefreshPath,
  type LoopType, type NoPath, type PathStatus, type ProjectGoal,
} from "./shared";

function projection(p: NonNullable<PathStatus["pace"]>) {
  if (p.mode === "pipeline") return "Pipeline mode";
  if (p.mode === "none" || !p.projectedAt) return "No date yet";
  if (p.mode === "range" && p.projectedLow && p.projectedHigh) return `${shortDay(p.projectedLow)} – ${shortDay(p.projectedHigh)}`;
  return shortDay(p.projectedAt);
}

export function usePath(projectId: string) {
  return useQuery({
    queryKey: mkey(projectId, "path"),
    queryFn: () => api<PathStatus | NoPath>(`/api/projects/${projectId}/path`),
    enabled: !!projectId,
  });
}

export function PathPanel({ projectId, onNavigate }: { projectId: string; onNavigate: (tab: string) => void }) {
  const router = useRouter();
  const refresh = useRefreshPath(projectId);
  const { notify, fail } = useNotify();
  const { data: raw, isLoading, error } = usePath(projectId);
  const [showMap, setShowMap] = useState(false);
  const [showSwitch, setShowSwitch] = useState(false);
  const [openMilestone, setOpenMilestone] = useState<{ id: string; title: string } | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [loopForm, setLoopForm] = useState<{ title: string; description: string; type: LoopType } | null>(null);
  const [draft, setDraft] = useState<{ backboneId: string; loopTaskId: string | null; sourceTitle: string; text: string } | null>(null);
  const [sharing, setSharing] = useState<"step" | "artifact" | "week" | null>(null);
  const { data: project } = useQuery({ queryKey: mkey(projectId, "project"), queryFn: () => api<any>(`/api/projects/${projectId}`), enabled: !!projectId });
  const projectTitle: string = project?.title ?? "your project";

  const markDone = useMutation({ mutationFn: (taskId: string) => api(`/api/kanban/${taskId}`, { method: "PATCH", body: { status: "done" } }), onSuccess: refresh, onError: (e) => fail(e) });
  const adopt = useMutation({
    mutationFn: () => api<any>(`/api/projects/${projectId}/path/adopt`, { method: "POST", body: {} }),
    onSuccess: (r) => {
      refresh();
      const bits = [
        r?.recognised?.length ? `${r.recognised.length} marked done` : null,
        r?.filled?.length ? `${r.filled.length} written in` : null,
        r?.loops?.created?.length ? `${r.loops.created.length} loops found` : null,
      ].filter(Boolean);
      notify(bits.length ? `Nova re-read your project: ${bits.join(", ")}` : r?.built ? "Your project is on its path" : "Nothing new — the path already matches what Nova can see");
    },
    onError: (e) => fail(e),
  });
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
  const inject = useMutation({
    mutationFn: (phaseId: string) => api<any>(`/api/projects/${projectId}/path/inject`, { method: "POST", body: { phaseId } }),
    onSuccess: (r) => { refresh(); notify(r?.created?.length ? `Nova added ${r.created.length} task${r.created.length === 1 ? "" : "s"} for this phase` : "Nothing in your artifacts calls for more here"); },
    onError: (e) => fail(e),
  });
  const mark = useMutation({ mutationFn: (ids: string[]) => api(`/api/projects/${projectId}/path/mark`, { method: "POST", body: { ids } }), onSuccess: refresh, onError: (e) => fail(e) });
  const branch = useMutation({
    mutationFn: (b: { phaseId: string | null; extend?: boolean }) => api<any>(`/api/projects/${projectId}/path/branch`, { method: "POST", body: b }),
    onSuccess: (r, b) => { refresh(); notify(b.phaseId ? (b.extend ? `Extending again — round ${r?.round}` : "Keep building it is") : "Back on the main line"); },
    onError: (e) => fail(e),
  });
  const addLoop = useMutation({
    mutationFn: (b: { backboneId: string; title: string; description: string; type: LoopType }) => api(`/api/projects/${projectId}/path/loops`, { method: "POST", body: b }),
    onSuccess: () => { setLoopForm(null); refresh(); notify("Loop added — write it down, then break it into steps"); },
    onError: (e) => fail(e),
  });
  const saveNotes = useMutation({
    mutationFn: (n: string) => api(`/api/projects/${projectId}/nova-notes`, { method: "PUT", body: { notes: n } }),
    onSuccess: () => { setNotes(null); refresh(); notify("Nova will keep that in mind on every read"); },
    onError: (e) => fail(e),
  });
  const switchPath = useMutation({
    mutationFn: (body: { goal: ProjectGoal; subcategory: string }) => api<any>(`/api/projects/${projectId}/path/switch`, { method: "POST", body }),
    onSuccess: (r) => { refresh(); setShowSwitch(false); notify(r?.carried ? `Moved — ${r.carried} shared milestone${r.carried === 1 ? "" : "s"} carried across` : "Moved to the new path"); },
    onError: (e) => fail(e),
  });

  if (isLoading) return <View style={{ height: 120 }}><Loading /></View>;
  if (!raw) return error ? <Card><Meta>{(error as any)?.message ?? "Couldn't load the path."}</Meta></Card> : null;

  if (!raw.adopted) {
    return (
      <Card style={{ borderColor: `${colors.primary}66` }}>
        <Text style={{ fontFamily: fontFamily.bold, fontSize: font.base, color: colors.text }}>Put this project on its path</Text>
        <Body muted>
          {raw.promise}. You already have {raw.existingDone} of {raw.existingTasks} tasks done — Nova will read those, your audits and check-ins, and mark what's already finished so the path starts where you are.
        </Body>
        <Btn icon="sparkles" label={adopt.isPending ? "Nova is reading your project…" : "Start the path and read my progress"} loading={adopt.isPending} onPress={() => adopt.mutate()} />
      </Card>
    );
  }

  const data = raw;
  const { current, next, mainLine, pace } = data;
  const pct = mainLine.total ? Math.round((mainLine.done / mainLine.total) * 100) : 0;
  const novaActs = next && next.actor !== "user-does";
  const sources = new Set(data.phases.flatMap((p) => p.milestones).map((m) => m.expandsFrom).filter(Boolean));
  const isSource = (id: string) => sources.has(id);
  const routeNotes = next?.routeQuestion && data.capital && data.capital.answered >= 3
    ? { [next.routeQuestion]: Object.fromEntries(data.capital.routeFit.map((r) => [r.route, `fit ${r.score}`])) }
    : undefined;

  return (
    <View style={{ gap: spacing.md }}>
      {data.capital && <CapitalProfileCard capital={data.capital} />}

      {data.auditUpdate && (
        <Well tone="primary">
          <Row center gap={6}>
            <Icon name="scan-outline" size={15} color={colors.primary} />
            <Text style={{ flex: 1, fontSize: font.xs + 1, fontFamily: fontFamily.semibold, color: colors.text }}>
              Updated from your codebase audit · {shortDay(data.auditUpdate.at)}{data.auditUpdate.appliedCount > 0 ? ` · ${data.auditUpdate.appliedCount} changes` : ""}
            </Text>
          </Row>
          {data.auditUpdate.applied.length > 0 && <Meta>{data.auditUpdate.applied.slice(0, 3).join(" · ")}</Meta>}
          {data.auditUpdate.pendingLoops.length > 0 && <Meta style={{ color: colors.warning }}>Your loops may have changed: {data.auditUpdate.pendingLoops.join("; ")}.</Meta>}
          {data.auditUpdate.pendingCount > 0 && (
            <Pressable onPress={() => onNavigate("codebase")} hitSlop={6} testID="button-review-audit-changes">
              <Text style={{ color: colors.primary, fontSize: font.xs + 1, fontFamily: fontFamily.semibold }}>
                Review {data.auditUpdate.pendingCount} waiting change{data.auditUpdate.pendingCount === 1 ? "" : "s"}
              </Text>
            </Pressable>
          )}
        </Well>
      )}

      {/* Pace strip */}
      <Card style={{ gap: spacing.sm }}>
        <Row between style={{ alignItems: "flex-start" }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Overline>Nova's path · {goalLabel(data.goal)}</Overline>
            <Row center gap={6}>
              {current.optional && <Icon name="git-branch-outline" size={14} color={colors.primary} />}
              <Text style={{ flexShrink: 1, fontFamily: fontFamily.bold, fontSize: font.base, color: colors.text }}>{current.title}</Text>
              {data.branch?.open && data.branch.round > 1 && <Tag label={`round ${data.branch.round}`} />}
            </Row>
          </View>
          {pace && (
            <View style={{ alignItems: "flex-end" }}>
              <Overline>{pace.mode === "pipeline" ? "Mode" : "Projected"}</Overline>
              <Text style={{ fontFamily: fontFamily.bold, fontSize: font.sm, color: colors.primary }}>{projection(pace)}</Text>
            </View>
          )}
        </Row>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceRaised, overflow: "hidden" }}>
          <NovaGradient style={{ width: `${Math.max(3, pct)}%`, height: "100%" }} />
        </View>
        <Meta>
          Step {current.step} of {current.of} · {mainLine.done}/{mainLine.total} on the main line
          {data.plan && data.plan.loops > 1 ? ` · ${data.plan.loops} loops · ${Math.round(data.plan.authoredDays / 7)}-week plan` : ""}
          {pace?.multiplier != null ? ` · ${pace.multiplier}× pace` : ""}
        </Meta>

        {pace && (
          <>
            <Divider style={{ marginVertical: 2 }} />
            <Row gap={spacing.sm} style={{ alignItems: "flex-start" }}>
              <Icon name="sparkles" size={14} color={colors.primary} />
              <Body muted style={{ flex: 1 }}>
                {pace.state === "nudge" ? "A week without a check-in. The date is unchanged — one small step keeps it that way. " : ""}{pace.note}
              </Body>
            </Row>
            <Row gap={spacing.sm} wrap>
              <Btn small variant="outline" icon="sparkles" label={adopt.isPending ? "Nova is re-reading…" : "Re-evaluate where I'm at"} loading={adopt.isPending} onPress={() => adopt.mutate()} />
              <Btn small variant="ghost" label={data.novaNotes ? "Edit your note to Nova" : "Tell Nova something"} onPress={() => setNotes(notes == null ? data.novaNotes : null)} />
            </Row>
            {notes != null && (
              <View style={{ gap: spacing.sm }}>
                <Meta>This outranks the brief and the board on every read. Say what's being removed, what your loops really are, anything Nova keeps getting wrong.</Meta>
                <Area value={notes} onChangeText={setNotes} rows={3} placeholder="e.g. Check-ins are being removed — they are not a loop." />
                <Row gap={spacing.sm}>
                  <Btn small label="Save" loading={saveNotes.isPending} onPress={() => saveNotes.mutate(notes)} />
                  <Btn small variant="ghost" label="Cancel" onPress={() => setNotes(null)} />
                </Row>
              </View>
            )}
            {data.rejectedLoops.length > 0 && <Meta>Not loops (Nova won't propose these again): {data.rejectedLoops.join(" · ")}</Meta>}
          </>
        )}
      </Card>

      {/* The fork after week 2 */}
      {data.offer && (
        <Card style={{ borderColor: `${colors.primary}66` }}>
          <Row center gap={6}><Icon name="git-branch-outline" size={14} color={colors.primary} /><Meta>Your product does its main thing. Two ways forward.</Meta></Row>
          <Text style={{ fontFamily: fontFamily.bold, fontSize: font.base, color: colors.text }}>{data.offer.title}</Text>
          <Body muted>Nova sorts what's left into what serves the loop and what starts its own, you pick, set a length, and the projected date moves live. Extending is activity — no decay, no penalty.</Body>
          <Row gap={spacing.sm} wrap>
            <Btn small icon="git-branch-outline" label="Keep building" loading={branch.isPending} onPress={() => branch.mutate({ phaseId: data.offer!.phaseId })} />
            <Btn small variant="outline" label={`Go to ${current.title.split(" — ")[1] ?? current.title}`} onPress={() => notify(`On to ${current.title}`, "info")} />
          </Row>
        </Card>
      )}
      {data.branch?.open && (
        <Row center gap={spacing.sm} wrap>
          <Icon name="git-branch-outline" size={14} color={colors.primary} />
          <Meta>Extending. When this round is built:</Meta>
          <Btn small variant="ghost" icon="repeat" label="Extend again" onPress={() => branch.mutate({ phaseId: data.branch!.phaseId, extend: true })} />
          <Btn small variant="ghost" icon="exit-outline" label="Go to users" onPress={() => branch.mutate({ phaseId: null })} />
        </Row>
      )}

      {/* The step you just finished: share its output for feedback, which comes back as notifications. */}
      {data.lastDone && next && (
        <Card style={{ paddingVertical: spacing.sm }}>
          <Row center gap={spacing.sm}>
            <Icon name="checkmark-circle" size={16} color={colors.success} />
            <Body style={{ flex: 1 }} numberOfLines={2}>Finished <Text style={{ fontFamily: fontFamily.semibold }}>{data.lastDone.title}</Text></Body>
          </Row>
          <Row gap={spacing.lg} wrap style={{ paddingLeft: 24 }}>
            {data.lastDone.sharedPostId ? (
              <LinkText label="See the feedback" icon="chatbubbles-outline" onPress={() => router.push(`/post/${data.lastDone!.sharedPostId}` as any)} testID="link-shared-step" />
            ) : (
              <>
                <LinkText label="Share it for feedback" icon="share-social-outline" onPress={() => setSharing("step")} testID="button-share-finished-step" />
                <LinkText label="Publish as artifact" icon="globe-outline" onPress={() => setSharing("artifact")} testID="button-publish-finished-step" />
              </>
            )}
          </Row>
        </Card>
      )}
      {next && data.weekly?.due && data.weekly.steps.length > 1 && (
        <Well tone="primary">
          <Row center gap={spacing.sm} wrap>
            <Body style={{ flex: 1 }}><Text style={{ fontFamily: fontFamily.semibold }}>{data.weekly.steps.length} steps</Text> finished this week and not shared yet</Body>
            <LinkText label="Post your weekly update" icon="megaphone-outline" onPress={() => setSharing("week")} testID="button-path-weekly-update" />
          </Row>
        </Well>
      )}
      {sharing === "step" && data.lastDone && (
        <ShareStepSheet projectId={projectId} projectTitle={projectTitle} step={data.lastDone} onClose={() => setSharing(null)} />
      )}
      {sharing === "artifact" && data.lastDone && (
        <PublishArtifactSheet projectId={projectId} step={data.lastDone} onClose={() => setSharing(null)} />
      )}
      {sharing === "week" && data.weekly && (
        <WeeklyUpdateSheet projectId={projectId} projectTitle={projectTitle} steps={data.weekly.steps} onClose={() => setSharing(null)} />
      )}

      {/* The one next action */}
      {next ? (
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1.5, borderColor: `${colors.primary}88`, overflow: "hidden" }}>
          <NovaGradient style={{ height: 4 }} />
          <View style={{ padding: spacing.md, gap: spacing.sm }}>
            <Row center gap={6} wrap>
              <Icon name={novaActs ? "sparkles" : "person-outline"} size={14} color={novaActs ? colors.primary : colors.textSecondary} />
              <Overline color={colors.primary}>Your next action</Overline>
            </Row>
            <Text style={{ fontFamily: fontFamily.bold, fontSize: font.lg, color: colors.text, lineHeight: 23 }}>{next.title}</Text>
            <Meta>{ACTOR_LABEL[next.actor]} · {estimate(next.estimateMinutes)} · {TIER_LABEL[next.tier]}{next.steps ? ` · ${next.steps.done}/${next.steps.total} steps` : ""}</Meta>
            {!!next.description && <Body muted>{next.description}</Body>}

            {next.loops.length > 0 && (
              <View style={{ gap: 6 }}>
                <Overline>Loops · {next.loops.length}</Overline>
                {next.loops.map((l) => (
                  <View key={l.taskId} style={{ gap: 4 }}>
                    <Row center gap={spacing.sm}>
                      <Tick done={l.status === "done"} size={16} />
                      <Text style={{ flex: 1, fontSize: font.sm, color: colors.text, fontFamily: fontFamily.medium }} numberOfLines={2}>{l.title}</Text>
                      <Tag label={LOOP_TYPE_INFO[l.type ?? "product"]?.label ?? "Loop"} color={LOOP_TYPE_COLOR[l.type ?? "product"]} />
                    </Row>
                    {l.status !== "done" && <Meta style={{ marginLeft: 24 }}>not written yet</Meta>}
                    {next.expandsFrom && !l.expanded && (
                      <Btn small variant="outline" icon="git-branch-outline" label="Break into steps" disabled={!!draft} loading={expand.isPending && expand.variables?.loopTaskId === l.taskId}
                        onPress={() => expand.mutate({ backboneId: next.id, loopTaskId: l.taskId })} style={{ alignSelf: "flex-start", marginLeft: 24 }} />
                    )}
                  </View>
                ))}
                {(next.missingLoopTypes?.length ?? 0) > 0 && (
                  <Meta style={{ color: colors.warning }}>Still missing: {(next.missingLoopTypes ?? []).map((t) => LOOP_TYPE_INFO[t].label.toLowerCase()).join(", ")}. A business needs all five before this is done.</Meta>
                )}
              </View>
            )}

            {next.step && (
              <Well>
                <Overline>{next.step.isLoop ? "Write this loop" : next.step.loop ? `Step · ${next.step.loop.title}` : "This step"}</Overline>
                <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{next.step.title}</Text>
                {!!next.step.description && <Meta>{next.step.description}</Meta>}
              </Well>
            )}

            {next.workTaskId && !(next.expandsFrom && !next.steps) && !(isSource(next.id) && next.loops.length > 0 && !next.step) && (
              <View style={{ borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.md }}>
                <WorkView
                  projectId={projectId} taskId={next.workTaskId} actor={next.step?.actor ?? next.actor} work={next.work} done={false}
                  intake={next.step ? undefined : next.intake} workKind={next.step ? undefined : next.workKind}
                  prefill={next.step ? undefined : next.prefill} optionNotes={routeNotes}
                />
              </View>
            )}

            <Row gap={spacing.sm} wrap style={{ paddingTop: 2 }}>
              {isSource(next.id) && !loopForm && (
                <Btn small variant="outline" icon="add" label={next.missingLoopTypes?.length ? `Add the ${LOOP_TYPE_INFO[next.missingLoopTypes[0]].label.toLowerCase()}` : "Add another loop"}
                  onPress={() => { const t = next.missingLoopTypes?.[0] ?? "product"; setLoopForm({ title: next.missingLoopTypes?.length ? LOOP_TYPE_INFO[t].label : "", description: "", type: t }); }} />
              )}
              {next.expandsFrom && !next.steps && next.loops.length === 0 && (
                <Btn small icon="git-branch-outline" label="Break into steps with Nova" disabled={!!draft} loading={expand.isPending} onPress={() => expand.mutate({ backboneId: next.id })} />
              )}
              {next.taskId && (
                <Btn small variant="outline" icon="checkmark-circle-outline" label={next.tier === "claimed" ? "I did this" : "Done"} loading={markDone.isPending}
                  onPress={() => markDone.mutate(next.step?.taskId ?? next.taskId!)} />
              )}
              <Btn small variant="ghost" label="Open in tasks" onPress={() => onNavigate("kanban")} />
            </Row>

            {loopForm && (
              <View style={{ gap: spacing.sm, borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.sm }}>
                <Meta>Name the loop and, if you can, its 3–5 steps. Nova can draft the steps from the name later.</Meta>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {addableLoopTypes(next.loops.map((l) => ({ type: l.type ?? "product" }))).map((t) => (
                    <Bubble key={t} small label={LOOP_TYPE_INFO[t].label} on={loopForm.type === t} onPress={() => setLoopForm({ ...loopForm, type: t })} />
                  ))}
                </View>
                <Line value={loopForm.title} onChangeText={(t) => setLoopForm({ ...loopForm, title: t })} placeholder="e.g. The feed — explore what others are building" />
                <Area value={loopForm.description} onChangeText={(t) => setLoopForm({ ...loopForm, description: t })} rows={3} placeholder="1. Open the feed 2. Read a check-in 3. React or reply 4. Follow the project" />
                <Row gap={spacing.sm}>
                  <Btn small label="Add loop" disabled={!loopForm.title.trim()} loading={addLoop.isPending} onPress={() => addLoop.mutate({ backboneId: next.expandsFrom ?? next.id, ...loopForm })} />
                  <Btn small variant="ghost" label="Cancel" onPress={() => setLoopForm(null)} />
                </Row>
              </View>
            )}
            {draft && (
              <View style={{ gap: spacing.sm, borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: spacing.sm }}>
                <Meta>Nothing was written under {draft.sourceTitle} yet, so Nova drafted it from your project. Edit anything that's wrong, then build the steps from it.</Meta>
                <Area value={draft.text} onChangeText={(t) => setDraft({ ...draft, text: t })} rows={6} />
                <Row gap={spacing.sm} wrap>
                  <Btn small label="Looks right — build the steps" disabled={!draft.text.trim()} loading={expand.isPending}
                    onPress={() => expand.mutate({ backboneId: draft.backboneId, loopTaskId: draft.loopTaskId, artifact: draft.text })} />
                  <Btn small variant="ghost" label="Cancel" onPress={() => setDraft(null)} />
                </Row>
              </View>
            )}
          </View>
        </View>
      ) : (
        <Card>
          <Row center gap={spacing.sm}><Icon name="trophy-outline" size={18} color={colors.success} /><Text style={{ fontFamily: fontFamily.bold, fontSize: font.base, color: colors.text }}>The path is complete.</Text></Row>
          {data.proposal?.map((p) => (
            <Row key={p.goal} between style={{ alignItems: "flex-start" }} gap={spacing.md}>
              <View style={{ flex: 1 }}><Body style={{ fontFamily: fontFamily.semibold }}>{goalLabel(p.goal)}</Body><Meta>{p.why}</Meta></View>
              <Btn small variant="outline" label="Go" onPress={() => { setShowSwitch(true); setShowMap(true); }} />
            </Row>
          ))}
        </Card>
      )}

      {/* Week 2's screen: the product as loops */}
      {data.loopTree && (
        <Card>
          <Row center gap={6}><Icon name="list-outline" size={16} color={colors.primary} /><Text style={{ fontFamily: fontFamily.bold, fontSize: font.base, color: colors.text }}>Your loops</Text></Row>
          <Meta>Each is written, broken into steps, and built — tap any one.</Meta>
          <LoopTree projectId={projectId} tree={data.loopTree} />
        </Card>
      )}

      {/* The whole path */}
      <Pressable onPress={() => setShowMap(!showMap)} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: spacing.sm }, pressed && { opacity: 0.6 }]}>
        <Icon name="map-outline" size={16} color={colors.primary} />
        <Text style={{ color: colors.primary, fontFamily: fontFamily.semibold, fontSize: font.sm }}>{showMap ? "Hide the path" : "See the whole path"}</Text>
        <Icon name={showMap ? "chevron-up" : "chevron-down"} size={14} color={colors.primary} />
      </Pressable>

      {showMap && (
        <Card style={{ gap: spacing.md }}>
          <Body muted>{data.promise}.</Body>
          {data.phases.map((phase) => (
            <View key={phase.id} style={[{ gap: 2 }, phase.optional && { borderLeftWidth: 2, borderStyle: "dashed", borderColor: colors.border, paddingLeft: spacing.md }]}>
              <Row center gap={6} style={{ marginBottom: 4 }}>
                {phase.optional && <Icon name="git-branch-outline" size={13} color={colors.textTertiary} />}
                <Text style={{ flex: 1, fontFamily: fontFamily.bold, fontSize: font.sm, color: colors.text }}>{phase.title}</Text>
                <Tag label={`${phase.done}/${phase.total}`} color={phase.done === phase.total && phase.total > 0 ? colors.success : colors.textSecondary} />
              </Row>
              {phase.optional && data.branch?.phaseId !== phase.id && (
                <Btn small variant="ghost" label="Work this branch" onPress={() => branch.mutate({ phaseId: phase.id })} style={{ alignSelf: "flex-start" }} />
              )}
              {phase.milestones.map((m) => (
                <Pressable key={m.id} onPress={() => setOpenMilestone({ id: m.id, title: m.title })} style={({ pressed }) => [{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: 7 }, pressed && { opacity: 0.6 }]}>
                  <View style={{ marginTop: 1 }}><Tick done={m.done} size={17} /></View>
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: m.done ? colors.textTertiary : colors.text, textDecorationLine: m.done ? "line-through" : "none" }}>
                      {m.title}{m.steps ? <Text style={{ color: colors.textTertiary }}> ({m.steps.done}/{m.steps.total} steps)</Text> : null}
                    </Text>
                    <Meta>{m.actor === "user-does" ? "You" : "Nova"} · {estimate(m.estimateMinutes)}</Meta>
                  </View>
                  {!m.done && (
                    <Pressable hitSlop={8} onPress={() => mark.mutate([m.id])} disabled={mark.isPending}>
                      <Text style={{ fontSize: font.xs, color: colors.primary, fontFamily: fontFamily.semibold }}>Mark done</Text>
                    </Pressable>
                  )}
                  <Icon name="chevron-forward" size={14} color={colors.textTertiary} />
                </Pressable>
              ))}
              {phase.injected.map((t) => (
                <Row key={t.id} gap={spacing.sm} style={{ paddingVertical: 5, alignItems: "flex-start" }}>
                  {t.status === "done" ? <Tick done size={17} /> : <Icon name="sparkles-outline" size={16} color={colors.primary} />}
                  <Text style={{ flex: 1, fontSize: font.sm, color: t.status === "done" ? colors.textTertiary : colors.text, textDecorationLine: t.status === "done" ? "line-through" : "none", fontFamily: fontFamily.regular }}>{t.title}</Text>
                  <Meta>Nova added</Meta>
                </Row>
              ))}
              {!!phase.checkpoint && <Meta style={{ fontStyle: "italic", marginTop: 2 }}>{phase.checkpoint}</Meta>}
              {!phase.optional && (
                <Pressable disabled={inject.isPending || phase.injectRoom <= 0} onPress={() => inject.mutate(phase.id)} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6 }}>
                  <Icon name="add" size={13} color={phase.injectRoom > 0 ? colors.textSecondary : colors.textTertiary} />
                  <Meta>{phase.injectRoom > 0 ? `Ask Nova what this phase is missing (${phase.injectRoom} left)` : "Nova's additions for this phase are full"}</Meta>
                </Pressable>
              )}
              <Divider style={{ marginTop: spacing.sm }} />
            </View>
          ))}

          {!showSwitch ? (
            <Btn small variant="ghost" icon="swap-horizontal" label="Move this project to another path" onPress={() => setShowSwitch(true)} style={{ alignSelf: "flex-start" }} />
          ) : (
            <SwitchForm current={data.goal} pending={switchPath.isPending} onSwitch={(b) => switchPath.mutate(b)} onCancel={() => setShowSwitch(false)} />
          )}
        </Card>
      )}

      <MilestoneSheet projectId={projectId} backboneId={openMilestone?.id ?? null} title={openMilestone?.title ?? ""} onClose={() => setOpenMilestone(null)} />
    </View>
  );
}

function LinkText({ label, icon, onPress, testID }: { label: string; icon: React.ComponentProps<typeof Icon>["name"]; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} testID={testID} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 4 }, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={13} color={colors.primary} />
      <Text style={{ color: colors.primary, fontFamily: fontFamily.semibold, fontSize: font.xs + 1 }}>{label}</Text>
    </Pressable>
  );
}

function SwitchForm({ current, pending, onSwitch, onCancel }: { current: ProjectGoal; pending: boolean; onSwitch: (b: { goal: ProjectGoal; subcategory: string }) => void; onCancel: () => void }) {
  const others = PROJECT_GOALS.filter((g) => g.id !== current);
  const [goal, setGoal] = useState<ProjectGoal>(others[0].id);
  const [sub, setSub] = useState("other");
  return (
    <View style={{ gap: spacing.sm }}>
      <Meta>Shared milestones you've already finished carry across as done. The current path's tasks stay on the board, marked.</Meta>
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
