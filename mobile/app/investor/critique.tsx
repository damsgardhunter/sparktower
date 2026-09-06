import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, spacing } from "../../src/theme";
import {
  Body, Btn, Card, Cost, ErrorNote, Field, H1, H2, Label, Loading, Meta,
  Row, Screen, errText,
} from "../../src/components/ui";

/** Paste a pitch, get it pulled apart line by line. */
export default function PitchCritique() {
  // Named `id` to match every other project-scoped route.
  const { id: projectId } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [pitch, setPitch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["project", projectId, "investor"],
    queryFn: () => api<any>(`/api/projects/${projectId}/investor-artifacts`),
    enabled: !!projectId,
  });

  const run = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/pitch-critique`, {
      method: "POST", body: { pitch },
    }),
    onSuccess: () => {
      setPitch("");
      setError(null);
      qc.invalidateQueries({ queryKey: ["project", projectId, "investor"] });
      qc.invalidateQueries({ queryKey: ["subscription"] });
    },
    onError: (e) => setError(errText(e, "Couldn't critique that.")),
  });

  if (isLoading) return <Loading />;

  const latest = data?.artifacts?.find((a: any) => a.kind === "pitch_critique");
  const c = latest?.content ?? {};

  return (
    <>
      <Stack.Screen options={{ title: "Pitch Critique" }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <Screen>
          <Card>
            <H2>Pitch critique</H2>
            <Meta>
              Nova quotes your own words back when something doesn't land, and tells
              you what to say instead.
            </Meta>
          </Card>

          <Field
            label="Paste your pitch"
            value={pitch}
            onChangeText={setPitch}
            multiline
            placeholder="Your elevator pitch, cold email, or the script you'd read in a meeting…"
          />
          {error && <ErrorNote message={error} />}
          <Row center gap={spacing.sm}>
            <Btn label={latest ? "Critique again" : "Critique it"} disabled={!pitch.trim()}
              loading={run.isPending} onPress={() => run.mutate()} style={{ flex: 1 }} />
            <Cost credits={5} />
          </Row>

          {latest && (
            <>
              <Card>
                <Row center gap={spacing.md}>
                  <H1>{latest.score}</H1>
                  <Body muted style={{ flex: 1 }}>{latest.summary}</Body>
                </Row>
              </Card>

              {(c.worksWell ?? []).length > 0 && (
                <Card accent={colors.success}>
                  <Label>This lands</Label>
                  {c.worksWell.map((w: string, i: number) => <Body key={i}>· {w}</Body>)}
                </Card>
              )}

              {(c.problems ?? []).map((p: any, i: number) => (
                <Card key={i} accent={colors.danger}>
                  <Body style={{ fontStyle: "italic" }}>"{p.quote}"</Body>
                  <Meta>{p.issue}</Meta>
                  <Body>
                    <Text style={{ color: colors.textTertiary }}>Instead: </Text>{p.fix}
                  </Body>
                </Card>
              ))}

              {(c.questionsTheyWillAsk ?? []).length > 0 && (
                <Card>
                  <Label>They'll ask you this</Label>
                  {c.questionsTheyWillAsk.map((q: string, i: number) => <Body key={i}>· {q}</Body>)}
                </Card>
              )}

              {c.rewrittenOpener && (
                <Card accent={colors.primary}>
                  <Label>Try opening with this</Label>
                  <Body>{c.rewrittenOpener}</Body>
                </Card>
              )}
            </>
          )}
        </Screen>
      </KeyboardAvoidingView>
    </>
  );
}
