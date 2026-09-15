/**
 * The goal-driven roadmap (the web's Roadmap tab): build it from a goal,
 * ask what to do next, re-plan or rebuild, and read the phases.
 */
import { useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors, font, fontFamily, spacing } from "../../theme";
import { Body, Btn, Card, Cost, Field, Icon, Loading, Meta, Progress, Row } from "../ui";
import { Tag, useNotify } from "./bits";
import { mkey } from "./shared";

export function Roadmap({ projectId }: { projectId: string }) {
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
