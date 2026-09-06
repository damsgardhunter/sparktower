import { useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { colors, spacing } from "../../src/theme";
import {
  Body, Btn, Card, Chip, Cost, Empty, ErrorNote, Field, H1, H2, Label, Loading,
  Meta, Progress, Row, Screen, Segments, errText,
} from "../../src/components/ui";

type Tab = "nova" | "roadmap" | "tasks" | "investor";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Nova's project dashboard — the native counterpart of the web Manage screen. */
export default function Manage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("nova");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const { data: briefing, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["briefing", id],
    queryFn: () => api<any>(`/api/projects/${id}/nova-briefing`),
    enabled: !!id,
  });

  const runAction = useMutation({
    mutationFn: (endpoint: string) => api(endpoint, { method: "POST" }),
    onSuccess: () => {
      setRunning(null);
      setError(null);
      qc.invalidateQueries({ queryKey: ["briefing", id] });
      qc.invalidateQueries({ queryKey: ["subscription"] });
    },
    onError: (e) => { setRunning(null); setError(errText(e, "Couldn't run that.")); },
  });

  if (isLoading) return <Loading />;
  if (!briefing) return <Screen><Empty title="Couldn't load this project" /></Screen>;

  const severityColor = (s: string) =>
    s === "critical" ? colors.danger : s === "important" ? colors.warning : colors.primary;

  return (
    <>
      <Stack.Screen options={{ title: briefing.project?.title || "Manage" }} />
      <Screen onRefresh={refetch} refreshing={isRefetching}>
        <Segments
          options={[
            { value: "nova" as Tab, label: "Dashboard" },
            { value: "roadmap" as Tab, label: "Roadmap" },
            { value: "tasks" as Tab, label: "Tasks" },
            { value: "investor" as Tab, label: "Investor" },
          ]}
          value={tab}
          onChange={setTab}
        />

        {error && <ErrorNote message={error} />}

        {tab === "nova" && (
          <>
            <View style={{ gap: spacing.xs }}>
              <H1>{greeting()}, {user?.firstName || "there"}</H1>
              <Body muted>
                Your project is <Text style={{ color: colors.text, fontWeight: "700" }}>
                  {briefing.completion}% complete
                </Text>
              </Body>
              <Progress value={briefing.completion} />
            </View>

            <Row wrap gap={spacing.sm}>
              <Card style={{ flex: 1, minWidth: 140 }}>
                <Label>Phases done</Label>
                <H2>{briefing.stats.completedPhases}/{briefing.stats.phases}</H2>
              </Card>
              <Card style={{ flex: 1, minWidth: 140 }}>
                <Label>Tasks done</Label>
                <H2>{briefing.stats.doneTasks}/{briefing.stats.tasks}</H2>
              </Card>
              <Card style={{ flex: 1, minWidth: 140 }}>
                <Label>Milestones</Label>
                <H2>{briefing.stats.milestones}</H2>
              </Card>
              <Card style={{ flex: 1, minWidth: 140 }}>
                <Label>Team</Label>
                <H2>{briefing.stats.members}/{briefing.stats.teamSize ?? "?"}</H2>
              </Card>
            </Row>

            <Label>Nova recommends</Label>
            {!briefing.recommendations?.length ? (
              <Card>
                <H2>Nothing needs your attention</H2>
                <Meta>Your brief, roadmap, tasks and team are all in good shape.</Meta>
              </Card>
            ) : (
              briefing.recommendations.map((r: any, i: number) => (
                <Card key={r.id} accent={severityColor(r.severity)}>
                  <Row gap={spacing.sm} style={{ alignItems: "flex-start" }}>
                    <Meta style={{ fontWeight: "800", marginTop: 2 }}>{i + 1}.</Meta>
                    <View style={{ flex: 1, gap: spacing.xs }}>
                      <Body style={{ fontWeight: "700" }}>{r.title}</Body>
                      {r.detail && <Meta>{r.detail}</Meta>}
                      <Row center gap={spacing.sm}>
                        <Btn
                          label={r.actionLabel}
                          variant={r.severity === "critical" ? "primary" : "outline"}
                          small
                          loading={running === r.id}
                          onPress={() => {
                            if (r.endpoint) { setRunning(r.id); runAction.mutate(r.endpoint); }
                            else if (r.tab === "roadmap") setTab("roadmap");
                            else if (r.tab === "kanban") setTab("tasks");
                            else if (r.tab === "strategy") setTab("investor");
                          }}
                        />
                        {r.credits > 0 && <Cost credits={r.credits} />}
                      </Row>
                    </View>
                  </Row>
                </Card>
              ))
            )}
            <Meta>Recommendations are free — you only spend credits when you run one.</Meta>

            <Label>Project tools</Label>
            {[
              { href: `/project/visibility?id=${id}`, glyph: "👁", label: "Public page", sub: "Choose what visitors see" },
              { href: `/project/storyboards?id=${id}`, glyph: "🎬", label: "AI storyboard", sub: "A showcase reel from your brief", credits: 5 },
              { href: `/project/${id}`, glyph: "🚀", label: "View public page", sub: "See it the way visitors do" },
            ].map((t) => (
              <Card key={t.href} onPress={() => router.push(t.href as any)}>
                <Row center gap={spacing.md}>
                  <Text style={{ fontSize: 22 }}>{t.glyph}</Text>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{t.label}</Body>
                    <Meta>{t.sub}</Meta>
                  </View>
                  {t.credits ? <Cost credits={t.credits} /> : <Meta>›</Meta>}
                </Row>
              </Card>
            ))}
          </>
        )}

        {tab === "roadmap" && <RoadmapTab projectId={id!} />}
        {tab === "tasks" && <TasksTab projectId={id!} />}
        {tab === "investor" && <InvestorTab projectId={id!} />}
      </Screen>
    </>
  );
}

function RoadmapTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [goal, setGoal] = useState("");
  const [next, setNext] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["project", projectId, "roadmap"],
    queryFn: () => api<any>(`/api/projects/${projectId}/roadmap`),
  });

  const { data: quote } = useQuery({
    queryKey: ["project", projectId, "rebuild-quote"],
    queryFn: () => api<any>(`/api/projects/${projectId}/roadmap/rebuild-quote`),
    enabled: !!data?.roadmap,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["project", projectId, "roadmap"] });

  const generate = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/roadmap/generate`, { method: "POST", body: { goal } }),
    onSuccess: () => { setGoal(""); invalidate(); },
    onError: (e) => setError(errText(e)),
  });

  const nextActions = useMutation({
    mutationFn: () => api<any>(`/api/projects/${projectId}/roadmap/next-actions`, { method: "POST" }),
    onSuccess: (r) => setNext(r),
    onError: (e) => setError(errText(e)),
  });

  const replan = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/roadmap/update`, { method: "POST" }),
    onSuccess: invalidate,
    onError: (e) => setError(errText(e)),
  });

  const rebuild = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/roadmap/rebuild`, { method: "POST" }),
    onSuccess: invalidate,
    onError: (e) => setError(errText(e)),
  });

  if (isLoading) return <Loading />;

  if (!data?.roadmap) {
    return (
      <Card>
        <H2>Build your roadmap</H2>
        <Meta>Nova plans backwards from your goal, using your project brief.</Meta>
        <Field label="Where do you want to get to?" value={goal} onChangeText={setGoal} multiline
          placeholder="e.g. Launch to 500 students across 3 campuses by June" />
        {error && <ErrorNote message={error} />}
        <Row center gap={spacing.sm}>
          <Btn label="Build my roadmap" disabled={!goal.trim()} loading={generate.isPending}
            onPress={() => generate.mutate()} style={{ flex: 1 }} />
          <Cost credits={3} />
        </Row>
      </Card>
    );
  }

  const done = data.roadmap.phases.filter((p: any) => p.status === "completed").length;

  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <Label>Goal · v{data.roadmap.version}</Label>
        <H2>{data.roadmap.goal}</H2>
        {data.roadmap.summary && <Body muted>{data.roadmap.summary}</Body>}
        <Progress value={(done / Math.max(1, data.roadmap.phases.length)) * 100} />
        <Meta>{done} of {data.roadmap.phases.length} phases complete</Meta>
      </Card>

      <Row center gap={spacing.sm}>
        <Btn label="What should I do next?" loading={nextActions.isPending}
          onPress={() => nextActions.mutate()} style={{ flex: 1 }} />
        <Cost credits={3} />
      </Row>

      {next && (
        <Card accent={colors.primary}>
          <Label>Do these next</Label>
          {next.reasoning && <Body muted>{next.reasoning}</Body>}
          {next.actions.map((a: any, i: number) => (
            <View key={i} style={{ gap: 2, marginTop: spacing.sm }}>
              <Body style={{ fontWeight: "700" }}>{i + 1}. {a.title}</Body>
              <Meta>{a.why}</Meta>
              <Row gap={spacing.xs}>
                <Chip label={a.impact === "high" ? "High impact" : "Medium impact"} small active={a.impact === "high"} />
                <Chip label={a.effort} small />
              </Row>
            </View>
          ))}
        </Card>
      )}

      <Row center gap={spacing.sm}>
        <Btn label="Re-plan" variant="outline" small loading={replan.isPending}
          onPress={() => replan.mutate()} style={{ flex: 1 }} />
        <Cost credits={2} />
        <Btn label="Rebuild" variant="outline" small loading={rebuild.isPending}
          onPress={() => rebuild.mutate()} style={{ flex: 1 }} />
        <Cost credits={quote?.cost ?? 8} />
      </Row>

      {error && <ErrorNote message={error} />}

      {data.roadmap.phases.map((p: any) => (
        <Card key={p.id}>
          <Row center gap={spacing.sm}>
            <Text style={{ fontSize: 16 }}>
              {p.status === "completed" ? "✅" : p.status === "in-progress" ? "🔵" : "⚪️"}
            </Text>
            <H2 style={{ flex: 1 }}>{p.title}</H2>
          </Row>
          {p.estimatedDuration && <Meta>{p.estimatedDuration}</Meta>}
          {p.description && <Body muted>{p.description}</Body>}
        </Card>
      ))}
    </View>
  );
}

function TasksTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["project", projectId, "kanban"],
    queryFn: () => api<any[]>(`/api/projects/${projectId}/kanban`),
  });

  const generate = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/kanban/ai-generate`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", projectId, "kanban"] }),
    onError: (e) => setError(errText(e)),
  });

  const update = useMutation({
    mutationFn: (t: any) => api(`/api/kanban/${t.id}`, {
      method: "PATCH",
      body: { status: t.status === "done" ? "todo" : "done" },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", projectId, "kanban"] }),
  });

  if (isLoading) return <Loading />;

  return (
    <View style={{ gap: spacing.md }}>
      <Row center gap={spacing.sm}>
        <Btn label="Generate tasks with Nova" variant="outline" small
          loading={generate.isPending} onPress={() => generate.mutate()} style={{ flex: 1 }} />
        <Cost credits={1} />
      </Row>
      {error && <ErrorNote message={error} />}
      {!data?.length ? (
        <Empty title="Nothing on the board" body="Generate tasks to break the project down." />
      ) : (
        data.map((t) => (
          <Card key={t.id} onPress={() => update.mutate(t)}>
            <Row center gap={spacing.sm}>
              <Text style={{ fontSize: 16 }}>{t.status === "done" ? "☑️" : "⬜️"}</Text>
              <View style={{ flex: 1 }}>
                <Body style={t.status === "done" ? { textDecorationLine: "line-through" } : undefined}>
                  {t.title}
                </Body>
                {t.description && <Meta numberOfLines={2}>{t.description}</Meta>}
              </View>
              <Chip label={t.priority} small />
            </Row>
          </Card>
        ))
      )}
    </View>
  );
}

function InvestorTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["project", projectId, "investor"],
    queryFn: () => api<any>(`/api/projects/${projectId}/investor-artifacts`),
  });

  const run = useMutation({
    mutationFn: (path: string) => api(`/api/projects/${projectId}/${path}`, { method: "POST" }),
    onSuccess: () => {
      setRunning(null);
      qc.invalidateQueries({ queryKey: ["project", projectId, "investor"] });
      qc.invalidateQueries({ queryKey: ["subscription"] });
    },
    onError: (e) => { setRunning(null); setError(errText(e)); },
  });

  if (isLoading) return <Loading />;

  const latest = (kind: string) => data?.artifacts?.find((a: any) => a.kind === kind);
  const score = latest("readiness_score");
  const deck = latest("deck_outline");

  const TOOLS = [
    { key: "readiness-score", label: "Readiness Score", credits: 5 },
    { key: "pitch-deck", label: "Pitch Deck Outline", credits: 8 },
    { key: "pricing-analysis", label: "Pricing Analysis", credits: 5 },
  ];

  return (
    <View style={{ gap: spacing.md }}>
      {TOOLS.map((t) => (
        <Row key={t.key} center gap={spacing.sm}>
          <Btn label={t.label} variant="outline" small loading={running === t.key}
            onPress={() => { setRunning(t.key); run.mutate(t.key); }} style={{ flex: 1 }} />
          <Cost credits={t.credits} />
        </Row>
      ))}
      {error && <ErrorNote message={error} />}

      {score && (
        <Card>
          <Label>Investor readiness</Label>
          <Row center gap={spacing.md}>
            <H1>{score.score}</H1>
            <View style={{ flex: 1 }}>
              <Chip label={String(score.content?.verdict || "").replace(/-/g, " ")} small active />
              <Body muted>{score.summary}</Body>
            </View>
          </Row>
          {(score.content?.blockers ?? []).map((b: string, i: number) => (
            <Meta key={i}>· {b}</Meta>
          ))}
        </Card>
      )}

      {deck && (
        <Card>
          <Label>Pitch deck outline</Label>
          {deck.summary && <Body muted>{deck.summary}</Body>}
          {(deck.content?.slides ?? []).slice(0, 12).map((s: any, i: number) => (
            <View key={i} style={{ gap: 2, marginTop: spacing.xs }}>
              <Body style={{ fontWeight: "700" }}>{s.number}. {s.headline}</Body>
              <Meta>{s.purpose}</Meta>
            </View>
          ))}
        </Card>
      )}

      <Card onPress={() => router.push(`/investor/interview?id=${projectId}`)}>
        <Row between center>
          <View style={{ flex: 1, paddingRight: spacing.sm }}>
            <Body style={{ fontWeight: "700" }}>Mock investor interview</Body>
            <Meta>Nova plays the investor and grades every answer.</Meta>
          </View>
          <Cost credits={1} />
        </Row>
      </Card>

      <Card onPress={() => router.push(`/investor/critique?id=${projectId}`)}>
        <Row between center>
          <View style={{ flex: 1, paddingRight: spacing.sm }}>
            <Body style={{ fontWeight: "700" }}>Pitch critique</Body>
            <Meta>Paste your pitch and get it torn apart, kindly.</Meta>
          </View>
          <Cost credits={5} />
        </Row>
      </Card>
    </View>
  );
}
