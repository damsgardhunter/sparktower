/**
 * The Roadmap tab (client/src/components/roadmap-tab.tsx and
 * section/section-roadmap.tsx): the open section's path laid out phase by
 * phase — done, next, to do, the checkpoint that closes each phase — with any
 * milestone a tap away. On the primary section the project-wide AI roadmap
 * (build from a goal, what next, re-plan, rebuild) stays underneath.
 */
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Body, Btn, Card, Cost, Field, Icon, Loading, Meta, NovaGradient, Progress, Row } from "../ui";
import { Clamp, Overline, Pill, Tag, Tick, useNotify } from "./bits";
import { MilestoneSheet } from "./MilestoneDetail";
import { ACTOR_SHORT, estimate, mkey, shortDay, useRefreshPath, type NoPath, type PathPhase, type PathStatus } from "./shared";
import { sectionDef, useSectionPath, type ProjectGoal } from "../../sections";

export function Roadmap({ projectId, goal, isPrimary }: { projectId: string; goal: ProjectGoal; isPrimary: boolean }) {
  const [showAi, setShowAi] = useState(false);
  return (
    <View style={{ gap: spacing.md }}>
      <SectionRoadmap projectId={projectId} goal={goal} />
      {isPrimary && (
        <View style={{ gap: spacing.md, borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.md }}>
          <Pressable onPress={() => setShowAi(!showAi)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 6 }} testID="button-toggle-ai-roadmap">
            <Icon name="map-outline" size={13} color={colors.textTertiary} />
            <Overline>Project roadmap (AI)</Overline>
            <Icon name={showAi ? "chevron-up" : "chevron-down"} size={13} color={colors.textTertiary} />
          </Pressable>
          {showAi && <AiRoadmap projectId={projectId} />}
        </View>
      )}
    </View>
  );
}

function projection(p: NonNullable<PathStatus["pace"]>) {
  if (p.mode === "pipeline") return "Pipeline";
  if (p.mode === "none" || !p.projectedAt) return "No date yet";
  if (p.mode === "range" && p.projectedLow && p.projectedHigh) return `${shortDay(p.projectedLow)} – ${shortDay(p.projectedHigh)}`;
  return shortDay(p.projectedAt);
}

function SectionRoadmap({ projectId, goal }: { projectId: string; goal: ProjectGoal }) {
  const { data, isLoading } = useSectionPath<PathStatus | NoPath>(projectId, goal);
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null);
  const def = sectionDef(goal);

  if (isLoading) return <View style={{ height: 200 }}><Loading /></View>;
  if (!data) return null;
  if (!data.adopted) {
    return (
      <View style={{ alignItems: "center", gap: 4, paddingVertical: spacing.xl, borderRadius: radius.md, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.border, backgroundColor: colors.surface }}>
        <Text style={{ fontSize: font.base, fontFamily: fontFamily.semibold, color: colors.text }}>{def.label}</Text>
        <Meta>{data.started === false ? "Not started yet — start it to see its roadmap." : "Set up this path on the Dashboard to see its roadmap."}</Meta>
      </View>
    );
  }

  let index = 0;
  return (
    <View style={{ gap: spacing.md }} testID="section-roadmap">
      <Card>
        <Row center gap={6}><Icon name={def.icon} size={16} color={colors.primary} /><Text style={{ fontSize: font.lg, fontFamily: fontFamily.bold, color: colors.text }}>{def.label}</Text></Row>
        <Clamp text={data.promise} lines={1} />
        <Row wrap gap={5}>
          <Pill label={`${data.mainLine.done}/${data.mainLine.total} milestones`} />
          <Pill label={`${data.phases.filter((p) => !p.optional).length} phases`} />
          {data.pace && <Pill icon="time-outline" label={`Finish ${projection(data.pace)}`} />}
        </Row>
      </Card>
      {data.phases.map((phase) => {
        const n = phase.optional ? index : index++;
        return <PhaseCard key={phase.id} projectId={projectId} goal={goal} data={data} phase={phase} index={n} onOpen={setOpen} />;
      })}
      <MilestoneSheet projectId={projectId} backboneId={open?.id ?? null} title={open?.title ?? ""} onClose={() => setOpen(null)} />
    </View>
  );
}

function PhaseCard({ projectId, goal, data, phase, index, onOpen }: {
  projectId: string; goal: ProjectGoal; data: PathStatus; phase: PathPhase; index: number; onOpen: (m: { id: string; title: string }) => void;
}) {
  const refresh = useRefreshPath(projectId);
  const { notify, fail } = useNotify();
  const inject = useMutation({
    mutationFn: () => api<any>(`/api/projects/${projectId}/path/inject`, { method: "POST", body: { phaseId: phase.id, goal } }),
    onSuccess: (r) => { refresh(); notify(r?.created?.length ? `Nova added ${r.created.length} task${r.created.length === 1 ? "" : "s"}` : "Nothing missing here"); },
    onError: (e) => fail(e),
  });
  const branch = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/path/branch`, { method: "POST", body: { phaseId: phase.id, goal } }),
    onSuccess: () => { refresh(); notify("Working the branch"); },
    onError: (e) => fail(e),
  });

  const isCurrent = phase.id === data.current.id;
  const complete = phase.total > 0 && phase.done === phase.total;
  const pct = phase.total ? Math.round((phase.done / phase.total) * 100) : 0;
  const [head, tail] = phase.title.split(" — ");
  const status = phase.optional ? "Branch" : complete ? "Done" : isCurrent ? "Now" : phase.done > 0 ? "Started" : "Up next";

  return (
    <View
      testID={`roadmap-phase-${phase.id}`}
      style={{
        backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: isCurrent ? 1.5 : 1,
        borderColor: isCurrent ? `${colors.primary}88` : colors.border, borderStyle: phase.optional ? "dashed" : "solid", overflow: "hidden",
      }}
    >
      <View style={{ padding: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderColor: colors.borderSubtle }}>
        <Row center gap={spacing.sm}>
          <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: complete ? colors.success : isCurrent ? colors.primary : colors.surfaceRaised }}>
            {complete ? <Icon name="checkmark" size={14} color="#FFFFFF" /> : phase.optional ? <Icon name="git-branch-outline" size={12} color={colors.textTertiary} />
              : <Text style={{ fontSize: 11, fontFamily: fontFamily.semibold, color: isCurrent ? "#FFFFFF" : colors.textTertiary }}>{index + 1}</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontSize: font.sm + 1, fontFamily: fontFamily.semibold, color: colors.text }}>{head}</Text>
            {!!tail && <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: fontFamily.regular, color: colors.textTertiary }}>{tail}</Text>}
          </View>
          {isCurrent && !phase.optional && !complete ? (
            <NovaGradient style={{ borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ fontSize: 10.5, fontFamily: fontFamily.semibold, color: "#FFFFFF" }}>{status}</Text>
            </NovaGradient>
          ) : <Tag label={status} color={complete ? colors.success : colors.textSecondary} />}
        </Row>
        <Row center gap={spacing.sm}>
          <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.surfaceRaised, overflow: "hidden" }}>
            {pct > 0 && <View style={{ width: `${pct}%`, height: "100%", backgroundColor: colors.primary }} />}
          </View>
          <Text style={{ fontSize: 10, fontFamily: fontFamily.medium, color: colors.textTertiary }}>{phase.done}/{phase.total}</Text>
        </Row>
      </View>

      {phase.milestones.map((m, i) => {
        const isNext = m.id === data.next?.id;
        return (
          <Pressable
            key={m.id}
            onPress={() => onOpen({ id: m.id, title: m.title })}
            testID={`roadmap-open-${m.id}`}
            style={({ pressed }) => [{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: i ? 1 : 0, borderColor: colors.borderSubtle, backgroundColor: isNext ? `${colors.primary}08` : "transparent" }, pressed && { opacity: 0.6 }]}
          >
            <View style={{ marginTop: 2 }}>
              {m.done ? <Tick done size={15} /> : isNext ? (
                <NovaGradient style={{ width: 15, height: 15, borderRadius: 8, padding: 2.5 }}><View style={{ flex: 1, borderRadius: 5, backgroundColor: colors.surface }} /></NovaGradient>
              ) : <Tick done={false} size={15} />}
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text numberOfLines={2} style={{ fontSize: font.sm, lineHeight: 18, fontFamily: isNext ? fontFamily.semibold : fontFamily.regular, color: m.done ? colors.textTertiary : colors.text }}>{m.title}</Text>
              <Text style={{ fontSize: 10.5, fontFamily: fontFamily.regular, color: colors.textTertiary }}>
                {isNext ? <Text style={{ color: colors.novaEmerald, fontFamily: fontFamily.semibold }}>Next · </Text> : null}
                {ACTOR_SHORT[m.actor]} · {estimate(m.estimateMinutes)}{m.steps ? ` · ${m.steps.done}/${m.steps.total} steps` : ""}
              </Text>
            </View>
            <Icon name="chevron-forward" size={13} color={colors.textTertiary} />
          </Pressable>
        );
      })}
      {phase.injected.map((t) => (
        <Row key={t.id} gap={spacing.sm} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderColor: colors.borderSubtle, alignItems: "flex-start" }}>
          {t.status === "done" ? <Tick done size={15} /> : <Icon name="sparkles-outline" size={15} color={`${colors.primary}99`} />}
          <Text numberOfLines={2} style={{ flex: 1, fontSize: font.sm, fontFamily: fontFamily.regular, color: t.status === "done" ? colors.textTertiary : colors.text }}>{t.title}</Text>
        </Row>
      ))}

      {(phase.checkpoint || phase.optional || phase.injectRoom > 0) && (
        <View style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 4, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
          {!!phase.checkpoint && (
            <Row gap={5} style={{ alignItems: "flex-start" }}>
              <View style={{ marginTop: 2 }}><Icon name="flag-outline" size={11} color={colors.textTertiary} /></View>
              <Text numberOfLines={2} style={{ flex: 1, fontSize: 11, lineHeight: 15, fontFamily: fontFamily.regular, color: colors.textTertiary }}>{phase.checkpoint}</Text>
            </Row>
          )}
          {phase.optional ? (
            data.branch?.phaseId !== phase.id && <Btn small variant="ghost" icon="git-branch-outline" label="Work this branch" loading={branch.isPending} onPress={() => branch.mutate()} style={{ alignSelf: "flex-start" }} />
          ) : phase.injectRoom > 0 && !complete && (
            <Pressable disabled={inject.isPending} onPress={() => inject.mutate()} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 4 }} testID={`roadmap-inject-${phase.id}`}>
              <Icon name="add" size={13} color={colors.textSecondary} />
              <Text style={{ fontSize: 11, fontFamily: fontFamily.medium, color: colors.textSecondary }}>{inject.isPending ? "Nova is looking…" : "What's missing?"}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

/** The project-wide AI roadmap: build from a goal, ask what's next, re-plan, rebuild. */
function AiRoadmap({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { fail } = useNotify();
  const [goal, setGoal] = useState("");
  const [next, setNext] = useState<any>(null);
  const key = mkey(projectId, "roadmap");

  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api<any>(`/api/projects/${projectId}/roadmap`) });
  const { data: quote } = useQuery({
    queryKey: mkey(projectId, "roadmap", "quote"),
    queryFn: () => api<any>(`/api/projects/${projectId}/roadmap/rebuild-quote`),
    enabled: !!data?.roadmap,
  });
  const done = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["subscription"] }); };

  const generate = useMutation({ mutationFn: () => api(`/api/projects/${projectId}/roadmap/generate`, { method: "POST", body: { goal } }), onSuccess: () => { setGoal(""); done(); }, onError: (e) => fail(e) });
  const nextActions = useMutation({ mutationFn: () => api<any>(`/api/projects/${projectId}/roadmap/next-actions`, { method: "POST" }), onSuccess: (r) => { setNext(r); done(); }, onError: (e) => fail(e) });
  const replan = useMutation({ mutationFn: () => api(`/api/projects/${projectId}/roadmap/update`, { method: "POST" }), onSuccess: done, onError: (e) => fail(e) });
  const rebuild = useMutation({ mutationFn: () => api(`/api/projects/${projectId}/roadmap/rebuild`, { method: "POST" }), onSuccess: done, onError: (e) => fail(e) });

  if (isLoading) return <View style={{ height: 240 }}><Loading /></View>;

  if (!data?.roadmap) {
    return (
      <Card style={{ gap: spacing.md }}>
        <Row center gap={6}><Icon name="map-outline" size={17} color={colors.primary} /><Text style={{ fontFamily: fontFamily.bold, fontSize: font.lg, color: colors.text }}>Build your roadmap</Text></Row>
        <Meta>Nova plans backwards from your goal, using your project brief.</Meta>
        <Field label="Where do you want to get to?" value={goal} onChangeText={setGoal} multiline placeholder="e.g. Launch to 500 students across 3 campuses by June" />
        <Row center gap={spacing.sm}>
          <Btn label="Build my roadmap" disabled={!goal.trim()} loading={generate.isPending} onPress={() => generate.mutate()} style={{ flex: 1 }} />
          <Cost credits={3} />
        </Row>
      </Card>
    );
  }

  const phases: any[] = data.roadmap.phases ?? [];
  const complete = phases.filter((p) => p.status === "completed").length;

  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <Meta>Goal · v{data.roadmap.version}</Meta>
        <Text style={{ fontFamily: fontFamily.bold, fontSize: font.lg, color: colors.text }}>{data.roadmap.goal}</Text>
        {!!data.roadmap.summary && <Body muted>{data.roadmap.summary}</Body>}
        <Progress value={(complete / Math.max(1, phases.length)) * 100} />
        <Meta>{complete} of {phases.length} phases complete</Meta>
        <Row center gap={spacing.sm} style={{ marginTop: spacing.xs }}>
          <Btn small icon="sparkles" label="What should I do next?" loading={nextActions.isPending} onPress={() => nextActions.mutate()} style={{ flex: 1 }} />
          <Cost credits={3} />
        </Row>
        <Row center gap={spacing.sm}>
          <Btn small variant="outline" label="Re-plan" loading={replan.isPending} onPress={() => replan.mutate()} style={{ flex: 1 }} />
          <Cost credits={2} />
          <Btn small variant="outline" label="Rebuild" loading={rebuild.isPending} onPress={() => rebuild.mutate()} style={{ flex: 1 }} />
          <Cost credits={quote?.cost ?? 8} />
        </Row>
      </Card>

      {next && (
        <Card accent={colors.primary}>
          <Meta>Do these next</Meta>
          {!!next.reasoning && <Body muted>{next.reasoning}</Body>}
          {(next.actions ?? []).map((a: any, i: number) => (
            <View key={i} style={{ gap: 3, marginTop: spacing.sm }}>
              <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>{i + 1}. {a.title}</Text>
              <Meta>{a.why}</Meta>
              <Row gap={spacing.xs}>
                <Tag label={a.impact === "high" ? "High impact" : "Medium impact"} color={a.impact === "high" ? colors.primary : colors.textSecondary} />
                {!!a.effort && <Tag label={a.effort} color={colors.textSecondary} />}
              </Row>
            </View>
          ))}
        </Card>
      )}

      {phases.map((p) => (
        <Card key={p.id}>
          <Row center gap={spacing.sm}>
            <Icon name={p.status === "completed" ? "checkmark-circle" : p.status === "in-progress" ? "radio-button-on" : "ellipse-outline"} size={18}
              color={p.status === "completed" ? colors.success : p.status === "in-progress" ? colors.primary : colors.textTertiary} />
            <Text style={{ flex: 1, fontFamily: fontFamily.semibold, fontSize: font.base, color: colors.text }}>{p.title}</Text>
          </Row>
          {!!p.estimatedDuration && <Meta>{p.estimatedDuration}</Meta>}
          {!!p.description && <Body muted>{p.description}</Body>}
        </Card>
      ))}
    </View>
  );
}
