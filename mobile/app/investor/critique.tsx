import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { useEntitlementsQuery } from "../../src/hooks/useEntitlements";
import { UpgradeCard } from "../../src/components/more/UpgradeCard";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import { colors, fontFamily, spacing } from "../../src/theme";
import {
  Body, Btn, Card, Cost, ErrorNote, Field, H1, H2, Label, Loading, Meta,
  Row, Screen, errText,
} from "../../src/components/ui";

/** Credit cost, restated from shared/plans.ts CREDIT_COSTS.pitchCritique. */
const COST = 5;

/** Paste a pitch, get it pulled apart line by line — the web's Investor tools › Pitch Critique. */
export default function PitchCritique() {
  // Named `id` to match every other project-scoped route.
  const { id: projectId } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [pitch, setPitch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ent = useEntitlementsQuery();
  const { notice, show, clear } = useNotice();

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
      show({ tone: "success", text: "Nova's done" });
      setPitch("");
      setError(null);
      qc.invalidateQueries({ queryKey: ["project", projectId, "investor"] });
      qc.invalidateQueries({ queryKey: ["subscription"] });
    },
    onError: (e) => setError(errText(e, "Couldn't critique that.")),
  });

  if (isLoading || ent.isLoading) return <Loading />;

  // Same gate as the web's investor tools: the Builder plan's aiRoadmap feature.
  if (!ent.can("aiRoadmap")) {
    return (
      <>
        <Stack.Screen options={{ title: "Pitch Critique" }} />
        <Screen canvas>
          <UpgradeCard tier="builder" title="Get investor-ready"
            description="Score your readiness, outline a deck, have your pitch pulled apart, and sit a mock investor interview that grades every answer." />
        </Screen>
      </>
    );
  }
  const cantAfford = !ent.isUnlimited && ent.creditsRemaining < COST;

  const latest = data?.artifacts?.find((a: any) => a.kind === "pitch_critique");
  const c = latest?.content ?? {};

  return (
    <>
      <Stack.Screen options={{ title: "Pitch Critique" }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, backgroundColor: colors.canvas }}
      >
        <Screen canvas>
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
          {cantAfford && <ErrorNote message={`This costs ${COST} credits and you have ${ent.creditsRemaining}.`} />}
          {error && <ErrorNote message={error} />}
          <Row center gap={spacing.sm}>
            <Btn label={latest ? "Run again" : "Run"} disabled={!pitch.trim() || cantAfford}
              loading={run.isPending} onPress={() => run.mutate()} style={{ flex: 1 }} />
            <Cost credits={COST} />
          </Row>
          {!latest && <Meta>No critique yet. Paste a pitch above and run it.</Meta>}

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

              {(c.problems ?? []).length > 0 && <Label>What doesn't</Label>}
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
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}
