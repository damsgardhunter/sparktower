import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { useEntitlementsQuery } from "../../src/hooks/useEntitlements";
import { UpgradeCard } from "../../src/components/more/UpgradeCard";
import { Pill } from "../../src/components/MoreKit";
import { colors, fontFamily, spacing } from "../../src/theme";
import {
  Body, Btn, Card, Chip, Cost, ErrorNote, Field, H2, Label,
  Loading, Meta, Row, Screen, Segments, errText,
} from "../../src/components/ui";

const MAX_QUESTIONS = 8;
/** Restated from shared/plans.ts CREDIT_COSTS. */
const QUESTION_COST = 1;
const GRADING_COST = 2;

const DIFFICULTIES = [
  { value: "friendly", label: "Friendly", brief: "Encouraging" },
  { value: "skeptical", label: "Skeptical", brief: "Probes weak answers" },
  { value: "brutal", label: "Brutal", brief: "No mercy" },
];

/**
 * Mock investor interview.
 *
 * Chat-shaped rather than the web's stacked cards — one question at a time
 * with its grade underneath reads much better on a phone, and it keeps the
 * founder focused on the question in front of them.
 */
export default function MockInterview() {
  // Named `id` to match every other project-scoped route.
  const { id: projectId } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [interviewId, setInterviewId] = useState<string | null>(null);
  const [persona, setPersona] = useState("seed_generalist");
  const [difficulty, setDifficulty] = useState("skeptical");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ent = useEntitlementsQuery();

  const { data: personas } = useQuery({
    queryKey: ["investor-personas"],
    queryFn: () => api<any>("/api/investor-personas"),
  });

  const { data: past } = useQuery({
    queryKey: ["project", projectId, "investor"],
    queryFn: () => api<any>(`/api/projects/${projectId}/investor-artifacts`),
    enabled: !!projectId,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["project", projectId, "investor"] });
    qc.invalidateQueries({ queryKey: ["subscription"] });
  };

  const { data: session, isLoading } = useQuery({
    queryKey: ["mock-interview", interviewId],
    queryFn: () => api<any>(`/api/mock-interviews/${interviewId}`),
    enabled: !!interviewId,
  });

  const start = useMutation({
    mutationFn: () => api<any>(`/api/projects/${projectId}/mock-interview`, {
      method: "POST", body: { persona, difficulty },
    }),
    onSuccess: (r) => { setInterviewId(r.interview.id); setError(null); refresh(); },
    onError: (e) => setError(errText(e, "Couldn't start the interview.")),
  });

  const submit = useMutation({
    mutationFn: () => api<any>(`/api/mock-interviews/${interviewId}/answer`, {
      method: "POST", body: { answer },
    }),
    onSuccess: () => {
      setAnswer("");
      qc.invalidateQueries({ queryKey: ["mock-interview", interviewId] });
      qc.invalidateQueries({ queryKey: ["subscription"] });
    },
    onError: (e) => setError(errText(e, "Couldn't grade that answer.")),
  });

  const finish = useMutation({
    mutationFn: () => api(`/api/mock-interviews/${interviewId}/finish`, { method: "POST" }),
    onSuccess: () => { setError(null); qc.invalidateQueries({ queryKey: ["mock-interview", interviewId] }); refresh(); },
    onError: (e) => setError(errText(e, "Couldn't get their verdict.")),
  });

  const open = (next: string | null) => { setError(null); setAnswer(""); setInterviewId(next); };

  if (ent.isLoading) return <Loading />;
  // Same gate as the web's investor tools: the Builder plan's aiRoadmap feature.
  if (!ent.can("aiRoadmap")) {
    return (
      <>
        <Stack.Screen options={{ title: "Mock Interview" }} />
        <Screen canvas>
          <UpgradeCard tier="builder" title="Get investor-ready"
            description="Score your readiness, outline a deck, have your pitch pulled apart, and sit a mock investor interview that grades every answer." />
        </Screen>
      </>
    );
  }
  const cantAfford = (n: number) => !ent.isUnlimited && ent.creditsRemaining < n;

  // --- Setup ---
  if (!interviewId) {
    return (
      <>
        <Stack.Screen options={{ title: "Mock Interview" }} />
        <Screen canvas>
          <Card>
            <H2>Mock investor interview</H2>
            <Meta>
              Nova plays an investor, asks progressively harder questions, and grades
              each answer out of 100. {QUESTION_COST} credit per question, {GRADING_COST} to grade your answer.
            </Meta>
          </Card>

          <Label>Who's across the table?</Label>
          <Row wrap gap={spacing.xs}>
            {(personas?.personas ?? []).map((p: any) => (
              <Chip key={p.id} label={p.label} small active={persona === p.id} onPress={() => setPersona(p.id)} />
            ))}
          </Row>
          {personas?.personas?.find((p: any) => p.id === persona) && (
            <Meta>{personas.personas.find((p: any) => p.id === persona).brief}</Meta>
          )}

          <Label>How hard should they push?</Label>
          <Segments options={DIFFICULTIES.map(({ value, label }) => ({ value, label }))} value={difficulty} onChange={setDifficulty} />
          <Meta>{DIFFICULTIES.find((d) => d.value === difficulty)?.brief}</Meta>

          {cantAfford(QUESTION_COST) && <ErrorNote message={`This costs ${QUESTION_COST} credit and you have ${ent.creditsRemaining}.`} />}
          {error && <ErrorNote message={error} />}
          <Row center gap={spacing.sm}>
            <Btn label="Start the interview" icon="mic" loading={start.isPending} disabled={cantAfford(QUESTION_COST)}
              onPress={() => start.mutate()} style={{ flex: 1 }} />
            <Cost credits={QUESTION_COST} />
          </Row>

          {(past?.interviews?.length ?? 0) > 0 && (
            <>
              <Label>Past sessions</Label>
              {past.interviews.map((iv: any) => (
                <Card key={iv.id} onPress={() => open(iv.id)}>
                  <Row between>
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontFamily: fontFamily.bold, textTransform: "capitalize" }}>
                        {iv.persona.replace(/_/g, " ")} · {iv.difficulty}
                      </Body>
                      <Meta>{new Date(iv.createdAt).toLocaleString()}</Meta>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      {iv.averageScore != null && <Chip label={`${iv.averageScore}/100`} small active />}
                      <Pill label={iv.status} color={iv.status === "completed" ? colors.success : colors.textSecondary} />
                    </View>
                  </Row>
                </Card>
              ))}
            </>
          )}
        </Screen>
      </>
    );
  }

  if (isLoading) return <Loading />;

  const iv = session?.interview;
  const graded = (iv?.turns ?? []).filter((t: any) => t.score != null);
  const pending = (iv?.turns ?? []).find((t: any) => !t.answer);

  const scoreColor = (n: number) => n >= 70 ? colors.success : n >= 45 ? colors.warning : colors.danger;

  return (
    <>
      <Stack.Screen options={{ title: session?.persona?.label || "Interview" }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, backgroundColor: colors.canvas }}
      >
        <Screen canvas>
          <Card>
            <Row between>
              <Body style={{ fontFamily: fontFamily.bold, flex: 1 }}>{session?.persona?.label || "Investor"}</Body>
              {iv?.averageScore != null && <Chip label={`avg ${iv.averageScore}`} small active />}
              <Btn label="Close" small variant="ghost" onPress={() => open(null)} />
            </Row>
            <Meta style={{ textTransform: "capitalize" }}>
              {iv?.difficulty} · {graded.length} of {MAX_QUESTIONS} answered
            </Meta>
          </Card>

          {graded.map((t: any, i: number) => (
            <Card key={t.id}>
              <Label>Question {i + 1}</Label>
              <Body style={{ fontFamily: fontFamily.semibold }}>{t.question}</Body>
              <View style={{ borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: spacing.sm }}>
                <Meta>{t.answer}</Meta>
              </View>
              <Row center gap={spacing.sm}>
                <View style={{
                  backgroundColor: scoreColor(t.score) + "22", borderRadius: 6,
                  paddingHorizontal: spacing.sm, paddingVertical: 2,
                }}>
                  <Text style={{ color: scoreColor(t.score), fontFamily: fontFamily.bold, fontSize: 12 }}>
                    {t.score}/100
                  </Text>
                </View>
                {t.feedback?.verdict && <Meta style={{ flex: 1 }}>{t.feedback.verdict}</Meta>}
              </Row>
              {(t.feedback?.strong ?? []).length > 0 && (
                <Meta style={{ color: colors.success }}>+ {t.feedback.strong.join(" · ")}</Meta>
              )}
              {(t.feedback?.weak ?? []).length > 0 && (
                <Meta style={{ color: colors.danger }}>− {t.feedback.weak.join(" · ")}</Meta>
              )}
              {t.feedback?.wouldPushOn && <Meta>They'd follow up: {t.feedback.wouldPushOn}</Meta>}
            </Card>
          ))}

          {error && <ErrorNote message={error} />}

          {iv?.status === "completed" ? (
            <Card accent={colors.primary}>
              <Label>Their verdict</Label>
              <Body>{iv.verdict}</Body>
              {iv.averageScore != null && (
                <Meta>Averaged {iv.averageScore}/100 across {graded.length} answers.</Meta>
              )}
              <Btn label="New interview" variant="outline" small onPress={() => open(null)} />
            </Card>
          ) : pending ? (
            <Card accent={colors.warning}>
              <Label>Question {graded.length + 1}</Label>
              <Body style={{ fontFamily: fontFamily.semibold }}>{pending.question}</Body>
              <Field value={answer} onChangeText={setAnswer} multiline
                placeholder="Answer like you're in the room…" />
              <Row center gap={spacing.sm}>
                <Btn label="Answer" icon="send" disabled={!answer.trim() || cantAfford(GRADING_COST + QUESTION_COST)} loading={submit.isPending}
                  onPress={() => submit.mutate()} style={{ flex: 1 }} />
                <Cost credits={GRADING_COST + QUESTION_COST} />
              </Row>
              <Btn label="End & get verdict" variant="ghost" small
                loading={finish.isPending} onPress={() => finish.mutate()} />
            </Card>
          ) : (
            <Btn label="Get their verdict" icon="trophy" variant="outline" loading={finish.isPending} onPress={() => finish.mutate()} />
          )}
        </Screen>
      </KeyboardAvoidingView>
    </>
  );
}
