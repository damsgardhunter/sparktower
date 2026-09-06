import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, spacing } from "../../src/theme";
import {
  Body, Btn, Card, Chip, Cost, ErrorNote, Field, H2, Label,
  Loading, Meta, Row, Screen, Segments, errText,
} from "../../src/components/ui";

const MAX_QUESTIONS = 8;

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

  const { data: personas } = useQuery({
    queryKey: ["investor-personas"],
    queryFn: () => api<any>("/api/investor-personas"),
  });

  const { data: past } = useQuery({
    queryKey: ["project", projectId, "investor"],
    queryFn: () => api<any>(`/api/projects/${projectId}/investor-artifacts`),
    enabled: !!projectId && !interviewId,
  });

  const { data: session, isLoading } = useQuery({
    queryKey: ["mock-interview", interviewId],
    queryFn: () => api<any>(`/api/mock-interviews/${interviewId}`),
    enabled: !!interviewId,
  });

  const start = useMutation({
    mutationFn: () => api<any>(`/api/projects/${projectId}/mock-interview`, {
      method: "POST", body: { persona, difficulty },
    }),
    onSuccess: (r) => { setInterviewId(r.interview.id); setError(null); },
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-interview", interviewId] }),
  });

  // --- Setup ---
  if (!interviewId) {
    return (
      <>
        <Stack.Screen options={{ title: "Mock Interview" }} />
        <Screen>
          <Card>
            <H2>Mock investor interview</H2>
            <Meta>
              Nova plays an investor, asks progressively harder questions, and grades
              each answer out of 100. 1 credit per question, 2 to grade your answer.
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
          <Segments
            options={[
              { value: "friendly", label: "Friendly" },
              { value: "skeptical", label: "Skeptical" },
              { value: "brutal", label: "Brutal" },
            ]}
            value={difficulty}
            onChange={setDifficulty}
          />

          {error && <ErrorNote message={error} />}
          <Row center gap={spacing.sm}>
            <Btn label="Start the interview" loading={start.isPending}
              onPress={() => start.mutate()} style={{ flex: 1 }} />
            <Cost credits={1} />
          </Row>

          {(past?.interviews?.length ?? 0) > 0 && (
            <>
              <Label>Past sessions</Label>
              {past.interviews.map((iv: any) => (
                <Card key={iv.id} onPress={() => setInterviewId(iv.id)}>
                  <Row between>
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontWeight: "700", textTransform: "capitalize" }}>
                        {iv.persona.replace(/_/g, " ")} · {iv.difficulty}
                      </Body>
                      <Meta>{new Date(iv.createdAt).toLocaleString()}</Meta>
                    </View>
                    {iv.averageScore != null && <Chip label={`${iv.averageScore}/100`} small active />}
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
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <Screen>
          <Card>
            <Row between>
              <Body style={{ fontWeight: "700" }}>{session?.persona?.label}</Body>
              {iv?.averageScore != null && <Chip label={`avg ${iv.averageScore}`} small active />}
            </Row>
            <Meta style={{ textTransform: "capitalize" }}>
              {iv?.difficulty} · {graded.length} of {MAX_QUESTIONS} answered
            </Meta>
          </Card>

          {graded.map((t: any, i: number) => (
            <Card key={t.id}>
              <Label>Question {i + 1}</Label>
              <Body style={{ fontWeight: "600" }}>{t.question}</Body>
              <View style={{ borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: spacing.sm }}>
                <Meta>{t.answer}</Meta>
              </View>
              <Row center gap={spacing.sm}>
                <View style={{
                  backgroundColor: scoreColor(t.score) + "22", borderRadius: 6,
                  paddingHorizontal: spacing.sm, paddingVertical: 2,
                }}>
                  <Text style={{ color: scoreColor(t.score), fontWeight: "800", fontSize: 12 }}>
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
              <Btn label="New interview" variant="outline" small onPress={() => setInterviewId(null)} />
            </Card>
          ) : pending ? (
            <Card accent={colors.warning}>
              <Label>Question {graded.length + 1}</Label>
              <Body style={{ fontWeight: "600" }}>{pending.question}</Body>
              <Field value={answer} onChangeText={setAnswer} multiline
                placeholder="Answer like you're in the room…" />
              <Row center gap={spacing.sm}>
                <Btn label="Answer" disabled={!answer.trim()} loading={submit.isPending}
                  onPress={() => submit.mutate()} style={{ flex: 1 }} />
                <Cost credits={3} />
              </Row>
              <Btn label="End & get verdict" variant="ghost" small
                loading={finish.isPending} onPress={() => finish.mutate()} />
            </Card>
          ) : (
            <Btn label="Get their verdict" loading={finish.isPending} onPress={() => finish.mutate()} />
          )}
        </Screen>
      </KeyboardAvoidingView>
    </>
  );
}
